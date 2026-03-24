import type { AgentContext } from '../types.js';
import type { PostRunHook, AgentHookResult } from '../agent.js';

const PLACEHOLDER_PATTERNS = [
  /\bPlaceholder\b/,
  /\bTODO\b/,
  /\bFIXME\b/,
  /\bTBD\b/,
  /\bLorem ipsum\b/i,
  /\bComing Soon\b/i,
];

// Patterns that are acceptable in comments / non-user-visible code
const COMMENT_LINE = /^\s*(\/\/|\/\*|\*|#)/;

/**
 * Post-run hook for Coder/UIDesigner: scans output for placeholder content
 * that would violate Article V of the Static Constitution.
 */
export const placeholderCheckHook: PostRunHook = {
  name: 'placeholder-check',
  mandatory: false, // warn — Coder may have legitimate TODO comments in internal code

  async execute(_context: AgentContext, output: string): Promise<AgentHookResult> {
    if (!output) return { pass: true };

    const violations: string[] = [];
    const lines = output.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Skip comment lines (internal developer comments are acceptable per Article V)
      if (COMMENT_LINE.test(line)) continue;

      for (const pattern of PLACEHOLDER_PATTERNS) {
        if (pattern.test(line)) {
          violations.push(`Line ${i + 1}: found "${pattern.source}"`);
        }
      }
    }

    if (violations.length > 0) {
      return {
        pass: false,
        message: `Placeholder content detected (${violations.length} occurrences): ${violations.slice(0, 5).join('; ')}`,
      };
    }

    return { pass: true };
  },
};
