// Preview harness for the plant twin. Steps through the demo video's states with the
// scenario's simulated values (docs/DEMO.md). URL parameters, for screenshots:
//   ?state=<id>&view=<preset>&obs=1&capture=1
import { createPlantScene } from './scene/plantScene.js';

const params = new URLSearchParams(location.search);
if (params.get('capture')) document.body.classList.add('capture');

const model = await (await fetch('/plants/waterplant.json')).json();
document.getElementById('plant-name').textContent = `${model.plant.name} · v${model.plant.version}`;
const plant = createPlantScene(document.getElementById('scene'), model);
window.plant = plant;

const RUNNING = { 'YS-101': 1, 'YS-301': 1, 'YS-401': 1, 'LSL-101': 1, 'LSH-401': 1, 'PSL-301': 1, 'PSH-301': 1, 'AIT-301': 12.4, 'ST-RO': 1, 'FC-RO': 0 };
const TRIPPED = { ...RUNNING, 'YS-301': 0, 'PSL-301': 0, 'ST-RO': 2, 'FC-RO': 11 };
const GAUGES_FAULT = { 'PI-201': 24, 'PI-202': 23.5, 'PI-203': 22, 'PI-204': 24.5, 'PI-205': 16, 'PI-206': 15.5, 'PI-207': 6, 'PI-208': 16.5 };
const GAUGES_OK = { 'PI-201': 24, 'PI-202': 23.5, 'PI-203': 24, 'PI-204': 24.5, 'PI-205': 16, 'PI-206': 15.5, 'PI-207': 16.5, 'PI-208': 16.5 };
const UNREAD = Object.fromEntries(Object.keys(GAUGES_OK).map((k) => [k, null]));
const SERVICE = { 'V-111': 100, 'V-112': 100, 'V-113': 0, 'V-114': 0, 'V-115': 0 };
const BACKWASH = (pct) => ({ 'V-111': 0, 'V-112': 0, 'V-113': pct, 'V-114': 100, 'V-115': 0 });
const LINE3 = ['CB-3F', 'CB-3B'];
const BANK = ['CB-1F', 'CB-2F', 'CB-3F', 'CB-4F', 'CB-1B', 'CB-2B', 'CB-3B', 'CB-4B'];

const STATES = [
  { id: 'normal', title: '0 · Plant running', view: 'overview', tags: { ...RUNNING, ...UNREAD }, valves: SERVICE },
  { id: 'trip', title: '1 · HP pump low-suction trip', view: 'overview', tags: { ...TRIPPED, ...UNREAD }, valves: SERVICE, alarm: ['P-301', 'RO-301'], flow: [] },
  { id: 'dispatch', title: '2 · Field task: read the cartridge gauges', view: 'cartridge', tags: { ...TRIPPED, ...UNREAD }, valves: SERVICE, alarm: ['P-301'], task: BANK, flow: [], obs: true },
  { id: 'gauges', title: '3 · Gauges read: line 3 restricted', view: 'gauges', tags: { ...TRIPPED, ...GAUGES_FAULT }, valves: SERVICE, alarm: ['P-301'], warning: LINE3, focus: LINE3, flow: [] },
  { id: 'reason', title: '4 · Upstream cause: sand filter', view: 'overview', tags: { ...TRIPPED, ...GAUGES_FAULT }, valves: SERVICE, warning: LINE3, focus: ['MGF-101', 'CB-3F', 'CB-3B'], flow: [] },
  { id: 'bw50', title: '5 · Backwash: V-113 to 50%', view: 'media', tags: { ...TRIPPED, ...GAUGES_FAULT }, valves: BACKWASH(50), task: ['V-113'], focus: ['MGF-101'], flowRoute: 'RT-M1-BACKWASH' },
  { id: 'bw100', title: '6 · Backwash: V-113 full open', view: 'media', tags: { ...TRIPPED, ...GAUGES_FAULT }, valves: BACKWASH(100), task: ['V-113'], focus: ['MGF-101'], flowRoute: 'RT-M1-BACKWASH' },
  { id: 'recovered', title: '7 · Recovered, verifier passed', view: 'overview', tags: { ...RUNNING, ...GAUGES_OK }, valves: SERVICE },
];

const views = document.getElementById('views');
for (const v of ['overview', 'cartridge', 'gauges', 'media', 'ro', 'hp_pump']) {
  const b = document.createElement('button');
  b.textContent = v.replace('_', ' ');
  b.onclick = () => plant.flyTo(v);
  views.appendChild(b);
}

const list = document.getElementById('states');
const buttons = new Map();
for (const s of STATES) {
  const li = document.createElement('li');
  const b = document.createElement('button');
  b.textContent = s.title;
  b.onclick = () => apply(s);
  li.appendChild(b);
  list.appendChild(li);
  buttons.set(s.id, b);
}

const obs = document.getElementById('obs');
obs.onchange = () => plant.setObservability(obs.checked);

function apply(s, { instant = false } = {}) {
  plant.setInstruments(s.tags);
  for (const [id, pct] of Object.entries(s.valves)) plant.setValve(id, pct);
  plant.highlight(s.alarm ?? [], 'alarm');
  plant.highlight(s.warning ?? [], 'warning');
  plant.highlight(s.task ?? [], 'task');
  plant.highlight(s.focus ?? [], 'focus');
  plant.setFlowing(s.flowRoute ? plant.routeEdges(s.flowRoute) : s.flow ?? null);
  obs.checked = !!s.obs || params.get('obs') === '1';
  plant.setObservability(obs.checked);
  plant.flyTo(params.get('view') ?? s.view, { instant });
  for (const [id, b] of buttons) b.classList.toggle('on', id === s.id);
  showReadout(s);
}

function showReadout(s) {
  const rows = Object.entries(s.tags)
    .map(([k, v]) => `${k.padEnd(8)} ${v == null ? 'not observed' : v}`)
    .join('\n');
  const valves = Object.entries(s.valves).map(([k, v]) => `${k.padEnd(8)} ${v}% open`).join('\n');
  document.getElementById('readout').textContent = `${rows}\n\n${valves}`;
}

plant.on('select', ({ assetId, tag }) => console.log('select', assetId, tag ?? ''));

const initial = STATES.find((s) => s.id === params.get('state')) ?? STATES[0];
apply(initial, { instant: true });
