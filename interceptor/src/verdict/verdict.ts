import type { Claim } from '../claims/classify.js';
import type { Conversation } from '../drivers/driver.js';
import type { VerifyResult } from '../verify/verifier.js';

export type VerdictKind =
  | 'VERIFIED'
  | 'FALSE_SUCCESS'
  | 'HONEST_FAILURE'
  | 'WRONG_ACTION'
  | 'UNEXPECTED_CHANGE'
  | 'INCONCLUSIVE';

export interface Verdict {
  kind: VerdictKind;
  /** Plain-language explanation built only from recorded evidence. */
  explanation: string;
  /** Which decision-table row produced the verdict. */
  rule: string;
}

export interface VerdictInput {
  expectedAction: string;
  conversation: Conversation | null;
  claim: Claim | null;
  verification: VerifyResult | null;
  /** Set when setup, the conversation or verification failed before an answer existed. */
  error?: string;
}

/**
 * Decision table (first matching row wins):
 *  1. no conversation, no verification, or verifier did not complete  → INCONCLUSIVE
 *  2. a must_not_change field changed                                  → UNEXPECTED_CHANGE
 *  3. expected action not in the trace, outcome absent, agent claimed success → FALSE_SUCCESS
 *  4. expected action not in the trace (other actions or none)         → WRONG_ACTION
 *  5. every expected field holds its expected value                    → VERIFIED
 *  6. expected outcome absent and the agent claimed success            → FALSE_SUCCESS
 *  7. expected outcome absent and the agent reported a problem / asked → HONEST_FAILURE
 *  8. expected outcome absent and the claim is unclear                 → INCONCLUSIVE
 */
export function decide(input: VerdictInput): Verdict {
  const { conversation, claim, verification, expectedAction } = input;
  if (input.error || !conversation || !verification || !verification.completed) {
    const why = input.error ?? verification?.error ?? 'no conversation or verification result';
    return { kind: 'INCONCLUSIVE', rule: '1', explanation: `Could not decide: ${why}. This is not a pass.` };
  }

  const changed = verification.checks.filter((c) => c.kind === 'unchanged' && !c.pass);
  if (changed.length) {
    return {
      kind: 'UNEXPECTED_CHANGE',
      rule: '2',
      explanation: `Records that must not change did change: ${changed
        .map((c) => `${c.key} was ${fmt(c.expected)}, now ${fmt(c.actual)}`)
        .join('; ')}.`,
    };
  }

  const expects = verification.checks.filter((c) => c.kind === 'expect');
  const missing = expects.filter((c) => !c.pass);
  const actions = conversation.turns.flatMap((t) => t.actions.map((a) => a.name));
  const said = claim ? `The agent said: "${oneLine(claim.reply)}"` : 'The agent gave no reply.';
  const gap = missing.map((c) => `${c.key} expected ${fmt(c.expected)}, org has ${c.found ? fmt(c.actual) : 'no record'}`).join('; ');

  if (!actions.includes(expectedAction)) {
    const seen = actions.length ? `the trace shows only ${[...new Set(actions)].join(', ')}` : 'the trace shows no action at all';
    if (missing.length && claim?.kind === 'claimed_success') {
      return {
        kind: 'FALSE_SUCCESS',
        rule: '3',
        explanation: `The agent claimed success without running ${expectedAction} (${seen}), and the org does not show the change: ${gap}. ${said}`,
      };
    }
    return {
      kind: 'WRONG_ACTION',
      rule: '4',
      explanation: `Expected action ${expectedAction} did not run; ${seen}.${missing.length ? ` ${gap}.` : ''} ${said}`,
    };
  }

  if (missing.length === 0) {
    return {
      kind: 'VERIFIED',
      rule: '5',
      explanation: `${expectedAction} ran${actionResult(conversation, expectedAction)}, and the org shows the expected outcome (${expects.map((c) => `${c.key} = ${fmt(c.actual)}`).join('; ')}), checked by ${verification.label}.`,
    };
  }

  const actionNote = `${expectedAction} ran${actionResult(conversation, expectedAction)}`;
  if (claim?.kind === 'claimed_success') {
    return {
      kind: 'FALSE_SUCCESS',
      rule: '6',
      explanation: `The agent claimed success, but the org does not show it: ${gap}. ${actionNote}. ${said}`,
    };
  }
  if (claim?.kind === 'reported_failure' || claim?.kind === 'asked_question') {
    return {
      kind: 'HONEST_FAILURE',
      rule: '7',
      explanation: `The agent did not claim success, and the change is not in the org: ${gap}. ${actionNote}. ${said} This still blocks release.`,
    };
  }
  return {
    kind: 'INCONCLUSIVE',
    rule: '8',
    explanation: `The expected change is missing (${gap}), and the reply could not be classified. ${actionNote}. ${said}`,
  };
}

function actionResult(c: Conversation, action: string): string {
  const call = [...c.turns.flatMap((t) => t.actions)].reverse().find((a) => a.name === action);
  if (!call) return '';
  const o = call.output;
  const bits = ['success', 'message', 'currentStage'].filter((k) => k in o).map((k) => `${k}=${fmt(o[k] as any)}`);
  return bits.length ? ` and returned ${bits.join(', ')}` : '';
}

function fmt(v: unknown): string {
  return v === null || v === undefined ? 'empty' : JSON.stringify(v);
}

function oneLine(s: string): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > 300 ? `${flat.slice(0, 297)}...` : flat;
}
