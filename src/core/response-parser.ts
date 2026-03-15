export interface ParsedResponse {
  artifacts: Map<string, string>;
  manifest?: { name: string; data: unknown };
  clarification?: string;
}

export function parseResponse(raw: string, expectedArtifacts: string[], manifestName?: string): ParsedResponse {
  const result: ParsedResponse = {
    artifacts: new Map(),
  };

  // 1. Check for clarification
  const clarificationMatch = raw.match(
    /<!-- CLARIFICATION -->\s*([\s\S]*?)\s*<!-- END:CLARIFICATION -->/
  );
  if (clarificationMatch) {
    result.clarification = clarificationMatch[1].trim();
    return result;
  }

  // 2. Extract artifacts by delimiter
  for (const name of expectedArtifacts) {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(
      `<!-- ARTIFACT:${escapedName} -->\\s*([\\s\\S]*?)\\s*<!-- END:${escapedName} -->`
    );
    const match = raw.match(pattern);
    if (match) {
      result.artifacts.set(name, match[1].trim());
    }
  }

  // 3. Extract manifest by delimiter
  if (manifestName) {
    const escapedManifest = manifestName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const manifestPattern = new RegExp(
      `<!-- MANIFEST:${escapedManifest} -->\\s*([\\s\\S]*?)\\s*<!-- END:MANIFEST -->`
    );
    const manifestMatch = raw.match(manifestPattern);
    if (manifestMatch) {
      const jsonStr = manifestMatch[1].trim()
        // Strip markdown code fences if present
        .replace(/^```(?:json)?\s*/, '')
        .replace(/\s*```$/, '');
      try {
        result.manifest = { name: manifestName, data: JSON.parse(jsonStr) };
      } catch {
        throw new Error(`Failed to parse manifest JSON for ${manifestName}`);
      }
    }
  }

  // 4. Fallback: single expected artifact, no delimiters found
  if (expectedArtifacts.length === 1 && result.artifacts.size === 0) {
    let content = raw;
    let manifestData: unknown = undefined;

    // Try to extract trailing JSON block as manifest
    if (manifestName) {
      const jsonBlockMatch = raw.match(/```json\s*([\s\S]*?)\s*```\s*$/);
      if (jsonBlockMatch) {
        try {
          manifestData = JSON.parse(jsonBlockMatch[1].trim());
          // Remove the JSON block from the artifact content
          content = raw.slice(0, jsonBlockMatch.index).trim();
        } catch {
          // Ignore JSON parse failure in fallback
        }
      }
    }

    result.artifacts.set(expectedArtifacts[0], content);
    if (manifestData && manifestName) {
      result.manifest = { name: manifestName, data: manifestData };
    }
  }

  return result;
}
