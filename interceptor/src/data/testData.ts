import type { FieldValue, InterceptionSpec, TemplateContext } from '../specs/spec.js';
import { renderValue } from '../specs/spec.js';
import { assertApiName, soqlString, type Sf } from '../util/sf.js';

export interface CreatedRecord {
  alias: string;
  object: string;
  id: string;
  fields: Record<string, FieldValue>;
}

/** Every created record's name must start with this, so test data can never be confused with real data. */
export const TEST_PREFIX = 'AI-Test-';

/**
 * Creates the spec's setup records. Each record's Name must start with AI-Test-<runId>,
 * so a run only ever touches records it created.
 */
export async function setupRecords(sf: Sf, spec: InterceptionSpec, ctx: TemplateContext): Promise<CreatedRecord[]> {
  const created: CreatedRecord[] = [];
  try {
    for (const s of spec.setup) {
      const fields: Record<string, FieldValue> = {};
      for (const [k, v] of Object.entries(s.fields)) fields[k] = renderValue(v, ctx);
      const name = fields.Name;
      if (typeof name !== 'string' || !name.startsWith(`${TEST_PREFIX}${ctx.runId}`)) {
        throw new Error(`setup "${s.alias}": Name must start with ${TEST_PREFIX}${ctx.runId} (got ${JSON.stringify(name)})`);
      }
      const id = await sf.createRecord(s.object, fields);
      created.push({ alias: s.alias, object: s.object, id, fields });
    }
  } catch (e) {
    await teardownRecords(sf, created);
    throw e;
  }
  return created;
}

/** Reads the current values of the given fields for each record. */
export async function snapshot(
  sf: Sf,
  records: CreatedRecord[],
  fieldsByAlias: Record<string, string[]>,
): Promise<Record<string, Record<string, FieldValue>>> {
  const out: Record<string, Record<string, FieldValue>> = {};
  for (const r of records) {
    const fields = [...new Set(['Id', 'Name', ...(fieldsByAlias[r.alias] ?? [])])].map((f) => assertApiName(f, 'field'));
    const rows = await sf.query<Record<string, FieldValue>>(
      `SELECT ${fields.join(', ')} FROM ${assertApiName(r.object, 'object')} WHERE Id = ${soqlString(r.id)}`,
    );
    const row = rows[0] ?? {};
    out[r.alias] = Object.fromEntries(fields.map((f) => [f, (row[f] ?? null) as FieldValue]));
  }
  return out;
}

/** Deletes the run's records. Failures are collected, not thrown, so cleanup always continues. */
export async function teardownRecords(sf: Sf, records: CreatedRecord[]): Promise<string[]> {
  const problems: string[] = [];
  for (const r of [...records].reverse()) {
    try {
      await sf.deleteRecord(r.object, r.id);
    } catch (e) {
      problems.push(`${r.alias} (${r.id}): ${(e as Error).message}`);
    }
  }
  return problems;
}
