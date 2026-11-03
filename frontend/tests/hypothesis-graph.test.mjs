import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { transformSync } from 'esbuild';

const source = readFileSync(new URL('../src/lib/hypothesisGraph.ts', import.meta.url), 'utf8');
const { code } = transformSync(source, { loader: 'ts', format: 'cjs', target: 'es2022' });
const compiled = { exports: {} };
runInNewContext(code, { module: compiled, exports: compiled.exports });
const { deriveHypothesisGraph } = compiled.exports;
const at = '2026-11-03T10:00:00Z';
const hypothesis = (label, status, extra = {}) => ({ label, statement: `Possible cause ${label}`, status, evidence_for: [], evidence_against: [], updated_at: at, ...extra });
const proposal = extra => ({ id: 'proposal-1', asset_id: 'V-113', action: 'backwash', rationale: 'Recorded differential supports restriction.', sop_id: 'SOP-1', status: 'pending', field_task_id: null, result: null, created_at: at, ...extra });
const detail = extra => ({
  incident: { incident_id: 'i-1', title: 'Product flow drift', status: 'open', closed_at: null, closed_by: null, root_cause: null, resolution: null },
  flag: { id: 'f-1', summary: 'Product flow is below baseline.', raised_at: at, tags: ['FIT-301'], evidence: {} },
  trace: [], hypotheses: [], field_tasks: [], action_proposals: [], voice_observations: [], investigation: { status: 'investigating', focus: {} }, ...extra,
});

test('an unresolved map shows unknown outcomes and never invents a successful response', () => {
  const graph = deriveHypothesisGraph(detail({}), [hypothesis('H1', 'open')]);
  assert.equal(graph.verified, false);
  assert.equal(graph.nodes.find(node => node.id === 'outcome').status, 'Unresolved');
  assert.ok(graph.nodes.some(node => node.id === 'no-response'));
  assert.ok(graph.nodes.some(node => node.title === 'Spark detected a change'));
  assert.equal(graph.edges.some(edge => edge.to === 'outcome'), false);
  assert.equal(graph.edges.every(edge => edge.relation === 'context'), true);
  const serialized = JSON.stringify(graph);
  assert.doesNotMatch(serialized, /confidence|92%|100%/i);
});

test('rejected hypotheses retain their rejection evidence and have no arrow to a proposed action', () => {
  const items = [hypothesis('H1', 'supported', { evidence_for: ['The differential is elevated.'] }),
    hypothesis('H2', 'rejected', { evidence_against: ['Pump is running.'], evidence_for: ['Historical pump fault.'] })];
  const graph = deriveHypothesisGraph(detail({ action_proposals: [proposal({})] }), items);
  const rejected = graph.nodes.find(node => node.id === 'hypothesis:H2');
  assert.equal(rejected.status, 'Ruled out');
  assert.equal(rejected.summary, 'Pump is running.');
  assert.equal(rejected.sections.find(section => section.title === 'Supporting evidence').entries[0], 'Historical pump fault.');
  assert.equal(graph.edges.some(edge => edge.from === 'hypothesis:H2' && edge.to.startsWith('proposal:')), false);
  const response = graph.edges.find(edge => edge.from === 'hypothesis:H1' && edge.to === 'proposal:proposal-1');
  assert.equal(response.relation, 'context');
  assert.match(response.label, /no explicit causal link/i);
});

test('solid links require an explicit saved hypothesis ID or proposal field-task ID', () => {
  const graph = deriveHypothesisGraph(detail({
    trace: [{ seq: 1, at, kind: 'tool_result', actor: 'code', tool_name: 'get_latest_telemetry', hypothesis_id: 'H1', content: 'Pump running.', evidence: [] }],
    action_proposals: [proposal({ status: 'approved', field_task_id: 'task-1' })],
    field_tasks: [{ id: 'task-1', kind: 'valve_action', status: 'pending', asset_ids: ['V-113'], instruction: 'Move the lever in two stages.', result: null, created_at: at }],
  }), [hypothesis('H1', 'supported'), hypothesis('H2', 'open')]);
  assert.equal(graph.edges.find(edge => edge.from === 'evidence' && edge.to === 'hypothesis:H1').relation, 'recorded');
  assert.equal(graph.edges.find(edge => edge.from === 'evidence' && edge.to === 'hypothesis:H2').relation, 'context');
  assert.equal(graph.edges.find(edge => edge.from === 'proposal:proposal-1' && edge.to === 'task:task-1').relation, 'recorded');
  assert.equal(graph.verified, false);
});

test('only saved verifier closure supplies the verified endpoint, including partial recovery', () => {
  const incident = { ...detail({}).incident, status: 'resolved', closed_by: 'verifier', closed_at: at,
    root_cause: 'Cartridge restriction', resolution: 'Production recovered to 91.7% of baseline. Replace cartridge.' };
  const graph = deriveHypothesisGraph(detail({ incident }), [hypothesis('H1', 'confirmed')]);
  assert.equal(graph.verified, true);
  assert.equal(graph.nodes.find(node => node.id === 'outcome').title, 'Recovery verified');
  assert.match(graph.nodes.find(node => node.id === 'outcome').summary, /91\.7%.*Replace cartridge/);
  const manual = deriveHypothesisGraph(detail({ incident: { ...incident, closed_by: 'operator' } }), []);
  assert.equal(manual.verified, false);
  assert.equal(manual.nodes.find(node => node.id === 'outcome').title, 'Incident closed');
  const premature = deriveHypothesisGraph(detail({ incident: { ...incident, status: 'open' } }), []);
  assert.equal(premature.verified, false);
});

test('all recorded evidence and hypothesis updates remain available in node details', () => {
  const entries = [
    { seq: 1, at, kind: 'tool_call', actor: 'model', tool_name: 'record_hypothesis', hypothesis_id: 'H2', content: 'Earlier hypothesis under review.', evidence: [] },
    { seq: 2, at, kind: 'hypothesis_rejected', actor: 'code', tool_name: 'record_hypothesis', hypothesis_id: 'H2', content: 'H2 ruled out after a returned check.', evidence: [] },
  ];
  const graph = deriveHypothesisGraph(detail({ trace: entries }), [hypothesis('H2', 'rejected', { evidence_against: ['Pump is running.', 'Motor current stable.'] })]);
  const node = graph.nodes.find(node => node.id === 'hypothesis:H2');
  assert.equal(node.sections.find(section => section.title === 'Evidence against').entries.length, 2);
  const updates = node.sections.find(section => /hypothesis updates/.test(section.title));
  assert.equal(updates.entries.length, 2);
  assert.match(updates.entries[0], /Earlier hypothesis/);
  assert.match(updates.entries[1], /ruled out/);
  assert.equal(graph.nodes.some(node => node.id === 'evidence'), false);
});
