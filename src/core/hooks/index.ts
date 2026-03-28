import type { StageName } from '../types.js';
import type { PreRunHook, PostRunHook } from '../agent.js';
import type { CodeManifest, ComponentsManifest, UxFlowsManifest, ApiSpecManifest, TechSpecManifest } from '../manifest.js';
import { constitutionPreRunHook, constitutionPostRunHook } from './constitution-compliance.js';
import { placeholderCheckHook } from './placeholder-check.js';
import { createTraceabilityCheckHook } from './traceability-check.js';
import { createAstQualityGateHook } from './ast-quality-gate.js';
import { createFeatureCoverageCheckHook } from './feature-coverage-check.js';

export interface StageHooks {
  preRun: PreRunHook[];
  postRun: PostRunHook[];
}

/**
 * Returns the pre-run and post-run hooks configured for a given stage.
 * Hooks are registered per-stage based on what quality checks apply.
 *
 * @param stage - The pipeline stage name
 * @param artifactDir - Optional artifact directory path for hooks that need file system access
 */
export function getHooksForStage(stage: StageName, artifactDir?: string): StageHooks {
  const preRun: PreRunHook[] = [];
  const postRun: PostRunHook[] = [];

  // Constitution compliance — all stages
  preRun.push(constitutionPreRunHook);
  postRun.push(constitutionPostRunHook);

  // Stage-specific hooks
  switch (stage) {
    case 'product_owner':
      postRun.push(createTraceabilityCheckHook(/* featureIds */ true, /* taskIds */ false));
      break;

    case 'tech_lead':
      postRun.push(createTraceabilityCheckHook(/* featureIds */ true, /* taskIds */ true));
      if (artifactDir) {
        postRun.push(createFeatureCoverageCheckHook(
          'tech-spec.manifest.json',
          (data) => {
            const ids = new Set<string>();
            for (const m of (data as TechSpecManifest).modules) {
              for (const fid of m.covers_features) ids.add(fid);
            }
            return ids;
          },
        ));
      }
      break;

    case 'coder':
      postRun.push(placeholderCheckHook);
      postRun.push(createTraceabilityCheckHook(/* featureIds */ false, /* taskIds */ true));
      if (artifactDir) {
        postRun.push(createAstQualityGateHook(artifactDir));
        postRun.push(createFeatureCoverageCheckHook(
          'code.manifest.json',
          (data) => new Set((data as CodeManifest).covers_features),
        ));
      }
      break;

    case 'ui_designer':
      postRun.push(placeholderCheckHook);
      if (artifactDir) {
        postRun.push(createAstQualityGateHook(artifactDir));
        postRun.push(createFeatureCoverageCheckHook(
          'components.manifest.json',
          (data) => {
            const ids = new Set<string>();
            for (const c of (data as ComponentsManifest).components) {
              for (const f of c.covers_features) ids.add(f);
            }
            return ids;
          },
        ));
      }
      break;

    case 'ux_designer':
      postRun.push(createTraceabilityCheckHook(/* featureIds */ true, /* taskIds */ false));
      if (artifactDir) {
        postRun.push(createFeatureCoverageCheckHook(
          'ux-flows.manifest.json',
          (data) => {
            const ids = new Set<string>();
            for (const f of (data as UxFlowsManifest).flows) {
              for (const fid of f.covers_features) ids.add(fid);
            }
            return ids;
          },
        ));
      }
      break;

    case 'api_designer':
      postRun.push(createTraceabilityCheckHook(/* featureIds */ true, /* taskIds */ false));
      if (artifactDir) {
        postRun.push(createFeatureCoverageCheckHook(
          'api-spec.manifest.json',
          (data) => {
            const ids = new Set<string>();
            for (const ep of (data as ApiSpecManifest).endpoints) {
              for (const fid of ep.covers_features) ids.add(fid);
            }
            return ids;
          },
        ));
      }
      break;
  }

  return { preRun, postRun };
}

export { constitutionPreRunHook, constitutionPostRunHook } from './constitution-compliance.js';
export { placeholderCheckHook } from './placeholder-check.js';
export { createTraceabilityCheckHook } from './traceability-check.js';
export { createAstQualityGateHook } from './ast-quality-gate.js';
export { createFeatureCoverageCheckHook } from './feature-coverage-check.js';
