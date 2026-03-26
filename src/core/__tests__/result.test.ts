import { describe, it, expect } from 'vitest';
import { ok, err, isOk, unwrap } from '../result.js';

describe('Result<T, E>', () => {
  describe('ok()', () => {
    it('returns { ok: true, value }', () => {
      const result = ok(42);
      expect(result).toEqual({ ok: true, value: 42 });
    });

    it('works with string values', () => {
      const result = ok('hello');
      expect(result).toEqual({ ok: true, value: 'hello' });
    });
  });

  describe('err()', () => {
    it('returns { ok: false, error }', () => {
      const result = err('fail');
      expect(result).toEqual({ ok: false, error: 'fail' });
    });

    it('works with Error objects', () => {
      const error = new Error('boom');
      const result = err(error);
      expect(result).toEqual({ ok: false, error });
    });
  });

  describe('isOk()', () => {
    it('returns true for ok results', () => {
      expect(isOk(ok(42))).toBe(true);
    });

    it('returns false for err results', () => {
      expect(isOk(err('fail'))).toBe(false);
    });
  });

  describe('unwrap()', () => {
    it('returns value for ok results', () => {
      expect(unwrap(ok(42))).toBe(42);
    });

    it('throws the Error for err results with Error', () => {
      const error = new Error('x');
      expect(() => unwrap(err(error))).toThrow('x');
    });

    it('throws Error wrapping string for err results with string', () => {
      expect(() => unwrap(err('string-error'))).toThrow('string-error');
    });
  });
});
