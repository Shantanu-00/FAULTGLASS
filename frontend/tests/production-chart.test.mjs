import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { transformSync } from 'esbuild';

const source = readFileSync(new URL('../src/lib/productionChart.ts', import.meta.url), 'utf8');
const { code } = transformSync(source, { loader: 'ts', format: 'cjs' });
const module = { exports: {} };
runInNewContext(code, { module, exports: module.exports });
const { productionChartScale } = module.exports;

test('production axis fits decline, recovery and baseline without clipping', () => {
  const points = [100, 75, 92].map((v, t) => ({ t, v }));
  const { domain, ticks } = productionChartScale(points, 100, 92);
  assert.ok(domain[0] <= 75 && domain[1] >= 100);
  assert.ok(domain[1] - domain[0] < 60);
  assert.ok(ticks.includes(100));
});
test('a stable series is centered within a nonzero axis span', () => {
  const { domain } = productionChartScale([{ t: 1, v: 100 }], 100, 100);
  assert.ok(domain[0] < 100 && domain[1] > 100);
  assert.ok(Number.isFinite(domain[0]) && Number.isFinite(domain[1]));
});
test('empty, zero and invalid histories remain well-defined', () => {
  assert.equal(productionChartScale([], undefined).domain[0], 0);
  const zero = productionChartScale([{ t: 1, v: 0 }]);
  assert.ok(zero.domain[1] > zero.domain[0]);
  const invalid = productionChartScale([{ t: 1, v: NaN }], undefined, Infinity);
  assert.ok(invalid.domain.every(Number.isFinite));
});
