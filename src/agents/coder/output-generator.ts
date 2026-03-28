import fs from 'node:fs';
import path from 'node:path';
import type { ArtifactIO } from './types.js';
import type { CodePlan } from '../code-plan-schema.js';
import { listBuiltFiles } from './utils.js';
import { analyzeFile, classifyFile } from '../../core/hooks/ast-quality-gate.js';
import type { ImplementationStatus, QualityGate } from '../../core/quality-gate-types.js';

/** Write callback matching BaseAgent.writeOutput / writeOutputManifest */
export interface OutputWriter {
  writeOutput(name: string, content: string): void;
  writeOutputManifest(name: string, data: unknown): void;
}

/**
 * Generates manifest and README for the Coder pipeline output.
 * Extracted from CoderAgent to keep the facade under 250 lines.
 */
export class OutputGenerator {
  constructor(
    private readonly stage: string,
    private readonly logger: { agent(stage: string, level: string, event: string, data?: Record<string, unknown>): void },
    private readonly writer: OutputWriter,
    private readonly artifacts: ArtifactIO,
  ) {}

  generateManifest(plan: CodePlan): void {
    const codeDir = `${this.artifacts.getDir()}/code`;
    const allFiles = listBuiltFiles(codeDir);
    const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);

    const fileEntries = allFiles.map(filePath => {
      const mod = plan.modules.find(m => m.files.some(f => filePath.endsWith(f) || f.endsWith(filePath)));
      const ext = path.extname(filePath);

      let implementationStatus: ImplementationStatus | undefined;
      if (CODE_EXTENSIONS.has(ext)) {
        try {
          const content = fs.readFileSync(`${codeDir}/${filePath}`, 'utf-8');
          const analysis = analyzeFile(filePath, content);
          implementationStatus = classifyFile(analysis);
        } catch {
          // If file can't be read/parsed, skip status
        }
      }

      return {
        path: `code/${filePath}`,
        module: mod?.name ?? 'unknown',
        description: '',
        ...(implementationStatus !== undefined && { implementation_status: implementationStatus }),
      };
    });

    const statusCounts = { stub: 0, partial: 0, complete: 0 };
    for (const entry of fileEntries) {
      const s = (entry as Record<string, unknown>).implementation_status as string | undefined;
      if (s === 'stub') statusCounts.stub++;
      else if (s === 'partial') statusCounts.partial++;
      else if (s === 'complete') statusCounts.complete++;
    }

    const qualityGate: QualityGate = {
      stub_count: statusCounts.stub,
      partial_count: statusCounts.partial,
      complete_count: statusCounts.complete,
      coverage_gaps: [],
      blocked: statusCounts.stub > 0 || statusCounts.partial > 0,
    };

    const manifest = {
      files: fileEntries,
      modules: plan.modules.map(m => m.name),
      covers_tasks: [...new Set(plan.modules.flatMap(m => m.covers_tasks))],
      covers_features: [...new Set(plan.modules.flatMap(m => m.covers_features))],
      quality_gate: qualityGate,
    };

    this.writer.writeOutputManifest('code.manifest.json', manifest);

    this.logger.agent(this.stage, 'info', 'manifest:generated', {
      files: fileEntries.length,
      modules: manifest.modules.length,
      quality_gate: qualityGate,
    });
  }

  generateReadme(plan: CodePlan): void {
    const codeDir = `${this.artifacts.getDir()}/code`;
    const lines: string[] = [];

    lines.push(`# ${plan.project_name}`);
    lines.push('');

    try {
      const briefRaw = this.artifacts.read('intent-brief.json');
      const brief = JSON.parse(briefRaw);
      if (brief.problem) lines.push(brief.problem);
      lines.push('');
      if (brief.target_users) lines.push(`**Target Users:** ${brief.target_users}`);
      if (brief.core_scenarios?.length > 0) {
        lines.push('');
        lines.push('**Core Scenarios:**');
        for (const s of brief.core_scenarios) {
          lines.push(`- ${s}`);
        }
      }
      lines.push('');
    } catch {
      lines.push(`A ${plan.tech_stack.framework} project.`);
      lines.push('');
    }

    try {
      const prdRaw = this.artifacts.read('prd.manifest.json');
      const prd = JSON.parse(prdRaw);
      if (prd.features?.length > 0) {
        lines.push('## Features');
        lines.push('');
        for (const f of prd.features) {
          lines.push(`- **${f.id}**: ${f.name}`);
        }
        lines.push('');
      }
    } catch {
      // No PRD manifest -- skip
    }

    lines.push('## Tech Stack');
    lines.push('');
    lines.push('| Layer | Technology |');
    lines.push('|---|---|');
    lines.push(`| Language | ${plan.tech_stack.language} |`);
    lines.push(`| Framework | ${plan.tech_stack.framework} |`);
    lines.push(`| Build Tool | ${plan.tech_stack.build_tool} |`);
    lines.push('');

    lines.push('## Quick Start');
    lines.push('');
    lines.push('```bash');
    lines.push(plan.commands.setupCommand);
    lines.push(plan.commands.buildCommand);
    lines.push('```');
    lines.push('');

    const nonScaffoldModules = plan.modules.filter(m => m.priority > 0);
    if (nonScaffoldModules.length > 1) {
      lines.push('## Architecture');
      lines.push('');
      lines.push('```mermaid');
      lines.push('graph TD');

      for (const mod of nonScaffoldModules) {
        const label = `${mod.name}["${mod.name}<br/><small>${escapeForMermaid(mod.description)}</small>"]`;
        lines.push(`  ${label}`);
      }

      for (const mod of nonScaffoldModules) {
        for (const dep of mod.dependencies) {
          if (dep === 'scaffold') continue;
          lines.push(`  ${dep} --> ${mod.name}`);
        }
      }

      lines.push('```');
      lines.push('');
    }

    lines.push('## Modules');
    lines.push('');
    lines.push('| Module | Description | Files | Features |');
    lines.push('|---|---|---|---|');
    for (const mod of plan.modules) {
      const features = mod.covers_features.join(', ') || '--';
      lines.push(`| ${mod.name} | ${mod.description} | ${mod.files.length} | ${features} |`);
    }
    lines.push('');

    lines.push('## Project Structure');
    lines.push('');
    lines.push('```');
    const tree = buildDirectoryTree(codeDir, 3);
    lines.push(tree);
    lines.push('```');
    lines.push('');

    lines.push('---');
    lines.push('');
    lines.push('_Generated by [Mosaicat](https://github.com/ZB-ur/mosaicat) pipeline_');

    const readmeContent = lines.join('\n');
    fs.writeFileSync(`${codeDir}/README.md`, readmeContent, 'utf-8');
    this.writer.writeOutput('code/README.md', readmeContent);

    this.logger.agent(this.stage, 'info', 'readme:generated', {
      size: readmeContent.length,
    });
  }
}

function escapeForMermaid(text: string): string {
  return text
    .replace(/"/g, "'")
    .replace(/[<>]/g, '')
    .slice(0, 60);
}

function buildDirectoryTree(dir: string, maxDepth: number): string {
  const skipDirs = new Set(['node_modules', 'dist', 'build', '.turbo', '.cache', '.git']);
  const lines: string[] = [];
  const baseName = dir.split('/').pop() ?? dir;
  lines.push(`${baseName}/`);

  const walk = (currentDir: string, prefix: string, depth: number) => {
    if (depth >= maxDepth) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    const dirs = entries.filter(e => e.isDirectory() && !skipDirs.has(e.name)).sort((a, b) => a.name.localeCompare(b.name));
    const files = entries.filter(e => !e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
    const all = [...dirs, ...files];

    for (let i = 0; i < all.length; i++) {
      const entry = all[i];
      const isLast = i === all.length - 1;
      const connector = isLast ? '\u2514\u2500\u2500 ' : '\u251c\u2500\u2500 ';
      const childPrefix = isLast ? '    ' : '\u2502   ';

      if (entry.isDirectory()) {
        lines.push(`${prefix}${connector}${entry.name}/`);
        walk(`${currentDir}/${entry.name}`, `${prefix}${childPrefix}`, depth + 1);
      } else {
        lines.push(`${prefix}${connector}${entry.name}`);
      }
    }
  };

  walk(dir, '', 0);
  return lines.join('\n');
}
