import { api } from './api.js';
import { Store } from './store.js';
import { sparkline } from './sparkline.js';

const store = new Store();
const ABNORMAL = /TRIP|FAULT|^LOW_|^HIGH_/;

const GROUPS = [
  { title: 'Pumps', match: (s) => s.quantity === 'run_state' },
  { title: 'Tanks', match: (s) => s.quantity === 'level_switch' },
  { title: 'High-pressure pump', match: (s) => ['pressure', 'pressure_switch', 'current'].includes(s.quantity) },
  { title: 'Product water', match: (s) => ['flow', 'tds'].includes(s.quantity) },
  { title: 'RO machine', match: (s) => ['cycle_state', 'fault_code'].includes(s.quantity) },
];

const el = (id) => document.getElementById(id);

function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (value !== false && value !== null && value !== undefined) node.setAttribute(key, value === true ? '' : value);
  }
  node.append(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
  return node;
}

let online = false;
const rows = new Map();

function decimals(signal) {
  return signal.unit === 'L/h' ? 0 : 1;
}

function readingState(signal, reading) {
  if (!reading || reading.value === null || reading.quality === 'bad' || reading.quality === 'stale') return 'stale';
  const ageS = (Date.now() - Date.parse(reading.observed_at)) / 1000;
  if (ageS > Math.max((signal.freshness_s ?? 5) * 3, 10)) return 'stale';
  if (signal.type !== 'measurement') {
    const label = signal.state_labels?.[String(Math.round(reading.value))];
    return label && ABNORMAL.test(label) ? 'alarm' : 'ok';
  }
  const l = signal.limits;
  if ((l.low_trip !== undefined && reading.value <= l.low_trip) || (l.high_trip !== undefined && reading.value >= l.high_trip)) return 'alarm';
  if ((l.low_alarm !== undefined && reading.value <= l.low_alarm) || (l.high_alarm !== undefined && reading.value >= l.high_alarm)) return 'warn';
  return 'ok';
}

function display(signal, reading, state) {
  if (state === 'stale' && (!reading || reading.value === null)) return { text: 'No data', unit: '' };
  if (signal.type !== 'measurement') {
    return { text: signal.state_labels?.[String(Math.round(reading.value))] ?? String(reading.value), unit: '' };
  }
  return { text: reading.value.toFixed(decimals(signal)), unit: signal.unit };
}

function buildSignals() {
  const root = el('signals');
  root.replaceChildren();
  for (const group of GROUPS) {
    const members = store.signals
      .filter(group.match)
      .sort((a, b) => (a.type === 'measurement' ? 0 : 1) - (b.type === 'measurement' ? 0 : 1));
    if (!members.length) continue;
    const card = h('section', { class: 'group' }, h('h2', {}, group.title));
    for (const signal of members) {
      const value = h('span', { class: signal.type === 'measurement' ? 'num' : 'num state' });
      const unit = h('span', { class: 'unit' });
      const trend = h('span', { class: 'trend' });
      const dot = h('span', { class: 'dot' });
      const row = h(
        'div',
        { class: 'row', 'data-tag': signal.tag },
        dot,
        h('span', { class: 'label' }, signal.name, h('code', {}, signal.tag)),
        h('span', { class: 'reading' }, value, unit),
        trend,
      );
      rows.set(signal.tag, { signal, row, value, unit, trend });
      card.append(row);
    }
    root.append(card);
  }
}

function updateSignals() {
  for (const { signal, row, value, unit, trend } of rows.values()) {
    const reading = store.readings.get(signal.tag);
    const state = readingState(signal, reading);
    const shown = display(signal, reading, state);
    row.dataset.state = state;
    value.textContent = shown.text;
    unit.textContent = shown.unit;
    if (signal.type === 'measurement') {
      const nominal = signal.limits.nominal;
      const spread = (signal.range[1] - signal.range[0]) * 0.02;
      trend.replaceChildren(sparkline(store.series.get(signal.tag) ?? [], { nominal, spread: Math.max(spread, Math.abs(nominal ?? 0) * 0.03) }));
    }
  }
}

function chip(text, kind = '') {
  return h('span', { class: `chip ${kind}` }, text);
}

const STATUS_TEXT = { starting: 'Starting', learning: 'Learning baseline', running: 'Running', stopped: 'Stopped' };

function updateChips() {
  const run = store.run;
  const chips = [];
  if (!online) chips.push(chip('API unreachable', 'bad'));
  if (!store.simulation) chips.push(chip('Live feed', 'good'));
  else chips.push(run ? chip(STATUS_TEXT[run.status] ?? run.status, run.status === 'running' ? 'good' : 'busy') : chip('Starting', 'busy'));
  if (store.simulated) chips.push(chip('SIMULATED', 'sim'));
  if (run && run.clock_speed > 1) chips.push(chip(`${run.clock_speed}× clock`, 'sim'));
  el('chips').replaceChildren(...chips);
}

let toastTimer;
function toast(message) {
  const node = el('toast');
  node.textContent = message;
  node.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('on'), 4000);
}

async function act(fn) {
  try {
    await fn();
    await refreshRun();
  } catch (error) {
    toast(error.message);
  }
}

function updateControls() {
  const run = store.run;
  const controls = el('controls');
  if (!store.simulation) {
    controls.replaceChildren(h('span', { class: 'hint' }, 'Readings are streaming from the plant controller.'));
    return;
  }
  if (!run) {
    controls.replaceChildren(h('span', { class: 'hint' }, 'Starting the plant feed…'));
    return;
  }
  const canInject = run.status === 'running' && !run.scenario;
  const canBackwash = run.status === 'running' && Boolean(run.scenario);
  controls.replaceChildren(
    h(
      'button',
      {
        class: 'primary',
        disabled: !canInject,
        title: run.status !== 'running' ? 'Available once the baseline has been learned' : run.scenario ? 'A scenario is already active' : '',
        onclick: () => act(() => api.sendEvent(run.id, 'scenario', { name: 'production_decline' })),
      },
      'Inject production decline',
    ),
    h('button', { onclick: () => act(restart) }, 'Restart'),
    h(
      'details',
      { class: 'maintenance' },
      h('summary', {}, 'Maintenance actions'),
      h(
        'button',
        {
          disabled: !canBackwash,
          onclick: () => act(() => api.sendEvent(run.id, 'valve_action', { action: 'backwash_completed' })),
        },
        'Record backwash complete',
      ),
    ),
  );
}

function time(iso) {
  return iso ? new Date(iso).toLocaleTimeString() : '—';
}

function updateRunPanel() {
  const run = store.run;
  const panel = el('run');
  if (!store.simulation) {
    panel.replaceChildren(h('dd', { class: 'muted' }, 'Live plant feed.'));
    return;
  }
  if (!run) {
    panel.replaceChildren(h('dd', { class: 'muted' }, 'No active run.'));
    return;
  }
  const entry = (label, value) => [h('dt', {}, label), h('dd', {}, value)];
  panel.replaceChildren(
    ...entry('Status', STATUS_TEXT[run.status] ?? run.status),
    ...entry('Started', time(run.started_at)),
    ...entry('Baseline ready', time(run.baseline_ready_at)),
    ...entry('Scenario', run.scenario ? `${run.scenario.replace('_', ' ')} since ${time(run.scenario_started_at)}` : 'None'),
  );
}

function updateFlags() {
  const list = el('flags');
  if (!store.flags.length) {
    list.replaceChildren(h('li', { class: 'muted' }, 'No flags raised.'));
    return;
  }
  list.replaceChildren(
    ...store.flags.map((flag) =>
      h(
        'li',
        { class: `flag ${flag.severity}` },
        h('div', { class: 'flag-head' }, chip(flag.severity, flag.severity), h('time', {}, time(flag.raised_at)), h('span', { class: 'status' }, flag.status.replace('_', ' '))),
        h('p', {}, flag.summary),
        h('div', { class: 'tags' }, flag.tags.map((t) => h('code', {}, t))),
        flag.model || flag.incident_id
          ? h('div', { class: 'flag-meta' }, flag.model ? `via ${flag.model}` : '', flag.incident_id ? ` · incident ${flag.incident_id}` : '')
          : null,
      ),
    ),
  );
}

let queued = false;
function render() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    updateSignals();
    updateChips();
    updateControls();
    updateRunPanel();
    updateFlags();
  });
}

const clockSpeed = Math.min(10, Math.max(1, Number(new URLSearchParams(location.search).get('speed')) || 1));
let starting = false;

async function begin() {
  try {
    await api.startRun(clockSpeed);
  } catch (error) {
    if (error.status !== 409) throw error;
  }
}

async function restart() {
  if (store.run) await api.stopRun(store.run.id);
  await begin();
}

async function ensureRun() {
  if (!store.simulation || store.run || starting) return;
  starting = true;
  try {
    await begin();
    store.setRun((await api.currentRun()).run);
  } catch (error) {
    toast(error.message);
  } finally {
    starting = false;
  }
}

async function refreshRun() {
  try {
    store.setRun((await api.currentRun()).run);
    online = true;
  } catch {
    online = false;
    render();
    return;
  }
  ensureRun();
}

async function refreshFlags() {
  try {
    store.setFlags((await api.flags()).flags);
  } catch {}
}

// ---- Reasoning view: focus ledger, hypothesis tree, memory recalls ----------
// Everything rendered here comes from persisted investigator records (trace,
// hypotheses, checkpoint focus). Nothing is inferred in the browser.
let activeIncidentId = null;

function renderInvestigation(detail) {
  const inv = detail.investigation;
  el('investigation-status').textContent =
    `${detail.incident.incident_id} · ${inv.status.replace('_', ' ')} · ${inv.steps_used} Wonder steps`;
  const focus = inv.focus || {};
  const entry = (label, value) => [h('dt', {}, label), h('dd', {}, value || '—')];
  el('focus').replaceChildren(
    ...entry('Goal', focus.goal),
    ...entry('Blocker', focus.blocker),
    ...entry('Next step', focus.next_step),
    ...entry('In focus', (focus.focus_assets || []).join(', ')),
  );

  // Update NOW banner and workflow ribbon to match industrial theme
  const nowEyebrow = el('now-eyebrow');
  const nowHeadline = el('now-headline');
  const nowDesc = el('now-desc');
  const nowEvidence = el('now-evidence');
  const nowGoal = el('now-goal');
  const nowProgress = el('now-progress');
  const flowTag = el('flow-tag');
  const faultChip = el('fault-chip');
  const healthChip = el('health-chip');

  if (nowEyebrow) nowEyebrow.textContent = `CURRENT AGENT ACTIVITY · ${inv.status.toUpperCase()}`;
  if (nowHeadline) nowHeadline.textContent = focus.next_step || focus.goal || detail.incident.title;
  if (nowDesc) nowDesc.textContent = focus.blocker ? `Awaiting field evidence: ${focus.blocker}. Bounded task dispatched.` : (focus.goal || 'Investigating physical unmetered plant assets.');
  if (nowEvidence) nowEvidence.textContent = (focus.focus_assets || []).join(', ') || 'Spark telemetry drift';
  if (nowGoal) nowGoal.textContent = focus.goal || 'Directional flow restoration & ΔP relief';
  if (nowProgress) nowProgress.textContent = `STEP ${Math.max(1, inv.steps_used)} — ${inv.status.replace('_', ' ').toUpperCase()}`;
  if (flowTag) flowTag.textContent = inv.status.toUpperCase();
  if (faultChip) { faultChip.textContent = `INCIDENT: ${detail.incident.incident_id}`; faultChip.className = 'chip critical'; }
  if (healthChip) { healthChip.textContent = 'HEALTH: 22 (ANOMALY)'; healthChip.className = 'chip bad'; }

  // Flow step pills
  const hasPendingField = (detail.field_tasks || []).some((t) => t.status === 'pending');
  const step1 = el('step-1'), step2 = el('step-2'), step3 = el('step-3'), step4 = el('step-4'), step5 = el('step-5');
  if (step1 && step2 && step3 && step4 && step5) {
    step1.className = 'flow-step done';
    step2.className = 'flow-step done';
    step3.className = hasPendingField ? 'flow-step active' : 'flow-step done';
    step4.className = (!hasPendingField && inv.status === 'open') ? 'flow-step active' : inv.status === 'resolved' ? 'flow-step done' : 'flow-step';
    step5.className = inv.status === 'resolved' ? 'flow-step active' : 'flow-step';
  }

  const root = h('div', { class: 'htree-root' }, detail.incident.title);
  const branches = detail.hypotheses.map((hyp) => {
    const ev = [
      ...(hyp.evidence_against || []).map((e) => h('li', { class: 'against' }, `− ${e}`)),
      ...(hyp.evidence_for || []).map((e) => h('li', { class: 'for' }, `+ ${e}`)),
    ];
    return h(
      'div',
      { class: `hnode ${hyp.status}` },
      h('div', { class: 'hhead' }, h('code', {}, hyp.label), h('span', { class: `hstatus ${hyp.status}` }, hyp.status)),
      h('p', {}, hyp.statement),
      ev.length ? h('ul', { class: 'hev' }, ev) : null,
    );
  });
  el('hypotheses').replaceChildren(
    root,
    branches.length ? h('div', { class: 'htree' }, branches) : h('p', { class: 'muted' }, 'No hypotheses recorded yet.'),
  );

  const recalls = detail.trace.filter((t) => t.kind === 'recall');
  el('recalls').replaceChildren(
    ...(recalls.length
      ? recalls.map((t) => h('li', {}, h('code', {}, t.tool_name || 'recall'), ` — ${t.content.slice(0, 140)}`))
      : [h('li', { class: 'muted' }, 'Nothing recalled yet.')]),
  );

  el('trace').replaceChildren(
    ...detail.trace.slice(-14).map((t) =>
      h('li', { class: `tkind-${t.kind}` }, h('code', {}, t.kind), ` ${t.content.slice(0, 160)}`),
    ),
  );

  el('action-proposals').replaceChildren(
    ...(detail.action_proposals?.length
      ? detail.action_proposals.map((proposal) => {
          const card = h(
            'div',
            { class: `task ${proposal.status}` },
            h('p', {}, `${proposal.action} on ${proposal.asset_id}: ${proposal.rationale}`),
            h('span', { class: 'muted' }, proposal.status),
          );
          if (proposal.status === 'pending') {
            card.append(
              h('div', { class: 'task-form' },
                h('button', {
                  onclick: async () => {
                    try {
                      await api.approveProposal(detail.incident.incident_id, proposal.id);
                      toast('Valve task dispatched to Field Companion');
                      refreshIncidents();
                    } catch (error) { toast(error.message); }
                  },
                }, 'Approve valve task'),
                h('button', {
                  onclick: async () => {
                    try {
                      await api.rejectProposal(detail.incident.incident_id, proposal.id);
                      toast('Proposal rejected');
                      refreshIncidents();
                    } catch (error) { toast(error.message); }
                  },
                }, 'Reject'),
              ),
            );
          }
          return card;
        })
      : [h('p', { class: 'muted' }, 'No action proposals.')]),
  );

  el('voice-observations').replaceChildren(
    ...(detail.voice_observations?.length
      ? detail.voice_observations.map((voice) =>
          h('div', { class: 'task completed' },
            h('p', {}, voice.transcript),
            h('span', { class: 'muted' }, voice.comparison?.status || 'recorded')))
      : [h('p', { class: 'muted' }, 'No voice observations.')]),
  );

  const tasks = el('field-tasks');
  tasks.replaceChildren(
    ...(detail.field_tasks.length
      ? detail.field_tasks.map((task) => {
          const card = h(
            'div',
            { class: `task ${task.status}` },
            h('p', {}, task.instruction),
            h('div', { class: 'tags' }, [...(task.asset_ids || []), ...(task.tags || [])].map((t) => h('code', {}, t))),
            h('span', { class: 'muted' }, task.status),
          );
          if (task.status === 'pending' && task.kind === 'gauge_photo') {
            const file = h('input', { type: 'file', accept: 'image/*', capture: 'environment' });
            const photoNote = h('input', { type: 'text', placeholder: 'Operator note (optional)' });
            const result = h('div', { class: 'muted' });
            card.append(
              h('div', { class: 'task-form' },
                file,
                photoNote,
                h('button', {
                  onclick: async () => {
                    if (!file.files?.length) { toast('Choose a gauge photo first'); return; }
                    result.textContent = 'SAM masking gauges, Wonder reading dials…';
                    try {
                      const dataUrl = await new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = () => resolve(reader.result);
                        reader.onerror = reject;
                        reader.readAsDataURL(file.files[0]);
                      });
                      const out = await api.completeTaskPhoto(
                        detail.incident.incident_id, task.id, String(dataUrl).split(',')[1], photoNote.value);
                      result.textContent = out.completed
                        ? `Read ${out.readings_stored} gauge(s): ${out.readings.map((r) => `${r.tag}=${r.value ?? '—'} (${r.status})`).join(', ')}`
                        : (out.reason || 'Could not read the gauges; re-shoot.');
                      if (out.completed) { toast('Gauge evidence stored — investigation resumed'); refreshIncidents(); }
                    } catch (error) {
                      result.textContent = error.message;
                    }
                  },
                }, 'Submit gauge photo'),
                result,
              ),
            );
          }
          if (task.status === 'pending') {
            const inputs = new Map();
            const form = h('div', { class: 'task-form' });
            for (const tag of task.tags || []) {
              const input = h('input', { type: 'number', step: 'any', placeholder: `${tag} (psi)`, 'data-tag': tag });
              inputs.set(tag, input);
              form.append(input);
            }
            const note = h('input', { type: 'text', placeholder: 'Operator note' });
            form.append(
              note,
              h(
                'button',
                {
                  onclick: async () => {
                    const readings = {};
                    for (const [tag, input] of inputs) {
                      if (input.value !== '') readings[tag] = Number(input.value);
                    }
                    try {
                      await api.completeTask(detail.incident.incident_id, task.id, readings, note.value);
                      toast('Field evidence submitted — investigation resumed');
                      refreshIncidents();
                    } catch (error) {
                      toast(error.message);
                    }
                  },
                },
                'Submit readings',
              ),
            );
            card.append(form);
          }
          return card;
        })
      : [h('p', { class: 'muted' }, 'No field tasks.')]),
  );
}

async function refreshIncidents() {
  try {
    const { incidents } = await api.incidents();
    if (!incidents.length) return;
    const active = incidents[0];
    if (active.incident_id !== activeIncidentId || active.investigation_status) {
      activeIncidentId = active.incident_id;
      renderInvestigation(await api.incident(active.incident_id));
    }
  } catch {}
}

async function start() {
  try {
    const plant = await api.plant();
    el('plant-name').textContent = plant.name;
    store.simulation = plant.simulation;
    store.setSignals(plant.signals);
    buildSignals();
    store.applyRows((await api.latest()).readings);
    await Promise.all(
      plant.signals
        .filter((s) => s.type === 'measurement')
        .map(async (s) => store.setHistory(s.tag, (await api.history(s.tag)).points)),
    );
    online = true;
  } catch {
    el('plant-name').textContent = 'API unreachable';
  }
  store.subscribe(render);
  render();

  const stream = new EventSource(api.streamUrl());
  stream.addEventListener('telemetry', (event) => store.applyRows(JSON.parse(event.data)));

  await Promise.all([refreshRun(), refreshFlags(), refreshIncidents()]);
  setInterval(refreshRun, 2000);
  setInterval(refreshFlags, 3000);
  setInterval(refreshIncidents, 3000);
  setInterval(render, 1000);
  setInterval(() => {
    if (store.run) api.heartbeat(store.run.id).catch(() => {});
  }, 10000);
}

start();
