import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { parse } from 'yaml';

export interface MappingOverride {
  /** Component pattern, e.g. "ValidationRule:Opportunity.*" or "ApexClass:OpportunityAssistantUpdateStage". */
  component: string;
  actions: string[];
}

export interface InterceptorConfig {
  /** Absolute path of the config file's directory. */
  baseDir: string;
  org: {
    alias: string;
    expectedOrgId: string;
    expectedInstanceUrl: string;
    allowedOrganizationTypes: string[];
  };
  project: {
    /** SFDX project root (contains sfdx-project.json). Absolute after loading. */
    root: string;
    /** Metadata source directory relative to the project root, e.g. force-app/main/default. */
    packageDir: string;
  };
  agent: {
    bundle: string;
    /** .agent file relative to the project root. */
    agentFile: string;
  };
  /** Directory with interception specs (YAML). Absolute after loading. */
  specsDir: string;
  /** Directory for run records and reports. Absolute after loading. */
  runsDir: string;
  limits: { maxConversations: number };
  verifier: 'crt' | 'local';
  crt?: {
    project: number;
    robot: number;
    job?: number;
    timeoutMinutes: number;
    /** Robot suite file, relative to the config file. */
    suiteFile: string;
  };
  agentiaBin: string;
  mapping: { overrides: MappingOverride[] };
}

export class ConfigError extends Error {}

/** Loads and validates interceptor.config.yaml. Paths are resolved relative to the file. */
export function loadConfig(path: string): InterceptorConfig {
  let raw: unknown;
  try {
    raw = parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new ConfigError(`Cannot read config ${path}: ${(e as Error).message}`);
  }
  return validateConfig(raw, dirname(resolve(path)));
}

export function validateConfig(raw: unknown, baseDir: string): InterceptorConfig {
  const errors: string[] = [];
  const obj = (v: unknown, key: string): Record<string, unknown> => {
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
    errors.push(`${key} must be a mapping`);
    return {};
  };
  const str = (o: Record<string, unknown>, key: string, path: string, fallback?: string): string => {
    const v = o[key] ?? fallback;
    if (typeof v === 'string' && v.length > 0) return v;
    errors.push(`${path}.${key} must be a non-empty string`);
    return '';
  };
  const int = (o: Record<string, unknown>, key: string, path: string, fallback?: number): number => {
    const v = o[key] ?? fallback;
    if (typeof v === 'number' && Number.isInteger(v) && v > 0) return v;
    errors.push(`${path}.${key} must be a positive integer`);
    return 0;
  };
  const abs = (p: string, from: string) => (isAbsolute(p) ? p : resolve(from, p));

  const root = obj(raw, 'config');
  const org = obj(root.org, 'org');
  const project = obj(root.project, 'project');
  const agent = obj(root.agent, 'agent');
  const limits = obj(root.limits ?? {}, 'limits');

  const types = org.allowedOrganizationTypes ?? ['Developer Edition'];
  if (!Array.isArray(types) || types.some((t) => typeof t !== 'string')) {
    errors.push('org.allowedOrganizationTypes must be a list of strings');
  }

  const verifier = root.verifier ?? 'crt';
  if (verifier !== 'crt' && verifier !== 'local') errors.push('verifier must be "crt" or "local"');

  let crt: InterceptorConfig['crt'];
  if (root.crt !== undefined) {
    const c = obj(root.crt, 'crt');
    crt = {
      project: int(c, 'project', 'crt'),
      robot: int(c, 'robot', 'crt'),
      job: c.job === undefined || c.job === null ? undefined : int(c, 'job', 'crt'),
      timeoutMinutes: int(c, 'timeoutMinutes', 'crt', 15),
      suiteFile: abs(str(c, 'suiteFile', 'crt', 'crt/interceptor_verify.robot'), baseDir),
    };
  } else if (verifier === 'crt') {
    errors.push('crt section is required when verifier is "crt"');
  }

  const overrides: MappingOverride[] = [];
  const mapping = obj(root.mapping ?? {}, 'mapping');
  const rawOverrides = mapping.overrides ?? [];
  if (!Array.isArray(rawOverrides)) errors.push('mapping.overrides must be a list');
  else {
    rawOverrides.forEach((o, i) => {
      const m = obj(o, `mapping.overrides[${i}]`);
      const actions = m.actions;
      if (!Array.isArray(actions) || actions.some((a) => typeof a !== 'string')) {
        errors.push(`mapping.overrides[${i}].actions must be a list of action names`);
      }
      overrides.push({ component: str(m, 'component', `mapping.overrides[${i}]`), actions: (actions as string[]) ?? [] });
    });
  }

  const projectRoot = abs(str(project, 'root', 'project', '..'), baseDir);
  const cfg: InterceptorConfig = {
    baseDir,
    org: {
      alias: str(org, 'alias', 'org'),
      expectedOrgId: str(org, 'expectedOrgId', 'org'),
      expectedInstanceUrl: str(org, 'expectedInstanceUrl', 'org'),
      allowedOrganizationTypes: types as string[],
    },
    project: { root: projectRoot, packageDir: str(project, 'packageDir', 'project', 'force-app/main/default') },
    agent: { bundle: str(agent, 'bundle', 'agent'), agentFile: str(agent, 'agentFile', 'agent') },
    specsDir: abs(typeof root.specsDir === 'string' ? root.specsDir : 'specs', baseDir),
    runsDir: abs(typeof root.runsDir === 'string' ? root.runsDir : 'runs', baseDir),
    limits: { maxConversations: int(limits, 'maxConversations', 'limits', 10) },
    verifier: verifier as 'crt' | 'local',
    crt,
    agentiaBin: typeof root.agentiaBin === 'string' ? root.agentiaBin : 'agentia',
    mapping: { overrides },
  };
  if (errors.length) throw new ConfigError(`Invalid config:\n- ${errors.join('\n- ')}`);
  return cfg;
}
