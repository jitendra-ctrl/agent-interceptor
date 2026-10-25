import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExecResult, Runner } from '../src/util/exec.js';

const here = dirname(fileURLToPath(import.meta.url));
/** interceptor/ package root (tests run from dist/test). */
export const PKG = join(here, '..', '..');
export const REPO = join(PKG, '..');
export const FIXTURES = join(PKG, 'test', 'fixtures');

export function fixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8');
}

export function ok(stdout: unknown, code = 0): ExecResult {
  return { code, stdout: typeof stdout === 'string' ? stdout : JSON.stringify(stdout), stderr: '', timedOut: false };
}

/** Fake runner: the first handler whose matcher accepts the command line answers it. Calls are recorded. */
export class FakeRunner implements Runner {
  calls: string[][] = [];
  constructor(private readonly handlers: Array<[(cmd: string[]) => boolean, (cmd: string[]) => ExecResult]>) {}
  async run(cmd: string, args: string[]): Promise<ExecResult> {
    const full = [cmd, ...args];
    this.calls.push(full);
    const h = this.handlers.find(([m]) => m(full));
    if (!h) throw new Error(`FakeRunner: no handler for ${full.join(' ')}`);
    return h[1](full);
  }
}

export const has = (...parts: string[]) => (cmd: string[]) => parts.every((p) => cmd.includes(p));
