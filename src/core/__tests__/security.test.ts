import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  TrustLevel,
  loadSecurityConfig,
  isTrustedActor,
  assertTrustedActor,
  buildIssueBody,
} from '../security.js';
import type { PipelineConfig } from '../types.js';

const basePipelineConfig: PipelineConfig = {
  stages: {} as any,
  pipeline: { max_retries_per_stage: 3, snapshot: 'on_stage_complete' },
  security: { initiator: 'config-user', reject_policy: 'silent' },
  github: {
    enabled: false,
    poll_interval_ms: 10000,
    poll_timeout_ms: 3600000,
    approve_keywords: ['/approve'],
    reject_keywords: ['/reject'],
  },
};

describe('Security', () => {
  describe('TrustLevel', () => {
    it('should have correct ordering', () => {
      expect(TrustLevel.Initiator).toBeLessThan(TrustLevel.Orchestrator);
      expect(TrustLevel.Orchestrator).toBeLessThan(TrustLevel.Agent);
      expect(TrustLevel.Agent).toBeLessThan(TrustLevel.External);
    });
  });

  describe('loadSecurityConfig', () => {
    it('should use explicit initiatorLogin over config', () => {
      const config = loadSecurityConfig(basePipelineConfig, 'oauth-user');
      expect(config.initiatorLogin).toBe('oauth-user');
      expect(config.rejectPolicy).toBe('silent');
    });

    it('should fall back to config when no override provided', () => {
      const config = loadSecurityConfig(basePipelineConfig);
      expect(config.initiatorLogin).toBe('config-user');
    });
  });

  describe('isTrustedActor', () => {
    it('should return true for matching login', () => {
      expect(isTrustedActor('alice', { initiatorLogin: 'alice', rejectPolicy: 'silent' })).toBe(true);
    });

    it('should return false for non-matching login', () => {
      expect(isTrustedActor('bob', { initiatorLogin: 'alice', rejectPolicy: 'silent' })).toBe(false);
    });

    it('should return false when initiatorLogin is empty', () => {
      expect(isTrustedActor('alice', { initiatorLogin: '', rejectPolicy: 'silent' })).toBe(false);
    });
  });

  describe('assertTrustedActor', () => {
    it('should not throw for trusted actor', () => {
      expect(() => assertTrustedActor('alice', { initiatorLogin: 'alice', rejectPolicy: 'error' })).not.toThrow();
    });

    it('should throw for untrusted actor', () => {
      expect(() => assertTrustedActor('bob', { initiatorLogin: 'alice', rejectPolicy: 'error' })).toThrow('Untrusted actor: bob');
    });
  });

  describe('buildIssueBody', () => {
    it('should format issue body with full stage details', () => {
      const body = buildIssueBody({
        agentId: 'researcher',
        agentName: 'Researcher',
        taskRef: 'run-123',
        inputs: ['user_instruction'],
        outputs: ['research.md', 'research.manifest.json'],
        durationMs: 38900,
        usage: { input_tokens: 3, output_tokens: 993, cost_usd: 0.12 },
        retryCount: 0,
        hadClarification: false,
        wasRejected: false,
        commitSha: 'abc1234567890',
      });
      expect(body).toContain('Researcher — Stage Report');
      expect(body).toContain('`researcher`');
      expect(body).toContain('`run-123`');
      expect(body).toContain('38.9s');
      expect(body).toContain('993');
      expect(body).toContain('$0.12');
      expect(body).toContain('`user_instruction`');
      expect(body).toContain('`research.md`');
      expect(body).toContain('abc1234');
    });

    it('should show badges for clarification and rejection', () => {
      const body = buildIssueBody({
        agentId: 'product_owner',
        agentName: 'ProductOwner',
        taskRef: 'run-456',
        inputs: ['user_instruction', 'research.md'],
        outputs: ['prd.md'],
        hadClarification: true,
        wasRejected: true,
        retryCount: 1,
      });
      expect(body).toContain('Clarification');
      expect(body).toContain('Revised after rejection');
      expect(body).toContain('Retried 1x');
    });

    it('should handle minimal params', () => {
      const body = buildIssueBody({
        agentId: 'validator',
        agentName: 'Validator',
        taskRef: 'run-789',
        inputs: [],
        outputs: ['validation-report.md'],
      });
      expect(body).toContain('Validator — Stage Report');
      expect(body).toContain('_None_');
      expect(body).toContain('`validation-report.md`');
    });
  });
});
