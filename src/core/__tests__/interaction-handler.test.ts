import { describe, it, expect } from 'vitest';
import { DeferredInteractionHandler } from '../interaction-handler.js';

describe('DeferredInteractionHandler', () => {
  it('should store and retrieve clarification meta with options', async () => {
    const handler = new DeferredInteractionHandler();

    const options = [
      { label: 'Option A', description: 'First choice' },
      { label: 'Option B', description: 'Second choice' },
    ];

    // Start clarification (don't await — it blocks)
    const clarificationPromise = handler.onClarification(
      'ui_designer', 'Pick a style:', 'run-1', options, true
    );

    // Meta should be available immediately
    const meta = handler.getClarificationMeta('run-1');
    expect(meta).toBeDefined();
    expect(meta!.question).toBe('Pick a style:');
    expect(meta!.options).toHaveLength(2);
    expect(meta!.options![0].label).toBe('Option A');
    expect(meta!.allowCustom).toBe(true);

    // Answer the clarification
    handler.answerClarification('run-1', 'Option A');
    const answer = await clarificationPromise;
    expect(answer).toBe('Option A');

    // Meta should be cleaned up
    expect(handler.getClarificationMeta('run-1')).toBeUndefined();
  });

  it('should handle clarification without options (backward compatible)', async () => {
    const handler = new DeferredInteractionHandler();

    const clarificationPromise = handler.onClarification(
      'researcher', 'What domain?', 'run-2'
    );

    const meta = handler.getClarificationMeta('run-2');
    expect(meta).toBeDefined();
    expect(meta!.question).toBe('What domain?');
    expect(meta!.options).toBeUndefined();
    expect(meta!.allowCustom).toBeUndefined();

    handler.answerClarification('run-2', 'E-commerce');
    const answer = await clarificationPromise;
    expect(answer).toBe('E-commerce');
  });

  it('should report pending clarification status', async () => {
    const handler = new DeferredInteractionHandler();

    expect(handler.hasPendingClarification('run-3')).toBe(false);

    const _promise = handler.onClarification(
      'ux_designer', 'Flow question', 'run-3',
      [{ label: 'A' }, { label: 'B' }]
    );

    expect(handler.hasPendingClarification('run-3')).toBe(true);

    handler.answerClarification('run-3', 'A');
    expect(handler.hasPendingClarification('run-3')).toBe(false);
  });
});
