import yaml from 'js-yaml';

const MIN_ENDPOINT_THRESHOLD = 3;

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

  let spec: Record<string, unknown>;
  try {
    spec = yaml.load(fullYaml) as Record<string, unknown>;
  } catch {
    return fullYaml;
  }

  if (!spec || typeof spec !== 'object' || !spec.paths) return fullYaml;

  const featureEndpointMap = buildFeatureEndpointMap(prd, spec);
  const relevantPaths = new Set<string>();

  for (const fid of featureIds) {
    const endpoints = featureEndpointMap.get(fid.toUpperCase());
    if (endpoints) {
      for (const ep of endpoints) relevantPaths.add(ep);
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
