import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyClaim } from '../src/claims/classify.js';
import type { Conversation } from '../src/drivers/driver.js';
import { EXIT, exitCodeFor } from '../src/gate/exitCodes.js';
import { decide } from '../src/verdict/verdict.js';
import type { CheckResult, VerifyResult } from '../src/verify/verifier.js';

const conv = (actions: string[], reply: string): Conversation => ({
  driver: 'test',
  mode: 'live',
  sessionId: 's',
  tracesPath: null,
  turns: [{ utterance: 'u', reply, planId: 'p', actions: actions.map((name) => ({ name, input: {}, output: { success: name === 'update_opportunity_stage' ? false : undefined } })) }],
});
const check = (kind: 'expect' | 'unchanged', pass: boolean, actual: unknown = pass ? 'Closed Won' : 'Negotiation/Review'): CheckResult => ({
  key: kind === 'expect' ? 'target.StageName' : 'bystander.StageName',
  kind, alias: 'a', object: 'Opportunity', id: '006x', field: 'StageName',
  expected: kind === 'expect' ? 'Closed Won' : 'Negotiation/Review',
  found: true, actual: actual as any, pass,
});
const verified = (checks: CheckResult[]): VerifyResult => ({ verifier: 'crt', label: 'CRT', completed: true, checks, evidence: {} });
const both = ['find_opportunity', 'update_opportunity_stage'];
const run = (actions: string[], reply: string, checks: CheckResult[]) =>
  decide({ expectedAction: 'update_opportunity_stage', conversation: conv(actions, reply), claim: classifyClaim(reply), verification: verified(checks) });

test('VERIFIED when the org holds the outcome and the action ran', () => {
  const v = run(both, 'The stage is now Closed Won.', [check('expect', true), check('unchanged', true, 'Negotiation/Review')]);
  assert.equal(v.kind, 'VERIFIED');
  assert.equal(v.rule, '5');
});

test('FALSE_SUCCESS when the agent claims success but the org does not show it', () => {
  const v = run(both, 'The stage is now Closed Won.', [check('expect', false)]);
  assert.equal(v.kind, 'FALSE_SUCCESS');
  assert.match(v.explanation, /expected "Closed Won", org has "Negotiation\/Review"/);
});

test('FALSE_SUCCESS when the agent claims success with no action at all', () => {
  const v = run([], 'Done, the stage has been changed to Closed Won.', [check('expect', false)]);
  assert.equal(v.kind, 'FALSE_SUCCESS');
  assert.equal(v.rule, '3');
});

test('HONEST_FAILURE when the agent reports the blocked save', () => {
  const v = run(both, 'The change was not saved: Closed Won needs an approved quote first.', [check('expect', false)]);
  assert.equal(v.kind, 'HONEST_FAILURE');
  assert.match(v.explanation, /still blocks release/);
});

test('WRONG_ACTION when the expected action never ran', () => {
  const v = run(['find_opportunity'], 'It is in Negotiation/Review.', [check('expect', false)]);
  assert.equal(v.kind, 'WRONG_ACTION');
  assert.match(v.explanation, /shows only find_opportunity/);
});

test('UNEXPECTED_CHANGE beats everything else when a protected field changed', () => {
  const v = run(both, 'The stage is now Closed Won.', [check('expect', true), check('unchanged', false, 'Closed Won')]);
  assert.equal(v.kind, 'UNEXPECTED_CHANGE');
});

test('INCONCLUSIVE when verification did not complete or the claim is unclear', () => {
  const v1 = decide({ expectedAction: 'x', conversation: conv(both, 'ok'), claim: null, verification: { ...verified([]), completed: false, error: 'CRT down' } });
  assert.equal(v1.kind, 'INCONCLUSIVE');
  assert.match(v1.explanation, /CRT down.*not a pass/);
  const v2 = run(both, 'Here you go.', [check('expect', false)]);
  assert.equal(v2.kind, 'INCONCLUSIVE');
  const v3 = decide({ expectedAction: 'x', conversation: null, claim: null, verification: null, error: 'preview start failed' });
  assert.equal(v3.kind, 'INCONCLUSIVE');
});

test('exit codes: any interception → 1, else any inconclusive → 2, else 0', () => {
  assert.equal(exitCodeFor([]), EXIT.VERIFIED);
  assert.equal(exitCodeFor(['VERIFIED', 'VERIFIED']), 0);
  assert.equal(exitCodeFor(['VERIFIED', 'INCONCLUSIVE']), 2);
  for (const k of ['FALSE_SUCCESS', 'HONEST_FAILURE', 'WRONG_ACTION', 'UNEXPECTED_CHANGE'] as const) {
    assert.equal(exitCodeFor(['VERIFIED', 'INCONCLUSIVE', k]), 1);
  }
  assert.equal(EXIT.USAGE, 3);
});
