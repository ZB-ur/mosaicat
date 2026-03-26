import { describe, it, expect } from 'vitest';
import { freezeConfig } from '../run-context.js';
import type { PipelineConfig } from '../types.js';

function makeConfig(): PipelineConfig {
  return {
    stages: {},
    pipeline: { max_retries_per_stage: 3, snapshot: 'on' },
    security: { initiator: 'cli', reject_policy: 'block' },
    github: {
      enabled: false,
      poll_interval_ms: 5000,
      poll_timeout_ms: 300000,
      approve_keywords: ['approve'],
      reject_keywords: ['reject'],
    },
  };
}

describe('freezeConfig', () => {
  it('returns a deep clone that is frozen', () => {
    const original = makeConfig();
    const frozen = freezeConfig(original);
    expect(Object.isFrozen(frozen)).toBe(true);
  });

  it('mutating top-level property throws TypeError', () => {
    const frozen = freezeConfig(makeConfig());
    expect(() => {
      (frozen as Record<string, unknown>).pipeline = {};
    }).toThrow(TypeError);
  });

  it('mutating nested property throws TypeError (deep freeze)', () => {
    const frozen = freezeConfig(makeConfig());
    expect(() => {
      (frozen.github as Record<string, unknown>).enabled = true;
    }).toThrow(TypeError);
  });

  it('does not modify the original config object', () => {
    const original = makeConfig();
    const frozen = freezeConfig(original);
    // Original should still be mutable
    original.github.enabled = true;
    expect(original.github.enabled).toBe(true);
    // Frozen should still have the original value
    expect(frozen.github.enabled).toBe(false);
  });

  it('freezes arrays within config', () => {
    const frozen = freezeConfig(makeConfig());
    expect(() => {
      (frozen.github.approve_keywords as string[]).push('lgtm');
    }).toThrow(TypeError);
  });
});
