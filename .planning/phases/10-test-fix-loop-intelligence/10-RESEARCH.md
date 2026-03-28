# Phase 10: Test Fix Loop Intelligence - Research

**Researched:** 2026-03-29
**Domain:** Tester-Coder fix loop classification, stagnation detection, pre-compilation checks
**Confidence:** HIGH

## Summary

This phase enhances the existing `FixLoopRunner` and `TesterAgent` with three capabilities: (1) pre-compilation via `tsc --noEmit` before vitest execution, (2) failure classification into parse/import, assertion, and runtime categories, and (3) stagnation detection that terminates the fix loop early when identical failure sets repeat.

The codebase already has strong foundations: `FixLoopRunner` is a clean 130-line class with round tracking and progressive strategy; `retry-log.ts` already has `classifyError()` and an `ErrorCategory` type; the `coder:fix-round` event already pipes to CLI progress. The work is primarily extending existing abstractions, not creating new ones.

**Primary recommendation:** Extend `FixLoopRunner` with a `FailureClassifier` utility and stagnation detector. Add pre-compilation as the first step in `TesterAgent.run()`. Route classification results through all four visibility channels (logger, test-report.md, eventBus, retry-log).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Keep the existing 5-round progressive strategy (direct-fix -> replan-failed-modules -> full-history-fix) as the upper bound
- **D-02:** Add stagnation detection: when identical failure sets repeat for 2 consecutive rounds, terminate early and produce a stagnation report
- **D-03:** Stagnation report format: concise -- failed test list + error classification + which rounds repeated + suggested manual fix direction. Written to `stagnation-report.md` artifact
- **D-04:** Error classification is the primary axis for fix strategy selection. Three categories: parse/import error, assertion failure, runtime error
- **D-05:** Classification drives fix direction: parse/import errors -> config/dependency fixes; assertion errors -> logic fixes; runtime errors -> environment/setup fixes
- **D-06:** Round number drives escalation intensity (existing progressive strategy), classification drives fix direction. Two dimensions combined: `(error_type, round) -> strategy`
- **D-07:** `tsc --noEmit` runs only on test files (tests/acceptance/ directory) before invoking vitest
- **D-08:** If pre-compilation fails, skip vitest entirely and report the failure as parse/import error category. Saves time and tokens on unfixable infrastructure issues
- **D-09:** Error classification visible in ALL four channels: pipeline logs, test-report.md, CLI progress events, retry-log.ts

### Claude's Discretion
- Exact comparison algorithm for "identical failure sets" (string match, test name set, or error category fingerprint)
- Internal data structures for failure classification
- How to extract error type from vitest output (regex patterns, exit codes, etc.)
- Whether stagnation detection compares full failure output or just test names + error types

### Deferred Ideas (OUT OF SCOPE)
- "Improve pipeline artifact quality" (todo) -- broader artifact quality improvements beyond test fix loop. Relevant parts (test quality) are addressed in this phase; remaining scope deferred.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TEST-01 | Tester runs `tsc --noEmit` on test files before vitest | Pre-compilation pattern in `TesterAgent.run()`, reuse `execSync` pattern from `build-verifier.ts` |
| TEST-02 | Test failures classified into 3 categories (parse/import, assertion, runtime) | Extend existing `classifyError()` in `retry-log.ts`, map to 3 phase-specific categories |
| TEST-03 | Fix loop terminates early on 2 consecutive identical failure sets | Stagnation detector using fingerprinted failure sets in `FixLoopRunner` |
| TEST-04 | Error type maps to fix strategy (parse->config, assertion->logic, runtime->env) | Two-dimensional strategy selector `(errorType, round) -> approach+direction` in `FixLoopRunner.selectApproach()` |
</phase_requirements>

## Architecture Patterns

### Recommended Changes Map

```
src/
├── core/
│   ├── fix-loop-runner.ts        # MODIFY: stagnation detection, classification-driven strategy, stagnation report
│   ├── retry-log.ts              # MODIFY: add 'parse-import' to ErrorCategory, update classifyError()
│   ├── event-bus.ts              # MODIFY: extend coder:fix-round event signature with errorCategory
│   └── cli-progress.ts           # MODIFY: display errorCategory in fix round output
├── agents/
│   └── tester.ts                 # MODIFY: add pre-compilation step before runTests()
└── core/__tests__/
    ├── fix-loop-runner.test.ts   # MODIFY: add stagnation + classification tests
    ├── failure-classifier.test.ts # NEW: unit tests for classification logic
    └── tester-precompile.test.ts  # NEW: unit tests for pre-compilation
```

### Pattern 1: Failure Classification (3-Category Mapping)

**What:** Map vitest/tsc output into exactly 3 categories per D-04
**When to use:** Every fix loop round after tester execution

The existing `classifyError()` in `retry-log.ts` has 8+ categories. Phase 10 needs a coarser 3-category classification specifically for fix strategy routing. Recommend a separate `classifyTestFailure()` function that maps to the 3 categories, keeping `classifyError()` intact for backward compatibility.

```typescript
// New type for fix-loop-specific classification
export type TestFailureCategory = 'parse-import' | 'assertion' | 'runtime';

export interface ClassifiedFailure {
  testName: string;
  category: TestFailureCategory;
  errorSnippet: string;
}

export interface FailureFingerprint {
  /** Sorted set of "testName:category" strings for comparison */
  entries: string[];
  /** SHA-like hash for quick equality check */
  hash: string;
}

/**
 * Classify a single test failure from vitest output.
 * Priority: parse/import > assertion > runtime (fallback)
 */
export function classifyTestFailure(errorText: string): TestFailureCategory {
  const text = errorText.toLowerCase();

  // Parse/import errors: TypeScript compile errors, module resolution, syntax
  if (/cannot find module|module not found|err_module_not_found/i.test(errorText)) return 'parse-import';
  if (/syntaxerror|unexpected token|parsing error/i.test(errorText)) return 'parse-import';
  if (/ts\d{4}:|cannot find name|is not assignable/i.test(errorText)) return 'parse-import';
  if (/cannot resolve|failed to resolve import/i.test(errorText)) return 'parse-import';

  // Assertion errors: expect(), assert, toBe, etc.
  if (/expect\(|assertion|tobe|toequal|tohave|assert\./i.test(errorText)) return 'assertion';
  if (/expected.*received|expected.*but got/i.test(errorText)) return 'assertion';

  // Everything else is runtime
  return 'runtime';
}
```

**Confidence:** HIGH -- patterns derived directly from vitest output format and existing `classifyError()` regexes.

### Pattern 2: Stagnation Detection

**What:** Compare failure fingerprints across consecutive rounds
**When to use:** After each tester execution in the fix loop

**Recommendation for Claude's Discretion (comparison algorithm):** Use test name + category pairs as the fingerprint. Full error text is too noisy (line numbers change between rounds). Test name + error category captures "same tests failing for same reasons" which is what stagnation means.

```typescript
/**
 * Create a fingerprint from classified failures.
 * Uses sorted "testName:category" entries for deterministic comparison.
 */
function createFingerprint(failures: ClassifiedFailure[]): FailureFingerprint {
  const entries = failures
    .map(f => `${f.testName}:${f.category}`)
    .sort();
  // Simple string hash for quick comparison
  const hash = entries.join('|');
  return { entries, hash };
}

/**
 * Check if two fingerprints represent identical failure sets.
 */
function fingerprintsMatch(a: FailureFingerprint, b: FailureFingerprint): boolean {
  return a.hash === b.hash;
}
```

**Confidence:** HIGH -- straightforward set comparison. String concatenation hash is sufficient since the set is small (typically < 20 test names).

### Pattern 3: Two-Dimensional Strategy Selection

**What:** Combine (errorType, round) into strategy
**When to use:** In `FixLoopRunner.selectApproach()`, replacing the current round-only logic

```typescript
/**
 * Extended approach includes both the escalation level (from round)
 * and the fix direction (from error classification).
 */
interface FixStrategy {
  approach: 'direct-fix' | 'replan-failed-modules' | 'full-history-fix';
  direction: 'config-dependency' | 'logic' | 'environment';
}

function selectStrategy(round: number, dominantCategory: TestFailureCategory, replanThreshold: number): FixStrategy {
  // Round determines escalation intensity (existing logic)
  let approach: FixStrategy['approach'];
  if (round < replanThreshold) approach = 'direct-fix';
  else if (round === replanThreshold) approach = 'replan-failed-modules';
  else approach = 'full-history-fix';

  // Category determines fix direction (new logic)
  const directionMap: Record<TestFailureCategory, FixStrategy['direction']> = {
    'parse-import': 'config-dependency',
    'assertion': 'logic',
    'runtime': 'environment',
  };

  return { approach, direction: directionMap[dominantCategory] };
}
```

The `direction` field is injected into `fix-attempt-history.md` and `test-failures-for-coder.md` so the Coder agent knows what kind of fix to attempt.

**Confidence:** HIGH -- clean extension of existing `selectApproach()`.

### Pattern 4: Pre-Compilation Check in TesterAgent

**What:** Run `tsc --noEmit` on test files before vitest
**When to use:** As the first step in `TesterAgent.run()`, after setup but before `runTests()`

```typescript
private runPreCompilation(codeDir: string): { success: boolean; errors: string } {
  try {
    execSync('npx tsc --noEmit --project tsconfig.json', {
      cwd: codeDir,
      timeout: 60_000,
      stdio: 'pipe',
      encoding: 'utf-8',
    });
    return { success: true, errors: '' };
  } catch (err: unknown) {
    const error = err as { stdout?: string; stderr?: string; message?: string };
    const output = `${error.stdout ?? ''}\n${error.stderr ?? ''}`.trim();
    return { success: false, errors: output || error.message || 'Unknown tsc error' };
  }
}
```

Per D-07, scope to test files only. If the generated project has a `tsconfig.json`, use `--project`. If not, use explicit file patterns: `npx tsc --noEmit tests/acceptance/**/*.ts`. The exact command depends on the generated project's tsconfig. The TesterAgent should try `tsconfig.json` first, fall back to direct file glob.

Per D-08, on failure: skip vitest entirely, write the tsc errors as test-report with `parse-import` classification, emit events.

**Confidence:** HIGH -- same pattern as `BuildVerifier.runVerifyCommand()`.

### Anti-Patterns to Avoid
- **Rewriting FixLoopRunner from scratch:** The existing class is well-structured. Extend it, don't replace it
- **Storing full error text in fingerprints:** Error messages contain line numbers and timestamps that change between rounds. Use test name + category only
- **Adding new event types for classification:** Extend the existing `coder:fix-round` event signature instead. Adding new events requires updating all subscribers
- **Parsing vitest JSON reporter output:** The generated projects may not have vitest configured with JSON reporter. Stick with regex parsing of default text output (already proven in `TesterAgent.parseTestCounts()`)

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Test output parsing | Custom vitest output parser | Extend existing regex patterns in `TesterAgent.parseFailures()` | Already handles FAIL lines and counts |
| Error classification | ML-based classifier | Regex-based `classifyTestFailure()` | Deterministic, zero-cost, covers 95%+ of vitest error patterns |
| Fingerprint hashing | crypto.createHash SHA256 | Simple string join comparison | Set size is < 20 items, string comparison is O(n) and sufficient |

## Common Pitfalls

### Pitfall 1: tsc --noEmit Fails Due to Missing tsconfig
**What goes wrong:** Generated project may not have a tsconfig.json, causing tsc to fail with "no input files"
**Why it happens:** QALead writes test files but doesn't always generate tsconfig for the test directory
**How to avoid:** Check for tsconfig.json existence first. If missing, use `npx tsc --noEmit tests/acceptance/**/*.ts --esModuleInterop --moduleResolution node` with explicit flags
**Warning signs:** tsc exit code 1 with "error TS18003: No inputs were found"

### Pitfall 2: Vitest Output Format Varies by Config
**What goes wrong:** Regex patterns fail when vitest reporter is set to something other than default
**Why it happens:** Generated projects might configure vitest differently
**How to avoid:** Use the `--reporter=verbose` flag explicitly in the test command (already done in BuildVerifier). Match both "FAIL" prefix patterns and "AssertionError" / "Error:" patterns
**Warning signs:** `parseTestCounts()` returns all zeros despite test output being non-empty

### Pitfall 3: Stagnation Detection False Positives
**What goes wrong:** Stagnation triggers when failures are slightly different but classified the same
**Why it happens:** Two different assertion errors in the same test get the same fingerprint entry
**How to avoid:** Include a short error snippet hash in the fingerprint, not just test name + category. But keep it coarse enough that trivial diffs (line numbers) don't defeat the comparison
**Warning signs:** Fix loop terminates at round 2 when round 2 actually made partial progress

### Pitfall 4: Event Signature Breaking Change
**What goes wrong:** Extending `coder:fix-round` event breaks existing subscribers
**Why it happens:** Adding a new parameter to the event callback
**How to avoid:** Add new parameters as optional trailing parameters. Existing subscribers that ignore extra params will continue to work. TypeScript will catch compile errors for typed subscribers
**Warning signs:** CLI progress display crashes or shows undefined

### Pitfall 5: Pre-Compilation Adds Latency to Every Round
**What goes wrong:** Running `tsc --noEmit` on every fix loop round doubles the time
**Why it happens:** Pre-compilation was meant for the initial run only
**How to avoid:** Only run pre-compilation once before the first vitest invocation in `TesterAgent.run()`. The fix loop runs tester via `executor.execute()` which calls `TesterAgent.run()` each time -- add a flag or check to skip pre-compilation on fix loop re-runs if the initial compilation passed. Alternatively, keep it every round since tsc is fast (< 5s typically) and catches new import errors introduced by coder fixes
**Warning signs:** Fix loop taking 2x longer than before

## Code Examples

### Stagnation Report Format (D-03)

```markdown
# Stagnation Report

**Detected at:** Round 4
**Identical failure set repeated:** Rounds 3 and 4

## Failed Tests
| Test | Category | Error |
|------|----------|-------|
| auth.test.ts | assertion | Expected 200, received 401 |
| db.test.ts | parse-import | Cannot find module './config' |

## Classification Summary
- parse-import: 1
- assertion: 1
- runtime: 0

## Suggested Fix Direction
- **db.test.ts (parse-import):** Check module paths and tsconfig path mappings. Likely a missing dependency or incorrect import path.
- **auth.test.ts (assertion):** Business logic mismatch. Review the auth handler implementation against the test expectations.
```

### Extended Fix Loop Injection for Coder

```typescript
// Injected into test-failures-for-coder.md with classification context
const classifiedReport = [
  '## Test Failure Analysis',
  '',
  `**Dominant error type:** ${dominantCategory}`,
  `**Fix direction:** ${strategy.direction}`,
  '',
  '## Failures by Category',
  ...classifiedFailures.map(f =>
    `- [${f.category}] ${f.testName}: ${f.errorSnippet.slice(0, 200)}`
  ),
  '',
  strategy.direction === 'config-dependency'
    ? '## Fix Focus: Config/Dependencies\nCheck import paths, missing packages, tsconfig settings, module resolution.'
    : strategy.direction === 'logic'
    ? '## Fix Focus: Logic\nReview the implementation logic. Tests expect different behavior than what the code produces.'
    : '## Fix Focus: Environment/Setup\nCheck test setup, teardown, environment variables, database connections.',
].join('\n');
```

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.0 |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run src/core/__tests__/fix-loop-runner.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TEST-01 | tsc --noEmit before vitest | unit | `npx vitest run src/agents/__tests__/tester-precompile.test.ts -x` | Wave 0 |
| TEST-02 | 3-category failure classification | unit | `npx vitest run src/core/__tests__/failure-classifier.test.ts -x` | Wave 0 |
| TEST-03 | Stagnation detection + early termination | unit | `npx vitest run src/core/__tests__/fix-loop-runner.test.ts -x` | Exists (extend) |
| TEST-04 | Error type -> fix strategy mapping | unit | `npx vitest run src/core/__tests__/fix-loop-runner.test.ts -x` | Exists (extend) |

### Sampling Rate
- **Per task commit:** `npx vitest run src/core/__tests__/fix-loop-runner.test.ts src/core/__tests__/failure-classifier.test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/core/__tests__/failure-classifier.test.ts` -- covers TEST-02 (classifyTestFailure, createFingerprint, fingerprintsMatch)
- [ ] `src/agents/__tests__/tester-precompile.test.ts` -- covers TEST-01 (pre-compilation success/failure paths)
- [ ] Extend `src/core/__tests__/fix-loop-runner.test.ts` -- covers TEST-03, TEST-04 (stagnation detection, strategy selection)

## Sources

### Primary (HIGH confidence)
- Direct code reading: `src/core/fix-loop-runner.ts`, `src/core/retry-log.ts`, `src/agents/tester.ts`, `src/agents/coder/build-verifier.ts`, `src/core/event-bus.ts`, `src/core/stage-executor.ts`, `src/core/pipeline-loop.ts`
- Direct code reading: `src/core/__tests__/fix-loop-runner.test.ts`, `src/__tests__/test-helpers.ts`
- Vitest 4.1.0 locally installed, verified

### Secondary (MEDIUM confidence)
- Vitest output format patterns (based on existing regex in `TesterAgent.parseFailures()` and `BuildVerifier.executeAcceptanceTests()`)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, all changes within existing codebase
- Architecture: HIGH -- extending well-understood existing classes with clear patterns
- Pitfalls: HIGH -- derived from direct code analysis of existing patterns and edge cases

**Research date:** 2026-03-29
**Valid until:** 2026-04-28 (stable domain, internal codebase changes only)
