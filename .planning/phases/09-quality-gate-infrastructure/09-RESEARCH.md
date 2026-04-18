# Phase 9: Quality Gate Infrastructure - Research

**Researched:** 2026-03-28
**Domain:** AST-based stub detection, manifest schema extension, pipeline quality gates
**Confidence:** HIGH

## Summary

Phase 9 builds programmatic quality gates that block pipeline advancement when stage output contains stubs, placeholders, or incomplete implementations. The core technical challenge is AST-based stub detection using TypeScript's built-in compiler API (`typescript` package, already a devDependency at v5.9.3). The compiler API provides `ts.createSourceFile()` for single-file AST parsing without requiring a full project compilation -- this is the right tool since we're analyzing generated code files individually, not a type-checked project.

The existing hook infrastructure (BaseAgent pre/post hooks, `getHooksForStage()` registry, mandatory vs warn-only classification) is well-established from Phase 8. The new quality gate hooks follow the exact same `PostRunHook` interface pattern. Manifest schemas in `src/core/manifest.ts` use Zod and are validated at write time via `writeManifest()`. Extending them with `quality_gate` and `implementation_status` fields is a schema-additive change with no backward compatibility concern (new fields are added, existing fields unchanged).

**Primary recommendation:** Build a single `ast-quality-gate.ts` hook module that uses `ts.createSourceFile()` to detect stub patterns, a `quality-gate-collector.ts` module to aggregate per-stage quality data into manifests, and extend Validator to consume the aggregated `quality_gate` fields for the full-pipeline integrity report.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Use TypeScript compiler API for AST parsing to detect stub code. Detect empty function bodies, return null/undefined, empty div shells, empty object bodies.
- **D-02:** AST detection only for Coder/UIDesigner code files (.ts/.tsx/.js/.jsx). Other stages continue using existing regex placeholder-check.
- **D-03:** Existing `placeholder-check.ts` 6 regex patterns preserved. AST detection layered on top, not replacing.
- **D-04:** implementation_status uses AST metrics: function body < 3 lines + return null = stub; TODO/FIXME + partial implementation = partial; else = complete. Programmatic scan, no LLM self-report.
- **D-05:** `code.manifest.json` file entries get `implementation_status` field.
- **D-06:** All-or-nothing blocking: stub and partial both fail mandatory. Coder fix loop can use stub/partial markers to trigger repair.
- **D-07:** Extend existing manifest schemas with `quality_gate` field (stub_count, coverage_gaps, implementation_status etc). No new artifact files.
- **D-08:** Validator aggregates all stage manifest `quality_gate` fields into full-pipeline integrity report.
- **D-09:** Per-stage feature coverage: compare PRD feature list against manifest `covers_features`, gaps recorded to `quality_gate.coverage_gaps`.

### Claude's Discretion
None specified -- all decisions are locked.

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| GATE-01 | Programmatic quality check per stage, block on failure | Hook infrastructure exists (`PostRunHook` + `mandatory: true`), AST gate hook as new mandatory postRun hook for coder/ui_designer |
| GATE-02 | Coder output placeholder scan (empty div, empty function, TODO, return null) | TypeScript compiler API `ts.createSourceFile()` for AST analysis + existing regex patterns preserved |
| GATE-03 | code.manifest file entries annotated with `implementation_status` (stub/partial/complete) | Extend `CodeManifestSchema` in `manifest.ts`, fill via AST scan in `OutputGenerator.generateManifest()` |
| GATE-04 | Cross-stage feature coverage: compare PRD features vs manifest covers_features | Existing `checkFeatureIdTraceability()` in Validator is a reference pattern; generalize to per-stage postRun hook |
| GATE-05 | Validator aggregates quality results into full-pipeline integrity report | Extend Validator to read `quality_gate` from all manifests, append programmatic Check sections |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- TypeScript strict mode, ESM modules, `node:` prefix for builtins
- All imports use `.js` extension (NodeNext resolution)
- Zod for all schema validation
- Hook naming: `PostRunHook` interface with `name`, `mandatory`, `execute(context, output)`
- Logger: `logger.agent(stage, level, event, data?)` -- never console.log
- Agent hook execution: BaseAgent.execute() runs postRun hooks after `run()`, throws `HookFailedError` on mandatory fail
- Commit format: `<type>: <description> (#<issue>)`
- No over-engineering: minimal code for real problems

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| typescript | 5.9.3 | AST parsing via `ts.createSourceFile()` | Already a devDependency; compiler API is built-in, no extra package needed |
| zod | 4.3.6 | Manifest schema extension | Already used for all manifest validation |

### Supporting
No new dependencies required. TypeScript compiler API provides everything needed for single-file AST analysis.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| TypeScript compiler API | ts-morph | Higher-level API but +2MB dependency; raw `ts` API is sufficient for node traversal |
| TypeScript compiler API | @babel/parser + @babel/traverse | Would handle JSX natively but adds ~8MB deps; TS compiler handles TSX already |
| TypeScript compiler API | tree-sitter | Fast but requires native bindings, complex setup; overkill for this use case |

## Architecture Patterns

### Recommended Project Structure
```
src/core/hooks/
  placeholder-check.ts          # EXISTING - regex patterns (preserved)
  traceability-check.ts         # EXISTING - F-NNN/T-NNN tracing
  constitution-compliance.ts    # EXISTING
  ast-quality-gate.ts           # NEW - AST-based stub detection
  feature-coverage-check.ts     # NEW - per-stage PRD coverage check
  index.ts                      # MODIFIED - register new hooks
src/core/
  manifest.ts                   # MODIFIED - extend schemas with quality_gate + implementation_status
  quality-gate-types.ts         # NEW - shared QualityGate type definition
src/agents/
  validator.ts                  # MODIFIED - aggregate quality_gate data
  coder/output-generator.ts     # MODIFIED - fill implementation_status per file
```

### Pattern 1: AST Stub Detection via TypeScript Compiler API
**What:** Parse code files into AST using `ts.createSourceFile()`, walk the tree to detect stub patterns
**When to use:** Analyzing generated .ts/.tsx/.js/.jsx files for implementation completeness
**Example:**
```typescript
// Source: TypeScript compiler API (built-in)
import ts from 'typescript';

function analyzeFile(filePath: string, content: string): FileAnalysis {
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true, // setParentNodes
    filePath.endsWith('.tsx') || filePath.endsWith('.jsx')
      ? ts.ScriptKind.TSX
      : ts.ScriptKind.TS,
  );

  const issues: StubIssue[] = [];

  function visit(node: ts.Node): void {
    // Empty function body detection
    if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isArrowFunction(node)) {
      if (node.body && ts.isBlock(node.body) && node.body.statements.length === 0) {
        issues.push({ type: 'empty-body', line: getLine(sourceFile, node) });
      }
      // return null/undefined only
      if (node.body && ts.isBlock(node.body) && node.body.statements.length === 1) {
        const stmt = node.body.statements[0];
        if (ts.isReturnStatement(stmt) && isNullOrUndefined(stmt.expression)) {
          issues.push({ type: 'return-null', line: getLine(sourceFile, node) });
        }
      }
    }
    // Empty JSX div shell: <div></div> or <div />
    if (ts.isJsxElement(node)) {
      if (node.children.length === 0) {
        issues.push({ type: 'empty-jsx', line: getLine(sourceFile, node) });
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return { filePath, issues };
}
```

### Pattern 2: Quality Gate Data in Manifest
**What:** Each manifest carries a `quality_gate` object with standardized quality metrics
**When to use:** Every stage's manifest gets this field for Validator aggregation
**Example:**
```typescript
// Zod schema extension pattern
const QualityGateSchema = z.object({
  stub_count: z.number(),
  partial_count: z.number(),
  complete_count: z.number(),
  coverage_gaps: z.array(z.string()),  // F-NNN IDs not covered
  blocked: z.boolean(),
}).optional();

// Extended CodeManifestSchema
const CodeManifestSchema = z.object({
  files: z.array(z.object({
    path: z.string(),
    module: z.string(),
    description: z.string(),
    implementation_status: z.enum(['stub', 'partial', 'complete']).optional(),
  })),
  modules: z.array(z.string()),
  covers_tasks: z.array(z.string()),
  covers_features: z.array(z.string()),
  quality_gate: QualityGateSchema,
});
```

### Pattern 3: PostRunHook for Quality Gate (mandatory)
**What:** Hook that reads artifacts written by the agent and performs quality analysis
**When to use:** After coder/ui_designer stages complete
**Example:**
```typescript
// Follows existing PostRunHook interface exactly
export function createAstQualityGateHook(): PostRunHook {
  return {
    name: 'ast-quality-gate',
    mandatory: true, // D-06: all-or-nothing blocking

    async execute(context: AgentContext, _output: string): Promise<AgentHookResult> {
      // Read code files from artifact store
      // Run AST analysis
      // Return pass: false if any stubs detected
    },
  };
}
```

### Anti-Patterns to Avoid
- **LLM self-reporting implementation_status:** D-04 explicitly requires programmatic scanning. Never trust LLM to report its own output quality.
- **Replacing regex patterns with AST:** D-03 says preserve existing 6 regex patterns. AST is additive layer.
- **Creating new artifact files for quality data:** D-07 says extend manifests, not create new artifacts.
- **Analyzing non-code files with AST:** D-02 scopes AST to .ts/.tsx/.js/.jsx only. Other stages use regex.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| TypeScript AST parsing | Custom tokenizer/regex for code structure | `ts.createSourceFile()` + `ts.forEachChild()` | Handles all TS/TSX syntax correctly including generics, decorators, JSX |
| JSX empty element detection | Regex for `<div></div>` | `ts.isJsxElement()` + children check | Handles self-closing, fragments, nested elements, expressions |
| Function body analysis | Line counting on raw text | AST node traversal on Block statements | Correctly handles multi-line strings, comments, nested functions |
| Schema validation | Manual JSON field checking | Zod schema `.parse()` | Already the project standard, auto-validates on write |

**Key insight:** The TypeScript compiler API is already available (v5.9.3 in devDeps) and handles all edge cases of TS/TSX/JS/JSX parsing. Raw text analysis would miss cases like template literals containing "TODO", multi-line comments, and nested function bodies.

## Common Pitfalls

### Pitfall 1: ts.createSourceFile ScriptKind Mismatch
**What goes wrong:** Parsing a .tsx file as TS (not TSX) causes parse errors on JSX syntax, silently producing an empty/broken AST.
**Why it happens:** `createSourceFile` defaults to `ScriptKind.TS` which cannot parse JSX.
**How to avoid:** Always set ScriptKind based on file extension: `.tsx/.jsx` -> `TSX`, `.ts/.js` -> `TS`.
**Warning signs:** AST has 0 children or unexpected `SyntaxKind.Unknown` nodes.

### Pitfall 2: Arrow Functions Without Block Bodies
**What goes wrong:** `const fn = () => value` has no Block body (it's an expression body), checking `node.body.statements` throws.
**Why it happens:** Arrow functions can have either a Block body or an expression body.
**How to avoid:** Check `ts.isBlock(node.body)` before accessing `statements`. Expression bodies are inherently non-empty (they return something).
**Warning signs:** TypeError accessing `.statements` of undefined.

### Pitfall 3: Zod Schema Backward Compatibility
**What goes wrong:** Adding `implementation_status` as required field to `CodeManifestSchema` breaks validation of existing manifests that lack the field.
**Why it happens:** Zod `.parse()` fails on missing required fields.
**How to avoid:** Make new fields `.optional()` in the schema. The quality gate hook fills them post-write, or they're filled during manifest generation.
**Warning signs:** `ZodError: Required at "files[0].implementation_status"` when reading old manifests.

### Pitfall 4: Hook Execution Order vs Artifact Availability
**What goes wrong:** AST quality gate hook runs as PostRunHook but needs to read files from the artifact store that were written during `run()`.
**Why it happens:** PostRunHook receives `output` (the last artifact text) but needs to read multiple code files from store.
**How to avoid:** The hook should read from `context.task` to get `runId`, then use the artifact store path to find code files. Alternatively, inject the store reference via closure when creating the hook.
**Warning signs:** Hook can't find code files because it only has the `output` string.

### Pitfall 5: Feature Coverage Check on design-only Profile
**What goes wrong:** Checking code.manifest coverage_gaps fails because coder stage doesn't run in design-only profile.
**Why it happens:** design-only profile: IC -> Researcher -> PO -> UX -> API -> UI -> Validator. No coder/tester stages.
**How to avoid:** Feature coverage check must gracefully handle missing manifests. Only check manifests that exist for the active profile's stages.
**Warning signs:** Validator crashes trying to read code.manifest.json on design-only run.

## Code Examples

### AST Node Type Detection
```typescript
// Source: TypeScript compiler API (verified available at runtime, v5.9.3)
import ts from 'typescript';

// Key SyntaxKind values for stub detection:
// ts.SyntaxKind.FunctionDeclaration
// ts.SyntaxKind.MethodDeclaration
// ts.SyntaxKind.ArrowFunction
// ts.SyntaxKind.FunctionExpression
// ts.SyntaxKind.JsxElement
// ts.SyntaxKind.JsxSelfClosingElement
// ts.SyntaxKind.ReturnStatement
// ts.SyntaxKind.NullKeyword
// ts.SyntaxKind.VoidExpression
// ts.SyntaxKind.Identifier (for 'undefined')

function isNullOrUndefined(expr: ts.Expression | undefined): boolean {
  if (!expr) return true; // bare `return;`
  if (expr.kind === ts.SyntaxKind.NullKeyword) return true;
  if (ts.isIdentifier(expr) && expr.text === 'undefined') return true;
  if (ts.isVoidExpression(expr)) return true; // void 0
  return false;
}

function getLineNumber(sourceFile: ts.SourceFile, node: ts.Node): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}
```

### Manifest Schema Extension Pattern
```typescript
// Source: existing pattern in src/core/manifest.ts
import { z } from 'zod';

// Shared quality gate schema -- used by all manifests
export const QualityGateSchema = z.object({
  stub_count: z.number(),
  partial_count: z.number(),
  complete_count: z.number(),
  coverage_gaps: z.array(z.string()),
  blocked: z.boolean(),
});

export type QualityGate = z.infer<typeof QualityGateSchema>;

// implementation_status for code files
export const ImplementationStatusSchema = z.enum(['stub', 'partial', 'complete']);
```

### PostRunHook with Store Access
```typescript
// The hook needs store access to read code files.
// Pattern: use closure to capture RunContext or ArtifactStore.
import type { ArtifactStore } from '../artifact-store.js';

export function createAstQualityGateHook(store: ArtifactStore): PostRunHook {
  return {
    name: 'ast-quality-gate',
    mandatory: true,
    async execute(_context: AgentContext, _output: string): Promise<AgentHookResult> {
      // store is available via closure
      const codeDir = `${store.getDir()}/code`;
      // ... scan files, run AST analysis
    },
  };
}
```

**Important:** The hook factory pattern (`createXxxHook()`) is already established by `createTraceabilityCheckHook()`. The AST gate hook should follow the same factory pattern, accepting parameters it needs via closure.

### Validator Quality Aggregation
```typescript
// Extend existing pattern: Validator already appends programmatic checks (Checks 5-8).
// Add new checks that read quality_gate from each manifest.
private checkQualityGateAggregation(): CheckResult {
  const stages = ['research', 'prd', 'ux-flows', 'api-spec', 'components', 'tech-spec', 'code'];
  const gaps: string[] = [];
  let totalStubs = 0;

  for (const stage of stages) {
    try {
      const manifest = readManifest(this.ctx.store, `${stage}.manifest.json`);
      const qg = (manifest as Record<string, unknown>).quality_gate as QualityGate | undefined;
      if (qg) {
        totalStubs += qg.stub_count;
        gaps.push(...qg.coverage_gaps);
      }
    } catch { /* manifest may not exist for this profile */ }
  }
  // ...
}
```

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.0 |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run src/core/__tests__/hooks.test.ts --reporter=verbose` |
| Full suite command | `npx vitest run --reporter=verbose` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| GATE-01 | Mandatory hook blocks pipeline on stub detection | unit | `npx vitest run src/core/__tests__/ast-quality-gate.test.ts -x` | Wave 0 |
| GATE-02 | AST detects empty functions, return null, empty divs, TODO markers | unit | `npx vitest run src/core/__tests__/ast-quality-gate.test.ts -x` | Wave 0 |
| GATE-03 | implementation_status filled per file in code.manifest | unit | `npx vitest run src/core/__tests__/manifest-quality-gate.test.ts -x` | Wave 0 |
| GATE-04 | Feature coverage check compares PRD features vs covers_features | unit | `npx vitest run src/core/__tests__/feature-coverage-check.test.ts -x` | Wave 0 |
| GATE-05 | Validator aggregates quality_gate fields across manifests | unit | `npx vitest run src/agents/__tests__/validator-quality.test.ts -x` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run src/core/__tests__/hooks.test.ts src/core/__tests__/ast-quality-gate.test.ts --reporter=verbose`
- **Per wave merge:** `npx vitest run --reporter=verbose`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/core/__tests__/ast-quality-gate.test.ts` -- covers GATE-01, GATE-02 (AST stub detection logic)
- [ ] `src/core/__tests__/manifest-quality-gate.test.ts` -- covers GATE-03 (implementation_status in manifest)
- [ ] `src/core/__tests__/feature-coverage-check.test.ts` -- covers GATE-04 (PRD feature coverage)
- [ ] `src/agents/__tests__/validator-quality.test.ts` -- covers GATE-05 (Validator aggregation)

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Regex-only placeholder detection | AST + regex layered detection | Phase 9 (this phase) | Catches structural stubs that regex misses (empty function bodies, return null patterns) |
| LLM self-reported quality | Programmatic quality scanning | Phase 9 (this phase) | Eliminates false-positive "complete" reports from LLM |
| Validator as LLM-only checker | Validator as manifest aggregator + LLM | Phase 8 started, Phase 9 extends | Reduces Validator token cost, increases reliability |

## Open Questions

1. **Hook store access pattern**
   - What we know: PostRunHook receives `(context: AgentContext, output: string)`. The context has `task.runId` but no direct store reference.
   - What's unclear: Best way to pass ArtifactStore to the hook. Closure at registration time (like traceability hook) or via context extension.
   - Recommendation: Use factory function with closure (matches `createTraceabilityCheckHook` pattern). The hook registration in `getHooksForStage()` would need the store parameter, which means either passing store to the function or reading it from a known path.

2. **Coder fix loop integration with quality gate failure**
   - What we know: HookFailedError thrown by mandatory postRun hook causes stage-executor catch block to increment retryCount and return `retry` outcome.
   - What's unclear: Whether the retry provides useful feedback to the Coder about which files are stubs.
   - Recommendation: The AST quality gate hook should write a `quality-gate-report.md` artifact before throwing, so the Coder can read it on retry. This follows the pattern of `test-failures-for-coder.md`.

## Sources

### Primary (HIGH confidence)
- `src/core/hooks/placeholder-check.ts` -- existing regex hook pattern, 6 patterns, COMMENT_LINE skip
- `src/core/hooks/index.ts` -- hook registration per stage, mandatory override pattern
- `src/core/hooks/traceability-check.ts` -- factory hook pattern with closures
- `src/core/manifest.ts` -- 11 Zod schemas, MANIFEST_SCHEMAS registry, writeManifest/readManifest
- `src/core/agent.ts` -- BaseAgent hook execution flow, HookFailedError
- `src/core/stage-executor.ts` -- catch block handles HookFailedError as retry
- `src/agents/validator.ts` -- programmatic Check pattern (Checks 5-8), appendCheck method
- `src/agents/coder/output-generator.ts` -- manifest generation, file listing
- TypeScript compiler API v5.9.3 -- verified available at runtime (`ts.createSourceFile`, `ts.forEachChild`)

### Secondary (MEDIUM confidence)
- TypeScript compiler API documentation -- `ts.createSourceFile()` accepts ScriptKind for TSX support

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- TypeScript compiler API already available, no new deps
- Architecture: HIGH -- follows established hook/manifest/validator patterns exactly
- Pitfalls: HIGH -- identified from direct code reading of hook execution flow and schema validation

**Research date:** 2026-03-28
**Valid until:** 2026-04-28 (stable -- internal codebase patterns, no external API changes)
