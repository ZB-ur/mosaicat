import yaml from 'js-yaml';

const MIN_ENDPOINT_THRESHOLD = 1;

/**
 * Merge duplicate top-level `components:` keys in an OpenAPI YAML string.
 *
 * LLM-generated api-spec.yaml often produces two `components:` blocks:
 *   - First: `components: { securitySchemes: ... }` (near the top)
 *   - Second: `components: { schemas: ... }` (after paths)
 *
 * js-yaml throws "duplicated mapping key" on strict parse.
 * This function merges the two blocks into one before parsing.
 */
export function mergeDuplicateComponentsKey(yamlStr: string): string {
  // Find all top-level `components:` occurrences (column 0, not indented)
  const lines = yamlStr.split('\n');
  const componentStarts: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (/^components:\s*$/.test(lines[i])) {
      componentStarts.push(i);
    }
  }

  if (componentStarts.length <= 1) return yamlStr; // no duplicates

  // Extract the indented block under each `components:` and merge
  // Keep the first occurrence, merge children from subsequent ones
  const firstIdx = componentStarts[0];

  for (let k = 1; k < componentStarts.length; k++) {
    const dupIdx = componentStarts[k];

    // Collect the indented lines under the duplicate
    const childLines: string[] = [];
    for (let j = dupIdx + 1; j < lines.length; j++) {
      // Stop at next top-level key (non-empty, non-comment, no leading space)
      if (lines[j].length > 0 && !lines[j].startsWith(' ') && !lines[j].startsWith('#')) {
        break;
      }
      childLines.push(lines[j]);
    }

    // Remove the duplicate block (components: line + its children)
    const removeCount = 1 + childLines.length;
    lines.splice(dupIdx, removeCount);

    // Find the end of the first components block to append children
    let insertAt = firstIdx + 1;
    for (let j = firstIdx + 1; j < lines.length; j++) {
      if (lines[j].length > 0 && !lines[j].startsWith(' ') && !lines[j].startsWith('#')) {
        insertAt = j;
        break;
      }
      insertAt = j + 1;
    }

    // Insert the children from the duplicate under the first block
    lines.splice(insertAt, 0, ...childLines);
  }

  return lines.join('\n');
}

/**
 * Safely parse an OpenAPI YAML string, handling duplicate `components:` keys.
 */
function safeLoadApiSpec(fullYaml: string): Record<string, unknown> | null {
  // Try direct parse first (fast path)
  try {
    const spec = yaml.load(fullYaml) as Record<string, unknown>;
    if (spec && typeof spec === 'object') return spec;
    return null;
  } catch {
    // Likely duplicate key — try merging
  }

  try {
    const merged = mergeDuplicateComponentsKey(fullYaml);
    const spec = yaml.load(merged) as Record<string, unknown>;
    if (spec && typeof spec === 'object') return spec;
    return null;
  } catch {
    return null;
  }
}

/**
 * Trim an OpenAPI spec to only include endpoints relevant to the given feature IDs.
 * Falls back to full spec if fewer than MIN_ENDPOINT_THRESHOLD endpoints match.
 */
export function trimApiSpec(
  fullYaml: string,
  featureIds: string[],
  prd: string,
): string {
  if (!featureIds.length) return fullYaml;

  const spec = safeLoadApiSpec(fullYaml);
  if (!spec || !spec.paths) return fullYaml;

  const featureEndpointMap = buildFeatureEndpointMap(prd, spec);
  const relevantPaths = new Set<string>();

  for (const fid of featureIds) {
    const endpoints = featureEndpointMap.get(fid.toUpperCase());
    if (endpoints) {
      for (const ep of endpoints) relevantPaths.add(ep);
    }
  }

  // Also try x-covers-features on operations directly
  if (relevantPaths.size === 0) {
    const paths = spec.paths as Record<string, Record<string, unknown>>;
    for (const [pathKey, pathItem] of Object.entries(paths)) {
      if (!pathItem || typeof pathItem !== 'object') continue;
      for (const method of Object.keys(pathItem)) {
        const op = pathItem[method] as Record<string, unknown> | undefined;
        if (!op || typeof op !== 'object') continue;
        const xcf = op['x-covers-features'] as string[] | undefined;
        if (xcf && Array.isArray(xcf)) {
          const upperIds = featureIds.map(f => f.toUpperCase());
          if (xcf.some(f => upperIds.includes(f.toUpperCase()))) {
            relevantPaths.add(pathKey);
          }
        }
      }
    }
  }

  if (relevantPaths.size < MIN_ENDPOINT_THRESHOLD) return fullYaml;

  const paths = spec.paths as Record<string, unknown>;
  const trimmedPaths: Record<string, unknown> = {};
  for (const path of Object.keys(paths)) {
    if (relevantPaths.has(path)) {
      trimmedPaths[path] = paths[path];
    }
  }

  const trimmed: Record<string, unknown> = {};
  if (spec.openapi) trimmed.openapi = spec.openapi;
  if (spec.info) trimmed.info = spec.info;
  if (spec.servers) trimmed.servers = spec.servers;
  trimmed.paths = trimmedPaths;

  // Collect referenced schemas
  const referencedSchemas = collectReferencedSchemas(trimmedPaths, spec);
  if (Object.keys(referencedSchemas).length > 0) {
    trimmed.components = { schemas: referencedSchemas };
  }

  return yaml.dump(trimmed, { lineWidth: 120, noRefs: true });
}

/**
 * Extract only the schemas section from an API spec.
 * Used for composite components that need data type definitions but not endpoint details.
 * Returns YAML string with just the schema definitions.
 */
export function extractSchemasOnly(fullYaml: string): string | null {
  const spec = safeLoadApiSpec(fullYaml);
  if (!spec) return null;

  const schemas = (spec.components as Record<string, unknown>)?.schemas as Record<string, unknown>;
  if (!schemas || Object.keys(schemas).length === 0) return null;

  return yaml.dump(
    { components: { schemas } },
    { lineWidth: 120, noRefs: true },
  );
}

/**
 * Build a map from Feature ID → endpoint paths by scanning PRD content
 * and matching feature mentions near endpoint-like paths.
 */
function buildFeatureEndpointMap(
  prd: string,
  spec: Record<string, unknown>,
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  const paths = Object.keys((spec.paths as Record<string, unknown>) || {});

  // Extract feature sections from PRD
  const featurePattern = /\b(F-\d+)\b/gi;
  const prdLines = prd.split('\n');

  for (let i = 0; i < prdLines.length; i++) {
    const line = prdLines[i];
    const featureMatches = line.match(featurePattern);
    if (!featureMatches) continue;

    // Look at surrounding context (±5 lines) for endpoint references
    const contextStart = Math.max(0, i - 5);
    const contextEnd = Math.min(prdLines.length, i + 6);
    const context = prdLines.slice(contextStart, contextEnd).join('\n');

    for (const fMatch of featureMatches) {
      const fid = fMatch.toUpperCase();
      if (!map.has(fid)) map.set(fid, new Set());

      for (const path of paths) {
        // Match path segments in context (e.g., /tasks, /users, /sprints)
        const pathSegments = path.split('/').filter(s => s && !s.startsWith('{'));
        const matched = pathSegments.some(seg => context.toLowerCase().includes(seg.toLowerCase()));
        if (matched) {
          map.get(fid)!.add(path);
        }
      }
    }
  }

  // If PRD mapping yields nothing, try operation tags/summary matching
  if (map.size === 0) {
    return buildFallbackMap(paths, spec);
  }

  return map;
}

/**
 * Fallback: map features to endpoints by scanning operation summaries/descriptions
 * for feature ID references.
 */
function buildFallbackMap(
  paths: string[],
  spec: Record<string, unknown>,
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  const pathsObj = spec.paths as Record<string, Record<string, unknown>>;

  for (const path of paths) {
    const pathItem = pathsObj[path];
    if (!pathItem) continue;

    for (const method of Object.keys(pathItem)) {
      const op = pathItem[method] as Record<string, unknown> | undefined;
      if (!op || typeof op !== 'object') continue;

      const text = [op.summary, op.description, ...(Array.isArray(op.tags) ? op.tags : [])]
        .filter(Boolean)
        .join(' ');

      const featureMatches = text.match(/\b(F-\d+)\b/gi);
      if (featureMatches) {
        for (const fMatch of featureMatches) {
          const fid = fMatch.toUpperCase();
          if (!map.has(fid)) map.set(fid, new Set());
          map.get(fid)!.add(path);
        }
      }
    }
  }

  return map;
}

/**
 * Collect $ref-referenced schemas from trimmed paths.
 */
function collectReferencedSchemas(
  trimmedPaths: Record<string, unknown>,
  fullSpec: Record<string, unknown>,
): Record<string, unknown> {
  const refs = new Set<string>();
  collectRefs(trimmedPaths, refs);

  const allSchemas = (
    (fullSpec.components as Record<string, unknown>)?.schemas as Record<string, unknown>
  ) || {};

  const result: Record<string, unknown> = {};
  const resolved = new Set<string>();

  // Resolve transitively
  const queue = [...refs];
  while (queue.length > 0) {
    const ref = queue.pop()!;
    if (resolved.has(ref)) continue;
    resolved.add(ref);

    const schemaName = ref.replace('#/components/schemas/', '');
    if (allSchemas[schemaName]) {
      result[schemaName] = allSchemas[schemaName];
      // Check for nested refs
      const nestedRefs = new Set<string>();
      collectRefs(allSchemas[schemaName] as Record<string, unknown>, nestedRefs);
      for (const nr of nestedRefs) {
        if (!resolved.has(nr)) queue.push(nr);
      }
    }
  }

  return result;
}

function collectRefs(obj: unknown, refs: Set<string>): void {
  if (!obj || typeof obj !== 'object') return;
  if (Array.isArray(obj)) {
    for (const item of obj) collectRefs(item, refs);
    return;
  }
  const record = obj as Record<string, unknown>;
  if (typeof record.$ref === 'string' && record.$ref.startsWith('#/components/schemas/')) {
    refs.add(record.$ref);
  }
  for (const val of Object.values(record)) {
    collectRefs(val, refs);
  }
}
