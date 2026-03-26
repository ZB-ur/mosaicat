/**
 * Discriminated union for typed error handling.
 * Replaces throw/catch with explicit success/failure branching.
 */
export type Result<T, E = Error> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

/** Create a success Result containing `value`. */
export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

/** Create a failure Result containing `error`. */
export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

/** Type guard: returns true if the Result is a success. */
export function isOk<T, E>(result: Result<T, E>): result is { ok: true; value: T } {
  return result.ok;
}

/** Extract the value from a success Result, or throw the error. */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.ok) return result.value;
  throw result.error instanceof Error ? result.error : new Error(String(result.error));
}
