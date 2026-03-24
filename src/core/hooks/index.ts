import type { StageName } from '../types.js';
import type { PreRunHook, PostRunHook } from '../agent.js';
import { constitutionPreRunHook, constitutionPostRunHook } from './constitution-compliance.js';
import { placeholderCheckHook } from './placeholder-check.js';
import { createTraceabilityCheckHook } from './traceability-check.js';

export interface StageHooks {
  preRun: PreRunHook[];
  postRun: PostRunHook[];
}

/**
 * Returns the pre-run and post-run hooks configured for a given stage.
 * Hooks are registered per-stage based on what quality checks apply.
 */
export function getHooksForStage(stage: StageName): StageHooks {
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
      break;

    case 'coder':
      postRun.push(placeholderCheckHook);
      postRun.push(createTraceabilityCheckHook(/* featureIds */ false, /* taskIds */ true));
      break;

    case 'ui_designer':
      postRun.push(placeholderCheckHook);
      break;

    case 'ux_designer':
      postRun.push(createTraceabilityCheckHook(/* featureIds */ true, /* taskIds */ false));
      break;

    case 'api_designer':
      postRun.push(createTraceabilityCheckHook(/* featureIds */ true, /* taskIds */ false));
      break;
  }

  return { preRun, postRun };
}

export { constitutionPreRunHook, constitutionPostRunHook } from './constitution-compliance.js';
export { placeholderCheckHook } from './placeholder-check.js';
export { createTraceabilityCheckHook } from './traceability-check.js';
