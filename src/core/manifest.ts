import { z } from 'zod';
import { readArtifact, writeArtifact, listArtifacts } from './artifact.js';

// --- Manifest Schemas ---

export const ResearchManifestSchema = z.object({
  competitors: z.array(z.string()),
  tech_stack_suggestions: z.array(z.string()),
  risks: z.array(z.string()),
  opportunities: z.array(z.string()),
});

export const PrdManifestSchema = z.object({
  features: z.array(z.string()),
  constraints: z.array(z.string()),
  out_of_scope: z.array(z.string()),
});

export const UxFlowsManifestSchema = z.object({
  flows: z.array(
    z.object({
      name: z.string(),
      covers_feature: z.string(),
      pages: z.array(z.string()),
    }),
  ),
  components: z.array(z.string()),
  pages: z.array(z.string()),
});

export const ApiSpecManifestSchema = z.object({
  endpoints: z.array(
    z.object({
      method: z.string(),
      path: z.string(),
      covers_feature: z.string(),
    }),
  ),
  models: z.array(z.string()),
});

export const ComponentsManifestSchema = z.object({
  components: z.array(
    z.object({
      name: z.string(),
      file: z.string(),
      consumes_models: z.array(z.string()),
      covers_feature: z.string(),
    }),
  ),
  screenshots: z.array(z.string()),
});

export type ResearchManifest = z.infer<typeof ResearchManifestSchema>;
export type PrdManifest = z.infer<typeof PrdManifestSchema>;
export type UxFlowsManifest = z.infer<typeof UxFlowsManifestSchema>;
export type ApiSpecManifest = z.infer<typeof ApiSpecManifestSchema>;
export type ComponentsManifest = z.infer<typeof ComponentsManifestSchema>;

// --- Manifest name → schema mapping ---

const MANIFEST_SCHEMAS: Record<string, z.ZodSchema> = {
  'research.manifest.json': ResearchManifestSchema,
  'prd.manifest.json': PrdManifestSchema,
  'ux-flows.manifest.json': UxFlowsManifestSchema,
  'api-spec.manifest.json': ApiSpecManifestSchema,
  'components.manifest.json': ComponentsManifestSchema,
};

// --- Functions ---

export function writeManifest(name: string, data: unknown, baseDir?: string): string {
  const schema = MANIFEST_SCHEMAS[name];
  if (schema) {
    schema.parse(data); // Validate before writing
  }
  return writeArtifact(name, JSON.stringify(data, null, 2), baseDir);
}

export function readManifest<T = unknown>(name: string, baseDir?: string): T {
  const content = readArtifact(name, baseDir);
  const parsed = JSON.parse(content) as T;
  const schema = MANIFEST_SCHEMAS[name];
  if (schema) {
    schema.parse(parsed); // Validate on read
  }
  return parsed;
}

export function getAllManifests(baseDir?: string): Record<string, unknown> {
  const artifacts = listArtifacts(baseDir);
  const manifests: Record<string, unknown> = {};
  for (const name of artifacts) {
    if (name.endsWith('.manifest.json')) {
      manifests[name] = readManifest(name, baseDir);
    }
  }
  return manifests;
}
