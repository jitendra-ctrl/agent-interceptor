import type { SpecRun } from '../run/runSpec.js';
import type { RunRecord } from './report.js';

/**
 * Self-contained HTML evidence report (no external assets). Layout, top to bottom:
 * status banner → what changed → one card per action: verdict, then "the agent said" /
 * "what actually ran" / "what the org holds" side by side, with the CRT build → details.
 * Text is escaped here; the caller redacts the whole page afterwards.
 */
export function html(r: RunRecord): string {
  const blocking = r.results.filter((s) => !['VERIFIED', 'INCONCLUSIVE'].includes(s.verdict.kind)).length;
  const inconclusive = r.results.filter((s) => s.verdict.kind === 'INCONCLUSIVE').length;
  const status =
    r.exitCode === 1
      ? { cls: 'bad', title: 'Release blocked', sub: `${blocking} of ${r.results.length} affected action${r.results.length === 1 ? '' : 's'} intercepted` }
      : r.exitCode === 2
        ? { cls: 'warn', title: 'Inconclusive: not a pass', sub: `${inconclusive} result${inconclusive === 1 ? '' : 's'} could not be decided` }
        : r.results.length === 0
          ? { cls: 'good', title: 'Nothing to verify', sub: 'No agent action is affected by this change' }
          : { cls: 'good', title: 'Verified: safe to ship', sub: `${r.results.length} affected action${r.results.length === 1 ? '' : 's'} checked in the org` };
  const seconds = Math.max(0, Math.round((Date.parse(r.finishedAt) - Date.parse(r.startedAt)) / 1000));

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agent Interceptor · ${esc(r.runId)}</title>
<style>${CSS}</style></head>
<body>
<header class="top">
  <div class="brand">${SHIELD}<span>Agent Interceptor</span></div>
  <div class="run">run <b>${esc(r.runId)}</b> · ${esc(r.command)} · exit <b>${r.exitCode}</b></div>
</header>

<section class="banner ${status.cls}">
  <div class="banner-icon">${status.cls === 'good' ? CHECK : status.cls === 'bad' ? CROSS : WARN}</div>
  <div>
    <h1>${status.title}</h1>
    <p>${esc(status.sub)}</p>
  </div>
  <div class="chips">
    <span>Verifier: ${esc(r.verifier)}</span>
    <span>Agent: live conversation via ${esc(r.driver)}</span>
    <span>Conversations: ${r.conversations.planned} of ${r.conversations.cap}</span>
    <span>Org: ${esc(r.org.organizationType)}${r.org.isSandbox ? ' (sandbox)' : ''}</span>
    <span>${esc(new Date(r.startedAt).toUTCString().replace(' GMT', ' UTC'))} · ${seconds}s</span>
  </div>
</section>

${impactSection(r)}

${r.results.map(resultCard).join('\n')}

<footer>Agent Interceptor treats the agent's reply as a claim and checks the org. Pass or fail is decided by the
records, not by the reply.</footer>
</body></html>
`;
}

function impactSection(r: RunRecord): string {
  if (!r.impact) return '';
  const rows = r.impact.impacted
    .map(
      (i) => `<div class="impact-row">
      <div class="act"><span class="dot"></span>${esc(i.action)}</div>
      <ul>${i.paths.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
    </div>`,
    )
    .join('');
  const unmatched = r.impact.unmatched.length
    ? `<p class="muted small">Changed but not linked to any action: ${esc(r.impact.unmatched.map((c) => `${c.type} ${c.name}`).join(', '))}</p>`
    : '';
  return `<section class="panel">
  <h2>What changed <span class="muted">since ${esc(r.impact.base)}</span></h2>
  ${rows || '<p class="muted">No agent action is affected by the change.</p>'}
  ${unmatched}
</section>`;
}

function resultCard(s: SpecRun): string {
  const v = s.verdict;
  const tone = v.kind === 'VERIFIED' ? 'good' : v.kind === 'INCONCLUSIVE' ? 'warn' : 'bad';
  const turns = s.conversation?.turns ?? [];
  const chat = turns
    .map(
      (t) => `<div class="bubble user"><span class="who">User</span>${esc(t.utterance)}</div>
      <div class="bubble agent"><span class="who">Agent</span>${esc(t.reply).replace(/\n+/g, '<br>')}</div>`,
    )
    .join('');
  const claim = s.claim
    ? `<div class="claim">Claim read from the reply: <b>${esc(CLAIM_LABEL[s.claim.kind] ?? s.claim.kind)}</b></div>`
    : '';

  const actions = turns.flatMap((t) => t.actions);
  const timeline = actions.length
    ? actions
        .map((a) => {
          const o = a.output as Record<string, unknown>;
          const ok = typeof o.success === 'boolean' ? o.success : null;
          const badge = ok === null ? '' : `<span class="badge ${ok ? 'good' : 'bad'}">success ${ok}</span>`;
          const lines = ['message', 'currentStage', 'previousStage', 'matchCount']
            .filter((k) => o[k] !== undefined && o[k] !== null && o[k] !== '')
            .map((k) => `<div class="kv"><span>${k}</span><code>${esc(String(o[k]))}</code></div>`)
            .join('');
          return `<div class="step"><div class="step-head"><code class="fn">${esc(a.name)}</code>${badge}</div>${lines}</div>`;
        })
        .join('')
    : '<p class="muted">The trace shows no action for this conversation.</p>';

  const checks = (s.verification?.checks ?? [])
    .map(
      (c) => `<div class="check ${c.pass ? 'ok' : 'no'}">
        <div class="check-mark">${c.pass ? '✔' : '✕'}</div>
        <div class="check-body">
          <div class="check-key">${esc(c.key)} <span class="tag">${c.kind === 'expect' ? 'expected change' : 'must not change'}</span></div>
          <div class="check-vals"><span>expected</span><code>${esc(fmt(c.expected))}</code><span>org has</span><code class="${c.pass ? '' : 'bad-text'}">${c.found ? esc(fmt(c.actual)) : 'no record'}</code></div>
        </div>
      </div>`,
    )
    .join('');
  const ev = (s.verification?.evidence ?? {}) as Record<string, any>;
  const crt = ev.buildId
    ? `<div class="crt">
        <div class="crt-head"><span>Copado Robotic Testing</span><span class="badge ${ev.buildStatus === 'succeeded' ? 'good' : 'bad'}">${esc(String(ev.buildStatus))}</span></div>
        <div class="crt-meta">build <b>${esc(String(ev.buildId))}</b> · job ${esc(String(ev.crtJob))}${ev.xunit ? ` · ${ev.xunit.passes} passed, ${ev.xunit.failures} failed` : ''}</div>
        ${ev.logReportUrl ? `<a href="${esc(String(ev.logReportUrl))}" target="_blank" rel="noopener">Open the CRT report ↗</a>` : ''}
      </div>`
    : `<div class="crt"><div class="crt-head"><span>${esc(s.verification?.label ?? 'Not verified')}</span></div></div>`;

  const teardown = s.teardown.kept
    ? 'kept (--keep-data)'
    : s.teardown.problems.length
      ? `cleanup problems: ${s.teardown.problems.join('; ')}`
      : 'deleted after the run';

  return `<section class="result ${tone}">
  <div class="result-head">
    <div><div class="muted small">Action</div><h2>${esc(s.action)}</h2></div>
    <div class="verdict ${tone}">${esc(v.kind.replace(/_/g, ' '))}</div>
  </div>
  <p class="headline">${esc(HEADLINE[v.kind] ?? v.kind)}</p>
  <div class="cols">
    <div class="col"><h3><span class="n">1</span>The agent said</h3>${chat || '<p class="muted">No conversation.</p>'}${claim}</div>
    <div class="col"><h3><span class="n">2</span>What actually ran</h3><div class="timeline">${timeline}</div></div>
    <div class="col"><h3><span class="n">3</span>What the org holds</h3>${checks || '<p class="muted">No checks.</p>'}${crt}</div>
  </div>
  <details>
    <summary>Details</summary>
    <div class="details">
      <div class="kv"><span>explanation</span><code>${esc(v.explanation)}</code></div>
      <div class="kv"><span>decision rule</span><code>${esc(v.rule)}</code></div>
      <div class="kv"><span>claim rules matched</span><code>${esc(s.claim?.matched.join(', ') || 'none')}</code></div>
      <div class="kv"><span>baseline</span><code>${esc(JSON.stringify(s.baseline))}</code></div>
      <div class="kv"><span>test data</span><code>${esc(s.records.map((x) => `${x.alias}=${x.id}`).join(', ') || 'none')}; ${esc(teardown)}</code></div>
      ${s.error ? `<div class="kv"><span>error</span><code>${esc(s.error)}</code></div>` : ''}
    </div>
  </details>
</section>`;
}

const HEADLINE: Record<string, string> = {
  VERIFIED: 'The org shows the expected outcome. Safe to ship.',
  FALSE_SUCCESS: "The agent claimed success, but the org doesn't show it.",
  HONEST_FAILURE: "The agent reported the failure honestly, but the change isn't in the org. This still blocks the release.",
  WRONG_ACTION: "The action this change affects didn't run.",
  UNEXPECTED_CHANGE: 'Records that must not change did change.',
  INCONCLUSIVE: "Agent Interceptor couldn't decide. This is not a pass.",
};

const CLAIM_LABEL: Record<string, string> = {
  claimed_success: 'claimed success',
  reported_failure: 'reported a failure',
  asked_question: 'asked a question',
  unclear: 'unclear',
};

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmt(v: unknown): string {
  return v === null || v === undefined ? 'empty' : String(v);
}

const SHIELD = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 2 20 5.5 19.3 13c-.6 4-3.6 7-7.3 9-3.7-2-6.7-5-7.3-9L4 5.5Z" fill="rgba(90,209,161,.18)" stroke="#5ad1a1" stroke-width="1.8"/><path d="m8.2 12.2 2.6 2.7 5-5.6" fill="none" stroke="#5ad1a1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const CHECK = `<svg viewBox="0 0 24 24" width="30" height="30"><path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const CROSS = `<svg viewBox="0 0 24 24" width="30" height="30"><path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>`;
const WARN = `<svg viewBox="0 0 24 24" width="30" height="30"><path d="M12 7v6m0 4h.01" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>`;

const CSS = `
:root { --bg:#070b18; --panel:rgba(255,255,255,.05); --line:rgba(255,255,255,.11); --ink:#f4f6fb; --muted:#9aa6c2;
  --good:#5ad1a1; --bad:#ff5d6c; --warn:#ffd166; --blue:#6aa8ff;
  font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",sans-serif; color-scheme: dark; }
* { box-sizing:border-box; }
body { margin:0; background:var(--bg); color:var(--ink); font-size:16px; line-height:1.45;
  background-image: radial-gradient(60vmax 40vmax at 0% 0%, rgba(43,92,255,.18), transparent 60%),
    radial-gradient(50vmax 40vmax at 100% 20%, rgba(18,163,122,.14), transparent 60%); background-attachment: fixed; }
body > * { max-width:1240px; margin-left:auto; margin-right:auto; }
.top { display:flex; justify-content:space-between; align-items:center; padding:22px 24px 10px; }
.brand { display:flex; align-items:center; gap:10px; font-weight:700; font-size:17px; letter-spacing:.2px; }
.run { color:var(--muted); font-size:14px; } .run b { color:var(--ink); }
.banner { display:grid; grid-template-columns:auto 1fr; gap:6px 18px; align-items:center; margin:12px 24px 18px; padding:22px 26px;
  border-radius:18px; border:1px solid var(--line); background:var(--panel); position:relative; overflow:hidden; }
.banner::before { content:""; position:absolute; inset:0 auto 0 0; width:6px; background:currentColor; }
.banner.good { color:var(--good); } .banner.bad { color:var(--bad); } .banner.warn { color:var(--warn); }
.banner h1 { margin:0; font-size:30px; color:currentColor; letter-spacing:-.3px; }
.banner p { margin:2px 0 0; color:var(--ink); }
.banner-icon { width:54px; height:54px; border-radius:50%; display:grid; place-items:center; background:color-mix(in srgb, currentColor 16%, transparent); }
.chips { grid-column:1 / -1; display:flex; flex-wrap:wrap; gap:8px; margin-top:12px; }
.chips span { color:var(--muted); font-size:13px; border:1px solid var(--line); border-radius:999px; padding:4px 11px; }
.panel, .result { margin:0 24px 18px; padding:20px 24px; border-radius:18px; border:1px solid var(--line); background:var(--panel);
  backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); }
h2 { margin:0 0 10px; font-size:19px; } h3 { margin:0 0 12px; font-size:14px; text-transform:uppercase; letter-spacing:.8px; color:var(--muted);
  display:flex; align-items:center; gap:8px; }
.n { display:inline-grid; place-items:center; width:20px; height:20px; border-radius:50%; background:var(--line); color:var(--ink); font-size:12px; }
.muted { color:var(--muted); font-weight:400; } .small { font-size:13px; }
.impact-row { display:grid; grid-template-columns:260px 1fr; gap:14px; padding:10px 0; border-top:1px solid var(--line); }
.impact-row:first-of-type { border-top:0; }
.impact-row ul { margin:0; padding-left:18px; color:var(--muted); }
.act { font-weight:600; display:flex; align-items:center; gap:8px; font-family:ui-monospace,Menlo,monospace; font-size:14px; }
.dot { width:9px; height:9px; border-radius:50%; background:var(--blue); box-shadow:0 0 0 4px color-mix(in srgb, var(--blue) 22%, transparent); }
.result { border-top:3px solid var(--line); } .result.good { border-top-color:var(--good); } .result.bad { border-top-color:var(--bad); } .result.warn { border-top-color:var(--warn); }
.result-head { display:flex; justify-content:space-between; align-items:center; gap:16px; }
.result-head h2 { margin:2px 0 0; font-family:ui-monospace,Menlo,monospace; font-size:20px; }
.verdict { font-weight:800; letter-spacing:.6px; padding:8px 16px; border-radius:12px; font-size:15px; white-space:nowrap; }
.verdict.good { color:var(--good); background:color-mix(in srgb, var(--good) 15%, transparent); }
.verdict.bad { color:var(--bad); background:color-mix(in srgb, var(--bad) 15%, transparent); }
.verdict.warn { color:var(--warn); background:color-mix(in srgb, var(--warn) 15%, transparent); }
.headline { margin:10px 0 18px; font-size:18px; font-weight:600; }
.cols { display:grid; grid-template-columns:repeat(3, minmax(0,1fr)); gap:16px; }
@media (max-width: 980px) { .cols { grid-template-columns:1fr; } .impact-row { grid-template-columns:1fr; } }
.col { border:1px solid var(--line); border-radius:14px; padding:16px; background:color-mix(in srgb, var(--panel) 60%, transparent); }
.bubble { padding:10px 13px; border-radius:14px; margin:0 0 10px; max-width:92%; font-size:14.5px; }
.bubble .who { display:block; font-size:11.5px; opacity:.7; margin-bottom:3px; text-transform:uppercase; letter-spacing:.6px; }
.bubble.user { margin-left:auto; background:#2b5cff; color:#fff; border-bottom-right-radius:4px; }
.bubble.agent { background:var(--line); border-bottom-left-radius:4px; }
.claim { font-size:13px; color:var(--muted); margin-top:6px; }
.timeline { position:relative; padding-left:16px; border-left:2px solid var(--line); }
.step { position:relative; margin:0 0 14px; } .step::before { content:""; position:absolute; left:-22px; top:6px; width:10px; height:10px;
  border-radius:50%; background:var(--blue); }
.step-head { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:4px; }
.fn { font-weight:700; font-size:13.5px; }
.kv { display:grid; grid-template-columns:110px 1fr; gap:8px; font-size:13px; margin:3px 0; }
.kv span { color:var(--muted); } code { font-family:ui-monospace,Menlo,monospace; font-size:12.5px; word-break:break-word; }
.badge { font-size:11.5px; font-weight:800; letter-spacing:.5px; padding:2px 8px; border-radius:7px; text-transform:uppercase; }
.badge.good { color:var(--good); background:color-mix(in srgb, var(--good) 16%, transparent); }
.badge.bad { color:var(--bad); background:color-mix(in srgb, var(--bad) 16%, transparent); }
.check { display:grid; grid-template-columns:28px 1fr; gap:8px; padding:10px 0; border-bottom:1px dashed var(--line); }
.check-mark { width:24px; height:24px; border-radius:50%; display:grid; place-items:center; font-weight:800; font-size:13px; }
.check.ok .check-mark { color:var(--good); background:color-mix(in srgb, var(--good) 16%, transparent); }
.check.no .check-mark { color:var(--bad); background:color-mix(in srgb, var(--bad) 16%, transparent); }
.check-key { font-family:ui-monospace,Menlo,monospace; font-size:13.5px; font-weight:700; }
.tag { font-family:-apple-system,sans-serif; font-weight:500; font-size:11.5px; color:var(--muted); border:1px solid var(--line); border-radius:999px; padding:1px 7px; margin-left:4px; }
.check-vals { display:grid; grid-template-columns:auto 1fr; gap:2px 10px; margin-top:5px; font-size:13px; } .check-vals span { color:var(--muted); }
.bad-text { color:var(--bad); font-weight:700; }
.crt { margin-top:14px; padding:12px 14px; border-radius:12px; border:1px solid var(--line); }
.crt-head { display:flex; justify-content:space-between; align-items:center; font-weight:700; font-size:14px; }
.crt-meta { color:var(--muted); font-size:13px; margin:4px 0 6px; }
.crt a { color:var(--blue); font-size:13.5px; text-decoration:none; font-weight:600; }
details { margin-top:16px; } summary { cursor:pointer; color:var(--muted); font-size:13.5px; }
.details { margin-top:10px; }
footer { color:var(--muted); font-size:13px; padding:8px 24px 40px; }
@media print { :root { --bg:#fff; --panel:#fff; --line:#d9dee8; --ink:#111; --muted:#555; --good:#0d8a5e; --bad:#c62839; --warn:#9a6700; --blue:#2b5cff; }
  body { background:#fff; } .panel, .result, .banner { backdrop-filter:none; } }
`;
