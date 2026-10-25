/**
 * Minimal reader for the parts of an Agent Script (.agent) file that impact analysis needs:
 * action definitions (name + target) inside `actions:` blocks of start_agent / subagent blocks.
 * It is indentation-based, not a full parser; validation of the file itself is done by the
 * Agentforce compiler (`sf agent validate authoring-bundle`).
 */
export interface AgentAction {
  name: string;
  /** Raw target, e.g. "apex://OpportunityAssistantUpdateStage". */
  target: string;
  targetType: string;
  targetName: string;
  /** start_agent or subagent block that defines it. */
  block: string;
}

export function parseAgentActions(source: string): AgentAction[] {
  const lines = source.split('\n');
  const actions: AgentAction[] = [];
  let block = '';
  let actionsIndent = -1; // indent of an `actions:` definition block (not reasoning.actions)
  let current: { name: string; indent: number } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const line = raw.replace(/#.*$/, '').replace(/\s+$/, '');
    if (!line.trim()) continue;
    const indent = line.length - line.trimStart().length;
    const text = line.trim();

    const top = /^(start_agent|subagent)\s+([A-Za-z][A-Za-z0-9_]*)\s*:$/.exec(text);
    if (indent === 0) {
      block = top ? top[2]! : '';
      actionsIndent = -1;
      current = null;
      continue;
    }
    if (!block) continue;
    if (actionsIndent >= 0 && indent <= actionsIndent) {
      actionsIndent = -1;
      current = null;
    }
    // Definition blocks sit directly under the block (one level deep); reasoning.actions is deeper.
    if (text === 'actions:' && actionsIndent < 0 && isDirectChild(indent, lines, i)) {
      actionsIndent = indent;
      continue;
    }
    if (actionsIndent < 0) continue;
    const name = /^([A-Za-z][A-Za-z0-9_]*)\s*:$/.exec(text);
    if (name && (current === null || indent <= current.indent)) {
      current = { name: name[1]!, indent };
      continue;
    }
    const target = /^target\s*:\s*"([^"]+)"$/.exec(text);
    if (target && current) {
      const [type, ...rest] = target[1]!.split('://');
      actions.push({
        name: current.name,
        target: target[1]!,
        targetType: type ?? '',
        targetName: rest.join('://'),
        block,
      });
    }
  }
  return actions;
}

// `actions:` directly under start_agent/subagent has the block's child indent (the indent of `description:`).
function isDirectChild(indent: number, lines: string[], idx: number): boolean {
  for (let i = idx - 1; i >= 0; i--) {
    const l = lines[i]!;
    if (!l.trim() || l.trim().startsWith('#')) continue;
    const ind = l.length - l.trimStart().length;
    if (ind === 0) return true; // reached the block header with nothing shallower in between
    if (ind < indent) return false; // nested inside something (e.g. reasoning:)
  }
  return false;
}
