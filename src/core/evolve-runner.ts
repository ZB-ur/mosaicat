import { select, input } from '@inquirer/prompts';
import fs from 'node:fs';
import yaml from 'js-yaml';
import type { PipelineConfig } from './types.js';
import type { LLMProvider } from './llm-provider.js';
import { createProvider } from './provider-factory.js';
import { Logger } from './logger.js';
import { getFailureStats, type FailureStat } from './retry-log.js';
import type { EvolutionProposal, SkillMetadata } from '../evolution/types.js';
import { persistSkill } from '../evolution/skill-manager.js';
import type { StageName } from './types.js';

interface SkillProposal {
  name: string;
  scope: 'shared' | 'private';
  agents: string[];
  trigger: string;
  evidence: string;
  content: string;
}

const EVOLVE_ANALYST_PROMPT = `You are a skill extraction analyst for an AI agent pipeline called Mosaicat.

You will receive failure statistics from the retry-log — real data about errors that occurred during pipeline runs.

Based on these patterns, generate SKILL.md proposals that would prevent or reduce these failures.

Each proposal should:
- name: kebab-case skill name
- scope: "shared" (useful across agents) or "private" (one agent only)
- agents: which stage(s) benefit (e.g. ["coder"], ["coder", "tech_lead"])
- trigger: keyword match for when to load (e.g. "form validation typescript")
- evidence: summary from the statistics you were given
- content: the actual rules/patterns in markdown that would help prevent these errors

Return a JSON array of proposals. If no proposals are needed, return [].

Example:
[
  {
    "name": "strict-typescript-imports",
    "scope": "shared",
    "agents": ["coder", "tech_lead"],
    "trigger": "typescript import module",
    "evidence": "12 import-error occurrences in coder stage, 75% resolved after avg 2.3 rounds",
    "content": "## Rules\\n- Always use relative imports with .js extension for local modules\\n- Check tsconfig.json paths before importing"
  }
]`;

/**
 * Run the interactive `mosaicat evolve` command.
 * Analyzes retry-log data, generates skill proposals via LLM, and lets user approve/reject.
 */
export async function runEvolve(): Promise<void> {
  process.stdout.write('\n━━━ Mosaicat Evolve ━━━\n');

  // Load failure stats from retry-log
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const stats = getFailureStats(thirtyDaysAgo);

  if (stats.length === 0) {
    process.stdout.write('No retry data found in .mosaic/retry-log.jsonl (last 30 days).\n');
    process.stdout.write('Run some pipelines first — retry events will be logged automatically.\n\n');
    return;
  }

  // Display failure pattern table
  process.stdout.write(`Analyzing retry-log.jsonl (last 30 days)...\n`);
  printFailureTable(stats);

  // Show sample errors for top patterns
  const topPatterns = stats.slice(0, 4);
  for (let i = 0; i < topPatterns.length; i++) {
    const stat = topPatterns[i];
    if (stat.sampleErrors.length > 0) {
      process.stdout.write(`\nSample errors for #${i + 1} (${stat.errorCategory}):\n`);
      for (const err of stat.sampleErrors) {
        process.stdout.write(`  • ${err.slice(0, 120)}\n`);
      }
    }
  }

  // Ask user if they want to generate proposals
  const shouldGenerate = await select({
    message: 'Generate skill proposals from these patterns?',
    choices: [
      { value: true, name: 'Yes — call LLM to generate proposals' },
      { value: false, name: 'No — exit' },
    ],
  });

  if (!shouldGenerate) {
    process.stdout.write('\nExiting.\n');
    return;
  }

  // Generate proposals via LLM
  process.stdout.write('\nGenerating proposals... (1 LLM call)\n');

  const pipelineConfig = yaml.load(
    fs.readFileSync('config/pipeline.yaml', 'utf-8'),
  ) as PipelineConfig;
  const provider = createProvider(pipelineConfig);
  const logger = new Logger('evolve');

  const proposals = await generateProposals(provider, stats);

  if (proposals.length === 0) {
    process.stdout.write('No proposals generated. The LLM found no actionable patterns.\n');
    await logger.close();
    return;
  }

  process.stdout.write(`━━━ Proposals (${proposals.length}) ━━━\n`);

  // Interactive review
  let approved = 0;
  let rejected = 0;

  for (let i = 0; i < proposals.length; i++) {
    const proposal = proposals[i];
    process.stdout.write(`[${i + 1}/${proposals.length}] 📦 ${proposal.name}\n`);
    process.stdout.write(`  Scope:   ${proposal.scope} → ${proposal.agents.join(', ')}\n`);
    process.stdout.write(`  Trigger: ${proposal.trigger}\n`);
    process.stdout.write(`  Evidence: ${proposal.evidence}\n`);
    process.stdout.write(`  ┌${'─'.repeat(48)}┐\n`);
    const contentLines = proposal.content.split('\n').slice(0, 5);
    for (const line of contentLines) {
      process.stdout.write(`  │ ${line.padEnd(46).slice(0, 46)} │\n`);
    }
    if (proposal.content.split('\n').length > 5) {
      process.stdout.write(`  │ ${'...'.padEnd(46)} │\n`);
    }
    process.stdout.write(`  └${'─'.repeat(48)}┘\n`);

    const action = await select({
      message: 'Action:',
      choices: [
        { value: 'approve', name: '✅ Approve — write to config/skills/builtin/' },
        { value: 'edit', name: '✏️  Edit — modify content before saving' },
        { value: 'details', name: '🔍 Details — show full content' },
        { value: 'reject', name: '❌ Reject — skip this proposal' },
      ],
    });

    if (action === 'details') {
      process.stdout.write('\n' + proposal.content + '\n');
      const afterDetails = await select({
        message: 'After review:',
        choices: [
          { value: 'approve', name: '✅ Approve' },
          { value: 'reject', name: '❌ Reject' },
        ],
      });
      if (afterDetails === 'approve') {
        writeSkill(proposal);
        approved++;
        process.stdout.write(`✓ Wrote config/skills/builtin/${proposal.name}/SKILL.md\n`);
      } else {
        rejected++;
        process.stdout.write(`✗ Rejected: ${proposal.name}\n`);
      }
    } else if (action === 'edit') {
      const edited = await input({
        message: 'Enter updated content (or press Enter to keep original):',
        default: proposal.content,
      });
      proposal.content = edited || proposal.content;
      writeSkill(proposal);
      approved++;
      process.stdout.write(`✓ Wrote config/skills/builtin/${proposal.name}/SKILL.md\n`);
    } else if (action === 'approve') {
      writeSkill(proposal);
      approved++;
      process.stdout.write(`✓ Wrote config/skills/builtin/${proposal.name}/SKILL.md\n`);
    } else {
      rejected++;
      process.stdout.write(`✗ Rejected: ${proposal.name}\n`);
    }
  }

  process.stdout.write(`\nSummary: ${approved} skill(s) created, ${rejected} rejected\n`);
  await logger.close();
}

async function generateProposals(
  provider: LLMProvider,
  stats: FailureStat[],
): Promise<SkillProposal[]> {
  const statsText = stats.map((s, i) => {
    const samples = s.sampleErrors.map(e => `- ${e.slice(0, 200)}`).join('\n');
    return `Pattern ${i + 1}: ${s.stage} / ${s.errorCategory} (${s.count} occurrences, avg ${s.avgAttempts} rounds, ${Math.round(s.resolvedRate * 100)}% resolved)\nSample errors:\n${samples}`;
  }).join('\n\n');

  const prompt = `## Retry Statistics (from .mosaic/retry-log.jsonl)\n\n${statsText}\n\n## Task\n\nGenerate SKILL.md proposals to prevent these failure patterns.`;

  try {
    const response = await provider.call(prompt, {
      systemPrompt: EVOLVE_ANALYST_PROMPT,
    });

    let jsonStr = response.content.trim();
    const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1].trim();
    }

    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(
      (p: unknown): p is SkillProposal =>
        typeof p === 'object' &&
        p !== null &&
        typeof (p as SkillProposal).name === 'string' &&
        typeof (p as SkillProposal).content === 'string',
    );
  } catch (err) {
    process.stderr.write(`LLM call failed: ${err instanceof Error ? err.message : String(err)}\n`);
    return [];
  }
}

function writeSkill(proposal: SkillProposal): void {
  const proposalId = `evolve-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const targetAgent = (proposal.agents[0] ?? 'coder') as StageName;

  const skillMetadata: SkillMetadata = {
    name: proposal.name,
    scope: proposal.scope,
    description: proposal.evidence,
    trigger: proposal.trigger,
  };

  const evoProposal: EvolutionProposal = {
    id: proposalId,
    type: 'skill_creation',
    agentStage: targetAgent,
    runId: 'evolve-cli',
    reason: proposal.evidence,
    proposedContent: proposal.content,
    status: 'approved',
    createdAt: new Date().toISOString(),
    resolvedAt: new Date().toISOString(),
    resolvedBy: 'user',
    skillMetadata,
  };

  persistSkill(evoProposal);
}

function printFailureTable(stats: FailureStat[]): void {
  const rows = stats.slice(0, 10);
  process.stdout.write('┌──────────────────────────────────────────────────────────┐\n');
  process.stdout.write('│ Top Failure Patterns                                     │\n');
  process.stdout.write('│                                                          │\n');
  process.stdout.write('│ #  Stage          Category        Count  Avg Rds  Resolved│\n');

  for (let i = 0; i < rows.length; i++) {
    const s = rows[i];
    const num = String(i + 1).padEnd(2);
    const stage = s.stage.padEnd(14);
    const cat = s.errorCategory.padEnd(15);
    const count = String(s.count).padEnd(6);
    const avg = String(s.avgAttempts).padEnd(8);
    const resolved = `${Math.round(s.resolvedRate * 100)}%`.padEnd(5);
    process.stdout.write(`│ ${num} ${stage} ${cat} ${count} ${avg} ${resolved}   │\n`);
  }

  process.stdout.write('└──────────────────────────────────────────────────────────┘\n');
}
