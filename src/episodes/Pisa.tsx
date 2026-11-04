// Episode 12: Leaning Tower of Pisa: why it leans and how engineers stopped it.
import React, {useMemo} from 'react';
import {AbsoluteFill, Audio, interpolate, Sequence, staticFile, useCurrentFrame, useVideoConfig, Easing} from 'remotion';
import {ThreeCanvas} from '@remotion/three';
import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import VO from './ep012-pisa-vo.json';
import {AssetProvider, Renderer, SkyDome, Sun, TexName, useMat, usePlainMat, uvBox, worldUV} from '../hib/pbr';
import {Beam, Cypress, Dust, KIT_TEXTURES, Person, Rock, Rope, Terrain, Tree, rnd, walkAlong} from '../hib/models';
import {CameraRig} from '../hib/three';
import {Cam, camPath, groundSafe, toScreen} from '../hib/project';
import {C, Caption, Grade, Headline, SceneFade, StepBadge, Tag, Watermark} from '../hib/ui';

// ============================================================ timing
const FPS = 30;
const VO_DELAY = 5;
const sceneLen = (i: number, tail: number) => Math.ceil((VO.durations[i] + tail) * FPS) + VO_DELAY;
const LEN = [sceneLen(0, 0.4), sceneLen(1, 0.45), sceneLen(2, 0.45), sceneLen(3, 0.45), sceneLen(4, 0.45), sceneLen(5, 0.45), sceneLen(6, 0.45), sceneLen(7, 1.6)];
const START = LEN.map((_, i) => LEN.slice(0, i).reduce((a, b) => a + b, 0));
export const PISA_DURATION = LEN.reduce((a, b) => a + b, 0);

const cl = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
const ramp = (f: number, a: number, b: number, ease = Easing.inOut(Easing.cubic)) => interpolate(f, [a, b], [0, 1], {...cl, easing: ease});
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const TEXTURES: TexName[] = [...KIT_TEXTURES, 'grass', 'marble_ashlar', 'clay_blue', 'silt_tan', 'rubble_core', 'rubble_wall', 'plaster_ochre', 'plaster_white', 'roof_tiles', 'concrete', 'steel', 'steel_painted_red', 'iron_dark', 'limestone_ashlar', 'stone_face_lime', 'dirt'];

// Lean story (degrees), one source of truth for continuity between scenes.
const LEAN_1178 = 2.0; // visibly started
const LEAN_1372 = 3.6;
const LEAN_1990 = 5.5;
const LEAN_NOW = 5.0; // 1990 minus the ~half a degree won back
const SECTION_Z = 9;

// ============================================================ ground
const campoH = (x: number, z: number) => {
  const far = smooth(-640, -1120, z);
  return far * (62 + 34 * Math.sin(x / 150 + 1) + 22 * Math.sin(x / 61 + z / 90) + 11 * Math.sin(x / 23 + z / 37));
};
/** Section scenes: no ground in front of the cut plane. */
const secH = (x: number, z: number) => (z > SECTION_Z + 0.5 ? -200 : campoH(x, z));

// ============================================================ geometry helpers
const flat = (g: THREE.BufferGeometry) => {
  const n = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(n.attributes)) if (!['position', 'normal', 'uv'].includes(k)) n.deleteAttribute(k);
  return n;
};
const merge = (gs: THREE.BufferGeometry[]) => mergeGeometries(gs.map(flat), false)!;

/** Closed revolved profile with UVs in metres / texScale. */
const lathe = (pts: [number, number][], texScale = 3, seg = 72) => {
  const v = pts.map(([r, y]) => new THREE.Vector2(r, y));
  const g = new THREE.LatheGeometry(v, seg);
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  const rm = Math.max(...pts.map((p) => p[0]));
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * Math.PI * 2 * rm) / texScale, (uv.getY(i) * L) / texScale);
  return g;
};

const roundArchPath = (p: THREE.Path, cx: number, w: number, y0: number, spring: number) => {
  p.moveTo(cx - w / 2, y0);
  p.lineTo(cx + w / 2, y0);
  p.lineTo(cx + w / 2, spring);
  p.absarc(cx, spring, w / 2, 0, Math.PI, false);
  p.lineTo(cx - w / 2, y0);
};

/** Flat panel with n round-arched openings; x is along the panel, y up, z thickness. */
const arcadePanel = (W: number, H: number, n: number, w: number, y0: number, spring: number, thick: number, texScale = 3, steps = 4) => {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  for (let i = 1; i <= n * steps; i++) s.lineTo((W * i) / (n * steps), 0);
  s.lineTo(W, H);
  for (let i = n * steps - 1; i >= 0; i--) s.lineTo((W * i) / (n * steps), H);
  s.closePath();
  for (let i = 0; i < n; i++) {
    const h = new THREE.Path();
    roundArchPath(h, ((i + 0.5) * W) / n, w, y0, spring);
    s.holes.push(h);
  }
  const g = new THREE.ExtrudeGeometry(s, {depth: thick, bevelEnabled: false, curveSegments: 7});
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / texScale, uv.getY(i) / texScale);
  return g;
};

/** Bend a flat arcade panel into a cylindrical band of inner radius R. */
const bend = (g: THREE.BufferGeometry, R: number) => {
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const nr = g.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const a = p.getX(i) / R, y = p.getY(i), r = R + p.getZ(i);
    const nx = nr.getX(i), ny = nr.getY(i), nz = nr.getZ(i);
    const s = Math.sin(a), c = Math.cos(a);
    p.setXYZ(i, r * s, y, r * c);
    nr.setXYZ(i, nx * c + nz * s, ny, -nx * s + nz * c);
  }
  return g;
};

const arcadeRing = (R: number, H: number, n: number, w: number, y0: number, spring: number, thick: number, texScale = 3) =>
  bend(arcadePanel(Math.PI * 2 * R, H, n, w, y0, spring, thick, texScale), R);

const columnRing = (R: number, n: number, r: number, y0: number, h: number, phase = 0) => {
  const out: THREE.BufferGeometry[] = [];
  for (let i = 0; i < n; i++) {
    const a = ((i + phase) / n) * Math.PI * 2;
    const x = Math.sin(a) * R, z = Math.cos(a) * R;
    const shaft = new THREE.CylinderGeometry(r * 0.9, r, h, 10, 1, true);
    shaft.translate(x, y0 + h / 2, z);
    const cap = new THREE.CylinderGeometry(r * 1.55, r * 0.95, 0.34, 10);
    cap.translate(x, y0 + h + 0.15, z);
    const base = new THREE.CylinderGeometry(r * 1.3, r * 1.45, 0.24, 10);
    base.translate(x, y0 + 0.12, z);
    out.push(shaft, cap, base);
  }
  return merge(out);
};

const cornice = (r0: number, r1: number, y0: number, y1: number) =>
  lathe([[r0, y0], [r1 - 0.3, y0], [r1, y0 + 0.14], [r1, y1 - 0.12], [r1 - 0.14, y1], [r0, y1], [r0, y0]]);

// ============================================================ the tower
type Level = {h: number; kind: 'ground' | 'gallery' | 'bell'};
const LEVELS: Level[] = [
  {h: 11, kind: 'ground'},
  ...Array.from({length: 6}, () => ({h: 6.7, kind: 'gallery' as const})),
  {h: 5, kind: 'bell'},
];
const TOP = LEVELS.reduce((a, l) => a + l.h, 0);
const LEVEL_Y = LEVELS.map((_, i) => LEVELS.slice(0, i).reduce((a, l) => a + l.h, 0));
const S_2ND = LEVEL_Y[3]; // top of the second gallery: where the first campaign stopped
// Cumulative correction per storey (degrees): floors built after 1272 lean back toward vertical.
const CURVE = [0, 0, 0, 0.7, 1.5, 2.4, 3.0, 3.5];
const DEG = Math.PI / 180;
const R_OUT = 7.74;

const tiltOf = (i: number, lean: number, curve: number) => (lean - curve * CURVE[i]) * DEG;
type Pose3 = {p: [number, number, number]; up: [number, number, number]; tilt: number};
/** Point on the tower axis at distance s from the base. */
const axisAt = (s: number, lean: number, curve: number, sink = 0): Pose3 => {
  let x = 0, y = -sink, acc = 0;
  for (let i = 0; i < LEVELS.length; i++) {
    const t = tiltOf(i, lean, curve);
    const d = Math.min(LEVELS[i].h, Math.max(0, s - acc));
    x += Math.sin(t) * d;
    y += Math.cos(t) * d;
    acc += LEVELS[i].h;
    if (s <= acc || i === LEVELS.length - 1) return {p: [x, y, 0], up: [Math.sin(t), Math.cos(t), 0], tilt: t};
  }
  return {p: [x, y, 0], up: [0, 1, 0], tilt: 0};
};
/** Surface point of the tower at height s, angle (0=+Z front, PI/2=+X south). */
const surf = (s: number, a: number, lean: number, curve: number, r = R_OUT, sink = 0): [number, number, number] => {
  const q = axisAt(s, lean, curve, sink);
  const rx = Math.sin(a) * r;
  return [q.p[0] + Math.cos(q.tilt) * rx, q.p[1] - Math.sin(q.tilt) * rx, Math.cos(a) * r];
};

const levelGeos = () =>
  LEVELS.map((l) => {
    const marble: THREE.BufferGeometry[] = [];
    const core: THREE.BufferGeometry[] = [];
    if (l.kind === 'ground') {
      core.push(lathe([[6.95, -4], [6.95, l.h]]));
      marble.push(lathe([[8.4, -4], [8.4, 0.5], [8.05, 0.75], [7.75, 0.95], [6.9, 0.95]], 3));
      marble.push(arcadeRing(7.15, l.h - 0.9, 15, 2.25, 0, 7.4, 0.42));
      marble[marble.length - 1].translate(0, 0.9, 0);
      marble.push(columnRing(7.55, 15, 0.36, 0.95, 8.0, 0));
      marble.push(cornice(5.0, 7.86, l.h - 0.1, l.h + 0.3));
    } else if (l.kind === 'gallery') {
      core.push(lathe([[5.5, 0], [5.5, l.h]]));
      marble.push(arcadeRing(5.55, l.h, 15, 1.75, 0.45, 3.6, 0.16));
      const arc = arcadeRing(7.0, l.h - 0.3, 30, 1.1, 0.0, 4.25, 0.55);
      arc.translate(0, 0.3, 0);
      marble.push(arc);
      marble.push(columnRing(7.28, 30, 0.22, 0.42, 4.15, 0));
      marble.push(cornice(5.0, 7.86, l.h - 0.1, l.h + 0.3));
    } else {
      core.push(lathe([[3.2, 0], [3.2, 0.2]]));
      marble.push(arcadeRing(3.5, l.h - 0.5, 12, 1.3, 0.2, 2.75, 0.55));
      marble.push(columnRing(4.2, 12, 0.16, 0.4, 2.7, 0.5));
      marble.push(cornice(0, 4.5, l.h - 0.7, l.h - 0.3));
      marble.push(lathe([[0, l.h + 0.12], [2.2, l.h + 0.02], [4.1, l.h - 0.3]]));
    }
    return {marble: merge(marble), core: merge(core)};
  });

const Tower: React.FC<{lean: number; curve: number; rev?: number; sink?: number; capMat?: boolean}> = ({lean, curve, rev = 999, sink = 0}) => {
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, -1, 0), 0), []);
  const clip = useMemo(() => [plane], [plane]);
  if (rev < TOP) {
    const q = axisAt(rev, lean, curve, sink);
    plane.normal.set(-q.up[0], -q.up[1], 0);
    plane.constant = q.up[0] * q.p[0] + q.up[1] * q.p[1];
  } else {
    plane.normal.set(0, -1, 0);
    plane.constant = 999;
  }
  const m = useMat('marble_ashlar', {clip, tint: '#ffffff'});
  const c = useMat('marble_ashlar', {clip, tint: '#a7a39a'});
  const geos = useMemo(levelGeos, []);
  const bronze = usePlainMat('#5a4a2e', 0.5, 0.7);
  return (
    <group>
      {LEVELS.map((l, i) => {
        const q = axisAt(LEVEL_Y[i], lean, curve, sink);
        return (
          <group key={i} position={q.p} rotation={[0, 0, -tiltOf(i, lean, curve)]}>
            <mesh geometry={geos[i].core} material={c} castShadow receiveShadow />
            <mesh geometry={geos[i].marble} material={m} castShadow receiveShadow />
            {l.kind === 'bell' && rev >= TOP && (
              <mesh position={[0, 1.2, 0]} material={bronze} castShadow>
                <coneGeometry args={[1, 1.9, 20, 1, true]} />
              </mesh>
            )}
          </group>
        );
      })}
    </group>
  );
};

/** Unfinished top of the wall while it rises: stone ring, plank deck, workers, hoist. */
const BuildTop: React.FC<{rev: number; lean: number; curve: number; f: number; hoist?: boolean; crew?: boolean}> = ({rev, lean, curve, f, hoist = true, crew = true}) => {
  const q = axisAt(rev, lean, curve);
  const ring = useMat('marble_ashlar', {tint: '#e7e0d0'});
  const ringG = useMemo(() => lathe([[5.3, 0], [7.5, 0], [7.5, 0.06], [5.3, 0.06], [5.3, 0]], 4), []);
  const R = 6.5;
  const cyc = (f % 120) / 120;
  const loadY = interpolate(cyc, [0, 0.75, 1], [-rev + 0.4, 0.9, 0.9], cl);
  return (
    <group position={q.p} rotation={[0, 0, -q.tilt]}>
      <mesh geometry={ringG} position={[0, -0.03, 0]} material={ring} receiveShadow />
      {crew && [0.5, 1.9, 3.2, 4.6, 5.5].map((a, i) => (
        <Person key={i} position={[Math.sin(a) * R, 0.03, Math.cos(a) * R]} rotY={a + Math.PI / 2} pose={i % 2 ? 'chisel' : 'hammer'} t={f * 0.17 + i} seed={70 + i} head={i % 2 ? 'cloth' : 'hair'} scale={1.05} />
      ))}
      {hoist && (
        <group>
          <Beam a={[5.6, 0, 3]} b={[9.4, 4.4, 0]} r={0.12} square tex="wood_oak" />
          <Beam a={[5.6, 0, -3]} b={[9.4, 4.4, 0]} r={0.12} square tex="wood_oak" />
          <Rope a={[9.4, 4.4, 0]} b={[9.4, loadY + 0.4, 0]} sag={0} r={0.035} />
          <Rope a={[9.4, 4.4, 0]} b={[5.4, 0.05, 0]} sag={0.02} r={0.03} />
          <mesh position={[9.4, loadY, 0]} material={ring} castShadow>
            <boxGeometry args={[1.3, 0.7, 0.9]} />
          </mesh>
        </group>
      )}
    </group>
  );
};

/** Timber scaffold around the wall: stacked ring chunks up to rev. */
const useScaffoldGeo = () =>
  useMemo(() => {
    const parts: THREE.BufferGeometry[] = [];
    const pole = (a: [number, number, number], b: [number, number, number], r: number) => {
      const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
      const g = new THREE.CylinderGeometry(r, r, va.distanceTo(vb), 6, 1, true);
      const uv = g.getAttribute('uv') as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.3, uv.getY(i) * 2);
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize()));
      g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
      parts.push(g);
    };
    const N = 18, H = 6.7, R = 9.6;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2, b = ((i + 1) / N) * Math.PI * 2;
      const P = (ang: number, y: number, r = R): [number, number, number] => [Math.sin(ang) * r, y, Math.cos(ang) * r];
      pole(P(a, 0), P(a, H + 0.5), 0.09);
      for (const y of [2.2, 4.4, 6.6]) pole(P(a, y), P(b, y), 0.06);
      pole(P(a, 4.4), P(a, 4.4, 8.0), 0.05);
      const deck = uvBox(2.7, 0.06, 1.3, 2);
      deck.rotateY(a + Math.PI / N);
      const m = P(a + Math.PI / N, 4.5, R - 0.7);
      deck.translate(m[0], m[1], m[2]);
      parts.push(deck);
    }
    return merge(parts);
  }, []);

const Scaffold: React.FC<{upTo: number; from?: number; lean: number; curve: number}> = ({upTo, from = 0, lean, curve}) => {
  const g = useScaffoldGeo();
  const m = useMat('wood_pine');
  const n = Math.ceil(upTo / 6.7);
  const n0 = Math.floor(from / 6.7);
  return (
    <group>
      {Array.from({length: Math.max(0, n - n0)}, (_, i) => {
        const q = axisAt((i + n0) * 6.7, lean, curve);
        return <mesh key={i} geometry={g} position={[q.p[0], q.p[1], 0]} rotation={[0, 0, -q.tilt]} material={m} castShadow />;
      })}
    </group>
  );
};

// ============================================================ the Campo (cathedral, walls, city, hills)
const Duomo: React.FC = () => {
  const m = useMat('marble_ashlar', {tint: '#f3ecdc'});
  const dark = useMat('marble_ashlar', {tint: '#9b968a'});
  const roof = usePlainMat('#7f8488', 0.55, 0.3);
  const dome = usePlainMat('#6d7276', 0.7, 0.1);
  const gs = useMemo(() => {
    const box = (w: number, h: number, d: number, x: number, y: number, z: number) => {
      const g = uvBox(w, h, d, 5);
      g.translate(x, y, z);
      return g;
    };
    const walls = [box(14, 30, 96, 0, 15, 0), box(32, 16, 96, 0, 8, 0), box(68, 26, 14, 0, 13, 22), box(30, 34, 3, 0, 17, 49)];
    const fr = (w: number, n: number, y: number, x = -w / 2, z = 50.6, tall = 4.4) => {
      const g = arcadePanel(w, tall + 1.2, n, (w / n) * 0.7, 0.3, tall - (w / n) * 0.35, 0.6, 5, 2);
      g.translate(x, y, z);
      return g;
    };
    const front = [fr(32, 7, 0, -16, 50.6, 9), fr(32, 17, 11, -16), fr(22, 13, 17, -11), fr(14, 9, 23, -7), fr(10, 7, 29, -5)];
    const side: THREE.BufferGeometry[] = [];
    for (const sd of [-1, 1]) {
      const g = arcadePanel(96, 14, 15, 3.6, 2, 8, 0.5, 5, 2);
      g.rotateY(sd > 0 ? Math.PI / 2 : -Math.PI / 2);
      g.translate(sd * 16.1, 0, sd > 0 ? 48 : -48);
      side.push(g);
      const c = arcadePanel(96, 8, 30, 1.5, 1, 4.6, 0.4, 5, 2);
      c.rotateY(sd > 0 ? Math.PI / 2 : -Math.PI / 2);
      c.translate(sd * 7.1, 21, sd > 0 ? 48 : -48);
      side.push(c);
    }
    for (const zp of [29.3]) {
      const g = arcadePanel(68, 24, 17, 2.6, 2, 13, 0.5, 4, 2);
      g.translate(-34, 0, zp);
      side.push(g);
    }
    const dr = arcadeRing(9, 7, 22, 0.9, 1, 4.6, 0.3);
    dr.scale(0.85, 1, 1.1);
    dr.translate(0, 34, 22);
    side.push(dr);
    const apse = lathe([[0, 0], [8, 0], [8, 28], [0, 28]], 5, 32);
    apse.translate(0, 0, -48);
    const gable = (w: number, h: number, d: number, y: number, z: number) => {
      const s = new THREE.Shape();
      s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(0, h); s.closePath();
      const g = new THREE.ExtrudeGeometry(s, {depth: d, bevelEnabled: false});
      g.translate(0, y, z - d / 2);
      return g;
    };
    const roofs = [gable(15, 5, 98, 30, 0)];
    const lean1 = gable(36, 3, 98, 15.6, 0);
    const tr = gable(15, 4.5, 70, 25.8, 0);
    tr.rotateY(Math.PI / 2);
    tr.translate(0, 0, 22);
    roofs.push(lean1, tr);
    const domeG = new THREE.SphereGeometry(9, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2);
    domeG.scale(0.85, 0.85, 1.1);
    domeG.translate(0, 41, 22);
    const drum = lathe([[0, 34], [9, 34], [9, 41], [0, 41]], 5, 28);
    drum.scale(0.85, 1, 1.1);
    drum.translate(0, 0, 22);
    return {w: merge([...walls, apse, drum]), p: merge([...front, ...side]), r: merge(roofs), d: domeG};
  }, []);
  return (
    <group position={[-74, 0, 86]}>
      <mesh geometry={gs.w} material={dark} castShadow receiveShadow />
      <mesh geometry={gs.p} material={m} castShadow receiveShadow />
      <mesh geometry={gs.r} material={roof} castShadow />
      <mesh geometry={gs.d} material={dome} castShadow />
    </group>
  );
};

const Baptistery: React.FC = () => {
  const m = useMat('marble_ashlar', {tint: '#efe8d8'});
  const r = usePlainMat('#9a8f7c', 0.6, 0.1);
  const g = useMemo(() => {
    const a = arcadeRing(17.6, 18, 20, 3.6, 1, 11, 0.7);
    const body = lathe([[0, 0], [17.6, 0], [17.6, 26], [0, 26]], 5, 40);
    return merge([a, body]);
  }, []);
  const dome = useMemo(() => lathe([[17.6, 26], [12, 38], [5, 46], [1.2, 50], [0.1, 54]], 5, 40), []);
  return (
    <group position={[-108, 0, 214]}>
      <mesh geometry={g} material={m} castShadow receiveShadow />
      <mesh geometry={dome} material={r} castShadow />
    </group>
  );
};

const CityWall: React.FC = () => {
  const m = useMat('rubble_wall', {tint: '#c9b79a'});
  const g = useMemo(() => {
    const parts: THREE.BufferGeometry[] = [];
    const wall = uvBox(2.4, 11, 900, 4);
    wall.translate(0, 5.5, 0);
    parts.push(wall);
    for (let z = -448; z < 450; z += 5) {
      const mer = uvBox(2.4, 1.4, 2.6, 4);
      mer.translate(0, 11.7, z);
      parts.push(mer);
    }
    return merge(parts);
  }, []);
  return <mesh geometry={g} position={[-130, 0, 40]} material={m} castShadow receiveShadow />;
};

const HOUSES = (() => {
  const out: {x: number; z: number; w: number; d: number; h: number; r: number; t: number}[] = [];
  let i = 0;
  for (let gx = -11; gx <= 12; gx++)
    for (let gz = 0; gz < 9; gz++) {
      i++;
      if (rnd(i * 1.7) < 0.14) continue;
      out.push({x: gx * 40 + rnd(i) * 12 + 10, z: -108 - gz * 38 - rnd(i * 3) * 10, w: 14 + rnd(i * 5) * 14, d: 13 + rnd(i * 7) * 12, h: 11 + rnd(i * 9) * 15, r: Math.round(rnd(i * 11) * 2) * 0.2 - 0.2, t: i % 3 === 0 ? 1 : 0});
    }
  return out;
})();

const City: React.FC = () => {
  const ochre = useMat('plaster_ochre', {tint: '#f0cfa0'});
  const white = useMat('plaster_white', {tint: '#f3e6d0'});
  const roof = useMat('roof_tiles', {tint: '#d98c62'});
  const winM = usePlainMat('#3b3530', 0.7);
  const gs = useMemo(() => {
    const a: THREE.BufferGeometry[] = [], b: THREE.BufferGeometry[] = [], c: THREE.BufferGeometry[] = [], win: THREE.BufferGeometry[] = [];
    HOUSES.forEach((h) => {
      const body = uvBox(h.w, h.h, h.d, 5);
      body.translate(0, h.h / 2, 0);
      body.rotateY(h.r);
      body.translate(h.x, 0, h.z);
      (h.t ? b : a).push(body);
      const rows = Math.floor(h.h / 4), cols = Math.floor(h.w / 4);
      for (let ry = 0; ry < rows; ry++)
        for (let cx = 0; cx < cols; cx++) {
          const wn = new THREE.BoxGeometry(1.1, 1.9, 0.2);
          wn.translate(-h.w / 2 + (h.w * (cx + 0.5)) / cols, 2.6 + ry * 3.8, h.d / 2);
          wn.rotateY(h.r);
          wn.translate(h.x, 0, h.z);
          win.push(wn);
        }
      const s = new THREE.Shape();
      s.moveTo(-h.w / 2 - 0.6, 0); s.lineTo(h.w / 2 + 0.6, 0); s.lineTo(0, h.w * 0.26); s.closePath();
      const rf = new THREE.ExtrudeGeometry(s, {depth: h.d + 1.2, bevelEnabled: false});
      rf.translate(0, h.h, -(h.d + 1.2) / 2);
      worldUV(rf, 4);
      rf.rotateY(h.r);
      rf.translate(h.x, 0, h.z);
      c.push(rf);
    });
    return {a: merge(a), b: merge(b), c: merge(c), w: merge(win)};
  }, []);
  return (
    <group>
      <mesh geometry={gs.a} material={ochre} castShadow receiveShadow />
      <mesh geometry={gs.b} material={white} castShadow receiveShadow />
      <mesh geometry={gs.c} material={roof} castShadow />
      <mesh geometry={gs.w} material={winM} />
    </group>
  );
};

const TREES = Array.from({length: 22}, (_, i) => ({x: -116 + (i % 2) * 7, z: -80 + i * 19 + rnd(i) * 6, s: 1.1 + rnd(i * 3) * 0.5, seed: i + 200}));
const LEAFY = Array.from({length: 14}, (_, i) => ({x: -90 + i * 34 + rnd(i * 7) * 12, z: -84 - rnd(i * 2) * 10, s: 1.3 + rnd(i * 5) * 0.6, seed: i + 300}));

const Campo: React.FC<{modern?: boolean; section?: boolean}> = ({modern = false, section = false}) => {
  const pave = useMat('limestone_ashlar', {tint: '#d9d2c2'});
  const ringG = useMemo(() => lathe([[8.2, 0], [13.5, 0], [13.5, 0.05], [8.2, 0.05], [8.2, 0]], 4, 64), []);
  const pathG = useMemo(() => {
    const g = uvBox(5, 0.04, 66, 4);
    return g;
  }, []);
  const pathX = useMemo(() => {
    const g = uvBox(62, 0.04, 5, 4);
    return g;
  }, []);
  return (
    <group>
      <Terrain height={campoH} size={2400} seg={200} tex="grass" texScale={7} center={section ? [0, -1200 + SECTION_Z] : [0, 0]} tint="#aecb86" steep={[0.3, 0.4, 0.25]} />
      <CityWall />
      <City />
      <Duomo />
      <Baptistery />
      {TREES.map((t, i) => <Cypress key={i} position={[t.x, 0, t.z]} scale={t.s} seed={t.seed} />)}
      {LEAFY.map((t, i) => <Tree key={i} position={[t.x, 0, t.z]} scale={t.s} seed={t.seed} leaf="#4e8434" />)}
      {modern && !section && (
        <>
          <mesh geometry={ringG} material={pave} receiveShadow />
          <mesh geometry={pathG} position={[0, 0.02, 44]} material={pave} receiveShadow />
          <mesh geometry={pathX} position={[-44, 0.02, 0]} material={pave} receiveShadow />
        </>
      )}
    </group>
  );
};

/** Sky, sun, fog: bright Tuscan noon; golden=1 for the payoff. */
const Atmos: React.FC<{f: number; golden?: number; shadow?: number; target?: [number, number, number]}> = ({f, golden = 0, shadow = 75, target = [0, 22, 0]}) => {
  const sunDir: [number, number, number] = golden ? [-0.42, 0.36, 0.84] : [-0.48, 0.92, 0.62];
  const sunCol = golden ? '#ffc98a' : '#fff4e2';
  const hor = golden ? '#f7d4a4' : '#bcdcf4';
  return (
    <>
      <Renderer exposure={golden ? 0.98 : 0.92} envIntensity={golden ? 0.5 : 0.55} />
      <SkyDome top={golden ? '#3f6fb4' : '#1c62c4'} horizon={hor} sunDir={sunDir} sunColor={sunCol} clouds={golden ? 0.5 : 0.42} time={f / 30} bottom={golden ? '#d9b98a' : '#a9c49a'} />
      <Sun dir={sunDir} intensity={golden ? 3.0 : 2.7} color={sunCol} shadowSize={shadow} shadowRes={4096} target={target} skyColor="#c6e0f7" groundColor="#b0a890" />
      <fog attach="fog" args={[hor, 300, 1250]} />
    </>
  );
};

// ============================================================ soil section
const SoilSection: React.FC<{lean: number; curve?: number; sink?: number; dense?: number}> = ({lean, sink = 0, dense = 0}) => {
  const clay = useMat('clay_blue');
  const clayDeep = useMat('clay_blue', {tint: '#a9b4c8'});
  const silt = useMat('silt_tan');
  const sandDeep = useMat('silt_tan', {tint: '#b99f7c'});
  const top = useMat('dirt', {tint: '#6a5338'});
  const stone = useMat('rubble_core', {tint: '#d9d0bc'});
  const bulb = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const x = c.getContext('2d')!;
    const g = x.createRadialGradient(64, 64, 8, 64, 64, 62);
    g.addColorStop(0, '#fff');
    g.addColorStop(0.55, '#999');
    g.addColorStop(1, '#000');
    x.fillStyle = g;
    x.fillRect(0, 0, 128, 128);
    return new THREE.MeshStandardMaterial({color: '#31435f', roughness: 0.9, transparent: true, alphaMap: new THREE.CanvasTexture(c), opacity: 0, clippingPlanes: [new THREE.Plane(new THREE.Vector3(0, -1, 0), -0.45)]});
  }, []);
  bulb.opacity = dense * 0.7;
  const uvS = (g: THREE.BufferGeometry, s: number) => {
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    const uv = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) {
      uv[i * 2] = p.getX(i) / s;
      uv[i * 2 + 1] = p.getY(i) / s;
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return g;
  };
  const shape = (pts: [number, number][]) => {
    const s = new THREE.Shape();
    pts.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
    s.closePath();
    return uvS(new THREE.ShapeGeometry(s), 12);
  };
  const gs = useMemo(() => {
    const L = 900;
    return {
      base: shape([[-L, -130], [L, -130], [L, 0], [-L, 0]]),
      silt: shape([[-L, 0], [L, 0], [L, -1.6], [64, -1.6], [30, -2.4], [12, -5], [-6, -9.5], [-34, -12.5], [-L, -13.5]]),
      deep: shape([[-L, -130], [L, -130], [L, -62], [100, -60], [0, -61], [-120, -59], [-L, -60]]),
      turf: shape([[-L, 0], [L, 0], [L, -0.45], [-L, -0.45]]),
      deepClay: shape([[-L, -60], [L, -62], [L, -36], [-L, -35]]),
      found: shape([[-8.5, 0.6], [8.5, 0.6], [8.5, -3], [-8.5, -3]]),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const z = SECTION_Z;
  return (
    <group>
      <mesh geometry={gs.base} position={[0, 0, z]} material={clay} />
      <mesh geometry={gs.deepClay} position={[0, 0, z + 0.01]} material={clayDeep} />
            <mesh geometry={gs.deep} position={[0, 0, z + 0.015]} material={sandDeep} />
      <mesh geometry={gs.silt} position={[0, 0, z + 0.02]} material={silt} />
      <mesh position={[3, -8, z + 0.025]} material={bulb}><planeGeometry args={[62, 44]} /></mesh>
      <mesh geometry={gs.turf} position={[0, 0, z + 0.03]} material={top} />
      <group position={[0, -sink, z + 0.06]} rotation={[0, 0, -lean * DEG]}>
        <mesh geometry={gs.found} material={stone} />
      </group>
    </group>
  );
};

// ============================================================ 1990s site
const FENCE = Array.from({length: 40}, (_, i) => (i / 40) * Math.PI * 2);
const Fence: React.FC<{t: number}> = ({t}) => {
  const m = useMat('steel', {tint: '#b9bec4'});
  const g = useMemo(() => {
    const parts: THREE.BufferGeometry[] = [];
    FENCE.forEach((a, i) => {
      const R = 25;
      const x = Math.cos(a) * R, z = Math.sin(a) * R;
      const post = new THREE.CylinderGeometry(0.05, 0.05, 2, 6);
      post.translate(x, 1, z);
      parts.push(post);
      const b = FENCE[(i + 1) % 40];
      const x2 = Math.cos(b) * R, z2 = Math.sin(b) * R;
      for (const y of [0.9, 1.9]) {
        const len = Math.hypot(x2 - x, z2 - z);
        const r = new THREE.CylinderGeometry(0.03, 0.03, len, 5);
        r.rotateX(Math.PI / 2);
        r.rotateY(Math.atan2(x2 - x, z2 - z));
        r.translate((x + x2) / 2, y, (z + z2) / 2);
        parts.push(r);
      }
    });
    return merge(parts);
  }, []);
  return <mesh geometry={g} position={[0, (t - 1) * 2.1, 0]} material={m} castShadow />;
};

const LEAD_SLOTS = (() => {
  const out: {x: number; y: number; z: number; r: number}[] = [];
  for (let lv = 0; lv < 6; lv++)
    for (let i = 0; i < 9; i++) {
      const a = Math.PI + ((i - 4) / 9) * 1.75;
      for (const R of [9.3, 11.1]) out.push({x: Math.cos(a) * R, y: 1.15 + lv * 0.72, z: Math.sin(a) * R, r: -a});
    }
  return out;
})();

/** Lead ingots stacked on a concrete collar on the high (north) side. n = ingots placed. */
const LeadStack: React.FC<{n: number}> = ({n}) => {
  const lead = usePlainMat('#8d949c', 0.5, 0.2);
  const conc = useMat('concrete');
  const g = useMemo(() => uvBox(1.6, 0.66, 1.65, 1.5), []);
  const collar = useMemo(() => {
    const s = new THREE.Shape();
    const a0 = Math.PI - 1.05, a1 = Math.PI + 1.05;
    s.absarc(0, 0, 12.2, a0, a1, false);
    s.absarc(0, 0, 8.4, a1, a0, true);
    s.closePath();
    const e = new THREE.ExtrudeGeometry(s, {depth: 0.8, bevelEnabled: false, curveSegments: 22});
    e.rotateX(-Math.PI / 2);
    return worldUV(e, 4);
  }, []);
  return (
    <group>
      <mesh geometry={collar} position={[0, 0.02, 0]} material={conc} castShadow receiveShadow scale={[1, 1, -1]} />
      {LEAD_SLOTS.slice(0, Math.floor(n)).map((l, i) => (
        <mesh key={i} geometry={g} position={[l.x, l.y, l.z]} rotation={[0, l.r, 0]} material={lead} castShadow receiveShadow />
      ))}
    </group>
  );
};

const Cables: React.FC<{t: number; lean: number; curve: number}> = ({t, lean, curve}) => {
  const m = usePlainMat('#23262b', 0.4, 0.6);
  const ring = usePlainMat('#3a3f46', 0.4, 0.7);
  const s = LEVEL_Y[3] - 2.4;
  const q = axisAt(s, lean, curve);
  const anchors: [number, number, number][] = [[-92, 0.6, -34], [-98, 0.6, 7], [-98, 0.6, -12]];
  return (
    <group>
      <group position={q.p} rotation={[0, 0, -q.tilt]}>
        <mesh rotation={[Math.PI / 2, 0, 0]} material={ring} castShadow>
          <torusGeometry args={[7.72, 0.12, 8, 72]} />
        </mesh>
      </group>
      {anchors.map((b, i) => {
        const a = surf(s, -Math.PI / 2 - (b[2] / 34) * 0.7, lean, curve);
        const e: [number, number, number] = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
        const v = new THREE.Vector3(e[0] - a[0], e[1] - a[1], e[2] - a[2]);
        const L = Math.max(0.01, v.length());
        const qr = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), v.clone().normalize());
        return (
          <mesh key={i} position={[(a[0] + e[0]) / 2, (a[1] + e[1]) / 2, (a[2] + e[2]) / 2]} quaternion={qr} material={m} castShadow>
            <cylinderGeometry args={[0.11, 0.11, L, 6]} />
          </mesh>
        );
      })}
      {anchors.map((b, i) => <Rock key={i} position={[b[0] - 1, 0.5, b[2]]} scale={[2, 1.2, 2]} seed={i + 40} tex="stone_face_lime" />)}
    </group>
  );
};

/** Mobile crane on the north lawn lowering a lead ingot. */
const MobileCrane: React.FC<{f: number; on: boolean}> = ({f, on}) => {
  const red = useMat('steel_painted_red', {tint: '#c9c9c9'});
  const iron = useMat('iron_dark');
  const lead = usePlainMat('#8d949c', 0.5, 0.2);
  const base: [number, number, number] = [-40, 2.6, 6];
  const tip: [number, number, number] = [-11, 25, 0];
  const c = on ? (f % 30) / 30 : 0.1;
  const y = interpolate(c, [0, 0.5, 1], [15, 3.4, 15], cl);
  const v = new THREE.Vector3(tip[0] - base[0], tip[1] - base[1], tip[2] - base[2]);
  const L = v.length();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), v.clone().normalize());
  return (
    <group>
      <mesh position={[-44, 1.1, 6]} material={iron} castShadow>
        <boxGeometry args={[11, 1.3, 3.4]} />
      </mesh>
      <mesh position={[-41, 2.5, 6]} material={red} castShadow>
        <boxGeometry args={[6, 1.6, 2.8]} />
      </mesh>
      {[-48, -45, -42, -39].map((x) => [4.1, 7.9].map((z) => (
        <mesh key={x + '' + z} position={[x, 0.65, z]} rotation={[Math.PI / 2, 0, 0]} material={iron} castShadow>
          <cylinderGeometry args={[0.65, 0.65, 0.5, 16]} />
        </mesh>
      )))}
      <mesh position={[(base[0] + tip[0]) / 2, (base[1] + tip[1]) / 2, (base[2] + tip[2]) / 2]} quaternion={q} material={red} castShadow>
        <boxGeometry args={[0.8, L, 0.8]} />
      </mesh>
      <Rope a={tip} b={[tip[0], y + 0.5, tip[2]]} sag={0} r={0.04} color="#222" />
      <mesh position={[tip[0], y, tip[2]]} material={lead} castShadow>
        <boxGeometry args={[1.6, 0.66, 1.6]} />
      </mesh>
    </group>
  );
};

// ============================================================ shared stage
const Stage: React.FC<{cam: Cam; children: React.ReactNode}> = ({cam, children}) => {
  const {width, height} = useVideoConfig();
  return (
    <AbsoluteFill style={{background: '#0e0b08'}}>
      <ThreeCanvas width={width} height={height} shadows camera={{fov: cam.fov, near: 0.3, far: 3500}}>
        <AssetProvider textures={TEXTURES} hdri="spruit_sunrise_1k">
          <CameraRig pos={cam.pos} target={cam.target} fov={cam.fov} />
          {children}
        </AssetProvider>
      </ThreeCanvas>
      <Grade strength={0.28} />
    </AbsoluteFill>
  );
};

/** A Tag anchored to a 3D point. */
const Pin: React.FC<{p: [number, number, number]; cam: Cam; text: string; delay: number; dx?: number; dy?: number; size?: number; anchor?: 'left' | 'right' | 'center'; bg?: string; fg?: string}> = ({p, cam, text, delay, dx = 0, dy = 0, size = 50, anchor = 'center', bg, fg}) => {
  const [x, y, vis] = toScreen(p, cam);
  if (!vis) return null;
  const w = text.length * size * 0.56 + size * 0.9;
  let lx = x + dx;
  const left = anchor === 'left' ? lx : anchor === 'right' ? lx - w : lx - w / 2;
  if (left < 36) lx += 36 - left;
  if (left + w > 1044) lx -= left + w - 1044;
  return <Tag text={text} x={lx} y={Math.min(1500, Math.max(420, y + dy))} delay={delay} size={size} anchor={anchor} bg={bg} fg={fg} />;
};

/** 2D overlay line through 3D points. */
const Line3: React.FC<{pts: [number, number, number][]; cam: Cam; color?: string; width?: number; dash?: string; t?: number}> = ({pts, cam, color = C.yellow, width = 8, dash, t = 1}) => {
  const n = Math.max(2, Math.ceil(pts.length * t));
  const d = pts.slice(0, n).map((p, i) => {
    const [x, y] = toScreen(p, cam);
    return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ');
  return (
    <svg style={{position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none'}}>
      <path d={d} fill="none" stroke={C.ink} strokeWidth={width + 6} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={dash} />
      <path d={d} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={dash} />
    </svg>
  );
};

/** Arrow at a screen point (rot: 0 = pointing down). */
const Arrow2: React.FC<{x: number; y: number; rot?: number; color?: string; size?: number; opacity?: number}> = ({x, y, rot = 0, color = C.red, size = 130, opacity = 1}) => (
  <svg style={{position: 'absolute', left: x - size / 2, top: y - size / 2, width: size, height: size, overflow: 'visible', transform: `rotate(${rot}deg)`, opacity}} viewBox="0 0 100 100">
    <path d="M36 4 H64 V54 H86 L50 96 L14 54 H36 Z" fill={color} stroke={C.ink} strokeWidth={7} strokeLinejoin="round" />
  </svg>
);

const NS: React.FC<{y?: number; delay?: number}> = ({y = 880, delay = 4}) => (
  <>
    <Tag text="NORTH" x={40} y={y} delay={delay} size={40} bg="#ffffff" />
    <Tag text="SOUTH" x={1040} y={y} delay={delay} size={40} anchor="right" bg="#ffffff" />
  </>
);

// ============================================================ S1 hook
const S1: React.FC = () => {
  const f = useCurrentFrame();
  const L = LEN[0];
  const cam = groundSafe(camPath(f, [
    {t: 0, pos: [-20, 1.9, 40], target: [3, 33, 0], fov: 62},
    {t: L * 0.42, pos: [-17, 7, 88], target: [1, 35, 0], fov: 48},
    {t: L, pos: [-12, 15, 150], target: [0, 30, 0], fov: 40},
  ]), campoH);
  return (
    <>
      <Stage cam={cam}>
        <Atmos f={f} />
        <Campo modern />
        <Tower lean={LEAN_NOW} curve={1} />
        <Person {...walkAlong([-6, 0, 28], 0.15, f, 1.3, campoH)} seed={3} outfit="#d8413a" pants="#2d3a55" />
        <Person {...walkAlong([-9, 0, 30], 0.15, f + 12, 1.3, campoH)} seed={5} outfit="#f0f0ea" pants="#58605c" head="hat" headColor="#e8dcc0" />
        <Person position={[-13, 0, 25]} rotY={-0.4} pose="push" legs="still" seed={6} outfit="#2a86c8" pants="#d9c9a6" />
        <Person position={[-16, 0, 30]} rotY={-0.5} pose="point" seed={8} outfit="#f2b43a" pants="#30343c" />
      </Stage>
      <Headline top="PISA, ITALY" big="850 YEARS" sub="and it still hasn't fallen" delay={4} y={150} bigSize={140} />
    </>
  );
};

// ============================================================ S2 soil
const S2: React.FC = () => {
  const f = useCurrentFrame();
  const L = LEN[1];
  const cut = Math.round(L * 0.42);
  const cam = groundSafe(camPath(f, [
    {t: 0, pos: [-3, 6, 152], target: [0, 5, SECTION_Z], fov: 42},
    {t: cut, pos: [0, 6, 150], target: [0, 5, SECTION_Z], fov: 42},
    {t: L * 0.72, pos: [0, 3.5, 66], target: [0, -1.4, SECTION_Z], fov: 42},
    {t: L, pos: [1, 3.3, 62], target: [0, -1.2, SECTION_Z], fov: 42},
  ]), secH);
  return (
    <>
      <Stage cam={cam}>
        <Atmos f={f} target={[0, 10, 0]} />
        <Campo section />
        <Tower lean={LEAN_NOW} curve={1} />
        <SoilSection lean={LEAN_NOW} />
        <Person position={[-14, 0, 8]} rotY={0} pose="stand" seed={3} outfit="#d8413a" pants="#2d3a55" />
      </Stage>
      <NS y={1370} delay={6} />
      <Sequence durationInFrames={Math.round(L * 0.5)} layout="none">
        <Pin p={[24, -24, SECTION_Z]} cam={cam} text="SOFT CLAY" delay={14} size={54} anchor="right" dx={60} />
        <Pin p={[-26, -6, SECTION_Z]} cam={cam} text="SANDY SILT" delay={34} size={54} anchor="left" dx={-60} />
      </Sequence>
      <Sequence from={Math.round(L * 0.56)} layout="none">
        <Pin p={[8.8, -1.5, SECTION_Z]} cam={cam} text="ONLY 3 M DEEP" delay={8} dx={30} dy={60} size={56} anchor="right" />
      </Sequence>
      <Caption text="14,500 tonnes on soft ground" delay={Math.round(L * 0.4)} bottom={290} />
    </>
  );
};

// ============================================================ S3 first campaign
const Yard: React.FC<{f: number}> = ({f}) => {
  const m = useMat('marble_ashlar', {tint: '#e9e2d2'});
  const g = useMemo(() => uvBox(1.5, 0.75, 1, 2), []);
  const blocks = useMemo(() => Array.from({length: 16}, (_, i) => ({x: 15 + (i % 6) * 1.9 + rnd(i) * 0.3, y: 0.38 + (i > 11 ? 0.76 : 0), z: 22 + Math.floor(i / 6) * 1.5 + (i % 2) * 0.2, r: rnd(i + 4) * 0.4})), []);
  return (
    <group>
      {blocks.map((b, i) => <mesh key={i} geometry={g} position={[b.x, b.y, b.z]} rotation={[0, b.r, 0]} material={m} castShadow receiveShadow />)}
      <Person position={[14, 0, 19.8]} rotY={-1.4} pose="chisel" t={f * 0.2} seed={51} head="cloth" />
      <Person position={[19, 0, 19.8]} rotY={-1.8} pose="hammer" t={f * 0.18 + 1} seed={52} />
      <Person position={[23, 0, 21]} rotY={2.6} pose="point" seed={53} head="hat" headColor="#7a5a3a" />
      <Dust at={[14.6, 0.5, 20.6]} f={f} color="#efe9dc" />
      <Dust at={[19.4, 0.5, 20.6]} f={f + 9} color="#efe9dc" />
    </group>
  );
};

const lean1 = (f: number) => LEAN_1178 * ramp(f, LEN[2] * 0.55, LEN[2] * 0.9);

const S3: React.FC = () => {
  const f = useCurrentFrame();
  const L = LEN[2];
  const cam = groundSafe(camPath(f, [
    {t: 0, pos: [33, 5, 40], target: [6, 6, 6], fov: 50},
    {t: L * 0.3, pos: [28, 7, 52], target: [4, 9, 2], fov: 50},
    {t: L * 0.58, pos: [16, 12, 72], target: [1, 14, 0], fov: 50},
    {t: L, pos: [5, 13, 74], target: [2, 15, 0], fov: 50},
  ]), campoH);
  const rev = Math.max(0.6, S_2ND * ramp(f, 8, L * 0.56, Easing.inOut(Easing.sin)));
  const lean = lean1(f);
  const south = toScreen(surf(0, Math.PI / 2, lean, 0, 7.8), cam);
  const lt = ramp(f, L * 0.52, L * 0.62);
  return (
    <>
      <Stage cam={cam}>
        <Atmos f={f} target={[0, 14, 0]} shadow={60} />
        <Campo />
        <Tower lean={lean} curve={0} rev={rev} />
        <BuildTop rev={rev} lean={lean} curve={0} f={f} />
        <Scaffold upTo={rev} lean={lean} curve={0} />
        <Yard f={f} />
        <Person {...walkAlong([24, 0, 18], 2.47, f, 1.15, campoH)} pose="carry" legs="walk" seed={60} head="cloth" />
        <Person {...walkAlong([27, 0, 15], 2.47, f + 30, 1.15, campoH)} pose="carry" legs="walk" seed={61} />
        <Person {...walkAlong([-26, 0, 16], -0.5, f, 1.2, campoH)} seed={62} head="cloth" />
      </Stage>
      <StepBadge n={1} title="MARBLE RING" delay={3} />
      <Tag text="1173" x={70} y={470} delay={10} size={64} />
      <Sequence durationInFrames={Math.round(L * 0.5)} layout="none">
        <Pin p={surf(7, 0.3, lean, 0)} cam={cam} text="HOLLOW TOWER" delay={Math.round(L * 0.1)} dy={-30} size={46} />
      </Sequence>
      <Sequence from={Math.round(L * 0.52)} layout="none">
        <Tag text="1178" x={70} y={570} delay={0} size={64} bg={C.red} fg={C.white} />
        <Pin p={surf(S_2ND, 0.3, lean, 0)} cam={cam} text="2ND FLOOR" delay={6} dy={-70} size={46} />
      </Sequence>
      {lt > 0 && (
        <>
          <Line3 pts={[[9.2, 0, 7], [9.2, S_2ND + 5, 7]]} cam={cam} color="#ffffff" width={6} dash="18 18" t={lt} />
        </>
      )}
      {f > L * 0.6 && <Arrow2 x={south[0] + 34} y={south[1] - 50 + 18 * Math.sin(f * 0.3)} size={120} opacity={ramp(f, L * 0.6, L * 0.66)} />}
      <Caption text="Five years in, the south side sinks" delay={Math.round(L * 0.56)} bottom={290} />
    </>
  );
};

// ============================================================ S4 the pause
const DROPS = Array.from({length: 34}, (_, i) => ({x: -19 + rnd(i * 3.1) * 38, y0: -5 - rnd(i * 5.3) * 15, ph: rnd(i * 7.7) * 90}));
const Droplets: React.FC<{f: number; on: number}> = ({f, on}) => {
  const m = usePlainMat('#7fd0f5', 0.2, 0, {emissive: new THREE.Color('#3aa0e0'), emissiveIntensity: 0.9});
  return (
    <group>
      {DROPS.map((d, i) => {
        const u = ((f + d.ph) % 90) / 90;
        const out = Math.abs(d.x);
        const y = d.y0 + u * 8;
        return <mesh key={i} position={[d.x + Math.sign(d.x) * u * 3 * (out > 2 ? 1 : 0), y, SECTION_Z + 0.2]} scale={on * 0.42 * Math.min(1, u * 6) * Math.min(1, (1 - u) * 6)} material={m}><sphereGeometry args={[1, 10, 8]} /></mesh>;
      })}
    </group>
  );
};

const S4: React.FC = () => {
  const f = useCurrentFrame();
  const L = LEN[3];
  const cam = groundSafe(camPath(f, [
    {t: 0, pos: [18, 11, 96], target: [2, 9, SECTION_Z], fov: 46},
    {t: L, pos: [4, 3, 100], target: [0, 3, SECTION_Z], fov: 46},
  ]), secH);
  const dense = ramp(f, L * 0.48, L * 0.92);
  const year = Math.round(interpolate(f, [L * 0.18, L * 0.72], [1178, 1272], cl));
  const lean = LEAN_1178;
  return (
    <>
      <Stage cam={cam}>
        <Atmos f={f} target={[0, 8, 0]} />
        <Campo section />
        <Tower lean={lean} curve={0} rev={S_2ND} />
        <BuildTop rev={S_2ND} lean={lean} curve={0} f={0} hoist={false} crew={false} />
        <SoilSection lean={lean} dense={dense} />
        <Droplets f={f} on={ramp(f, L * 0.36, L * 0.46)} />
        {[0, 1, 2, 3, 4].map((i) => <Person key={i} {...walkAlong([-36 - i * 2.6, 0, -3 - (i % 2) * 1.6], 0, f, 1.8, campoH)} seed={i + 80} head="helmet" outfit="#7a2f2a" pants="#3b3b42" />)}
      </Stage>
      <StepBadge n={2} title="DO NOTHING" delay={3} />
      <Tag text={`YEAR ${year}`} x={540} y={1440} anchor="center" delay={10} size={74} bg={C.white} />
      <NS y={1120} delay={6} />
      <Sequence durationInFrames={Math.round(L * 0.48)} layout="none">
        <Tag text="WAR STOPS THE WORK" x={540} y={1290} anchor="center" delay={Math.round(L * 0.1)} size={56} bg={C.red} fg={C.white} />
      </Sequence>
      <Sequence from={Math.round(L * 0.52)} layout="none">
        <Pin p={[0, -6, SECTION_Z]} cam={cam} text="SOIL SQUEEZED DENSER" delay={2} size={46} dy={30} />
      </Sequence>
      <Caption text="The pause let the soil settle" delay={Math.round(L * 0.55)} bottom={290} />
    </>
  );
};

// ============================================================ S5 second campaign: taller floors, curve
const S5: React.FC = () => {
  const f = useCurrentFrame();
  const L = LEN[4];
  const k = ramp(f, 6, L * 0.74, Easing.inOut(Easing.sin));
  const rev = S_2ND + (TOP - S_2ND) * k;
  const lean = LEAN_1178 + (LEAN_1372 - LEAN_1178) * k;
  const curve = k;
  const cam = groundSafe(camPath(f, [
    {t: 0, pos: [8, 18, 120], target: [1, 22, 0], fov: 42},
    {t: L * 0.7, pos: [3, 22, 150], target: [2, 31, 0], fov: 40},
    {t: L, pos: [0, 22, 148], target: [2, 31, 0], fov: 40},
  ]), campoH);
  const lineT = ramp(f, L * 0.74, L * 0.92);
  const axisPts = useMemo(() => Array.from({length: 41}, (_, i) => axisAt((i / 40) * TOP, LEAN_1372, 1).p), []);
  const base = axisAt(S_2ND, LEAN_1372, 1);
  const straight: [number, number, number] = [base.p[0] + base.up[0] * (TOP - S_2ND), base.p[1] + base.up[1] * (TOP - S_2ND), 0];
  const done = rev >= TOP;
  return (
    <>
      <Stage cam={cam}>
        <Atmos f={f} target={[0, 28, 0]} />
        <Campo />
        <Tower lean={lean} curve={curve} rev={rev} />
        {!done && <BuildTop rev={rev} lean={lean} curve={curve} f={f} />}
        {!done && <Scaffold upTo={rev} from={Math.max(0, rev - 14)} lean={lean} curve={curve} />}
        <Yard f={f} />
      </Stage>
      <StepBadge n={3} title="CURVE IT BACK" delay={3} />
      <Tag text="1272" x={70} y={470} delay={10} size={64} />
      <Sequence durationInFrames={Math.round(L * 0.72)} layout="none">
        <Pin p={surf(Math.min(rev, 38), Math.PI / 2, lean, curve, 8)} cam={cam} text="TALLER ON THIS SIDE" delay={Math.round(L * 0.22)} dx={24} dy={120} size={44} anchor="left" />
      </Sequence>
      {f > L * 0.24 && f < L * 0.72 && (() => {
        const [x, y] = toScreen(surf(rev, Math.PI / 2, lean, curve, 10), cam);
        return <Arrow2 x={x + 30} y={y + 40} rot={180} size={110} color={C.yellow} opacity={ramp(f, L * 0.24, L * 0.3)} />;
      })()}
      {lineT > 0 && (
        <>
          <Line3 pts={[base.p, straight]} cam={cam} color="#ffffff" width={5} dash="16 16" t={lineT} />
          <Line3 pts={axisPts.slice(16)} cam={cam} t={lineT} />
          <Pin p={straight} cam={cam} text="WITHOUT THE CURVE" delay={Math.round(L * 0.78)} dx={40} dy={40} size={38} anchor="left" />
        </>
      )}
      <Caption text="Bell chamber finished in 1372" delay={Math.round(L * 0.72)} bottom={290} />
    </>
  );
};

// ============================================================ S6 1990
const S6: React.FC = () => {
  const f = useCurrentFrame();
  const L = LEN[5];
  const k = ramp(f, 4, L * 0.32);
  const lean = LEAN_1372 + (LEAN_1990 - LEAN_1372) * k;
  const cam = groundSafe(camPath(f, [
    {t: 0, pos: [0, 22, 148], target: [2, 31, 0], fov: 40},
    {t: L * 0.5, pos: [-4, 22, 146], target: [0, 31, 0], fov: 40},
    {t: L * 0.76, pos: [-62, 12, 24], target: [-8, 13, 2], fov: 50},
    {t: L, pos: [-54, 8, 21], target: [-8, 10, 1], fov: 50},
  ]), campoH);
  const fence = ramp(f, L * 0.44, L * 0.5);
  const cableT = ramp(f, L * 0.55, L * 0.68);
  const lead = ramp(f, L * 0.72, L * 0.99, Easing.linear) * LEAD_SLOTS.length;
  const crane = f > L * 0.62;
  const craneX = -70 * (1 - ramp(f, L * 0.42, L * 0.62));
  return (
    <>
      <Stage cam={cam}>
        <Atmos f={f} />
        <Campo modern />
        <Tower lean={lean} curve={1} />
        <Fence t={fence} />
        {cableT > 0 && <Cables t={cableT} lean={lean} curve={1} />}
        <LeadStack n={lead} />
        <group position={[craneX, 0, 0]}><MobileCrane f={f} on={crane} /></group>
        <Person position={[-29, 0, 13]} rotY={-0.5} pose="point" seed={91} head="hardhat" outfit="#f2a900" pants="#2c3442" />
        <Person position={[-22, 0, 17]} rotY={-2.2} pose="stand" seed={92} head="hardhat" outfit="#f2a900" pants="#2c3442" />
        <Person position={[-17, 0, -15]} rotY={0.6} pose="stand" seed={93} head="hardhat" headColor="#f4f4f4" outfit="#e6e6e0" pants="#2c3442" />
      </Stage>
      <Sequence durationInFrames={Math.round(L * 0.5)} layout="none">
        <Headline top="BY 1990" big={`${lean.toFixed(1)}°`} sub="and still moving" delay={2} y={150} bigSize={150} bigColor={lean > 5.4 ? '#FFD9D4' : C.white} />
      </Sequence>
      <Sequence from={Math.round(L * 0.44)} durationInFrames={Math.round(L * 0.2)} layout="none">
        <Tag text="CLOSED" x={540} y={1100} anchor="center" delay={0} size={84} bg={C.red} fg={C.white} />
      </Sequence>
      <Sequence from={Math.round(L * 0.55)} layout="none">
        <Pin p={[-48, 8, 8]} cam={cam} text="STEEL CABLES" delay={6} size={48} dy={-140} />
      </Sequence>
      <Sequence from={Math.round(L * 0.72)} layout="none">
        <Pin p={[-11, 5, 0]} cam={cam} text="LEAD ON THE HIGH SIDE" delay={4} size={46} dy={320} />
      </Sequence>
      <Caption text="About 900 tonnes of lead" delay={Math.round(L * 0.74)} bottom={290} />
    </>
  );
};

// ============================================================ S7 the clever part
const HOLES: {tip: [number, number]; t0: number}[] = [
  {tip: [-10.5, -3.6], t0: 0.02},
  {tip: [-7.5, -4.2], t0: 0.13},
  {tip: [-4.5, -4.9], t0: 0.24},
  {tip: [-1.8, -5.5], t0: 0.35},
  {tip: [-9, -5.4], t0: 0.46},
];
const ENTRY: [number, number] = [-18, -0.3];

const Rig: React.FC<{f: number}> = ({f}) => {
  const s = useMat('steel_painted_red');
  const st = useMat('steel');
  const d = new THREE.Vector2(ENTRY[0] - HOLES[1].tip[0], ENTRY[1] - HOLES[1].tip[1]).normalize();
  const top: [number, number, number] = [ENTRY[0] + d.x * 9, ENTRY[1] + d.y * 9, 7];
  return (
    <group>
      <mesh position={[-24, 0.5, 6.4]} material={s} castShadow>
        <boxGeometry args={[9, 1, 3.6]} />
      </mesh>
      <Beam a={[ENTRY[0], ENTRY[1], 7]} b={top} r={0.3} square tex="steel" />
      <Beam a={[top[0], 0.8, 7]} b={top} r={0.14} tex="steel_painted_red" />
      <mesh position={[ENTRY[0] + d.x * (3 + Math.sin(f * 0.2) * 0.4), ENTRY[1] + d.y * (3 + Math.sin(f * 0.2) * 0.4), 7]} material={st} castShadow>
        <boxGeometry args={[1, 1, 1]} />
      </mesh>
      <Person position={[-25.5, 1, 6.5]} rotY={0} pose="stand" seed={95} head="hardhat" outfit="#f2a900" pants="#2c3442" />
      <Person position={[-15.5, 0, 7]} rotY={2.8} pose="point" seed={96} head="hardhat" outfit="#f2a900" pants="#2c3442" />
    </group>
  );
};

const Bores: React.FC<{f: number; L: number}> = ({f, L}) => {
  const st = useMat('steel', {tint: '#d6dbe0'});
  const voidM = usePlainMat('#141821', 0.8);
  const spoil = usePlainMat('#7a6a4c', 0.9);
  const z = SECTION_Z + 0.16;
  return (
    <group>
      {HOLES.map((h, i) => {
        const dur = 0.28;
        const a = h.t0 * L * 0.72;
        const out = ramp(f, a, a + dur * L * 0.5);
        const back = ramp(f, a + dur * L * 0.55, a + dur * L * 0.78);
        const ext = out * (1 - back);
        const dx = h.tip[0] - ENTRY[0], dy = h.tip[1] - ENTRY[1];
        const len = Math.hypot(dx, dy) * ext;
        const ang = Math.atan2(dy, dx);
        const voidK = ramp(f, a + dur * L * 0.4, a + dur * L * 0.5) * (1 - ramp(f, a + dur * L * 0.9, a + dur * L * 1.6));
        return (
          <group key={i}>
            {len > 0.05 && (
              <group position={[ENTRY[0], ENTRY[1], z]} rotation={[0, 0, ang]}>
                <mesh position={[len / 2, 0, 0]} rotation={[0, 0, Math.PI / 2]} material={st}>
                  <cylinderGeometry args={[0.2, 0.2, len, 8]} />
                </mesh>
                <mesh position={[len + 0.3, 0, 0]} rotation={[f * 0.5, 0, -Math.PI / 2]} material={st}>
                  <coneGeometry args={[0.32, 0.8, 6]} />
                </mesh>
              </group>
            )}
            {voidK > 0.01 && (
              <mesh position={[h.tip[0], h.tip[1], z - 0.1]} rotation={[0, 0, ang]} scale={[1.5 * voidK, 0.42 * voidK, 0.05]} material={voidM}>
                <sphereGeometry args={[1, 16, 10]} />
              </mesh>
            )}
            {out > 0 && back < 1 && Array.from({length: 7}, (_, j) => {
              const u = ((f * 0.03 + j / 7) % 1) * ext;
              const us = (1 - u);
              return <mesh key={j} position={[ENTRY[0] + dx * us * ext, ENTRY[1] + dy * us * ext, z + 0.32]} material={spoil} scale={0.3}><icosahedronGeometry args={[1, 0]} /></mesh>;
            })}
          </group>
        );
      })}
    </group>
  );
};

const SpoilHeap: React.FC<{k: number}> = ({k}) => {
  const m = useMat('dirt', {tint: '#8f7a55'});
  return (
    <mesh position={[-33, 0, 5]} scale={[1 + 3.5 * k, Math.max(0.05, k * 2.2), 1 + 3 * k]} material={m} castShadow receiveShadow>
      <coneGeometry args={[1, 1, 16, 1]} />
    </mesh>
  );
};

const S7: React.FC = () => {
  const f = useCurrentFrame();
  const L = LEN[6];
  const lean = LEAN_1990 - (LEAN_1990 - LEAN_NOW) * ramp(f, L * 0.36, L * 0.94, Easing.inOut(Easing.sin));
  const cam = groundSafe(camPath(f, [
    {t: 0, pos: [-13, 4, 74], target: [-13, -1, SECTION_Z], fov: 46},
    {t: L * 0.56, pos: [-11, 4, 70], target: [-11, -1, SECTION_Z], fov: 46},
    {t: L * 0.82, pos: [-6, 12, 150], target: [-4, 22, SECTION_Z], fov: 42},
    {t: L, pos: [-6, 12, 152], target: [-4, 22, SECTION_Z], fov: 42},
  ]), secH);
  const nowTop = axisAt(TOP, lean, 1).p;
  const wide = ramp(f, L * 0.78, L * 0.84);
  const [ax, ay] = toScreen([nowTop[0], nowTop[1] + 4, 0], cam);
  return (
    <>
      <Stage cam={cam}>
        <Atmos f={f} target={[-8, 12, 0]} />
        <Campo section />
        <Tower lean={lean} curve={1} />
        <Cables t={1} lean={lean} curve={1} />
        <LeadStack n={LEAD_SLOTS.length} />
        <SoilSection lean={lean} dense={0.75} />
        <Rig f={f} />
        <Bores f={f} L={L} />
        <SpoilHeap k={ramp(f, L * 0.1, L * 0.7, Easing.linear)} />
      </Stage>
      <NS y={wide > 0 ? 1370 : 1370} delay={4} />
      <Sequence durationInFrames={Math.round(L * 0.6)} layout="none">
        <Pin p={[-13, -2, SECTION_Z]} cam={cam} text="ANGLED DRILLS" delay={8} size={50} dy={140} />
        <Pin p={[-7, -6, SECTION_Z]} cam={cam} text="SOIL OUT, BIT BY BIT" delay={Math.round(L * 0.26)} size={46} dy={120} />
      </Sequence>
      <Caption text="41 holes under the north side" delay={Math.round(L * 0.08)} bottom={290} />
      {wide > 0 && (
        <>
          <Arrow2 x={ax - 70} y={ay - 30} rot={90} size={150} opacity={wide} color={C.yellow} />
          <Tag text="TIPS BACK" x={ax - 60} y={ay - 130} anchor="center" delay={Math.round(L * 0.8)} size={50} />
        </>
      )}
    </>
  );
};

// ============================================================ S8 payoff
const S8: React.FC = () => {
  const f = useCurrentFrame();
  const L = LEN[7];
  const cam = groundSafe(camPath(f, [
    {t: 0, pos: [-70, 60, 250], target: [-38, 25, 32], fov: 46},
    {t: L, pos: [-62, 44, 226], target: [-27, 28, 30], fov: 46},
  ]), campoH, 3);
  return (
    <>
      <Stage cam={cam}>
        <Atmos f={f} golden={1} target={[0, 24, 0]} shadow={90} />
        <Campo modern />
        <Tower lean={LEAN_NOW} curve={1} />
        <Person {...walkAlong([-6, 0, 30], 0.1, f, 1.3, campoH)} seed={3} outfit="#d8413a" pants="#2d3a55" />
        <Person {...walkAlong([-9, 0, 32], 0.1, f + 12, 1.3, campoH)} seed={5} outfit="#f0f0ea" pants="#58605c" head="hat" headColor="#e8dcc0" />
        <Person {...walkAlong([14, 0, 34], 3.0, f, 1.2, campoH)} seed={12} outfit="#2a86c8" pants="#d9c9a6" />
        <Person position={[-13, 0, 25]} rotY={-0.4} pose="push" legs="still" seed={6} outfit="#2a86c8" pants="#d9c9a6" />
      </Stage>
      <Headline top="SOIL REMOVED" big="38 M³" sub="about 70 tonnes" delay={4} y={150} bigSize={150} />
      <Tag text="ABOUT 0.5° UNDONE" x={540} y={1350} anchor="center" delay={Math.round(VO.durations[7] * FPS * 0.38)} size={62} />
      <Caption text="Stable for at least 200 years" delay={Math.round(VO.durations[7] * FPS * 0.66)} bottom={290} />
    </>
  );
};

// ============================================================ timeline
const SCENES = [S1, S2, S3, S4, S5, S6, S7, S8];

export const Pisa: React.FC = () => (
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
        <Audio src={staticFile(`vo/ep012-pisa_${i}.wav`)} />
      </Sequence>
    ))}
    <Watermark />
  </AbsoluteFill>
);

export const PISA_START = START;
export const PISA_LEN = LEN;
