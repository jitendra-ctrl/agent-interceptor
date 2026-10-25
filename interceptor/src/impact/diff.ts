import { CommandError, type Runner } from '../util/exec.js';

export type ChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed';

export interface ChangedFile {
  path: string;
  status: ChangeStatus;
}

/** A Salesforce metadata component identified from a changed source path. */
export interface ChangedComponent {
  type:
    | 'ApexClass'
    | 'ApexTrigger'
    | 'ValidationRule'
    | 'CustomField'
    | 'CustomObject'
    | 'Flow'
    | 'PermissionSet'
    | 'Profile'
    | 'GenAiPromptTemplate'
    | 'AiAuthoringBundle'
    | 'Other';
  /** e.g. "OpportunityAssistantUpdateStage", "Opportunity.AI_Demo_Rule", "Opportunity.Amount". */
  name: string;
  /** SObject the component belongs to, when known from the path. */
  object?: string;
  path: string;
  status: ChangeStatus;
}

/**
 * Lists files changed between <base> and the working tree (committed + uncommitted + untracked).
 * `git diff --name-status <base>` covers tracked changes; untracked files come from `git ls-files`.
 */
export async function changedFiles(runner: Runner, repoRoot: string, base: string): Promise<ChangedFile[]> {
  const diff = await runner.run('git', ['diff', '--name-status', '--no-renames', base, '--'], { cwd: repoRoot });
  if (diff.code !== 0) throw new CommandError(`git diff ${base} failed: ${diff.stderr.trim()}`, diff);
  const untracked = await runner.run('git', ['ls-files', '--others', '--exclude-standard'], { cwd: repoRoot });
  return [...parseNameStatus(diff.stdout), ...untracked.stdout.split('\n').filter(Boolean).map((p) => ({ path: p, status: 'added' as const }))];
}

export function parseNameStatus(out: string): ChangedFile[] {
  const map: Record<string, ChangeStatus> = { A: 'added', M: 'modified', D: 'deleted', R: 'renamed', T: 'modified' };
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [code, ...rest] = line.split('\t');
      return { path: rest[rest.length - 1] ?? '', status: map[code?.[0] ?? 'M'] ?? 'modified' };
    })
    .filter((f) => f.path);
}

/** Maps a source-format path (…/main/default/<folder>/…) to a metadata component. */
export function toComponent(file: ChangedFile): ChangedComponent {
  const p = file.path.replace(/\\/g, '/');
  const base = { path: file.path, status: file.status };
  let m: RegExpExecArray | null;
  if ((m = /\/classes\/([^/]+)\.cls(-meta\.xml)?$/.exec(p))) return { ...base, type: 'ApexClass', name: m[1]! };
  if ((m = /\/triggers\/([^/]+)\.trigger(-meta\.xml)?$/.exec(p))) return { ...base, type: 'ApexTrigger', name: m[1]! };
  if ((m = /\/objects\/([^/]+)\/validationRules\/([^/]+)\.validationRule-meta\.xml$/.exec(p))) {
    return { ...base, type: 'ValidationRule', name: `${m[1]}.${m[2]}`, object: m[1]! };
  }
  if ((m = /\/objects\/([^/]+)\/fields\/([^/]+)\.field-meta\.xml$/.exec(p))) {
    return { ...base, type: 'CustomField', name: `${m[1]}.${m[2]}`, object: m[1]! };
  }
  if ((m = /\/objects\/([^/]+)\/\1\.object-meta\.xml$/.exec(p))) return { ...base, type: 'CustomObject', name: m[1]!, object: m[1]! };
  if ((m = /\/flows\/([^/]+)\.flow-meta\.xml$/.exec(p))) return { ...base, type: 'Flow', name: m[1]! };
  if ((m = /\/permissionsets\/([^/]+)\.permissionset-meta\.xml$/.exec(p))) return { ...base, type: 'PermissionSet', name: m[1]! };
  if ((m = /\/profiles\/([^/]+)\.profile-meta\.xml$/.exec(p))) return { ...base, type: 'Profile', name: m[1]! };
  if ((m = /\/genAiPromptTemplates\/([^/]+)\.genAiPromptTemplate-meta\.xml$/.exec(p))) {
    return { ...base, type: 'GenAiPromptTemplate', name: m[1]! };
  }
  if ((m = /\/aiAuthoringBundles\/([^/]+)\//.exec(p))) return { ...base, type: 'AiAuthoringBundle', name: m[1]! };
  return { ...base, type: 'Other', name: p };
}
