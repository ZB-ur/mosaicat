import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RunManager } from '../core/run-manager.js';
import type { PipelineConfig, StageName } from '../core/types.js';
import { STAGE_NAMES } from '../core/types.js';
import { loadCachedAuth } from '../auth/auth-store.js';
import { EvolutionEngine } from '../evolution/engine.js';
import { listPromptVersions, rollbackPrompt } from '../evolution/prompt-versioning.js';
import { StubProvider } from '../core/llm-provider.js';
import { Logger } from '../core/logger.js';

const ARTIFACTS_DIR = '.mosaic/artifacts';

export function registerTools(server: McpServer, runManager: RunManager): void {
  server.tool(
    'mosaic_run',
    'Start a Mosaicat design pipeline from a single instruction. Returns a run ID for tracking.',
    {
      instruction: z.string().describe('The product idea or instruction to process through the pipeline'),
      auto_approve: z.boolean().optional().describe('Skip manual approval gates (default: false)'),
      profile: z.enum(['design-only', 'full', 'frontend-only']).optional().describe('Pipeline profile (default: design-only)'),
    },
    async ({ instruction, auto_approve, profile }) => {
      const runId = await runManager.startRun(instruction, auto_approve ?? false, profile);
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
    'Approve or reject a manual gate in a Mosaicat pipeline run. Use when status shows awaiting_human. On rejection, provide feedback and optionally specify components to retry.',
    {
      run_id: z.string().describe('The run ID'),
      approved: z.boolean().describe('true to approve, false to reject'),
      feedback: z.string().optional().describe('Rejection feedback — what needs to change'),
      retry_components: z.array(z.string()).optional().describe('Component names to rebuild (UIDesigner only). Omit for full retry.'),
    },
    async ({ run_id, approved, feedback, retry_components }) => {
      try {
        if (approved) {
          runManager.approve(run_id);
        } else {
          runManager.reject(run_id, feedback, retry_components);
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

        const cachedAuth = loadCachedAuth();
        const githubConfig = pipelineConfig.github;

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              enabled: githubConfig?.enabled ?? false,
              logged_in: cachedAuth !== null,
              user_login: cachedAuth?.userLogin ?? null,
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

  // --- Evolution Tools ---

  server.tool(
    'mosaic_evolution_list',
    'List evolution proposals. Optionally filter by status (pending/approved/rejected) or show all.',
    {
      status: z.enum(['pending', 'approved', 'rejected', 'all']).optional().describe('Filter by status (default: all)'),
    },
    async ({ status }) => {
      try {
        const logger = new Logger('mcp-evolution');
        const engine = new EvolutionEngine(new StubProvider(), logger);
        const state = engine.loadState();
        await logger.close();

        let proposals = state.proposals;
        if (status && status !== 'all') {
          proposals = proposals.filter((p) => p.status === status);
        }

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ proposals: proposals.map((p) => ({
              id: p.id,
              type: p.type,
              agentStage: p.agentStage,
              reason: p.reason,
              status: p.status,
              createdAt: p.createdAt,
              resolvedAt: p.resolvedAt,
            })) }),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }) }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    'mosaic_evolution_approve',
    'Approve a pending evolution proposal by ID.',
    {
      proposal_id: z.string().describe('The proposal ID to approve'),
    },
    async ({ proposal_id }) => {
      try {
        const logger = new Logger('mcp-evolution');
        const engine = new EvolutionEngine(new StubProvider(), logger);
        const state = engine.loadState();
        await logger.close();

        const proposal = state.proposals.find((p) => p.id === proposal_id);
        if (!proposal) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ error: `Proposal ${proposal_id} not found` }) }], isError: true };
        }
        if (proposal.status !== 'pending') {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ error: `Proposal is already ${proposal.status}` }) }], isError: true };
        }

        // Apply the proposal
        if (proposal.type === 'prompt_modification') {
          const { applyPromptVersion } = await import('../evolution/prompt-versioning.js');
          applyPromptVersion(proposal.agentStage, proposal.proposedContent, proposal.id);
        } else if (proposal.type === 'skill_creation') {
          const { persistSkill } = await import('../evolution/skill-manager.js');
          persistSkill(proposal);
        }

        proposal.status = 'approved';
        proposal.resolvedAt = new Date().toISOString();
        proposal.resolvedBy = 'mcp';
        engine.saveState(state);

        return { content: [{ type: 'text' as const, text: JSON.stringify({ status: 'approved', proposal_id }) }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }) }], isError: true };
      }
    }
  );

  server.tool(
    'mosaic_evolution_reject',
    'Reject a pending evolution proposal by ID with an optional reason.',
    {
      proposal_id: z.string().describe('The proposal ID to reject'),
      reason: z.string().optional().describe('Reason for rejection'),
    },
    async ({ proposal_id, reason }) => {
      try {
        const logger = new Logger('mcp-evolution');
        const engine = new EvolutionEngine(new StubProvider(), logger);
        const state = engine.loadState();
        await logger.close();

        const proposal = state.proposals.find((p) => p.id === proposal_id);
        if (!proposal) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ error: `Proposal ${proposal_id} not found` }) }], isError: true };
        }
        if (proposal.status !== 'pending') {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ error: `Proposal is already ${proposal.status}` }) }], isError: true };
        }

        proposal.status = 'rejected';
        proposal.resolvedAt = new Date().toISOString();
        proposal.rejectionReason = reason;
        engine.saveState(state);

        return { content: [{ type: 'text' as const, text: JSON.stringify({ status: 'rejected', proposal_id }) }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }) }], isError: true };
      }
    }
  );

  server.tool(
    'mosaic_evolution_history',
    'View prompt version history for a specific agent stage.',
    {
      agent_stage: z.enum(STAGE_NAMES).describe('The agent stage to view history for'),
    },
    async ({ agent_stage }) => {
      try {
        const versions = listPromptVersions(agent_stage as StageName);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ agent_stage, versions }) }],
        };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }) }], isError: true };
      }
    }
  );

  server.tool(
    'mosaic_evolution_rollback',
    'Rollback an agent prompt to a previous version.',
    {
      agent_stage: z.enum(STAGE_NAMES).describe('The agent stage to rollback'),
      version: z.number().int().min(1).describe('The version number to rollback to'),
    },
    async ({ agent_stage, version }) => {
      try {
        rollbackPrompt(agent_stage as StageName, version);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ status: 'rolled_back', agent_stage, version }) }],
        };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }) }], isError: true };
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
