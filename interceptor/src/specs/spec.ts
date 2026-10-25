import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { assertApiName } from '../util/sf.js';

export type FieldValue = string | number | boolean | null;

export interface SetupRecord {
  object: string;
  alias: string;
  fields: Record<string, FieldValue>;
}

export interface Expectation {
  /** Alias of a setup record. */
  record: string;
  fields: Record<string, FieldValue>;
}

export interface UnchangedRule {
  record: string;
  /** Fields that must keep their baseline value. */
  fields: string[];
}

/** One interception test: a conversation that should cause `action`, plus the org outcome to check. */
export interface InterceptionSpec {
  id: string;
  file: string;
  action: string;
  description: string;
  setup: SetupRecord[];
  conversation: string[];
  expect: Expectation[];
  mustNotChange: UnchangedRule[];
  timeoutSeconds: number;
}

export class SpecError extends Error {}

export function loadSpecs(dir: string): InterceptionSpec[] {
  const files = readdirSync(dir).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml')).sort();
  return files.map((f) => parseSpec(readFileSync(join(dir, f), 'utf8'), f));
}

export function parseSpec(text: string, file: string): InterceptionSpec {
  const raw = parse(text) as Record<string, any> | null;
  const errors: string[] = [];
  const need = (cond: boolean, msg: string) => {
    if (!cond) errors.push(msg);
  };
  if (!raw || typeof raw !== 'object') throw new SpecError(`${file}: not a YAML mapping`);

  need(typeof raw.action === 'string' && raw.action.length > 0, 'action is required');
  const setup: SetupRecord[] = Array.isArray(raw.setup) ? raw.setup : [];
  const aliases = new Set<string>();
  setup.forEach((s, i) => {
    need(typeof s?.object === 'string', `setup[${i}].object is required`);
    need(typeof s?.alias === 'string', `setup[${i}].alias is required`);
    need(!!s?.fields && typeof s.fields === 'object', `setup[${i}].fields is required`);
    if (typeof s?.object === 'string') checkName(s.object, 'object', errors);
    for (const f of Object.keys(s?.fields ?? {})) checkName(f, 'field', errors);
    if (aliases.has(s?.alias)) errors.push(`setup alias "${s.alias}" is used twice`);
    aliases.add(s?.alias);
  });

  const conversation = typeof raw.utterance === 'string' ? [raw.utterance] : raw.conversation;
  need(
    Array.isArray(conversation) && conversation.length > 0 && conversation.every((u: unknown) => typeof u === 'string'),
    'utterance (string) or conversation (list of strings) is required',
  );

  const expect: Expectation[] = Array.isArray(raw.expect) ? raw.expect : [];
  need(expect.length > 0, 'expect must list at least one record outcome');
  expect.forEach((e, i) => {
    need(aliases.has(e?.record), `expect[${i}].record "${e?.record}" is not a setup alias`);
    for (const f of Object.keys(e?.fields ?? {})) checkName(f, 'field', errors);
  });

  const mustNotChange: UnchangedRule[] = Array.isArray(raw.must_not_change) ? raw.must_not_change : [];
  mustNotChange.forEach((m, i) => {
    need(aliases.has(m?.record), `must_not_change[${i}].record "${m?.record}" is not a setup alias`);
    need(Array.isArray(m?.fields) && m.fields.length > 0, `must_not_change[${i}].fields must list fields`);
    for (const f of m?.fields ?? []) checkName(f, 'field', errors);
  });

  if (errors.length) throw new SpecError(`${file}: invalid spec:\n- ${errors.join('\n- ')}`);
  return {
    id: file.replace(/\.ya?ml$/, ''),
    file,
    action: raw.action,
    description: typeof raw.description === 'string' ? raw.description : '',
    setup,
    conversation: conversation as string[],
    expect,
    mustNotChange,
    timeoutSeconds: typeof raw.timeout_seconds === 'number' ? raw.timeout_seconds : 120,
  };
}

function checkName(name: string, what: string, errors: string[]) {
  try {
    assertApiName(name, what);
  } catch (e) {
    errors.push((e as Error).message);
  }
}

export interface TemplateContext {
  runId: string;
  today: Date;
  /** alias → record ID, filled after setup so later templates can use {{alias.Id}}. */
  ids?: Record<string, string>;
}

/** Replaces {{runId}}, {{today}}, {{today+N}} / {{today-N}} and {{alias.Id}}. Unknown placeholders are an error. */
export function render(template: string, ctx: TemplateContext): string {
  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_m, expr: string) => {
    if (expr === 'runId') return ctx.runId;
    const day = /^today(?:([+-])(\d+))?$/.exec(expr);
    if (day) {
      const d = new Date(ctx.today);
      const n = day[2] ? Number(day[2]) * (day[1] === '-' ? -1 : 1) : 0;
      d.setUTCDate(d.getUTCDate() + n);
      return d.toISOString().slice(0, 10);
    }
    const id = /^([A-Za-z0-9_]+)\.Id$/.exec(expr);
    if (id && ctx.ids?.[id[1]!]) return ctx.ids[id[1]!]!;
    throw new SpecError(`Unknown template placeholder {{${expr}}}`);
  });
}

export function renderValue(v: FieldValue, ctx: TemplateContext): FieldValue {
  return typeof v === 'string' ? render(v, ctx) : v;
}
