import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import type { LLMProvider, LLMCallOptions } from '../../core/llm-provider.js';
import type { AgentContext } from '../../core/types.js';
import { ValidatorAgent } from '../validator.js';
import { Logger } from '../../core/logger.js';
import { writeArtifact } from '../../core/artifact.js';
import { writeManifest } from '../../core/manifest.js';

const ARTIFACTS_DIR = '.mosaic/artifacts';

class MockValidatorProvider implements LLMProvider {
  async call(_prompt: string, _options?: LLMCallOptions): Promise<string> {
    return `<!-- ARTIFACT:validation-report.md -->
## Validation Summary
- Status: PASS
- Checks passed: 4/4

### Check 1: PRD ↔ UX Flows Coverage
- Status: PASS

### Check 2: UX Flows ↔ API Coverage
- Status: PASS

### Check 3: API ↔ Components Coverage
- Status: PASS

### Check 4: Naming Consistency
- Status: PASS
<!-- END:validation-report.md -->`;
  }
}

function makeContext(): AgentContext {
  return {
    systemPrompt: '# Validator Agent',
    task: { runId: 'test-run', stage: 'validator', instruction: 'Validate' },
    inputArtifacts: new Map([
      ['research.manifest.json', '{"competitors":["A"],"key_insights":["x"],"feasibility":"high","risks":[]}'],
      ['prd.manifest.json', '{"features":["f1"],"constraints":[],"out_of_scope":[]}'],
      ['ux-flows.manifest.json', '{"flows":["main"],"components":["CompA"],"interaction_rules":[]}'],
      ['api-spec.manifest.json', '{"endpoints":[{"method":"GET","path":"/t","covers_feature":"f1"}],"models":["M"]}'],
      ['components.manifest.json', '{"components":[{"name":"CompA","file":"components/CompA.tsx","covers_flow":"main"}],"screenshots":["screenshots/CompA.png"],"previews":["previews/CompA.html"]}'],
    ]),
  };
}

describe('ValidatorAgent', () => {
  beforeEach(() => {
    if (fs.existsSync('.mosaic')) {
      fs.rmSync('.mosaic', { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync('.mosaic')) {
      fs.rmSync('.mosaic', { recursive: true });
    }
  });

  it('should append Check 5 PASS when all referenced files exist', async () => {
    // Create all referenced files
    writeArtifact('components/CompA.tsx', 'export default function CompA() {}');
    writeArtifact('screenshots/CompA.png', '[png data]');
    writeArtifact('previews/CompA.html', '<html></html>');

    // Write a valid components manifest
    writeManifest('components.manifest.json', {
      components: [{ name: 'CompA', file: 'components/CompA.tsx', covers_flow: 'main' }],
      screenshots: ['screenshots/CompA.png'],
      previews: ['previews/CompA.html'],
    });

    const provider = new MockValidatorProvider();
    const logger = new Logger('test');
    const agent = new ValidatorAgent('validator', provider, logger);

    await agent.execute(makeContext());
    await logger.close();

    const report = fs.readFileSync(`${ARTIFACTS_DIR}/validation-report.md`, 'utf-8');
    expect(report).toContain('Check 5: File Integrity');
    expect(report).toContain('Status: PASS');
    expect(report).toContain('All referenced files exist on disk');
    // Overall status should remain PASS
    expect(report).toMatch(/- Status: PASS\n- Checks passed: 5\/5/);
  });

  it('should force FAIL when referenced files are missing', async () => {
    // Create only the component file, but NOT the screenshot or preview
    writeArtifact('components/CompA.tsx', 'export default function CompA() {}');

    // Write manifest referencing files that don't exist
    writeManifest('components.manifest.json', {
      components: [{ name: 'CompA', file: 'components/CompA.tsx', covers_flow: 'main' }],
      screenshots: ['screenshots/CompA.png'],
      previews: ['previews/CompA.html'],
    });

    const provider = new MockValidatorProvider();
    const logger = new Logger('test');
    const agent = new ValidatorAgent('validator', provider, logger);

    await agent.execute(makeContext());
    await logger.close();

    const report = fs.readFileSync(`${ARTIFACTS_DIR}/validation-report.md`, 'utf-8');
    expect(report).toContain('Check 5: File Integrity');
    expect(report).toContain('FAIL');
    expect(report).toContain('screenshots/CompA.png');
    expect(report).toContain('previews/CompA.html');
    // Overall status should be forced to FAIL
    expect(report).toMatch(/- Status: FAIL/);
  });

  it('should handle missing components.manifest.json gracefully', async () => {
    // Don't create any manifest — the check should still work

    const provider = new MockValidatorProvider();
    const logger = new Logger('test');
    const agent = new ValidatorAgent('validator', provider, logger);

    await agent.execute(makeContext());
    await logger.close();

    const report = fs.readFileSync(`${ARTIFACTS_DIR}/validation-report.md`, 'utf-8');
    expect(report).toContain('Check 5: File Integrity');
    expect(report).toContain('FAIL');
    expect(report).toContain('unreadable');
  });
});
