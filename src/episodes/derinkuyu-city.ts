// Derinkuyu layout + CSG carving. World: ground surface y=0, section (cut) face at z=0, rock at z<0.
import * as THREE from 'three';
import {Brush, Evaluator, SUBTRACTION} from 'three-bvh-csg';
import {worldUV} from '../hib/pbr';
import {rnd} from '../hib/models';

export const LEVELS = 18;
export const floorY = (k: number) => -7.6 - k * 4.4;
export const XMAX = 26; // rooms span |x| < XMAX; tunnels live beyond
export const SHAFT = {x0: -4, x1: -1.2, y0: -84, z0: -2.8};
export const WELL = {x0: -19.4, x1: -17.8, y0: -55, z0: -1.6};
export const BASEMENT = {x0: 4, x1: 10.6, y0: -3.3, y1: -0.55, z0: -6};
export const HOUSE63 = {x0: 3.5, x1: 11.2};

export type RoomType = 'stable' | 'kitchen' | 'winery' | 'store' | 'church' | 'living';
export type Room = {k: number; x0: number; x1: number; y0: number; h: number; vault: number; d: number; type: RoomType; seed: number};

// ---------------------------------------------------------------- rooms
const SPECIAL: Record<number, RoomType> = {0: 'stable', 1: 'kitchen', 2: 'winery', 3: 'store', 4: 'church'};

const genLevel = (k: number): Room[] => {
  const out: Room[] = [];
  const y0 = floorY(k);
  const mk = (x0: number, x1: number, i: number): Room => {
    const s = k * 31 + i * 7 + (x0 > 0 ? 3 : 0);
    return {k, x0, x1, y0, h: 2.3 + rnd(s) * 0.6, vault: 0.45 + rnd(s + 1) * 0.45, d: 4.5 + rnd(s + 2) * 4.5, type: 'living', seed: s};
  };
  // right side
  let x = SHAFT.x1 + 0.7;
  let i = 0;
  while (x < XMAX - 3) {
    let w = 3.6 + rnd(k * 13 + i * 5) * 4.6;
    if (x + w > XMAX - 1.5) w = XMAX - x;
    // keep level 0 clear of the 1963 basement
    if (k === 0 && x < BASEMENT.x1 + 1 && x + w > HOUSE63.x0 - 1) {
      x = BASEMENT.x1 + 1.2;
      continue;
    }
    out.push(mk(x, x + w, i));
    x += w + 1.3 + rnd(k * 17 + i) * 0.9;
    i++;
  }
  // left side
  x = SHAFT.x0 - 0.7;
  while (x > -XMAX + 3) {
    let w = 3.6 + rnd(k * 19 + i * 3) * 4.6;
    if (x - w < -XMAX + 1.5) w = x + XMAX;
    out.push(mk(x - w, x, i));
    x -= w + 1.3 + rnd(k * 23 + i) * 0.9;
    i++;
  }
  out.sort((a, b) => a.x0 - b.x0);
  // special room: the one closest to x≈7 (visible in the "town" shot), made larger
  const sp = SPECIAL[k];
  if (sp) {
    let best = out[0];
    for (const r of out) if (Math.abs((r.x0 + r.x1) / 2 - 7) < Math.abs((best.x0 + best.x1) / 2 - 7)) best = r;
    best.type = sp;
    best.d = 8.5;
    if (sp === 'church') {
      best.h = 3.2;
      best.vault = 1.2;
    }
    if (sp === 'stable') best.h = 2.6;
  }
  return out;
};

export const ROOMS: Room[][] = Array.from({length: LEVELS}, (_, k) => genLevel(k));
export const roomTop = (r: Room) => r.y0 + r.h + r.vault;
export const special = (t: RoomType) => ROOMS.flat().find((r) => r.type === t)!;

// tunnels between level k and k+1 alternate sides; door + slot at the top landing
export const tunnelSide = (k: number) => (k % 2 === 0 ? 1 : -1);
export const DOOR_X = (k: number) => tunnelSide(k) * (XMAX + 0.8);

export const VENTS: {x: number; k: number}[] = [
  {x: -21.5, k: 6}, {x: -13.3, k: 3}, {x: -7.6, k: 11}, {x: 24.0, k: 8}, {x: 21.0, k: 14}, {x: 1.9, k: 1},
];

// ---------------------------------------------------------------- brush specs
export type BoxSpec = {kind: 'box'; x0: number; x1: number; y0: number; y1: number; z0: number; z1: number; rotZ?: number; cx?: number; cy?: number};
export type VaultSpec = {kind: 'vault'; x0: number; x1: number; y: number; rise: number; z0: number; z1: number};
export type Spec = BoxSpec | VaultSpec;

let jit = 0;
const J = () => (jit = (jit + 1) % 97) * 0.0007; // tiny offsets: avoid coplanar faces in CSG
const FRONT = () => 1 + J();

export const roomSpecs = (r: Room): Spec[] => [
  {kind: 'box', x0: r.x0, x1: r.x1, y0: r.y0, y1: r.y0 + r.h + 0.02, z0: -r.d, z1: FRONT()},
  {kind: 'vault', x0: r.x0, x1: r.x1, y: r.y0 + r.h, rise: r.vault, z0: -r.d + 0.001, z1: FRONT()},
];

const doorwaySpecs = (rooms: Room[]): Spec[] => {
  const out: Spec[] = [];
  for (let i = 0; i < rooms.length - 1; i++) {
    const a = rooms[i], b = rooms[i + 1];
    if (b.x0 - a.x1 > 2.6) continue;
    if (a.x1 < SHAFT.x1 && b.x0 > SHAFT.x0) continue; // shaft in between
    out.push({kind: 'box', x0: a.x1 - 0.2, x1: b.x0 + 0.2, y0: a.y0 + 0.003 + J(), y1: a.y0 + 1.85, z0: -1.7 - J(), z1: FRONT()});
  }
  // windows into the main shaft
  for (const r of rooms) {
    if (Math.abs(r.x1 - SHAFT.x0) < 0.9) out.push({kind: 'box', x0: r.x1 - 0.2, x1: SHAFT.x0 + 0.2, y0: r.y0 + 0.4, y1: r.y0 + 1.9, z0: -1.4 - J(), z1: FRONT()});
    if (Math.abs(r.x0 - SHAFT.x1) < 0.9) out.push({kind: 'box', x0: SHAFT.x1 - 0.2, x1: r.x0 + 0.2, y0: r.y0 + 0.4, y1: r.y0 + 1.9, z0: -1.4 - J(), z1: FRONT()});
  }
  return out;
};

export const tunnelGeom = (k: number) => {
  const s = tunnelSide(k);
  const xa = s * (XMAX + 0.3), xb = s * (XMAX + 6.3);
  const ya = floorY(k), yb = floorY(k + 1);
  return {s, xa, xb, ya, yb, len: Math.hypot(xb - xa, yb - ya), ang: Math.atan2(yb - ya, xb - xa)};
};

const tunnelSpecs = (k: number): Spec[] => {
  const t = tunnelGeom(k);
  const s = t.s;
  const lastTop = ROOMS[k].reduce((m, r) => (s > 0 ? Math.max(m, r.x1) : Math.min(m, r.x0)), 0);
  const lastBot = ROOMS[k + 1].reduce((m, r) => (s > 0 ? Math.max(m, r.x1) : Math.min(m, r.x0)), 0);
  const out: Spec[] = [];
  // top landing (with the door slot), sloped passage, bottom landing
  const ta0 = s > 0 ? lastTop - 0.3 : t.xa - 1.2, ta1 = s > 0 ? t.xa + 1.2 : lastTop + 0.3;
  out.push({kind: 'box', x0: ta0, x1: ta1, y0: t.ya + 0.004 + J(), y1: t.ya + 1.9, z0: -1.5 - J(), z1: FRONT()});
  out.push({kind: 'box', x0: DOOR_X(k) - 0.24, x1: DOOR_X(k) + 0.24, y0: t.ya + 0.006 + J(), y1: t.ya + 1.62, z0: -3.4, z1: -1.2});
  const cx = (t.xa + t.xb) / 2, cy = (t.ya + t.yb) / 2 + 0.95;
  const L = t.len + 1.2;
  out.push({kind: 'box', x0: -L / 2, x1: L / 2, y0: -0.95, y1: 0.95, z0: -1.45 - J(), z1: FRONT(), rotZ: s > 0 ? t.ang : t.ang - Math.PI, cx, cy});
  const b0 = s > 0 ? lastBot - 0.3 : t.xb - 1.0, b1 = s > 0 ? t.xb + 1.0 : lastBot + 0.3;
  out.push({kind: 'box', x0: b0, x1: b1, y0: t.yb + 0.005 + J(), y1: t.yb + 1.9, z0: -1.5 - J(), z1: FRONT()});
  return out;
};

const shaftSpec = (yBottom: number): Spec => ({kind: 'box', x0: SHAFT.x0, x1: SHAFT.x1, y0: yBottom, y1: 1.5, z0: SHAFT.z0, z1: FRONT()});
const wellSpec = (): Spec => ({kind: 'box', x0: WELL.x0, x1: WELL.x1, y0: WELL.y0, y1: 1.5, z0: WELL.z0, z1: FRONT()});
const ventSpec = (v: {x: number; k: number}): Spec => ({kind: 'box', x0: v.x - 0.25, x1: v.x + 0.25, y0: floorY(v.k) + 1.5, y1: 1.5, z0: -0.9 - J(), z1: FRONT()});
const basementSpecs = (): Spec[] => [
  {kind: 'box', x0: BASEMENT.x0, x1: BASEMENT.x1, y0: BASEMENT.y0, y1: BASEMENT.y1, z0: BASEMENT.z0, z1: FRONT()},
];
/** The 1963 tunnel: from the basement's left wall down to level 0 (behind the plug wall). */
export const HOOK_TUNNEL = {xa: 4.05, ya: BASEMENT.y0, xb: -0.1, yb: floorY(0)};
const hookTunnelSpec = (): Spec => {
  const {xa, ya, xb, yb} = HOOK_TUNNEL;
  const ang = Math.atan2(yb - ya, xb - xa);
  const L = Math.hypot(xb - xa, yb - ya) + 1.0;
  return {kind: 'box', x0: -L / 2, x1: L / 2, y0: -0.9, y1: 0.9, z0: -1.6 - J(), z1: FRONT(), rotZ: ang - Math.PI, cx: (xa + xb) / 2 - 0.4, cy: (ya + yb) / 2 + 0.95};
};

/** Everything carved, in "digging" order. */
export const allSpecs = (): Spec[] => {
  jit = 0;
  const out: Spec[] = [shaftSpec(SHAFT.y0), ...basementSpecs(), hookTunnelSpec(), wellSpec(), ...VENTS.map(ventSpec)];
  for (let k = 0; k < LEVELS; k++) {
    for (const r of ROOMS[k]) out.push(...roomSpecs(r));
    out.push(...doorwaySpecs(ROOMS[k]));
    if (k < LEVELS - 1) out.push(...tunnelSpecs(k));
  }
  return out;
};

/** Specs for the "carving" closeup: shaft down to `shaftBottom`, then rooms of levels 0..1 grown to fraction. */
export const carvingSpecs = (shaftBottom: number, roomFrac: number[]): Spec[] => {
  jit = 0;
  const out: Spec[] = [...basementSpecs()];
  if (shaftBottom < 0.5) out.push(shaftSpec(shaftBottom));
  const rooms = [...ROOMS[0], ...ROOMS[1]].filter((r) => Math.min(Math.abs(r.x0), Math.abs(r.x1)) < 16).sort((a, b) => a.k - b.k || Math.abs(a.x0 + a.x1) - Math.abs(b.x0 + b.x1));
  rooms.forEach((r, i) => {
    const fr = roomFrac[i] ?? 0;
    if (fr <= 0.02 || r.y0 < shaftBottom) return;
    // grow outward from the shaft side
    const right = r.x0 > SHAFT.x1;
    const w = (r.x1 - r.x0) * fr;
    const rr = {...r, x0: right ? r.x0 : r.x1 - w, x1: right ? r.x0 + w : r.x1, d: Math.max(1.5, r.d * Math.min(1, fr * 1.4))};
    out.push(...roomSpecs(rr));
    // opening to the shaft
    if (right) out.push({kind: 'box', x0: SHAFT.x1 - 0.2, x1: r.x0 + 0.2, y0: r.y0 + 0.01, y1: r.y0 + 1.9, z0: -1.4, z1: FRONT()});
    else out.push({kind: 'box', x0: r.x1 - 0.2, x1: SHAFT.x0 + 0.2, y0: r.y0 + 0.01, y1: r.y0 + 1.9, z0: -1.4, z1: FRONT()});
  });
  return out;
};
export const N_STAGES = 40;
/** Stage i (0..N_STAGES-1) of the carving closeup. */
export const carvingStage = (i: number) => {
  const t = i / (N_STAGES - 1);
  const sm = (a: number, b: number) => Math.min(1, Math.max(0, (t - a) / (b - a)));
  const shaftBottom = 1.5 + (floorY(1) - 0.3 - 1.5) * sm(0.0, 0.3);
  const n = carvingRooms().length;
  const fr = Array.from({length: n}, (_, j) => sm(0.22 + (j * 0.62) / n, 0.22 + (j * 0.62) / n + 0.16));
  return carvingSpecs(shaftBottom, fr);
};
export const carvingRooms = () => [...ROOMS[0], ...ROOMS[1]].filter((r) => Math.min(Math.abs(r.x0), Math.abs(r.x1)) < 16).sort((a, b) => a.k - b.k || Math.abs(a.x0 + a.x1) - Math.abs(b.x0 + b.x1));

// ---------------------------------------------------------------- CSG
const phFace = new THREE.MeshBasicMaterial();
const phCarve = new THREE.MeshBasicMaterial();

const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 28, 1);

const specBrush = (s: Spec) => {
  if (s.kind === 'box') {
    const b = new Brush(boxGeo, phCarve);
    b.scale.set(s.x1 - s.x0, s.y1 - s.y0, s.z1 - s.z0);
    if (s.rotZ !== undefined) {
      b.position.set(s.cx!, s.cy!, (s.z0 + s.z1) / 2);
      b.rotation.z = s.rotZ;
      // local box offset (x0..x1, y0..y1 around the centre)
      const off = new THREE.Vector3((s.x0 + s.x1) / 2, (s.y0 + s.y1) / 2, 0).applyAxisAngle(new THREE.Vector3(0, 0, 1), s.rotZ);
      b.position.x += off.x;
      b.position.y += off.y;
    } else b.position.set((s.x0 + s.x1) / 2, (s.y0 + s.y1) / 2, (s.z0 + s.z1) / 2);
    b.updateMatrixWorld();
    return b;
  }
  const b = new Brush(cylGeo, phCarve);
  const r = (s.x1 - s.x0) / 2;
  b.rotation.x = Math.PI / 2;
  b.scale.set(r, s.z1 - s.z0, s.rise);
  b.position.set((s.x0 + s.x1) / 2, s.y, (s.z0 + s.z1) / 2);
  b.updateMatrixWorld();
  return b;
};

export type Carved = {geo: THREE.BufferGeometry; matKeys: ('face' | 'carve')[]};

const cache = new Map<string, Carved>();
/** Rock block (x: ±w/2, y: bottom..-0.02, z: -depth..0) minus all specs. Cached by key. */
export const carve = (key: string, specs: Spec[], block = {w: 150, bottom: -96, depth: 70}): Carved => {
  const hit = cache.get(key);
  if (hit) return hit;
  const ev = new Evaluator();
  ev.attributes = ['position', 'normal'];
  ev.useGroups = true;
  const base = new THREE.BoxGeometry(block.w, -0.02 - block.bottom, block.depth);
  base.deleteAttribute('uv');
  base.translate(0, (block.bottom - 0.02) / 2, -block.depth / 2);
  let acc = new Brush(base, phFace);
  acc.updateMatrixWorld();
  const bg = boxGeo.clone();
  bg.deleteAttribute('uv');
  const cg = cylGeo.clone();
  cg.deleteAttribute('uv');
  for (const s of specs) {
    const b = specBrush(s);
    b.geometry = s.kind === 'box' ? bg : cg;
    b.updateMatrixWorld();
    acc = ev.evaluate(acc, b, SUBTRACTION) as Brush;
  }
  const geo = acc.geometry.index ? acc.geometry.toNonIndexed() : acc.geometry.clone();
  const mats = (Array.isArray(acc.material) ? acc.material : [acc.material]) as THREE.Material[];
  worldUV(geo, 1);
  const out: Carved = {geo, matKeys: mats.map((m) => (m === phFace ? 'face' : 'carve'))};
  cache.set(key, out);
  return out;
};
