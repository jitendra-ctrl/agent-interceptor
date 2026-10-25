import { spawn } from 'node:child_process';

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface ExecOptions {
  cwd?: string;
  timeoutMs?: number;
}

/** Runs external commands. Injected everywhere so unit tests can use recorded output. */
export interface Runner {
  run(cmd: string, args: string[], opts?: ExecOptions): Promise<ExecResult>;
}

/** Spawns the command directly (no shell), so arguments are never re-parsed. */
export const processRunner: Runner = {
  run(cmd, args, opts = {}) {
    return new Promise((resolve) => {
      const child = spawn(cmd, args, {
        cwd: opts.cwd,
        env: { ...process.env, SF_HIDE_RELEASE_NOTES: 'true', SF_DISABLE_AUTOUPDATE: 'true' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      const timer = opts.timeoutMs
        ? setTimeout(() => {
            timedOut = true;
            child.kill('SIGTERM');
          }, opts.timeoutMs)
        : undefined;
      child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
      child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
      child.on('error', (err) => {
        if (timer) clearTimeout(timer);
        resolve({ code: 127, stdout, stderr: stderr + String(err), timedOut });
      });
      child.on('close', (code) => {
        if (timer) clearTimeout(timer);
        resolve({ code: code ?? 1, stdout, stderr, timedOut });
      });
    });
  },
};

export class CommandError extends Error {
  constructor(
    message: string,
    readonly result: ExecResult,
  ) {
    super(message);
  }
}

/** Parses a --json command's stdout. Throws CommandError when stdout is not JSON. */
export function parseJson<T = unknown>(r: ExecResult, what: string): T {
  try {
    return JSON.parse(r.stdout) as T;
  } catch {
    throw new CommandError(`${what}: output was not JSON (exit ${r.code})`, r);
  }
}
