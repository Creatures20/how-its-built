// Episode 13 (Format B): Retired shipping container -> real home (ground, walls, condensation, floor, roof).
// Look: snowy spruce clearing at a cold blue dawn, oxide-red corrugated steel, hi-vis workers; ends at blue hour with warm windows.
import React, {useEffect, useMemo} from 'react';
import {AbsoluteFill, Audio, interpolate, Sequence, staticFile, useCurrentFrame, useVideoConfig, Easing} from 'remotion';
import {ThreeCanvas} from '@remotion/three';
import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import VO from './ep013-container-vo.json';
import {AssetProvider, GroundPatch, Renderer, SkyDome, Sun, TexName, useMat, usePlainMat, uvBox} from '../hib/pbr';
import {KIT_TEXTURES, Person, ScaffoldBay, Terrain, Water, rnd, walkAlong} from '../hib/models';
import {CameraRig} from '../hib/three';
import {Cam, camPath, groundSafe, toScreen} from '../hib/project';
import {C, Caption, Grade, Headline, ProbFix, SceneFade, Tag, Watermark} from '../hib/ui';

// ============================================================ timing
const FPS = 30;
const VO_DELAY = 5;
const sceneLen = (i: number, tail: number) => Math.ceil((VO.durations[i] + tail) * FPS) + VO_DELAY;
const LEN = [sceneLen(0, 0.35), sceneLen(1, 0.35), sceneLen(2, 0.35), sceneLen(3, 0.35), sceneLen(4, 0.35), sceneLen(5, 0.35), sceneLen(6, 0.35), sceneLen(7, 1.2)];
const START = LEN.map((_, i) => LEN.slice(0, i).reduce((a, b) => a + b, 0));
export const CONTAINER_DURATION = LEN.reduce((a, b) => a + b, 0);
/** frame (local to scene i) at which word `w` is spoken (estimated from character position). */
const wordAt = (i: number, w: string) => {
  const k = VO.lines[i].indexOf(w);
  if (k < 0) throw new Error(`word "${w}" not in line ${i}`);
  return Math.round(VO_DELAY + (k / VO.lines[i].length) * VO.durations[i] * FPS);
};

const cl = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
const ramp = (f: number, a: number, b: number, ease = Easing.inOut(Easing.cubic)) => interpolate(f, [a, b], [0, 1], {...cl, easing: ease});

const TEXTURES: TexName[] = [
  ...KIT_TEXTURES, 'container_paint', 'spray_foam', 'ply_floor', 'snow', 'dirt', 'concrete', 'concrete_formed', 'steel', 'iron_dark',
  'plaster_white', 'water', 'steel_rusty',
];

// ============================================================ layout (metres). Container long axis = X, front wall faces +Z (camera side).
const L = 12.19, W = 2.44, H = 2.9;
const PIER = 0.55; // top of the piers: underside of the box when it sits on them
const FLOOR = 0.16; // ply top above the underside
const RED = '#a8412a';
const XCUT = 2.6; // section plane of the cutaway views (everything at x > XCUT is removed)
const NOCUT = 99;

type Op = {x0: number; x1: number; y0: number; y1: number};
const DOORWAY: Op = {x0: -1.4, x1: 1.6, y0: FLOOR + 0.02, y1: 2.45};
const WINDOW: Op = {x0: -4.7, x1: -2.7, y0: 0.95, y1: 2.3};
const WINDOW2: Op = {x0: 3.2, x1: 4.7, y0: 0.95, y1: 2.3};
const FRONT_OPS = [WINDOW, DOORWAY, WINDOW2];
const REAR_OP: Op = {x0: -1.2, x1: 1.2, y0: 1.1, y1: 2.2};

const SUN_DAWN: [number, number, number] = [0.72, 0.33, 0.6];
const SUN_DUSK: [number, number, number] = [-0.8, 0.09, 0.3];

/** Snowy clearing: flat for the site, gentle drifts, then spruce-covered hills and mountains. */
const groundH = (x: number, z: number) => {
  const r = Math.hypot(x, z * 1.15);
  const k = THREE.MathUtils.smoothstep(r, 20, 80);
  const m = THREE.MathUtils.smoothstep(r, 90, 230);
  return k * (1.4 * Math.sin(x * 0.09 + 1) * Math.cos(z * 0.07) + 3 + 0.05 * r) + m * (24 + 15 * Math.sin(x * 0.019 + 2) * Math.cos(z * 0.023) + 8 * Math.sin(x * 0.05 + z * 0.04));
};

// ============================================================ bend: exaggerated sag of the cut box (vertex shader, shared uniform)
const BEND = {value: 0};
const bendify = (m: THREE.MeshStandardMaterial) => {
  const mm = m.clone();
  mm.onBeforeCompile = (sh) => {
    sh.uniforms.uBend = BEND;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uBend;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vec4 bw = modelMatrix * vec4(transformed, 1.0);
transformed.y -= uBend * cos(3.14159 * clamp(bw.x / ${L.toFixed(2)}, -0.5, 0.5)) * (0.3 + 0.7 * clamp((bw.y - ${PIER.toFixed(2)}) / ${H.toFixed(2)}, 0.0, 1.0));`);
  };
  mm.customProgramCacheKey = () => 'bend';
  return mm;
};
const useBendMat = (tex: TexName, o: Parameters<typeof useMat>[1] = {}) => {
  const base = useMat(tex, o);
  return useMemo(() => bendify(base), [base]);
};

// ============================================================ geometry helpers
/** Corrugated sheet in the (u,v) plane, ribs running along v. h(u) = trapezoidal profile, pitch 0.278 m, depth d. Absolute u, so pieces line up. */
const wave = (u: number, d: number) => {
  const P = 0.278;
  const t = ((u % P) + P) % P / P;
  const k = t < 0.3 ? 0 : t < 0.4 ? (t - 0.3) / 0.1 : t < 0.8 ? 1 : t < 0.9 ? 1 - (t - 0.8) / 0.1 : 0;
  return k * d;
};
const sheet = (u0: number, u1: number, v0: number, v1: number, d: number, ts: number, map: (u: number, v: number, h: number) => [number, number, number]) => {
  const P = 0.278;
  const steps = [0, 0.3, 0.4, 0.8, 0.9];
  const us: number[] = [u0];
  for (let n = Math.floor(u0 / P); n * P < u1; n++) for (const s of steps) {
    const u = (n + s) * P;
    if (u > u0 + 1e-4 && u < u1 - 1e-4) us.push(u);
  }
  us.push(u1);
  const pos: number[] = [], uv: number[] = [];
  for (let i = 0; i < us.length - 1; i++) {
    const a = us[i], b = us[i + 1];
    const A = map(a, v0, wave(a, d)), Bb = map(b, v0, wave(b + (i === us.length - 2 ? -1e-5 : -1e-5), d)), Cc = map(b, v1, wave(b - 1e-5, d)), D = map(a, v1, wave(a, d));
    pos.push(...A, ...Bb, ...Cc, ...A, ...Cc, ...D);
    uv.push(a / ts, v0 / ts, b / ts, v0 / ts, b / ts, v1 / ts, a / ts, v0 / ts, b / ts, v1 / ts, a / ts, v1 / ts);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
};

/** Axis-aligned textured box from extents. Geometry rebuilt only when the size changes. seg splits along x (needed for the bend). */
const Bx: React.FC<{x: [number, number]; y: [number, number]; z: [number, number]; m: THREE.Material; ts?: number; xMax?: number; cast?: boolean; seg?: number}> = ({x, y, z, m, ts = 2, xMax = NOCUT, cast = true, seg = 1}) => {
  const x1 = Math.min(x[1], xMax);
  const r = (v: number) => Math.round(v * 1000) / 1000;
  const w = r(x1 - x[0]), h = r(y[1] - y[0]), d = r(z[1] - z[0]);
  const ok = w > 0.002 && h > 0.002 && d > 0.002;
  const g = useMemo(() => (ok ? uvBox(w, h, d, ts, [seg, 1, 1]) : null), [ok, w, h, d, ts, seg]);
  useEffect(() => () => g?.dispose(), [g]);
  if (!g) return null;
  return <mesh geometry={g} position={[(x[0] + x1) / 2, (y[0] + y[1]) / 2, (z[0] + z[1]) / 2]} material={m} castShadow={cast} receiveShadow />;
};

const Stick: React.FC<{a: [number, number, number]; b: [number, number, number]; r: number; m: THREE.Material; square?: boolean}> = ({a, b, r, m, square}) => {
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
  const mid = va.clone().add(vb).multiplyScalar(0.5);
  const len = va.distanceTo(vb);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
  return (
    <mesh position={mid} quaternion={q} scale={[r, len, r]} material={m} castShadow>
      {square ? <boxGeometry args={[2, 1, 2]} /> : <cylinderGeometry args={[1, 1, 1, 8]} />}
    </mesh>
  );
};

/** Glowing arrow (heat / weight / water). */
const Arrow: React.FC<{from: [number, number, number]; dir: [number, number, number]; len: number; color: string; opacity: number; r?: number}> = ({from, dir, len, color, opacity, r = 0.07}) => {
  const m = useMemo(() => new THREE.MeshBasicMaterial({color, transparent: true, depthWrite: false, fog: false, toneMapped: false}), [color]);
  m.opacity = opacity;
  const d = new THREE.Vector3(...dir).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
  if (opacity <= 0.01 || len <= 0.05) return null;
  const shaft = Math.max(0.01, len - r * 4);
  return (
    <group position={from} quaternion={q}>
      <mesh position={[0, shaft / 2, 0]} material={m}>
        <cylinderGeometry args={[r, r, shaft, 10]} />
      </mesh>
      <mesh position={[0, shaft + r * 2, 0]} material={m}>
        <coneGeometry args={[r * 2.4, r * 4, 12]} />
      </mesh>
    </group>
  );
};

/** Bright spark burst at a point (grinder / welder). */
const Sparks: React.FC<{at: [number, number, number]; f: number; on: number; n?: number; color?: string}> = ({at, f, on, n = 16, color = '#ffc56a'}) => {
  const m = useMemo(() => new THREE.MeshBasicMaterial({color, toneMapped: false, fog: false}), [color]);
  if (on <= 0.02) return null;
  return (
    <group position={at}>
      <pointLight intensity={5 * on} distance={7} decay={1.7} color="#ffb060" />
      {Array.from({length: n}, (_, i) => {
        const ph = ((f * 1.5 + rnd(i + 1) * 17) % 8) / 8;
        const a = rnd(i * 3 + 2) * Math.PI * 2;
        const s = 0.35 + rnd(i * 5 + 3);
        return <mesh key={i} material={m} position={[Math.cos(a) * s * ph * 0.85, 0.4 * s * ph - 1.6 * ph * ph, 0.12 + Math.abs(Math.sin(a)) * s * ph * 0.85]} scale={0.022 * (1 - ph * 0.6)}><sphereGeometry args={[1, 5, 4]} /></mesh>;
      })}
    </group>
  );
};

// ============================================================ landscape (static, cached)
const forestCache: {dark?: THREE.BufferGeometry; snow?: THREE.BufferGeometry; trunk?: THREE.BufferGeometry} = {};
const forest = () => {
  if (forestCache.dark) return forestCache as Required<typeof forestCache>;
  const dark: THREE.BufferGeometry[] = [], snow: THREE.BufferGeometry[] = [], trunk: THREE.BufferGeometry[] = [];
  const add = (x: number, z: number, s: number, seed: number) => {
    const y = groundH(x, z);
    const tr = new THREE.CylinderGeometry(0.13 * s, 0.24 * s, 3 * s, 7);
    tr.translate(x, y + 1.5 * s, z);
    trunk.push(tr);
    const tiers = 5;
    for (let i = 0; i < tiers; i++) {
      const R = (2.3 - i * 0.4) * s, h = 2.4 * s, cy = y + (2.1 + i * 1.35) * s;
      const c = new THREE.ConeGeometry(R, h, 9, 1, true);
      c.rotateY(rnd(seed + i) * 3);
      c.translate(x, cy, z);
      dark.push(c.toNonIndexed());
      // snow lying on the upper part of each tier
      const sc = new THREE.ConeGeometry(R * 0.78, h * 0.72, 9, 1, true);
      sc.rotateY(rnd(seed + i) * 3);
      sc.translate(x, cy + h * 0.15 + 0.03 * s, z);
      snow.push(sc.toNonIndexed());
    }
  };
  // ragged ring of spruces around the clearing, thicker further out
  for (let i = 0; i < 150; i++) {
    const a = rnd(i * 3 + 1) * Math.PI * 2;
    const r = 22 + Math.pow(rnd(i * 5 + 2), 0.7) * 95;
    const x = Math.cos(a) * r, z = Math.sin(a) * r * 0.95;
    add(x, z, 0.85 + rnd(i * 7 + 3) * 0.95, i + 1);
  }
  forestCache.dark = mergeGeometries(dark);
  forestCache.snow = mergeGeometries(snow);
  forestCache.trunk = mergeGeometries(trunk.map((t) => t.toNonIndexed()));
  return forestCache as Required<typeof forestCache>;
};

const Land: React.FC = () => {
  const needle = usePlainMat('#1f3a33', 0.95, 0, {envMapIntensity: 0.5, side: THREE.DoubleSide});
  const white = usePlainMat('#eaf0f8', 0.9, 0, {envMapIntensity: 0.6, side: THREE.DoubleSide});
  const bark = useMat('bark', {tint: '#7a6658'});
  const g = forest();
  return (
    <>
      <Terrain height={groundH} size={760} seg={260} tex="snow" texScale={7} tint="#eef3fb" steep={[0.56, 0.6, 0.68]} matte />
      <mesh geometry={g.dark} material={needle} castShadow />
      <mesh geometry={g.snow} material={white} castShadow />
      <mesh geometry={g.trunk} material={bark} castShadow />
    </>
  );
};

/** Sky, sun, haze. d: 0 cold dawn .. 1 blue hour. */
const Atmos: React.FC<{f: number; d?: number; shadow?: number; target?: [number, number, number]; res?: number}> = ({f, d = 0, shadow = 16, target = [0, 1.5, 0], res = 4096}) => {
  const dir = SUN_DAWN.map((v, i) => v + (SUN_DUSK[i] - v) * d) as [number, number, number];
  const sunCol = new THREE.Color('#ffd3ad').lerp(new THREE.Color('#ff9a5c'), d).getStyle();
  const hor = new THREE.Color('#f0cdbb').lerp(new THREE.Color('#f09a66'), d).getStyle();
  const top = new THREE.Color('#4a6ea6').lerp(new THREE.Color('#1c2c5e'), d).getStyle();
  const fogC = new THREE.Color('#c9d3e4').lerp(new THREE.Color('#6c6c8e'), d).getStyle();
  return (
    <>
      <Renderer exposure={0.98 - 0.22 * d} envIntensity={0.55 - 0.3 * d} envRotation={1.2} />
      <SkyDome top={top} horizon={hor} bottom="#a9b6cc" sunDir={dir} sunColor={sunCol} clouds={0.5 - 0.15 * d} time={f / 30} />
      <Sun dir={dir} intensity={2.7 - 1.6 * d} color={sunCol} shadowSize={shadow} shadowRes={res} target={target} skyColor={d > 0.5 ? '#7c8cc0' : '#bcd0ee'} groundColor="#b4bfd2" hemi={0.85 - 0.45 * d} />
      <fog attach="fog" args={[fogC, 60, 520]} />
    </>
  );
};

/** Gentle falling snow around a point (points re-positioned every frame from the local frame). */
const Snowfall: React.FC<{f: number; at?: [number, number, number]; n?: number; speed?: number}> = ({f, at = [0, 0, 0], n = 420, speed = 0.045}) => {
  const m = useMemo(() => new THREE.PointsMaterial({color: '#ffffff', size: 0.055, transparent: true, opacity: 0.85, depthWrite: false}), []);
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
    return g;
  }, [n]);
  const p = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < n; i++) {
    const y = 14 - (((rnd(i * 2 + 1) * 14 + f * speed * (0.7 + rnd(i) * 0.6)) % 14));
    p.setXYZ(i, (rnd(i * 3 + 5) - 0.5) * 34 + Math.sin(f * 0.03 + i) * 0.3, y, (rnd(i * 7 + 9) - 0.5) * 34 + Math.cos(f * 0.025 + i) * 0.3);
  }
  p.needsUpdate = true;
  return <points geometry={geo} material={m} position={at} frustumCulled={false} />;
};

// ============================================================ the box
const pieces = (ops: Op[], x0 = -L / 2 + 0.12, x1 = L / 2 - 0.12, y0 = 0.14, y1 = H - 0.1): Op[] => {
  const s = [...ops].sort((a, b) => a.x0 - b.x0);
  const out: Op[] = [];
  let x = x0;
  for (const o of s) {
    if (o.x0 > x) out.push({x0: x, x1: o.x0, y0, y1});
    if (o.y0 > y0) out.push({x0: o.x0, x1: o.x1, y0, y1: o.y0});
    if (o.y1 < y1) out.push({x0: o.x0, x1: o.x1, y0: o.y1, y1});
    x = o.x1;
  }
  if (x < x1) out.push({x0: x, x1, y0, y1});
  return out;
};

const DEPTH = 0.036;
const wallGeo = (r: Op, z: number, sgn: 1 | -1, xMax: number) =>
  sheet(r.x0, Math.min(r.x1, xMax), r.y0, r.y1, DEPTH, 1.6, (u, v, h) => (sgn > 0 ? [u, v, z - DEPTH + h] : [u, v, z + DEPTH - h]));

const Wall: React.FC<{rects: Op[]; z: number; sgn: 1 | -1; m: THREE.Material; xMax: number}> = ({rects, z, sgn, m, xMax}) => {
  const g = useMemo(() => mergeGeometries(rects.filter((r) => r.x0 < xMax - 0.01).map((r) => wallGeo(r, z, sgn, xMax))), [rects, z, sgn, xMax]);
  return <mesh geometry={g} material={m} castShadow receiveShadow />;
};

/** Frame members, castings, cross-members, roof sheet. Cargo doors on the +x end, corrugated wall on the -x end. */
const Shell: React.FC<{xMax: number; openFront: boolean; rearOpen: boolean; bare?: boolean}> = ({xMax, openFront, rearOpen}) => {
  const paint = useBendMat('container_paint', {tint: RED, metalness: 0.25, roughness: 0.75, side: THREE.DoubleSide});
  const rail = useBendMat('container_paint', {tint: '#8f3722', metalness: 0.3, roughness: 0.7});
  const under = useBendMat('steel_rusty', {tint: '#6b4a3a', roughness: 0.9});
  const casting = useBendMat('container_paint', {tint: '#d9c0a4', metalness: 0.3, roughness: 0.6});
  const hole = usePlainMat('#141210', 0.8);
  const rod = useBendMat('steel', {tint: '#b8b6b0', metalness: 0.6, roughness: 0.4});
  const x0 = -L / 2, x1 = L / 2, z1 = W / 2;
  const frontRects = useMemo(() => (openFront ? pieces(FRONT_OPS) : pieces([])), [openFront]);
  const rearRects = useMemo(() => (rearOpen ? pieces([REAR_OP]) : pieces([])), [rearOpen]);
  const roofG = useMemo(() => sheet(x0 + 0.1, Math.min(x1 - 0.1, xMax), -z1 + 0.04, z1 - 0.04, 0.022, 1.6, (u, v, h) => [u, H - 0.03 + h, -v]), [xMax]);
  const endG = useMemo(() => sheet(-z1 + 0.13, z1 - 0.13, 0.14, H - 0.1, DEPTH, 1.6, (u, v, h) => [x0 - h + DEPTH, v, -u]), []);
  const crossG = useMemo(() => {
    const parts: THREE.BufferGeometry[] = [];
    for (let x = x0 + 0.3; x < Math.min(x1, xMax) - 0.05; x += 0.3) {
      const g = uvBox(0.09, 0.12, W - 0.2, 1, [1, 1, 1]);
      g.translate(x, 0.05, 0);
      parts.push(g);
    }
    return mergeGeometries(parts);
  }, [xMax]);
  const corners = [x0 + 0.09, x1 - 0.09].flatMap((x) => [z1 - 0.075, -z1 + 0.075].map((z) => [x, z] as [number, number])).filter(([x]) => x < xMax);
  const hasEnd = xMax > x1;
  return (
    <group>
      <Wall rects={frontRects} z={z1} sgn={1} m={paint} xMax={xMax} />
      <Wall rects={rearRects} z={-z1} sgn={-1} m={paint} xMax={xMax} />
      <mesh geometry={endG} material={paint} castShadow receiveShadow />
      <mesh geometry={roofG} material={paint} castShadow receiveShadow />
      <mesh geometry={crossG} material={under} castShadow />
      {/* long rails */}
      {[z1 - 0.08, -z1 + 0.08].map((z) => (
        <React.Fragment key={z}>
          <Bx x={[x0, x1]} y={[0, 0.16]} z={[z - 0.08, z + 0.08]} m={rail} ts={1.5} xMax={xMax} seg={40} />
          <Bx x={[x0, x1]} y={[H - 0.1, H]} z={[z - 0.07, z + 0.07]} m={rail} ts={1.5} xMax={xMax} seg={40} />
        </React.Fragment>
      ))}
      {/* end rails */}
      <Bx x={[x0, x0 + 0.14]} y={[H - 0.2, H]} z={[-z1, z1]} m={rail} ts={1.5} />
      <Bx x={[x0, x0 + 0.14]} y={[0, 0.2]} z={[-z1, z1]} m={rail} ts={1.5} />
      {corners.map(([x, z], i) => (
        <Bx key={i} x={[x - 0.08, x + 0.08]} y={[0.1, H - 0.1]} z={[z - 0.07, z + 0.07]} m={rail} ts={1.5} />
      ))}
      {/* corner castings */}
      {corners.flatMap(([x, z], i) => [0.06, H - 0.06].map((y, k) => (
        <group key={`${i}${k}`} position={[x, y, z]}>
          <mesh material={casting} castShadow><boxGeometry args={[0.18, 0.12, 0.16]} /></mesh>
          <mesh position={[0, 0, z > 0 ? 0.081 : -0.081]} material={hole}><boxGeometry args={[0.1, 0.05, 0.004]} /></mesh>
        </group>
      )))}
      {/* cargo doors on the +x end */}
      {hasEnd && (
        <group position={[x1 - 0.02, 0, 0]}>
          <Bx x={[0, 0.03]} y={[0.12, H - 0.1]} z={[-z1 + 0.14, -0.01]} m={rail} ts={1.5} />
          <Bx x={[0, 0.03]} y={[0.12, H - 0.1]} z={[0.01, z1 - 0.14]} m={rail} ts={1.5} />
          {[-0.85, -0.3, 0.3, 0.85].map((z) => (
            <React.Fragment key={z}>
              <mesh position={[0.05, H / 2, z]} material={rod} castShadow><cylinderGeometry args={[0.018, 0.018, H - 0.2, 8]} /></mesh>
              <mesh position={[0.06, 1.1, z + 0.08]} rotation={[Math.PI / 2, 0, 0]} material={rod} castShadow><cylinderGeometry args={[0.012, 0.012, 0.24, 6]} /></mesh>
            </React.Fragment>
          ))}
        </group>
      )}
    </group>
  );
};

const OpFrame: React.FC<{o: Op; z: number; t: number; m: THREE.Material; xMax: number}> = ({o, z, t, m, xMax}) => {
  const S = 0.09;
  const zz: [number, number] = [z - 0.09, z + 0.075];
  if (t <= 0.01 || o.x0 > xMax) return null;
  const k = (a: number, b: number) => ramp(t, a, b, Easing.out(Easing.cubic));
  const jl = k(0, 0.4), hd = k(0.3, 0.7), jr = k(0.1, 0.5), sl = k(0.5, 1);
  const w = o.x1 - o.x0, h = o.y1 - o.y0;
  return (
    <>
      <Bx x={[o.x0 - S, o.x0 + 0.005]} y={[o.y0 - S, o.y0 - S + (h + 2 * S) * jl]} z={zz} m={m} ts={1} />
      <Bx x={[o.x1 - 0.005, o.x1 + S]} y={[o.y0 - S, o.y0 - S + (h + 2 * S) * jr]} z={zz} m={m} ts={1} xMax={xMax} />
      <Bx x={[o.x0, o.x0 + w * hd]} y={[o.y1 - 0.005, o.y1 + S]} z={zz} m={m} ts={1} xMax={xMax} />
      <Bx x={[o.x0, o.x0 + w * sl]} y={[o.y0 - S, o.y0 + 0.005]} z={zz} m={m} ts={1} xMax={xMax} />
    </>
  );
};

/** Corrugated panel still filling an opening. out: 0 in place .. 1 lifted away. fall: tip outward about the bottom edge. */
const Panel: React.FC<{o: Op; z: number; sgn: 1 | -1; m: THREE.Material; out?: number; fall?: number; xMax: number}> = ({o, z, sgn, m, out = 0, fall = 0, xMax}) => {
  const g = useMemo(() => wallGeo(o, z, sgn, xMax), [o, z, sgn, xMax]);
  if (out >= 0.995 || o.x0 > xMax) return null;
  if (fall > 0) {
    const a = fall * 1.5;
    return (
      <group position={[0, o.y0, z]} rotation={[a, 0, 0]}>
        <mesh geometry={g} position={[0, -o.y0, -z]} material={m} castShadow receiveShadow />
      </group>
    );
  }
  return <mesh geometry={g} position={[0, out * 0.7, sgn * out * 3.5]} scale={1 - 0.03 * out} material={m} castShadow receiveShadow />;
};

const Glaze: React.FC<{t: number; glow: number; xMax: number}> = ({t, glow, xMax}) => {
  const glass = useMemo(() => new THREE.MeshStandardMaterial({color: '#7f97ad', roughness: 0.06, metalness: 0.3, envMapIntensity: 1.6, transparent: true, opacity: 0.35, depthWrite: false, emissive: new THREE.Color('#ffb45e'), emissiveIntensity: 0}), []);
  glass.emissiveIntensity = glow * 1.4;
  glass.opacity = 0.35 + 0.55 * glow;
  glass.color.set(glow > 0.3 ? '#a58055' : '#7f97ad');
  const fr = usePlainMat('#23201d', 0.5, 0.3);
  const door = useMat('wood_oak', {tint: '#b98a5c'});
  if (t <= 0.01) return null;
  const pane = (o: Op, z: number, split: number, key: string) => (o.x0 > xMax ? null : (
    <group key={key} position={[(o.x0 + o.x1) / 2, ((o.y0 + o.y1) / 2) + (1 - t) * 2.5, z]}>
      <mesh material={glass}><boxGeometry args={[o.x1 - o.x0, o.y1 - o.y0, 0.03]} /></mesh>
      {Array.from({length: split + 1}, (_, i) => (
        <mesh key={i} position={[-(o.x1 - o.x0) / 2 + (i * (o.x1 - o.x0)) / split, 0, 0.02]} material={fr}><boxGeometry args={[0.05, o.y1 - o.y0, 0.05]} /></mesh>
      ))}
      <mesh position={[0, (o.y1 - o.y0) / 2, 0.02]} material={fr}><boxGeometry args={[o.x1 - o.x0, 0.05, 0.05]} /></mesh>
      <mesh position={[0, -(o.y1 - o.y0) / 2, 0.02]} material={fr}><boxGeometry args={[o.x1 - o.x0, 0.05, 0.05]} /></mesh>
    </group>
  ));
  return (
    <>
      {pane(WINDOW, W / 2 - 0.02, 2, 'a')}
      {pane(WINDOW2, W / 2 - 0.02, 2, 'b')}
      {pane(REAR_OP, -W / 2 + 0.02, 2, 'r')}
      {pane({...DOORWAY, x0: DOORWAY.x0, x1: DOORWAY.x0 + 2.0}, W / 2 - 0.02, 2, 'd')}
      <Bx x={[DOORWAY.x0 + 2.0, DOORWAY.x1]} y={[DOORWAY.y0, DOORWAY.y1 + (1 - t) * 2.5]} z={[W / 2 - 0.05, W / 2]} m={door} ts={1.5} />
    </>
  );
};

// ============================================================ layers inside
/** Spray foam on walls + ceiling for x in [xf, xMax] with thickness th. */
const Foam: React.FC<{xf: number; th: number; xMax: number; m: THREE.Material}> = ({xf, th, xMax, m}) => {
  const i = 0.05; // inside face of the steel
  const zF = W / 2 - i, zR = -W / 2 + i, top = H - 0.05, x1 = xMax;
  const front = useMemo(() => pieces(FRONT_OPS, -L / 2 + 0.15, Math.min(L / 2, xMax), FLOOR, top), [xMax, top]);
  const rear = useMemo(() => pieces([REAR_OP], -L / 2 + 0.15, Math.min(L / 2, xMax), FLOOR, top), [xMax, top]);
  const clampX = (r: Op): [number, number] => [Math.max(r.x0, xf), Math.min(r.x1, x1)];
  return (
    <>
      {front.map((r, k) => { const x = clampX(r); return x[1] > x[0] + 0.01 ? <Bx key={'f' + k} x={x} y={[r.y0, r.y1]} z={[zF - th, zF]} m={m} ts={1.3} /> : null; })}
      {rear.map((r, k) => { const x = clampX(r); return x[1] > x[0] + 0.01 ? <Bx key={'r' + k} x={x} y={[r.y0, r.y1]} z={[zR, zR + th]} m={m} ts={1.3} /> : null; })}
      <Bx x={[Math.max(xf, -L / 2 + 0.15), x1]} y={[top - th, top]} z={[zR, zF]} m={m} ts={1.3} />
      {xf < -L / 2 + 0.3 && <Bx x={[-L / 2 + 0.15, -L / 2 + 0.15 + th]} y={[FLOOR, top]} z={[zR, zF]} m={m} ts={1.3} />}
    </>
  );
};

/** What the section plane shows: steel skin, foam, lining, ply, cross-members. Exaggerated by a few cm so it reads on a phone. */
const SectionCap: React.FC<{foam: number; lined: boolean; ply: boolean; newFloor: number; x: number}> = ({foam, lined, ply, newFloor, x}) => {
  const steel = useMat('container_paint', {tint: '#7a2c1b', metalness: 0.2, roughness: 0.6});
  const fm = useMat('spray_foam', {});
  const lin = useMat('plaster_white', {tint: '#f4efe6'});
  const pl = useMat('ply_floor', {});
  const oak = useMat('wood_oak', {tint: '#dbb48a'});
  const X: [number, number] = [x - 0.012, x + 0.006];
  const t = 0.05;
  const top = H - 0.05, th = 0.11 * foam;
  return (
    <>
      <Bx x={X} y={[0.1, H]} z={[W / 2 - t, W / 2]} m={steel} ts={1} cast={false} />
      <Bx x={X} y={[0.1, H]} z={[-W / 2, -W / 2 + t]} m={steel} ts={1} cast={false} />
      <Bx x={X} y={[H - 0.05, H]} z={[-W / 2, W / 2]} m={steel} ts={1} cast={false} />
      <Bx x={X} y={[0, 0.1]} z={[-W / 2, W / 2]} m={steel} ts={1} cast={false} />
      {foam > 0.02 && (
        <>
          <Bx x={X} y={[FLOOR, top]} z={[W / 2 - t - th, W / 2 - t]} m={fm} ts={1} cast={false} />
          <Bx x={X} y={[FLOOR, top]} z={[-W / 2 + t, -W / 2 + t + th]} m={fm} ts={1} cast={false} />
          <Bx x={X} y={[top - th, top]} z={[-W / 2 + t, W / 2 - t]} m={fm} ts={1} cast={false} />
        </>
      )}
      {lined && (
        <>
          <Bx x={X} y={[FLOOR, top - th]} z={[W / 2 - t - th - 0.03, W / 2 - t - th]} m={lin} ts={1} cast={false} />
          <Bx x={X} y={[FLOOR, top - th]} z={[-W / 2 + t + th, -W / 2 + t + th + 0.03]} m={lin} ts={1} cast={false} />
          <Bx x={X} y={[top - th - 0.03, top - th]} z={[-W / 2 + t + th, W / 2 - t - th]} m={lin} ts={1} cast={false} />
        </>
      )}
      {ply && <Bx x={X} y={[0.1, FLOOR]} z={[-W / 2 + 0.05, W / 2 - 0.05]} m={pl} ts={1} cast={false} />}
      {newFloor > 0.5 && <Bx x={X} y={[0.1, FLOOR + 0.02]} z={[-W / 2 + 0.05, W / 2 - 0.05]} m={oak} ts={1} cast={false} />}
    </>
  );
};

const Interior: React.FC<{glow: number; flue: boolean}> = ({glow, flue}) => {
  const wood = useMat('wood_oak', {tint: '#c89a68'});
  const linen = useMat('linen', {tint: '#b6c4d6'});
  const blanket = useMat('linen', {tint: '#c0583c'});
  const dark = useMat('iron_dark', {tint: '#57595e'});
  const lamp = usePlainMat('#fff0c8', 0.4, 0, {emissive: new THREE.Color('#ffc978'), emissiveIntensity: 2.4});
  const y = FLOOR + 0.02;
  const zb = -W / 2 + 0.2;
  return (
    <group>
      {/* bed at the far end */}
      <Bx x={[-5.7, -3.9]} y={[y, y + 0.34]} z={[zb, zb + 1.5]} m={wood} ts={1.5} />
      <Bx x={[-5.7, -3.9]} y={[y + 0.34, y + 0.52]} z={[zb + 0.02, zb + 1.48]} m={linen} ts={1} />
      <Bx x={[-4.9, -3.9]} y={[y + 0.52, y + 0.56]} z={[zb, zb + 1.5]} m={blanket} ts={1} />
      {/* kitchen run along the rear wall */}
      <Bx x={[-2.2, 1.9]} y={[y, y + 0.88]} z={[zb, zb + 0.56]} m={wood} ts={1.5} />
      <Bx x={[-2.25, 1.95]} y={[y + 0.88, y + 0.92]} z={[zb - 0.02, zb + 0.6]} m={dark} ts={1.5} />
      {/* table */}
      <Bx x={[-0.6, 0.5]} y={[y + 0.72, y + 0.76]} z={[-0.1, 0.65]} m={wood} ts={1.5} />
      {[[-0.54, -0.05], [0.44, -0.05], [-0.54, 0.6], [0.44, 0.6]].map(([x, z], i) => (
        <Bx key={i} x={[x, x + 0.05]} y={[y, y + 0.72]} z={[z, z + 0.05]} m={dark} ts={1} />
      ))}
      {/* wood stove + flue */}
      <Bx x={[2.0, 2.5]} y={[y, y + 0.72]} z={[zb, zb + 0.5]} m={dark} ts={1} xMax={XCUT - 0.01} />
      {flue && <mesh position={[2.25, 2.72, zb + 0.25]} material={dark} castShadow><cylinderGeometry args={[0.07, 0.07, 3.76, 12]} /></mesh>}
      {[-3, 0].map((x) => (
        <mesh key={x} position={[x, H - 0.34, 0]} material={lamp}><sphereGeometry args={[0.08, 12, 8]} /></mesh>
      ))}
      <pointLight position={[0, H - 0.7, 0.1]} intensity={3 + 5 * glow} distance={9} decay={1.5} color="#ffcf98" />
      <pointLight position={[-3.2, H - 0.7, 0.1]} intensity={2 + 4 * glow} distance={8} decay={1.5} color="#ffcf98" />
    </group>
  );
};

/** Container floor sheets; n = how many have been pulled up. Each sheet flies out through the section plane onto a pile. */
const FLOOR_N = 6;
const sheetX = (i: number) => {
  const x0 = -L / 2 + 0.2, x1 = XCUT;
  const w = (x1 - x0) / FLOOR_N;
  return [x0 + i * w, x0 + (i + 1) * w] as const;
};

// ============================================================ the new roof
const ROOF = {zF: W / 2 + 1.05, zR: -W / 2 - 0.6, yF: H + 0.38, yR: H + 1.32, x0: -L / 2 - 0.7, x1: L / 2 + 0.7};
const roofY = (z: number) => ROOF.yF + ((z - ROOF.zF) / (ROOF.zR - ROOF.zF)) * (ROOF.yR - ROOF.yF);
const ROOF_ANGLE = Math.atan2(ROOF.yR - ROOF.yF, ROOF.zF - ROOF.zR);
const ROOF_LEN = Math.hypot(ROOF.yR - ROOF.yF, ROOF.zF - ROOF.zR);
const POST_X = [-6, -3, 0, 3, 6];

const NewRoof: React.FC<{frame: number; sheets: number; xMax: number}> = ({frame, sheets, xMax}) => {
  const steel = useMat('steel', {tint: '#3f4449', metalness: 0.5, roughness: 0.5});
  const clad = useMat('iron_dark', {tint: '#8d949c', metalness: 0.55, roughness: 0.42});
  const soffit = useMat('wood_pine', {tint: '#e8c79e', rotation: Math.PI / 2});
  const sn = useMat('snow', {tint: '#f2f6fc'});
  const N = 16;
  const sw = (ROOF.x1 - ROOF.x0) / N;
  const ribG = useMemo(() => {
    const parts: THREE.BufferGeometry[] = [];
    const g = uvBox(sw, 0.03, ROOF_LEN, 1.4);
    parts.push(g);
    for (const x of [-sw / 2, 0, sw / 2 - 0.0]) {
      const r = uvBox(0.04, 0.06, ROOF_LEN, 1.4);
      r.translate(x, 0.03, 0);
      parts.push(r);
    }
    return mergeGeometries(parts);
  }, [sw]);
  const snowG = useMemo(() => uvBox(sw + 0.01, 0.09, ROOF_LEN * 0.92, 5), [sw]);
  const posts = POST_X.filter((x) => x < xMax);
  const mz = (ROOF.zF + ROOF.zR) / 2, my = (ROOF.yF + ROOF.yR) / 2;
  const sx1 = Math.min(ROOF.x1, xMax);
  const soffG = useMemo(() => uvBox(sx1 - ROOF.x0, 0.02, ROOF_LEN, 2), [sx1]);
  return (
    <group>
      {posts.map((x, i) => {
        const t = ramp(frame, i * 0.1, 0.5 + i * 0.1);
        if (t <= 0.01) return null;
        const zs = [W / 2 - 0.08, -W / 2 + 0.08];
        return (
          <group key={x}>
            {zs.map((z) => <Stick key={z} a={[x, H, z]} b={[x, H + (roofY(z) - H - 0.04) * t, z]} r={0.05} m={steel} square />)}
            {t > 0.9 && <Stick a={[x, roofY(ROOF.zF) - 0.05, ROOF.zF]} b={[x, roofY(ROOF.zR) - 0.05, ROOF.zR]} r={0.05} m={steel} square />}
          </group>
        );
      })}
      {frame > 0.7 && [W / 2 - 0.08, -W / 2 + 0.08, ROOF.zF - 0.1].map((z) => <Stick key={z} a={[ROOF.x0, roofY(z) - 0.02, z]} b={[Math.min(ROOF.x1, xMax), roofY(z) - 0.02, z]} r={0.035} m={steel} square />)}
      {sheets >= 1 && <mesh geometry={soffG} position={[(ROOF.x0 + sx1) / 2, my - 0.012, mz]} rotation={[ROOF_ANGLE, 0, 0]} material={soffit} receiveShadow />}
      {Array.from({length: N}, (_, i) => {
        const t = ramp(sheets * N, i * 0.75, i * 0.75 + 2.2, Easing.out(Easing.cubic));
        const x = ROOF.x0 + (i + 0.5) * sw;
        if (t <= 0.01 || x > xMax) return null;
        return (
          <group key={i} position={[x, my + 0.02 + (1 - t) * 2.2, mz + (1 - t) * 3.0]} rotation={[ROOF_ANGLE, 0, 0]}>
            <mesh geometry={ribG} material={clad} castShadow receiveShadow />
            {t > 0.98 && <mesh geometry={snowG} position={[0, 0.09, 0.03]} material={sn} />}
          </group>
        );
      })}
    </group>
  );
};

// ============================================================ machines + site
const CraneTruck: React.FC<{hookY: number}> = ({hookY}) => {
  const y = usePlainMat('#e8a417', 0.45, 0.25);
  const dark = useMat('iron_dark', {tint: '#3f4045'});
  const glass = usePlainMat('#22303e', 0.1, 0.4);
  const cable = usePlainMat('#20201e', 0.6, 0.4);
  const P: [number, number, number] = [6.5, 0, -7.2]; // turret
  const tip: [number, number, number] = [0, 11.6, 0];
  const piv: [number, number, number] = [P[0], 2.4, P[2]];
  const hook: [number, number, number] = [0, hookY, 0];
  const corners: [number, number, number][] = [-1, 1].flatMap((sx) => [-1, 1].map((sz) => [sx * (L / 2 - 0.1), hookY - 3.4, sz * (W / 2 - 0.08)] as [number, number, number]));
  return (
    <group>
      {/* carrier */}
      <group position={[P[0] - 1.5, 0, P[2]]}>
        <mesh position={[0, 1.15, 0]} material={y} castShadow receiveShadow><boxGeometry args={[9, 0.7, 2.5]} /></mesh>
        <mesh position={[4.05, 2.1, 0]} material={y} castShadow><boxGeometry args={[1.5, 1.7, 2.4]} /></mesh>
        <mesh position={[4.45, 2.35, 0]} material={glass}><boxGeometry args={[0.76, 0.8, 2.3]} /></mesh>
        {[-3.4, -1.9, 1.0, 2.6, 4.0].flatMap((x) => [-1.1, 1.1].map((z) => (
          <mesh key={`${x}${z}`} position={[x, 0.55, z]} rotation={[Math.PI / 2, 0, 0]} material={dark} castShadow><cylinderGeometry args={[0.55, 0.55, 0.45, 18]} /></mesh>
        )))}
        {/* outriggers */}
        {[-3, 2.4].flatMap((x) => [-1, 1].map((s) => (
          <group key={`${x}${s}`}>
            <mesh position={[x, 0.95, s * 2.2]} material={dark} castShadow><boxGeometry args={[0.28, 0.24, 2.0]} /></mesh>
            <mesh position={[x, 0.45, s * 3.1]} material={dark} castShadow><cylinderGeometry args={[0.1, 0.1, 0.9, 10]} /></mesh>
            <mesh position={[x, 0.04, s * 3.1]} material={dark}><boxGeometry args={[0.6, 0.08, 0.6]} /></mesh>
          </group>
        )))}
      </group>
      <mesh position={[P[0], 1.85, P[2]]} material={y} castShadow><boxGeometry args={[2.6, 1.0, 2.2]} /></mesh>
      <Stick a={piv} b={tip} r={0.3} m={y} square />
      <Stick a={tip} b={hook} r={0.018} m={cable} />
      <mesh position={[0, hookY, 0]} material={dark} castShadow><boxGeometry args={[0.34, 0.5, 0.26]} /></mesh>
      {corners.map((c, i) => <Stick key={i} a={hook} b={c} r={0.016} m={cable} />)}
    </group>
  );
};

const Pier: React.FC<{x: number; z: number; t: number}> = ({x, z, t}) => {
  const conc = useMat('concrete_formed', {tint: '#c9c8c4'});
  const pl = useMat('steel', {tint: '#8a8e92', metalness: 0.6, roughness: 0.5});
  const pad = useMat('concrete', {tint: '#b9b9b6'});
  const h = PIER * t;
  if (t <= 0.01) return null;
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.03, 0]} material={pad} receiveShadow castShadow><cylinderGeometry args={[0.6, 0.66, 0.1, 22]} /></mesh>
      <mesh position={[0, h / 2, 0]} scale={[1, Math.max(0.02, t), 1]} material={conc} castShadow receiveShadow><cylinderGeometry args={[0.36, 0.42, PIER - 0.02, 22]} /></mesh>
      {t > 0.97 && <mesh position={[0, PIER - 0.012, 0]} material={pl} castShadow><boxGeometry args={[0.46, 0.02, 0.46]} /></mesh>}
    </group>
  );
};
const PIERS: [number, number][] = [[-L / 2 + 0.18, W / 2 - 0.16], [-L / 2 + 0.18, -W / 2 + 0.16], [0, W / 2 - 0.16], [0, -W / 2 + 0.16], [L / 2 - 0.18, W / 2 - 0.16], [L / 2 - 0.18, -W / 2 + 0.16]];

const HI = '#ee7f13';
const PANTS = '#2c3440';
type WP = {position: [number, number, number]; rotY: number; pose: 'hammer' | 'point' | 'stand' | 'push' | 'carry' | 'pull' | 'chisel'; seed: number; t?: number; legs?: 'kneel' | 'still'; tool?: 'none' | 'hammer'};
const Worker: React.FC<WP> = (p) => <Person {...p} outfit={HI} pants={PANTS} head="hardhat" />;

const Site: React.FC = () => <GroundPatch tex="dirt" w={19} d={8.5} position={[0, 0, 0]} tint="#a59a90" texScale={4} />;

// ============================================================ the box, assembled
type Build = {
  y: number; // underside height
  xMax: number;
  openFront?: boolean; rearOpen?: boolean;
  bigPanel?: number; winPanel?: number; panelFall?: number;
  frames?: number; glaze?: number; glow?: number;
  foamX?: number; foamT?: number;
  floor?: 'ply' | 'none' | 'new'; sheetsOut?: number; sheetsIn?: number;
  lined?: boolean; interior?: boolean; roofFrame?: number; roofSheets?: number;
};

const Box: React.FC<Build> = (b) => {
  const paint = useBendMat('container_paint', {tint: RED, metalness: 0.25, roughness: 0.75, side: THREE.DoubleSide});
  const frameM = useBendMat('steel', {tint: '#30343a', metalness: 0.5, roughness: 0.45});
  const foamM = useMat('spray_foam', {});
  const liningM = useMat('plaster_white', {tint: '#f4efe6'});
  const plyM = useMat('ply_floor', {});
  const oakM = useMat('wood_oak', {tint: '#fff2e0'});
  const bareM = usePlainMat('#26201c', 0.9);
  const {xMax, frames = 0, glaze = 0, glow = 0, foamT = 0, foamX = xMax, floor = 'ply', sheetsOut = 0, sheetsIn = 0} = b;
  const fz = W / 2;
  return (
    <group position={[0, b.y, 0]}>
      <Shell xMax={xMax} openFront={!!b.openFront} rearOpen={!!b.rearOpen} />
      {/* panels still in place */}
      {!b.openFront && null}
      {b.openFront && b.bigPanel !== undefined && <Panel o={DOORWAY} z={fz} sgn={1} m={paint} out={b.bigPanel} fall={b.panelFall} xMax={xMax} />}
      {b.openFront && b.winPanel !== undefined && <Panel o={WINDOW} z={fz} sgn={1} m={paint} out={b.winPanel} xMax={xMax} />}
      {b.openFront && b.winPanel !== undefined && <Panel o={WINDOW2} z={fz} sgn={1} m={paint} out={b.winPanel} xMax={xMax} />}
      {frames > 0 && FRONT_OPS.map((o, i) => <OpFrame key={i} o={o} z={fz} t={ramp(frames, i * 0.25, 0.5 + i * 0.25, Easing.linear)} m={frameM} xMax={xMax} />)}
      {frames >= 1 && b.rearOpen && <OpFrame o={REAR_OP} z={-fz} t={1} m={frameM} xMax={xMax} />}
      <Glaze t={glaze} glow={glow} xMax={xMax} />
      {/* floor */}
      {floor === 'ply' && Array.from({length: FLOOR_N}, (_, i) => {
        const [a, c] = sheetX(i);
        const k = xMax < NOCUT ? [a, Math.min(c, xMax)] : [a, c];
        const t = ramp(sheetsOut * FLOOR_N, i * 0.82, i * 0.82 + 1.5);
        if (t >= 0.999) return null;
        const lift = Math.sin(Math.min(1, t * 2.2) * Math.PI * 0.5) * 0.85;
        const dx = t > 0.45 ? (t - 0.45) / 0.55 : 0;
        return (
          <group key={i} position={[(XCUT + 3.4 - (a + c) / 2) * Math.pow(dx, 1.6), lift - Math.pow(dx, 3) * (b.y + 0.2 + 0.85), 0]} rotation={[0, 0, -0.32 * Math.sin(Math.min(1, t * 2.2) * Math.PI)]}>
            <Bx x={[k[0], k[1]]} y={[0.13, FLOOR]} z={[-W / 2 + 0.1, W / 2 - 0.1]} m={plyM} ts={2.2} cast />
          </group>
        );
      })}
      {floor === 'none' && <Bx x={[-L / 2 + 0.2, Math.min(XCUT, xMax)]} y={[0.1, 0.11]} z={[-W / 2 + 0.1, W / 2 - 0.1]} m={bareM} ts={2.2} />}
      {sheetsIn > 0 && Array.from({length: FLOOR_N}, (_, i) => {
        const [a, c] = sheetX(FLOOR_N - 1 - i);
        const t = ramp(sheetsIn * FLOOR_N, i * 0.82, i * 0.82 + 1.5, Easing.out(Easing.cubic));
        if (t <= 0.001) return null;
        return (
          <group key={i} position={[(1 - t) * 3, (1 - t) * 0.9, 0]}>
            <Bx x={[a, Math.min(c, xMax)]} y={[0.12, FLOOR + 0.02]} z={[-W / 2 + 0.1, W / 2 - 0.1]} m={oakM} ts={2.4} />
          </group>
        );
      })}
      {foamT > 0 && <Foam xf={foamX} th={foamT} xMax={xMax} m={foamM} />}
      {b.lined && (
        <>
          {xMax < NOCUT && <Bx x={[-L / 2 + 0.26, xMax]} y={[H - 0.05 - foamT - 0.03, H - 0.05 - foamT]} z={[-W / 2 + 0.05 + foamT, W / 2 - 0.05 - foamT]} m={liningM} ts={2} />}
          {pieces([REAR_OP], -L / 2 + 0.26, Math.min(xMax, L / 2), FLOOR, H - 0.08).map((r, i) => (
            <Bx key={i} x={[r.x0, r.x1]} y={[r.y0, r.y1]} z={[-W / 2 + 0.05 + foamT, -W / 2 + 0.05 + foamT + 0.03]} m={liningM} ts={2} xMax={xMax} />
          ))}
          {pieces(FRONT_OPS, -L / 2 + 0.26, Math.min(xMax, L / 2), FLOOR, H - 0.08).map((r, i) => (
            <Bx key={i} x={[r.x0, r.x1]} y={[r.y0, r.y1]} z={[W / 2 - 0.05 - foamT - 0.03, W / 2 - 0.05 - foamT]} m={liningM} ts={2} xMax={xMax} />
          ))}
        </>
      )}
      {b.interior && <Interior glow={glow} flue={(b.roofSheets ?? 0) >= 1} />}
      {xMax < NOCUT && (
        <SectionCap x={xMax} foam={Math.min(1, foamT / 0.1)} lined={!!b.lined} ply={floor === 'ply' && sheetsOut < 0.8} newFloor={sheetsIn} />
      )}
      {b.roofFrame !== undefined && <NewRoof frame={b.roofFrame} sheets={b.roofSheets ?? 0} xMax={xMax} />}
    </group>
  );
};

/** Final house state shared by the last scenes. */
const HOUSE: Build = {y: PIER, xMax: NOCUT, openFront: true, rearOpen: true, frames: 1, glaze: 1, foamT: 0.1, foamX: -7, floor: 'none', sheetsIn: 1, roofFrame: 1, roofSheets: 1, lined: true, interior: true};
/** State once S3 ended: on piers, framed, openings cut, glass still to come. */
const AFTER_S3: Build = {y: PIER, xMax: NOCUT, openFront: true, rearOpen: true, frames: 1};

// ============================================================ stage + pins
const Stage: React.FC<{cam: Cam; children: React.ReactNode}> = ({cam, children}) => {
  const {width, height} = useVideoConfig();
  return (
    <AbsoluteFill style={{background: '#0e0b08'}}>
      <ThreeCanvas width={width} height={height} shadows camera={{fov: cam.fov, near: 0.1, far: 3000}}>
        <AssetProvider textures={TEXTURES} hdri="spruit_sunrise_1k">
          <CameraRig pos={cam.pos} target={cam.target} fov={cam.fov} />
          {children}
        </AssetProvider>
      </ThreeCanvas>
      <Grade strength={0.34} />
    </AbsoluteFill>
  );
};

const Pin: React.FC<{p: [number, number, number]; cam: Cam; text: string; delay: number; dx?: number; dy?: number; size?: number; anchor?: 'left' | 'right' | 'center'; red?: boolean}> = ({p, cam, text, delay, dx = 0, dy = 0, size = 46, anchor = 'center', red}) => {
  const [x, y, vis] = toScreen(p, cam);
  if (!vis) return null;
  const w = text.length * size * 0.56 + size * 0.9;
  let lx = x + dx;
  const left = anchor === 'left' ? lx : anchor === 'right' ? lx - w : lx - w / 2;
  if (left < 36) lx += 36 - left;
  if (left + w > 1044) lx -= left + w - 1044;
  return <Tag text={text} x={lx} y={Math.min(1480, Math.max(470, y + dy))} delay={delay} size={size} anchor={anchor} bg={red ? C.red : C.yellow} fg={red ? C.white : C.ink} />;
};

const Dip: React.FC<{f: number; at: number}> = ({f, at}) => {
  const o = Math.max(0, 1 - Math.abs(f - at) / 6);
  return o > 0 ? <AbsoluteFill style={{background: '#0e0b08', opacity: o}} /> : null;
};

// ============================================================ S1a: stacked nine high at sea
const STACK_COLS = ['#a8412a', '#25506e', '#2f6d58', '#c98a2b', '#6d7278', '#8c2f2c', '#31406f', '#a7562a'];
const stackCache: {g?: THREE.BufferGeometry} = {};
const stackGeo = () => {
  if (stackCache.g) return stackCache.g;
  const parts: THREE.BufferGeometry[] = [];
  const HH = 2.6;
  const col = new THREE.Color();
  for (let bay = 0; bay < 7; bay++) for (let row = 0; row < 8; row++) {
    const high = 9 - (row === 0 ? (bay * 3) % 2 : 0) - (bay === 6 ? 1 : 0);
    for (let k = 0; k < high; k++) {
      const x0 = bay * (L + 0.5), z0 = -row * (W + 0.05), y0 = k * HH;
      const mk: THREE.BufferGeometry[] = [
        sheet(x0, x0 + L, y0 + 0.08, y0 + HH - 0.08, 0.04, 7, (u, v, h) => [u, v, z0 + W / 2 + h]),
        sheet(-W / 2, W / 2, y0 + 0.08, y0 + HH - 0.08, 0.04, 7, (u, v, h) => [x0 + L + h, v, z0 - u]),
      ];
      const lid = uvBox(L, 0.14, W, 1.6);
      lid.translate(x0 + L / 2, y0 + HH - 0.07, z0);
      const base = uvBox(L, 0.14, W, 1.6);
      base.translate(x0 + L / 2, y0 + 0.07, z0);
      mk.push(lid.toNonIndexed(), base.toNonIndexed());
      col.set(STACK_COLS[Math.floor(rnd(bay * 31 + row * 17 + k * 7) * STACK_COLS.length)]).multiplyScalar(0.8 + rnd(k + bay) * 0.35);
      for (const g of mk) {
        const n = g.getAttribute('position').count;
        const c = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) c.set([col.r, col.g, col.b], i * 3);
        g.setAttribute('color', new THREE.BufferAttribute(c, 3));
        parts.push(g);
      }
    }
  }
  stackCache.g = mergeGeometries(parts.map((g) => { for (const a of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(a)) g.deleteAttribute(a); return g; }));
  return stackCache.g;
};

const Ship: React.FC<{f: number}> = ({f}) => {
  const base = useMat('container_paint', {roughness: 0.75, metalness: 0.2});
  const m = useMemo(() => { const mm = base.clone(); mm.vertexColors = true; return mm; }, [base]);
  const hull = useMat('steel_rusty', {tint: '#3c3f47', roughness: 0.7});
  const deck = useMat('iron_dark', {tint: '#5f3a30'});
  const g = stackGeo();
  const LEN_S = 7 * (L + 0.5);
  return (
    <>
      <Water w={1800} d={1800} position={[20, -3.6, 0]} time={f / 30} color="#2d4f68" texScale={14} />
      <mesh geometry={g} material={m} castShadow receiveShadow position={[-L * 3, 0, 0]} />
      <group position={[-L * 3 + LEN_S / 2, -5, -W * 3.6]}>
        <mesh material={hull} castShadow receiveShadow><boxGeometry args={[LEN_S + 18, 10, W * 8 + 6]} /></mesh>
        <mesh position={[0, 5.03, 0]} material={deck}><boxGeometry args={[LEN_S + 18, 0.05, W * 8 + 6]} /></mesh>
      </group>
    </>
  );
};

const S1: React.FC = () => {
  const f = useCurrentFrame();
  const LS = LEN[0];
  const cut = wordAt(0, 'Can you') - 3;
  const notAt = wordAt(0, 'Not even');
  const camA = camPath(f, [
    {t: 0, pos: [84, 2.5, 26], target: [18, 13, -8], fov: 42},
    {t: cut, pos: [78, 7, 24], target: [18, 12, -8], fov: 42},
  ]);
  const g = f - cut;
  const camB = groundSafe(camPath(g, [
    {t: 0, pos: [17.2, 2.1, 12.6], target: [0.2, 2.0, 0], fov: 46},
    {t: LS - cut, pos: [16.0, 2.0, 11.7], target: [0.2, 2.0, 0], fov: 46},
  ]), groundH);
  const cutOn = ramp(g, 8, 18) * (1 - ramp(g, notAt - cut, notAt - cut + 4));
  return (
    <>
      <Sequence durationInFrames={cut} layout="none">
        <Stage cam={camA}>
          <Renderer exposure={1.0} envIntensity={0.55} envRotation={1.2} />
          <SkyDome top="#4a6ea6" horizon="#f0cdbb" bottom="#5a7088" sunDir={SUN_DAWN} sunColor="#ffd3ad" clouds={0.5} time={f / 30} />
          <Sun dir={SUN_DAWN} intensity={2.7} color="#ffd3ad" shadowSize={60} shadowRes={4096} target={[14, 8, -6]} skyColor="#bcd0ee" groundColor="#5a7088" hemi={0.85} />
          <fog attach="fog" args={['#c2cede', 100, 800]} />
          <Ship f={f} />
        </Stage>
        <Headline top="RETIRED AFTER" big="10–15 YEARS" sub="at sea" delay={4} y={150} bigSize={130} />
      </Sequence>
      <Sequence from={cut} layout="none">
        <Stage cam={camB}>
          <Atmos f={f} target={[0, 1, 0]} shadow={18} />
          <Land />
          <Site />
          <Snowfall f={f} />
          <Box y={0} xMax={NOCUT} />
          <Worker position={[1.6, 0, W / 2 + 0.7]} rotY={Math.PI / 2 + 0.1} pose="chisel" seed={71} t={f * 0.3} tool="none" />
          <Sparks at={[1.3, 1.25, W / 2 + 0.05]} f={f} on={cutOn} />
        </Stage>
        <Headline top="CUT A DOOR, MOVE IN?" big="HOME?" delay={0} y={150} bigSize={150} />
        <Sequence from={notAt - cut} layout="none">
          <Tag text="NOT EVEN CLOSE" x={540} y={1400} anchor="center" delay={0} size={66} bg={C.red} fg={C.white} />
        </Sequence>
      </Sequence>
    </>
  );
};

// ============================================================ S2 ground -> concrete piers
const S2: React.FC = () => {
  const f = useCurrentFrame();
  const LS = LEN[1];
  const sinkAt = wordAt(1, 'sink');
  const fixAt = wordAt(1, 'Fix');
  const cornerAt = wordAt(1, 'corners');
  const sink = ramp(f, sinkAt - 6, fixAt - 6, Easing.out(Easing.quad));
  const up = ramp(f, fixAt, fixAt + 38);
  const pier = ramp(f, fixAt + 26, fixAt + 62, Easing.out(Easing.cubic));
  const down = ramp(f, fixAt + 58, LS - 10);
  const y = -0.24 * sink + (1.85 + 0.24 * sink) * up * (1 - down) + (down > 0 ? PIER * down : 0) * 1;
  const cam = groundSafe(camPath(f, [
    {t: 0, pos: [15.9, 3.4, 13.4], target: [1.6, 2.6, 0], fov: 50},
    {t: LS, pos: [17.2, 4.2, 14.8], target: [1.2, 3.2, 0], fov: 50},
  ]), groundH);
  const showWeight = ramp(f, cornerAt, cornerAt + 10);
  return (
    <>
      <Stage cam={cam}>
        <Atmos f={f} target={[0, 1, 0]} shadow={22} />
        <Land />
        <Site />
        <Snowfall f={f} />
        {PIERS.map(([x, z], i) => <Pier key={i} x={x} z={z} t={pier} />)}
        <Box y={y} xMax={NOCUT} />
        <CraneTruck hookY={y + H + 3.4} />
        <Worker position={[7.8, 0, 2.6]} rotY={2.6} pose="point" seed={72} />
        <Worker position={[6.9, 0, 3.0]} rotY={2.9} pose="stand" seed={73} />
        {[[-L / 2 + 0.3, W / 2], [L / 2 - 0.3, W / 2], [L / 2 - 0.3, -W / 2]].map(([x, z], i) => (
          <Arrow key={i} from={[x, H + 1.8 + y, z]} dir={[0, -1, 0]} len={1.4} color="#ff5a3a" opacity={0.95 * showWeight * (1 - ramp(f, LS - 8, LS))} r={0.1} />
        ))}
      </Stage>
      <ProbFix n={1} problem="THE GROUND" fix="CONCRETE PIERS" fixAt={fixAt} delay={3} />
      <Sequence durationInFrames={fixAt} layout="none">
        <Pin p={[3, 0.1, W / 2]} cam={cam} text="SINKS + RUSTS" delay={sinkAt} dy={110} red />
      </Sequence>
      <Sequence from={fixAt + 40} layout="none">
        <Pin p={[L / 2 - 0.18, 0.3, W / 2 - 0.16]} cam={cam} text="CONCRETE PIER" delay={6} dy={130} dx={-120} />
      </Sequence>
      <Sequence from={cornerAt} layout="none">
        <Pin p={[L / 2 - 0.3, H + 2 + y, W / 2]} cam={cam} text="WEIGHT GOES TO THE CORNERS" delay={0} dy={-70} size={40} />
      </Sequence>
    </>
  );
};

// ============================================================ S3 walls -> steel frames, welded before the cut
const S3: React.FC = () => {
  const f = useCurrentFrame();
  const LS = LEN[2];
  const opAt = wordAt(2, 'a big opening');
  const fixAt = wordAt(2, 'Fix');
  const cam = groundSafe(camPath(f, [
    {t: 0, pos: [-15.2, 4.2, 15.4], target: [0.2, 2.4, 0], fov: 46},
    {t: fixAt, pos: [-14.2, 3.9, 14.6], target: [0.2, 2.4, 0], fov: 46},
    {t: LS, pos: [-15.4, 4.4, 15.8], target: [0.2, 2.3, 0], fov: 46},
  ]), groundH);
  // the what-if: a cut with no frame
  const trace = ramp(f, 8, opAt + 8, Easing.linear);
  const fall = ramp(f, opAt + 8, opAt + 30, Easing.in(Easing.quad));
  const sag = f < fixAt ? ramp(f, opAt + 14, fixAt - 7) : 0;
  BEND.value = 0.42 * sag;
  // the fix
  const frames = ramp(f, fixAt + 4, LS - 56, Easing.linear);
  const lift = ramp(f, LS - 52, LS - 20);
  const after = f >= fixAt;
  const perim = 2 * (DOORWAY.x1 - DOORWAY.x0 + DOORWAY.y1 - DOORWAY.y0);
  const cutPos = (t: number): [number, number, number] => {
    const d = t * perim, w = DOORWAY.x1 - DOORWAY.x0, h = DOORWAY.y1 - DOORWAY.y0;
    const [x, y] = d < w ? [DOORWAY.x0 + d, DOORWAY.y1] : d < w + h ? [DOORWAY.x1, DOORWAY.y1 - (d - w)] : d < 2 * w + h ? [DOORWAY.x1 - (d - w - h), DOORWAY.y0] : [DOORWAY.x0, DOORWAY.y0 + (d - 2 * w - h)];
    return [x, y + PIER, W / 2 + 0.03];
  };
  const weld = (): [number, number, number] => {
    const t = frames * 3 % 1;
    const o = FRONT_OPS[Math.min(2, Math.floor(frames * 3))];
    return [o.x0 + (o.x1 - o.x0) * t, o.y1 + PIER + 0.05, W / 2 + 0.08];
  };
  return (
    <>
      <Stage cam={cam}>
        <Atmos f={f} target={[0, 1.5, 0]} shadow={18} />
        <Land />
        <Site />
        <Snowfall f={f} />
        {PIERS.map(([x, z], i) => <Pier key={i} x={x} z={z} t={1} />)}
        <Box
          y={PIER} xMax={NOCUT} openFront rearOpen={after}
          bigPanel={after ? lift : 0} panelFall={after ? 0 : fall}
          winPanel={after ? lift : 0}
          frames={after ? frames : 0}
        />
        <ScaffoldBay position={[-5.0, 0, W / 2 + 0.28]} w={3.4} d={1.1} h={1.5} levels={1} />
        <Worker position={[-2.1, 1.56, W / 2 + 0.84]} rotY={Math.PI / 2 - 0.35} pose="chisel" t={f * 0.3} seed={71} tool="none" />
        <Worker position={[-6.6, 0, W / 2 + 1.4]} rotY={0.9} pose="point" seed={74} />
        {!after && <Sparks at={cutPos(trace)} f={f} on={ramp(f, 8, 14) * (1 - ramp(f, opAt + 4, opAt + 8))} />}
        {after && <Sparks at={weld()} f={f} on={ramp(f, fixAt + 4, fixAt + 10) * (1 - ramp(f, LS - 60, LS - 55))} color="#d8e6ff" />}
        {!after && [-3, 0, 3].map((x, i) => (
          <Arrow key={i} from={[x, H + PIER + 1.1 + Math.sin(f * 0.3 + i) * 0.05, W / 2]} dir={[0, -1, 0]} len={0.9} color="#ff5a3a" opacity={0.95 * ramp(f, opAt + 14, opAt + 22)} r={0.09} />
        ))}
      </Stage>
      <ProbFix n={2} problem="THE WALLS" fix="WELDED STEEL FRAME" fixAt={fixAt} delay={3} />
      {!after && <Pin p={[0, H + PIER, W / 2]} cam={cam} text="IT SAGS" delay={opAt + 14} dy={-170} red />}
      {after && <Pin p={[DOORWAY.x0 - 0.05, PIER + 1.4, W / 2 + 0.1]} cam={cam} text="STEEL FRAME" delay={fixAt + 22} dx={-190} dy={230} />}
      {after && (
        <Sequence from={fixAt + 26} layout="none">
          <Caption text="Welded in before the cut" delay={0} bottom={300} />
        </Sequence>
      )}
      <Dip f={f} at={fixAt - 1} />
    </>
  );
};

// ============================================================ S4 condensation -> spray foam (section)
const Drops: React.FC<{f: number; o: number}> = ({f, o}) => {
  const m = usePlainMat('#9fd8ff', 0.08, 0.1, {transparent: true, opacity: 0.9, emissive: new THREE.Color('#2a7fb8'), emissiveIntensity: 0.5});
  if (o <= 0.02) return null;
  return (
    <group>
      {Array.from({length: 46}, (_, i) => {
        const x = -5.4 + rnd(i * 3 + 1) * 7.6;
        const sp = 0.012 + rnd(i * 5) * 0.03;
        const y = H - 0.25 - ((rnd(i * 7 + 2) * 2.2 + f * sp) % 2.3);
        return <mesh key={i} material={m} position={[x, y, -W / 2 + 0.09]} scale={[0.028 * o, 0.05 * o, 0.018]}><sphereGeometry args={[1, 8, 6]} /></mesh>;
      })}
    </group>
  );
};

const S4: React.FC = () => {
  const f = useCurrentFrame();
  const LS = LEN[3];
  const fixAt = wordAt(3, 'Fix');
  const coldAt = wordAt(3, 'cold steel');
  const cam = groundSafe(camPath(f, [
    {t: 0, pos: [XCUT + 5.6, PIER + 2.1, 1.7], target: [XCUT - 2.2, PIER + 1.35, -0.45], fov: 50},
    {t: LS, pos: [XCUT + 4.6, PIER + 1.85, 1.3], target: [XCUT - 2.2, PIER + 1.35, -0.3], fov: 50},
  ]), groundH);
  const foam = ramp(f, fixAt + 4, LS - 8, Easing.linear);
  const foamX = XCUT + (-L / 2 - 0.1 - XCUT) * foam;
  const foamT = 0.1 * ramp(f, fixAt + 2, fixAt + 18);
  const wet = 1 - ramp(f, fixAt + 2, fixAt + 44);
  const ph = (k: number) => (f * 0.022 + k * 0.33) % 1;
  const gx = Math.min(XCUT - 0.5, foamX + 0.75);
  const stopped = foam >= 1;
  return (
    <>
      <Stage cam={cam}>
        <Atmos f={f} target={[0, 1.5, 0]} shadow={15} />
        <Land />
        <Site />
        <Snowfall f={f} n={260} />
        {PIERS.map(([x, z], i) => <Pier key={i} x={x} z={z} t={1} />)}
        <Box {...AFTER_S3} xMax={XCUT} glaze={1} foamX={foamX} foamT={foamT} />
        <group position={[0, PIER, 0]}>
          <Drops f={f} o={wet} />
          {[0, 1, 2].map((k) => (
            <Arrow key={k} from={[XCUT - 0.6 - k * 0.5, 0.75 + k * 0.5 + 0.25 * ph(k), 0.5 - ph(k) * 1.1]} dir={[0, 0.18, -1]} len={0.55} color="#ff8a3a" opacity={0.9 * wet * ramp(f, 8, 18)} r={0.05} />
          ))}
        </group>
        <pointLight position={[0.8, PIER + 2.2, 0.2]} intensity={7} distance={9} decay={1.5} color="#ffdcb4" />
        {f >= fixAt && (
          <Person position={[Math.max(gx, -5.0), PIER + FLOOR, 0.3]} rotY={Math.PI - 0.5} pose="chisel" legs={stopped || foam <= 0 ? 'still' : 'walk'} t={(XCUT - gx) * 4.2} seed={75} outfit="#e7e9ee" pants="#e7e9ee" head="hardhat" headColor="#f0f2f4" tool="none" />
        )}
        {f >= fixAt && foam < 0.98 && <Sparks at={[foamX + 0.15, PIER + 1.45, -W / 2 + 0.3]} f={f} on={1} n={22} color="#f2e2a8" />}
      </Stage>
      <ProbFix n={3} problem="CONDENSATION" fix="SPRAY FOAM" fixAt={fixAt} delay={3} />
      {f < fixAt && <Pin p={[XCUT - 0.8, PIER + 1.3, 0.2]} cam={cam} text="WARM, MOIST AIR" delay={18} dy={230} dx={40} />}
      {f < fixAt && <Pin p={[XCUT, PIER + 1.4, -W / 2 + 0.02]} cam={cam} text="COLD STEEL" delay={coldAt} dx={-90} dy={-320} red />}
      {f >= fixAt && <Pin p={[XCUT, PIER + 1.0, -W / 2 + 0.11]} cam={cam} text="CLOSED-CELL FOAM" delay={fixAt + 14} dx={-40} dy={330} />}
    </>
  );
};

// ============================================================ S5 floor -> tear out, seal, new floor
const PlyPile: React.FC<{h: number}> = ({h}) => {
  const pile = useMat('ply_floor', {});
  return <Bx x={[XCUT + 2.2, XCUT + 4.4]} y={[0.02, 0.02 + h]} z={[-1.1, 1.1]} m={pile} ts={2.2} />;
};
const S5: React.FC = () => {
  const f = useCurrentFrame();
  const LS = LEN[4];
  const fixAt = wordAt(4, 'Fix');
  const sealAt = wordAt(4, 'seal it');
  const newAt = wordAt(4, 'lay a new');
  const cam = groundSafe(camPath(f, [
    {t: 0, pos: [XCUT + 3.6, PIER + 3.1, 1.2], target: [XCUT - 2.8, PIER + 0.45, -0.1], fov: 50},
    {t: LS, pos: [XCUT + 4.2, PIER + 3.0, 1.0], target: [XCUT - 2.6, PIER + 0.65, -0.1], fov: 50},
  ]), groundH);
  const out = ramp(f, fixAt + 2, newAt - 8, Easing.linear);
  const inn = ramp(f, newAt - 2, LS - 6, Easing.linear);
  const toxic = usePlainMat('#7dff5a', 0.8, 0, {transparent: true, opacity: 0.16, emissive: new THREE.Color('#58e040'), emissiveIntensity: 0.8, depthWrite: false});
  const haze = (1 - ramp(f, fixAt, fixAt + 20)) * ramp(f, 8, 22);
  const pileH = 0.04 * Math.floor(out * FLOOR_N + 0.2);
  return (
    <>
      <Stage cam={cam}>
        <Atmos f={f} target={[0, 1.5, 0]} shadow={15} />
        <Land />
        <Site />
        <Snowfall f={f} n={260} />
        {PIERS.map(([x, z], i) => <Pier key={i} x={x} z={z} t={1} />)}
        <Box {...AFTER_S3} xMax={XCUT} glaze={1} foamT={0.1} foamX={-7} floor={out >= 1 ? 'none' : 'ply'} sheetsOut={out} sheetsIn={inn} />
        {haze > 0.01 && Array.from({length: 10}, (_, i) => {
          const ph = ((f * 0.012 + rnd(i * 3 + 1)) % 1);
          return (
            <mesh key={i} position={[-5 + rnd(i * 5) * 7.2, PIER + FLOOR + 0.03 + ph * 0.5, (rnd(i * 7 + 2) - 0.5) * 1.5]} scale={[0.2 + ph * 0.3, 0.05 + ph * 0.12, 0.2 + ph * 0.3]} material={toxic}><sphereGeometry args={[1, 10, 8]} /></mesh>
          );
        })}
        {pileH > 0.01 && <PlyPile h={pileH} />}
      </Stage>
      <ProbFix n={4} problem="THE FLOOR" fix="TEAR OUT OR SEAL" fixAt={fixAt} delay={3} />
      {f < fixAt && <Pin p={[-1.5, PIER + FLOOR, 0]} cam={cam} text="INSECTICIDE-TREATED" delay={16} dy={150} red size={44} />}
      {f < fixAt && (
        <Sequence from={wordAt(4, 'some with')} layout="none">
          <Caption text="Some with arsenic" delay={0} bottom={300} />
        </Sequence>
      )}
      {f >= sealAt - 4 && f < newAt + 6 && (
        <Sequence from={sealAt - 4} layout="none">
          <Caption text="Or seal it under epoxy" delay={0} bottom={300} />
        </Sequence>
      )}
      {f >= newAt + 2 && <Pin p={[XCUT - 2.5, PIER + FLOOR, 0]} cam={cam} text="NEW FLOOR" delay={newAt + 6} dy={190} />}
    </>
  );
};

// ============================================================ S6 roof -> second sloped roof
const RoofSnow: React.FC<{h: number; off: number}> = ({h, off}) => {
  const sn = useMat('snow', {tint: '#f4f7fd'});
  return (
    <>
      <Bx x={[-L / 2 + 0.12, L / 2 - 0.12]} y={[PIER + H - 0.01, PIER + H + h]} z={[-W / 2 + 0.1, W / 2 - 0.1]} m={sn} ts={5} seg={4} />
      {/* snow blocks sliding off the new slope */}
      {off >= 0 && Array.from({length: 7}, (_, i) => {
        const t = THREE.MathUtils.clamp(off * 2.2 - i * 0.13, 0, 1.7);
        const z = ROOF.zR + 0.6 + (ROOF.zF - ROOF.zR) * Math.min(1.12, t) * 0.92;
        const y = t < 1 ? roofY(z) + PIER + 0.17 : Math.max(0.05, roofY(ROOF.zF) + PIER + 0.17 - Math.pow((t - 1) * 8, 2) * 0.5);
        return <Bx key={i} x={[-5 + i * 1.7, -4.2 + i * 1.7]} y={[y, y + 0.14]} z={[z, z + 0.8]} m={sn} ts={5} />;
      })}
    </>
  );
};
const S6: React.FC = () => {
  const f = useCurrentFrame();
  const LS = LEN[5];
  const fixAt = wordAt(5, 'Fix');
  const slideAt = wordAt(5, 'snow and rain');
  const cam = groundSafe(camPath(f, [
    {t: 0, pos: [13.4, 9.6, 14.4], target: [0.0, 3.0, 0], fov: 50},
    {t: fixAt, pos: [13.6, 8.8, 14.8], target: [0.0, 3.0, 0], fov: 50},
    {t: LS, pos: [15.0, 6.6, 16.4], target: [0.0, 3.4, 0], fov: 50},
  ]), groundH);
  const frame = ramp(f, fixAt + 2, fixAt + 44, Easing.linear);
  const sheets = ramp(f, fixAt + 34, LS - 34, Easing.linear);
  const flatSnow = ramp(f, 0, fixAt, Easing.linear);
  const off = ramp(f, slideAt - 4, LS);
  return (
    <>
      <Stage cam={cam}>
        <Atmos f={f} target={[0, 2.5, 0]} shadow={18} />
        <Land />
        <Site />
        <Snowfall f={f} n={520} speed={0.06} />
        {PIERS.map(([x, z], i) => <Pier key={i} x={x} z={z} t={1} />)}
        <Box {...HOUSE} roofFrame={frame} roofSheets={sheets} />
        <RoofSnow h={0.05 + 0.2 * flatSnow} off={sheets >= 1 ? off : -1} />
        <Worker position={[5.7, 0, W / 2 + 2.6]} rotY={2.4} pose="point" seed={72} />
        {f < fixAt && <Arrow from={[0, PIER + H + 1.8, 0]} dir={[0, -1, 0]} len={1.3} color="#ff5a3a" opacity={0.95 * ramp(f, 10, 20)} r={0.12} />}
      </Stage>
      <ProbFix n={5} problem="THE ROOF" fix="A SECOND ROOF" fixAt={fixAt} delay={3} />
      {f < fixAt && <Pin p={[0, PIER + H + 0.3, 0]} cam={cam} text="WEAKEST PART, AND FLAT" delay={wordAt(5, 'weakest')} dy={250} red size={44} />}
      {f >= slideAt && <Pin p={[3, PIER + roofY(0.5) + 0.2, 0.5]} cam={cam} text="SNOW SLIDES OFF" delay={slideAt + 2} dy={-110} />}
    </>
  );
};

// ============================================================ S7 every layer has one job (section)
const S7: React.FC = () => {
  const f = useCurrentFrame();
  const LS = LEN[6];
  const cam = groundSafe(camPath(f, [
    {t: 0, pos: [XCUT + 7.6, PIER + 2.6, 2.0], target: [XCUT, PIER + 1.85, 0.1], fov: 46},
    {t: LS, pos: [XCUT + 6.0, PIER + 2.2, 1.5], target: [XCUT, PIER + 1.95, 0.1], fov: 46},
  ]), groundH);
  const pAt = wordAt(6, 'Piers');
  const frAt = wordAt(6, 'frames');
  const foAt = wordAt(6, 'foam');
  const rAt = wordAt(6, 'new roof');
  return (
    <>
      <Stage cam={cam}>
        <Atmos f={f} d={0.25} target={[0, 2, 0]} shadow={15} />
        <Land />
        <Site />
        <Snowfall f={f} n={260} />
        {PIERS.map(([x, z], i) => <Pier key={i} x={x} z={z} t={1} />)}
        <Box {...HOUSE} xMax={XCUT} glow={0.5} />
        <Person position={[-2.6, PIER + FLOOR + 0.02, 0.3]} rotY={Math.PI - 0.3} pose="stand" seed={77} outfit="#3f6c94" pants="#2d3440" head="hair" />
      </Stage>
      <Headline top="EVERY LAYER HAS" big="ONE JOB" delay={4} y={150} bigSize={130} />
      <Pin p={[0, 0.3, W / 2 - 0.16]} cam={cam} text="PIERS" delay={pAt} dy={70} dx={-160} size={44} />
      <Pin p={[1.6, PIER + 1.4, W / 2]} cam={cam} text="FRAMES" delay={frAt} dy={-120} dx={-30} size={44} />
      <Pin p={[XCUT, PIER + 1.9, -W / 2 + 0.11]} cam={cam} text="FOAM" delay={foAt} dx={30} dy={-30} size={44} />
      <Pin p={[XCUT, PIER + roofY(0), 0]} cam={cam} text="NEW ROOF" delay={rAt} dy={-120} size={44} />
    </>
  );
};

// ============================================================ S8 payoff: blue hour, lights on
const Smoke: React.FC<{f: number; at: [number, number, number]}> = ({f, at}) => {
  const mats = useMemo(() => Array.from({length: 9}, () => new THREE.MeshStandardMaterial({color: '#b6b4c2', roughness: 1, transparent: true, depthWrite: false})), []);
  return (
    <group position={at}>
      {mats.map((m, i) => {
        const ph = ((f + i * 10) % 90) / 90;
        m.opacity = 0.32 * (1 - ph) * Math.min(1, ph * 8);
        return <mesh key={i} material={m} position={[ph * 1.4 + Math.sin(ph * 6 + i) * 0.12, ph * 3.4, ph * 0.4]} scale={0.14 + ph * 0.55}><icosahedronGeometry args={[1, 1]} /></mesh>;
      })}
    </group>
  );
};

const Deck: React.FC = () => {
  const wood = useMat('wood_oak', {tint: '#a98560'});
  const y = PIER + 0.12;
  return (
    <>
      <Bx x={[-1.8, 2.0]} y={[y - 0.06, y]} z={[W / 2 + 0.02, W / 2 + 1.9]} m={wood} ts={1.6} />
      {[[-1.7, W / 2 + 1.8], [1.9, W / 2 + 1.8]].map(([x, z], i) => <Bx key={i} x={[x - 0.06, x + 0.06]} y={[0, y - 0.06]} z={[z - 0.06, z + 0.06]} m={wood} ts={1} />)}
      {[0.22, 0.44].map((h, i) => <Bx key={i} x={[-0.7, 0.9]} y={[h - 0.04, h]} z={[W / 2 + 1.9 + 0.3 * (2 - i) - 0.3, W / 2 + 1.9 + 0.3 * (2 - i)]} m={wood} ts={1.4} />)}
    </>
  );
};

const S8: React.FC = () => {
  const f = useCurrentFrame();
  const LS = LEN[7];
  const n320 = wordAt(7, 'Three');
  const nineAt = wordAt(7, 'stacked');
  const a = interpolate(f, [0, LS], [0.74, 0.6]);
  const R = interpolate(f, [0, LS], [25, 27.5]);
  const cam = groundSafe({pos: [Math.sin(a) * R * 0.8, 2.6 + f * 0.006, Math.cos(a) * R], target: [0.6, 3.6, 0], fov: 44} as Cam, groundH, 1.2);
  const glow = 0.5 + 0.5 * ramp(f, 0, 40);
  return (
    <>
      <Stage cam={cam}>
        <Atmos f={f} d={1} target={[0, 2, 0]} shadow={22} />
        <Land />
        <Site />
        <Snowfall f={f} n={320} />
        {PIERS.map(([x, z], i) => <Pier key={i} x={x} z={z} t={1} />)}
        <Box {...HOUSE} glow={glow} />
        <Deck />
        <Smoke f={f} at={[2.25, PIER + 4.7, -W / 2 + 0.45]} />
        <pointLight position={[0, PIER + 1.6, W / 2 + 1.3]} intensity={6 * glow} distance={9} decay={1.6} color="#ffbe7c" />
        <pointLight position={[-3.7, PIER + 1.6, W / 2 + 1]} intensity={3 * glow} distance={6} decay={1.6} color="#ffbe7c" />
        <Person {...walkAlong([6.8, 0, 7.4], Math.PI * 0.86, f, 0.7)} seed={77} outfit="#3f6c94" pants="#2d3440" head="hair" />
      </Stage>
      <Sequence durationInFrames={n320} layout="none">
        <Headline top="ONE BOX" big="40 × 8 FT" delay={4} y={150} bigSize={130} />
      </Sequence>
      <Sequence from={n320} layout="none">
        <Headline top="A WHOLE HOME IN" big="320 SQ FT" delay={0} y={150} bigSize={130} />
      </Sequence>
      <Sequence from={nineAt} layout="none">
        <Caption text="Built to stack nine high at sea" delay={0} bottom={300} />
      </Sequence>
    </>
  );
};

// ============================================================ timeline
const SCENES = [S1, S2, S3, S4, S5, S6, S7, S8];

export const ContainerHome: React.FC = () => {
  BEND.value = 0;
  return (
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
          <Audio src={staticFile(`vo/ep013-container_${i}.wav`)} />
        </Sequence>
      ))}
      <Watermark />
    </AbsoluteFill>
  );
};

export const CONTAINER_START = START;
export const CONTAINER_LEN = LEN;
