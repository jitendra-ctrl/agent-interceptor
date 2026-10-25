import { assertApiName, soqlString, type Sf } from '../util/sf.js';
import { valuesMatch, type Check, type CheckResult, type Verifier, type VerifyResult } from './verifier.js';

/**
 * Development-loop verifier: queries the org with `sf data query`.
 * Always labelled "local SOQL (not CRT)" in output so it is never mistaken for the CRT check.
 */
export class LocalSoqlVerifier implements Verifier {
  readonly name = 'local' as const;
  constructor(private readonly sf: Sf) {}

  async verify(checks: Check[]): Promise<VerifyResult> {
    const label = 'local SOQL (not CRT)';
    try {
      const results: CheckResult[] = [];
      for (const c of checks) {
        const field = assertApiName(c.field, 'field');
        const rows = await this.sf.query<Record<string, unknown>>(
          `SELECT Id, ${field} FROM ${assertApiName(c.object, 'object')} WHERE Id = ${soqlString(c.id)}`,
        );
        const found = rows.length === 1;
        const actual = (found ? rows[0]![field] : null) as CheckResult['actual'];
        results.push({ ...c, found, actual, pass: found && valuesMatch(c.expected, actual) });
      }
      return { verifier: 'local', label, completed: true, checks: results, evidence: {} };
    } catch (e) {
      return { verifier: 'local', label, completed: false, checks: [], error: (e as Error).message, evidence: {} };
    }
  }
}
