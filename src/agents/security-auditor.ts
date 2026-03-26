import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import type { AgentContext } from '../core/types.js';
import { BaseAgent } from '../core/agent.js';
import type { OutputSpec } from '../core/prompt-assembler.js';

const AUDITOR_PROMPT_PATH = '.claude/agents/mosaic/security-auditor.md';

interface ScanResults {
  dependency_vulnerabilities: number;
  code_issues: number;
  secrets_found: number;
  raw_npm_audit: string;
  raw_pattern_scan: string;
  env_files_found: string[];
}

interface LLMFinding {
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: string;
  file: string;
  description: string;
}

/**
 * SecurityAuditor Agent — two-phase security analysis.
 *
 * Phase 1 (Programmatic): npm audit, pattern scanning for secrets/hardcoded keys
 * Phase 2 (LLM): Review high-risk files for logic vulnerabilities
 */
export class SecurityAuditorAgent extends BaseAgent {
  getOutputSpec(): OutputSpec {
    return {
      artifacts: ['security-report.md'],
      manifest: 'security-report.manifest.json',
    };
  }

  protected async run(context: AgentContext): Promise<void> {
    const autonomy = context.task.autonomy;
    const codeDir = `${this.ctx.store.getDir()}/code`;

    // Phase 1: Programmatic scanning
    this.logger.agent(this.stage, 'info', 'auditor:scan-start', {});
    const scanResults = this.runProgrammaticScan(codeDir);
    this.logger.agent(this.stage, 'info', 'auditor:scan-complete', {
      vulnerabilities: scanResults.dependency_vulnerabilities,
      codeIssues: scanResults.code_issues,
      secrets: scanResults.secrets_found,
    });

    // Phase 2: LLM review of high-risk files
    const llmFindings = await this.runLLMReview(context, codeDir, scanResults, autonomy?.max_budget_usd ?? 2);

    // Generate report
    this.generateReport(scanResults, llmFindings);
  }

  // ─── Phase 1: Programmatic Scanning ────────────────────────

  private runProgrammaticScan(codeDir: string): ScanResults {
    const results: ScanResults = {
      dependency_vulnerabilities: 0,
      code_issues: 0,
      secrets_found: 0,
      raw_npm_audit: '',
      raw_pattern_scan: '',
      env_files_found: [],
    };

    // npm audit (if package.json exists)
    if (fs.existsSync(`${codeDir}/package.json`)) {
      try {
        const output = execSync('npm audit --json 2>/dev/null || true', {
          cwd: codeDir,
          timeout: 60_000,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        results.raw_npm_audit = output;
        try {
          const auditData = JSON.parse(output);
          results.dependency_vulnerabilities = auditData.metadata?.vulnerabilities
            ? Object.values(auditData.metadata.vulnerabilities as Record<string, number>).reduce((a: number, b: number) => a + b, 0)
            : 0;
        } catch {
          // JSON parse of audit output failed — non-fatal
        }
      } catch {
        // npm audit not available or failed
      }
    }

    // Pattern scanning for secrets and hardcoded credentials
    const secretPatterns = [
      /(?:api[_-]?key|apikey)\s*[=:]\s*['"][a-zA-Z0-9]{20,}['"]/gi,
      /(?:secret|password|passwd|pwd)\s*[=:]\s*['"][^'"]{8,}['"]/gi,
      /(?:token)\s*[=:]\s*['"][a-zA-Z0-9_\-.]{20,}['"]/gi,
      /(?:aws_access_key_id|aws_secret_access_key)\s*[=:]\s*['"][^'"]+['"]/gi,
      /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/g,
    ];

    const patternFindings: string[] = [];
    this.scanFilesForPatterns(codeDir, secretPatterns, patternFindings);
    results.secrets_found = patternFindings.length;
    results.raw_pattern_scan = patternFindings.join('\n');

    // Check for .env file existence (without reading contents)
    results.env_files_found = this.checkEnvFileExistence(codeDir);

    return results;
  }

  private scanFilesForPatterns(dir: string, patterns: RegExp[], findings: string[]): void {
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = `${dir}/${entry.name}`;
        if (entry.isDirectory()) {
          if (['node_modules', '.git', 'dist', 'build'].includes(entry.name)) continue;
          this.scanFilesForPatterns(fullPath, patterns, findings);
        } else {
          if (!['.ts', '.tsx', '.js', '.jsx', '.json', '.yaml', '.yml'].some(ext => entry.name.endsWith(ext))) continue;
          try {
            const content = fs.readFileSync(fullPath, 'utf-8');
            for (const pattern of patterns) {
              pattern.lastIndex = 0;
              const match = pattern.exec(content);
              if (match) {
                findings.push(`${fullPath}: ${match[0].slice(0, 80)}`);
              }
            }
          } catch {
            // File read failed — skip
          }
        }
      }
    } catch {
      // Directory not accessible
    }
  }

  // ─── Phase 2: LLM Review ──────────────────────────────────

  private async runLLMReview(
    context: AgentContext,
    codeDir: string,
    scanResults: ScanResults,
    budgetUsd: number,
  ): Promise<LLMFinding[]> {
    const auditorPrompt = fs.readFileSync(AUDITOR_PROMPT_PATH, 'utf-8');

    // Identify high-risk files (auth, API, data handling)
    const highRiskFiles = this.identifyHighRiskFiles(codeDir);

    const parts: string[] = [];
    parts.push('## Security Audit Task');
    parts.push('Review the following code for security vulnerabilities.\n');

    // Include scan results
    parts.push('## Automated Scan Results');
    parts.push(`- Dependency vulnerabilities: ${scanResults.dependency_vulnerabilities}`);
    parts.push(`- Hardcoded secrets found: ${scanResults.secrets_found}`);
    if (scanResults.raw_pattern_scan) {
      parts.push(`\nSecret patterns detected:\n\`\`\`\n${scanResults.raw_pattern_scan.slice(0, 2000)}\n\`\`\``);
    }
    parts.push('');

    // Include high-risk file contents
    parts.push('## High-Risk Files for Review');
    for (const file of highRiskFiles.slice(0, 10)) {
      try {
        const content = fs.readFileSync(`${codeDir}/${file}`, 'utf-8');
        parts.push(`### ${file}`);
        parts.push('```');
        parts.push(content.slice(0, 3000));
        parts.push('```\n');
      } catch {
        // Skip unreadable files
      }
    }

    parts.push('## Instructions');
    parts.push('Analyze the code for: injection attacks (SQL, XSS, command), auth bypass, data leaks, SSRF, insecure crypto, hardcoded credentials.');
    parts.push('Return your findings as JSON.');

    const userPrompt = parts.join('\n');

    this.logger.agent(this.stage, 'info', 'auditor:llm-start', {
      highRiskFiles: highRiskFiles.length,
      promptLength: userPrompt.length,
    });
    this.ctx.eventBus.emit('agent:thinking', this.stage, userPrompt.length);

    const response = await this.provider.call(userPrompt, {
      systemPrompt: auditorPrompt,
      maxBudgetUsd: budgetUsd,
      jsonSchema: {
        type: 'object',
        properties: {
          findings: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
                category: { type: 'string' },
                file: { type: 'string' },
                description: { type: 'string' },
              },
              required: ['severity', 'category', 'file', 'description'],
            },
          },
        },
        required: ['findings'],
      },
    });

    this.ctx.eventBus.emit('agent:response', this.stage, response.content.length);

    try {
      const parsed = JSON.parse(response.content);
      return (parsed.findings ?? []) as LLMFinding[];
    } catch {
      this.logger.agent(this.stage, 'warn', 'auditor:llm-parse-failed', {});
      return [];
    }
  }

  private identifyHighRiskFiles(codeDir: string): string[] {
    const highRiskPatterns = [
      /auth/i, /login/i, /session/i, /token/i, /password/i,
      /api/i, /route/i, /endpoint/i, /handler/i,
      /database/i, /db/i, /query/i, /sql/i,
      /crypto/i, /encrypt/i, /hash/i,
      /upload/i, /file/i, /storage/i,
      /middleware/i, /guard/i, /permission/i,
    ];

    const allFiles: string[] = [];
    this.listFilesRecursive(codeDir, codeDir, allFiles);

    return allFiles.filter(f =>
      highRiskPatterns.some(p => p.test(f))
    );
  }

  private listFilesRecursive(dir: string, baseDir: string, result: string[]): void {
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = `${dir}/${entry.name}`;
        if (entry.isDirectory()) {
          if (['node_modules', '.git', 'dist', 'build'].includes(entry.name)) continue;
          this.listFilesRecursive(fullPath, baseDir, result);
        } else {
          result.push(fullPath.slice(baseDir.length + 1));
        }
      }
    } catch {
      // Directory not accessible
    }
  }

  /**
   * Walk directory tree to find .env files by existence only -- never reads their contents.
   * Returns relative paths of found .env files.
   */
  private checkEnvFileExistence(codeDir: string): string[] {
    const envFiles: string[] = [];
    const walk = (dir: string) => {
      try {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== '.git') {
            walk(path.join(dir, entry.name));
          } else if (entry.name === '.env' || entry.name.startsWith('.env.')) {
            envFiles.push(path.relative(codeDir, path.join(dir, entry.name)));
          }
        }
      } catch {
        // Directory not accessible
      }
    };
    walk(codeDir);
    return envFiles;
  }

  // ─── Report Generation ─────────────────────────────────────

  private generateReport(scanResults: ScanResults, llmFindings: LLMFinding[]): void {
    // Determine verdict
    const hasCritical = llmFindings.some(f => f.severity === 'critical');
    const hasHigh = llmFindings.some(f => f.severity === 'high');
    const hasSecrets = scanResults.secrets_found > 0;
    const verdict = (hasCritical || hasSecrets) ? 'fail' : (hasHigh ? 'warn' : 'pass');

    // Generate markdown report
    const lines: string[] = [
      '# Security Audit Report',
      '',
      `## Verdict: ${verdict.toUpperCase()}`,
      '',
      '## Automated Scan Results',
      `- **Dependency vulnerabilities:** ${scanResults.dependency_vulnerabilities}`,
      `- **Code pattern issues:** ${scanResults.code_issues}`,
      `- **Hardcoded secrets found:** ${scanResults.secrets_found}`,
      '',
    ];

    if (scanResults.raw_pattern_scan) {
      lines.push('### Secret Patterns Detected');
      lines.push('```');
      lines.push(scanResults.raw_pattern_scan.slice(0, 2000));
      lines.push('```');
      lines.push('');
    }

    if (scanResults.env_files_found.length > 0) {
      lines.push('### Environment Files Found');
      for (const envFile of scanResults.env_files_found) {
        lines.push(`- **SEC-ENV-001:** .env file found at \`${envFile}\` -- ensure it is gitignored`);
      }
      lines.push('');
    }

    if (llmFindings.length > 0) {
      lines.push('## LLM Security Findings');
      lines.push('');
      for (const f of llmFindings) {
        lines.push(`### [${f.severity.toUpperCase()}] ${f.category}`);
        lines.push(`- **File:** ${f.file}`);
        lines.push(`- **Description:** ${f.description}`);
        lines.push('');
      }
    } else {
      lines.push('## LLM Security Findings');
      lines.push('No additional vulnerabilities found by LLM review.');
      lines.push('');
    }

    this.writeOutput('security-report.md', lines.join('\n'));

    // Write manifest
    const manifest = {
      scan_results: {
        dependency_vulnerabilities: scanResults.dependency_vulnerabilities,
        code_issues: scanResults.code_issues,
        secrets_found: scanResults.secrets_found,
      },
      llm_findings: llmFindings,
      verdict,
    };
    this.writeOutputManifest('security-report.manifest.json', manifest);

    this.logger.agent(this.stage, 'info', 'auditor:report', {
      verdict,
      scanVulns: scanResults.dependency_vulnerabilities,
      llmFindings: llmFindings.length,
    });
  }
}
