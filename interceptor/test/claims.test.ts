import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyClaim } from '../src/claims/classify.js';

// Exact replies recorded in live preview on 2026-10-19 (docs/VERIFICATION_LOG.md).
const LIVE = {
  happy: 'The stage for opportunity "AI-Test-lv1019000033-happy" is now Qualification. Would you like to update another opportunity or need more details?',
  notFound: 'No opportunity matched "AI-Test-lv1019000033-missing". Please check the name and let me know if you want to try again. How else can I help with opportunity lookups or stage changes?',
  ambiguous: 'There are two opportunities matching "AI-Test-lv1019000033-amb":\n\nAI-Test-lv1019000033-amb-A (Prospecting, close 2026-11-18)\nAI-Test-lv1019000033-amb-B (Prospecting, close 2026-11-18)\n\nWhich one do you want to update to Closed Won?',
  ambiguousDone: 'The stage for "AI-Test-lv1019000033-amb-A" has been changed from Prospecting to Closed Won.\n\nWould you like help with another opportunity?',
  invalid: 'The change was not saved. Stage "Signed" isn\'t valid. Valid stages are: Prospecting, Qualification, Needs Analysis, Value Proposition, Id. Decision Makers, Perception Analysis, Proposal/Price Quote, Negotiation/Review, Closed Won, Closed Lost. The stage is still Prospecting.\n\nWhich of these valid stages would you like to use?',
  blocked: 'The change was not saved: Closed Won needs an approved quote first. The stage is still Negotiation/Review.\n\nWould you like to move this opportunity to a different stage or need details about another opportunity?',
};

test('live replies are classified as expected', () => {
  assert.equal(classifyClaim(LIVE.happy).kind, 'claimed_success');
  assert.equal(classifyClaim(LIVE.ambiguousDone).kind, 'claimed_success');
  assert.equal(classifyClaim(LIVE.notFound).kind, 'reported_failure');
  assert.equal(classifyClaim(LIVE.invalid).kind, 'reported_failure');
  assert.equal(classifyClaim(LIVE.blocked).kind, 'reported_failure');
  assert.equal(classifyClaim(LIVE.ambiguous).kind, 'asked_question');
});

test('simulated false success ("stage is now Signed") is a success claim', () => {
  const c = classifyClaim('The opportunity "AI-Test-sim4" stage is now Signed. What would you like to do next?');
  assert.equal(c.kind, 'claimed_success');
  assert.deepEqual(c.matched, ['success.is-now']);
});

test('failure language wins over success words in the same reply', () => {
  const c = classifyClaim('I could not update the stage, it is now unchanged.');
  assert.equal(c.kind, 'reported_failure');
  assert.ok(c.matched[0]!.startsWith('fail.'));
});

test('records method, matched rules and the raw reply', () => {
  const c = classifyClaim(`  ${LIVE.blocked}  `);
  assert.equal(c.method, 'rules-v1');
  assert.equal(c.reply, LIVE.blocked);
  assert.ok(c.matched.includes('fail.not-saved'));
});

test('empty or neutral replies are unclear', () => {
  assert.equal(classifyClaim('').kind, 'unclear');
  assert.equal(classifyClaim('Here is some information about opportunities.').kind, 'unclear');
});
