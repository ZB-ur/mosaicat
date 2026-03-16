import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RunManager } from '../core/run-manager.js';
import type { PipelineConfig } from '../core/types.js';
import { validateGitHubEnv } from '../core/security.js';

const ARTIFACTS_DIR = '.mosaic/artifacts';

export function registerTools(server: McpServer, runManager: RunManager): void {
  server.tool(
    'mosaic_run',
    'Start a Mosaicat design pipeline from a single instruction. Returns a run ID for tracking.',
    {
      instruction: z.string().describe('The product idea or instruction to process through the pipeline'),
      auto_approve: z.boolean().optional().describe('Skip manual approval gates (default: false)'),
    },
    async ({ instruction, auto_approve }) => {
      const runId = await runManager.startRun(instruction, auto_approve ?? false);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ run_id: runId, status: 'started' }),
        }],
      };
    }
  );

  server.tool(
    'mosaic_status',
    'Check the status of a Mosaicat pipeline run. Shows current stage, state, and any pending approvals or clarifications.',
    {
      run_id: z.string().describe('The run ID returned by mosaic_run'),
    },
    async ({ run_id }) => {
      const status = runManager.getStatus(run_id);
      if (!status) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ error: `Run ${run_id} not found` }),
          }],
          isError: true,
        };
      }
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(status),
        }],
      };
    }
  );

  server.tool(
    'mosaic_approve',
    'Approve or reject a manual gate in a Mosaicat pipeline run. Use when status shows awaiting_human.',
    {
      run_id: z.string().describe('The run ID'),
      approved: z.boolean().describe('true to approve, false to reject'),
    },
    async ({ run_id, approved }) => {
      try {
        if (approved) {
          runManager.approve(run_id);
        } else {
          runManager.reject(run_id);
        }
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ status: approved ? 'approved' : 'rejected' }),
          }],
        };
      } catch (err) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
          }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    'mosaic_artifacts',
    'Read artifacts produced by a Mosaicat pipeline run. Without artifact_name, lists all files. With artifact_name, returns that file\'s content.',
    {
      artifact_name: z.string().optional().describe('Specific artifact file name to read (e.g., "prd.md", "components/AuthForm.tsx")'),
    },
    async ({ artifact_name }) => {
      if (artifact_name) {
        // Read specific artifact
        const filePath = path.join(ARTIFACTS_DIR, artifact_name);
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          return {
            content: [{
              type: 'text' as const,
              text: content,
            }],
          };
        } catch {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ error: `Artifact "${artifact_name}" not found` }),
            }],
            isError: true,
          };
        }
      }

      // List all artifacts
      try {
        const files = listFilesRecursive(ARTIFACTS_DIR);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ artifacts: files }),
          }],
        };
      } catch {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ artifacts: [], note: 'No artifacts directory found. Run a pipeline first.' }),
          }],
        };
      }
    }
  );

  server.tool(
    'mosaic_github_config',
    'Check the GitHub integration configuration status. Returns whether GitHub mode is enabled, environment variable validation results, and current config values.',
    {},
    async () => {
      try {
        const pipelineConfig = yaml.load(
          fs.readFileSync('config/pipeline.yaml', 'utf-8')
        ) as PipelineConfig;

        const envValidation = validateGitHubEnv();
        const githubConfig = pipelineConfig.github;

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              enabled: githubConfig?.enabled ?? false,
              env_valid: envValidation.valid,
              env_errors: envValidation.errors,
              config: githubConfig ? {
                poll_interval_ms: githubConfig.poll_interval_ms,
                poll_timeout_ms: githubConfig.poll_timeout_ms,
                approve_keywords: githubConfig.approve_keywords,
                reject_keywords: githubConfig.reject_keywords,
              } : null,
            }),
          }],
        };
      } catch (err) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
          }],
          isError: true,
        };
      }
    }
  );
}

function listFilesRecursive(dir: string, prefix = ''): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...listFilesRecursive(path.join(dir, entry.name), relative));
    } else {
      files.push(relative);
    }
  }
  return files;
}
