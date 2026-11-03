// Visual language for the plant scene. Light, neutral and industrial (ISA-101 style): normal
// equipment is grey and stainless, colour is reserved for state. One blue accent marks the
// investigation's current focus.
import * as THREE from 'three';

export const COLORS = {
  background: 0xeef0f2,
  floor: 0xdedbd5,
  floorLine: 0xcfcac2,
  walkway: 0xc9c4bb,
  wall: 0xf3f2ef,
  wallTrim: 0x8a6f55,        // brown tile band seen in the footage
  stainless: 0xd3d8dd,
  stainlessDark: 0x8d959d,
  motor: 0x2b2f33,
  white: 0xf5f6f7,
  upvc: 0xf1f1ee,
  teal: 0x2f8f8a,            // RO instrument console, as filmed
  lever: 0xf2c200,           // yellow valve handles
  gasket: 0xa6342b,
  frame: 0x9aa1a8,
  label: 0xffffff,
  accent: 0x25625b,
  alarm: 0xc62828,
  warning: 0xe08600,
  ok: 0x1b7f3b,
};

export const CSS = {
  accent: '#25625b',
  alarm: '#c62828',
  warning: '#e08600',
  ok: '#1b7f3b',
  ink: '#1a2028',
  muted: '#5b6672',
  line: '#d6dbe1',
};

// Pipe rack elevation (m) and look per medium, so crossing lines separate vertically.
export const PIPE = {
  raw:          { y: 2.55, r: 0.045, color: COLORS.stainless },
  pretreated:   { y: 2.35, r: 0.045, color: COLORS.stainless },
  highpressure: { y: 1.05, r: 0.035, color: COLORS.stainlessDark },
  permeate:     { y: 2.75, r: 0.03,  color: COLORS.stainless },
  pure:         { y: 2.95, r: 0.03,  color: COLORS.stainless },
  reject:       { y: 0.55, r: 0.025, color: COLORS.stainlessDark },
  backwash:     { y: 2.15, r: 0.04,  color: COLORS.stainless },
  drain:        { y: 0.12, r: 0.04,  color: COLORS.upvc },
  chemical:     { y: 1.6,  r: 0.015, color: COLORS.white },
  oxygen:       { y: 1.5,  r: 0.012, color: COLORS.white },
  ozone_gas:    { y: 1.5,  r: 0.012, color: COLORS.white },
};

const cache = new Map();
export function material(key, make) {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
}

export const MAT = {
  stainless: () => material('stainless', () => new THREE.MeshStandardMaterial({ color: COLORS.stainless, metalness: 0.72, roughness: 0.26 })),
  stainlessDark: () => material('stainlessDark', () => new THREE.MeshStandardMaterial({ color: COLORS.stainlessDark, metalness: 0.65, roughness: 0.34 })),
  brushed: () => material('brushed', () => new THREE.MeshStandardMaterial({ color: 0xd7dbdf, metalness: 0.7, roughness: 0.42 })),
  motor: () => material('motor', () => new THREE.MeshStandardMaterial({ color: COLORS.motor, metalness: 0.3, roughness: 0.55 })),
  white: () => material('white', () => new THREE.MeshStandardMaterial({ color: COLORS.white, metalness: 0.05, roughness: 0.6 })),
  upvc: () => material('upvc', () => new THREE.MeshStandardMaterial({ color: COLORS.upvc, metalness: 0.0, roughness: 0.5 })),
  teal: () => material('teal', () => new THREE.MeshStandardMaterial({ color: COLORS.teal, metalness: 0.2, roughness: 0.5 })),
  lever: () => material('lever', () => new THREE.MeshStandardMaterial({ color: COLORS.lever, metalness: 0.1, roughness: 0.45 })),
  gasket: () => material('gasket', () => new THREE.MeshStandardMaterial({ color: COLORS.gasket, roughness: 0.7 })),
  frame: () => material('frame', () => new THREE.MeshStandardMaterial({ color: COLORS.frame, metalness: 0.6, roughness: 0.45 })),
  dark: () => material('dark', () => new THREE.MeshStandardMaterial({ color: 0x1b1e21, roughness: 0.4 })),
  screen: () => material('screen', () => new THREE.MeshStandardMaterial({ color: 0x0f2533, emissive: 0x2a6f97, emissiveIntensity: 0.35, roughness: 0.3 })),
  label: () => material('label', () => new THREE.MeshStandardMaterial({ color: COLORS.label, roughness: 0.9 })),
  glass: () => material('glass', () => new THREE.MeshStandardMaterial({ color: 0xe8f1f5, transparent: true, opacity: 0.45, roughness: 0.1 })),
};

// A state label is abnormal when it names a trip or fault, or starts with LOW_/HIGH_
// (LOW_LEVEL, HIGH_PRESSURE_TRIP...). Anchored so labels like BELOW_HIGH stay normal.
export function isAbnormal(label) {
  return typeof label === 'string' && /TRIP|FAULT|^LOW_|^HIGH_/.test(label);
}
