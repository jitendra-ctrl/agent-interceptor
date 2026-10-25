import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { InterceptorConfig } from '../config/config.js';
import type { Runner } from '../util/exec.js';
import { parseAgentActions } from './agentModel.js';
import { buildFootprints, type ActionFootprint } from './dependencyGraph.js';
import { changedFiles, toComponent } from './diff.js';
import { mapImpact, type ImpactResult } from './mapping.js';

export interface ImpactReport extends ImpactResult {
  base: string;
  footprints: ActionFootprint[];
}

/** change (git diff against base) → changed components → affected agent actions, with reasons. */
export async function analyseImpact(runner: Runner, config: InterceptorConfig, base: string): Promise<ImpactReport> {
  const root = config.project.root;
  const files = await changedFiles(runner, root, base);
  const pkg = config.project.packageDir.replace(/\/$/, '');
  const components = files.filter((f) => f.path.startsWith(`${pkg}/`)).map(toComponent);

  const agentSource = readFileSync(join(root, config.agent.agentFile), 'utf8');
  const actions = parseAgentActions(agentSource);
  const footprints = buildFootprints(actions, join(root, pkg, 'classes'));

  const triggerObjects: Record<string, string> = {};
  const flowObjects: Record<string, string> = {};
  for (const c of components) {
    const file = join(root, c.path);
    if (!existsSync(file)) continue;
    const text = readFileSync(file, 'utf8');
    if (c.type === 'ApexTrigger') {
      const m = /trigger\s+\w+\s+on\s+([A-Za-z][A-Za-z0-9_]*)/i.exec(text);
      if (m) triggerObjects[c.name] = m[1]!;
    }
    if (c.type === 'Flow' && /<triggerType>Record/.test(text)) {
      const m = /<object>([A-Za-z][A-Za-z0-9_]*)<\/object>/.exec(text);
      if (m) flowObjects[c.name] = m[1]!;
    }
  }
  const result = mapImpact(components, footprints, config.mapping.overrides, {
    agentBundle: config.agent.bundle,
    triggerObjects,
    flowObjects,
  });
  return { base, footprints, ...result };
}
