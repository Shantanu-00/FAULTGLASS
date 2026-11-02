// Equipment geometry, one builder per asset kind in the plant pack. Each builder returns
//   group          the meshes, origin at the asset's floor placement
//   anchor(port, otherWorld)  local point where a pipe on that port connects
//   mount(instr, i)           local position and facing for an instrument on this asset
//   height                    for labels and camera framing
// Dimensions are approximate and taken from the site footage.
import * as THREE from 'three';
import { MAT, isAbnormal } from './theme.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

function cyl(r, h, mat, seg = 32) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function box(w, h, d, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function dome(r, mat, flat = 0.45) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), mat);
  m.scale.y = flat;
  m.castShadow = true;
  return m;
}

function flange(r, y, group, bolts = 10) {
  const ring = cyl(r, 0.035, MAT.stainless(), 40);
  ring.position.y = y;
  group.add(ring);
  const gasket = cyl(r * 1.005, 0.012, MAT.gasket(), 40);
  gasket.position.y = y - 0.024;
  group.add(gasket);
  const boltGeo = new THREE.CylinderGeometry(0.009, 0.009, 0.06, 8);
  for (let i = 0; i < bolts; i++) {
    const a = (i / bolts) * Math.PI * 2;
    const b = new THREE.Mesh(boltGeo, MAT.stainlessDark());
    b.position.set(Math.cos(a) * r * 0.88, y + 0.02, Math.sin(a) * r * 0.88);
    group.add(b);
  }
}

function legs(group, r, h, count = 4) {
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + Math.PI / 4;
    const leg = cyl(0.025, h, MAT.frame(), 10);
    leg.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r);
    group.add(leg);
  }
}

// Default instrument mounting: spread along the top front edge of the asset.
function topMount(height, depth = 0.2) {
  return (_instr, i) => ({ position: V(-0.15 + i * 0.15, height + 0.05, depth), facing: V(0, 0, 1) });
}

function screenTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 320;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const draw = (state) => {
    const g = c.getContext('2d');
    g.fillStyle = '#f4f6f8'; g.fillRect(0, 0, 512, 320);
    g.fillStyle = '#2f8f8a'; g.fillRect(0, 0, 512, 54);
    g.fillStyle = '#ffffff'; g.font = '600 26px sans-serif'; g.fillText('RO PLANT', 18, 36);
    g.fillStyle = '#1f2328'; g.font = '500 24px sans-serif';
    g.fillText('CYCLE', 24, 110);
    g.fillText('TDS', 24, 170);
    g.fillText('FAULT', 24, 230);
    const fault = state.fault && state.fault !== 'NONE';
    g.font = '700 28px monospace';
    g.fillStyle = state.cycle === 'FAULT' ? '#c62828' : '#1f2328';
    g.fillText(state.cycle ?? '--', 180, 110);
    g.fillStyle = '#1f2328';
    g.fillText(state.tds == null ? '--' : `${state.tds.toFixed(1)} ppm`, 180, 170);
    g.fillStyle = fault ? '#c62828' : '#1f2328';
    g.fillText(state.fault ?? '--', 180, 230);
    g.fillStyle = '#5f6b76'; g.font = '500 18px sans-serif';
    g.fillText('SIMULATED', 380, 300);
    tex.needsUpdate = true;
  };
  return { tex, draw };
}

const BUILDERS = {
  supply() {
    const g = new THREE.Group();
    const collar = cyl(0.16, 0.5, MAT.stainlessDark());
    collar.position.y = 0.25;
    g.add(collar);
    return { group: g, height: 0.6, anchor: () => V(0, 0.45, 0) };
  },

  tank(asset) {
    const g = new THREE.Group();
    const onLegs = asset.spec?.mounting === 'elevated legs';
    const r = onLegs ? 1.05 : 1.15;
    const h = onLegs ? 2.3 : 2.8;
    const base = onLegs ? 0.55 : 0;
    const shell = cyl(r, h, MAT.stainless(), 48);
    shell.position.y = base + h / 2;
    g.add(shell);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(r * 1.01, 0.35, 48), MAT.stainless());
    roof.position.y = base + h + 0.175;
    roof.castShadow = true;
    g.add(roof);
    const manhole = cyl(0.18, 0.08, MAT.stainlessDark());
    manhole.position.y = base + h + 0.38;
    g.add(manhole);
    if (onLegs) {
      legs(g, r * 0.8, base, 4);
      const sump = new THREE.Mesh(new THREE.ConeGeometry(r, 0.3, 48), MAT.stainless());
      sump.rotation.x = Math.PI;
      sump.position.y = base - 0.05;
      g.add(sump);
      // external reinforcement rings, as filmed
      for (let i = 1; i <= 4; i++) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(r + 0.01, 0.018, 8, 64), MAT.stainlessDark());
        ring.rotation.x = Math.PI / 2;
        ring.position.y = base + (h * i) / 5;
        g.add(ring);
      }
    }
    return {
      group: g,
      height: base + h + 0.45,
      anchor: (port) => (port === 'in' ? V(0, base + h + 0.2, 0) : V(r * 0.7, Math.max(base - 0.05, 0.25), r * 0.7)),
      mount: (_i, k) => ({ position: V(-r * 0.6 + k * 0.2, base + 0.6, r + 0.02), facing: V(0, 0, 1) }),
    };
  },

  pump(asset) {
    const g = new THREE.Group();
    const vertical = /vertical/i.test(asset.spec?.type ?? '');
    if (vertical) {
      // inline vertical multistage: flanged base, stainless stage barrel, black motor on top
      const foot = box(0.42, 0.12, 0.34, MAT.dark());
      foot.position.y = 0.06;
      g.add(foot);
      const head = cyl(0.13, 0.16, MAT.stainlessDark());
      head.position.y = 0.2;
      g.add(head);
      for (const sx of [-1, 1]) {
        const nozzle = cyl(0.06, 0.2, MAT.stainless());
        nozzle.rotation.z = Math.PI / 2;
        nozzle.position.set(sx * 0.24, 0.2, 0);
        g.add(nozzle);
      }
      const barrel = cyl(0.085, 1.05, MAT.stainless());
      barrel.position.y = 0.8;
      g.add(barrel);
      const lantern = cyl(0.11, 0.18, MAT.dark());
      lantern.position.y = 1.41;
      g.add(lantern);
      const motor = cyl(0.16, 0.5, MAT.motor(), 24);
      motor.position.y = 1.75;
      g.add(motor);
      const plate = box(0.26, 0.16, 0.005, MAT.label());
      plate.position.set(0, 2.12, 0.0);
      const cap = box(0.3, 0.2, 0.3, MAT.motor());
      cap.position.y = 2.1;
      g.add(cap);
      plate.position.set(0, 2.1, 0.152);
      g.add(plate);
      return {
        group: g,
        height: 2.25,
        anchor: (port) => (port === 'in' ? V(-0.34, 0.2, 0) : V(0.34, 0.2, 0)),
        mount: (_i, k) => ({ position: V(k % 2 ? 0.3 : -0.3, 0.42 + Math.floor(k / 2) * 0.14, 0.12), facing: V(0, 0, 1) }),
      };
    }
    const small = !asset.spec?.type;
    const s = small ? 0.75 : 1;
    const base = box(0.9 * s, 0.1, 0.4 * s, MAT.frame());
    base.position.y = 0.05;
    g.add(base);
    const motor = cyl(0.15 * s, 0.45 * s, small ? MAT.stainless() : MAT.motor(), 24);
    motor.rotation.z = Math.PI / 2;
    motor.position.set(-0.15 * s, 0.1 + 0.16 * s, 0);
    g.add(motor);
    const volute = cyl(0.16 * s, 0.14 * s, MAT.stainless(), 32);
    volute.rotation.x = Math.PI / 2;
    volute.rotation.z = Math.PI / 2;
    volute.position.set(0.22 * s, 0.1 + 0.17 * s, 0);
    g.add(volute);
    return {
      group: g,
      height: 0.6,
      anchor: (port) => (port === 'in' ? V(0.34 * s, 0.27 * s, 0) : V(0.22 * s, 0.5 * s, 0)),
      mount: (_i, k) => ({ position: V(-0.3 + k * 0.15, 0.5, 0.16), facing: V(0, 0, 1) }),
    };
  },

  media_vessel() {
    const g = new THREE.Group();
    const r = 0.42, h = 1.7, base = 0.3;
    legs(g, r * 0.75, base, 3);
    const shell = cyl(r, h, MAT.stainless(), 48);
    shell.position.y = base + h / 2;
    g.add(shell);
    const top = dome(r, MAT.stainless());
    top.position.y = base + h;
    g.add(top);
    const bottom = dome(r, MAT.stainless());
    bottom.rotation.x = Math.PI;
    bottom.position.y = base;
    g.add(bottom);
    flange(r * 1.08, base + h - 0.05, g, 16);
    const plate = box(0.34, 0.22, 0.005, MAT.label());
    plate.position.set(r + 0.004, base + 1.05, 0);
    plate.rotation.y = Math.PI / 2;
    g.add(plate);
    const topY = base + h + 0.15, botY = base + 0.05;
    return {
      group: g,
      height: base + h + 0.25,
      anchor: (port) => (port.startsWith('top') ? V(0, topY, 0) : V(0, botY, 0)),
      mount: (_i, k) => ({ position: V(r + 0.06, base + 1.4 - k * 0.2, 0), facing: V(1, 0, 0) }),
    };
  },

  cartridge_housing() {
    const g = new THREE.Group();
    const r = 0.13, h = 1.05, base = 0.32;
    // individual stainless stand, as filmed
    const plate = box(0.36, 0.02, 0.36, MAT.frame());
    plate.position.y = base - 0.01;
    g.add(plate);
    for (const [x, z] of [[-0.15, -0.15], [0.15, -0.15], [-0.15, 0.15], [0.15, 0.15]]) {
      const leg = cyl(0.015, base, MAT.frame(), 8);
      leg.position.set(x, base / 2, z);
      g.add(leg);
    }
    const shell = cyl(r, h, MAT.stainless(), 40);
    shell.position.y = base + h / 2;
    g.add(shell);
    flange(r * 1.45, base + h, g, 10);
    const cap = dome(r * 1.3, MAT.stainless(), 0.5);
    cap.position.y = base + h + 0.02;
    g.add(cap);
    // handwritten change label on the dome
    const label = box(0.11, 0.004, 0.07, MAT.label());
    label.position.set(0, base + h + 0.13, 0.08);
    label.rotation.x = -0.55;
    g.add(label);
    const stem = cyl(0.014, 0.12, MAT.stainless(), 12);
    stem.position.y = base + h + 0.2;
    g.add(stem);
    return {
      group: g,
      height: base + h + 0.45,
      anchor: (port) => (port === 'in' ? V(0, 0.42, r) : V(0, 0.42, -r)),
      // the dome gauge faces the corridor (+z)
      mount: () => ({ position: V(0, base + h + 0.34, 0), facing: V(0, 0.32, 1), gaugeRadius: 0.085 }),
    };
  },

  header(asset, ctx) {
    // straight manifold across the cartridge bank; its ports line up with each line's housing
    const g = new THREE.Group();
    const xs = Object.keys(asset.ports)
      .map((p) => ctx.lineX(asset, p))
      .filter((x) => x != null);
    const span = xs.length ? Math.max(...xs) - Math.min(...xs) + 0.4 : 0.6;
    const pipe = cyl(0.045, span, MAT.stainless(), 16);
    pipe.rotation.z = Math.PI / 2;
    pipe.position.set((Math.max(...xs, 0) + Math.min(...xs, 0)) / 2, 0.42, 0);
    g.add(pipe);
    return {
      group: g,
      height: 0.5,
      anchor: (port) => {
        const x = ctx.lineX(asset, port);
        return x == null ? V(0, 0.42, 0) : V(x, 0.42, 0);
      },
    };
  },

  tee() {
    const g = new THREE.Group();
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 12), MAT.stainless());
    g.add(m);
    return { group: g, height: 0.1, anchor: () => V(0, 0, 0), elevate: true };
  },

  valve(asset, ctx) {
    const g = new THREE.Group();
    const y = ctx.valveHeight(asset);
    const needle = asset.spec?.type === 'needle';
    const body = needle ? cyl(0.035, 0.12, MAT.stainless(), 16) : new THREE.Mesh(new THREE.SphereGeometry(0.055, 16, 12), MAT.stainlessDark());
    body.position.y = y;
    body.castShadow = true;
    g.add(body);
    const pipeStub = cyl(0.04, 0.3, MAT.stainless(), 16);
    pipeStub.position.y = y;
    g.add(pipeStub);
    // quarter-turn ball valve: the stem points away from the vessel and the lever turns about
    // the stem, so it sweeps the plane across the pipe. 0 deg = lever along the pipe (open),
    // 90 deg = lever across the pipe (closed)
    const pivot = new THREE.Group();
    pivot.position.y = y;
    const out = ctx.valveFacing(asset);
    pivot.rotation.y = Math.atan2(out.x, out.z);
    const arm = new THREE.Group();
    pivot.add(arm);
    if (needle) {
      const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.008, 8, 24), MAT.dark());
      wheel.position.z = 0.09;
      arm.add(wheel);
    } else {
      const lever = box(0.03, 0.2, 0.012, MAT.lever());
      lever.position.set(0, -0.1, 0.07);
      arm.add(lever);
      const grip = box(0.036, 0.07, 0.02, MAT.lever());
      grip.position.set(0, -0.2, 0.07);
      arm.add(grip);
    }
    g.add(pivot);
    const closedDeg = asset.spec?.lever_angle_deg?.closed ?? 90;
    const openDeg = asset.spec?.lever_angle_deg?.open ?? 0;
    let target = openDeg, current = openDeg;
    const setPercent = (pct, instant = false) => {
      const p = Math.min(Math.max(pct, 0), 100) / 100;
      target = closedDeg + (openDeg - closedDeg) * p;
      if (instant) current = target;
    };
    const ns = asset.normal_state?.position;
    setPercent(ns === 'closed' ? 0 : ns === 'throttled' ? 40 : 100);
    current = target;
    const apply = () => { arm.rotation.z = THREE.MathUtils.degToRad(current); };
    apply();
    return {
      group: g,
      height: y + 0.15,
      anchor: (port) => (port === 'in' ? V(0, y - 0.15, 0) : V(0, y + 0.15, 0)),
      valve: {
        setPercent,
        angleDeg: () => current,
        tick(dt) { current += (target - current) * Math.min(1, dt * 4); apply(); },
      },
    };
  },

  drain(asset, ctx) {
    const g = new THREE.Group();
    const long = Object.keys(asset.ports).length > 1;
    if (long) {
      const len = ctx.drainLength(asset);
      const slot = box(0.3, 0.02, len, MAT.dark());
      slot.position.set(0, 0.01, -len / 2 + 0.3);
      slot.castShadow = false;
      g.add(slot);
      const grate = box(0.32, 0.012, len, MAT.frame());
      grate.position.set(0, 0.025, -len / 2 + 0.3);
      grate.material = MAT.frame();
      g.add(grate);
    } else {
      const grate = box(0.3, 0.02, 0.3, MAT.frame());
      grate.position.y = 0.01;
      g.add(grate);
    }
    return {
      group: g,
      height: 0.1,
      anchor: (_port, other) => (long && other ? V(0, 0.08, Math.min(0.3, Math.max(other.z - g.position.z, -ctx.drainLength(asset) + 0.3))) : V(0, 0.08, 0)),
    };
  },

  prefilter() {
    const g = new THREE.Group();
    const shell = cyl(0.14, 0.62, MAT.stainless(), 32);
    shell.position.y = 0.55;
    g.add(shell);
    flange(0.19, 0.86, g, 8);
    legs(g, 0.1, 0.24, 3);
    return { group: g, height: 1.0, anchor: (port) => (port === 'in' ? V(-0.14, 0.75, 0) : V(0.14, 0.35, 0)) };
  },

  polish_filter() {
    const g = new THREE.Group();
    const shell = cyl(0.08, 0.5, MAT.stainless(), 24);
    shell.position.y = 0.95;
    g.add(shell);
    flange(0.11, 1.2, g, 6);
    return { group: g, height: 1.3, anchor: (port) => (port === 'in' ? V(-0.08, 1.05, 0) : V(0.08, 0.8, 0)) };
  },

  injector() {
    const g = new THREE.Group();
    const body = cyl(0.04, 0.22, MAT.stainless(), 16);
    body.rotation.z = Math.PI / 2;
    body.position.y = 1.5;
    g.add(body);
    return { group: g, height: 1.6, anchor: (port) => (port === 'gas_in' ? V(0, 1.55, 0) : port === 'in' ? V(-0.11, 1.5, 0) : V(0.11, 1.5, 0)) };
  },

  ro_vessel_bank() {
    // vertical stainless pressure vessels under the teal instrument console
    const g = new THREE.Group();
    const frameW = 1.7;
    for (const x of [-frameW / 2, frameW / 2]) {
      const post = box(0.05, 2.5, 0.05, MAT.frame());
      post.position.set(x, 1.25, 0);
      g.add(post);
    }
    const rail = box(frameW, 0.05, 0.05, MAT.frame());
    rail.position.set(0, 0.25, 0);
    g.add(rail);
    for (let i = 0; i < 4; i++) {
      const tube = cyl(0.09, 1.55, MAT.stainless(), 24);
      tube.position.set(-0.6 + i * 0.4, 1.05, 0);
      g.add(tube);
      for (const y of [0.28, 1.83]) {
        const endcap = cyl(0.11, 0.06, MAT.stainlessDark(), 24);
        endcap.position.set(-0.6 + i * 0.4, y, 0);
        g.add(endcap);
      }
    }
    const consoleBox = box(1.65, 0.52, 0.26, MAT.teal());
    consoleBox.position.set(0, 2.25, 0.05);
    g.add(consoleBox);
    const slots = { rotameter: 0, gauge: 0, transmitter: 0 };
    return {
      group: g,
      height: 2.6,
      anchor: (port) => (port === 'feed_in' ? V(-0.85, 0.3, 0) : port === 'permeate_out' ? V(0.85, 1.83, 0) : V(0.85, 0.3, 0)),
      mount: (instr) => {
        const face = 0.19;
        if (instr.quantity === 'flow' && instr.observe === 'field_photo') {
          const k = slots.rotameter++;
          return { position: V(0.25 + k * 0.22, 2.25, face), facing: V(0, 0, 1), rotameter: true };
        }
        if (instr.quantity === 'pressure') {
          const k = slots.gauge++;
          return { position: V(-0.62 + k * 0.28, 2.3, face), facing: V(0, 0, 1), gaugeRadius: 0.075 };
        }
        const k = slots.transmitter++;
        return { position: V(-0.62 + k * 0.16, 2.6, 0.1), facing: V(0, 0, 1) };
      },
    };
  },

  oxygen_concentrator() {
    const g = new THREE.Group();
    const cab = box(0.55, 0.95, 0.5, MAT.white());
    cab.position.y = 0.475;
    g.add(cab);
    const panel = box(0.3, 0.16, 0.01, MAT.dark());
    panel.position.set(0, 0.78, 0.255);
    g.add(panel);
    const vents = box(0.36, 0.2, 0.01, MAT.frame());
    vents.position.set(0, 0.25, 0.255);
    g.add(vents);
    return { group: g, height: 1.0, anchor: () => V(0.2, 1.0, 0) };
  },

  ozone_generator() {
    const g = new THREE.Group();
    const cab = box(0.7, 1.05, 0.55, MAT.white());
    cab.position.y = 0.525;
    g.add(cab);
    const panel = box(0.4, 0.2, 0.01, MAT.dark());
    panel.position.set(0, 0.85, 0.28);
    g.add(panel);
    for (let i = 0; i < 3; i++) {
      const btn = cyl(0.02, 0.02, i === 0 ? MAT.gasket() : MAT.teal(), 12);
      btn.rotation.x = Math.PI / 2;
      btn.position.set(-0.1 + i * 0.1, 0.62, 0.285);
      g.add(btn);
    }
    return { group: g, height: 1.1, anchor: (port) => (port === 'in' ? V(-0.25, 1.05, 0) : V(0.25, 1.05, 0)) };
  },

  filler() {
    const g = new THREE.Group();
    const b = box(1.0, 1.2, 0.8, MAT.white());
    b.position.y = 0.6;
    g.add(b);
    return { group: g, height: 1.3, anchor: () => V(-0.5, 0.9, 0) };
  },

  hmi_plc() {
    // stainless pedestal desk with a slanted touchscreen, as filmed
    const g = new THREE.Group();
    const ped = box(0.55, 0.95, 0.45, MAT.brushed());
    ped.position.y = 0.475;
    g.add(ped);
    const head = new THREE.Group();
    head.position.set(0, 1.12, 0);
    head.rotation.x = -0.45;
    const bezel = box(0.62, 0.42, 0.06, MAT.brushed());
    head.add(bezel);
    const { tex, draw } = screenTexture();
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.54, 0.34), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    screen.position.z = 0.031;
    head.add(screen);
    g.add(head);
    const state = { cycle: 'RUNNING', tds: null, fault: 'NONE' };
    draw(state);
    return {
      group: g,
      height: 1.45,
      anchor: () => V(0, 0.2, 0),
      hmi: { update(patch) { Object.assign(state, patch); draw(state); } },
    };
  },

  mcc() {
    const g = new THREE.Group();
    const cab = box(1.2, 2.0, 0.4, MAT.white());
    cab.position.y = 1.0;
    g.add(cab);
    for (let i = 0; i < 3; i++) {
      const door = box(0.36, 1.8, 0.01, MAT.label());
      door.position.set(-0.4 + i * 0.4, 1.0, 0.205);
      g.add(door);
    }
    return { group: g, height: 2.1, anchor: () => V(0, 0.2, 0) };
  },
};

export function buildEquipment(asset, ctx) {
  const builder = BUILDERS[asset.kind];
  const built = builder
    ? builder(asset, ctx)
    : { group: new THREE.Group(), height: 0.5, anchor: () => V(0, 0.5, 0) };
  built.mount ??= topMount(built.height);
  return built;
}

// Field rotameter: glass tube with a float whose height follows the reading.
export function createRotameter(instrument) {
  const g = new THREE.Group();
  const tube = cyl(0.025, 0.32, MAT.glass(), 16);
  g.add(tube);
  for (const y of [-0.17, 0.17]) {
    const cap = cyl(0.032, 0.025, MAT.stainlessDark(), 16);
    cap.position.y = y;
    g.add(cap);
  }
  const float = cyl(0.018, 0.025, MAT.gasket(), 12);
  g.add(float);
  const [lo, hi] = instrument.range;
  let target = null, current = -0.14;
  return {
    group: g,
    setReading(v) { target = v; },
    tick(dt) {
      const goal = target == null ? -0.14 : -0.14 + ((Math.min(Math.max(target, lo), hi) - lo) / (hi - lo)) * 0.28;
      current += (goal - current) * Math.min(1, dt * 3);
      float.position.y = current;
    },
  };
}

// Small field transmitter or switch for a streamed point; its LED shows the state only when
// abnormal (red) or when it is a running-state feedback (green), otherwise stays grey.
export function createTransmitter(instrument) {
  const g = new THREE.Group();
  const body = box(0.07, 0.07, 0.05, MAT.white());
  g.add(body);
  const ledMat = new THREE.MeshStandardMaterial({ color: 0x9aa1a8, emissive: 0x000000, roughness: 0.4 });
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.011, 10, 8), ledMat);
  led.position.set(0, 0.012, 0.027);
  g.add(led);
  return {
    group: g,
    setReading(v, label) {
      const abnormal = isAbnormal(label);
      const running = label === 'RUNNING';
      const c = abnormal ? 0xc62828 : running ? 0x2e7d32 : 0x9aa1a8;
      ledMat.color.set(c);
      ledMat.emissive.set(abnormal || running ? c : 0x000000);
      ledMat.emissiveIntensity = abnormal ? 0.9 : 0.4;
    },
    tick() {},
  };
}
