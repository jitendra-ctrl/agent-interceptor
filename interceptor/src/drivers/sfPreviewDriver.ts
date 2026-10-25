import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CommandError, parseJson, type Runner } from '../util/exec.js';
import type { ActionCall, Conversation, ConversationDriver, Turn } from './driver.js';

/**
 * Converses through `sf agent preview start/send/end --json` with live actions against the
 * draft authoring bundle. Actions for each turn are read from the raw session trace using the
 * planId that `send` returns. (`sf agent trace read -t N` numbers every message, including the
 * welcome message, so it is not used.)
 */
export class SfPreviewDriver implements ConversationDriver {
  readonly name = 'sf-agent-preview';

  constructor(
    private readonly runner: Runner,
    private readonly opts: { alias: string; bundle: string; projectRoot: string; live: boolean },
  ) {}

  async converse(utterances: string[], timeoutSeconds: number): Promise<Conversation> {
    const { alias, bundle, projectRoot, live } = this.opts;
    const timeoutMs = timeoutSeconds * 1000;
    const start = await this.sf(
      ['agent', 'preview', 'start', '--authoring-bundle', bundle, live ? '--use-live-actions' : '--simulate-actions', '-o', alias],
      'sf agent preview start',
      timeoutMs,
    );
    const sessionId: string = start.sessionId;
    if (!sessionId) throw new Error('sf agent preview start returned no sessionId');

    const turns: Turn[] = [];
    let tracesPath: string | null = null;
    try {
      for (const utterance of utterances) {
        const sent = await this.sf(
          ['agent', 'preview', 'send', '--authoring-bundle', bundle, '--session-id', sessionId, '-u', utterance, '-o', alias],
          'sf agent preview send',
          timeoutMs,
        );
        const messages: any[] = sent.messages ?? [];
        const reply = messages.map((m) => m.message).filter((m) => typeof m === 'string').join('\n');
        const planId: string | null = messages.find((m) => m.planId)?.planId ?? null;
        turns.push({ utterance, reply, planId, actions: planId ? readActions(projectRoot, bundle, sessionId, planId) : [] });
      }
    } finally {
      try {
        const end = await this.sf(
          ['agent', 'preview', 'end', '--authoring-bundle', bundle, '--session-id', sessionId, '-o', alias],
          'sf agent preview end',
          timeoutMs,
        );
        tracesPath = end.tracesPath ?? null;
      } catch {
        // Ending is best effort; the session expires on its own.
      }
    }
    return { driver: this.name, mode: live ? 'live' : 'simulated', sessionId, turns, tracesPath };
  }

  private async sf(args: string[], what: string, timeoutMs: number): Promise<any> {
    const r = await this.runner.run('sf', [...args, '--json'], { cwd: this.opts.projectRoot, timeoutMs });
    if (r.timedOut) throw new CommandError(`${what}: timed out after ${timeoutMs / 1000}s`, r);
    const body = parseJson<any>(r, what);
    if (body.status !== 0) throw new CommandError(`${what}: ${body.message ?? body.name} (status ${body.status})`, r);
    return body.result;
  }
}

/** Reads FunctionStep entries from .sfdx/agents/<bundle>/sessions/<session>/traces/<planId>.json. */
export function readActions(projectRoot: string, bundle: string, sessionId: string, planId: string): ActionCall[] {
  const file = join(projectRoot, '.sfdx', 'agents', bundle, 'sessions', sessionId, 'traces', `${planId}.json`);
  if (!existsSync(file)) return [];
  return actionsFromTrace(JSON.parse(readFileSync(file, 'utf8')));
}

const RUNTIME_KEYS = ['__action_execution_status__', '__tool_idx__', '__supports_result_display__'];

export function actionsFromTrace(trace: any): ActionCall[] {
  const steps: any[] = trace?.plan ?? trace?.steps ?? [];
  return steps
    .filter((s) => (s.type ?? s.stepType) === 'FunctionStep')
    .map((s) => {
      const fn = s.function ?? s.data ?? {};
      const output = { ...(asObject(fn.output) ?? {}) };
      for (const k of RUNTIME_KEYS) delete output[k];
      return { name: String(fn.name ?? fn.function ?? ''), input: asObject(fn.input) ?? {}, output };
    });
}

function asObject(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === 'object') return v as Record<string, unknown>;
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}
