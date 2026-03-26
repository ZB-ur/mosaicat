import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { LLMProvider, LLMCallOptions, LLMResponse } from '../../core/llm-provider.js';
import type { Logger } from '../../core/logger.js';
import { EventBus } from '../../core/event-bus.js';
import type { AgentContext } from '../../core/types.js';
import type { CodePlan, CodePlanModule } from '../code-plan-schema.js';
import type { ArtifactIO, CoderDeps } from '../coder/types.js';
import { CoderBuilder } from '../coder/coder-builder.js';

// --- Mock helpers ---

function createMockProvider(): LLMProvider & { calls: Array<{ prompt: string; options?: LLMCallOptions }> } {
  const calls: Array<{ prompt: string; options?: LLMCallOptions }> = [];
  return {
    calls,
    async call(prompt: string, options?: LLMCallOptions): Promise<LLMResponse> {
      calls.push({ prompt, options });
      return { content: 'done' };
    },
  };
}

function createMockLogger(): Logger {
  return {
    pipeline: () => {},
    agent: () => {},
  } as unknown as Logger;
}

function createMockArtifacts(dir: string): ArtifactIO {
  return {
    write(_name: string, _content: string) {},
    read(_name: string) { return ''; },
    exists(_name: string) { return false; },
    getDir() { return dir; },
  };
}

function makeDeps(overrides?: Partial<CoderDeps>): CoderDeps {
  return {
    stage: 'coder' as const,
    provider: createMockProvider(),
    artifacts: createMockArtifacts('/tmp/test'),
    logger: createMockLogger(),
    eventBus: new EventBus(),
    ...overrides,
  };
}

function makeContext(): AgentContext {
  return {
    systemPrompt: '# Coder',
    task: { runId: 'test-run', stage: 'coder', instruction: 'Build' },
    inputArtifacts: new Map([
      ['tech-spec.md', '## Tech Spec\nBuild a todo app'],
      ['api-spec.yaml', 'openapi: 3.0.0'],
    ]),
  };
}

function makePlan(files: string[] = ['src/App.tsx', 'src/main.ts']): CodePlan {
  return {
    project_name: 'todo-app',
    tech_stack: { language: 'TypeScript', framework: 'React', build_tool: 'vite' },
    commands: { setupCommand: 'npm install', verifyCommand: 'npx tsc --noEmit', buildCommand: 'npm run build' },
    modules: [
      {
        name: 'core',
        description: 'Core module',
        files,
        dependencies: [],
        covers_tasks: ['T1'],
        covers_features: ['F-001'],
        priority: 1,
      },
      {
        name: 'ui',
        description: 'UI module',
        files: ['src/components/Header.tsx'],
        dependencies: ['core'],
        covers_tasks: ['T2'],
        covers_features: ['F-002'],
        priority: 2,
      },
    ],
  };
}

describe('CoderBuilder', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coder-builder-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('runSkeleton', () => {
    it('calls provider.call with correct options (allowedTools includes Read, Write, Bash)', async () => {
      const provider = createMockProvider();
      const artifacts = createMockArtifacts(tmpDir);
      const builder = new CoderBuilder(makeDeps({ provider, artifacts }));

      await builder.runSkeleton(makeContext(), makePlan());

      expect(provider.calls).toHaveLength(1);
      expect(provider.calls[0].options?.allowedTools).toEqual(['Read', 'Write', 'Bash']);
    });
  });

  describe('isSkeletonComplete', () => {
    it('returns true when all plan files exist on disk', () => {
      // Create all files in code/ subdirectory
      const codeDir = path.join(tmpDir, 'code');
      fs.mkdirSync(path.join(codeDir, 'src/components'), { recursive: true });
      fs.writeFileSync(path.join(codeDir, 'src/App.tsx'), 'export {}');
      fs.writeFileSync(path.join(codeDir, 'src/main.ts'), 'export {}');
      fs.writeFileSync(path.join(codeDir, 'src/components/Header.tsx'), 'export {}');

      const artifacts = createMockArtifacts(tmpDir);
      const builder = new CoderBuilder(makeDeps({ artifacts }));

      expect(builder.isSkeletonComplete(makePlan())).toBe(true);
    });

    it('returns false when files are missing', () => {
      const artifacts = createMockArtifacts(tmpDir);
      const builder = new CoderBuilder(makeDeps({ artifacts }));

      expect(builder.isSkeletonComplete(makePlan())).toBe(false);
    });
  });

  describe('getModulesToImplement', () => {
    it('returns all modules when no test_failures', () => {
      const builder = new CoderBuilder(makeDeps());
      const plan = makePlan();

      const modules = builder.getModulesToImplement(plan);

      expect(modules).toHaveLength(2);
      expect(modules.map(m => m.name)).toEqual(['core', 'ui']);
    });

    it('filters to failed modules when test_failures provided', () => {
      const builder = new CoderBuilder(makeDeps());
      const plan = makePlan();
      const testFailures = JSON.stringify({
        failures: [{ module: 'ui', test: 'Header renders' }],
      });

      const modules = builder.getModulesToImplement(plan, testFailures);

      expect(modules).toHaveLength(1);
      expect(modules[0].name).toBe('ui');
    });

    it('returns all modules when test_failures is invalid JSON', () => {
      const builder = new CoderBuilder(makeDeps());
      const plan = makePlan();

      const modules = builder.getModulesToImplement(plan, 'not json');

      expect(modules).toHaveLength(2);
    });
  });

  describe('implementModule', () => {
    it('calls provider.call with builder prompt', async () => {
      const provider = createMockProvider();
      const artifacts = createMockArtifacts(tmpDir);
      const builder = new CoderBuilder(makeDeps({ provider, artifacts }));
      const plan = makePlan();

      await builder.implementModule(makeContext(), plan, plan.modules[0], 1.0);

      expect(provider.calls).toHaveLength(1);
      expect(provider.calls[0].options?.allowedTools).toEqual(['Read', 'Write', 'Bash']);
      expect(provider.calls[0].prompt).toContain('Module: core');
    });
  });
});
