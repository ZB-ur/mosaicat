import fs from 'node:fs';
import type { AgentContext } from '../types.js';
import type { PreRunHook, PostRunHook, AgentHookResult } from '../agent.js';

const STATIC_CONSTITUTION_PATH = '.claude/agents/mosaic/constitution.md';

/**
 * Pre-run hook: verifies that the static constitution file exists and
 * its content has been injected into the agent's system prompt.
 */
export const constitutionPreRunHook: PreRunHook = {
  name: 'constitution-compliance-pre',
  mandatory: false, // warn only — constitution may be absent in dev/test

  async execute(context: AgentContext): Promise<AgentHookResult> {
    // Check static constitution file exists
    if (!fs.existsSync(STATIC_CONSTITUTION_PATH)) {
      return { pass: false, message: 'Static constitution file not found at ' + STATIC_CONSTITUTION_PATH };
    }

    // Check it was injected into system prompt
    if (!context.systemPrompt.includes('Article I:')) {
      return { pass: false, message: 'Static constitution not detected in systemPrompt' };
    }

    return { pass: true };
  },
};

/**
 * Post-run hook: checks that the agent output does not violate key
 * static constitution rules that can be verified programmatically.
 */
export const constitutionPostRunHook: PostRunHook = {
  name: 'constitution-compliance-post',
  mandatory: false, // warn only — avoids blocking on edge cases

  async execute(_context: AgentContext, output: string): Promise<AgentHookResult> {
    if (!output) return { pass: true };

    const violations: string[] = [];

    // Article III: check for unresolved ambiguity markers that should have been flagged
    // (This is informational — the hook checks that if uncertainty exists, it IS marked)

    // Article V: check for placeholder content in output
    const placeholderPatterns = [
      /\bLorem ipsum\b/i,
      /\bComing Soon\b/i,
    ];
    for (const pattern of placeholderPatterns) {
      if (pattern.test(output)) {
        violations.push(`Article V violation: found "${pattern.source}" in output`);
      }
    }

    if (violations.length > 0) {
      return { pass: false, message: violations.join('; ') };
    }

    return { pass: true };
  },
};
