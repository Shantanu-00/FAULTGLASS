import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';

// Use Vite's existing esbuild dependency so these tests run the real TypeScript helper
// without a browser, a backend, or a new runtime dependency.
const sourceUrl = new URL('../src/lib/commander.ts', import.meta.url);
const source = readFileSync(sourceUrl, 'utf8');
const { code } = transformSync(source, { sourcefile: sourceUrl.pathname, loader: 'ts', format: 'cjs', target: 'es2022' });
const compiled = { exports: {} };
runInNewContext(code, { module: compiled, exports: compiled.exports });
const { deriveCommanderEvent, hasWonderFindings, recordedRecoveryPercent } = compiled.exports;

const openedAt = '2026-11-03T10:00:00Z';
const laterAt = '2026-11-03T10:05:00Z';

function flag(overrides = {}) {
  return {
    id: 'flag-1', run_id: 'run-1', raised_at: openedAt, status: 'picked_up', severity: 'warning',
    tags: ['FIT-301'], summary: 'Product flow is below its learned baseline.', model: 'Muse Spark Open',
    incident_id: 'incident-1', ...overrides,
  };
}

function incident(overrides = {}) {
  return {
    incident: {
      incident_id: 'incident-1', title: 'Production drift', status: 'open', severity: 'medium', opened_at: openedAt,
      closed_at: null, closed_by: null, root_cause: null, resolution: null, models_used: ['Muse Wonder'],
    },
    flag: { ...flag(), evidence: { signals: { 'FIT-301': { current: 800, baseline: 1000, pct: -20, sigma: 5, unit: 'L/h' } } } },
    hypotheses: [], field_tasks: [], action_proposals: [], voice_observations: [],
    trace: [{ seq: 1, at: openedAt, kind: 'note', actor: 'code', content: 'Investigation started by Muse Wonder.', tool_name: null, hypothesis_id: null, evidence: [] }],
    investigation: { status: 'investigating', steps_used: 1, focus: { goal: 'Find the source of the drift.' }, model: 'Muse Wonder' },
    ...overrides,
  };
}

function input(overrides = {}) {
  return {
    plant: { plant_id: 'plant-1', name: 'Water plant', simulation: true, signals: [] },
    run: { id: 'run-1', status: 'running', clock_speed: 10, scenario: null, scenario_started_at: null, started_at: openedAt, baseline_ready_at: openedAt },
    flags: [flag()], incident: incident(), selectedIncidentId: 'incident-1', connection: 'online', ...overrides,
  };
}

function task(overrides = {}) {
  return {
    id: 'task-1', kind: 'gauge_photo', status: 'pending', instruction: 'Photograph the inlet and outlet gauges square-on.',
    asset_ids: ['CB-101'], tags: ['PI-201', 'PI-202'], result: null, created_at: laterAt, completed_at: null, ...overrides,
  };
}

function proposal(overrides = {}) {
  return {
    id: 'proposal-1', asset_id: 'V-113', action: 'backwash', rationale: 'The measured bank differential supports a restriction.',
    sop_id: 'SOP-CB-002', status: 'pending', field_task_id: null, result: null, created_at: laterAt, ...overrides,
  };
}

function hypothesis(overrides = {}) {
  return {
    label: 'H1', statement: 'A cartridge-bank restriction is likely.', status: 'supported',
    evidence_for: ['The inlet-to-outlet pressure difference is elevated.'], evidence_against: [], updated_at: laterAt, ...overrides,
  };
}

test('baseline learning and normal monitoring do not imply an incident or verified recovery', () => {
  const normal = input({ incident: null, selectedIncidentId: null, flags: [] });
  const learning = deriveCommanderEvent({ ...normal, run: { ...normal.run, status: 'learning' } });
  assert.match(learning.title, /learning.*baseline/i);
  assert.equal(learning.actor, 'Muse Spark Open');
  const monitoring = deriveCommanderEvent(normal);
  assert.match(monitoring.title, /monitoring/i);
  assert.equal(monitoring.tone, 'neutral');
  assert.doesNotMatch(monitoring.title, /incident|recovery|verified/i);
});

test('Spark remains primary until Wonder records evidence or a substantive finding', () => {
  const starting = incident();
  assert.equal(hasWonderFindings(starting), false);
  assert.equal(hasWonderFindings(incident({ hypotheses: [hypothesis({ status: 'open', evidence_for: [] })] })), false);
  const detection = deriveCommanderEvent(input({ incident: starting }));
  assert.equal(detection.actor, 'Muse Spark Open');
  assert.match(detection.title, /drop in product flow/i);

  const findings = incident({ hypotheses: [hypothesis()] });
  assert.equal(hasWonderFindings(findings), true);
  const assessment = deriveCommanderEvent(input({ incident: findings }));
  assert.equal(assessment.actor, 'Muse Wonder');
  assert.match(assessment.detail, /restriction is likely/i);

  const generic = incident({ flag: { ...flag({ tags: ['PIT-301'], summary: 'An unexplained pressure change was detected.' }), evidence: {} } });
  assert.match(deriveCommanderEvent(input({ incident: generic })).title, /abnormal drift/i);
  assert.doesNotMatch(deriveCommanderEvent(input({ incident: generic })).title, /product flow/i);
});

test('field requests, approval proposals and rejection expose the current next action', () => {
  const field = incident({ field_tasks: [task()] });
  assert.equal(hasWonderFindings(field), true);
  const request = deriveCommanderEvent(input({ incident: field }));
  assert.match(request.title, /waiting for gauge evidence/i);
  assert.match(request.detail, /PI-201.*PI-202/);

  const proposed = deriveCommanderEvent(input({ incident: incident({ action_proposals: [proposal()] }) }));
  assert.equal(proposed.title, 'Backwash proposed · approval required');
  assert.match(proposed.detail, /V-113/);
  assert.equal(proposed.actor, 'Muse Wonder');
  const longRationale = deriveCommanderEvent(input({ incident: incident({ action_proposals: [proposal({ rationale: 'Measured pressure evidence '.repeat(30) })] }) }));
  assert.ok(longRationale.detail.length <= 180);

  const rejected = deriveCommanderEvent(input({ incident: incident({ action_proposals: [proposal({ status: 'rejected' })] }) }));
  assert.equal(rejected.actor, 'Muse Wonder');
  assert.doesNotMatch(rejected.title, /approval required|recovery verified/i);
});

test('approval waits for the worker, and a passed valve clip still waits for recovery verification', () => {
  const valve = task({ kind: 'valve_action', asset_ids: ['V-113'], tags: [] });
  const awaitingWorker = deriveCommanderEvent(input({ incident: incident({ field_tasks: [valve], action_proposals: [proposal({ status: 'approved' })] }) }));
  assert.equal(awaitingWorker.actor, 'Field');
  assert.match(awaitingWorker.title, /waiting for the worker/i);
  assert.match(awaitingWorker.detail, /continuous.*V-113.*staged/i);

  const executed = incident({ field_tasks: [{ ...valve, status: 'completed', completed_at: laterAt }], action_proposals: [proposal({ status: 'executed' })] });
  const verifying = deriveCommanderEvent(input({ incident: executed }));
  assert.equal(verifying.actor, 'Verifier');
  assert.match(verifying.title, /checking recovery/i);
  assert.equal(verifying.tone, 'accent');
  assert.doesNotMatch(verifying.title, /recovery verified|\d+%/i);
  assert.equal(recordedRecoveryPercent(executed), null);
});

test('offline events identify cached state even when the cached incident was previously verified', () => {
  const cached = incident();
  cached.incident = { ...cached.incident, status: 'resolved', closed_by: 'verifier', resolution: 'FIT-301 recovered to 91.7% of baseline.' };
  const disconnected = deriveCommanderEvent(input({ incident: cached, connection: 'offline' }));
  assert.equal(disconnected.actor, 'System');
  assert.equal(disconnected.tone, 'warning');
  assert.match(disconnected.title, /connection interrupted/i);
  assert.match(disconnected.detail, /last received state.*reconnect/i);
  assert.doesNotMatch(disconnected.title, /verified|91\.7/);
});

test('missing or mismatched incident data cannot leak another incident’s recovery verdict', () => {
  const other = incident();
  other.incident = { ...other.incident, status: 'resolved', closed_by: 'verifier', resolution: 'FIT-301 recovered to 97% of baseline.' };
  for (const changes of [{ selectedIncidentId: 'another-incident', incident: other }, { incident: null }]) {
    const loading = deriveCommanderEvent(input(changes));
    assert.match(loading.title, /loading.*investigation/i);
    assert.doesNotMatch(loading.title, /verified|97%/);
  }
  assert.match(deriveCommanderEvent(input({ plant: null })).title, /connecting/i);
  const inactiveFlags = deriveCommanderEvent(input({ incident: null, selectedIncidentId: null, flags: [flag({ status: 'dismissed' }), flag({ id: 'old', status: 'resolved' })] }));
  assert.match(inactiveFlags.title, /monitoring/i);
});

test('recovery percentage comes only from a persisted verifier closure and preserves partial recovery', () => {
  const resolved = incident();
  resolved.incident = { ...resolved.incident, status: 'resolved', closed_by: 'verifier', closed_at: laterAt,
    resolution: 'FIT-301 recovered to 91.7% of baseline after backwash. Recovery is partial; replace the cartridge and inspect the sand filter.' };
  assert.equal(recordedRecoveryPercent(resolved), '91.7');
  const verified = deriveCommanderEvent(input({ incident: resolved }));
  assert.match(verified.title, /91\.7% of baseline/);
  assert.match(verified.detail, /partial.*replace.*inspect/i);
  assert.equal(verified.followUp.label, 'Cartridge replacement due');
  assert.match(verified.followUp.detail, /^Replace the cartridge/);

  for (const changes of [{ status: 'open' }, { closed_by: 'operator' }, { resolution: null }, { resolution: 'Recovered to 91.7.2% of baseline.' }]) {
    assert.equal(recordedRecoveryPercent({ ...resolved, incident: { ...resolved.incident, ...changes } }), null);
  }
  const manual = deriveCommanderEvent(input({ incident: { ...resolved, incident: { ...resolved.incident, closed_by: 'operator' } } }));
  assert.equal(manual.title, 'Incident closed');
  assert.doesNotMatch(manual.title, /verified|91\.7/);
  assert.equal(manual.followUp, undefined);
});

test('uncertain clips, verification failure and escalation stay unresolved', () => {
  const valve = task({ kind: 'valve_action', asset_ids: ['V-113'], tags: [] });
  const uncertain = incident({ field_tasks: [valve], trace: [{ seq: 2, at: laterAt, kind: 'observation', actor: 'code', content: 'Valve clip uncertain: the middle hold was not visible.' }] });
  const retry = deriveCommanderEvent(input({ incident: uncertain }));
  assert.equal(retry.tone, 'warning');
  assert.match(retry.title, /clearer valve clip/i);
  assert.match(retry.detail, /uncertain/i);

  const failed = incident({ action_proposals: [proposal({ status: 'failed' })], trace: [{ seq: 3, at: laterAt, kind: 'verification', actor: 'verifier', content: 'Verification did not pass: flow did not recover.' }] });
  const failure = deriveCommanderEvent(input({ incident: failed }));
  assert.equal(failure.tone, 'warning');
  assert.match(failure.detail, /did not pass/i);
  assert.doesNotMatch(failure.title, /recovery verified/i);

  const escalated = incident({ investigation: { status: 'escalated', steps_used: 20, focus: { blocker: 'The evidence is inconclusive.' } } });
  const review = deriveCommanderEvent(input({ incident: escalated }));
  assert.equal(review.tone, 'warning');
  assert.match(review.title, /human review/i);
  assert.match(review.detail, /inconclusive/i);
});
