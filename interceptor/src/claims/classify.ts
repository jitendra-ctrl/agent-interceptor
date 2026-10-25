/**
 * Classifies what the agent CLAIMED, from its reply text only, with deterministic rules.
 * The claim never decides pass/fail; org data does. The claim is used to tell a false
 * success apart from an honest failure.
 */
export type ClaimKind = 'claimed_success' | 'reported_failure' | 'asked_question' | 'unclear';

export interface Claim {
  kind: ClaimKind;
  method: 'rules-v1';
  /** IDs of the rules that matched, in priority order. */
  matched: string[];
  reply: string;
}

interface Rule {
  id: string;
  kind: ClaimKind;
  pattern: RegExp;
}

// Order matters: failure language is checked first, because failure replies often also contain
// success-like words ("the stage is still X", "would you like to update another one?").
const RULES: Rule[] = [
  { id: 'fail.not-saved', kind: 'reported_failure', pattern: /\b(was not|wasn'?t|not|couldn'?t|could not|cannot|can'?t|unable to|failed to|did not|didn'?t)\b[^.?!]{0,40}\b(save|saved|update|updated|change|changed|move|moved|complete|completed)\b/i },
  { id: 'fail.error-word', kind: 'reported_failure', pattern: /\b(error|failed|failure|blocked|rejected|denied)\b/i },
  { id: 'fail.invalid', kind: 'reported_failure', pattern: /\b(isn'?t|is not|not a) valid\b/i },
  { id: 'fail.still', kind: 'reported_failure', pattern: /\b(is|remains) still\b|\bstill (in|at)\b|\bstage is still\b/i },
  { id: 'fail.no-match', kind: 'reported_failure', pattern: /\bno (opportunity|record|match)[^.?!]{0,30}\b(matched|found|was found)\b|\bcouldn'?t find\b|\bnot found\b/i },
  { id: 'success.is-now', kind: 'claimed_success', pattern: /\b(is now|are now)\b/i },
  { id: 'success.has-been', kind: 'claimed_success', pattern: /\b(has|have) been (changed|updated|moved|set|saved)\b/i },
  { id: 'success.changed-to', kind: 'claimed_success', pattern: /\b(changed|updated|moved|set)\b[^.?!]{0,60}\bto\b/i },
  { id: 'success.word', kind: 'claimed_success', pattern: /\b(successfully|done|completed)\b/i },
];

const QUESTION = /\b(which (one|opportunity|of these)|do you mean|could you (confirm|clarify)|please (confirm|clarify|specify))\b[^?]*\?/i;

export function classifyClaim(reply: string): Claim {
  const text = reply.trim();
  const matched = RULES.filter((r) => r.pattern.test(text));
  const failure = matched.find((r) => r.kind === 'reported_failure');
  const success = matched.find((r) => r.kind === 'claimed_success');
  let kind: ClaimKind;
  if (failure) kind = 'reported_failure';
  else if (QUESTION.test(text)) {
    kind = 'asked_question';
    matched.unshift({ id: 'question.clarify', kind: 'asked_question', pattern: QUESTION });
  } else if (success) kind = 'claimed_success';
  else kind = 'unclear';
  return { kind, method: 'rules-v1', matched: matched.map((r) => r.id), reply: text };
}
