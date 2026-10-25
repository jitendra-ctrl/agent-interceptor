import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { ConfigError, loadConfig, validateConfig } from '../src/config/config.js';
import { loadSpecs, parseSpec, render, SpecError } from '../src/specs/spec.js';
import { guardDemoOrg, ProductionGuardError } from '../src/util/guard.js';
import { redact, shortId } from '../src/util/redact.js';
import { assertApiName, formatValue, Sf, soqlString } from '../src/util/sf.js';
import { valuesMatch } from '../src/verify/verifier.js';
import { FakeRunner, has, ok, PKG } from './helpers.js';

test('redaction removes tokens, consumer keys and secret JSON fields', () => {
  const text = [
    'token 00D000000000001!AQEAQ.abcdefghijklmnopqrstuvwxyz0123456789',
    'Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345',
    'key 3MVG9abcdefghijklmnopqrstuvwxyz0123456789',
    '{"client_secret": "s3cr3t", "accessToken":"abc", "name":"keep"}',
  ].join('\n');
  const out = redact(text);
  assert.ok(!out.includes('AQEAQ'));
  assert.ok(!out.includes('abcdefghijklmnopqrstuvwxyz012345'));
  assert.ok(!out.includes('3MVG9abc'));
  assert.ok(!out.includes('s3cr3t') && !out.includes('"abc"'));
  assert.ok(out.includes('"name":"keep"'));
  assert.equal(shortId('01a15049-7b03-7cc8-b0db-7c8d4557b840'), '01a15049…');
});

test('screen-safe mode masks IDs and usernames only when INTERCEPTOR_SCREEN_SAFE=1', () => {
  const text = 'org 00D000000000001AAA ok as admin@example.com; target=006000000000001AAA';
  assert.equal(redact(text), text);
  process.env.INTERCEPTOR_SCREEN_SAFE = '1';
  try {
    assert.equal(redact(text), 'org 00D… ok as <user>; target=006…');
  } finally {
    delete process.env.INTERCEPTOR_SCREEN_SAFE;
  }
});

test('the example config loads and resolves paths', () => {
  const c = loadConfig(join(PKG, 'interceptor.config.yaml'));
  assert.equal(c.org.alias, 'interceptor-dev');
  assert.equal(c.project.root, join(PKG, '..'));
  assert.equal(c.specsDir, join(PKG, 'specs'));
  assert.equal(c.crt?.project, 18329);
  assert.equal(c.limits.maxConversations, 10);
});

test('config validation lists every problem', () => {
  assert.throws(
    () => validateConfig({ org: { alias: '' }, verifier: 'other', limits: { maxConversations: -1 } }, '/tmp'),
    (e: Error) =>
      e instanceof ConfigError &&
      /org\.alias/.test(e.message) &&
      /verifier must be/.test(e.message) &&
      /maxConversations/.test(e.message) &&
      /agent\.bundle/.test(e.message),
  );
});

test('the example specs load', () => {
  const specs = loadSpecs(join(PKG, 'specs'));
  assert.deepEqual(specs.map((s) => s.action).sort(), ['find_opportunity', 'update_opportunity_stage']);
  const upd = specs.find((s) => s.action === 'update_opportunity_stage')!;
  assert.deepEqual(upd.conversation, ['Move the opportunity AI-Test-{{runId}}-target to Closed Won']);
  assert.deepEqual(upd.mustNotChange, [{ record: 'bystander', fields: ['StageName'] }]);
});

test('spec validation rejects unknown aliases, bad field names and missing parts', () => {
  const bad = `action: x\nsetup:\n  - {object: Opportunity, alias: a, fields: {"Bad Field": 1}}\nexpect:\n  - {record: b, fields: {StageName: X}}\n`;
  assert.throws(() => parseSpec(bad, 'bad.yaml'), (e: Error) => e instanceof SpecError && /Invalid field name/.test(e.message) && /not a setup alias/.test(e.message) && /utterance/.test(e.message));
});

test('templates render runId, dates and record IDs; unknown placeholders fail', () => {
  const ctx = { runId: 'ir1', today: new Date('2026-10-19T12:00:00Z'), ids: { opp: '006X' } };
  assert.equal(render('AI-Test-{{runId}} {{today}} {{today+30}} {{today-1}} {{opp.Id}}', ctx), 'AI-Test-ir1 2026-10-19 2026-11-18 2026-10-18 006X');
  assert.throws(() => render('{{nope}}', ctx), SpecError);
});

test('value formatting and SOQL safety', () => {
  assert.equal(formatValue("O'Brien"), "'O\\'Brien'");
  assert.equal(formatValue(1000), '1000');
  assert.equal(soqlString("a'b"), "'a\\'b'");
  assert.throws(() => assertApiName('StageName FROM User', 'field'));
  assert.equal(assertApiName('Opportunity.StageName', 'field'), 'Opportunity.StageName');
});

test('value comparison matches the CRT suite rules', () => {
  assert.ok(valuesMatch('Closed Won', 'Closed Won'));
  assert.ok(!valuesMatch('Closed Won', 'closed won'));
  assert.ok(valuesMatch(1000, 1000));
  assert.ok(!valuesMatch('1000', 1000.5));
  assert.ok(valuesMatch(true, true));
  assert.ok(valuesMatch(null, null) && valuesMatch('', null));
  assert.ok(!valuesMatch('x', null));
});

const config = loadConfig(join(PKG, 'interceptor.config.yaml'));
const orgRunner = (id: string, type: string) =>
  new FakeRunner([
    [has('org', 'display'), () => ok({ status: 0, result: { id, instanceUrl: config.org.expectedInstanceUrl, username: 'u@x', apiVersion: '68.0' } })],
    [has('data', 'query'), () => ok({ status: 0, result: { records: [{ Id: id, IsSandbox: false, OrganizationType: type }] } })],
  ]);

test('production guard accepts the demo org and refuses anything else', async () => {
  const good = await guardDemoOrg(new Sf(orgRunner(config.org.expectedOrgId, 'Developer Edition'), 'a', '.'), config);
  assert.equal(good.organizationType, 'Developer Edition');
  await assert.rejects(guardDemoOrg(new Sf(orgRunner('00Dother', 'Developer Edition'), 'a', '.'), config), ProductionGuardError);
  await assert.rejects(guardDemoOrg(new Sf(orgRunner(config.org.expectedOrgId, 'Enterprise Edition'), 'a', '.'), config), /organization type Enterprise Edition/);
});
