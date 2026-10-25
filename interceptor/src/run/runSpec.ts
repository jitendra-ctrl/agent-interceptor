import { classifyClaim, type Claim } from '../claims/classify.js';
import { setupRecords, snapshot, teardownRecords, type CreatedRecord } from '../data/testData.js';
import type { Conversation, ConversationDriver } from '../drivers/driver.js';
import { render, renderValue, type FieldValue, type InterceptionSpec, type TemplateContext } from '../specs/spec.js';
import { info } from '../util/log.js';
import type { Sf } from '../util/sf.js';
import { decide, type Verdict } from '../verdict/verdict.js';
import type { Check, Verifier, VerifyResult } from '../verify/verifier.js';

export interface SpecRun {
  spec: string;
  action: string;
  utterances: string[];
  records: Array<{ alias: string; object: string; id: string }>;
  baseline: Record<string, Record<string, FieldValue>>;
  conversation: Conversation | null;
  claim: Claim | null;
  verification: VerifyResult | null;
  verdict: Verdict;
  teardown: { kept: boolean; problems: string[] };
  startedAt: string;
  finishedAt: string;
  error?: string;
}

export interface RunDeps {
  sf: Sf;
  driver: ConversationDriver;
  verifier: Verifier;
  keepData: boolean;
}

/** setup → baseline → conversation → verify (org data) → classify claim → verdict → teardown. */
export async function runSpec(spec: InterceptionSpec, ctx: TemplateContext, deps: RunDeps): Promise<SpecRun> {
  const startedAt = new Date().toISOString();
  let records: CreatedRecord[] = [];
  let baseline: SpecRun['baseline'] = {};
  let conversation: Conversation | null = null;
  let verification: VerifyResult | null = null;
  let claim: Claim | null = null;
  let error: string | undefined;
  let utterances: string[] = [];

  try {
    info(`  [${spec.id}] creating ${spec.setup.length} test record(s)`);
    records = await setupRecords(deps.sf, spec, ctx);
    const ids = Object.fromEntries(records.map((r) => [r.alias, r.id]));
    const full: TemplateContext = { ...ctx, ids };

    const fieldsByAlias: Record<string, string[]> = {};
    for (const e of spec.expect) (fieldsByAlias[e.record] ??= []).push(...Object.keys(e.fields));
    for (const m of spec.mustNotChange) (fieldsByAlias[m.record] ??= []).push(...m.fields);
    baseline = await snapshot(deps.sf, records, fieldsByAlias);

    utterances = spec.conversation.map((u) => render(u, full));
    info(`  [${spec.id}] conversation (${deps.driver.name}): ${utterances.map((u) => `"${u}"`).join(' → ')}`);
    conversation = await deps.driver.converse(utterances, spec.timeoutSeconds);
    const last = conversation.turns[conversation.turns.length - 1];
    claim = classifyClaim(last?.reply ?? '');
    info(`  [${spec.id}] agent: "${(last?.reply ?? '').replace(/\s+/g, ' ').slice(0, 160)}"`);

    const checks = buildChecks(spec, records, baseline, full);
    info(`  [${spec.id}] verifying ${checks.length} field check(s) with ${deps.verifier.name}`);
    verification = await deps.verifier.verify(checks, ctx.runId);
  } catch (e) {
    error = (e as Error).message;
  }

  // Teardown runs after any failure above, and its outcome is part of the run record.
  const teardown = { kept: deps.keepData, problems: [] as string[] };
  if (!deps.keepData && records.length) teardown.problems = await teardownRecords(deps.sf, records);

  const verdict = decide({ expectedAction: spec.action, conversation, claim, verification, error });
  return {
    spec: spec.id,
    action: spec.action,
    utterances,
    records: records.map((r) => ({ alias: r.alias, object: r.object, id: r.id })),
    baseline,
    conversation,
    claim,
    verification,
    verdict,
    teardown,
    startedAt,
    finishedAt: new Date().toISOString(),
    error,
  };
}

export function buildChecks(
  spec: InterceptionSpec,
  records: CreatedRecord[],
  baseline: SpecRun['baseline'],
  ctx: TemplateContext,
): Check[] {
  const byAlias = new Map(records.map((r) => [r.alias, r]));
  const checks: Check[] = [];
  for (const e of spec.expect) {
    const r = byAlias.get(e.record)!;
    for (const [field, value] of Object.entries(e.fields)) {
      checks.push({ key: `${e.record}.${field}`, kind: 'expect', alias: e.record, object: r.object, id: r.id, field, expected: renderValue(value, ctx) });
    }
  }
  for (const m of spec.mustNotChange) {
    const r = byAlias.get(m.record)!;
    for (const field of m.fields) {
      checks.push({ key: `${m.record}.${field}`, kind: 'unchanged', alias: m.record, object: r.object, id: r.id, field, expected: baseline[m.record]?.[field] ?? null });
    }
  }
  return checks;
}
