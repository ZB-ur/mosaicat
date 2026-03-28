import { describe, it, expect } from 'vitest';
import { getHooksForStage } from '../hooks/index.js';

describe('getHooksForStage', () => {
  it('should return placeholderCheckHook as mandatory for ui_designer', () => {
    const hooks = getHooksForStage('ui_designer');
    const placeholderHook = hooks.postRun.find(h => h.name === 'placeholder-check');
    expect(placeholderHook).toBeDefined();
    expect(placeholderHook!.mandatory).toBe(true);
  });

  it('should return placeholderCheckHook as non-mandatory for coder', () => {
    const hooks = getHooksForStage('coder');
    const placeholderHook = hooks.postRun.find(h => h.name === 'placeholder-check');
    expect(placeholderHook).toBeDefined();
    expect(placeholderHook!.mandatory).toBe(false);
  });

  it('should return traceabilityCheckHook for product_owner', () => {
    const hooks = getHooksForStage('product_owner');
    const traceHook = hooks.postRun.find(h => h.name === 'traceability-check');
    expect(traceHook).toBeDefined();
  });

  it('should return constitution hooks for all stages', () => {
    const stages = ['researcher', 'product_owner', 'coder', 'ui_designer'] as const;
    for (const stage of stages) {
      const hooks = getHooksForStage(stage);
      const preConst = hooks.preRun.find(h => h.name === 'constitution-compliance-pre');
      const postConst = hooks.postRun.find(h => h.name === 'constitution-compliance-post');
      expect(preConst, `${stage} missing constitution pre-run hook`).toBeDefined();
      expect(postConst, `${stage} missing constitution post-run hook`).toBeDefined();
    }
  });

  it('should return traceabilityCheckHook for tech_lead', () => {
    const hooks = getHooksForStage('tech_lead');
    const traceHook = hooks.postRun.find(h => h.name === 'traceability-check');
    expect(traceHook).toBeDefined();
  });

  it('should not have mandatory placeholderCheckHook for coder', () => {
    const hooks = getHooksForStage('coder');
    const placeholderHook = hooks.postRun.find(h => h.name === 'placeholder-check');
    expect(placeholderHook).toBeDefined();
    expect(placeholderHook!.mandatory).not.toBe(true);
  });
});
