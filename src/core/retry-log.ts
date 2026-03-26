import fs from 'node:fs';
import path from 'node:path';
import type { StageName } from './types.js';

const LOG_DIR = '.mosaic';
const LOG_FILE = path.join(LOG_DIR, 'retry-log.jsonl');

export type ErrorCategory =
  | 'type-error'
  | 'import-error'
  | 'syntax-error'
  | 'build-error'
  | 'test-failure'
  | 'rate-limit'
  | 'timeout'
  | 'runtime-error'
  | 'unknown';

export interface RetryLogEntry {
  timestamp: string;
  runId: string;
  stage: StageName;
  source: 'orchestrator' | 'stage-executor' | 'fix-loop-runner' | 'tester-coder-loop' | 'coder-module-fix' | 'coder-acceptance-fix' | 'llm-retry';
  attempt: number;
  errorCategory: ErrorCategory;
  errorMessage: string;
  resolved: boolean;
  module?: string;
}

export interface FailureStat {
  errorCategory: ErrorCategory;
  stage: StageName;
  count: number;
  avgAttempts: number;
  resolvedRate: number;
  sampleErrors: string[];
  lastSeen: string;
}

/**
 * Append a retry log entry to .mosaic/retry-log.jsonl
 */
export function logRetry(entry: RetryLogEntry): void {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const truncated = {
      ...entry,
      errorMessage: entry.errorMessage.slice(0, 2000),
    };
    fs.appendFileSync(LOG_FILE, JSON.stringify(truncated) + '\n');
  } catch {
    // Logging must never fail the pipeline
  }
}

/**
 * Read and parse retry log entries, optionally filtering by date.
 */
export function readRetryLog(since?: Date): RetryLogEntry[] {
  try {
    if (!fs.existsSync(LOG_FILE)) return [];

    const lines = fs.readFileSync(LOG_FILE, 'utf-8').split('\n').filter(Boolean);
    const entries: RetryLogEntry[] = [];

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as RetryLogEntry;
        if (since && new Date(entry.timestamp) < since) continue;
        entries.push(entry);
      } catch {
        // Skip malformed lines
      }
    }

    return entries;
  } catch {
    return [];
  }
}

/**
 * Classify an error message into a category.
 */
export function classifyError(raw: string): ErrorCategory {
  const msg = raw.toLowerCase();

  if (/ts\d{4}:|type '.*' is not assignable|cannot find name|property '.*' does not exist/i.test(raw)) {
    return 'type-error';
  }
  if (/cannot find module|module not found|import.*from|resolve.*module/i.test(raw)) {
    return 'import-error';
  }
  if (/syntaxerror|unexpected token|parsing error/i.test(raw)) {
    return 'syntax-error';
  }
  if (/build failed|npm run build|vite.*error|webpack.*error|esbuild.*error/i.test(raw)) {
    return 'build-error';
  }
  if (/test.*fail|assertion|expect\(|vitest|jest/i.test(raw)) {
    return 'test-failure';
  }
  if (/rate.?limit|429|too many requests|overloaded|capacity/i.test(raw)) {
    return 'rate-limit';
  }
  if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('etimedout')) {
    return 'timeout';
  }
  if (/runtime|referenceerror|typeerror.*at\s/i.test(raw)) {
    return 'runtime-error';
  }

  return 'unknown';
}

/**
 * Aggregate failure statistics from retry log entries.
 * Groups by (errorCategory, stage) and computes counts, avg attempts, resolved rate.
 */
export function getFailureStats(since?: Date): FailureStat[] {
  const entries = readRetryLog(since);
  if (entries.length === 0) return [];

  const groups = new Map<string, RetryLogEntry[]>();

  for (const entry of entries) {
    const key = `${entry.errorCategory}:${entry.stage}`;
    const group = groups.get(key);
    if (group) {
      group.push(entry);
    } else {
      groups.set(key, [entry]);
    }
  }

  const stats: FailureStat[] = [];

  for (const [_key, group] of groups) {
    const first = group[0];
    const resolvedCount = group.filter(e => e.resolved).length;
    const totalAttempts = group.reduce((sum, e) => sum + e.attempt, 0);

    // Collect unique sample errors (up to 3)
    const seen = new Set<string>();
    const samples: string[] = [];
    for (const e of group) {
      const short = e.errorMessage.slice(0, 200);
      if (!seen.has(short) && samples.length < 3) {
        seen.add(short);
        samples.push(short);
      }
    }

    const lastEntry = group.reduce((latest, e) =>
      new Date(e.timestamp) > new Date(latest.timestamp) ? e : latest
    );

    stats.push({
      errorCategory: first.errorCategory,
      stage: first.stage,
      count: group.length,
      avgAttempts: Math.round((totalAttempts / group.length) * 10) / 10,
      resolvedRate: Math.round((resolvedCount / group.length) * 100) / 100,
      sampleErrors: samples,
      lastSeen: lastEntry.timestamp,
    });
  }

  // Sort by count descending
  stats.sort((a, b) => b.count - a.count);
  return stats;
}
