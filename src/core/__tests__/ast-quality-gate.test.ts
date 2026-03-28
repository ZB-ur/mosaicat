import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// --- Task 1: Schema tests ---

describe('schema', () => {
  describe('QualityGateSchema', () => {
    it('parses valid quality gate data', async () => {
      const { QualityGateSchema } = await import('../quality-gate-types.js');
      const result = QualityGateSchema.parse({
        stub_count: 2,
        partial_count: 1,
        complete_count: 5,
        coverage_gaps: ['F-001'],
        blocked: true,
      });
      expect(result.stub_count).toBe(2);
      expect(result.blocked).toBe(true);
    });
  });

  describe('ImplementationStatusSchema', () => {
    it('parses valid status values', async () => {
      const { ImplementationStatusSchema } = await import('../quality-gate-types.js');
      expect(ImplementationStatusSchema.parse('stub')).toBe('stub');
      expect(ImplementationStatusSchema.parse('partial')).toBe('partial');
      expect(ImplementationStatusSchema.parse('complete')).toBe('complete');
    });

    it('rejects invalid status', async () => {
      const { ImplementationStatusSchema } = await import('../quality-gate-types.js');
      expect(() => ImplementationStatusSchema.parse('invalid')).toThrow();
    });
  });

  describe('CodeManifestSchema extensions', () => {
    it('accepts files with implementation_status', async () => {
      const { CodeManifestSchema } = await import('../manifest.js');
      const data = {
        files: [{
          path: 'src/app.ts',
          module: 'core',
          description: 'Main app',
          implementation_status: 'complete',
        }],
        modules: ['core'],
        covers_tasks: ['T-001'],
        covers_features: ['F-001'],
      };
      expect(() => CodeManifestSchema.parse(data)).not.toThrow();
    });

    it('accepts files WITHOUT implementation_status (backward compat)', async () => {
      const { CodeManifestSchema } = await import('../manifest.js');
      const data = {
        files: [{
          path: 'src/app.ts',
          module: 'core',
          description: 'Main app',
        }],
        modules: ['core'],
        covers_tasks: ['T-001'],
        covers_features: ['F-001'],
      };
      expect(() => CodeManifestSchema.parse(data)).not.toThrow();
    });
  });

  describe('manifest schemas accept quality_gate field', () => {
    it('all manifest schemas accept optional quality_gate', async () => {
      const manifest = await import('../manifest.js');
      const { QualityGateSchema } = await import('../quality-gate-types.js');

      const qualityGate = {
        stub_count: 0,
        partial_count: 0,
        complete_count: 3,
        coverage_gaps: [],
        blocked: false,
      };

      // Test CodeManifestSchema with quality_gate
      const codeData = {
        files: [{ path: 'a.ts', module: 'm', description: 'd' }],
        modules: ['m'],
        covers_tasks: ['T-001'],
        covers_features: ['F-001'],
        quality_gate: qualityGate,
      };
      expect(() => manifest.CodeManifestSchema.parse(codeData)).not.toThrow();

      // Test ResearchManifestSchema with quality_gate
      const researchData = {
        competitors: ['a'],
        key_insights: ['b'],
        feasibility: 'high',
        risks: ['c'],
        quality_gate: qualityGate,
      };
      expect(() => manifest.ResearchManifestSchema.parse(researchData)).not.toThrow();

      // Test ComponentsManifestSchema with quality_gate
      const componentsData = {
        components: [{ name: 'btn', file: 'btn.tsx', covers_features: ['F-001'] }],
        screenshots: ['s.png'],
        quality_gate: qualityGate,
      };
      expect(() => manifest.ComponentsManifestSchema.parse(componentsData)).not.toThrow();
    });
  });

  describe('writeManifest backward compat', () => {
    it('writeManifest with implementation_status does not throw', async () => {
      // We just verify the schema accepts it — actual file write would need artifact dir
      const { CodeManifestSchema } = await import('../manifest.js');
      const data = {
        files: [{
          path: 'src/app.ts',
          module: 'core',
          description: 'Main app',
          implementation_status: 'complete',
        }],
        modules: ['core'],
        covers_tasks: ['T-001'],
        covers_features: ['F-001'],
        quality_gate: {
          stub_count: 0,
          partial_count: 0,
          complete_count: 1,
          coverage_gaps: [],
          blocked: false,
        },
      };
      expect(() => CodeManifestSchema.parse(data)).not.toThrow();
    });
  });
});

// --- Task 2: AST analysis tests ---

describe('analyzeFile', () => {
  it('detects empty function body', async () => {
    const { analyzeFile } = await import('../hooks/ast-quality-gate.js');
    const result = analyzeFile('test.ts', 'function foo() {}');
    expect(result.issues.some(i => i.type === 'empty-body')).toBe(true);
  });

  it('detects return null', async () => {
    const { analyzeFile } = await import('../hooks/ast-quality-gate.js');
    const result = analyzeFile('test.ts', 'function foo() { return null; }');
    expect(result.issues.some(i => i.type === 'return-null')).toBe(true);
  });

  it('detects return undefined', async () => {
    const { analyzeFile } = await import('../hooks/ast-quality-gate.js');
    const result = analyzeFile('test.ts', 'function foo() { return undefined; }');
    expect(result.issues.some(i => i.type === 'return-null')).toBe(true);
  });

  it('detects bare return', async () => {
    const { analyzeFile } = await import('../hooks/ast-quality-gate.js');
    const result = analyzeFile('test.ts', 'function foo() { return; }');
    expect(result.issues.some(i => i.type === 'return-null')).toBe(true);
  });

  it('detects empty arrow function', async () => {
    const { analyzeFile } = await import('../hooks/ast-quality-gate.js');
    const result = analyzeFile('test.ts', 'const fn = () => {}');
    expect(result.issues.some(i => i.type === 'empty-body')).toBe(true);
  });

  it('does NOT flag arrow with expression body', async () => {
    const { analyzeFile } = await import('../hooks/ast-quality-gate.js');
    const result = analyzeFile('test.ts', 'const fn = () => 42');
    expect(result.issues.length).toBe(0);
  });

  it('detects empty JSX in .tsx file', async () => {
    const { analyzeFile } = await import('../hooks/ast-quality-gate.js');
    const result = analyzeFile('test.tsx', 'const el = <div></div>;');
    expect(result.issues.some(i => i.type === 'empty-jsx')).toBe(true);
  });

  it('detects TODO in string literal (non-comment)', async () => {
    const { analyzeFile } = await import('../hooks/ast-quality-gate.js');
    const result = analyzeFile('test.ts', "const x = 'TODO: implement';");
    expect(result.issues.some(i => i.type === 'todo-fixme')).toBe(true);
  });

  it('ignores TODO in comments', async () => {
    const { analyzeFile } = await import('../hooks/ast-quality-gate.js');
    const result = analyzeFile('test.ts', '// TODO: refactor later\nconst x = 42;');
    expect(result.issues.filter(i => i.type === 'todo-fixme').length).toBe(0);
  });
});

describe('classifyFile', () => {
  it('returns stub when all functions are stubs', async () => {
    const { analyzeFile, classifyFile } = await import('../hooks/ast-quality-gate.js');
    const analysis = analyzeFile('test.ts', 'function foo() {}\nfunction bar() { return null; }');
    expect(classifyFile(analysis)).toBe('stub');
  });

  it('returns partial when hasTodoFixme with some real implementation', async () => {
    const { analyzeFile, classifyFile } = await import('../hooks/ast-quality-gate.js');
    const code = `
function real() { const x = 1; const y = 2; return x + y; }
const msg = 'TODO: clean up';
`;
    const analysis = analyzeFile('test.ts', code);
    expect(classifyFile(analysis)).toBe('partial');
  });

  it('returns complete for normal code', async () => {
    const { analyzeFile, classifyFile } = await import('../hooks/ast-quality-gate.js');
    const code = 'function real() { const x = 1; return x + 1; }';
    const analysis = analyzeFile('test.ts', code);
    expect(classifyFile(analysis)).toBe('complete');
  });
});

describe('createAstQualityGateHook', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ast-gate-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns pass: false when stub files detected', async () => {
    const { createAstQualityGateHook } = await import('../hooks/ast-quality-gate.js');
    // Create code directory with a stub file
    const codeDir = path.join(tmpDir, 'code');
    fs.mkdirSync(codeDir, { recursive: true });
    fs.writeFileSync(path.join(codeDir, 'app.ts'), 'function foo() {}');

    const hook = createAstQualityGateHook(tmpDir);
    const result = await hook.execute(
      { systemPrompt: '', task: { runId: 'r1', stage: 'coder', instruction: '' }, inputArtifacts: new Map() } as any,
      '',
    );
    expect(result.pass).toBe(false);
    expect(result.message).toContain('app.ts');
  });

  it('returns pass: true when all files are complete', async () => {
    const { createAstQualityGateHook } = await import('../hooks/ast-quality-gate.js');
    const codeDir = path.join(tmpDir, 'code');
    fs.mkdirSync(codeDir, { recursive: true });
    fs.writeFileSync(path.join(codeDir, 'app.ts'), 'function real() { const x = 1; return x + 1; }');

    const hook = createAstQualityGateHook(tmpDir);
    const result = await hook.execute(
      { systemPrompt: '', task: { runId: 'r1', stage: 'coder', instruction: '' }, inputArtifacts: new Map() } as any,
      '',
    );
    expect(result.pass).toBe(true);
  });

  it('writes quality-gate-report.md artifact on failure', async () => {
    const { createAstQualityGateHook } = await import('../hooks/ast-quality-gate.js');
    const codeDir = path.join(tmpDir, 'code');
    fs.mkdirSync(codeDir, { recursive: true });
    fs.writeFileSync(path.join(codeDir, 'stub.ts'), 'function foo() {}');

    const hook = createAstQualityGateHook(tmpDir);
    await hook.execute(
      { systemPrompt: '', task: { runId: 'r1', stage: 'coder', instruction: '' }, inputArtifacts: new Map() } as any,
      '',
    );

    const reportPath = path.join(tmpDir, 'quality-gate-report.md');
    expect(fs.existsSync(reportPath)).toBe(true);
    const content = fs.readFileSync(reportPath, 'utf-8');
    expect(content).toContain('Quality Gate Report');
    expect(content).toContain('stub.ts');
  });
});
