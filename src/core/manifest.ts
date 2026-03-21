import { z } from 'zod';
import { writeArtifact, readArtifact } from './artifact.js';

// --- Manifest Schemas ---

export const ResearchManifestSchema = z.object({
  competitors: z.array(z.string()),
  key_insights: z.array(z.string()),
  feasibility: z.enum(['high', 'medium', 'low']),
  risks: z.array(z.string()),
});

export const FeatureSchema = z.object({
  id: z.string(),
  name: z.string(),
});

export const PrdManifestSchema = z.object({
  features: z.array(FeatureSchema),
  constraints: z.array(z.string()),
  out_of_scope: z.array(z.string()),
});

export const UxFlowsManifestSchema = z.object({
  flows: z.array(
    z.object({
      name: z.string(),
      covers_features: z.array(z.string()),
    })
  ),
  components: z.array(z.string()),
  interaction_rules: z.array(z.string()),
});

export const ApiSpecManifestSchema = z.object({
  endpoints: z.array(
    z.object({
      method: z.string(),
      path: z.string(),
      covers_features: z.array(z.string()),
    })
  ),
  models: z.array(z.string()),
});

export const ComponentsManifestSchema = z.object({
  components: z.array(
    z.object({
      name: z.string(),
      file: z.string(),
      covers_features: z.array(z.string()),
    })
  ),
  screenshots: z.array(z.string()),
  previews: z.array(z.string()).optional(),
});

export const TechSpecManifestSchema = z.object({
  modules: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      covers_features: z.array(z.string()),
    })
  ),
  tech_stack: z.array(z.string()),
  implementation_tasks: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      module: z.string(),
      covers_features: z.array(z.string()),
    })
  ),
});

export const CodeManifestSchema = z.object({
  files: z.array(
    z.object({
      path: z.string(),
      module: z.string(),
      description: z.string(),
    })
  ),
  modules: z.array(z.string()),
  covers_tasks: z.array(z.string()),
  covers_features: z.array(z.string()),
});

export const TestPlanManifestSchema = z.object({
  test_framework: z.string(),
  commands: z.object({
    setupCommand: z.string(),
    runCommand: z.string(),
  }),
  test_suites: z.array(
    z.object({
      module: z.string(),
      test_file: z.string(),
      test_cases: z.array(
        z.object({
          name: z.string(),
          covers_tasks: z.array(z.string()),
          type: z.enum(['unit', 'integration', 'e2e']),
        })
      ),
    })
  ),
});

export const ReviewManifestSchema = z.object({
  issues: z.array(
    z.object({
      severity: z.enum(['critical', 'major', 'minor', 'suggestion']),
      file: z.string(),
      description: z.string(),
    })
  ),
  spec_coverage: z.object({
    total_tasks: z.number(),
    covered_tasks: z.number(),
    missing_tasks: z.array(z.string()),
  }),
  verdict: z.enum(['pass', 'pass_with_suggestions', 'fail']),
});

// Schema registry by manifest name
const MANIFEST_SCHEMAS: Record<string, z.ZodType> = {
  'research.manifest.json': ResearchManifestSchema,
  'prd.manifest.json': PrdManifestSchema,
  'ux-flows.manifest.json': UxFlowsManifestSchema,
  'api-spec.manifest.json': ApiSpecManifestSchema,
  'components.manifest.json': ComponentsManifestSchema,
  'tech-spec.manifest.json': TechSpecManifestSchema,
  'code.manifest.json': CodeManifestSchema,
  'test-plan.manifest.json': TestPlanManifestSchema,
  'review.manifest.json': ReviewManifestSchema,
};

export type ResearchManifest = z.infer<typeof ResearchManifestSchema>;
export type PrdManifest = z.infer<typeof PrdManifestSchema>;
export type UxFlowsManifest = z.infer<typeof UxFlowsManifestSchema>;
export type ApiSpecManifest = z.infer<typeof ApiSpecManifestSchema>;
export type ComponentsManifest = z.infer<typeof ComponentsManifestSchema>;
export type TechSpecManifest = z.infer<typeof TechSpecManifestSchema>;
export type CodeManifest = z.infer<typeof CodeManifestSchema>;
export type TestPlanManifest = z.infer<typeof TestPlanManifestSchema>;
export type ReviewManifest = z.infer<typeof ReviewManifestSchema>;

export function writeManifest(name: string, data: unknown): void {
  const schema = MANIFEST_SCHEMAS[name];
  if (schema) {
    schema.parse(data);
  }
  writeArtifact(name, JSON.stringify(data, null, 2));
}

export function readManifest<T = unknown>(name: string): T {
  const content = readArtifact(name);
  const parsed = JSON.parse(content) as unknown;
  const schema = MANIFEST_SCHEMAS[name];
  if (schema) {
    schema.parse(parsed);
  }
  return parsed as T;
}

/**
 * Extract human-readable summary lines from a manifest file.
 * Returns empty array if manifest doesn't exist or can't be parsed.
 */
export function extractManifestSummary(manifestName: string): string[] {
  try {
    const data = readManifest(manifestName) as Record<string, unknown>;
    return SUMMARY_EXTRACTORS[manifestName]?.(data) ?? [];
  } catch {
    return [];
  }
}

const SUMMARY_EXTRACTORS: Record<string, (data: Record<string, unknown>) => string[]> = {
  'research.manifest.json': (data) => {
    const m = data as unknown as ResearchManifest;
    const lines: string[] = [];
    lines.push(`**Feasibility:** ${m.feasibility}`);
    if (m.competitors.length > 0) lines.push(`**Competitors:** ${m.competitors.join(', ')}`);
    for (const insight of m.key_insights.slice(0, 5)) lines.push(insight);
    if (m.risks.length > 0) lines.push(`**Risks:** ${m.risks.join('; ')}`);
    return lines;
  },
  'prd.manifest.json': (data) => {
    const m = data as unknown as PrdManifest;
    const lines: string[] = [];
    if (m.features.length > 0) lines.push(`**Features (${m.features.length}):** ${m.features.map((f) => `${f.id}: ${f.name}`).join(', ')}`);
    if (m.constraints.length > 0) lines.push(`**Constraints:** ${m.constraints.join(', ')}`);
    if (m.out_of_scope.length > 0) lines.push(`**Out of scope:** ${m.out_of_scope.join(', ')}`);
    return lines;
  },
  'ux-flows.manifest.json': (data) => {
    const m = data as unknown as UxFlowsManifest;
    const lines: string[] = [];
    if (m.flows.length > 0) lines.push(`**Flows (${m.flows.length}):** ${m.flows.map((f) => `${f.name} [${f.covers_features.join(', ')}]`).join(', ')}`);
    if (m.components.length > 0) lines.push(`**Components (${m.components.length}):** ${m.components.join(', ')}`);
    return lines;
  },
  'api-spec.manifest.json': (data) => {
    const m = data as unknown as ApiSpecManifest;
    const lines: string[] = [];
    for (const ep of m.endpoints) lines.push(`\`${ep.method} ${ep.path}\` — [${ep.covers_features.join(', ')}]`);
    if (m.models.length > 0) lines.push(`**Models:** ${m.models.join(', ')}`);
    return lines;
  },
  'components.manifest.json': (data) => {
    const m = data as unknown as ComponentsManifest;
    const lines: string[] = [];
    for (const c of m.components) lines.push(`**${c.name}** (\`${c.file}\`) — [${c.covers_features.join(', ')}]`);
    if (m.screenshots.length > 0) lines.push(`**Screenshots:** ${m.screenshots.length} captured`);
    if (m.previews && m.previews.length > 0) lines.push(`**Previews:** ${m.previews.length} generated`);
    return lines;
  },
  'tech-spec.manifest.json': (data) => {
    const m = data as unknown as TechSpecManifest;
    const lines: string[] = [];
    if (m.modules.length > 0) lines.push(`**Modules (${m.modules.length}):** ${m.modules.map((mod) => `${mod.name} [${mod.covers_features.join(', ')}]`).join(', ')}`);
    if (m.tech_stack.length > 0) lines.push(`**Tech Stack:** ${m.tech_stack.join(', ')}`);
    if (m.implementation_tasks.length > 0) lines.push(`**Tasks (${m.implementation_tasks.length}):** ${m.implementation_tasks.map((t) => `${t.id}: ${t.name}`).join(', ')}`);
    return lines;
  },
  'code.manifest.json': (data) => {
    const m = data as unknown as CodeManifest;
    const lines: string[] = [];
    if (m.files.length > 0) lines.push(`**Files (${m.files.length}):** ${m.files.map((f) => f.path).join(', ')}`);
    if (m.modules.length > 0) lines.push(`**Modules:** ${m.modules.join(', ')}`);
    if (m.covers_tasks.length > 0) lines.push(`**Covers tasks:** ${m.covers_tasks.join(', ')}`);
    if (m.covers_features.length > 0) lines.push(`**Covers features:** ${m.covers_features.join(', ')}`);
    return lines;
  },
  'test-plan.manifest.json': (data) => {
    const m = data as unknown as TestPlanManifest;
    const lines: string[] = [];
    lines.push(`**Test Framework:** ${m.test_framework}`);
    const totalCases = m.test_suites.reduce((sum, s) => sum + s.test_cases.length, 0);
    lines.push(`**Test Suites:** ${m.test_suites.length} suites, ${totalCases} test cases`);
    if (m.test_suites.length > 0) {
      for (const suite of m.test_suites) {
        const types = suite.test_cases.map(tc => tc.type);
        const unitCount = types.filter(t => t === 'unit').length;
        const intCount = types.filter(t => t === 'integration').length;
        const e2eCount = types.filter(t => t === 'e2e').length;
        const breakdown = [unitCount && `${unitCount} unit`, intCount && `${intCount} integration`, e2eCount && `${e2eCount} e2e`].filter(Boolean).join(', ');
        lines.push(`**${suite.module}** (\`${suite.test_file}\`) — ${breakdown}`);
      }
    }
    return lines;
  },
  'review.manifest.json': (data) => {
    const m = data as unknown as ReviewManifest;
    const lines: string[] = [];
    lines.push(`**Verdict:** ${m.verdict}`);
    lines.push(`**Spec Coverage:** ${m.spec_coverage.covered_tasks}/${m.spec_coverage.total_tasks} tasks`);
    if (m.spec_coverage.missing_tasks.length > 0) lines.push(`**Missing tasks:** ${m.spec_coverage.missing_tasks.join(', ')}`);
    if (m.issues.length > 0) {
      const critical = m.issues.filter((i) => i.severity === 'critical').length;
      const major = m.issues.filter((i) => i.severity === 'major').length;
      lines.push(`**Issues:** ${m.issues.length} total (${critical} critical, ${major} major)`);
    }
    return lines;
  },
};
