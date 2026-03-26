import fs from 'node:fs';
import type { AgentContext, StageName, ClarificationOption } from '../core/types.js';
import { IntentBriefSchema } from '../core/types.js';
import { BaseAgent } from '../core/agent.js';
import type { RunContext } from '../core/run-context.js';
import type { InteractionHandler } from '../core/interaction-handler.js';

const PROMPT_PATH = '.claude/agents/mosaic/intent-consultant.md';
const MAX_ROUNDS = 3;

interface ConsultantResponse {
  questions?: Array<{ question: string; options: string[] }>;
  intent_brief?: Record<string, unknown>;
  ready_to_converge: boolean;
}

const CONSULTANT_SCHEMA = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          options: { type: 'array', items: { type: 'string' } },
        },
        required: ['question', 'options'],
      },
      description: 'Questions to ask the user. Omit if ready to converge.',
    },
    intent_brief: {
      type: 'object',
      description: 'The final Intent Brief. Only include when ready_to_converge is true.',
    },
    ready_to_converge: {
      type: 'boolean',
      description: 'True if enough information to produce a good Intent Brief.',
    },
  },
  required: ['ready_to_converge'],
};

export class IntentConsultantAgent extends BaseAgent {
  private interactionHandler: InteractionHandler;

  constructor(
    stage: StageName,
    ctx: RunContext,
    interactionHandler: InteractionHandler,
  ) {
    super(stage, ctx);
    this.interactionHandler = interactionHandler;
  }

  protected async run(context: AgentContext): Promise<void> {
    let systemPrompt: string;
    try {
      systemPrompt = fs.readFileSync(PROMPT_PATH, 'utf-8');
    } catch {
      systemPrompt = 'You are the Intent Consultant. Help clarify the user\'s product idea.';
    }

    const instruction = context.task.instruction;
    const conversationHistory: string[] = [];
    conversationHistory.push(`## User Instruction\n${instruction}`);

    for (let round = 0; round < MAX_ROUNDS; round++) {
      const prompt = conversationHistory.join('\n\n');

      this.logger.agent(this.stage, 'info', 'consultant:call', {
        round,
        promptLength: prompt.length,
      });
      this.ctx.eventBus.emit('agent:thinking', this.stage, prompt.length);

      const response = await this.provider.call(prompt, {
        systemPrompt,
        jsonSchema: CONSULTANT_SCHEMA,
      });

      this.logger.agent(this.stage, 'info', 'consultant:response', {
        round,
        responseLength: response.content.length,
      });
      this.ctx.eventBus.emit('agent:response', this.stage, response.content.length);

      let parsed: ConsultantResponse;
      try {
        parsed = JSON.parse(response.content);
      } catch {
        this.logger.agent(this.stage, 'warn', 'consultant:json-parse-failed', {
          round,
        });
        // Treat as converged with raw content as the brief
        parsed = { ready_to_converge: true, intent_brief: { problem: instruction, target_users: 'unknown', core_scenarios: [], mvp_boundary: instruction, constraints: [], domain_specifics: [], recommended_profile: 'design-only', profile_reason: 'Default fallback' } };
      }

      // Check if converged or has final brief (but force at least 1 round of questions)
      if (round > 0 && parsed.ready_to_converge && parsed.intent_brief) {
        this.writeBrief(parsed.intent_brief);
        return;
      }

      // Force questions on first round if LLM didn't provide any
      if (round === 0 && (!parsed.questions || parsed.questions.length === 0)) {
        parsed.questions = [
          { question: '目标用户是谁？', options: ['个人用户', '企业用户', '开发者', '其他'] },
          { question: '目标平台是什么？', options: ['Web 网页', '移动端 App', '桌面应用', '跨平台'] },
          { question: 'MVP 最核心的功能是什么？（可多选或自定义）', options: ['基础 CRUD', '用户认证', '数据可视化', '其他'] },
        ];
      }

      // Ask questions
      if (parsed.questions && parsed.questions.length > 0) {
        const answers: string[] = [];

        for (const q of parsed.questions) {
          const options: ClarificationOption[] = q.options.map((opt) => ({
            label: opt,
          }));

          const answer = await this.interactionHandler.onClarification(
            this.stage,
            q.question,
            context.task.runId,
            options,
            true, // allowCustom
          );

          // Check for early convergence signal
          if (answer.toLowerCase() === '开始' || answer.toLowerCase() === 'start') {
            this.logger.agent(this.stage, 'info', 'consultant:early-convergence', { round });
            // Ask LLM to produce brief with what we have
            conversationHistory.push(`## User Answers (Round ${round + 1})\n${answers.map((a, i) => `Q${i + 1}: ${a}`).join('\n')}\n\nUser requested early convergence — produce the Intent Brief now.`);
            const finalResponse = await this.provider.call(
              conversationHistory.join('\n\n'),
              { systemPrompt, jsonSchema: CONSULTANT_SCHEMA },
            );
            try {
              const finalParsed = JSON.parse(finalResponse.content) as ConsultantResponse;
              if (finalParsed.intent_brief) {
                this.writeBrief(finalParsed.intent_brief);
                return;
              }
            } catch {
              // Fall through to default brief
            }
            break;
          }

          answers.push(answer);
        }

        conversationHistory.push(
          `## User Answers (Round ${round + 1})\n${parsed.questions.map((q, i) => `Q: ${q.question}\nA: ${answers[i]}`).join('\n\n')}`
        );
      }
    }

    // Max rounds reached — force convergence
    this.logger.agent(this.stage, 'info', 'consultant:max-rounds-reached');
    conversationHistory.push('\nMaximum dialogue rounds reached. Produce the Intent Brief now with available information.');

    const finalResponse = await this.provider.call(
      conversationHistory.join('\n\n'),
      { systemPrompt, jsonSchema: CONSULTANT_SCHEMA },
    );

    try {
      const finalParsed = JSON.parse(finalResponse.content) as ConsultantResponse;
      if (finalParsed.intent_brief) {
        this.writeBrief(finalParsed.intent_brief);
        return;
      }
    } catch {
      // Fall through
    }

    // Ultimate fallback
    const fallbackBrief = {
      problem: context.task.instruction,
      target_users: 'To be determined',
      core_scenarios: [],
      mvp_boundary: context.task.instruction,
      constraints: [],
      domain_specifics: [],
      recommended_profile: 'design-only',
      profile_reason: 'Default — insufficient information for recommendation',
    };
    this.writeBrief(fallbackBrief);
  }

  private writeBrief(data: Record<string, unknown>): void {
    // Validate against schema
    const brief = IntentBriefSchema.parse(data);
    this.writeOutput('intent-brief.json', JSON.stringify(brief, null, 2));
    this.logger.agent(this.stage, 'info', 'consultant:brief-written', {
      profile: brief.recommended_profile,
      scenarioCount: brief.core_scenarios.length,
    });
  }
}
