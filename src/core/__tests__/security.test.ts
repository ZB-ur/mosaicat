import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  TrustLevel,
  loadSecurityConfig,
  isTrustedActor,
  assertTrustedActor,
  buildIssueBody,
  buildStageIssueTitle,
  buildSummaryIssueTitle,
} from '../security.js';
import type { PipelineConfig } from '../types.js';

const basePipelineConfig: PipelineConfig = {
  stages: {},
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

  describe('buildStageIssueTitle', () => {
    it('should format readable title', () => {
      const title = buildStageIssueTitle({
        agentId: 'api_designer', agentName: 'APIDesigner', agentDesc: 'API 规范设计',
        taskRef: 'run-123', instruction: '做一个计算器', inputs: [], outputs: [],
      });
      expect(title).toBe('APIDesigner — API 规范设计');
    });
  });

  describe('buildSummaryIssueTitle', () => {
    it('should include instruction', () => {
      expect(buildSummaryIssueTitle('做一个简单的计算器')).toBe('Pipeline 完成 — 做一个简单的计算器');
    });

    it('should truncate long instructions', () => {
      const long = '做一个非常复杂的具有很多功能的超级计算器应用程序并且要支持科学计算和图形绘制以及历史记录功能还要有单位转换和汇率计算以及各种数学公式的支持';
      const title = buildSummaryIssueTitle(long);
      expect(title).toContain('...');
      // Title should not be excessively long
      expect(title.length).toBeLessThanOrEqual(80);
    });
  });

  describe('buildIssueBody', () => {
    const baseParams = {
      agentId: 'researcher' as const,
      agentName: 'Researcher',
      agentDesc: '市场调研 & 竞品分析',
      taskRef: 'run-123',
      instruction: '做一个计算器',
      inputs: ['user_instruction'],
      outputs: ['research.md', 'research.manifest.json'],
    };

    it('should include context header with instruction and run ID', () => {
      const body = buildIssueBody(baseParams);
      expect(body).toContain('`run-123`');
      expect(body).toContain('做一个计算器');
    });

    it('should render manifest summary when provided', () => {
      const body = buildIssueBody({
        ...baseParams,
        manifestSummary: ['**Feasibility:** high', 'Calculator market is mature'],
      });
      expect(body).toContain('### Summary');
      expect(body).toContain('**Feasibility:** high');
      expect(body).toContain('Calculator market is mature');
    });

    it('should render clickable artifact links when repoSlug and commitSha provided', () => {
      const body = buildIssueBody({
        ...baseParams,
        repoSlug: 'ZB-ur/test-repo',
        commitSha: 'abc1234567890',
        artifactsDir: '.mosaic/artifacts',
      });
      expect(body).toContain('[`research.md`](https://github.com/ZB-ur/test-repo/blob/abc1234567890/.mosaic/artifacts/research.md)');
    });

    it('should render plain artifact names without GitHub context', () => {
      const body = buildIssueBody(baseParams);
      expect(body).toContain('`research.md`');
      // Should not contain blob links (footer link to mosaicat repo is OK)
      expect(body).not.toContain('/blob/');
    });

    it('should render clarification Q&A in process section', () => {
      const body = buildIssueBody({
        ...baseParams,
        clarificationQA: { question: '请确认设计方向', answer: 'Apple style' },
      });
      expect(body).toContain('### Process');
      expect(body).toContain('请确认设计方向');
      expect(body).toContain('Apple style');
    });

    it('should render rejection feedback in process section', () => {
      const body = buildIssueBody({
        ...baseParams,
        rejectionFeedback: '需要增加分页功能',
      });
      expect(body).toContain('Rejected & revised');
      expect(body).toContain('需要增加分页功能');
    });

    it('should put execution metrics in collapsible details', () => {
      const body = buildIssueBody({
        ...baseParams,
        durationMs: 38900,
        repoSlug: 'ZB-ur/test-repo',
        commitSha: 'abc1234567890',
      });
      expect(body).toContain('<details>');
      expect(body).toContain('38.9s');
      expect(body).toContain('[`abc1234`]');
    });

    it('should include PR link when prNumber provided', () => {
      const body = buildIssueBody({
        ...baseParams,
        repoSlug: 'ZB-ur/test-repo',
        prNumber: 13,
      });
      expect(body).toContain('PR: [#13]');
    });

    it('should handle minimal params gracefully', () => {
      const body = buildIssueBody({
        agentId: 'validator',
        agentName: 'Validator',
        agentDesc: '交叉验证报告',
        taskRef: 'run-789',
        instruction: '做一个计算器',
        inputs: [],
        outputs: ['validation-report.md'],
      });
      expect(body).toContain('`validation-report.md`');
      expect(body).toContain('_none_');
      expect(body).not.toContain('### Process');
      expect(body).not.toContain('### Summary');
    });
  });
});
