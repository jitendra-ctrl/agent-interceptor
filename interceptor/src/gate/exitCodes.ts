import type { VerdictKind } from '../verdict/verdict.js';

export const EXIT = {
  /** Every affected action verified in the org (or nothing was affected). */
  VERIFIED: 0,
  /** At least one interception: FALSE_SUCCESS, HONEST_FAILURE, WRONG_ACTION or UNEXPECTED_CHANGE. */
  INTERCEPTED: 1,
  /** Nothing intercepted, but at least one result is INCONCLUSIVE. Never treated as a pass. */
  INCONCLUSIVE: 2,
  /** Configuration, spec or usage error, or the production guard refused the org. */
  USAGE: 3,
} as const;

const BLOCKING: VerdictKind[] = ['FALSE_SUCCESS', 'HONEST_FAILURE', 'WRONG_ACTION', 'UNEXPECTED_CHANGE'];

export function exitCodeFor(verdicts: VerdictKind[]): number {
  if (verdicts.some((v) => BLOCKING.includes(v))) return EXIT.INTERCEPTED;
  if (verdicts.some((v) => v === 'INCONCLUSIVE')) return EXIT.INCONCLUSIVE;
  return EXIT.VERIFIED;
}
