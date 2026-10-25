import type { InterceptorConfig } from '../config/config.js';
import { parseJson, type Runner } from '../util/exec.js';
import type { FieldValue } from '../specs/spec.js';
import type { Check, CheckResult, Verifier, VerifyResult } from './verifier.js';

/**
 * Verifies the org outcome in Copado Robotic Testing, orchestrated with Agentia:
 *   agentia testing run <job> -p <project> --wait-for-result --json
 *     --variable SF_DOMAIN:<url> --variable RUN_ID:<runId> --variable CHECKS_B64:<base64 json>
 * then finds the build for this run in `agentia testing status` (matched on RUN_ID, because a
 * failed run's --json output has no build ID) and reads the IVERIFY lines from `agentia testing logs`.
 */
export class CrtVerifier implements Verifier {
  readonly name = 'crt' as const;

  constructor(
    private readonly runner: Runner,
    private readonly config: InterceptorConfig,
    private readonly instanceUrl: string,
  ) {}

  async verify(checks: Check[], runId: string): Promise<VerifyResult> {
    const crt = this.config.crt;
    const label = 'Copado Robotic Testing (via Agentia)';
    const fail = (error: string, evidence: Record<string, unknown> = {}): VerifyResult => ({
      verifier: 'crt',
      label,
      completed: false,
      checks: [],
      error,
      evidence,
    });
    if (!crt?.job) return fail('crt.job is not set; run "interceptor crt-sync" first');

    const payload = checks.map((c) => ({ key: c.key, object: c.object, id: c.id, field: c.field, expected: c.expected }));
    const b64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
    const project = String(crt.project);
    const job = String(crt.job);
    const run = await this.runner.run(
      this.config.agentiaBin,
      [
        'testing', 'run', job, '-p', project,
        '--wait-for-result', '--timeout', String(crt.timeoutMinutes), '--json',
        '--variable', `SF_DOMAIN:${this.instanceUrl}`,
        '--variable', `RUN_ID:${runId}`,
        '--variable', `CHECKS_B64:${b64}`,
      ],
      { timeoutMs: (crt.timeoutMinutes + 2) * 60_000 },
    );
    if (run.timedOut) return fail('agentia testing run timed out');

    const build = await this.findBuild(project, job, runId);
    if (!build) return fail(`could not find the CRT build for run ${runId} (agentia exit ${run.code})`);
    const evidence = {
      crtProject: crt.project,
      crtJob: crt.job,
      buildId: build.id,
      buildStatus: build.status,
      logReportUrl: build.logReportUrl,
      xunit: build.xunitReport?.testsuite?.total ?? null,
    };

    const logs = await this.runner.run(this.config.agentiaBin, ['testing', 'logs', String(build.id), '-p', project, '-j', job, '--json'], {
      timeoutMs: 120_000,
    });
    let logText = '';
    try {
      logText = String(parseJson<any>(logs, 'agentia testing logs').result?.log ?? '');
    } catch (e) {
      return fail((e as Error).message, evidence);
    }
    const lines = parseVerifyLines(logText);

    const results: CheckResult[] = checks.map((c) => {
      const l = lines.get(c.key);
      return { ...c, found: l?.found ?? false, actual: (l?.actual ?? null) as FieldValue, pass: l?.pass ?? false };
    });
    const missing = checks.filter((c) => !lines.has(c.key)).map((c) => c.key);
    if (missing.length) {
      return fail(`CRT run ${build.id} (${build.status}) did not report checks: ${missing.join(', ')}`, evidence);
    }
    // The suite fails exactly when a check fails; anything else means the run itself went wrong.
    const allPass = results.every((r) => r.pass);
    const statusOk = allPass ? build.status === 'succeeded' : build.status === 'failed';
    if (!statusOk) return fail(`CRT build ${build.id} status "${build.status}" does not match its check results`, evidence);
    return { verifier: 'crt', label, completed: true, checks: results, evidence };
  }

  private async findBuild(project: string, job: string, runId: string): Promise<any | null> {
    const r = await this.runner.run(this.config.agentiaBin, ['testing', 'status', '-p', project, '--job', job, '--json'], {
      timeoutMs: 120_000,
    });
    let builds: any[] = [];
    try {
      builds = parseJson<any>(r, 'agentia testing status').result ?? [];
    } catch {
      return null;
    }
    return builds.find((b) => buildRunId(b) === runId) ?? null;
  }
}

/** RUN_ID as recorded in the build's execution parameters ("-v RUN_ID:<id>"). */
export function buildRunId(build: any): string | null {
  const params: any[] = build?.configuration?.executionParameters ?? [];
  for (const p of params) {
    const m = /^RUN_ID:(.+)$/.exec(String(p?.value ?? ''));
    if (m) return m[1]!;
  }
  return null;
}

export function parseVerifyLines(log: string): Map<string, { found: boolean; actual: unknown; pass: boolean }> {
  const out = new Map<string, { found: boolean; actual: unknown; pass: boolean }>();
  for (const m of log.matchAll(/IVERIFY\|(\{.*\})/g)) {
    try {
      const v = JSON.parse(m[1]!);
      if (typeof v.key === 'string') out.set(v.key, { found: !!v.found, actual: v.actual ?? null, pass: v.pass === true });
    } catch {
      // ignore malformed lines; a missing key makes the run inconclusive
    }
  }
  return out;
}
