#!/usr/bin/env node
import { existsSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join, relative } from 'node:path';
import { ConfigError, loadConfig, type InterceptorConfig } from './config/config.js';
import { SfPreviewDriver } from './drivers/sfPreviewDriver.js';
import { EXIT, exitCodeFor } from './gate/exitCodes.js';
import { analyseImpact, type ImpactReport } from './impact/impact.js';
import { html, markdown, readRun, writeRun, type RunRecord } from './report/report.js';
import { runSpec, type SpecRun } from './run/runSpec.js';
import { loadSpecs, SpecError, type InterceptionSpec } from './specs/spec.js';
import { parseJson, processRunner } from './util/exec.js';
import { guardDemoOrg, ProductionGuardError } from './util/guard.js';
import { info, setQuiet } from './util/log.js';
import { redact } from './util/redact.js';
import { Sf } from './util/sf.js';
import { CrtVerifier } from './verify/crtVerifier.js';
import { LocalSoqlVerifier } from './verify/localSoqlVerifier.js';
import type { Verifier } from './verify/verifier.js';

const USAGE = `Agent Interceptor: verify what an Agentforce agent claims against the org.

Usage: interceptor <command> [options]

Commands
  impact  [--base <ref>]                         Affected agent actions for the change, with reasons
  run     [--base <ref>] [--action <name>]...    Full interception (all specs unless --base/--action)
  gate    [--base <ref>] [--action <name>]...    run, then exit 0 verified / 1 intercepted / 2 inconclusive / 3 usage
  explain <runId>                                Print each verdict and its evidence
  report  <runId> [--html]                       Print the Markdown report (or write report.html)
  crt-sync                                       Create or update the CRT job that runs crt/interceptor_verify.robot

Options
  --config <file>          default: interceptor.config.yaml next to the package
  --verifier crt|local     default from config; "local" is a dev loop and is labelled "not CRT"
  --driver preview         conversation channel (only "preview" is implemented)
  --max-conversations <n>  default from config (limits.maxConversations)
  --keep-data              keep the AI-Test records after the run
  --json                   print the result as JSON on stdout
`;

interface Args {
  command: string;
  positional: string[];
  base?: string;
  actions: string[];
  config: string;
  verifier?: 'crt' | 'local';
  driver: string;
  maxConversations?: number;
  keepData: boolean;
  json: boolean;
  html: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = {
    command: argv[0] ?? 'help',
    positional: [],
    actions: [],
    config: join(packageDir(), 'interceptor.config.yaml'),
    driver: 'preview',
    keepData: false,
    json: false,
    html: false,
  };
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i]!;
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new UsageError(`${arg} needs a value`);
      return v;
    };
    switch (arg) {
      case '--base': a.base = next(); break;
      case '--action': a.actions.push(next()); break;
      case '--config': a.config = next(); break;
      case '--verifier': {
        const v = next();
        if (v !== 'crt' && v !== 'local') throw new UsageError('--verifier must be crt or local');
        a.verifier = v;
        break;
      }
      case '--driver': a.driver = next(); break;
      case '--max-conversations': {
        const n = Number(next());
        if (!Number.isInteger(n) || n < 1) throw new UsageError('--max-conversations must be a positive integer');
        a.maxConversations = n;
        break;
      }
      case '--keep-data': a.keepData = true; break;
      case '--json': a.json = true; break;
      case '--html': a.html = true; break;
      case '-h': case '--help': a.command = 'help'; break;
      default:
        if (arg.startsWith('-')) throw new UsageError(`Unknown option ${arg}`);
        a.positional.push(arg);
    }
  }
  return a;
}

class UsageError extends Error {}

function packageDir(): string {
  // dist/src/cli.js → package root
  return join(new URL('.', import.meta.url).pathname, '..', '..');
}

/** Uses the configured agentia binary, or ~/.npm-global/bin/agentia when it isn't on PATH. */
function resolveAgentia(bin: string): string {
  if (bin.includes('/')) return bin;
  const onPath = (process.env.PATH ?? '').split(delimiter).some((d) => existsSync(join(d, bin)));
  const fallback = join(homedir(), '.npm-global', 'bin', bin);
  return onPath || !existsSync(fallback) ? bin : fallback;
}

function newRunId(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `ir${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  if (args.command === 'help') {
    process.stdout.write(USAGE);
    return EXIT.VERIFIED;
  }
  setQuiet(false);
  const config = loadConfig(args.config);
  config.agentiaBin = resolveAgentia(config.agentiaBin);

  switch (args.command) {
    case 'impact': {
      const report = await analyseImpact(processRunner, config, args.base ?? 'HEAD');
      if (args.json) print(report);
      else process.stdout.write(impactText(report));
      return EXIT.VERIFIED;
    }
    case 'run':
    case 'gate':
      return interception(args, config);
    case 'explain': {
      const run = readRun(config.runsDir, need(args.positional[0], 'explain <runId>'));
      if (args.json) print(run.results.map((r) => ({ spec: r.spec, verdict: r.verdict, claim: r.claim, checks: r.verification?.checks })));
      else for (const r of run.results) process.stdout.write(`${r.spec} [${r.action}]: ${r.verdict.kind}\n  ${r.verdict.explanation}\n`);
      return run.exitCode;
    }
    case 'report': {
      const runId = need(args.positional[0], 'report <runId>');
      const run = readRun(config.runsDir, runId);
      if (args.html) {
        const file = join(config.runsDir, runId, 'report.html');
        writeFileSync(file, redact(html(run)));
        process.stdout.write(`${relative(process.cwd(), file)}\n`);
      } else process.stdout.write(markdown(run));
      return EXIT.VERIFIED;
    }
    case 'crt-sync':
      return crtSync(config);
    default:
      throw new UsageError(`Unknown command "${args.command}"\n\n${USAGE}`);
  }
}

async function interception(args: Args, config: InterceptorConfig): Promise<number> {
  if (args.driver !== 'preview') throw new UsageError(`--driver ${args.driver} is not implemented; use preview`);
  const verifierName = args.verifier ?? config.verifier;
  const cap = args.maxConversations ?? config.limits.maxConversations;
  const specs = loadSpecs(config.specsDir);

  // Which actions to test: explicit --action, else impacted actions for --base (gate defaults to HEAD), else all.
  let impact: ImpactReport | null = null;
  let actions: string[];
  if (args.actions.length) actions = args.actions;
  else if (args.base || args.command === 'gate') {
    impact = await analyseImpact(processRunner, config, args.base ?? 'HEAD');
    actions = impact.impacted.map((i) => i.action);
    info(impactText(impact).trimEnd());
  } else actions = [...new Set(specs.map((s) => s.action))];

  const selected: InterceptionSpec[] = specs.filter((s) => actions.includes(s.action));
  const untested = actions.filter((a) => !specs.some((s) => s.action === a));
  if (selected.length > cap) {
    throw new UsageError(`${selected.length} conversations needed but the cap is ${cap}; narrow with --action or raise --max-conversations`);
  }

  const sf = new Sf(processRunner, config.org.alias, config.project.root);
  const guard = await guardDemoOrg(sf, config);
  const runId = newRunId();
  const startedAt = new Date().toISOString();
  info(`run ${runId}: org ${guard.orgId} (${guard.organizationType}) ok; ${selected.length} conversation(s) with LIVE actions (cap ${cap}); verifier: ${verifierName === 'local' ? 'local SOQL (not CRT)' : 'CRT via Agentia'}`);

  const verifier: Verifier = verifierName === 'local' ? new LocalSoqlVerifier(sf) : new CrtVerifier(processRunner, config, guard.instanceUrl);
  const driver = new SfPreviewDriver(processRunner, { alias: config.org.alias, bundle: config.agent.bundle, projectRoot: config.project.root, live: true });

  const results: SpecRun[] = [];
  for (const spec of selected) {
    info(`- ${spec.id} (${spec.action})`);
    const r = await runSpec(spec, { runId, today: new Date() }, { sf, driver, verifier, keepData: args.keepData });
    info(`  → ${r.verdict.kind}: ${r.verdict.explanation}`);
    results.push(r);
  }
  for (const a of untested) results.push(untestedResult(a));

  const exitCode = exitCodeFor(results.map((r) => r.verdict.kind));
  const record: RunRecord = {
    runId,
    command: args.command as 'run' | 'gate',
    startedAt,
    finishedAt: new Date().toISOString(),
    org: { orgId: guard.orgId, organizationType: guard.organizationType, isSandbox: guard.isSandbox, username: guard.username },
    verifier: verifierName === 'local' ? 'local SOQL (not CRT)' : 'Copado Robotic Testing (via Agentia)',
    driver: driver.name,
    conversations: { planned: selected.length, cap },
    impact: impact ? { base: impact.base, impacted: impact.impacted, unmatched: impact.unmatched } : null,
    results,
    exitCode,
  };
  const dir = writeRun(config.runsDir, record);
  info(`report: ${relative(process.cwd(), join(dir, 'report.md'))}`);
  if (args.json) print({ runId, exitCode, verdicts: results.map((r) => ({ spec: r.spec, action: r.action, verdict: r.verdict })) });
  else process.stdout.write(`${runId}: ${results.map((r) => `${r.spec}=${r.verdict.kind}`).join(', ') || 'nothing to verify'} (exit ${exitCode})\n`);
  return args.command === 'gate' ? exitCode : EXIT.VERIFIED;
}

function untestedResult(action: string): SpecRun {
  const now = new Date().toISOString();
  return {
    spec: `(no spec for ${action})`, action, utterances: [], records: [], baseline: {}, conversation: null, claim: null,
    verification: null, teardown: { kept: false, problems: [] }, startedAt: now, finishedAt: now,
    verdict: { kind: 'INCONCLUSIVE', rule: '1', explanation: `Action ${action} is affected by the change but has no interception spec in specs/. Add one; this is not a pass.` },
  };
}

async function crtSync(config: InterceptorConfig): Promise<number> {
  const crt = config.crt;
  if (!crt) throw new UsageError('crt section missing from config');
  const baseDir = join(crt.suiteFile, '..');
  const remote = relative(baseDir, crt.suiteFile);
  const args = crt.job
    ? ['testing', 'update', String(crt.job), '-p', String(crt.project), '--replace', `${crt.suiteFile}:${remote}`, '--base-path', baseDir, '--message', 'Agent Interceptor suite sync', '--json']
    : ['testing', 'create', '-p', String(crt.project), '--robot', String(crt.robot), '--name', 'Agent Interceptor Verify', '--file', crt.suiteFile, '--base-path', baseDir, '--json'];
  const r = await processRunner.run(config.agentiaBin, args, { timeoutMs: 120_000 });
  const body = parseJson<any>(r, `agentia ${args[1]}`);
  if (body.status !== 0) throw new Error(`agentia ${args[1]} failed: ${JSON.stringify(body.error ?? body)}`);
  const job = crt.job ?? body.result?.job?.id;
  process.stdout.write(crt.job ? `Updated CRT job ${job} with ${remote}\n` : `Created CRT job ${job}. Set crt.job: ${job} in the config.\n`);
  return EXIT.VERIFIED;
}

function impactText(r: ImpactReport): string {
  const out = [`Changes since ${r.base}: ${r.components.length} metadata component(s)`];
  for (const c of r.components) out.push(`  ${c.status.padEnd(8)} ${c.type} ${c.name}`);
  out.push(r.impacted.length ? 'Affected agent actions:' : 'No agent action is affected.');
  for (const i of r.impacted) {
    out.push(`  ${i.action}`);
    for (const p of i.paths) out.push(`    because ${p}`);
  }
  if (r.unmatched.length) out.push(`Matched no action: ${r.unmatched.map((c) => `${c.type} ${c.name}`).join(', ')}`);
  return out.join('\n') + '\n';
}

function need(v: string | undefined, usage: string): string {
  if (!v) throw new UsageError(`usage: interceptor ${usage}`);
  return v;
}

function print(v: unknown) {
  process.stdout.write(redact(JSON.stringify(v, null, 2)) + '\n');
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e: Error) => {
    const usage = e instanceof UsageError || e instanceof ConfigError || e instanceof SpecError || e instanceof ProductionGuardError;
    process.stderr.write(redact(`interceptor: ${e.message}`) + '\n');
    process.exit(usage ? EXIT.USAGE : EXIT.INCONCLUSIVE);
  },
);
