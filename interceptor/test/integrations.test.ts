import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadConfig } from '../src/config/config.js';
import type { Conversation, ConversationDriver } from '../src/drivers/driver.js';
import { actionsFromTrace, SfPreviewDriver } from '../src/drivers/sfPreviewDriver.js';
import { runSpec } from '../src/run/runSpec.js';
import { parseSpec } from '../src/specs/spec.js';
import { Sf } from '../src/util/sf.js';
import { buildRunId, CrtVerifier, parseVerifyLines } from '../src/verify/crtVerifier.js';
import { LocalSoqlVerifier } from '../src/verify/localSoqlVerifier.js';
import type { Check, Verifier, VerifyResult } from '../src/verify/verifier.js';
import { FakeRunner, fixture, has, ok, PKG } from './helpers.js';

const config = loadConfig(join(PKG, 'interceptor.config.yaml'));

test('actions come from FunctionSteps of the recorded live trace, without runtime keys', () => {
  const actions = actionsFromTrace(JSON.parse(fixture('trace-blocked.json')));
  assert.deepEqual(actions.map((a) => a.name), ['find_opportunity', 'update_opportunity_stage']);
  const upd = actions[1]!;
  assert.equal(upd.input.newStage, 'Closed Won');
  assert.equal(upd.output.success, false);
  assert.equal(upd.output.message, 'The change was not saved: Closed Won needs an approved quote first.');
  assert.ok(!('__tool_idx__' in upd.output));
});

test('preview driver: start/send/end with recorded JSON, trace read by planId', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ai-'));
  const send = JSON.parse(fixture('preview-send-blocked.json'));
  const planId = send.result.messages[0].planId;
  const traces = join(root, '.sfdx', 'agents', 'Opportunity_Assistant', 'sessions', 'SESSION-REDACTED', 'traces');
  mkdirSync(traces, { recursive: true });
  writeFileSync(join(traces, `${planId}.json`), fixture('trace-blocked.json'));
  const runner = new FakeRunner([
    [has('preview', 'start', '--use-live-actions'), () => ok(fixture('preview-start.json'))],
    [has('preview', 'send'), () => ok(send)],
    [has('preview', 'end'), () => ok({ status: 0, result: { tracesPath: 'x' } })],
  ]);
  const conv = await new SfPreviewDriver(runner, { alias: 'a', bundle: 'Opportunity_Assistant', projectRoot: root, live: true }).converse(['Move it'], 30);
  assert.equal(conv.mode, 'live');
  assert.equal(conv.turns[0]!.planId, planId);
  assert.match(conv.turns[0]!.reply, /^The change was not saved: Closed Won needs an approved quote first\./);
  assert.deepEqual(conv.turns[0]!.actions.map((a) => a.name), ['find_opportunity', 'update_opportunity_stage']);
  assert.ok(runner.calls.every((c) => c.includes('--json')));
  assert.ok(runner.calls.some((c) => c.includes('end')), 'session is always ended');
});

const checks: Check[] = [
  { key: 'target.StageName', kind: 'expect', alias: 'target', object: 'Opportunity', id: '006A', field: 'StageName', expected: 'Closed Won' },
  { key: 'bystander.StageName', kind: 'unchanged', alias: 'bystander', object: 'Opportunity', id: '006B', field: 'StageName', expected: 'Negotiation/Review' },
];
const iverify = (key: string, actual: string, pass: boolean) => `IVERIFY|${JSON.stringify({ key, found: true, actual, pass })}`;

function crtRunner(runCode: number, buildStatus: string, log: string, runId = 'ir1') {
  // Status output shape recorded from `agentia testing status --json` (fixture agentia-status-failed.json).
  const recorded = JSON.parse(fixture('agentia-status-failed.json')).result[0];
  const build = { ...recorded, id: 900, status: buildStatus, configuration: { executionParameters: [{ key: '-v', type: 'clp', value: `RUN_ID:${runId}` }] } };
  return new FakeRunner([
    [has('testing', 'run'), () => ok(runCode === 0 ? { status: 0, result: {} } : { error: { message: 'Testing run finished with status failed.' } }, runCode)],
    [has('testing', 'status'), () => ok({ status: 0, result: [{ ...build, id: 899, configuration: { executionParameters: [{ value: 'RUN_ID:other' }] } }, build] })],
    [has('testing', 'logs'), () => ok({ status: 0, result: { log } })],
  ]);
}

test('CRT verifier: passes checks as base64 JSON and reads IVERIFY lines (blocked save → failed build)', async () => {
  const runner = crtRunner(1, 'failed', `x\n${iverify('target.StageName', 'Negotiation/Review', false)}\n${iverify('bystander.StageName', 'Negotiation/Review', true)}\n`);
  const r = await new CrtVerifier(runner, { ...config, crt: { ...config.crt!, job: 77 } }, 'https://org').verify(checks, 'ir1');
  assert.equal(r.completed, true);
  assert.deepEqual(r.checks.map((c) => [c.key, c.actual, c.pass]), [['target.StageName', 'Negotiation/Review', false], ['bystander.StageName', 'Negotiation/Review', true]]);
  assert.equal(r.evidence.buildId, 900, 'matched on RUN_ID, not newest build');
  const runCall = runner.calls.find((c) => c.includes('run'))!;
  const b64 = runCall.find((a) => a.startsWith('CHECKS_B64:'))!.slice('CHECKS_B64:'.length);
  assert.deepEqual(JSON.parse(Buffer.from(b64, 'base64').toString()).map((c: any) => c.key), ['target.StageName', 'bystander.StageName']);
  assert.ok(runCall.includes('SF_DOMAIN:https://org'));
});

test('CRT verifier is inconclusive on missing lines, status mismatch, missing job or unknown build', async () => {
  const cfg = { ...config, crt: { ...config.crt!, job: 77 } };
  const partial = await new CrtVerifier(crtRunner(1, 'failed', iverify('target.StageName', 'X', false)), cfg, 'u').verify(checks, 'ir1');
  assert.equal(partial.completed, false);
  assert.match(partial.error!, /did not report checks: bystander\.StageName/);
  const mismatch = await new CrtVerifier(crtRunner(1, 'failed', `${iverify('target.StageName', 'Closed Won', true)}\n${iverify('bystander.StageName', 'Negotiation/Review', true)}`), cfg, 'u').verify(checks, 'ir1');
  assert.equal(mismatch.completed, false);
  const noJob = await new CrtVerifier(crtRunner(0, 'succeeded', ''), { ...config, crt: { ...config.crt!, job: undefined } }, 'u').verify(checks, 'ir1');
  assert.match(noJob.error!, /crt-sync/);
  const unknown = await new CrtVerifier(crtRunner(0, 'succeeded', '', 'someone-else'), cfg, 'u').verify(checks, 'ir1');
  assert.match(unknown.error!, /could not find the CRT build/);
});

test('helpers: RUN_ID from build params and IVERIFY parsing', () => {
  const recorded = JSON.parse(fixture('agentia-status-failed.json')).result[0];
  assert.equal(buildRunId(recorded), 'p0-demo');
  const lines = parseVerifyLines('a\nIVERIFY|{"key":"k","found":true,"actual":1,"pass":true}\nIVERIFY|{bad json}\n');
  assert.deepEqual([...lines.keys()], ['k']);
});

test('local verifier queries each field and is labelled as not CRT', async () => {
  const runner = new FakeRunner([[has('data', 'query'), (c) => ok({ status: 0, result: { records: [{ Id: '1', StageName: c.join(' ').includes('006A') ? 'Closed Won' : 'Negotiation/Review' }] } })]]);
  const r = await new LocalSoqlVerifier(new Sf(runner, 'a', '.')).verify(checks);
  assert.equal(r.label, 'local SOQL (not CRT)');
  assert.deepEqual(r.checks.map((c) => c.pass), [true, true]);
});

const SPEC = parseSpec(
  `action: update_opportunity_stage
setup:
  - {object: Opportunity, alias: target, fields: {Name: "AI-Test-{{runId}}-target", StageName: Negotiation/Review, CloseDate: "{{today+30}}"}}
  - {object: Opportunity, alias: bystander, fields: {Name: "AI-Test-{{runId}}-bystander", StageName: Negotiation/Review, CloseDate: "{{today+30}}"}}
utterance: "Move the opportunity AI-Test-{{runId}}-target to Closed Won"
expect:
  - {record: target, fields: {StageName: Closed Won}}
must_not_change:
  - {record: bystander, fields: [StageName]}
`,
  'spec.yaml',
);

function sfRunner(log: string[]) {
  let n = 0;
  return new FakeRunner([
    [has('create', 'record'), (c) => (log.push(`create ${c[c.indexOf('-v') + 1]}`), ok({ status: 0, result: { id: `006${++n}` } }))],
    [has('delete', 'record'), (c) => (log.push(`delete ${c[c.indexOf('-i') + 1]}`), ok({ status: 0, result: {} }))],
    [has('data', 'query'), () => ok({ status: 0, result: { records: [{ Id: '0061', Name: 'n', StageName: 'Negotiation/Review' }] } })],
  ]);
}
const blockedConversation: ConversationDriver = {
  name: 'fake',
  async converse(utterances): Promise<Conversation> {
    return {
      driver: 'fake', mode: 'live', sessionId: 's', tracesPath: null,
      turns: [{ utterance: utterances[0]!, reply: 'The change was not saved: Closed Won needs an approved quote first.', planId: 'p', actions: actionsFromTrace(JSON.parse(fixture('trace-blocked.json'))) }],
    };
  },
};
const staticVerifier = (pass: boolean): Verifier => ({
  name: 'local',
  async verify(cs): Promise<VerifyResult> {
    return { verifier: 'local', label: 'test', completed: true, evidence: {}, checks: cs.map((c) => ({ ...c, found: true, actual: c.kind === 'expect' && !pass ? 'Negotiation/Review' : c.expected, pass: c.kind === 'unchanged' || pass })) };
  },
});

test('runSpec end to end offline: blocked save → HONEST_FAILURE, records created with AI-Test prefix and deleted', async () => {
  const log: string[] = [];
  const r = await runSpec(SPEC, { runId: 'ir9', today: new Date('2026-10-19T00:00:00Z') }, { sf: new Sf(sfRunner(log), 'a', '.'), driver: blockedConversation, verifier: staticVerifier(false), keepData: false });
  assert.equal(r.verdict.kind, 'HONEST_FAILURE');
  assert.deepEqual(r.utterances, ['Move the opportunity AI-Test-ir9-target to Closed Won']);
  assert.ok(log[0]!.includes("Name='AI-Test-ir9-target'"));
  assert.deepEqual(log.filter((l) => l.startsWith('delete')), ['delete 0062', 'delete 0061']);
  assert.equal(r.claim?.kind, 'reported_failure');
});

test('runSpec: driver failure → INCONCLUSIVE and cleanup still happens; --keep-data keeps records', async () => {
  const log: string[] = [];
  const broken: ConversationDriver = { name: 'broken', converse: async () => { throw new Error('preview start failed'); } };
  const r = await runSpec(SPEC, { runId: 'ir9', today: new Date() }, { sf: new Sf(sfRunner(log), 'a', '.'), driver: broken, verifier: staticVerifier(true), keepData: false });
  assert.equal(r.verdict.kind, 'INCONCLUSIVE');
  assert.match(r.verdict.explanation, /preview start failed/);
  assert.equal(log.filter((l) => l.startsWith('delete')).length, 2);
  const kept: string[] = [];
  const k = await runSpec(SPEC, { runId: 'ir9', today: new Date() }, { sf: new Sf(sfRunner(kept), 'a', '.'), driver: blockedConversation, verifier: staticVerifier(true), keepData: true });
  assert.equal(kept.filter((l) => l.startsWith('delete')).length, 0);
  assert.equal(k.teardown.kept, true);
});

test('setup refuses record names without the AI-Test-<runId> prefix', async () => {
  const bad = parseSpec(`action: x\nsetup:\n  - {object: Opportunity, alias: a, fields: {Name: "Real Customer Deal"}}\nutterance: hi\nexpect:\n  - {record: a, fields: {StageName: X}}\n`, 'b.yaml');
  const log: string[] = [];
  const r = await runSpec(bad, { runId: 'ir9', today: new Date() }, { sf: new Sf(sfRunner(log), 'a', '.'), driver: blockedConversation, verifier: staticVerifier(true), keepData: false });
  assert.equal(r.verdict.kind, 'INCONCLUSIVE');
  assert.match(r.verdict.explanation, /must start with AI-Test-ir9/);
  assert.equal(log.length, 0, 'nothing was created');
});

test('IVERIFY lines parse from a real recorded CRT log (build 691687)', () => {
  const log = JSON.parse(fixture('agentia-logs-verified.json')).result.log;
  const lines = parseVerifyLines(log);
  assert.deepEqual(lines.get('target.StageName'), { found: true, actual: 'Closed Won', pass: true });
  assert.deepEqual(lines.get('bystander.StageName'), { found: true, actual: 'Negotiation/Review', pass: true });
});
