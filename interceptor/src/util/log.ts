import { redact } from './redact.js';

let quiet = false;
export function setQuiet(q: boolean): void {
  quiet = q;
}
/** Progress output goes to stderr so --json stdout stays machine-readable. */
export function info(msg: string): void {
  if (!quiet) process.stderr.write(redact(msg) + '\n');
}
