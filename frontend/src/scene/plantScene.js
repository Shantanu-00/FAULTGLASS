// FAULTGLASS plant scene. Renders a plant pack's layout, equipment, pipes and instruments, and
// exposes a small state API for the console:
//
//   const plant = createPlantScene(container, model)    model = /plants/<id>.json
//   plant.setInstrument('PI-203', 21.5)   gauge needle (psi); null = not yet observed
//   plant.setInstrument('PSL-301', 0)     streamed switch -> LOW_PRESSURE_TRIP
//   plant.setValve('V-113', 50)           lever to 45 degrees
//   plant.highlight(['CB-3B'], 'task')    focus | task | alarm
//   plant.setFlowing(edgeIds)             animate flow on these pipes (null = service default)
//   plant.flyTo('cartridge')              preset name or asset ids
//   plant.on('select', ({ assetId }) => ...)
//
// The scene shows only what the model passes in. It never invents readings: field gauges
// start greyed out until a reading is reported.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { COLORS, PIPE, MAT, isAbnormal } from './theme.js';
import { buildEquipment, createRotameter, createTransmitter } from './equipment.js';
import { createGauge } from './gauge.js';
import './plantScene.css';

const FITTINGS = new Set(['tee', 'valve', 'header', 'drain']);
const UNLABELLED = new Set(['tee', 'header', 'valve']);

const PRESETS = {
  overview: { kinds: null, dir: [0.62, 0.9, 1], pad: 0.66 },
  cartridge: { kinds: ['cartridge_housing'], dir: [0.12, 0.62, 1], pad: 1.05 },
  gauges: { ids: ['CB-1F', 'CB-2F', 'CB-3F', 'CB-4F'], dir: [0.05, 0.42, 1], pad: 0.78, lift: 0.75 },
  media: { kinds: ['media_vessel'], dir: [1, 0.55, 0.35], pad: 1.25 },
  ro: { kinds: ['ro_vessel_bank', 'ozone_generator', 'oxygen_concentrator'], dir: [0.1, 0.5, 1], pad: 1.35 },
  hp_pump: { ids: ['P-301'], dir: [0.6, 0.5, 1], pad: 3.2 },
  backwash: { ids: ['MGF-101', 'V-113', 'V-114'], dir: [1, 0.42, 0.3], pad: 0.95 },
};

export function createPlantScene(container, model, { labels = true } = {}) {
  const byId = new Map(model.assets.map((a) => [a.id, a]));
  const place = model.layout.placements;
  const events = { select: [] };

  // ---------------- renderer, camera, lights ----------------
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);
  renderer.domElement.classList.add('pl-canvas');

  const labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.classList.add('pl-labels');
  container.appendChild(labelRenderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLORS.background);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 1.05;

  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 200);
  const controls = new OrbitControls(camera, labelRenderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.47;
  controls.minDistance = 1.2;
  controls.maxDistance = 60;

  scene.add(new THREE.HemisphereLight(0xffffff, 0xd8d4cc, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  const floorPts = model.layout.floor;
  const fx = floorPts.map((p) => p[0]), fz = floorPts.map((p) => p[1]);
  const bounds = { x0: Math.min(...fx), x1: Math.max(...fx), z0: Math.min(...fz), z1: Math.max(...fz) };
  const mid = new THREE.Vector3((bounds.x0 + bounds.x1) / 2, 0, (bounds.z0 + bounds.z1) / 2);
  sun.position.set(mid.x + 8, 22, mid.z + 14);
  sun.target.position.copy(mid);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  const half = Math.max(bounds.x1 - bounds.x0, bounds.z1 - bounds.z0) * 0.62;
  Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 1, far: 70 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);

  buildBuilding(scene, model.layout, bounds);

  // ---------------- equipment ----------------
  const nodes = new Map(); // assetId -> { group, built, asset }
  const edgesOf = (id) => model.edges.filter((e) => e.from.asset === id || e.to.asset === id);
  const otherEnd = (e, id) => (e.from.asset === id ? e.to : e.from);
  const plan = (id) => place[id] ?? { x: 0, z: 0 };

  const ctx = {
    lineX(asset, port) {
      const e = model.edges.find((x) => (x.from.asset === asset.id && x.from.port === port) || (x.to.asset === asset.id && x.to.port === port));
      if (!e) return null;
      return plan(otherEnd(e, asset.id).asset).x - plan(asset.id).x;
    },
    valveHeight(asset) {
      const ports = edgesOf(asset.id).map((e) => otherEnd(e, asset.id).port);
      if (ports.some((p) => p.startsWith('top'))) return 1.85;
      if (ports.some((p) => p.startsWith('bottom') || p.startsWith('rinse') || p.startsWith('bw'))) return 0.5;
      return 0.9;
    },
    valveFacing(asset) {
      const me = plan(asset.id);
      for (const e of edgesOf(asset.id)) {
        const o = otherEnd(e, asset.id).asset;
        const kind = byId.get(o)?.kind;
        if (kind && !FITTINGS.has(kind)) {
          const p = plan(o);
          const v = new THREE.Vector3(me.x - p.x, 0, me.z - p.z);
          if (v.lengthSq() > 1e-6) return v.normalize();
        }
      }
      return new THREE.Vector3(0, 0, 1);
    },
    drainLength(asset) {
      const zs = edgesOf(asset.id).map((e) => plan(otherEnd(e, asset.id).asset).z);
      return Math.max(1, plan(asset.id).z - Math.min(...zs) + 0.6);
    },
  };

  for (const a of model.assets) {
    if (a.role === 'group' || !place[a.id] || a.kind === 'tee') continue;
    addNode(a);
  }
  // tees sit at the mean height of whatever they join
  for (const a of model.assets) {
    if (a.kind !== 'tee' || !place[a.id]) continue;
    const node = addNode(a);
    const ys = edgesOf(a.id).map((e) => {
      const o = otherEnd(e, a.id);
      const n = nodes.get(o.asset);
      return n ? anchorWorld(o.asset, o.port).y : 1;
    });
    node.group.position.y = ys.reduce((s, y) => s + y, 0) / Math.max(ys.length, 1);
    node.group.updateMatrixWorld(true);
  }

  function addNode(a) {
    const built = buildEquipment(a, ctx);
    const p = place[a.id];
    built.group.position.set(p.x, 0, p.z);
    built.group.rotation.y = THREE.MathUtils.degToRad(p.rot_deg ?? 0);
    built.group.traverse((o) => { o.userData.assetId = a.id; });
    built.group.name = a.id;
    scene.add(built.group);
    built.group.updateMatrixWorld(true);
    const node = { group: built.group, built, asset: a, mounts: 0 };
    nodes.set(a.id, node);
    return node;
  }

  function anchorWorld(assetId, port, other) {
    const n = nodes.get(assetId);
    const local = n.built.anchor(port, other);
    return n.group.localToWorld(local.clone());
  }

  // ---------------- pipes ----------------
  const pipePaths = new Map(); // edgeId -> { points, length, medium }
  for (const e of model.edges) {
    if (!nodes.has(e.from.asset) || !nodes.has(e.to.asset)) continue;
    const toPos = nodes.get(e.to.asset).group.position;
    const fromPos = nodes.get(e.from.asset).group.position;
    const a = anchorWorld(e.from.asset, e.from.port, toPos);
    const b = anchorWorld(e.to.asset, e.to.port, fromPos);
    const style = PIPE[e.medium] ?? PIPE.pretreated;
    const pts = routePipe(a, b, style.y);
    const mesh = buildPipe(pts, style);
    mesh.traverse((o) => { o.userData.edgeId = e.id; });
    scene.add(mesh);
    let length = 0;
    for (let i = 1; i < pts.length; i++) length += pts[i].distanceTo(pts[i - 1]);
    pipePaths.set(e.id, { points: pts, length, medium: e.medium });
  }

  // ---------------- instruments ----------------
  const instruments = new Map(); // tag -> { instr, widget, node }
  for (const instr of model.instruments) {
    const host = instrumentHost(instr);
    const node = host && nodes.get(host);
    if (!node) continue;
    const m = node.built.mount(instr, node.mounts++);
    let widget;
    if (instr.observe === 'field_photo' && instr.quantity.includes('pressure')) {
      widget = createGauge(instr, { radius: m.gaugeRadius ?? 0.08 });
    } else if (instr.observe === 'field_photo' && instr.quantity === 'flow') {
      widget = createRotameter(instr);
    } else {
      widget = createTransmitter(instr);
    }
    widget.group.position.copy(m.position);
    widget.group.lookAt(m.position.clone().add(m.facing));
    widget.group.traverse((o) => { o.userData.assetId = host; o.userData.tag = instr.tag; });
    node.group.add(widget.group);
    if (instr.observe === 'field_photo') widget.setReading(null);
    instruments.set(instr.tag, { instr, widget, node, host });
  }

  function instrumentHost(instr) {
    const at = instr.attach;
    if (at.asset) return at.asset;
    if (at.port) return at.port.split('.')[0];
    if (at.span) return at.span[0].split('.')[0];
    if (at.edge) {
      const e = model.edges.find((x) => x.id === at.edge);
      if (!e) return null;
      return FITTINGS.has(byId.get(e.from.asset)?.kind) ? e.to.asset : e.from.asset;
    }
    return null;
  }

  // ---------------- labels ----------------
  const labelEls = new Map();
  const chipEls = new Map();
  const groupLabels = [];
  if (labels) {
    // kinds with many identical units (the cartridge bank) get one group label; each unit's own
    // label appears when the camera is close or the unit is highlighted
    const kindCount = {};
    for (const n of nodes.values()) kindCount[n.asset.kind] = (kindCount[n.asset.kind] ?? 0) + 1;
    const grouped = (kind) => kindCount[kind] >= 4 && !UNLABELLED.has(kind) && kind !== 'drain';
    const addLabel = (id, n, onDemand) => {
      const el = document.createElement('div');
      el.className = `pl-label${onDemand ? ' pl-on-demand' : ''}`;
      el.innerHTML = `<span class="pl-tag">${id}</span><span class="pl-name">${n.asset.name}</span>`;
      el.addEventListener('pointerdown', (ev) => { ev.stopPropagation(); emit('select', { assetId: id }); });
      const obj = new CSS2DObject(el);
      obj.position.set(0, n.built.height + (onDemand ? 0.05 : 0.12), 0);
      obj.center.set(0.5, 1);
      n.group.add(obj);
      labelEls.set(id, { el, obj, onDemand });
    };
    for (const [id, n] of nodes) {
      const k = n.asset.kind;
      if (k === 'tee' || k === 'header' || k === 'drain') continue;
      addLabel(id, n, k === 'valve' || grouped(k));
    }
    for (const kind of Object.keys(kindCount).filter(grouped)) {
      const members = [...nodes.values()].filter((n) => n.asset.kind === kind);
      const box = new THREE.Box3();
      for (const n of members) box.expandByObject(n.group);
      const c = box.getCenter(new THREE.Vector3());
      const el = document.createElement('div');
      el.className = 'pl-label pl-group';
      const nice = kind.replace(/_/g, ' ');
      el.innerHTML = `<span class="pl-tag">${nice.toUpperCase()}</span><span class="pl-count">×${members.length}</span>`;
      const ids = members.map((n) => n.asset.id);
      el.addEventListener('pointerdown', (ev) => { ev.stopPropagation(); emit('select', { assetIds: ids }); });
      const obj = new CSS2DObject(el);
      obj.position.set(c.x, box.max.y + 0.2, c.z);
      obj.center.set(0.5, 1);
      scene.add(obj);
      groupLabels.push({ el, obj, ids });
    }
    for (const [tag, it] of instruments) {
      const el = document.createElement('div');
      const api = it.instr.observe === 'telemetry';
      el.className = `pl-chip ${api ? 'is-api' : 'is-noapi'}`;
      el.innerHTML = `<span>${tag}</span><em>${api ? '' : 'not observed'}</em><b>${api ? 'API' : 'NO API'}</b>`;
      if (!api) el.classList.add('is-unread');
      const obj = new CSS2DObject(el);
      obj.position.copy(it.widget.group.position).add(new THREE.Vector3(0, 0.13, 0));
      obj.center.set(0.5, 1);
      it.node.group.add(obj);
      chipEls.set(tag, { el, obj });
    }
    // equipment that carries an instrument chip on top keeps its own label at its base
    for (const it of instruments.values()) {
      const l = labelEls.get(it.host);
      if (!l || it.widget.group.position.y < it.node.built.height - 0.6) continue;
      l.obj.position.set(0, 0.12, 0.2);
      l.obj.center.set(0.5, 0);
    }
  }

  // ---------------- highlights ----------------
  const rings = new Map(); // `${kind}:${id}` -> mesh
  const ringMats = {
    focus: new THREE.MeshBasicMaterial({ color: COLORS.accent, transparent: true, opacity: 0.9, depthWrite: false }),
    task: new THREE.MeshBasicMaterial({ color: COLORS.accent, transparent: true, opacity: 0.9, depthWrite: false }),
    alarm: new THREE.MeshBasicMaterial({ color: COLORS.alarm, transparent: true, opacity: 0.95, depthWrite: false }),
    warning: new THREE.MeshBasicMaterial({ color: COLORS.warning, transparent: true, opacity: 0.95, depthWrite: false }),
  };
  const highlighted = { focus: new Set(), task: new Set(), alarm: new Set(), warning: new Set() };

  function footprint(id) {
    const n = nodes.get(id);
    const box = new THREE.Box3().setFromObject(n.group);
    const size = box.getSize(new THREE.Vector3());
    return Math.max(0.22, Math.min(1.6, Math.max(size.x, size.z) * 0.62));
  }

  function setRing(id, kind, on) {
    const key = `${kind}:${id}`;
    if (!on) {
      const r = rings.get(key);
      if (r) { scene.remove(r); r.geometry.dispose(); rings.delete(key); }
      return;
    }
    if (rings.has(key) || !nodes.has(id)) return;
    const rad = footprint(id) + { alarm: 0, warning: 0, focus: 0.07, task: 0.14 }[kind];
    const ring = new THREE.Mesh(new THREE.RingGeometry(rad, rad + 0.045, 64), ringMats[kind]);
    ring.rotation.x = -Math.PI / 2;
    const p = nodes.get(id).group.position;
    ring.position.set(p.x, 0.012 + (kind === 'alarm' ? 0.002 : 0), p.z);
    ring.renderOrder = 2;
    scene.add(ring);
    rings.set(key, ring);
  }

  function refreshLabelClasses() {
    for (const [id, { el }] of labelEls) {
      el.classList.toggle('is-focus', highlighted.focus.has(id) || highlighted.task.has(id));
      el.classList.toggle('is-alarm', highlighted.alarm.has(id));
      el.classList.toggle('is-warning', highlighted.warning.has(id) && !highlighted.alarm.has(id));
      el.classList.toggle('is-shown', [...Object.values(highlighted)].some((s) => s.has(id)));
    }
    for (const [tag, { el }] of chipEls) {
      const host = instruments.get(tag).host;
      el.classList.toggle('is-shown', highlighted.focus.has(host) || highlighted.task.has(host) || highlighted.focus.has(tag) || highlighted.task.has(tag));
    }
  }

  // ---------------- flow animation ----------------
  const defaultFlow = new Set();
  const serviceEdges = new Set(model.routes.filter((r) => r.kind === 'service' || r.kind === 'duty').flatMap((r) => r.edges));
  for (const e of model.edges) {
    const onRoute = model.routes.some((r) => r.edges.includes(e.id));
    if (['drain', 'backwash', 'chemical'].includes(e.medium)) continue;
    if (onRoute && !serviceEdges.has(e.id)) continue;
    defaultFlow.add(e.id);
  }
  let flowing = new Set(defaultFlow);
  const SPACING = 0.65, SPEED = 0.55;
  const maxBeads = [...pipePaths.values()].reduce((s, p) => s + Math.ceil(p.length / SPACING) + 1, 0);
  const beadMat = new THREE.MeshBasicMaterial({ color: 0x3f86c6 });
  const beads = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), beadMat, maxBeads);
  beads.frustumCulled = false;
  scene.add(beads);
  const tmpM = new THREE.Matrix4(), tmpV = new THREE.Vector3(), tmpS = new THREE.Vector3(), tmpQ = new THREE.Quaternion();
  let flowClock = 0;

  function updateBeads(dt) {
    flowClock += dt;
    let n = 0;
    for (const id of flowing) {
      const p = pipePaths.get(id);
      if (!p) continue;
      const r = (PIPE[p.medium]?.r ?? 0.04) * 1.18;
      const offset = (flowClock * SPEED) % SPACING;
      for (let d = offset; d < p.length && n < maxBeads; d += SPACING) {
        pointAt(p.points, d, tmpV);
        tmpS.setScalar(r);
        tmpM.compose(tmpV, tmpQ, tmpS);
        beads.setMatrixAt(n++, tmpM);
      }
    }
    beads.count = n;
    beads.instanceMatrix.needsUpdate = true;
  }

  // ---------------- camera framing ----------------
  let fly = null;
  function frame(ids, dir, pad, lift = 0) {
    const box = new THREE.Box3();
    for (const id of ids) if (nodes.has(id)) box.expandByObject(nodes.get(id).group);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    center.y += (box.max.y - center.y) * lift;
    const radius = box.getBoundingSphere(new THREE.Sphere()).radius;
    const dist = (radius * pad) / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2));
    const d = new THREE.Vector3(...dir).normalize();
    const to = center.clone().add(d.multiplyScalar(dist));
    fly = { t: 0, fromPos: camera.position.clone(), fromTarget: controls.target.clone(), toPos: to, toTarget: center };
  }

  function flyTo(what, { instant = false } = {}) {
    let ids, dir = [0.4, 0.6, 1], pad = 1.6, lift = 0;
    if (typeof what === 'string' && PRESETS[what]) {
      const p = PRESETS[what];
      ids = p.ids ?? [...nodes.values()].filter((n) => !p.kinds || p.kinds.includes(n.asset.kind)).map((n) => n.asset.id);
      dir = p.dir; pad = p.pad; lift = p.lift ?? 0;
      if (!p.kinds && !p.ids) ids = ids.filter((id) => place[id]?.row !== 'outside');
    } else {
      ids = [].concat(what);
    }
    frame(ids, dir, pad, lift);
    if (instant && fly) { camera.position.copy(fly.toPos); controls.target.copy(fly.toTarget); fly = null; }
  }

  // ---------------- picking ----------------
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let downAt = null;
  labelRenderer.domElement.addEventListener('pointerdown', (ev) => { downAt = [ev.clientX, ev.clientY]; });
  labelRenderer.domElement.addEventListener('pointerup', (ev) => {
    if (!downAt || Math.hypot(ev.clientX - downAt[0], ev.clientY - downAt[1]) > 4) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(scene.children, true).find((h) => h.object.userData.assetId);
    if (hit) emit('select', { assetId: hit.object.userData.assetId, tag: hit.object.userData.tag ?? null });
  });

  function emit(name, payload) { for (const fn of events[name] ?? []) fn(payload); }

  // ---------------- loop ----------------
  const resize = () => {
    const w = container.clientWidth, h = container.clientHeight;
    renderer.setSize(w, h);
    labelRenderer.setSize(w, h);
    camera.aspect = w / Math.max(h, 1);
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();
  flyTo('overview', { instant: true });

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    if (fly) {
      fly.t = Math.min(1, fly.t + dt / 1.3);
      const k = fly.t < 0.5 ? 4 * fly.t ** 3 : 1 - (-2 * fly.t + 2) ** 3 / 2;
      camera.position.lerpVectors(fly.fromPos, fly.toPos, k);
      controls.target.lerpVectors(fly.fromTarget, fly.toTarget, k);
      if (fly.t >= 1) fly = null;
    }
    for (const { widget } of instruments.values()) widget.tick(dt);
    for (const n of nodes.values()) n.built.valve?.tick(dt);
    const pulse = 0.55 + 0.4 * Math.sin(clock.elapsedTime * 3.2);
    ringMats.task.opacity = pulse;
    updateBeads(dt);
    revealNearLabels();
    controls.update();
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
  });

  const wp = new THREE.Vector3();
  function revealNearLabels() {
    for (const { el, obj, onDemand } of labelEls.values()) {
      if (!onDemand) continue;
      obj.getWorldPosition(wp);
      el.classList.toggle('is-near', wp.distanceTo(camera.position) < 5.5);
    }
    for (const g of groupLabels) {
      const memberShown = g.ids.some((id) => {
        const l = labelEls.get(id);
        return l && (l.el.classList.contains('is-near') || l.el.classList.contains('is-shown'));
      });
      g.el.classList.toggle('is-hidden', memberShown);
    }
  }

  // ---------------- public API ----------------
  const hmi = [...nodes.values()].find((n) => n.built.hmi)?.built.hmi;

  return {
    model,
    setInstrument(tag, value) {
      const it = instruments.get(tag);
      if (!it) return;
      const label = value == null ? undefined : it.instr.state_labels?.[String(Math.round(value))];
      it.widget.setReading(value, label);
      const chip = chipEls.get(tag);
      if (chip) {
        const em = chip.el.querySelector('em');
        em.textContent = value == null ? 'not observed' : label ?? `${Number(value).toFixed(1)} ${it.instr.unit}`;
        chip.el.classList.toggle('is-unread', value == null);
        chip.el.classList.toggle('is-abnormal', isAbnormal(label));
      }
      if (hmi) {
        if (tag === 'ST-RO') hmi.update({ cycle: label ?? null });
        if (tag === 'FC-RO') hmi.update({ fault: label ?? null });
        if (tag === 'AIT-301') hmi.update({ tds: value });
      }
    },
    setInstruments(map) { for (const [k, v] of Object.entries(map)) this.setInstrument(k, v); },
    setValve(id, pct, { instant = false } = {}) { nodes.get(id)?.built.valve?.setPercent(pct, instant); },
    valveAngle(id) { return nodes.get(id)?.built.valve?.angleDeg() ?? null; },
    highlight(ids, kind = 'focus') {
      const next = new Set([].concat(ids ?? []));
      for (const id of highlighted[kind]) if (!next.has(id)) setRing(id, kind, false);
      for (const id of next) setRing(id, kind, true);
      highlighted[kind] = next;
      refreshLabelClasses();
    },
    setObservability(on) { container.classList.toggle('pl-observability', !!on); },
    setFlowing(edgeIds) { flowing = edgeIds == null ? new Set(defaultFlow) : new Set(edgeIds); },
    routeEdges(routeId) { return model.routes.find((r) => r.id === routeId)?.edges ?? []; },
    flyTo,
    on(name, fn) { (events[name] ??= []).push(fn); return () => { events[name] = events[name].filter((f) => f !== fn); }; },
    screenshot() { return renderer.domElement.toDataURL('image/png'); },
    dispose() {
      renderer.setAnimationLoop(null);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      pmrem.dispose();
      container.replaceChildren();
    },
  };
}

// ---------------- geometry helpers ----------------

function routePipe(a, b, rackY) {
  const planDist = Math.hypot(a.x - b.x, a.z - b.z);
  let pts;
  if (planDist < 1.6) {
    // short local run: travel at the mean anchor height instead of climbing to the rack
    const y = (a.y + b.y) / 2;
    pts = [a, new THREE.Vector3(a.x, y, a.z), new THREE.Vector3(b.x, y, a.z), new THREE.Vector3(b.x, y, b.z), b];
  } else {
    pts = [a, new THREE.Vector3(a.x, rackY, a.z), new THREE.Vector3(b.x, rackY, a.z), new THREE.Vector3(b.x, rackY, b.z), b];
  }
  // drop duplicate and collinear points
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].distanceToSquared(out[out.length - 1]) < 1e-6) continue;
    if (out.length >= 2) {
      const d1 = out[out.length - 1].clone().sub(out[out.length - 2]).normalize();
      const d2 = pts[i].clone().sub(out[out.length - 1]).normalize();
      if (d1.dot(d2) > 0.9999) { out[out.length - 1] = pts[i]; continue; }
    }
    out.push(pts[i]);
  }
  return out;
}

function buildPipe(points, style) {
  const g = new THREE.Group();
  const mat = style.color === COLORS.upvc ? MAT.upvc() : style.color === COLORS.white ? MAT.white() : style.color === COLORS.stainlessDark ? MAT.stainlessDark() : MAT.stainless();
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const len = a.distanceTo(b);
    if (len < 1e-4) continue;
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(style.r, style.r, len, 14, 1, true), mat);
    seg.position.copy(a).add(b).multiplyScalar(0.5);
    seg.quaternion.setFromUnitVectors(up, b.clone().sub(a).normalize());
    seg.castShadow = true;
    g.add(seg);
  }
  for (let i = 1; i < points.length - 1; i++) {
    const elbow = new THREE.Mesh(new THREE.SphereGeometry(style.r * 1.12, 12, 10), mat);
    elbow.position.copy(points[i]);
    g.add(elbow);
  }
  return g;
}

function pointAt(points, d, out) {
  for (let i = 1; i < points.length; i++) {
    const seg = points[i].distanceTo(points[i - 1]);
    if (d <= seg) return out.lerpVectors(points[i - 1], points[i], seg ? d / seg : 0);
    d -= seg;
  }
  return out.copy(points[points.length - 1]);
}

function buildBuilding(scene, layout, b) {
  // floor: the plan polygon, tiled
  const shape = new THREE.Shape(layout.floor.map(([x, z]) => new THREE.Vector2(x, -z)));
  const tex = tileTexture();
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1 / 0.6, 1 / 0.6);
  const floor = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // ground beyond the building, so the plant does not float
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: 0xe6e8ea, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.01;
  ground.receiveShadow = true;
  scene.add(ground);

  // walls on the back edges (min x, min z) are full height; the rest is a low curb so the
  // camera can see in
  const pts = layout.floor;
  const wallMat = new THREE.MeshStandardMaterial({ color: COLORS.wall, roughness: 0.9 });
  const trimMat = new THREE.MeshStandardMaterial({ color: COLORS.wallTrim, roughness: 0.8 });
  for (let i = 0; i < pts.length; i++) {
    const [x1, z1] = pts[i], [x2, z2] = pts[(i + 1) % pts.length];
    const back = (x1 === b.x0 && x2 === b.x0) || (z1 === b.z0 && z2 === b.z0);
    const h = back ? 3.3 : 0.12;
    const len = Math.hypot(x2 - x1, z2 - z1);
    const wall = new THREE.Mesh(new THREE.BoxGeometry(len + 0.15, h, 0.15), wallMat);
    const ang = Math.atan2(z2 - z1, x2 - x1);
    // push the wall outward by half its thickness
    const nx = Math.sin(ang), nz = -Math.cos(ang);
    const inward = pointInPolygon((x1 + x2) / 2 + nx * 0.2, (z1 + z2) / 2 + nz * 0.2, pts) ? -1 : 1;
    wall.position.set((x1 + x2) / 2 + nx * 0.075 * inward, h / 2, (z1 + z2) / 2 + nz * 0.075 * inward);
    wall.rotation.y = -ang;
    wall.receiveShadow = true;
    wall.castShadow = back;
    scene.add(wall);
    if (back) {
      const trim = new THREE.Mesh(new THREE.BoxGeometry(len + 0.15, 0.22, 0.16), trimMat);
      trim.position.copy(wall.position).setY(2.45);
      trim.rotation.y = wall.rotation.y;
      scene.add(trim);
    }
  }

  // zone names painted on the floor
  for (const [key, text] of Object.entries(layout.zones ?? {})) {
    const m = /x (\d+(?:\.\d+)?) to (\d+(?:\.\d+)?), z (\d+(?:\.\d+)?) to (\d+(?:\.\d+)?)/.exec(text);
    if (!m) continue;
    const [x0, x1, z0, z1] = m.slice(1).map(Number);
    const wide = x1 - x0 >= z1 - z0;
    const label = floorText(`${key}  ${text.split(',')[0].split('(')[0].trim()}`.toUpperCase());
    const w = 6, h = 0.42;
    label.scale.set(w, h, 1);
    label.rotation.x = -Math.PI / 2;
    if (wide) label.position.set(x0 + 7.5, 0.006, z1 - 0.45);
    else { label.rotation.z = Math.PI / 2; label.position.set(x1 - 0.45, 0.006, z1 - 3.5); }
    scene.add(label);
  }
}

function pointInPolygon(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function tileTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#e2ded7';
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = '#cfc9bf';
  g.lineWidth = 3;
  g.strokeRect(1.5, 1.5, 253, 253);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function floorText(text) {
  const c = document.createElement('canvas');
  c.width = 2048; c.height = 144;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(95,107,118,0.75)';
  g.font = '600 76px system-ui, sans-serif';
  g.textBaseline = 'middle';
  g.fillText(text, 8, 72);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false }));
  return m;
}
