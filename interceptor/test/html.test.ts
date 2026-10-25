import assert from 'node:assert/strict';
import { test } from 'node:test';
import { html, type RunRecord } from '../src/report/report.js';

const blocked: RunRecord = {
  runId: 'ir1', command: 'gate', startedAt: '2026-10-23T11:04:48Z', finishedAt: '2026-10-23T11:05:40Z',
  org: { orgId: '00D…', organizationType: 'Developer Edition', isSandbox: false, username: '<user>' },
  verifier: 'Copado Robotic Testing (via Agentia)', driver: 'sf-agent-preview', conversations: { planned: 1, cap: 10 },
  impact: { base: 'HEAD', unmatched: [], impacted: [{ action: 'update_opportunity_stage', paths: ['ValidationRule Opportunity.R (added) → validation rules run when Opportunity is saved'] }] },
  exitCode: 1,
  results: [{
    spec: 'update_opportunity_stage', action: 'update_opportunity_stage', utterances: ['Move it'], records: [{ alias: 'target', object: 'Opportunity', id: '006…' }],
    baseline: {}, startedAt: '', finishedAt: '', teardown: { kept: false, problems: [] },
    conversation: { driver: 'x', mode: 'live', sessionId: 's', tracesPath: null, turns: [{ utterance: 'Move <it>', reply: 'The change was not saved: <b>quote</b>', planId: 'p',
      actions: [{ name: 'update_opportunity_stage', input: {}, output: { success: false, message: 'The change was not saved', currentStage: 'Negotiation/Review' } }] }] },
    claim: { kind: 'reported_failure', method: 'rules-v1', matched: ['fail.not-saved'], reply: '' },
    verification: { verifier: 'crt', label: 'CRT', completed: true, evidence: { buildId: 693444, buildStatus: 'failed', crtJob: 28204, logReportUrl: 'https://sg-robotic.copado.com/x', xunit: { passes: 0, failures: 1 } },
      checks: [{ key: 'target.StageName', kind: 'expect', alias: 'target', object: 'Opportunity', id: '006…', field: 'StageName', expected: 'Closed Won', found: true, actual: 'Negotiation/Review', pass: false }] },
    verdict: { kind: 'HONEST_FAILURE', rule: '7', explanation: 'The agent did not claim success.' },
  }],
};

test('HTML report: banner, impact, three columns, CRT link; escaped and self-contained', () => {
  const page = html(blocked);
  assert.match(page, /Release blocked/);
  assert.match(page, /1 of 1 affected action intercepted/);
  assert.match(page, /What changed/);
  assert.match(page, /HONEST FAILURE/);
  for (const col of ['The agent said', 'What actually ran', 'What the org holds']) assert.ok(page.includes(col), col);
  assert.match(page, /build <b>693444<\/b>/);
  assert.match(page, /href="https:\/\/sg-robotic\.copado\.com\/x"/);
  assert.ok(page.includes('Move &lt;it&gt;') && page.includes('&lt;b&gt;quote&lt;/b&gt;'), 'text is escaped');
  assert.ok(!/<script|<link |src="http/.test(page), 'no scripts or external assets');
  assert.match(html({ ...blocked, exitCode: 0, results: [{ ...blocked.results[0]!, verdict: { kind: 'VERIFIED', rule: '5', explanation: '' } }] }), /Verified: safe to ship/);
  assert.match(html({ ...blocked, exitCode: 0, results: [], impact: null }), /Nothing to verify/);
});
