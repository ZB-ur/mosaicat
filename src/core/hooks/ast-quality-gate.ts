import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';
import type { AgentContext } from '../types.js';
import type { PostRunHook, AgentHookResult } from '../agent.js';
import type { FileAnalysis, StubIssue, StubIssueType } from '../quality-gate-types.js';
import type { ImplementationStatus } from '../quality-gate-types.js';

const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const TODO_FIXME_RE = /\bTODO\b|\bFIXME\b/;

/**
 * Determine TypeScript ScriptKind from file extension.
 */
function getScriptKind(filePath: string): ts.ScriptKind {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.tsx' || ext === '.jsx') return ts.ScriptKind.TSX;
  return ts.ScriptKind.TS;
}

/**
 * Check if a return statement returns null, undefined, void, or bare return.
 */
function isNullishReturn(stmt: ts.ReturnStatement): boolean {
  // bare return
  if (!stmt.expression) return true;
  // return null
  if (stmt.expression.kind === ts.SyntaxKind.NullKeyword) return true;
  // return undefined
  if (ts.isIdentifier(stmt.expression) && stmt.expression.text === 'undefined') return true;
  // return void ...
  if (ts.isVoidExpression(stmt.expression)) return true;
  return false;
}

/**
 * Analyze a single TypeScript/JavaScript file for stub patterns.
 */
export function analyzeFile(filePath: string, content: string): FileAnalysis {
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    getScriptKind(filePath),
  );

  const issues: StubIssue[] = [];
  let functionCount = 0;
  let stubFunctionCount = 0;
  let hasTodoFixme = false;

  function getLine(node: ts.Node): number {
    return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
  }

  function checkFunctionBody(node: ts.Node, body: ts.Block | ts.Expression | undefined): void {
    if (!body) return;

    // Arrow functions with expression body are non-empty by definition
    if (!ts.isBlock(body)) return;

    functionCount++;

    // Empty body
    if (body.statements.length === 0) {
      stubFunctionCount++;
      issues.push({
        type: 'empty-body',
        line: getLine(node),
        detail: `Empty function body at line ${getLine(node)}`,
      });
      return;
    }

    // Single return null/undefined/void/bare
    if (body.statements.length === 1) {
      const stmt = body.statements[0];
      if (ts.isReturnStatement(stmt) && isNullishReturn(stmt)) {
        stubFunctionCount++;
        issues.push({
          type: 'return-null',
          line: getLine(node),
          detail: `Function returns null/undefined at line ${getLine(node)}`,
        });
      }
    }
  }

  function visit(node: ts.Node): void {
    // Check function declarations and expressions
    if (ts.isFunctionDeclaration(node) && node.body) {
      checkFunctionBody(node, node.body);
    } else if (ts.isMethodDeclaration(node) && node.body) {
      checkFunctionBody(node, node.body);
    } else if (ts.isArrowFunction(node)) {
      checkFunctionBody(node, node.body);
    } else if (ts.isFunctionExpression(node) && node.body) {
      checkFunctionBody(node, node.body);
    }

    // Check empty JSX elements
    if (ts.isJsxElement(node) && node.children.length === 0) {
      issues.push({
        type: 'empty-jsx',
        line: getLine(node),
        detail: `Empty JSX element at line ${getLine(node)}`,
      });
    }

    // Check TODO/FIXME in string literals (NOT comments)
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (TODO_FIXME_RE.test(node.text)) {
        hasTodoFixme = true;
        issues.push({
          type: 'todo-fixme',
          line: getLine(node),
          detail: `TODO/FIXME in string literal at line ${getLine(node)}`,
        });
      }
    }
    if (ts.isTemplateExpression(node)) {
      // Check the head
      if (TODO_FIXME_RE.test(node.head.text)) {
        hasTodoFixme = true;
        issues.push({
          type: 'todo-fixme',
          line: getLine(node),
          detail: `TODO/FIXME in template literal at line ${getLine(node)}`,
        });
      }
      // Check spans
      for (const span of node.templateSpans) {
        if (TODO_FIXME_RE.test(span.literal.text)) {
          hasTodoFixme = true;
          issues.push({
            type: 'todo-fixme',
            line: getLine(span),
            detail: `TODO/FIXME in template literal at line ${getLine(span)}`,
          });
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  // For arrow functions with expression body, count them as real functions
  // (already handled: they skip the checkFunctionBody when body is not a Block)
  // However we need to count them toward functionCount for classification
  function countExpressionArrows(node: ts.Node): void {
    if (ts.isArrowFunction(node) && !ts.isBlock(node.body)) {
      functionCount++;
    }
    ts.forEachChild(node, countExpressionArrows);
  }
  countExpressionArrows(sourceFile);

  const status = classifyFileInternal(functionCount, stubFunctionCount, hasTodoFixme);

  return {
    filePath,
    issues,
    status,
    functionCount,
    stubFunctionCount,
    hasTodoFixme,
  };
}

/**
 * Internal classification logic.
 */
function classifyFileInternal(
  functionCount: number,
  stubFunctionCount: number,
  hasTodoFixme: boolean,
): ImplementationStatus {
  if (stubFunctionCount > 0 && stubFunctionCount === functionCount) {
    return 'stub';
  }
  if (hasTodoFixme || (stubFunctionCount > 0 && stubFunctionCount < functionCount)) {
    return 'partial';
  }
  return 'complete';
}

/**
 * Classify a file based on its analysis results.
 */
export function classifyFile(analysis: FileAnalysis): ImplementationStatus {
  return classifyFileInternal(
    analysis.functionCount,
    analysis.stubFunctionCount,
    analysis.hasTodoFixme,
  );
}

/**
 * Recursively find all code files in a directory.
 */
function findCodeFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findCodeFiles(fullPath));
    } else if (CODE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Generate a quality gate report in markdown format.
 */
function generateReport(analyses: FileAnalysis[]): string {
  const lines: string[] = ['# Quality Gate Report', ''];

  const nonComplete = analyses.filter(a => a.status !== 'complete');
  if (nonComplete.length === 0) {
    lines.push('All files passed quality gate checks.');
    return lines.join('\n');
  }

  lines.push('## Stub/Partial Files', '');
  for (const a of nonComplete) {
    lines.push(`- ${a.filePath}: ${a.status} (${a.issues.length} issues)`);
    for (const issue of a.issues) {
      lines.push(`  - line ${issue.line}: ${issue.type}: ${issue.detail}`);
    }
  }

  return lines.join('\n');
}

/**
 * Factory: creates a PostRunHook that performs AST-based stub detection
 * on code files in the artifact directory.
 */
export function createAstQualityGateHook(artifactDir: string): PostRunHook {
  return {
    name: 'ast-quality-gate',
    mandatory: true,

    async execute(_context: AgentContext, _output: string): Promise<AgentHookResult> {
      const codeDir = path.join(artifactDir, 'code');
      const codeFiles = findCodeFiles(codeDir);

      if (codeFiles.length === 0) {
        return { pass: true };
      }

      const analyses: FileAnalysis[] = [];
      for (const filePath of codeFiles) {
        const content = fs.readFileSync(filePath, 'utf-8');
        const relativePath = path.relative(artifactDir, filePath);
        const analysis = analyzeFile(relativePath, content);
        analyses.push(analysis);
      }

      const stubFiles = analyses.filter(a => a.status === 'stub' || a.status === 'partial');
      if (stubFiles.length > 0) {
        // Write report for Coder fix loop
        const report = generateReport(analyses);
        const reportPath = path.join(artifactDir, 'quality-gate-report.md');
        fs.writeFileSync(reportPath, report, 'utf-8');

        const summary = stubFiles
          .map(f => `${f.filePath} (${f.status}, ${f.issues.length} issues)`)
          .join(', ');
        return {
          pass: false,
          message: `Quality gate failed: ${stubFiles.length} stub/partial files: ${summary}`,
        };
      }

      return { pass: true };
    },
  };
}
