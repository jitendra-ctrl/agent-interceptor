import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GuardResult } from '../util/guard.js';
import type { ImpactReport } from '../impact/impact.js';
import type { SpecRun } from '../run/runSpec.js';
import { redact, shortId } from '../util/redact.js';

export interface RunRecord {
  runId: string;
  command: 'run' | 'gate';
  startedAt: string;
  finishedAt: string;
  org: Pick<GuardResult, 'orgId' | 'organizationType' | 'isSandbox' | 'username'>;
  verifier: string;
  driver: string;
  conversations: { planned: number; cap: number };
  impact: Pick<ImpactReport, 'base' | 'impacted' | 'unmatched'> | null;
  results: SpecRun[];
  exitCode: number;
}

/** Writes run.json and report.md (and report.html on request). Everything is redacted first. */
export function writeRun(runsDir: string, record: RunRecord): string {
  const dir = join(runsDir, record.runId);
  mkdirSync(dir, { recursive: true });
  const safe = sanitise(record);
  writeFileSync(join(dir, 'run.json'), redact(JSON.stringify(safe, null, 2)) + '\n');
  writeFileSync(join(dir, 'report.md'), redact(markdown(safe)));
  return dir;
}

export function readRun(runsDir: string, runId: string): RunRecord {
  return JSON.parse(readFileSync(join(runsDir, runId, 'run.json'), 'utf8')) as RunRecord;
}

/** Session IDs are shortened; trace paths are kept relative. */
function sanitise(record: RunRecord): RunRecord {
  return {
    ...record,
    results: record.results.map((r) => ({
      ...r,
      conversation: r.conversation
        ? { ...r.conversation, sessionId: shortId(r.conversation.sessionId), tracesPath: r.conversation.tracesPath ? '(local .sfdx/agents/…)' : null }
        : null,
    })),
  };
}

export function markdown(r: RunRecord): string {
  const out: string[] = [];
  out.push(`# Agent Interceptor report: ${r.runId}`, '');
  out.push(`- Command: \`${r.command}\`, exit code **${r.exitCode}**`);
  out.push(`- Org: ${r.org.orgId} (${r.org.organizationType}, sandbox: ${r.org.isSandbox}) as ${r.org.username}`);
  out.push(`- Conversation driver: ${r.driver}; verifier: ${r.verifier}`);
  out.push(`- Conversations: ${r.conversations.planned} (cap ${r.conversations.cap})`);
  out.push(`- Started ${r.startedAt}, finished ${r.finishedAt}`, '');
  if (r.impact) {
    out.push(`## Impact (changes since \`${r.impact.base}\`)`, '');
    if (!r.impact.impacted.length) out.push('No agent action is affected by the change.', '');
    for (const i of r.impact.impacted) {
      out.push(`- **${i.action}**`);
      for (const p of i.paths) out.push(`  - ${p}`);
    }
    if (r.impact.unmatched.length) {
      out.push('', `Changed components that matched no action: ${r.impact.unmatched.map((c) => `${c.type} ${c.name}`).join(', ')}`);
    }
    out.push('');
  }
  out.push('## Verdicts', '', '| Spec | Action | Verdict |', '|---|---|---|');
  for (const s of r.results) out.push(`| ${s.spec} | ${s.action} | **${s.verdict.kind}** |`);
  out.push('');
  for (const s of r.results) {
    out.push(`## ${s.spec}: ${s.verdict.kind}`, '', s.verdict.explanation, '');
    out.push(`Decision rule ${s.verdict.rule}. Claim: \`${s.claim?.kind ?? 'none'}\` (${s.claim?.method ?? '-'}; matched ${s.claim?.matched.join(', ') || 'nothing'}).`, '');
    out.push('### Conversation', '');
    for (const t of s.conversation?.turns ?? []) {
      out.push(`- **User:** ${t.utterance}`, `- **Agent:** ${t.reply.replace(/\n+/g, ' ')}`);
      for (const a of t.actions) out.push(`  - action \`${a.name}\` input \`${JSON.stringify(a.input)}\` → output \`${JSON.stringify(a.output)}\``);
      if (!t.actions.length) out.push('  - (no action in the trace for this turn)');
    }
    out.push('', `### Org evidence (${s.verification?.label ?? 'not verified'})`, '');
    out.push('| Check | Kind | Expected | Actual | Pass |', '|---|---|---|---|---|');
    for (const c of s.verification?.checks ?? []) {
      out.push(`| ${c.key} | ${c.kind} | ${JSON.stringify(c.expected)} | ${c.found ? JSON.stringify(c.actual) : '(no record)'} | ${c.pass ? 'yes' : '**no**'} |`);
    }
    if (s.verification?.evidence && Object.keys(s.verification.evidence).length) {
      out.push('', `Verifier evidence: \`${JSON.stringify(s.verification.evidence)}\``);
    }
    out.push('', `Baseline before the conversation: \`${JSON.stringify(s.baseline)}\``);
    out.push(`Test data: ${s.records.map((x) => `${x.alias}=${x.id}`).join(', ') || 'none'}; ${s.teardown.kept ? 'kept (--keep-data)' : s.teardown.problems.length ? `cleanup problems: ${s.teardown.problems.join('; ')}` : 'deleted after the run'}.`);
    if (s.error) out.push('', `Error: ${s.error}`);
    out.push('');
  }
  return out.join('\n') + '\n';
}

export { html } from './html.js';
