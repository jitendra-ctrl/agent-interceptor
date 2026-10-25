/**
 * Opt-in live tests against the demo org. They talk to the agent with LIVE actions and use CRT.
 *   INTERCEPTOR_LIVE=1 npm test
 * Conversations: find spec 1 + demo scenario 3 (baseline, gate, gate) = 4, within the cap of 10.
 * The demo scenario deploys the demo validation rule and deletes it again (see demo/demo-scenario.sh).
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { PKG } from './helpers.js';

const LIVE = process.env.INTERCEPTOR_LIVE === '1';
const opts = { skip: LIVE ? false : 'set INTERCEPTOR_LIVE=1 to run live tests against the demo org' };
const cli = join(PKG, 'dist', 'src', 'cli.js');

test('live: find_opportunity is VERIFIED (read-only, record unchanged, action in trace)', opts, () => {
  const r = spawnSync('node', [cli, 'gate', '--action', 'find_opportunity', '--json'], { encoding: 'utf8', timeout: 20 * 60_000 });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.verdicts[0].verdict.kind, 'VERIFIED');
  const run = JSON.parse(readFileSync(join(PKG, 'runs', out.runId, 'run.json'), 'utf8'));
  assert.ok(run.results[0].conversation.turns[0].actions.some((a: any) => a.name === 'find_opportunity'));
});

test('live: demo scenario: baseline VERIFIED, rule blocks (gate 1), fix passes (gate 0)', opts, () => {
  const r = spawnSync(join(PKG, 'demo', 'demo-scenario.sh'), [], { encoding: 'utf8', timeout: 45 * 60_000 });
  assert.match(r.stdout, /DEMO SCENARIO: PASS/, r.stdout + r.stderr);
  assert.match(r.stdout, /rule_deleted_from_org":true/);
  assert.equal(r.status, 0);
});
