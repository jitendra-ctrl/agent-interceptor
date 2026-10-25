import type { MappingOverride } from '../config/config.js';
import type { ActionFootprint } from './dependencyGraph.js';
import type { ChangedComponent } from './diff.js';

export interface ImpactedAction {
  action: string;
  /** One line per reason, e.g. "ValidationRule Opportunity.X → runs on save of Opportunity, which update_opportunity_stage writes". */
  paths: string[];
}

export interface ImpactResult {
  components: ChangedComponent[];
  impacted: ImpactedAction[];
  /** Components that matched no action (reported, not silently dropped). */
  unmatched: ChangedComponent[];
}

/**
 * Maps changed components to agent actions. Manual overrides from config always apply first and
 * are never removed by the heuristics.
 *   ApexClass        → actions whose implementation includes the class
 *   ValidationRule / ApexTrigger / record-triggered Flow on X → actions that write X
 *   CustomField X.F  → actions whose footprint includes X.F
 *   CustomObject X   → actions that read or write X
 *   PermissionSet / Profile → every action (permissions can block any action)
 *   AiAuthoringBundle of this agent → every action
 */
export function mapImpact(
  components: ChangedComponent[],
  footprints: ActionFootprint[],
  overrides: MappingOverride[],
  context: { agentBundle: string; triggerObjects?: Record<string, string>; flowObjects?: Record<string, string> },
): ImpactResult {
  const impacted = new Map<string, Set<string>>();
  const add = (action: string, why: string) => {
    if (!impacted.has(action)) impacted.set(action, new Set());
    impacted.get(action)!.add(why);
  };
  const unmatched: ChangedComponent[] = [];

  for (const c of components) {
    const label = `${c.type} ${c.name} (${c.status})`;
    let matched = false;
    for (const o of overrides) {
      if (matchesPattern(o.component, `${c.type}:${c.name}`)) {
        for (const a of o.actions) add(a, `${label} → manual mapping "${o.component}"`);
        matched = true;
      }
    }
    for (const fp of footprints) {
      const why = heuristic(c, fp, context);
      if (why) {
        add(fp.action, `${label} → ${why}`);
        matched = true;
      }
    }
    if (!matched) unmatched.push(c);
  }

  return {
    components,
    impacted: [...impacted.entries()].map(([action, paths]) => ({ action, paths: [...paths] })).sort((a, b) => a.action.localeCompare(b.action)),
    unmatched,
  };
}

function heuristic(
  c: ChangedComponent,
  fp: ActionFootprint,
  ctx: { agentBundle: string; triggerObjects?: Record<string, string>; flowObjects?: Record<string, string> },
): string | null {
  switch (c.type) {
    case 'ApexClass':
      return fp.classes.includes(c.name) ? `${fp.action} is implemented by ${fp.classes.join(', ')}` : null;
    case 'ValidationRule':
      return c.object && fp.objectsWritten.includes(c.object)
        ? `validation rules run when ${c.object} is saved, and ${fp.action} writes ${c.object}`
        : null;
    case 'ApexTrigger': {
      const obj = ctx.triggerObjects?.[c.name];
      return obj && fp.objectsWritten.includes(obj) ? `trigger on ${obj}, which ${fp.action} writes` : null;
    }
    case 'Flow': {
      const obj = ctx.flowObjects?.[c.name];
      if (obj) return fp.objectsWritten.includes(obj) ? `record-triggered flow on ${obj}, which ${fp.action} writes` : null;
      return null;
    }
    case 'CustomField':
      return fp.fields.includes(c.name) ? `${fp.action} reads or writes ${c.name}` : null;
    case 'CustomObject':
      return c.object && (fp.objectsRead.includes(c.object) || fp.objectsWritten.includes(c.object))
        ? `${fp.action} uses ${c.object}`
        : null;
    case 'PermissionSet':
    case 'Profile':
      return `permission changes can block any action, including ${fp.action}`;
    case 'AiAuthoringBundle':
      return c.name === ctx.agentBundle ? `the agent definition itself changed` : null;
    default:
      return null;
  }
}

/** Glob with `*` only, e.g. "ValidationRule:Opportunity.*". */
export function matchesPattern(pattern: string, value: string): boolean {
  const re = new RegExp(`^${pattern.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
  return re.test(value);
}
