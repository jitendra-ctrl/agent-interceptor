import { CommandError, parseJson, type Runner } from './exec.js';

/** Thin wrapper over the Salesforce CLI. Every command uses --json; results are read from JSON. */
export class Sf {
  constructor(
    private readonly runner: Runner,
    private readonly alias: string,
    private readonly cwd: string,
  ) {}

  async json<T = any>(args: string[], what: string, timeoutMs = 120_000): Promise<T> {
    const r = await this.runner.run('sf', [...args, '--json'], { cwd: this.cwd, timeoutMs });
    if (r.timedOut) throw new CommandError(`${what}: timed out after ${timeoutMs / 1000}s`, r);
    const body = parseJson<any>(r, what);
    if (body.status !== 0) {
      throw new CommandError(`${what}: ${body.message ?? body.name ?? 'failed'} (status ${body.status})`, r);
    }
    return body.result as T;
  }

  orgDisplay(): Promise<{ id: string; instanceUrl: string; username: string; apiVersion: string }> {
    return this.json(['org', 'display', '-o', this.alias], 'sf org display');
  }

  async query<T = Record<string, any>>(soql: string): Promise<T[]> {
    const res = await this.json<{ records: T[] }>(['data', 'query', '-o', this.alias, '-q', soql], 'sf data query');
    return res.records;
  }

  async createRecord(sobject: string, fields: Record<string, string | number | boolean | null>): Promise<string> {
    const values = Object.entries(fields)
      .map(([k, v]) => `${k}=${formatValue(v)}`)
      .join(' ');
    const res = await this.json<{ id: string }>(
      ['data', 'create', 'record', '-o', this.alias, '-s', sobject, '-v', values],
      `sf data create record ${sobject}`,
    );
    return res.id;
  }

  async deleteRecord(sobject: string, id: string): Promise<void> {
    await this.json(['data', 'delete', 'record', '-o', this.alias, '-s', sobject, '-i', id], `sf data delete record ${id}`);
  }
}

/** Formats a value for `sf data create record -v`, which takes Field='value' pairs. */
export function formatValue(v: string | number | boolean | null): string {
  if (v === null) return "''";
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** Quotes a string literal for SOQL. */
export function soqlString(v: string): string {
  return `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

const API_NAME = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)?$/;
/** Rejects anything that is not a plain object or field API name before it reaches SOQL. */
export function assertApiName(name: string, what: string): string {
  if (!API_NAME.test(name)) throw new Error(`Invalid ${what} name: ${JSON.stringify(name)}`);
  return name;
}
