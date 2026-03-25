import type { AgentContext } from '../types.js';
import type { PostRunHook, AgentHookResult } from '../agent.js';

const F_ID_PATTERN = /F-\d{3}/g;
const T_ID_PATTERN = /T-\d{3}/g;

/**
 * Post-run hook: verifies F-NNN / T-NNN traceability IDs are present
 * in agent output, per Article VI of the Static Constitution.
 *
 * Applied to: ProductOwner (F-NNN required), TechLead (F-NNN + T-NNN),
 * Coder (T-NNN coverage).
 */
export function createTraceabilityCheckHook(
  requireFeatureIds: boolean,
  requireTaskIds: boolean,
): PostRunHook {
  return {
    name: 'traceability-check',
    mandatory: false, // warn only — allows pipeline to continue

    async execute(_context: AgentContext, output: string): Promise<AgentHookResult> {
      if (!output) return { pass: true };

      const issues: string[] = [];

      if (requireFeatureIds) {
        const featureIds = output.match(F_ID_PATTERN);
        if (!featureIds || featureIds.length === 0) {
          issues.push('No F-NNN feature IDs found in output (Article VI)');
        }
      }

      if (requireTaskIds) {
        const taskIds = output.match(T_ID_PATTERN);
        if (!taskIds || taskIds.length === 0) {
          issues.push('No T-NNN task IDs found in output (Article VI)');
        }
      }

      if (issues.length > 0) {
        return { pass: false, message: issues.join('; ') };
      }

      return { pass: true };
    },
  };
}
