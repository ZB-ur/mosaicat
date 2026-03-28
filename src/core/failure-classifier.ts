/**
 * Failure Classifier — Test failure categorization for fix-loop strategy routing.
 *
 * Provides a coarse 3-category classification (parse-import / assertion / runtime)
 * specifically for the Tester→Coder fix loop. This is separate from retry-log.ts
 * classifyError() which has 8+ categories for general retry logging.
 *
 * Consumed by fix-loop-runner.ts to choose repair strategy per D-04.
 */

// --- Types ---

export type TestFailureCategory = 'parse-import' | 'assertion' | 'runtime';

export interface ClassifiedFailure {
  testName: string;
  category: TestFailureCategory;
  errorSnippet: string;
}

export interface FailureFingerprint {
  entries: string[];
  hash: string;
}

// --- Classification ---

const PARSE_IMPORT_PATTERNS: RegExp[] = [
  /cannot find module|module not found|err_module_not_found/i,
  /syntaxerror|unexpected token|parsing error/i,
  /ts\d{4}:|cannot find name|is not assignable/i,
  /cannot resolve|failed to resolve import/i,
];

const ASSERTION_PATTERNS: RegExp[] = [
  /expect\(|assertion|tobe|toequal|tohave|assert\./i,
  /expected.*received|expected.*but got/i,
];

/**
 * Classify a single test failure error text into one of 3 categories.
 * Priority: parse-import > assertion > runtime (fallback).
 */
export function classifyTestFailure(errorText: string): TestFailureCategory {
  for (const pattern of PARSE_IMPORT_PATTERNS) {
    if (pattern.test(errorText)) return 'parse-import';
  }
  for (const pattern of ASSERTION_PATTERNS) {
    if (pattern.test(errorText)) return 'assertion';
  }
  return 'runtime';
}

/**
 * Parse vitest output and classify each FAIL block.
 */
export function classifyTestOutput(vitestOutput: string): ClassifiedFailure[] {
  const results: ClassifiedFailure[] = [];
  const lines = vitestOutput.split('\n');

  // Find FAIL lines and extract error context
  const failPattern = /FAIL\s+(.+?)$/;

  for (let i = 0; i < lines.length; i++) {
    const match = failPattern.exec(lines[i]);
    if (!match) continue;

    const testName = match[1].trim();

    // Collect error text from subsequent lines (up to 10 or next FAIL)
    const errorLines: string[] = [];
    for (let j = i + 1; j < Math.min(i + 11, lines.length); j++) {
      if (failPattern.test(lines[j])) break;
      if (lines[j].trim()) errorLines.push(lines[j].trim());
    }

    const errorSnippet = errorLines.join('\n');
    const category = classifyTestFailure(errorSnippet);

    results.push({ testName, category, errorSnippet });
  }

  return results;
}

// --- Fingerprinting ---

/**
 * Create a deterministic fingerprint from classified failures.
 * Entries are sorted so order of input does not matter.
 */
export function createFingerprint(failures: ClassifiedFailure[]): FailureFingerprint {
  const entries = failures
    .map(f => `${f.testName}:${f.category}`)
    .sort();
  return {
    entries,
    hash: entries.join('|'),
  };
}

/**
 * Compare two fingerprints for equality.
 */
export function fingerprintsMatch(a: FailureFingerprint, b: FailureFingerprint): boolean {
  return a.hash === b.hash;
}

// --- Dominant Category ---

const CATEGORY_PRIORITY: TestFailureCategory[] = ['parse-import', 'assertion', 'runtime'];

/**
 * Get the most frequent failure category. Tie-breaking: parse-import > assertion > runtime.
 * Returns 'runtime' for empty input.
 */
export function getDominantCategory(failures: ClassifiedFailure[]): TestFailureCategory {
  if (failures.length === 0) return 'runtime';

  const counts = new Map<TestFailureCategory, number>();
  for (const f of failures) {
    counts.set(f.category, (counts.get(f.category) ?? 0) + 1);
  }

  let maxCount = 0;
  let dominant: TestFailureCategory = 'runtime';

  for (const cat of CATEGORY_PRIORITY) {
    const count = counts.get(cat) ?? 0;
    if (count > maxCount) {
      maxCount = count;
      dominant = cat;
    }
  }

  return dominant;
}
