import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentAction } from './agentModel.js';

/** What an action's implementation touches, derived statically from its Apex source. */
export interface ActionFootprint {
  action: string;
  target: string;
  /** Apex classes involved: the target plus classes it references from the project (one level). */
  classes: string[];
  objectsRead: string[];
  objectsWritten: string[];
  /** "Object.Field" names seen in SOQL or SObject constructors. */
  fields: string[];
  /** Why the footprint may be incomplete. */
  notes: string[];
}

const DML = /\b(insert|update|upsert|delete|undelete)\s+[A-Za-z_]|\bDatabase\.(insert|update|upsert|delete|undelete)\s*\(/i;

/**
 * Heuristic scan of the Apex source for each apex:// action:
 * - SOQL `FROM X` → X is read; fields in the SELECT list and WHERE clause are recorded.
 * - `new X(Field = …)` → X and its fields are referenced; if the class also contains DML, X is written.
 * - Schema references `X.Field.getDescribe()` → field recorded.
 * Non-Apex targets (flow://, prompt://) are reported with a note; use mapping overrides for them.
 */
export function buildFootprints(actions: AgentAction[], classesDir: string): ActionFootprint[] {
  const projectClasses = existsSync(classesDir)
    ? new Set(readdirSync(classesDir).filter((f) => f.endsWith('.cls')).map((f) => f.slice(0, -4)))
    : new Set<string>();

  return actions.map((a) => {
    const fp: ActionFootprint = { action: a.name, target: a.target, classes: [], objectsRead: [], objectsWritten: [], fields: [], notes: [] };
    if (a.targetType !== 'apex') {
      fp.notes.push(`target type "${a.targetType}" is not analysed; add a mapping override if it depends on changed metadata`);
      return fp;
    }
    if (!projectClasses.has(a.targetName)) {
      fp.notes.push(`Apex class ${a.targetName} not found in ${classesDir}`);
      return fp;
    }
    const queue = [a.targetName];
    const seen = new Set<string>();
    while (queue.length) {
      const cls = queue.shift()!;
      if (seen.has(cls)) continue;
      seen.add(cls);
      const src = stripComments(readFileSync(join(classesDir, `${cls}.cls`), 'utf8'));
      scanApex(src, fp);
      if (cls === a.targetName) {
        for (const ref of referencedClasses(src, projectClasses)) if (ref !== cls && !ref.endsWith('Test')) queue.push(ref);
      }
    }
    fp.classes = [...seen];
    fp.objectsRead = uniq(fp.objectsRead);
    fp.objectsWritten = uniq(fp.objectsWritten);
    fp.fields = uniq(fp.fields);
    return fp;
  });
}

export function scanApex(src: string, fp: ActionFootprint): void {
  const hasDml = DML.test(src);
  for (const m of src.matchAll(/\[\s*SELECT\s+([\s\S]+?)\s+FROM\s+([A-Za-z][A-Za-z0-9_]*)([\s\S]*?)\]/gi)) {
    const object = m[2]!;
    fp.objectsRead.push(object);
    const selectList = m[1]!;
    const rest = m[3] ?? '';
    for (const f of selectList.split(',').map((s) => s.trim())) if (/^[A-Za-z][A-Za-z0-9_]*$/.test(f)) fp.fields.push(`${object}.${f}`);
    for (const w of rest.matchAll(/\b([A-Za-z][A-Za-z0-9_]*)\s*(=|!=|<|>|LIKE|IN)\s*[:'(]/gi)) {
      if (!/^(WITH|WHERE|AND|OR|NOT|ORDER|BY|LIMIT)$/i.test(w[1]!)) fp.fields.push(`${object}.${w[1]}`);
    }
  }
  for (const m of src.matchAll(/new\s+([A-Z][A-Za-z0-9_]*)\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g)) {
    const object = m[1]!;
    const args = m[2] ?? '';
    const assigned = [...args.matchAll(/\b([A-Za-z][A-Za-z0-9_]*)\s*=(?!=)/g)].map((x) => x[1]!);
    if (assigned.length === 0) continue; // e.g. new Result() — not an SObject constructor with fields
    for (const f of assigned) fp.fields.push(`${object}.${f}`);
    if (hasDml) fp.objectsWritten.push(object);
  }
  for (const m of src.matchAll(/\b([A-Z][A-Za-z0-9_]*)\.([A-Z][A-Za-z0-9_]*)\.getDescribe\(\)/g)) fp.fields.push(`${m[1]}.${m[2]}`);
}

function referencedClasses(src: string, projectClasses: Set<string>): string[] {
  const refs = new Set<string>();
  for (const m of src.matchAll(/\b([A-Z][A-Za-z0-9_]*)\s*\.\s*[a-zA-Z_]/g)) if (projectClasses.has(m[1]!)) refs.add(m[1]!);
  for (const m of src.matchAll(/\bnew\s+([A-Z][A-Za-z0-9_]*)\s*\(/g)) if (projectClasses.has(m[1]!)) refs.add(m[1]!);
  return [...refs];
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

const uniq = (xs: string[]) => [...new Set(xs)].sort();
