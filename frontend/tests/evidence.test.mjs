import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { buildSync } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
function load(relative) {
  const { outputFiles } = buildSync({ entryPoints: [fileURLToPath(new URL(relative, import.meta.url))],
    write: false, bundle: true, format: 'cjs', platform: 'node', packages: 'external',
    loader: { '.css': 'empty' }, define: { 'import.meta.env.VITE_API_URL': '"http://localhost:8000"' } });
  const compiled = { exports: {} };
  runInNewContext(outputFiles[0].text, { module: compiled, exports: compiled.exports, require });
  return compiled.exports;
}
const { TaskResultView } = load('../src/components/field/Results.tsx');
const { evidenceUrl } = load('../src/api/client.ts');
const render = result => renderToStaticMarkup(React.createElement(TaskResultView, { result }));

test('submitted partial accepted readings and source are visible', () => {
  const html = render({ gauges: [], accepted: { 'PI-201': 24 }, source: 'gauge_photo', note: 'Outlet needs another photo.' });
  assert.match(html, /PI-201/);
  assert.match(html, /24\.0/);
  assert.match(html, /Outlet needs another photo/);
  assert.match(html, /Read from submitted gauge photos/);
  assert.doesNotMatch(html, /typed by the operator/);
});

test('stored per-tag gauges and differential render together', () => {
  const html = render({ gauges_by_tag: { 'PI-201': { tag: 'PI-201', status: 'read', value: 24,
    wonder_reasoning: 'BETWEEN: 20 and 30 psi' } }, differential: {
    inlet_tag: 'PI-201', outlet_tag: 'PI-202', inlet_psi: 24, outlet_psi: 6, dp_psi: 18,
    normal_dp_psi: 3, limit_dp_psi: 10, restricted: true } });
  assert.match(html, /20 and 30 psi/);
  assert.match(html, /Differential 18\.0 psi/);
  assert.match(html, /Bank restricted/);
});

test('empty or failed submissions show an explicit state', () => {
  assert.match(render({}), /Submission saved/);
  assert.match(render({ error: 'Analysis unavailable. Retry the clip.' }), /Analysis unavailable/);
  assert.doesNotMatch(render({ readings: { 'PI-201': NaN } }), /NaN/);
});

test('media links only resolve an incident task evidence resource', () => {
  assert.equal(evidenceUrl('/v1/incidents/INC-1/tasks/task-1/media/abc123'), 'http://localhost:8000/v1/incidents/INC-1/tasks/task-1/media/abc123');
  for (const path of ['https://example.com/photo.jpg', '//example.com/photo.jpg', '/uploads/private.wav',
    '/v1/incidents/../tasks/task-1/media/abc', '/v1/incidents/INC%2fsecret/tasks/task-1/media/abc']) {
    assert.equal(evidenceUrl(path), null);
  }
});
