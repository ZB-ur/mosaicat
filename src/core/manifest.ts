import { z } from 'zod';
import { writeArtifact, readArtifact } from './artifact.js';

// --- Manifest Schemas ---

export const ResearchManifestSchema = z.object({
  competitors: z.array(z.string()),
  key_insights: z.array(z.string()),
  feasibility: z.enum(['high', 'medium', 'low']),
  risks: z.array(z.string()),
});

export const PrdManifestSchema = z.object({
  features: z.array(z.string()),
  constraints: z.array(z.string()),
  out_of_scope: z.array(z.string()),
});

export const UxFlowsManifestSchema = z.object({
  flows: z.array(z.string()),
  components: z.array(z.string()),
  interaction_rules: z.array(z.string()),
});

export const ApiSpecManifestSchema = z.object({
  endpoints: z.array(
    z.object({
      method: z.string(),
      path: z.string(),
      covers_feature: z.string(),
    })
  ),
  models: z.array(z.string()),
});

export const ComponentsManifestSchema = z.object({
  components: z.array(
    z.object({
      name: z.string(),
      file: z.string(),
      covers_flow: z.string(),
    })
  ),
  screenshots: z.array(z.string()),
});

// Schema registry by manifest name
const MANIFEST_SCHEMAS: Record<string, z.ZodType> = {
  'research.manifest.json': ResearchManifestSchema,
  'prd.manifest.json': PrdManifestSchema,
  'ux-flows.manifest.json': UxFlowsManifestSchema,
  'api-spec.manifest.json': ApiSpecManifestSchema,
  'components.manifest.json': ComponentsManifestSchema,
};

export type ResearchManifest = z.infer<typeof ResearchManifestSchema>;
export type PrdManifest = z.infer<typeof PrdManifestSchema>;
export type UxFlowsManifest = z.infer<typeof UxFlowsManifestSchema>;
export type ApiSpecManifest = z.infer<typeof ApiSpecManifestSchema>;
export type ComponentsManifest = z.infer<typeof ComponentsManifestSchema>;

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
