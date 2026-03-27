import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import type { LLMProvider, LLMCallOptions, LLMResponse } from '../../core/llm-provider.js';
import type { AgentContext } from '../../core/types.js';
import { ValidatorAgent } from '../validator.js';
import { Logger } from '../../core/logger.js';
import { writeManifest } from '../../core/manifest.js';
import { createTestRunContext, createTestArtifactStore } from '../../__tests__/test-helpers.js';
import type { ArtifactStore } from '../../core/artifact-store.js';

class MockValidatorProvider implements LLMProvider {
  async call(_prompt: string, _options?: LLMCallOptions): Promise<LLMResponse> {
    return { content: `<!-- ARTIFACT:validation-report.md -->
## Validation Summary
- Status: PASS
- Checks passed: 4/4

### Check 1: PRD <-> UX Flows Coverage
- Status: PASS

### Check 2: UX Flows <-> API Coverage
- Status: PASS

### Check 3: API <-> Components Coverage
- Status: PASS

### Check 4: Naming Consistency
- Status: PASS
<!-- END:validation-report.md -->` };
  }
}

function makeContext(): AgentContext {
  return {
    systemPrompt: '# Validator Agent',
    task: { runId: 'test-run', stage: 'validator', instruction: 'Validate' },
    inputArtifacts: new Map([
      ['research.manifest.json', '{"competitors":["A"],"key_insights":["x"],"feasibility":"high","risks":[]}'],
      ['prd.manifest.json', '{"features":[{"id":"F-001","name":"f1"}],"constraints":[],"out_of_scope":[]}'],
      ['ux-flows.manifest.json', '{"flows":[{"name":"main","covers_features":["F-001"]}],"components":["CompA"],"interaction_rules":[]}'],
      ['api-spec.manifest.json', '{"endpoints":[{"method":"GET","path":"/t","covers_features":["F-001"]}],"models":["M"]}'],
      ['components.manifest.json', '{"components":[{"name":"CompA","file":"components/CompA.tsx","covers_features":["F-001"]}],"screenshots":["screenshots/CompA.png"],"previews":["previews/CompA.html"]}'],
    ]),
  };
}

describe('ValidatorAgent', () => {
  let store: ArtifactStore;

  beforeEach(() => {
    store = createTestArtifactStore('test-run');
  });

  afterEach(() => {
    if (store && fs.existsSync(store.getDir())) {
      fs.rmSync(store.getDir(), { recursive: true, force: true });
    }
  });

  it('should append Check 5 PASS when all referenced files exist', async () => {
    // Create all referenced files
    store.write('components/CompA.tsx', 'export default function CompA() {}');
    store.write('screenshots/CompA.png', '[png data]');
    store.write('previews/CompA.html', '<html></html>');

    // Write all manifests for Check 5 + Check 6
    writeManifest(store, 'prd.manifest.json', {
      features: [{ id: 'F-001', name: 'f1' }],
      constraints: [],
      out_of_scope: [],
    });
    writeManifest(store, 'ux-flows.manifest.json', {
      flows: [{ name: 'main', covers_features: ['F-001'] }],
      components: ['CompA'],
      interaction_rules: [],
    });
    writeManifest(store, 'api-spec.manifest.json', {
      endpoints: [{ method: 'GET', path: '/t', covers_features: ['F-001'] }],
      models: ['M'],
    });
    writeManifest(store, 'components.manifest.json', {
      components: [{ name: 'CompA', file: 'components/CompA.tsx', covers_features: ['F-001'] }],
      screenshots: ['screenshots/CompA.png'],
      previews: ['previews/CompA.html'],
    });

    const provider = new MockValidatorProvider();
    const logger = new Logger('test');
    const agent = new ValidatorAgent('validator', createTestRunContext({ provider, logger, store }));

    await agent.execute(makeContext());
    await logger.close();

    const report = fs.readFileSync(`${store.getDir()}/validation-report.md`, 'utf-8');
    expect(report).toContain('Check 5: File Integrity');
    expect(report).toContain('Status: PASS');
    expect(report).toContain('All referenced files exist on disk');
    // Overall status should remain PASS
    expect(report).toContain('Check 6: Feature ID Traceability');
    expect(report).toContain('Check 7: Tech-Spec Feature Coverage');
    expect(report).toContain('Check 8: Code Task Coverage');
    expect(report).toMatch(/- Status: PASS\n- Checks passed: 8\/8/);
  });

  it('should force FAIL when referenced files are missing', async () => {
    // Create only the component file, but NOT the screenshot or preview
    store.write('components/CompA.tsx', 'export default function CompA() {}');

    // Write manifest referencing files that don't exist
    writeManifest(store, 'components.manifest.json', {
      components: [{ name: 'CompA', file: 'components/CompA.tsx', covers_features: ['F-001'] }],
      screenshots: ['screenshots/CompA.png'],
      previews: ['previews/CompA.html'],
    });

    const provider = new MockValidatorProvider();
    const logger = new Logger('test');
    const agent = new ValidatorAgent('validator', createTestRunContext({ provider, logger, store }));

    await agent.execute(makeContext());
    await logger.close();

    const report = fs.readFileSync(`${store.getDir()}/validation-report.md`, 'utf-8');
    expect(report).toContain('Check 5: File Integrity');
    expect(report).toContain('FAIL');
  });
});
