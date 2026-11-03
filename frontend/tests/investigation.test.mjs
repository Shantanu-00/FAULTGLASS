import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { buildSync } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
function component(relative) {
  const result = buildSync({ entryPoints: [fileURLToPath(new URL(relative, import.meta.url))], bundle: true,
    write: false, format: 'cjs', platform: 'node', external: ['react'], target: 'es2022' });
  const module = { exports: {} };
  runInNewContext(result.outputFiles[0].text, { module, exports: module.exports, require });
  return module.exports;
}
const { investigationActivities } = component('../src/components/operator/InvestigationJourney.tsx');
const { Hypotheses } = component('../src/components/operator/Hypotheses.tsx');
const at = '2026-11-03T10:00:00Z';
function event(seq, extra = {}) {
  return { seq, at, kind: 'tool_call', actor: 'model', tool_name: 'get_latest_telemetry',
    content: '{}', evidence: [], hypothesis_id: null, ...extra };
}

test('a visible check joins the actual request to its returned evidence', () => {
  const rows = investigationActivities([
    event(1, { content: '{"tags":["FIT-301"]}' }),
    event(2, { kind: 'tool_result', actor: 'code', content: '{"readings":[{"tag":"FIT-301","value":1500,"unit":"L/h"}]}' }),
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].result.seq, 2);
  assert.match(rows[0].summary, /FIT-301 1500 L\/h/);
});

test('repeated calls cannot borrow another request’s result', () => {
  const rows = investigationActivities([
    event(1), event(2), event(3, { kind: 'tool_result', actor: 'code', content: '{"readings":[]}' }),
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].result, undefined);
  assert.match(rows[0].summary, /has not arrived/);
  assert.equal(rows[1].result.seq, 3);
});

test('missing physical evidence is shown as a requirement rather than a successful reading', () => {
  const [row] = investigationActivities([event(1), event(2, {
    actor: 'code', kind: 'tool_result', content: '{"error":"requires_field_task"}',
  })]);
  assert.equal(row.failed, true);
  assert.match(row.summary, /worker must collect/);
});

test('hypothesis updates show the recorded rejection and preserve incomplete results', () => {
  const [row] = investigationActivities([
    event(1, { tool_name: 'record_hypothesis', content: '{"label":"H2","status":"rejected"}' }),
    event(2, { tool_name: 'record_hypothesis', actor: 'code', kind: 'hypothesis_rejected',
      content: '{"recorded":"H2","status":"rejected"}' }),
  ]);
  assert.match(row.summary, /H2 → ruled out/);
  const [truncated] = investigationActivities([event(3, { actor: 'code', kind: 'recall',
    tool_name: 'recall_plant_memory', content: '{"title":"Cartridge bank","data":' })]);
  assert.equal(truncated.summary, 'Cartridge bank');
});

test('hypothesis board exposes supported, open and rejected alternatives without a history toggle', () => {
  const items = [
    { label: 'H1', statement: 'Cartridge restriction', status: 'supported', evidence_for: ['Differential is elevated.'], evidence_against: [] },
    { label: 'H2', statement: 'Feed pump stopped', status: 'rejected', evidence_for: [], evidence_against: ['Pump status is RUNNING.'] },
    { label: 'H3', statement: 'Membrane restriction', status: 'open', evidence_for: ['Production has declined.'], evidence_against: [] },
  ].map(item => ({ ...item, updated_at: at }));
  const html = renderToStaticMarkup(React.createElement(Hypotheses, { items, model: 'muse-wonder-1.0' }));
  assert.match(html, /id="hypothesis-board"/);
  for (const value of ['Cartridge restriction', 'Feed pump stopped', 'Membrane restriction', 'Pump status is RUNNING.', 'Ruled out', 'Under review']) assert.ok(html.includes(value), value);
  assert.equal((html.match(/class="finding finding-/g) ?? []).length, 3);
  assert.doesNotMatch(html, /confidence|\d+%/i);
});
