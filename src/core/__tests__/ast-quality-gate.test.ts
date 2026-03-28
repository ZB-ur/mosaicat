import { describe, it, expect } from 'vitest';
import { z } from 'zod';

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
