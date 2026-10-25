import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseAgentActions } from '../src/impact/agentModel.js';
import { buildFootprints } from '../src/impact/dependencyGraph.js';
import { parseNameStatus, toComponent } from '../src/impact/diff.js';
import { mapImpact, matchesPattern } from '../src/impact/mapping.js';
import { REPO } from './helpers.js';

const PKG_DIR = join(REPO, 'force-app', 'main', 'default');
const agentSource = readFileSync(join(PKG_DIR, 'aiAuthoringBundles', 'Opportunity_Assistant', 'Opportunity_Assistant.agent'), 'utf8');

test('parses action definitions (not reasoning.actions) from the real .agent file', () => {
  const actions = parseAgentActions(agentSource);
  assert.deepEqual(
    actions.map((a) => [a.name, a.target, a.block]),
    [
      ['find_opportunity', 'apex://OpportunityAssistantFind', 'opportunity_assistant'],
      ['update_opportunity_stage', 'apex://OpportunityAssistantUpdateStage', 'opportunity_assistant'],
    ],
  );
});

test('parses actions in several blocks with identical indentation', () => {
  const src = [
    'start_agent a:', '    description: "x"', '    reasoning:', '        actions:', '            go: @actions.one', '    actions:',
    '        one:', '            target: "apex://One"', '            inputs:', '                x: string',
    'subagent b:', '    description: "y"', '    actions:', '        two:', '            target: "flow://Two"',
  ].join('\n');
  assert.deepEqual(parseAgentActions(src).map((a) => `${a.block}:${a.name}:${a.targetType}:${a.targetName}`), ['a:one:apex:One', 'b:two:flow:Two']);
});

test('footprints from the real Apex: update writes Opportunity.StageName, find only reads', () => {
  const fps = buildFootprints(parseAgentActions(agentSource), join(PKG_DIR, 'classes'));
  const find = fps.find((f) => f.action === 'find_opportunity')!;
  const upd = fps.find((f) => f.action === 'update_opportunity_stage')!;
  assert.deepEqual(find.objectsWritten, []);
  assert.ok(find.objectsRead.includes('Opportunity'));
  assert.ok(find.fields.includes('Opportunity.Name'));
  assert.deepEqual(upd.objectsWritten, ['Opportunity']);
  assert.ok(upd.fields.includes('Opportunity.StageName'));
  assert.deepEqual(upd.classes, ['OpportunityAssistantUpdateStage']);
});

test('git name-status and paths map to components', () => {
  const files = parseNameStatus('A\tforce-app/main/default/objects/Opportunity/validationRules/AI_Rule.validationRule-meta.xml\nM\tforce-app/main/default/classes/X.cls\nD\tREADME.md\n');
  assert.deepEqual(files.map((f) => f.status), ['added', 'modified', 'deleted']);
  const vr = toComponent(files[0]!);
  assert.deepEqual([vr.type, vr.name, vr.object], ['ValidationRule', 'Opportunity.AI_Rule', 'Opportunity']);
  assert.equal(toComponent(files[1]!).type, 'ApexClass');
  assert.equal(toComponent({ path: 'force-app/main/default/objects/Opportunity/fields/Amount.field-meta.xml', status: 'modified' }).name, 'Opportunity.Amount');
  assert.equal(toComponent({ path: 'force-app/main/default/aiAuthoringBundles/Opportunity_Assistant/Opportunity_Assistant.agent', status: 'modified' }).type, 'AiAuthoringBundle');
  assert.equal(toComponent({ path: 'force-app/main/default/flows/F.flow-meta.xml', status: 'added' }).type, 'Flow');
});

test('a validation rule on Opportunity affects only the action that writes Opportunity', () => {
  const fps = buildFootprints(parseAgentActions(agentSource), join(PKG_DIR, 'classes'));
  const vr = toComponent({ path: 'force-app/main/default/objects/Opportunity/validationRules/R.validationRule-meta.xml', status: 'added' });
  const r = mapImpact([vr], fps, [], { agentBundle: 'Opportunity_Assistant' });
  assert.deepEqual(r.impacted.map((i) => i.action), ['update_opportunity_stage']);
  assert.match(r.impacted[0]!.paths[0]!, /validation rules run when Opportunity is saved/);
  assert.deepEqual(r.unmatched, []);
});

test('other components: class, field, permission set, agent bundle, unmatched, overrides', () => {
  const fps = buildFootprints(parseAgentActions(agentSource), join(PKG_DIR, 'classes'));
  const ctx = { agentBundle: 'Opportunity_Assistant' };
  const c = (path: string) => toComponent({ path: `force-app/main/default/${path}`, status: 'modified' });
  assert.deepEqual(mapImpact([c('classes/OpportunityAssistantFind.cls')], fps, [], ctx).impacted.map((i) => i.action), ['find_opportunity']);
  assert.deepEqual(mapImpact([c('objects/Opportunity/fields/Amount.field-meta.xml')], fps, [], ctx).impacted.map((i) => i.action), ['find_opportunity']);
  assert.equal(mapImpact([c('permissionsets/P.permissionset-meta.xml')], fps, [], ctx).impacted.length, 2);
  assert.equal(mapImpact([c('aiAuthoringBundles/Opportunity_Assistant/Opportunity_Assistant.agent')], fps, [], ctx).impacted.length, 2);
  const lwc = c('lwc/x/x.js');
  assert.deepEqual(mapImpact([lwc], fps, [], ctx).unmatched, [lwc]);
  const flow = c('flows/Opp_Sync.flow-meta.xml');
  const withOverride = mapImpact([flow], fps, [{ component: 'Flow:Opp_*', actions: ['update_opportunity_stage'] }], ctx);
  assert.deepEqual(withOverride.impacted.map((i) => i.action), ['update_opportunity_stage']);
  assert.match(withOverride.impacted[0]!.paths[0]!, /manual mapping/);
  const triggered = mapImpact([flow], fps, [], { ...ctx, flowObjects: { Opp_Sync: 'Opportunity' } });
  assert.deepEqual(triggered.impacted.map((i) => i.action), ['update_opportunity_stage']);
});

test('pattern matching uses * only', () => {
  assert.ok(matchesPattern('ValidationRule:Opportunity.*', 'ValidationRule:Opportunity.AI_X'));
  assert.ok(!matchesPattern('ValidationRule:Opportunity.*', 'ValidationRule:Account.AI_X'));
  assert.ok(matchesPattern('ApexClass:A.B', 'ApexClass:A.B'));
  assert.ok(!matchesPattern('ApexClass:A.B', 'ApexClass:AxB'));
});
