import type { FieldValue } from '../specs/spec.js';

/** One field on one record that must hold one value after the conversation. */
export interface Check {
  /** Stable key: "<alias>.<Field>". */
  key: string;
  kind: 'expect' | 'unchanged';
  alias: string;
  object: string;
  id: string;
  field: string;
  expected: FieldValue;
}

export interface CheckResult extends Check {
  found: boolean;
  actual: FieldValue;
  pass: boolean;
}

export interface VerifyResult {
  verifier: 'crt' | 'local';
  /** Human label; the local verifier is always labelled as not CRT. */
  label: string;
  /** False when the verifier itself could not produce an answer (auth, timeout, CRT error). */
  completed: boolean;
  checks: CheckResult[];
  error?: string;
  evidence: Record<string, unknown>;
}

export interface Verifier {
  readonly name: 'crt' | 'local';
  verify(checks: Check[], runId: string): Promise<VerifyResult>;
}

/**
 * Same rules as the "Check Field" keyword in crt/interceptor_verify.robot, so both verifiers agree:
 * empty matches empty; two numbers compare numerically; booleans ignore case; otherwise the
 * string forms must be identical.
 */
export function valuesMatch(expected: FieldValue, actual: unknown): boolean {
  if (expected === null || expected === '') return actual === null || actual === undefined || actual === '';
  if (actual === null || actual === undefined) return false;
  if (typeof actual === 'boolean') return String(actual).toLowerCase() === String(expected).toLowerCase();
  if (typeof actual === 'number' && typeof expected === 'number') return actual === expected;
  return String(actual) === String(expected);
}
