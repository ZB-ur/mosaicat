import fs from 'node:fs';
import type { AgentContext } from '../core/types.js';
import { BaseAgent } from '../core/agent.js';
import type { OutputSpec } from '../core/prompt-assembler.js';
import { assemblePrompt } from '../core/prompt-assembler.js';
import { eventBus } from '../core/event-bus.js';
import { getArtifactsDir } from '../core/artifact.js';

const QA_LEAD_PROMPT_PATH = '.claude/agents/mosaic/qa-lead.md';

/**
 * QALead Agent — Acceptance Test Generator
 *
 * Generates acceptance test code BEFORE the Coder runs (TDD approach).
 * Uses tool use to write test files to tests/acceptance/.
 *
 * Flow:
 * 1. Build prompt from PRD + UX flows + API spec + tech-spec + constitution
 * 2. LLM call with tool use (Read, Write, Bash) to generate:
 *    - test-plan.md (strategy document)
 *    - tests/acceptance/ directory with executable test code
 *    - test-plan.manifest.json
 * 3. Parse LLM response for manifest data
 */
export class QALeadAgent extends BaseAgent {
  getOutputSpec(): OutputSpec {
    return {
      artifacts: ['test-plan.md'],
      manifest: 'test-plan.manifest.json',
    };
  }

  protected async run(context: AgentContext): Promise<void> {
    const autonomy = context.task.autonomy;
    const maxBudget = autonomy?.max_budget_usd ?? 2;

    // Ensure tests/acceptance directory exists
    const artifactsDir = getArtifactsDir();
    const testsDir = `${artifactsDir}/tests/acceptance`;
    fs.mkdirSync(testsDir, { recursive: true });

    // Build the prompt with all inputs
    const spec = this.getOutputSpec();
    const prompt = assemblePrompt(context, spec);

    // Add explicit instructions for tool use
    const toolPrompt = `${prompt}

## Working Directory
The code output directory is: ${artifactsDir}
Write all test files under: ${artifactsDir}/tests/acceptance/

## Required Outputs
1. Write test files to tests/acceptance/ using the Write tool:
   - tests/acceptance/features/ — one test file per F-NNN feature
   - tests/acceptance/flows/ — one test file per UX flow
   - tests/acceptance/api/ — API contract tests
2. After writing all test files, output your final response as JSON:
\`\`\`json
{
  "artifact": "...full test-plan.md content...",
  "manifest": {
    "test_framework": "vitest",
    "commands": {
      "setupCommand": "npm install -D vitest @testing-library/react @testing-library/user-event @testing-library/jest-dom happy-dom",
      "runCommand": "npx vitest run tests/acceptance/"
    },
    "test_suites": [...]
  }
}
\`\`\``;

    this.logger.agent(this.stage, 'info', 'llm:call', {
      promptLength: toolPrompt.length,
      expectedArtifacts: spec.artifacts,
    });
    eventBus.emit('agent:thinking', this.stage, toolPrompt.length);

    const response = await this.provider.call(toolPrompt, {
      systemPrompt: context.systemPrompt,
      allowedTools: autonomy?.allowed_tools ?? ['Read', 'Write', 'Bash'],
      maxBudgetUsd: maxBudget,
      timeoutMs: 600_000, // 10 minutes
    });

    const raw = response.content;
    this.logger.agent(this.stage, 'info', 'llm:response', {
      responseLength: raw.length,
    });
    eventBus.emit('agent:response', this.stage, raw.length);

    // Parse structured JSON response
    let parsed: { artifact?: string; manifest?: Record<string, unknown> };
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Fallback: try to extract JSON from the response
      const jsonMatch = raw.match(/\{[\s\S]*"artifact"[\s\S]*\}/);
      if (jsonMatch) {
        try {
          parsed = JSON.parse(jsonMatch[0]);
        } catch {
          parsed = { artifact: raw };
        }
      } else {
        parsed = { artifact: raw };
      }
    }

    // Write test-plan.md artifact
    if (parsed.artifact) {
      this.writeOutput('test-plan.md', parsed.artifact);
    }

    // Write manifest
    if (parsed.manifest && spec.manifest) {
      this.writeOutputManifest(spec.manifest, parsed.manifest);
    }

    // Count test files written for summary
    const testFiles = this.countTestFiles(artifactsDir);
    eventBus.emit('agent:summary', this.stage, `${testFiles} acceptance test files generated`);
  }

  private countTestFiles(artifactsDir: string): number {
    const testsDir = `${artifactsDir}/tests/acceptance`;
    try {
      return this.countFilesRecursive(testsDir);
    } catch {
      return 0;
    }
  }

  private countFilesRecursive(dir: string): number {
    let count = 0;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.test.ts')) {
          count++;
        } else if (entry.isDirectory()) {
          count += this.countFilesRecursive(`${dir}/${entry.name}`);
        }
      }
    } catch { /* directory may not exist */ }
    return count;
  }
}
