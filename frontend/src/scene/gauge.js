// Analog Bourdon gauge matching the dials in the footage: white face, black kg/cm2 scale
// (0 to 7, outer) and red psi scale (0 to 100, inner), 270 degree sweep. The needle is
// driven by a value in psi. setReading(null) parks the needle and greys the face, meaning
// "not yet observed" (the scene never invents a reading).
import * as THREE from 'three';
import { MAT } from './theme.js';

const SWEEP = (270 * Math.PI) / 180;
const START = (225 * Math.PI) / 180; // 0 at about 7:30 on the dial, max at about 4:30

function faceTexture(scales) {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const cx = size / 2, cy = size / 2;
  g.fillStyle = '#ffffff';
  g.beginPath(); g.arc(cx, cy, 250, 0, Math.PI * 2); g.fill();

  const outer = scales.find((s) => s.color === 'black') || scales[0];
  const inner = scales.find((s) => s.color === 'red');
  const drawScale = (s, rTick, rText, color, major, minor, font) => {
    const span = s.max - s.min;
    g.strokeStyle = color; g.fillStyle = color;
    for (let i = 0; i <= span / minor + 1e-6; i++) {
      const v = s.min + i * minor;
      const isMajor = Math.abs(v / major - Math.round(v / major)) < 1e-6;
      const a = START - ((v - s.min) / span) * SWEEP;
      const x = Math.cos(a), y = -Math.sin(a);
      g.lineWidth = isMajor ? 5 : 2;
      const len = isMajor ? 26 : 13;
      g.beginPath();
      g.moveTo(cx + x * rTick, cy + y * rTick);
      g.lineTo(cx + x * (rTick - len), cy + y * (rTick - len));
      g.stroke();
      if (isMajor) {
        g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(String(Math.round(v)), cx + x * rText, cy + y * rText);
      }
    }
  };
  if (outer) drawScale(outer, 232, 186, '#16191c', 1, 0.2, '600 40px sans-serif');
  if (inner) {
    g.strokeStyle = '#c62828'; g.lineWidth = 3;
    g.beginPath(); g.arc(cx, cy, 150, -START, -START + SWEEP); g.stroke();
    drawScale(inner, 150, 112, '#c62828', 20, 5, '700 34px sans-serif');
  }
  g.fillStyle = '#16191c'; g.textAlign = 'center';
  g.font = '600 28px sans-serif';
  if (inner) { g.fillStyle = '#c62828'; g.fillText(inner.unit, cx, cy + 92); }
  g.fillStyle = '#16191c';
  if (outer) g.fillText(outer.unit.replace('cm2', 'cm²'), cx, cy + 124);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function createGauge(instrument, { radius = 0.085 } = {}) {
  const group = new THREE.Group();
  group.name = `gauge:${instrument.tag}`;
  const scales = instrument.display_scales?.length
    ? instrument.display_scales
    : [{ unit: instrument.unit, min: instrument.range[0], max: instrument.range[1], color: 'black' }];

  const caseMesh = new THREE.Mesh(new THREE.CylinderGeometry(radius * 1.12, radius * 1.12, radius * 0.55, 40), MAT.stainless());
  caseMesh.rotation.x = Math.PI / 2;
  group.add(caseMesh);

  const faceMat = new THREE.MeshStandardMaterial({ map: faceTexture(scales), roughness: 0.35 });
  const face = new THREE.Mesh(new THREE.CircleGeometry(radius, 48), faceMat);
  face.position.z = radius * 0.28;
  group.add(face);

  const needlePivot = new THREE.Group();
  needlePivot.position.z = radius * 0.3;
  const needle = new THREE.Mesh(new THREE.BoxGeometry(radius * 0.82, radius * 0.06, 0.003), MAT.dark());
  needle.position.x = radius * 0.36;
  needlePivot.add(needle);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.09, radius * 0.09, 0.006, 16), MAT.dark());
  hub.rotation.x = Math.PI / 2;
  needlePivot.add(hub);
  group.add(needlePivot);

  const glass = new THREE.Mesh(new THREE.CircleGeometry(radius * 1.02, 48), MAT.glass());
  glass.position.z = radius * 0.31;
  group.add(glass);

  // Needle angle scale uses the psi (or only) scale range.
  const driving = scales.find((s) => s.unit === instrument.unit) || scales[0];
  let target = null, current = null;
  const angleFor = (v) => START - ((Math.min(Math.max(v, driving.min), driving.max) - driving.min) / (driving.max - driving.min)) * SWEEP;

  return {
    group,
    setReading(value) {
      target = value;
      faceMat.color.set(value == null ? 0xd9dde1 : 0xffffff);
    },
    tick(dt) {
      if (target == null) { needlePivot.rotation.z = angleFor(driving.min); current = null; return; }
      const goal = angleFor(target);
      current = current == null ? goal : current + (goal - current) * Math.min(1, dt * 3);
      needlePivot.rotation.z = current;
    },
  };
}
