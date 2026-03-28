import { describe, it, expect } from 'vitest';
import {
  classifyTestFailure,
  classifyTestOutput,
  createFingerprint,
  fingerprintsMatch,
  getDominantCategory,
} from '../failure-classifier.js';
import type { ClassifiedFailure } from '../failure-classifier.js';

describe('classifyTestFailure', () => {
  // parse-import cases
  it('classifies "Cannot find module" as parse-import', () => {
    expect(classifyTestFailure('Cannot find module ./config')).toBe('parse-import');
  });

  it('classifies SyntaxError as parse-import', () => {
    expect(classifyTestFailure('SyntaxError: Unexpected token')).toBe('parse-import');
  });

  it('classifies TS error codes as parse-import', () => {
    expect(classifyTestFailure('TS2304: Cannot find name')).toBe('parse-import');
  });

  it('classifies ERR_MODULE_NOT_FOUND as parse-import', () => {
    expect(classifyTestFailure('ERR_MODULE_NOT_FOUND')).toBe('parse-import');
  });

  it('classifies "failed to resolve import" as parse-import', () => {
    expect(classifyTestFailure('failed to resolve import "./utils"')).toBe('parse-import');
  });

  it('classifies "is not assignable" as parse-import', () => {
    expect(classifyTestFailure('Type string is not assignable to type number')).toBe('parse-import');
  });

  // assertion cases
  it('classifies "Expected 200 Received 401" as assertion', () => {
    expect(classifyTestFailure('Expected 200 Received 401')).toBe('assertion');
  });

  it('classifies expect().toBe() as assertion', () => {
    expect(classifyTestFailure('expect(result).toBe(true)')).toBe('assertion');
  });

  it('classifies AssertionError as assertion', () => {
    expect(classifyTestFailure('AssertionError: expected true to be false')).toBe('assertion');
  });

  // runtime cases
  it('classifies TypeError as runtime', () => {
    expect(classifyTestFailure('TypeError: cannot read property')).toBe('runtime');
  });

  it('classifies ReferenceError as runtime', () => {
    expect(classifyTestFailure('ReferenceError: foo is not defined')).toBe('runtime');
  });

  it('classifies ECONNREFUSED as runtime', () => {
    expect(classifyTestFailure('ECONNREFUSED')).toBe('runtime');
  });

  it('returns runtime as fallback for unknown errors', () => {
    expect(classifyTestFailure('unknown weird error')).toBe('runtime');
  });
});

describe('classifyTestOutput', () => {
  it('parses vitest FAIL blocks into ClassifiedFailure array', () => {
    const output = [
      ' FAIL  tests/acceptance/auth.test.ts',
      'TypeError: cannot read property of undefined',
      '',
      ' FAIL  tests/acceptance/api.test.ts',
      'Cannot find module ./routes',
    ].join('\n');

    const results = classifyTestOutput(output);
    expect(results.length).toBe(2);
    expect(results[0].category).toBe('runtime');
    expect(results[1].category).toBe('parse-import');
  });

  it('returns empty array for output with no FAIL blocks', () => {
    expect(classifyTestOutput('all tests passed')).toEqual([]);
  });
});

describe('createFingerprint', () => {
  it('produces deterministic hash from classified failures', () => {
    const failures: ClassifiedFailure[] = [
      { testName: 'a', category: 'assertion', errorSnippet: 'x' },
    ];
    const fp = createFingerprint(failures);
    expect(fp.hash).toBe('a:assertion');
    expect(fp.entries).toEqual(['a:assertion']);
  });

  it('produces same hash regardless of input order', () => {
    const f1: ClassifiedFailure[] = [
      { testName: 'b', category: 'runtime', errorSnippet: 'y' },
      { testName: 'a', category: 'assertion', errorSnippet: 'x' },
    ];
    const f2: ClassifiedFailure[] = [
      { testName: 'a', category: 'assertion', errorSnippet: 'x' },
      { testName: 'b', category: 'runtime', errorSnippet: 'y' },
    ];
    expect(createFingerprint(f1).hash).toBe(createFingerprint(f2).hash);
  });
});

describe('fingerprintsMatch', () => {
  it('returns true for identical fingerprints', () => {
    const fp1 = createFingerprint([{ testName: 'a', category: 'assertion', errorSnippet: 'x' }]);
    const fp2 = createFingerprint([{ testName: 'a', category: 'assertion', errorSnippet: 'x' }]);
    expect(fingerprintsMatch(fp1, fp2)).toBe(true);
  });

  it('returns false for different fingerprints', () => {
    const fp1 = createFingerprint([{ testName: 'a', category: 'assertion', errorSnippet: 'x' }]);
    const fp2 = createFingerprint([{ testName: 'b', category: 'runtime', errorSnippet: 'y' }]);
    expect(fingerprintsMatch(fp1, fp2)).toBe(false);
  });
});

describe('getDominantCategory', () => {
  it('returns runtime for empty array', () => {
    expect(getDominantCategory([])).toBe('runtime');
  });

  it('returns most frequent category', () => {
    const failures: ClassifiedFailure[] = [
      { testName: 'a', category: 'assertion', errorSnippet: 'x' },
      { testName: 'b', category: 'assertion', errorSnippet: 'y' },
      { testName: 'c', category: 'parse-import', errorSnippet: 'z' },
    ];
    expect(getDominantCategory(failures)).toBe('assertion');
  });

  it('uses priority order parse-import > assertion > runtime on tie', () => {
    const failures: ClassifiedFailure[] = [
      { testName: 'a', category: 'assertion', errorSnippet: 'x' },
      { testName: 'b', category: 'parse-import', errorSnippet: 'y' },
    ];
    expect(getDominantCategory(failures)).toBe('parse-import');
  });

  it('uses priority order assertion > runtime on tie', () => {
    const failures: ClassifiedFailure[] = [
      { testName: 'a', category: 'assertion', errorSnippet: 'x' },
      { testName: 'b', category: 'runtime', errorSnippet: 'y' },
    ];
    expect(getDominantCategory(failures)).toBe('assertion');
  });
});
