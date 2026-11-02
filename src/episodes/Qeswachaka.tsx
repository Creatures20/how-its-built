// Episode 10: Q'eswachaka, the Inca rope bridge woven from grass and rebuilt every year.
import React, {useMemo} from 'react';
import {AbsoluteFill, Audio, Easing, interpolate, Sequence, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {ThreeCanvas} from '@remotion/three';
import * as THREE from 'three';
import {mergeGeometries, mergeVertices} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import VO from './ep010-qeswachaka-vo.json';
import {AssetProvider, Renderer, SkyDome, Sun, TexName, useMat, usePlainMat, uvBox, worldUV} from '../hib/pbr';
import {Beam, Dust, KIT_TEXTURES, Person, Rope, Terrain, Water, rnd, walkAlong} from '../hib/models';
import {CameraRig} from '../hib/three';
import {Cam, camPath, groundSafe, toScreen} from '../hib/project';
import {Caption, Grade, Headline, SceneFade, StepBadge, Tag, Watermark} from '../hib/ui';

// ============================================================ timing
const FPS = 30;
const VO_DELAY = 5;
const sceneLen = (i: number, tail: number) => Math.ceil((VO.durations[i] + tail) * FPS) + VO_DELAY;
const LEN = [sceneLen(0, 0.2), sceneLen(1, 0.2), sceneLen(2, 0.2), sceneLen(3, 0.2), sceneLen(4, 0.25), sceneLen(5, 0.2), sceneLen(6, 0.2), sceneLen(7, 1.1)];
const START = LEN.map((_, i) => LEN.slice(0, i).reduce((a, b) => a + b, 0));
export const QESWACHAKA_DURATION = LEN.reduce((a, b) => a + b, 0);

const cl = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
const ramp = (f: number, a: number, b: number, ease = Easing.inOut(Easing.cubic)) => interpolate(f, [a, b], [0, 1], {...cl, easing: ease});
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const table = (x: number, pts: [number, number][]) => {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return pts[pts.length - 1][1];
};

const TEXTURES: TexName[] = [...KIT_TEXTURES, 'puna_grass', 'andes_rock', 'rope_fresh', 'rope_old', 'branch_mat', 'rubble_wall', 'stone_face_grey', 'water', 'straw', 'dirt', 'gravel'];

// ============================================================ the gorge
const H = 15; // abutment level above the river
const SPAN = 14; // half span (28 m)
const TAIL = 18.5; // anchor bar
const SAG_OLD = 3.5;
const SAG_NEW = 2.3;
const DECK_Y = H + 0.75;
const floorY = (x: number, sag: number) => {
  const a = Math.abs(x);
  return a <= SPAN ? DECK_Y - sag * (1 - (x / SPAN) ** 2) : DECK_Y + (a - SPAN) * 0.055;
};
const railOff = (x: number) => {
  const a = Math.abs(x);
  return a <= SPAN ? 1.05 : 1.05 * (1 - (a - SPAN) / (TAIL - SPAN));
};

const hash2 = (x: number, y: number) => {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
};
const vn = (x: number, y: number) => {
  const i = Math.floor(x), j = Math.floor(y);
  const u = x - i, v = y - j;
  const a = u * u * (3 - 2 * u), b = v * v * (3 - 2 * v);
  return (hash2(i, j) * (1 - a) + hash2(i + 1, j) * a) * (1 - b) + (hash2(i, j + 1) * (1 - a) + hash2(i + 1, j + 1) * a) * b;
};
const fbm2 = (x: number, y: number) => vn(x, y) * 0.55 + vn(x * 2.1, y * 2.1) * 0.28 + vn(x * 4.3, y * 4.3) * 0.17;

const riverX = (z: number) => 7 * Math.sin(z / 70) * smooth(20, 130, Math.abs(z));
const gorgeH = (x: number, z: number) => {
  const az = Math.abs(z);
  const rx = riverX(z);
  const open = smooth(7, 26, az); // keeps the walls clean at the bridge site
  const d = Math.abs(x - rx) + (vn(z * 0.11 + 3, x * 0.07) - 0.5) * 6 * open;
  let h = table(d, [[0, -2.4], [6.5, -2.4], [8.6, 0.3], [10.2, 4.5], [12.2, 10.5], [13.5, 14.6], [15, 15.5], [30, 16], [46, 23], [80, 46], [150, 92], [260, 142], [420, 215], [900, 330]]);
  const bench = (1 - smooth(16, 34, az)) * (1 - smooth(32, 46, d));
  const crag = smooth(9, 15, d) * (1 - bench);
  h += open * smooth(8, 15, d) * smooth(0, 60, d + 40) * 9 * (1 - bench);
  h += crag * ((fbm2(x * 0.018 + 5, z * 0.018) - 0.5) * 34 * smooth(14, 130, d) + (fbm2(x * 0.09, z * 0.09) - 0.5) * 7);
  return h;
};
/** far terrain drops under the detailed centre patch so the two never fight */
const farH = (x: number, z: number) => gorgeH(x, z) - 5 * (1 - smooth(235, 258, Math.max(Math.abs(x), Math.abs(z))));

// ---- ichu tussocks, merged (static, one draw call)
const bladeTuft = (seed: number, blades: number, height: number) => {
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  for (let b = 0; b < blades; b++) {
    const a = rnd(seed + b * 3.3) * Math.PI * 2;
    const r0 = rnd(seed + b * 1.7) * 0.14;
    const lean = 0.25 + rnd(seed + b * 5.1) * 0.5;
    const h = height * (0.65 + rnd(seed + b * 2.9) * 0.5);
    const w = 0.016;
    const base = pos.length / 3;
    const dx = Math.cos(a), dz = Math.sin(a);
    const sx = -dz * w, sz = dx * w;
    for (let k = 0; k <= 3; k++) {
      const t = k / 3;
      const out = r0 + lean * h * t * t;
      const px = dx * out, pz = dz * out, py = h * t * (1 - 0.32 * t);
      const ww = 1 - t * 0.92;
      pos.push(px - sx * ww, py, pz - sz * ww, px + sx * ww, py, pz + sz * ww);
      const c = 0.55 + 0.45 * t;
      const tone = rnd(seed + b);
      const cc = [(0.62 + 0.24 * tone) * c, (0.54 + 0.17 * tone) * c, (0.23 + 0.12 * tone) * c];
      col.push(...cc, ...cc);
    }
    for (let k = 0; k < 3; k++) {
      const i = base + k * 2;
      idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
};
let tuftCache: THREE.BufferGeometry | null = null;
const tuftField = () => {
  if (tuftCache) return tuftCache;
  const parts: THREE.BufferGeometry[] = [];
  const m = new THREE.Matrix4();
  const protos = [0, 1, 2, 3].map((i) => bladeTuft(i * 11 + 1, 16, 0.75));
  let i = 0;
  while (parts.length < 5200 && i < 30000) {
    i++;
    const near = i % 3 !== 0;
    const R = near ? 75 : 210;
    const x = (rnd(i * 1.13) - 0.5) * R * 2, z = (rnd(i * 2.71) - 0.5) * R * 2;
    const d = Math.abs(x - riverX(z));
    if (d < 15) continue;
    if (Math.abs(z) < 3.2 && Math.abs(x) < 24) continue; // keep the access to the bridge clear
    const y = gorgeH(x, z);
    const slope = Math.hypot(gorgeH(x + 1, z) - y, gorgeH(x, z + 1) - y);
    if (slope > 0.75) continue;
    if (fbm2(x * 0.05, z * 0.05) < 0.34) continue;
    const s = 0.75 + rnd(i * 3.7) * 0.9;
    m.makeRotationY(rnd(i) * 6.28).scale(new THREE.Vector3(s, s, s)).setPosition(x, y - 0.03, z);
    parts.push(protos[i % 4].clone().applyMatrix4(m));
  }
  const g = mergeGeometries(parts)!;
  g.computeVertexNormals();
  tuftCache = g;
  return g;
};
const Tussocks: React.FC = () => {
  const mat = useMemo(() => new THREE.MeshStandardMaterial({vertexColors: true, roughness: 0.95, side: THREE.DoubleSide, envMapIntensity: 0.6}), []);
  return <mesh geometry={tuftField()} material={mat} />;
};

// ---- rope geometry
type P3 = [number, number, number];
/** Tube along an arbitrary path with rope-scaled UVs. Rings are in order, so drawRange(0, k * radial * 6) reveals it along the path. */
const ropeGeo = (path: (s: number) => P3, n: number, r: number, radial = 8, tile?: number) => {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  const pts = Array.from({length: n + 1}, (_, i) => new THREE.Vector3(...path(i / n)));
  const T = new THREE.Vector3(), N = new THREE.Vector3(), B = new THREE.Vector3(), up = new THREE.Vector3(0, 0, 1), alt = new THREE.Vector3(0, 1, 0);
  const uScale = tile ?? Math.PI * 2 * r;
  let len = 0;
  for (let i = 0; i <= n; i++) {
    T.copy(pts[Math.min(n, i + 1)]).sub(pts[Math.max(0, i - 1)]).normalize();
    const ref = Math.abs(T.dot(up)) > 0.9 ? alt : up;
    N.copy(ref).cross(T).normalize();
    B.copy(T).cross(N).normalize();
    if (i > 0) len += pts[i].distanceTo(pts[i - 1]);
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const c = Math.cos(a), sn = Math.sin(a);
      const nx = N.x * c + B.x * sn, ny = N.y * c + B.y * sn, nz = N.z * c + B.z * sn;
      pos.push(pts[i].x + nx * r, pts[i].y + ny * r, pts[i].z + nz * r);
      nor.push(nx, ny, nz);
      uv.push(len / uScale, j / radial);
    }
  }
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j, b = a + radial + 1;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
};
const lazy = <T,>(fn: () => T) => {
  let v: T | undefined;
  return () => (v === undefined ? (v = fn()) : v);
};
const line = (a: P3, b: P3) => (s: number): P3 => [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s];

// ---- bridge, built straight (y = height above the deck curve), then bent onto a curve
const FLOOR_Z = [-0.39, -0.13, 0.13, 0.39];
const CAB_R = 0.09;
const RAIL_R = 0.06;
const RAIL_Z = 0.62;
const LASH_DX = 0.24;
const buildBridge = () => {
  const cables = FLOOR_Z.map((z) => ropeGeo((s) => [-TAIL + 2 * TAIL * s, 0, z], 110, CAB_R, 9));
  const rails = [-RAIL_Z, RAIL_Z].map((z) => ropeGeo((s) => {
    const x = -TAIL + 2 * TAIL * s;
    return [x, railOff(x), z];
  }, 110, RAIL_R, 8));
  const half = (dir: number) => {
    const out: THREE.BufferGeometry[] = [];
    const n = Math.floor((SPAN - 0.1) / LASH_DX);
    for (let i = 0; i < n; i++) {
      const x = dir * (SPAN - 0.1 - i * LASH_DX);
      const x2 = x - dir * LASH_DX;
      for (const sd of [-1, 1]) {
        out.push(ropeGeo(line([x, 1.03, sd * RAIL_Z], [x, 0.03, sd * 0.44]), 2, 0.018, 5, 0.3));
        out.push(ropeGeo(line([x, 0.03, sd * 0.44], [x2, 1.03, sd * RAIL_Z]), 2, 0.014, 5, 0.3));
      }
    }
    return {geo: mergeGeometries(out)!, unit: out[0].index!.count, n};
  };
  const lashL = half(-1), lashR = half(1);
  const deck = (dir: number) => {
    const n = Math.floor(SPAN / 0.3);
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < n; i++) {
      const x = dir * (SPAN - i * 0.3);
      const b = uvBox(0.3, 0.05, 1.04 + rnd(i * 3.1 + dir) * 0.16, 1.6);
      b.translate(x - dir * 0.15, CAB_R + 0.03, (rnd(i * 5.1 + dir) - 0.5) * 0.06);
      parts.push(b);
    }
    return {geo: mergeGeometries(parts)!, unit: parts[0].index!.count, n};
  };
  return {cables: mergeGeometries(cables)!, rails: mergeGeometries(rails)!, lashL, lashR, deckL: deck(-1), deckR: deck(1)};
};
const bend = (g: THREE.BufferGeometry, sag: number) => {
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) + floorY(p.getX(i), sag));
  p.needsUpdate = true;
  return g;
};
const newBridge = lazy(() => {
  const b = buildBridge();
  [b.cables, b.rails, b.lashL.geo, b.lashR.geo, b.deckL.geo, b.deckR.geo].forEach((g) => bend(g, SAG_NEW));
  return b;
});
const oldBridge = lazy(() => {
  const b = buildBridge();
  const ropes = mergeGeometries([b.cables, b.rails, b.lashL.geo, b.lashR.geo])!;
  const deck = mergeGeometries([b.deckL.geo, b.deckR.geo])!;
  const base = {ropes: (ropes.getAttribute('position').array as Float32Array).slice(), deck: (deck.getAttribute('position').array as Float32Array).slice()};
  return {ropes, deck, base};
});

const RopeMesh: React.FC<{geometry: THREE.BufferGeometry; tint?: string}> = ({geometry, tint}) => {
  const m = useMat('rope_fresh', {tint, normalScale: 1.2});
  return <mesh geometry={geometry} material={m} castShadow frustumCulled={false} />;
};

const useRopeMats = (clip?: THREE.Plane[]) => {
  const fresh = useMat('rope_fresh', {clip, normalScale: 1.2});
  const old = useMat('rope_old', {normalScale: 1.2});
  const cord = useMat('rope_fresh', {clip, tint: '#f2dfa8'});
  const deck = useMat('branch_mat', {clip, tint: '#d8c48e', side: THREE.DoubleSide});
  const deckOld = useMat('branch_mat', {tint: '#8d8676', side: THREE.DoubleSide});
  return {fresh, old, cord, deck, deckOld};
};

/** New bridge. `lash` and `deck` 0..1 reveal the side lashings / deck from both ends to the middle. */
const NewBridge: React.FC<{lash?: number; deck?: number; clip?: THREE.Plane[]}> = ({lash = 1, deck = 1, clip}) => {
  const b = newBridge();
  const m = useRopeMats(clip);
  const set = (g: {geo: THREE.BufferGeometry; unit: number; n: number}, unitsPerStep: number, t: number) => g.geo.setDrawRange(0, Math.round(g.n * t) * g.unit * unitsPerStep);
  set(b.lashL, 4, lash);
  set(b.lashR, 4, lash);
  set(b.deckL, 1, deck);
  set(b.deckR, 1, deck);
  return (
    <group>
      <mesh geometry={b.cables} material={m.fresh} castShadow receiveShadow frustumCulled={false} />
      <mesh geometry={b.rails} material={m.fresh} castShadow frustumCulled={false} />
      {lash > 0 && <mesh geometry={b.lashL.geo} material={m.cord} castShadow frustumCulled={false} />}
      {lash > 0 && <mesh geometry={b.lashR.geo} material={m.cord} castShadow frustumCulled={false} />}
      {deck > 0 && <mesh geometry={b.deckL.geo} material={m.deck} castShadow receiveShadow frustumCulled={false} />}
      {deck > 0 && <mesh geometry={b.deckR.geo} material={m.deck} castShadow receiveShadow frustumCulled={false} />}
    </group>
  );
};

/** Old grey bridge. cutR / cutL (0..1) animate the right end falling, then the left. */
const quad = (a: P3, c: P3, b: P3, u: number): [number, number] => {
  const v = 1 - u;
  return [v * v * a[0] + 2 * v * u * c[0] + u * u * b[0], v * v * a[1] + 2 * v * u * c[1] + u * u * b[1]];
};
const OldBridge: React.FC<{cutR?: number; cutL?: number; drift?: number}> = ({cutR = 0, cutL = 0, drift = 0}) => {
  const b = oldBridge();
  const m = useRopeMats();
  const write = (g: THREE.BufferGeometry, base: Float32Array) => {
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    const arr = p.array as Float32Array;
    const fall = cutR > 0 || cutL > 0;
    const k = cutR * cutR; // gravity
    const q = cutL * cutL;
    const A: P3 = [-SPAN + 8.5 * q, DECK_Y - (DECK_Y + 2.0) * q, 0];
    const E: P3 = [SPAN - 7.5 * k, DECK_Y - (DECK_Y + 2.0) * k, 0];
    const M: P3 = [(A[0] + E[0]) / 2 + 2 * k, (A[1] + E[1]) / 2 - SAG_OLD * 2 * (1 - 0.3 * k) + 7 * k * (1 - q), 0];
    for (let i = 0; i < arr.length; i += 3) {
      const x0 = base[i], y0 = base[i + 1], z0 = base[i + 2];
      if (!fall) {
        arr[i] = x0;
        arr[i + 1] = y0 + floorY(x0, SAG_OLD);
        arr[i + 2] = z0;
        continue;
      }
      const u = Math.min(1, Math.max(0, (x0 + SPAN) / (2 * SPAN)));
      const [px, py] = quad(A, M, E, u);
      const [qx, qy] = quad(A, M, E, Math.min(1, u + 0.01));
      const [rx, ry] = quad(A, M, E, Math.max(0, u - 0.01));
      let tx = qx - rx, ty = qy - ry;
      const l = Math.hypot(tx, ty) || 1;
      tx /= l;
      ty /= l;
      arr[i] = px - ty * y0;
      arr[i + 1] = py + tx * y0;
      arr[i + 2] = z0 + drift;
    }
    p.needsUpdate = true;
  };
  write(b.ropes, b.base.ropes);
  write(b.deck, b.base.deck);
  return (
    <group>
      <mesh geometry={b.ropes} material={m.old} castShadow receiveShadow frustumCulled={false} />
      <mesh geometry={b.deck} material={m.deckOld} castShadow receiveShadow frustumCulled={false} />
    </group>
  );
};

/** Stone abutment with rail posts and the stone anchor bar. side = -1 west, +1 east. */
const Abutment: React.FC<{side: number; loops?: boolean}> = ({side, loops}) => {
  const rope = useMat('rope_fresh', {repeat: [6, 1]});
  const m = useMat('rubble_wall', {tint: '#c9c0b2'});
  const r = useMat('stone_face_grey');
  const wall = useMemo(() => uvBox(6.6, 7, 4.2, 2.2), []);
  const post = useMemo(() => uvBox(0.5, 1.45, 0.5, 1.2), []);
  const bar = useMemo(() => worldUV(new THREE.CylinderGeometry(0.2, 0.2, 3.2, 12), 1.2), []);
  const top = DECK_Y - 0.12;
  return (
    <group>
      <mesh geometry={wall} material={m} position={[side * (SPAN + 3.25), top - 3.5, 0]} castShadow receiveShadow />
      {[-1, 1].map((z) => (
        <React.Fragment key={z}>
          <mesh geometry={post} material={m} position={[side * (SPAN + 0.25), top + 0.72, z * 0.95]} castShadow receiveShadow />
          <Boulder position={[side * (TAIL + 0.1), top + 0.3, z * 1.7]} scale={[0.6, 0.75, 0.5]} seed={z + 4} />
        </React.Fragment>
      ))}
      <mesh geometry={bar} material={r} position={[side * (TAIL + 0.05), floorY(TAIL, 0), 0]} rotation={[Math.PI / 2, 0, 0]} castShadow />
      {loops && [...FLOOR_Z, -RAIL_Z, RAIL_Z].map((z, i) => (
        <mesh key={i} position={[side * (TAIL + 0.05), floorY(TAIL, 0), z]} material={rope} castShadow>
          <torusGeometry args={[0.28, i < 4 ? CAB_R : RAIL_R, 8, 22]} />
        </mesh>
      ))}
    </group>
  );
};

// ---- villages: stone huts with grass roofs
const Hut: React.FC<{position: P3; s?: number; rotY?: number}> = ({position, s = 1, rotY = 0}) => {
  const w = useMat('rubble_wall', {tint: '#b8a78c'});
  const t = useMat('straw', {tint: '#c9a862', repeat: [3, 2]});
  const wall = useMemo(() => uvBox(4.2, 2.3, 3.4, 2.2), []);
  const roof = useMemo(() => {
    const g = new THREE.ConeGeometry(3.3, 2.6, 4, 1);
    g.rotateY(Math.PI / 4);
    g.scale(1.05, 1, 0.85);
    return g;
  }, []);
  return (
    <group position={position} rotation={[0, rotY, 0]} scale={s}>
      <mesh geometry={wall} material={w} position={[0, 1.15, 0]} castShadow receiveShadow />
      <mesh geometry={roof} material={t} position={[0, 3.55, 0]} castShadow receiveShadow />
    </group>
  );
};
const VILLAGES: [number, number][] = [[-120, -40], [132, -110], [-92, 130], [150, 96]];
const HUTS = VILLAGES.flatMap(([cx, cz], v) =>
  Array.from({length: 9}, (_, i) => {
    const x = cx + (rnd(v * 7 + i * 1.9) - 0.5) * 42, z = cz + (rnd(v * 3 + i * 2.3) - 0.5) * 42;
    return {pos: [x, gorgeH(x, z) - 0.2, z] as P3, r: rnd(i + v) * 3, s: 0.95 + rnd(i * 3.3) * 0.5};
  }),
);

const boulderGeo = (seed: number) => {
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, 6);
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  g = mergeVertices(g);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = fbm2(v.x * 1.1 + v.z * 0.7 + seed * 3 + 5, v.y * 1.3 + 7) - 0.5 + (fbm2(v.z * 2.2 + 9, v.x * 2.2 + v.y + seed) - 0.5) * 0.6;
    v.multiplyScalar(1 + n * 0.75);
    p.setXYZ(i, v.x, v.y * 0.85, v.z);
  }
  g.computeVertexNormals();
  return worldUV(g, 2.4);
};
const BOULDER_GEOS = lazy(() => [0, 1, 2, 3].map(boulderGeo));
const Boulder: React.FC<{position: P3; scale: P3 | number; seed: number}> = ({position, scale, seed}) => {
  const m = useMat('stone_face_grey', {tint: '#b9b1a6'});
  return <mesh geometry={BOULDER_GEOS()[seed % 4]} material={m} position={position} scale={scale as never} rotation={[0, seed * 1.3, 0]} castShadow receiveShadow />;
};

const BOULDERS = Array.from({length: 26}, (_, i) => {
  const z = -120 + i * 10 + rnd(i) * 7;
  const x = riverX(z) + (rnd(i * 3.3) - 0.5) * 12.5;
  return {pos: [x, -1.2 + rnd(i) * 0.5, z] as P3, s: [1.2 + rnd(i * 2) * 1.7, 0.7 + rnd(i * 5) * 1, 1 + rnd(i * 7) * 1.5] as P3};
}).filter((b) => Math.abs(b.pos[2]) > 6 && !(b.pos[2] > 16 && b.pos[2] < 56));

const RIM_ROCKS = Array.from({length: 30}, (_, i) => {
  const x = (rnd(i * 4.1 + 2) - 0.5) * 120, z = (rnd(i * 6.3 + 1) - 0.5) * 120;
  return {pos: [x, gorgeH(x, z) + 0.05, z] as P3, s: 0.45 + rnd(i) * 0.9, seed: i + 3};
}).filter((b) => Math.abs(b.pos[0] - riverX(b.pos[2])) > 19 && !(Math.abs(b.pos[2]) < 9 && Math.abs(b.pos[0]) < 34) && !(b.pos[0] < -18 && b.pos[0] > -44 && Math.abs(b.pos[2]) < 30) && !(b.pos[0] > 12 && b.pos[0] < 52 && b.pos[2] < 8 && b.pos[2] > -44));

const Gorge: React.FC<{f: number; huts?: boolean; loops?: boolean}> = ({f, huts = true, loops = false}) => (
  <group>
    <Terrain height={gorgeH} size={520} seg={330} tex="puna_grass" texScale={7} rockTex="andes_rock" rockScale={24} matte />
    <Terrain height={farH} size={2800} seg={170} tex="puna_grass" texScale={22} rockTex="andes_rock" rockScale={60} matte />
    <Water w={90} d={2800} position={[0, -0.75, 0]} time={f / 16} color="#5fa39a" texScale={7} />
    <Tussocks />
    <Abutment side={-1} loops={loops} />
    <Abutment side={1} loops={loops} />
    {BOULDERS.map((b, i) => <Boulder key={i} position={b.pos} scale={b.s} seed={i + 30} />)}
    {RIM_ROCKS.map((b, i) => <Boulder key={i} position={b.pos} scale={[b.s * 1.3, b.s * 0.7, b.s]} seed={b.seed} />)}
    {huts && HUTS.map((h, i) => <Hut key={i} position={h.pos} rotY={h.r} s={h.s} />)}
  </group>
);

const Atmos: React.FC<{f: number; golden?: number; shadow?: number; target?: P3}> = ({f, golden = 0, shadow = 90, target = [0, 8, 0]}) => {
  const sunDir: P3 = [-0.46 - 0.4 * golden, 0.82 - 0.52 * golden, 0.7];
  const sunCol = new THREE.Color('#fff4e2').lerp(new THREE.Color('#ffb868'), golden).getStyle();
  const hor = new THREE.Color('#cfe1ee').lerp(new THREE.Color('#f7cf9f'), golden).getStyle();
  const top = new THREE.Color('#1c57ad').lerp(new THREE.Color('#3a5fa6'), golden).getStyle();
  return (
    <>
      <Renderer exposure={0.95 + 0.1 * golden} envIntensity={0.68} />
      <SkyDome top={top} horizon={hor} sunDir={sunDir} sunColor={sunCol} clouds={0.62} time={f / 30} />
      <Sun dir={sunDir} intensity={3.3} color={sunCol} shadowSize={shadow} shadowRes={4096} target={target} skyColor="#c3dcf5" groundColor="#8c7f50" hemi={1.05} />
      <fog attach="fog" args={[hor, 240, 1900]} />
    </>
  );
};

const Stage: React.FC<{cam: Cam; children: React.ReactNode}> = ({cam, children}) => {
  const {width, height} = useVideoConfig();
  return (
    <AbsoluteFill style={{background: '#0e0b08'}}>
      <ThreeCanvas width={width} height={height} shadows camera={{fov: cam.fov, near: 0.1, far: 4000}}>
        <AssetProvider textures={TEXTURES} hdri="spruit_sunrise_1k">
          <CameraRig pos={cam.pos} target={cam.target} fov={cam.fov} />
          {children}
        </AssetProvider>
      </ThreeCanvas>
      <Grade strength={0.3} />
    </AbsoluteFill>
  );
};

const Pin: React.FC<{p: P3; cam: Cam; text: string; delay: number; dx?: number; dy?: number; size?: number; anchor?: 'left' | 'right' | 'center'}> = ({p, cam, text, delay, dx = 0, dy = 0, size = 50, anchor = 'center'}) => {
  const [x, y, vis] = toScreen(p, cam);
  if (!vis) return null;
  const w = text.length * size * 0.56 + size * 0.9;
  let lx = x + dx;
  const left = anchor === 'left' ? lx : anchor === 'right' ? lx - w : lx - w / 2;
  if (left < 36) lx += 36 - left;
  if (left + w > 1044) lx -= left + w - 1044;
  return <Tag text={text} x={lx} y={Math.min(1500, Math.max(420, y + dy))} delay={delay} size={size} anchor={anchor} />;
};

// ---- villagers
const PONCHOS = ['#a81f3d', '#c2185b', '#7a1f6b', '#b5341f', '#1f5f8a', '#8f2436'];
const CAPS = ['#b5341f', '#2b2a55', '#c2185b', '#1f6f5c', '#8f2436', '#5a2a6e'];
const villager = (i: number) => ({seed: 40 + i, poncho: PONCHOS[i % 6], pants: '#26222e', head: 'cloth' as const, headColor: CAPS[(i * 5 + 2) % 6], outfit: '#3a3546'});
const woman = (i: number) => ({seed: 60 + i, outfit: PONCHOS[(i + 1) % 6], pants: '#1d2a4a', head: 'hat' as const, headColor: '#3b2a26', poncho: PONCHOS[(i + 3) % 6]});
/** walking along the bridge deck (feet on the deck curve) */
const walkDeck = (x0: number, dir: number, f: number, sag: number, z = 0, speed = 1.25) => {
  const d = (speed * f) / 30;
  const x = x0 + dir * d;
  return {position: [x, floorY(x, sag) + CAB_R + 0.04, z] as P3, rotY: dir > 0 ? 0 : Math.PI, t: d * 4.2, pose: 'walk' as const};
};

const Llama: React.FC<{position: P3; rotY: number; t: number; wool?: string}> = ({position, rotY, t, wool = '#e6dcc9'}) => {
  const m = usePlainMat(wool, 0.95);
  const dark = usePlainMat('#3b2e26', 0.9);
  return (
    <group position={position} rotation={[0, rotY, 0]}>
      <mesh position={[0, 1.0, 0]} rotation={[0, 0, Math.PI / 2]} material={m} castShadow>
        <capsuleGeometry args={[0.27, 0.75, 6, 12]} />
      </mesh>
      <mesh position={[0.62, 1.42, 0]} rotation={[0, 0, -0.22]} material={m} castShadow>
        <capsuleGeometry args={[0.1, 0.62, 5, 10]} />
      </mesh>
      <mesh position={[0.84, 1.84, 0]} rotation={[0, 0, Math.PI / 2 - 0.15]} material={m} castShadow>
        <capsuleGeometry args={[0.085, 0.2, 5, 10]} />
      </mesh>
      {[-0.06, 0.06].map((z) => (
        <mesh key={z} position={[0.72, 1.98, z]} material={dark} castShadow>
          <coneGeometry args={[0.03, 0.15, 6]} />
        </mesh>
      ))}
      {([[0.45, 0.13, 0], [0.45, -0.13, Math.PI], [-0.45, 0.13, Math.PI], [-0.45, -0.13, 0]] as const).map(([x, z, ph], i) => (
        <group key={i} position={[x, 0.82, z]} rotation={[0, 0, Math.sin(t + ph) * 0.38]}>
          <mesh position={[0, -0.41, 0]} material={i % 2 ? dark : m} castShadow>
            <cylinderGeometry args={[0.055, 0.04, 0.82, 7]} />
          </mesh>
        </group>
      ))}
    </group>
  );
};

/** A tied bundle of cut q'oya. */
const Bundle: React.FC<{position: P3; rot?: [number, number, number]; len?: number; r?: number}> = ({position, rot = [0, 0, 0], len = 1.3, r = 0.2}) => {
  const m = useMat('straw', {tint: '#e6cc86', repeat: [1, 1.4]});
  const band = usePlainMat('#7a5a30', 0.9);
  const tuft = useMemo(() => bladeTuft(5, 14, 0.5), []);
  const tuftM = useMemo(() => new THREE.MeshStandardMaterial({vertexColors: true, roughness: 0.95, side: THREE.DoubleSide}), []);
  return (
    <group position={position} rotation={rot}>
      <mesh rotation={[0, 0, Math.PI / 2]} material={m} castShadow receiveShadow>
        <cylinderGeometry args={[r, r * 0.92, len, 12]} />
      </mesh>
      {[-1, 1].map((sd) => (
        <mesh key={sd} position={[sd * (len / 2 - 0.03), 0, 0]} rotation={[0, 0, -sd * Math.PI / 2]} geometry={tuft} material={tuftM} scale={1.2} />
      ))}
      <mesh rotation={[0, Math.PI / 2, 0]} material={band}>
        <torusGeometry args={[r * 1.02, 0.018, 6, 20]} />
      </mesh>
    </group>
  );
};

// ============================================================ S1 hook: last year's grey bridge
const S1: React.FC = () => {
  const f = useCurrentFrame();
  const L = LEN[0];
  const cam = groundSafe(camPath(f, [
    {t: 0, pos: [-9.5, 1.6, 26], target: [1.5, 12.5, 0], fov: 56},
    {t: L, pos: [-12, 12.5, 33], target: [-0.5, 12.4, 0], fov: 56},
  ]), gorgeH, 1.2);
  return (
    <>
      <Stage cam={cam}>
        <Atmos f={f} />
        <Gorge f={f} />
        <OldBridge />
        <Person {...walkDeck(-9.5, 1, f, SAG_OLD, 0.08)} {...villager(1)} />
        <Person {...walkDeck(-11.3, 1, f, SAG_OLD, -0.1)} {...woman(2)} />
      </Stage>
      <Headline top="Q'ESWACHAKA, PERU" big="28 M OF GRASS" sub="no steel, no nails" delay={4} y={150} bigSize={132} />
      <Caption text="Cut down every year" delay={Math.round(VO.durations[0] * FPS * 0.66)} bottom={330} />
    </>
  );
};

// ============================================================ S2 context: gorge, sag, four villages
const S2: React.FC = () => {
  const f = useCurrentFrame();
  const L = LEN[1];
  const c1 = Math.round(VO.durations[1] * FPS * 0.18) + VO_DELAY;
  const c2 = Math.round(VO.durations[1] * FPS * 0.37) + VO_DELAY;
  const wide = groundSafe(camPath(f, [
    {t: 0, pos: [46, 74, 170], target: [0, 26, -60], fov: 52},
    {t: c1, pos: [40, 66, 148], target: [0, 26, -60], fov: 52},
  ]), gorgeH, 6);
  const sag = groundSafe(camPath(f - c1, [
    {t: 0, pos: [-5, 12.8, 21], target: [1, 13.4, 0], fov: 52},
    {t: c2 - c1, pos: [-2.5, 12.2, 18.5], target: [0.5, 13.2, 0], fov: 52},
  ]), gorgeH, 1.5);
  const g = f - c2;
  const camV = groundSafe(camPath(g, [
    {t: 0, pos: [26.5, 18.2, 7.5], target: [27, 18.2, -16], fov: 50},
    {t: L - c2, pos: [25.5, 18, 5.5], target: [26, 18, -16], fov: 50},
  ]), gorgeH, 1.6);
  const walkers = Array.from({length: 9}, (_, i) => {
    const w = walkAlong([27.6 + i * 1.6 + (i % 2) * 0.55, 0, -13.6 - i * 1.6 + (i % 2) * 0.55], -2.356, g, 1.3, gorgeH);
    return {w, i};
  });
  return (
    <>
      <Sequence durationInFrames={c1} layout="none">
        <Stage cam={wide}>
          <Atmos f={f} shadow={260} target={[0, 10, -20]} />
          <Gorge f={f} />
          <OldBridge />
        </Stage>
        <Pin p={[riverX(90), 0, 90]} cam={wide} text="APURÍMAC RIVER" delay={3} dy={40} size={46} />
        <Pin p={[0, 16, 0]} cam={wide} text="THE BRIDGE" delay={10} dy={-70} size={46} />
      </Sequence>
      <Sequence from={c1} durationInFrames={c2 - c1} layout="none">
        <Stage cam={sag}>
          <Atmos f={f} />
          <Gorge f={f} />
          <OldBridge />
        </Stage>
        <Pin p={[0, floorY(0, SAG_OLD), 0]} cam={sag} text="SAGGING" delay={2} dy={150} size={58} />
        <Caption text="Grass sags within a year" delay={3} bottom={330} />
      </Sequence>
      <Sequence from={c2} layout="none">
        <Stage cam={camV}>
          <Atmos f={f} />
          <Gorge f={f} />
          {walkers.map(({w, i}) => (
            <React.Fragment key={i}>
              <Person {...w} pose="carry" legs="walk" {...(i % 3 === 2 ? woman(i) : villager(i))} />
              <Bundle position={[w.position[0], w.position[1] + 2.0, w.position[2]]} rot={[0, w.rotY, 0]} len={1.1} r={0.17} />
            </React.Fragment>
          ))}
        </Stage>
        <Headline top="EVERY JUNE" big="4 VILLAGES" sub="for 500+ years" delay={2} y={150} bigSize={140} />
      </Sequence>
    </>
  );
};

// ============================================================ S3 cord
const WX = -27, WZ = 7.5;
const wy = (x: number, z: number) => gorgeH(x, z);
const Y0 = wy(WX, WZ);

const coilGeo = lazy(() => ropeGeo((s) => {
  const a = s * Math.PI * 2 * 7;
  const r = 0.07 + 0.31 * s;
  return s > 0.9 ? [Math.cos(a) * r + (s - 0.9) * 0.2, 0.03 + 0.1 * (s - 0.9) * 2, Math.sin(a) * r] : [Math.cos(a) * r, 0.03 + (1 - s) * 0.06, Math.sin(a) * r];
}, 240, 0.019, 6, 0.1));

const S3: React.FC = () => {
  const f = useCurrentFrame();
  const L = LEN[2];
  const cam = groundSafe(camPath(f, [
    {t: 0, pos: [WX + 2.6, Y0 + 2.4, WZ + 6.2], target: [WX + 0.5, Y0 + 0.7, WZ - 0.1], fov: 46},
    {t: L * 0.5, pos: [WX + 0.6, Y0 + 2.0, WZ + 5.3], target: [WX + 0.2, Y0 + 0.6, WZ], fov: 44},
    {t: L, pos: [WX - 1.4, Y0 + 1.5, WZ + 3.7], target: [WX - 1.3, Y0 + 0.3, WZ + 0.6], fov: 42},
  ]), gorgeH, 0.6, 0.3);
  const strike = (Math.sin(f * 0.26) > 0.86);
  const wet = ramp(f, 36, 48);
  const cord = ramp(f, L * 0.45, L * 0.97, Easing.linear);
  const coil = coilGeo();
  coil.setDrawRange(0, Math.floor(240 * cord) * 36);
  const waterM = useMemo(() => new THREE.MeshStandardMaterial({color: '#d6f2fa', roughness: 0.15, transparent: true, opacity: 0.85, emissive: new THREE.Color('#5aa9c4'), emissiveIntensity: 0.5}), []);
  return (
    <>
      <Stage cam={cam}>
        <Atmos f={f} shadow={30} target={[WX, Y0, WZ]} />
        <Gorge f={f} huts={false} />
        {/* bundles of cut grass */}
        {[[1.9, -1.1, 0.4], [2.3, -0.5, 1.1], [1.5, -1.7, 2.0], [2.5, -1.45, 2.7]].map(([dx, dz, ry], i) => (
          <Bundle key={i} position={[WX + dx, Y0 + 0.2, WZ + dz]} rot={[0, ry, 0]} />
        ))}
        <Bundle position={[WX + 2.0, Y0 + 0.52, WZ - 1.1]} rot={[0, 1.3, 0]} />
        {/* pounding stone with soft grass on it */}
        <Boulder position={[WX + 0.95, Y0 + 0.12, WZ + 0.2]} scale={[0.72, 0.32, 0.62]} seed={8} />
        <Bundle position={[WX + 0.95, Y0 + 0.47 - (strike ? 0.03 : 0), WZ + 0.2]} rot={[0, 0.5, 0]} len={1.0} r={0.13} />
        <Person position={[WX + 0.2, Y0, WZ + 0.1]} rotY={0} pose="hammer" t={f * 0.13} tool="stone" legs="kneel" {...villager(3)} />
        {strike && <Dust at={[WX + 0.95, Y0 + 0.6, WZ + 0.2]} f={f} period={14} color="#d9c98e" size={0.12} />}
        {/* water poured on the grass */}
        <Person position={[WX + 0.95, Y0, WZ - 1.05]} rotY={-Math.PI / 2 + 0.05} pose="point" {...villager(4)} />
        <mesh position={[WX + 1.2, Y0 + 1.4, WZ - 0.47]} rotation={[-0.9, 0, 0]} material={usePlainMat('#8a4a2c', 0.75)} castShadow>
          <sphereGeometry args={[0.15, 14, 10]} />
        </mesh>
        {wet > 0 && (
          <mesh position={[WX + 1.075, Y0 + 0.97, WZ - 0.135]} rotation={[-0.67, 0, -0.24]} material={waterM} scale={[1, wet, 1]}>
            <cylinderGeometry args={[0.03, 0.045, 1.1, 8]} />
          </mesh>
        )}
        {/* twisting cord */}
        <Person position={[WX - 1.55, Y0, WZ + 0.2]} rotY={-0.3} pose="twist" t={f * 0.45} legs="sit" {...woman(1)} />
        <Person position={[WX - 2.5, Y0, WZ - 1.3]} rotY={0.5} pose="twist" t={f * 0.41 + 1} legs="sit" {...woman(2)} />
        <group position={[WX - 1.15, Y0 + 0.03, WZ + 1.25]}><RopeMesh geometry={coil} tint="#f7e6b0" /></group>
        {cord > 0.01 && <Rope a={[WX - 0.94, Y0 + 0.78, WZ + 0.38]} b={[WX - 1.15 + Math.cos(cord * 44) * (0.07 + 0.31 * cord), Y0 + 0.1, WZ + 1.25 + Math.sin(cord * 44) * (0.07 + 0.31 * cord)]} sag={0.05} r={0.016} color="#e6cc86" />}
      </Stage>
      <StepBadge n={1} title="THE CORD" delay={2} />
      <Pin p={[WX + 2.1, Y0 + 0.5, WZ - 1.1]} cam={cam} text="Q'OYA GRASS" delay={Math.round(L * 0.18)} dy={-130} size={46} />
      <Pin p={[WX + 0.95, Y0 + 0.5, WZ + 0.2]} cam={cam} text="HAMMERED + WET" delay={Math.round(L * 0.34)} dy={-250} size={46} />
      <Pin p={[WX - 1.15, Y0 + 0.1, WZ + 1.25]} cam={cam} text="THIN CORD" delay={Math.round(L * 0.68)} dy={120} size={50} />
    </>
  );
};

// ============================================================ S4 rope, cable, stretching
/** n strands spreading from a bundle at s=1 end: x from -len..0 fan, 0..len twisted */
const fanGeo = (n: number, spread: number, bundleR: number, len: number, r: number, turns: number, seed: number, seg = 44, radial = 5) => {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2 + rnd(i + seed) * 0.5;
    const ring = n > 6 ? 0.45 + 0.55 * Math.sqrt(rnd(i * 3.3 + seed)) : 1;
    parts.push(ropeGeo((s) => {
      const x = -len + 2 * len * s;
      const k = smooth(0.08, 0.55, s);
      const R = (spread * (1 - k) + bundleR * k) * ring;
      const a = a0 + turns * Math.PI * 2 * smooth(0.3, 1, s) * s;
      return [x, Math.sin(a) * R, Math.cos(a) * R];
    }, seg, r, radial, n > 6 ? 0.1 : undefined));
  }
  return mergeGeometries(parts)!;
};
const cordFan = lazy(() => fanGeo(30, 0.42, 0.05, 1.7, 0.0125, 2.1, 3));
const ropeFan = lazy(() => fanGeo(3, 0.3, 0.055, 1.9, 0.052, 1.7, 7, 80, 9));
const haulCable = lazy(() => {
  const x = -26;
  return ropeGeo((s) => {
    const z = -24 + 44 * s;
    return [x + 0.02, gorgeH(x, z) + 0.98, z];
  }, 60, CAB_R, 9);
});
const CX = -30, CZ = 1.5;
const CY = gorgeH(CX, CZ) + 0.82;

const Trestle: React.FC<{position: P3}> = ({position}) => (
  <group position={position}>
    {[-0.3, 0.3].map((z) => (
      <Beam key={z} a={[-0.32, -0.82, z]} b={[0.32, 0.0, -z * 0.15]} r={0.03} />
    ))}
    {[-0.3, 0.3].map((z) => (
      <Beam key={z} a={[0.32, -0.82, z]} b={[-0.32, 0.0, -z * 0.15]} r={0.03} />
    ))}
  </group>
);

const S4: React.FC = () => {
  const f = useCurrentFrame();
  const L = LEN[3];
  const c1 = Math.round(VO.durations[3] * FPS * 0.31) + VO_DELAY;
  const c2 = Math.round(VO.durations[3] * FPS * 0.72) + VO_DELAY;
  const A = camPath(f, [
    {t: 0, pos: [CX + 2.0, CY + 0.62, CZ + 1.75], target: [CX - 0.2, CY + 0.02, CZ], fov: 44},
    {t: c1, pos: [CX + 2.35, CY + 0.42, CZ + 1.35], target: [CX + 0.1, CY, CZ], fov: 44},
  ]);
  const B = camPath(f - c1, [
    {t: 0, pos: [CX + 3.1, CY + 0.5, CZ + 2.1], target: [CX + 0.7, CY + 0.42, CZ - 0.1], fov: 46},
    {t: c2 - c1, pos: [CX + 3.5, CY + 0.42, CZ + 1.7], target: [CX + 1.2, CY + 0.42, CZ - 0.1], fov: 46},
  ]);
  const camC = groundSafe(camPath(f - c2, [
    {t: 0, pos: [-22.5, 17.6, 20.5], target: [-26.5, 16.4, 2], fov: 50},
    {t: L - c2, pos: [-21.5, 18.4, 18.5], target: [-26.5, 16.4, 0], fov: 50},
  ]), gorgeH, 1.5);
  const cableEnd = useMemo(() => ropeGeo(line([CX + 1.86, CY, CZ], [CX + 7, CY, CZ]), 12, CAB_R, 12), []);
  const ropeEnd = useMemo(() => ropeGeo(line([CX + 1.7, CY, CZ], [CX + 7, CY, CZ]), 12, 0.07, 12), []);
  const haulers = Array.from({length: 12}, (_, i) => {
    const z = -19 + i * 3.1;
    const sd = i % 2 ? 1 : -1;
    const x = -26 + sd * 0.4;
    return {pos: [x, gorgeH(x, z), z] as P3, i};
  });
  return (
    <>
      <Sequence durationInFrames={c1} layout="none">
        <Stage cam={A}>
          <Atmos f={f} shadow={16} target={[CX, CY, CZ]} />
          <Gorge f={f} huts={false} />
          <group position={[CX, CY, CZ]} rotation={[f * 0.05, 0, 0]}>
            <RopeMesh geometry={cordFan()} tint="#f7e6b0" />
          </group>
          <RopeMesh geometry={ropeEnd} />
          <Trestle position={[CX + 2.4, CY - 0.05, CZ]} />
          <Bundle position={[CX - 2.2, CY - 0.18, CZ]} r={0.46} len={1.3} />
        </Stage>
        <StepBadge n={2} title="BUILD IT UP" delay={2} />
        <Pin p={[CX - 0.95, CY + 0.3, CZ]} cam={A} text="30 CORDS" delay={10} dy={-140} size={60} />
        <Pin p={[CX + 0.9, CY, CZ]} cam={A} text="1 ROPE" delay={Math.round(c1 * 0.55)} dy={210} size={60} />
      </Sequence>
      <Sequence from={c1} durationInFrames={c2 - c1} layout="none">
        <Stage cam={B}>
          <Atmos f={f} shadow={16} target={[CX, CY, CZ]} />
          <Gorge f={f} huts={false} />
          <group position={[CX, CY, CZ]} rotation={[(f - c1) * 0.05, 0, 0]}>
            <RopeMesh geometry={ropeFan()} />
          </group>
          <RopeMesh geometry={cableEnd} />
          <Trestle position={[CX + 3.2, CY - 0.09, CZ]} />
          <Person position={[CX + 1.05, CY - 0.82, CZ - 0.34]} rotY={0.5} pose="stand" {...villager(5)} />
        </Stage>
        <StepBadge n={2} title="BUILD IT UP" delay={0} />
        <Pin p={[CX - 0.7, CY + 0.2, CZ]} cam={B} text="3 ROPES" delay={4} dy={-120} size={60} />
        <Pin p={[CX + 1.7, CY, CZ]} cam={B} text="1 CABLE" delay={Math.round((c2 - c1) * 0.3)} dy={-125} dx={-200} size={60} />
        <Caption text="As thick as a person's thigh" delay={Math.round((c2 - c1) * 0.5)} bottom={330} />
      </Sequence>
      <Sequence from={c2} layout="none">
        <Stage cam={camC}>
          <Atmos f={f} shadow={50} target={[-26, 16, 0]} />
          <Gorge f={f} huts={false} />
          <RopeMesh geometry={haulCable()} />
          {haulers.map(({pos, i}) => (
            <Person key={i} position={pos} rotY={-Math.PI / 2 + (i % 2 ? 0.14 : -0.14)} pose="pull" t={(f - c2) * 0.14 + i * 0.25} {...villager(i + 6)} />
          ))}
        </Stage>
        <StepBadge n={2} title="STRETCH IT" delay={0} />
      </Sequence>
    </>
  );
};

// ============================================================ S5 cables across, tie, cut
const carried = lazy(() => ropeGeo((s) => {
  const x = -TAIL + (TAIL + SPAN) * s;
  return [x, floorY(x, SAG_OLD) + CAB_R + 1.53, 0.27];
}, 120, CAB_R, 9));

const S5: React.FC = () => {
  const f = useCurrentFrame();
  const L = LEN[4];
  const c1 = Math.round(VO.durations[4] * FPS * 0.33) + VO_DELAY;
  const c2 = Math.round(VO.durations[4] * FPS * 0.665) + VO_DELAY;
  const camA = groundSafe(camPath(f, [
    {t: 0, pos: [-15.2, 18.2, 3.1], target: [-2.5, 14, -0.6], fov: 50},
    {t: c1, pos: [-11, 17.8, 3.1], target: [0.5, 14, -0.6], fov: 50},
  ]), gorgeH, 1.0, 0.4);
  const camB = groundSafe(camPath(f - c1, [
    {t: 0, pos: [-13.6, 18.4, 3.9], target: [-18.2, 15.9, -0.1], fov: 48},
    {t: c2 - c1, pos: [-13.1, 19.1, 4.4], target: [-17.6, 15.9, -0.1], fov: 48},
  ]), gorgeH, 1.0, 0.4);
  const g = f - c2;
  const camC = groundSafe(camPath(g, [
    {t: 0, pos: [3, 9, 41], target: [2, 12.5, 0], fov: 50},
    {t: L - c2, pos: [1, 7, 37], target: [0, 10.5, 0], fov: 50},
  ]), gorgeH, 1.2);
  const crew = [0, 1, 2, 3, 4, 5];
  const headX = -8.2 + (1.3 * f) / 30;
  const cab = carried();
  cab.setDrawRange(0, Math.floor(((headX + 0.2 + TAIL) / (TAIL + SPAN)) * 120) * 54);
  const cutAt = 26;
  const leftAt = 62;
  const cutR = ramp(g, cutAt, cutAt + 26, Easing.linear);
  const cutL = ramp(g, leftAt, leftAt + 26, Easing.linear);
  const drift = Math.max(0, g - cutAt - 26) * 0.14;
  const hitR = g - (cutAt + 26);
  const hitL = g - (leftAt + 26);
  return (
    <>
      <Sequence durationInFrames={c1} layout="none">
        <Stage cam={camA}>
          <Atmos f={f} shadow={36} target={[-6, 13, 0]} />
          <Gorge f={f} huts={false} />
          <OldBridge />
          <RopeMesh geometry={cab} />
          {crew.map((i) => {
            const w = walkDeck(-8.2 - i * 1.75, 1, f, SAG_OLD, 0.03);
            return <Person key={i} {...w} pose="carry" legs="walk" {...villager(i + 2)} />;
          })}
          {[0, 1].map((i) => (
            <Person key={i} position={[-20.4 - i * 1.4, gorgeH(-20.4, 0.6 + i * 1.2), 0.6 + i * 1.2]} rotY={0} pose="pull" t={f * 0.15 + i} {...villager(i + 9)} />
          ))}
        </Stage>
        <StepBadge n={3} title="OVER THE OLD BRIDGE" delay={2} />
        <Pin p={[-1, floorY(-1, SAG_OLD) + 1.7, 0]} cam={camA} text="NEW CABLE" delay={Math.round(c1 * 0.4)} dy={-70} size={46} />
      </Sequence>
      <Sequence from={c1} durationInFrames={c2 - c1} layout="none">
        <Stage cam={camB}>
          <Atmos f={f} shadow={24} target={[-16, 15, 0]} />
          <Gorge f={f} huts={false} loops />
          <OldBridge />
          <NewBridge lash={0} deck={0} />
          <Person position={[-19.35, gorgeH(-19.35, 0.85), 0.85]} rotY={0} pose="twist" t={(f - c1) * 0.4} legs="kneel" {...villager(3)} />
          <Person position={[-19.35, gorgeH(-19.35, -0.7), -0.7]} rotY={0} pose="twist" t={(f - c1) * 0.4 + 2} legs="kneel" {...villager(4)} />
        </Stage>
        <StepBadge n={3} title="TIE THE CABLES" delay={0} />
        <Tag text="4 FLOOR CABLES" x={600} y={1290} delay={2} size={50} anchor="center" />
        <Tag text="2 HANDRAILS" x={800} y={800} delay={Math.round((c2 - c1) * 0.28)} size={50} anchor="center" />
        <Tag text="STONE ANCHOR" x={300} y={1150} delay={Math.round((c2 - c1) * 0.55)} size={50} anchor="center" />
      </Sequence>
      <Sequence from={c2} layout="none">
        <Stage cam={camC}>
          <Atmos f={f} shadow={60} target={[0, 8, 0]} />
          <Gorge f={f} huts={false} />
          <OldBridge cutR={cutR} cutL={cutL} drift={drift} />
          <NewBridge lash={0} deck={0} />
          <Person position={[14.9, DECK_Y - 0.1, -1.35]} rotY={Math.PI - 0.5} pose="hammer" t={g * 0.16} {...villager(8)} />
          <Person position={[-14.9, DECK_Y - 0.1, 1.35]} rotY={-0.5} pose="hammer" t={g * 0.16 + 1} {...villager(9)} />
          {hitR > 0 && hitR < 50 && <Dust at={[6.5, -0.5, 0]} f={hitR} period={50} count={14} size={2.1} color="#f2f6f4" />}
          {hitL > 0 && <Dust at={[-5.5, -0.5, 0.5]} f={hitL} period={50} count={14} size={2.1} color="#f2f6f4" />}
        </Stage>
        <Tag text="CUT LOOSE!" x={540} y={290} delay={cutAt - 8} size={84} anchor="center" bg="#E0352B" fg="#fff" />
      </Sequence>
    </>
  );
};

// ============================================================ S6 weaving
const S6: React.FC = () => {
  const f = useCurrentFrame();
  const L = LEN[5];
  const meet = Math.round(L * 0.62);
  const raw = ramp(f, 4, meet, Easing.linear);
  const steps = 16;
  const lash = (Math.floor(raw * steps) + ramp((raw * steps) % 1, 0.55, 1)) / steps;
  const deck = ramp(f, meet + 14, L - 8, Easing.inOut(Easing.quad));
  const dx = lash * (SPAN - 0.75);
  const xL = -SPAN + 0.3 + dx, xR = SPAN - 0.3 - dx;
  const yK = (x: number) => floorY(x, SAG_NEW) + CAB_R;
  const k = f / L;
  const cam = groundSafe({
    pos: [-15.4 + 8.4 * k, 18.8 + 2.7 * k, 4.8 + 12.7 * k],
    target: [Math.min(-0.2, xL + 2.6 + 1.2 * deck), 14.6 - 1.4 * k, 0],
    fov: 50 - 4 * k,
  } as Cam, gorgeH, 1.2, 0.5);
  const dk = (SPAN - 0.2) * deck;
  return (
    <>
      <Stage cam={cam}>
        <Atmos f={f} shadow={36} target={[0, 12, 0]} />
        <Gorge f={f} huts={false} />
        <NewBridge lash={lash} deck={deck} />
        <Person position={[xL, yK(xL), 0.05]} rotY={0} pose="twist" t={f * 0.5} legs="kneel" {...villager(7)} />
        <Person position={[xR, yK(xR), -0.05]} rotY={Math.PI} pose="twist" t={f * 0.5 + 1} legs="kneel" {...villager(10)} />
        {deck > 0 && deck < 0.985 && (
          <>
            <Person {...walkDeck(-SPAN + 0.1, 1, 0, SAG_NEW)} position={[-SPAN + dk - 0.9, floorY(-SPAN + dk - 0.9, SAG_NEW) + CAB_R + 0.06, 0.05]} pose="walk" legs="walk" t={dk * 4.2} {...villager(2)} />
            <Person {...walkDeck(SPAN - 0.1, -1, 0, SAG_NEW)} position={[SPAN - dk + 0.9, floorY(SPAN - dk + 0.9, SAG_NEW) + CAB_R + 0.06, -0.05]} pose="walk" legs="walk" t={dk * 4.2} {...villager(11)} />
          </>
        )}
      </Stage>
      <StepBadge n={4} title="WEAVE THE SIDES" delay={2} />
      {f < meet * 0.72 && <Pin p={[xL, yK(xL) + 1.2, 0]} cam={cam} text="MASTER WEAVER" delay={Math.round(L * 0.1)} dy={-90} size={44} />}
      {f < meet * 0.72 && <Pin p={[xR, yK(xR) + 1.1, 0]} cam={cam} text="MASTER WEAVER" delay={Math.round(L * 0.22)} dy={-70} size={44} />}
      {f >= meet * 0.72 && <Pin p={[(xL + xR) / 2, yK(0) + 1.2, 0]} cam={cam} text="MEET IN THE MIDDLE" delay={Math.round(meet * 0.72)} dy={-110} size={46} />}
      {f >= meet && <Caption text="Then mats of branches become the deck" delay={meet + 4} bottom={330} />}
      {f < meet && f > L * 0.26 && <Caption text="Working in from both ends" delay={Math.round(L * 0.26)} bottom={330} />}
    </>
  );
};

// ============================================================ S7 why it holds
const sectionTex = lazy(() => {
  const c = document.createElement('canvas');
  c.width = c.height = 1024;
  const x = c.getContext('2d')!;
  x.fillStyle = '#3f2c12';
  x.beginPath();
  x.arc(512, 512, 512, 0, Math.PI * 2);
  x.fill();
  [0, 1, 2].forEach((k) => {
    const a = (k / 3) * Math.PI * 2 - Math.PI / 2;
    const cx = 512 + Math.cos(a) * 248, cy = 512 + Math.sin(a) * 248;
    x.fillStyle = '#5c431c';
    x.beginPath();
    x.arc(cx, cy, 236, 0, Math.PI * 2);
    x.fill();
    let n = 0;
    for (const [cnt, rr] of [[1, 0], [6, 66], [10, 128], [13, 190]] as const) {
      for (let i = 0; i < cnt; i++) {
        const b = (i / cnt) * Math.PI * 2 + k + rr * 0.01;
        const px = cx + Math.cos(b) * rr, py = cy + Math.sin(b) * rr;
        x.fillStyle = n % 2 ? '#f0cf7c' : '#e6bf62';
        x.beginPath();
        x.arc(px, py, 29, 0, Math.PI * 2);
        x.fill();
        x.fillStyle = '#ffe9ad';
        x.beginPath();
        x.arc(px - 6, py - 6, 12, 0, Math.PI * 2);
        x.fill();
        n++;
      }
    }
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
});

const SEC_X = 3;
const S7: React.FC = () => {
  const f = useCurrentFrame();
  const L = LEN[6];
  const cut = Math.round(VO.durations[6] * FPS * 0.62) + VO_DELAY;
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(-1, 0, 0), SEC_X), []);
  const clip = useMemo(() => [plane], [plane]);
  const y = floorY(SEC_X, SAG_NEW);
  const secCam = camPath(f, [
    {t: 0, pos: [SEC_X + 0.76, y - 0.015, 0.13], target: [SEC_X, y - 0.015, 0.13], fov: 26},
    {t: cut * 0.3, pos: [SEC_X + 0.76, y - 0.015, 0.13], target: [SEC_X, y - 0.015, 0.13], fov: 26},
    {t: cut * 0.72, pos: [SEC_X + 2.7, y + 0.75, 0.4], target: [SEC_X - 0.5, y + 0.25, 0], fov: 38},
    {t: cut, pos: [SEC_X + 3.0, y + 0.85, 0.5], target: [SEC_X - 0.5, y + 0.3, 0], fov: 38},
  ]);
  const camB = groundSafe(camPath(f - cut, [
    {t: 0, pos: [-13, 6, 27], target: [1.5, 14.4, 0], fov: 48},
    {t: L - cut, pos: [-8, 5, 25], target: [1, 14.8, 0], fov: 48},
  ]), gorgeH, 1.2);
  const capM = useMemo(() => new THREE.MeshStandardMaterial({map: sectionTex(), roughness: 0.8, emissive: new THREE.Color('#3a2a0c'), emissiveIntensity: 0.3}), []);
  const g = f - cut;
  const crowd = Array.from({length: 18}, (_, i) => {
    const sp = i * 1.35 + rnd(i) * 0.5;
    return {w: walkDeck(-13.5 + sp, 1, g + 24, SAG_NEW, (i % 2 ? 0.13 : -0.13) + (rnd(i * 3) - 0.5) * 0.1, 1.1), i};
  });
  return (
    <>
      <Sequence durationInFrames={cut} layout="none">
        <Stage cam={secCam}>
          <Atmos f={f} shadow={12} target={[SEC_X, y, 0]} />
          <Gorge f={f} huts={false} />
          <NewBridge clip={clip} />
          {FLOOR_Z.map((z) => (
            <mesh key={z} position={[SEC_X, y, z]} rotation={[0, Math.PI / 2, 0]} material={capM}>
              <circleGeometry args={[CAB_R, 40]} />
            </mesh>
          ))}
          {[-RAIL_Z, RAIL_Z].map((z) => (
            <mesh key={z} position={[SEC_X, y + 1.05, z]} rotation={[0, Math.PI / 2, 0]} material={capM}>
              <circleGeometry args={[RAIL_R, 32]} />
            </mesh>
          ))}
        </Stage>
        <Sequence durationInFrames={Math.round(cut * 0.58)} layout="none">
          <Headline top="WHY DOESN'T IT SNAP?" big="" delay={2} y={150} bigSize={10} />
        </Sequence>
        <Sequence durationInFrames={Math.round(cut * 0.42)} layout="none">
          <Tag text="1 CABLE = 90 CORDS" x={540} y={1500} delay={Math.round(cut * 0.1)} size={68} anchor="center" />
        </Sequence>
        <Sequence from={Math.round(cut * 0.6)} layout="none">
          <Headline top="4 FLOOR CABLES" big="360 CORDS" delay={0} y={150} bigSize={150} />
          <Pin p={[SEC_X, y, 0]} cam={secCam} text="4 × 90" delay={Math.round(cut * 0.1)} dy={190} size={64} />
        </Sequence>
      </Sequence>
      <Sequence from={cut} layout="none">
        <Stage cam={camB}>
          <Atmos f={f} />
          <Gorge f={f} huts={false} />
          <NewBridge />
          {crowd.map(({w, i}) => <Person key={i} {...w} {...(i % 3 === 1 ? woman(i) : villager(i))} />)}
        </Stage>
        <Headline top="ENOUGH TO CARRY" big="DOZENS" sub="of people at a time" delay={1} y={150} bigSize={150} />
      </Sequence>
    </>
  );
};

// ============================================================ S8 payoff
const S8: React.FC = () => {
  const f = useCurrentFrame();
  const L = LEN[7];
  const cam = groundSafe(camPath(f, [
    {t: 0, pos: [-5, 9, 29], target: [1, 15, 0], fov: 54},
    {t: L, pos: [-16, 15, 37], target: [2, 16.5, 0], fov: 50},
  ]), gorgeH, 2);
  const lm = walkDeck(-11, 1, f, SAG_NEW, 0, 1.15);
  return (
    <>
      <Stage cam={cam}>
        <Atmos f={f} golden={1} shadow={120} />
        <Gorge f={f} />
        <NewBridge />
        <Person {...walkDeck(-9.2, 1, f, SAG_NEW, 0.05, 1.15)} {...villager(3)} />
        <Llama position={lm.position} rotY={0} t={lm.t} />
        <Llama position={[lm.position[0] - 2.1, floorY(lm.position[0] - 2.1, SAG_NEW) + CAB_R + 0.04, 0]} rotY={0} t={lm.t + 1.2} wool="#8a6a4c" />
        <Person {...walkDeck(-14.1, 1, f, SAG_NEW, -0.05, 1.15)} {...woman(1)} />
        <Person {...walkDeck(7.5, -1, f, SAG_NEW, 0.12, 1.2)} {...villager(6)} />
      </Stage>
      <Headline top="NEW BRIDGE IN" big="3 DAYS" delay={4} y={150} bigSize={170} />
      <Caption text="Next June, they do it all again" delay={Math.round(VO.durations[7] * FPS * 0.46)} bottom={330} />
    </>
  );
};

// ============================================================ timeline
const SCENES = [S1, S2, S3, S4, S5, S6, S7, S8];

export const Qeswachaka: React.FC = () => (
  <AbsoluteFill style={{background: '#0e0b08'}}>
    {SCENES.map((S, i) => (
      <Sequence key={i} from={START[i]} durationInFrames={LEN[i]}>
        <SceneFade dur={LEN[i]} inF={i === 0 ? 0 : 5} outF={i === SCENES.length - 1 ? 0 : 4}>
          <S />
        </SceneFade>
      </Sequence>
    ))}
    {VO.durations.map((_, i) => (
      <Sequence key={i} from={START[i] + VO_DELAY} layout="none">
        <Audio src={staticFile(`vo/ep010-qeswachaka_${i}.wav`)} />
      </Sequence>
    ))}
    <Watermark />
  </AbsoluteFill>
);

export const QESWACHAKA_START = START;
export const QESWACHAKA_LEN = LEN;
