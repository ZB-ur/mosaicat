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
  console.log('\n━━━ Mosaicat Evolve ━━━\n');

  // Load failure stats from retry-log
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const stats = getFailureStats(thirtyDaysAgo);

  if (stats.length === 0) {
    console.log('No retry data found in .mosaic/retry-log.jsonl (last 30 days).');
    console.log('Run some pipelines first — retry events will be logged automatically.\n');
    return;
  }

  // Display failure pattern table
  console.log(`Analyzing retry-log.jsonl (last 30 days)...\n`);
  printFailureTable(stats);

  // Show sample errors for top patterns
  const topPatterns = stats.slice(0, 4);
  for (let i = 0; i < topPatterns.length; i++) {
    const stat = topPatterns[i];
    if (stat.sampleErrors.length > 0) {
      console.log(`\nSample errors for #${i + 1} (${stat.errorCategory}):`);
      for (const err of stat.sampleErrors) {
        console.log(`  • ${err.slice(0, 120)}`);
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
    console.log('\nExiting.\n');
    return;
  }

  // Generate proposals via LLM
  console.log('\nGenerating proposals... (1 LLM call)\n');

  const pipelineConfig = yaml.load(
    fs.readFileSync('config/pipeline.yaml', 'utf-8'),
  ) as PipelineConfig;
  const provider = createProvider(pipelineConfig);
  const logger = new Logger('evolve');

  const proposals = await generateProposals(provider, stats);

  if (proposals.length === 0) {
    console.log('No proposals generated. The LLM found no actionable patterns.\n');
    await logger.close();
    return;
  }

  console.log(`━━━ Proposals (${proposals.length}) ━━━\n`);

  // Interactive review
  let approved = 0;
  let rejected = 0;

  for (let i = 0; i < proposals.length; i++) {
    const proposal = proposals[i];
    console.log(`[${i + 1}/${proposals.length}] 📦 ${proposal.name}`);
    console.log(`  Scope:   ${proposal.scope} → ${proposal.agents.join(', ')}`);
    console.log(`  Trigger: ${proposal.trigger}`);
    console.log(`  Evidence: ${proposal.evidence}`);
    console.log(`  ┌${'─'.repeat(48)}┐`);
    const contentLines = proposal.content.split('\n').slice(0, 5);
    for (const line of contentLines) {
      console.log(`  │ ${line.padEnd(46).slice(0, 46)} │`);
    }
    if (proposal.content.split('\n').length > 5) {
      console.log(`  │ ${'...'.padEnd(46)} │`);
    }
    console.log(`  └${'─'.repeat(48)}┘`);

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
      console.log('\n' + proposal.content + '\n');
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
        console.log(`✓ Wrote config/skills/builtin/${proposal.name}/SKILL.md\n`);
      } else {
        rejected++;
        console.log(`✗ Rejected: ${proposal.name}\n`);
      }
    } else if (action === 'edit') {
      const edited = await input({
        message: 'Enter updated content (or press Enter to keep original):',
        default: proposal.content,
      });
      proposal.content = edited || proposal.content;
      writeSkill(proposal);
      approved++;
      console.log(`✓ Wrote config/skills/builtin/${proposal.name}/SKILL.md\n`);
    } else if (action === 'approve') {
      writeSkill(proposal);
      approved++;
      console.log(`✓ Wrote config/skills/builtin/${proposal.name}/SKILL.md\n`);
    } else {
      rejected++;
      console.log(`✗ Rejected: ${proposal.name}\n`);
    }
  }

  console.log(`\nSummary: ${approved} skill(s) created, ${rejected} rejected\n`);
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
    console.error(`LLM call failed: ${err instanceof Error ? err.message : String(err)}`);
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
  console.log('┌──────────────────────────────────────────────────────────┐');
  console.log('│ Top Failure Patterns                                     │');
  console.log('│                                                          │');
  console.log('│ #  Stage          Category        Count  Avg Rds  Resolved│');

  for (let i = 0; i < rows.length; i++) {
    const s = rows[i];
    const num = String(i + 1).padEnd(2);
    const stage = s.stage.padEnd(14);
    const cat = s.errorCategory.padEnd(15);
    const count = String(s.count).padEnd(6);
    const avg = String(s.avgAttempts).padEnd(8);
    const resolved = `${Math.round(s.resolvedRate * 100)}%`.padEnd(5);
    console.log(`│ ${num} ${stage} ${cat} ${count} ${avg} ${resolved}   │`);
  }

  console.log('└──────────────────────────────────────────────────────────┘');
}
