import type { AgentContext } from '../types.js';
import type { PostRunHook, AgentHookResult } from '../agent.js';
import { readManifest, type PrdManifest } from '../manifest.js';

/**
 * Per-stage feature coverage check: compares PRD feature list against
 * the stage manifest's covers_features field.
 * Gaps are recorded but hook is warn-only (not mandatory) --
 * coverage gaps are informational, not blocking.
 */
export function createFeatureCoverageCheckHook(
  manifestName: string,
  extractCoveredFeatures: (data: unknown) => Set<string>,
): PostRunHook {
  return {
    name: 'feature-coverage-check',
    mandatory: false, // coverage gaps are informational
    async execute(_context: AgentContext, _output: string): Promise<AgentHookResult> {
      // Read PRD features
      let allFeatureIds: string[];
      try {
        const prd = readManifest<PrdManifest>('prd.manifest.json');
        allFeatureIds = prd.features.map(f => f.id);
      } catch {
        return { pass: true, message: 'prd.manifest.json not available -- skipping coverage check' };
      }
      if (allFeatureIds.length === 0) {
        return { pass: true, message: 'No features in PRD -- skipping' };
      }

      // Read target manifest
      let covered: Set<string>;
      try {
        const data = readManifest(manifestName);
        covered = extractCoveredFeatures(data);
      } catch {
        return { pass: true, message: `${manifestName} not available -- skipping coverage check` };
      }

      const gaps = allFeatureIds.filter(id => !covered.has(id));
      if (gaps.length > 0) {
        return {
          pass: false,
          message: `Feature coverage gaps in ${manifestName}: ${gaps.join(', ')} (${gaps.length}/${allFeatureIds.length} features uncovered)`,
        };
      }
      return { pass: true, message: `All ${allFeatureIds.length} features covered` };
    },
  };
}
