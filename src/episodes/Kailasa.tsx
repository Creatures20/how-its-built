// Episode 7: Kailasa Temple, Ellora — a temple carved top-down out of one basalt hill (v2 kit).
import React, {useEffect, useMemo} from 'react';
import {AbsoluteFill, Audio, interpolate, Sequence, staticFile, useCurrentFrame, useVideoConfig, Easing} from 'remotion';
import {ThreeCanvas} from '@remotion/three';
import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import VO from './ep007-kailasa-vo.json';
import {AssetProvider, Renderer, SkyDome, Sun, TexName, useMat, usePlainMat, uvBox, worldUV} from '../hib/pbr';
import {Beam, Bush, Dust, KIT_TEXTURES, PalmTree, Person, Rock, Tree, walkAlong, rnd} from '../hib/models';
import {CameraRig} from '../hib/three';
import {Cam, camPath, groundSafe, toScreen} from '../hib/project';
import {C, Caption, Grade, Headline, SceneFade, StepBadge, Tag, Watermark} from '../hib/ui';

// ============================================================ timing
const FPS = 30;
const VO_DELAY = 5;
const sceneLen = (i: number, tail: number) => Math.ceil((VO.durations[i] + tail) * FPS) + VO_DELAY;
const LEN = [sceneLen(0, 0.5), sceneLen(1, 0.45), sceneLen(2, 0.45), sceneLen(3, 0.45), sceneLen(4, 0.45), sceneLen(5, 0.45), sceneLen(6, 0.45), sceneLen(7, 1.6)];
const START = LEN.map((_, i) => LEN.slice(0, i).reduce((a, b) => a + b, 0));
export const KAILASA_DURATION = LEN.reduce((a, b) => a + b, 0);
/** frame (local to scene i) at which the word `w` is spoken, estimated from character position. */
const wordAt = (i: number, w: string) => Math.round(VO_DELAY + (Math.max(0, VO.lines[i].indexOf(w)) / VO.lines[i].length) * VO.durations[i] * FPS);

const cl = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
const ramp = (f: number, a: number, b: number, ease = Easing.inOut(Easing.cubic)) => interpolate(f, [a, b], [0, 1], {...cl, easing: ease});

const TEXTURES: TexName[] = [...KIT_TEXTURES, 'grass', 'basalt_carved', 'basalt_rough', 'gravel', 'dirt', 'straw'];
const ROCK_TINT = '#bdb7b0';

// ============================================================ the hill (metres; +z = toward the valley / camera, y = 0 courtyard floor)
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const vnoise = (x: number, z: number) => Math.sin(x * 0.031 + 1.3) * Math.cos(z * 0.027 + 0.4) * 0.6 + Math.sin(x * 0.083 + z * 0.061) * 0.4;

const PIT = {x0: -23, x1: 23, z0: -41, z1: 56};
const CORE = {x0: -17.5, x1: 17.5, z0: -33, z1: 30};
const TOP = 34; // plateau height above the courtyard floor

const hillH = (x: number, z: number) => {
  const ax = Math.abs(x);
  const zz = z - 9 * Math.sin(x / 37) * smooth(30, 90, ax);
  let h = zz < 40 ? TOP - 18 * smooth(-25, 40, zz) : 16 * (1 - smooth(40, 54, zz));
  h += 18 * smooth(-110, -300, z) + 10 * smooth(120, 300, ax) * smooth(40, -60, z);
  h += vnoise(x, z) * (zz < 44 ? 0.9 : 0.5);
  return Math.max(h, 0.04); // never below the carved courtyard floor (y = 0)
};
const inPit = (x: number, z: number) => x > PIT.x0 && x < PIT.x1 && z > PIT.z0 && z < PIT.z1;
/** ground height for cameras/people when the courtyard is fully carved */
const worldH = (x: number, z: number) => (inPit(x, z) ? 0 : hillH(x, z));

/** Terrain with a rectangular hole where the pit is (grid lines are aligned with the pit edges). */
const terrainGeo = () => {
  const axis = (lo: number, hi: number, fineLo: number, fineHi: number) => {
    const s = new Set<number>();
    for (let v = lo; v < fineLo; v += 5) s.add(v);
    for (let v = fineLo; v <= fineHi; v += 1) s.add(v);
    for (let v = fineHi; v <= hi; v += 5) s.add(v);
    s.add(hi);
    return [...s].sort((a, b) => a - b);
  };
  const xs = axis(-340, 340, -70, 70);
  const zs = axis(-340, 340, -70, 90);
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  zs.forEach((z) => xs.forEach((x) => {
    pos.push(x, hillH(x, z), z);
    uv.push(x / 6, z / 6);
  }));
  const W = xs.length;
  for (let j = 0; j < zs.length - 1; j++)
    for (let i = 0; i < W - 1; i++) {
      const cx = (xs[i] + xs[i + 1]) / 2, cz = (zs[j] + zs[j + 1]) / 2;
      if (inPit(cx, cz)) continue;
      const a = j * W + i, b = a + 1, c = a + W, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
};

/** Macro-varied grass material that turns to dark basalt on steep slopes (shared by terrain + uncut rock tops). */
const useHillMat = () => {
  const base = useMat('grass', {tint: '#b9c08f'});
  return useMemo(() => {
    const mm = base.clone();
    mm.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vTPos; varying vec3 vTN;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTPos = (modelMatrix * vec4(position,1.0)).xyz; vTN = normal;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec3 vTPos; varying vec3 vTN;
float th(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float tn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(th(i),th(i+vec2(1,0)),f.x), mix(th(i+vec2(0,1)),th(i+vec2(1,1)),f.x), f.y); }`)
        .replace('#include <map_fragment>', `#include <map_fragment>
float mv = tn(vTPos.xz / 19.0) * 0.6 + tn(vTPos.xz / 67.0) * 0.4;
diffuseColor.rgb *= 0.72 + 0.5 * mv;
diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.15, 1.0, 0.7), smoothstep(0.55, 0.8, tn(vTPos.xz / 41.0 + 7.0)) * 0.6);
float steep = 1.0 - smoothstep(0.55, 0.8, normalize(vTN).y);
float rk = smoothstep(0.62, 0.74, tn(vTPos.xz / 9.0 + 3.1) * 0.65 + tn(vTPos.xz / 2.3) * 0.35);
vec3 basalt = vec3(0.022, 0.021, 0.02) * (0.75 + 0.5 * tn(vTPos.xz / 3.0 + vec2(vTPos.y / 2.0)));
diffuseColor.rgb = mix(diffuseColor.rgb, basalt * 1.6, rk * 0.55);
diffuseColor.rgb = mix(diffuseColor.rgb, basalt, steep * 0.95);`);
    };
    mm.roughnessMap = null;
    mm.normalScale = new THREE.Vector2(0.35, 0.35);
    mm.roughness = 1;
    mm.envMapIntensity = 0.45;
    mm.customProgramCacheKey = () => 'kailasaHill';
    return mm;
  }, [base]);
};

const HillTerrain: React.FC = () => {
  const geo = useMemo(terrainGeo, []);
  const m = useHillMat();
  return <mesh geometry={geo} material={m} receiveShadow castShadow />;
};

/** Vertical cliff curtains lining the pit (from the floor up to the hill surface). */
const pitWallGeo = () => {
  const parts: THREE.BufferGeometry[] = [];
  const curtain = (pts: [number, number][], inward: [number, number]) => {
    const pos: number[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, z0] = pts[i], [x1, z1] = pts[i + 1];
      const h0 = hillH(x0, z0), h1 = hillH(x1, z1);
      if (h0 < 0.02 && h1 < 0.02) continue;
      const A = [x0, -0.2, z0], B = [x1, -0.2, z1], Ct = [x1, h1, z1], D = [x0, h0, z0];
      // orient so the face normal points into the pit
      const n = new THREE.Vector3(x1 - x0, 0, z1 - z0).cross(new THREE.Vector3(0, 1, 0));
      const flip = n.x * inward[0] + n.z * inward[1] < 0;
      if (!flip) pos.push(...A, ...B, ...Ct, ...A, ...Ct, ...D);
      else pos.push(...A, ...Ct, ...B, ...A, ...D, ...Ct);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    parts.push(worldUV(g, 6));
  };
  const line = (x0: number, z0: number, x1: number, z1: number) => {
    const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0));
    return Array.from({length: n + 1}, (_, i) => [x0 + ((x1 - x0) * i) / n, z0 + ((z1 - z0) * i) / n] as [number, number]);
  };
  curtain(line(PIT.x0, PIT.z0, PIT.x0, PIT.z1), [1, 0]);
  curtain(line(PIT.x1, PIT.z0, PIT.x1, PIT.z1), [-1, 0]);
  curtain(line(PIT.x0, PIT.z0, PIT.x1, PIT.z0), [0, 1]);
  return mergeGeometries(parts)!;
};

const PitShell: React.FC = () => {
  const geo = useMemo(pitWallGeo, []);
  const wall = useMat('basalt_rough', {tint: '#e2dcd4', normalScale: 1.3});
  const floor = useMat('basalt_carved', {tint: '#9f9890'});
  const floorG = useMemo(() => {
    const g = new THREE.PlaneGeometry(PIT.x1 - PIT.x0, PIT.z1 - PIT.z0);
    g.rotateX(-Math.PI / 2);
    g.translate((PIT.x0 + PIT.x1) / 2, 0, (PIT.z0 + PIT.z1) / 2);
    return worldUV(g, 4);
  }, []);
  return (
    <>
      <mesh geometry={geo} material={wall} castShadow receiveShadow />
      <mesh geometry={floorG} material={floor} receiveShadow />
    </>
  );
};

// ============================================================ uncut rock inside the pit (rebuilt as it is carved)
type Region = {x0: number; x1: number; z0: number; z1: number};
const REG = {
  trL: {x0: PIT.x0, x1: CORE.x0, z0: PIT.z0, z1: CORE.z1},
  trR: {x0: CORE.x1, x1: PIT.x1, z0: PIT.z0, z1: CORE.z1},
  trB: {x0: CORE.x0, x1: CORE.x1, z0: PIT.z0, z1: CORE.z0},
  core: {x0: CORE.x0, x1: CORE.x1, z0: CORE.z0, z1: CORE.z1},
  front: {x0: PIT.x0, x1: PIT.x1, z0: CORE.z1, z1: PIT.z1},
};
const ticks = (a: number, b: number) => {
  const n = Math.max(1, Math.ceil(b - a));
  return Array.from({length: n + 1}, (_, i) => a + ((b - a) * i) / n);
};
/** Returns [uncut grass top, carved rock (tops + sides)] for a region whose top surface is `top(x,z)`. */
const fillGeo = (r: Region, top: (x: number, z: number) => number): [THREE.BufferGeometry | null, THREE.BufferGeometry | null] => {
  const xs = ticks(r.x0, r.x1), zs = ticks(r.z0, r.z1);
  const T = zs.map((z) => xs.map((x) => Math.max(0, top(x, z))));
  const H = zs.map((z) => xs.map((x) => hillH(x, z)));
  const grass: number[] = [], rock: number[] = [], grassUV: number[] = [];
  let any = false;
  for (let j = 0; j < zs.length - 1; j++)
    for (let i = 0; i < xs.length - 1; i++) {
      const c = [[i, j], [i, j + 1], [i + 1, j], [i + 1, j + 1]].map(([a, b]) => [xs[a], T[b][a], zs[b], H[b][a]]);
      if (c.every((p) => p[1] < 0.02)) continue;
      any = true;
      const uncut = c.every((p) => p[1] > p[3] - 0.05);
      const tri = [c[0], c[1], c[2], c[2], c[1], c[3]];
      tri.forEach((p) => {
        (uncut ? grass : rock).push(p[0], p[1], p[2]);
        if (uncut) grassUV.push(p[0] / 6, p[2] / 6);
      });
    }
  if (!any) return [null, null];
  // sides (outward normals)
  const side = (pts: [number, number][], out: [number, number]) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, z0] = pts[i], [x1, z1] = pts[i + 1];
      const h0 = Math.max(0, top(x0, z0)), h1 = Math.max(0, top(x1, z1));
      if (h0 < 0.02 && h1 < 0.02) continue;
      const A = [x0, 0, z0], B = [x1, 0, z1], Cc = [x1, h1, z1], D = [x0, h0, z0];
      const n = new THREE.Vector3(x1 - x0, 0, z1 - z0).cross(new THREE.Vector3(0, 1, 0));
      if (n.x * out[0] + n.z * out[1] >= 0) rock.push(...A, ...B, ...Cc, ...A, ...Cc, ...D);
      else rock.push(...A, ...Cc, ...B, ...A, ...D, ...Cc);
    }
  };
  side(xs.map((x) => [x, r.z0]), [0, -1]);
  side(xs.map((x) => [x, r.z1]), [0, 1]);
  side(zs.map((z) => [r.x0, z]), [-1, 0]);
  side(zs.map((z) => [r.x1, z]), [1, 0]);
  let gG: THREE.BufferGeometry | null = null, rG: THREE.BufferGeometry | null = null;
  if (grass.length) {
    gG = new THREE.BufferGeometry();
    gG.setAttribute('position', new THREE.Float32BufferAttribute(grass, 3));
    gG.setAttribute('uv', new THREE.Float32BufferAttribute(grassUV, 2));
    gG.computeVertexNormals();
  }
  if (rock.length) {
    rG = new THREE.BufferGeometry();
    rG.setAttribute('position', new THREE.Float32BufferAttribute(rock, 3));
    rG.computeVertexNormals();
    worldUV(rG, 4);
  }
  return [gG, rG];
};

const FillRegion: React.FC<{r: Region; mode: 'trench' | 'level'; v: number; grassM: THREE.Material; rockM: THREE.Material}> = ({r, mode, v, grassM, rockM}) => {
  const q = Math.round(v * 20) / 20;
  const geos = useMemo(
    () => fillGeo(r, mode === 'trench' ? (x, z) => hillH(x, z) - q : (x, z) => Math.min(hillH(x, z), q)),
    [r, mode, q],
  );
  useEffect(() => () => geos.forEach((g) => g?.dispose()), [geos]);
  return (
    <>
      {geos[0] && <mesh geometry={geos[0]} material={grassM} receiveShadow castShadow />}
      {geos[1] && <mesh geometry={geos[1]} material={rockM} receiveShadow castShadow />}
    </>
  );
};

/** All uncut rock. D = trench depth (from the hill surface), L = level the core has been carved down to. */
const RockFill: React.FC<{D: number; L: number}> = ({D, L}) => {
  const grassM = useHillMat();
  const rockM = useMat('basalt_carved', {tint: ROCK_TINT, normalScale: 1.4});
  if (D >= 60 && L <= 0) return null;
  return (
    <>
      <FillRegion r={REG.trL} mode="trench" v={D} grassM={grassM} rockM={rockM} />
      <FillRegion r={REG.trR} mode="trench" v={D} grassM={grassM} rockM={rockM} />
      <FillRegion r={REG.trB} mode="trench" v={D} grassM={grassM} rockM={rockM} />
      <FillRegion r={REG.core} mode="level" v={L} grassM={grassM} rockM={rockM} />
      <FillRegion r={REG.front} mode="level" v={L} grassM={grassM} rockM={rockM} />
    </>
  );
};

// ============================================================ the temple (one merged, world-UV geometry per material)
type Parts = THREE.BufferGeometry[];
const box = (P: Parts, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, ts = 3) => {
  const g = uvBox(x1 - x0, y1 - y0, z1 - z0, ts);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  P.push(g.toNonIndexed());
};
const prim = (P: Parts, g: THREE.BufferGeometry, ts = 3) => {
  const n = g.index ? g.toNonIndexed() : g;
  n.deleteAttribute('uv');
  n.computeVertexNormals();
  P.push(worldUV(n, ts));
};
/** Miniature pavilion (kuta) sitting on (x, y, z). */
const kuta = (P: Parts, x: number, y: number, z: number, s = 1.3) => {
  box(P, x - s / 2, x + s / 2, y, y + s * 0.75, z - s / 2, z + s / 2, 1.5);
  box(P, x - s * 0.62, x + s * 0.62, y + s * 0.75, y + s * 0.88, z - s * 0.62, z + s * 0.62, 1.5);
  const d = new THREE.SphereGeometry(s * 0.5, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2);
  d.scale(1, 1.1, 1);
  d.translate(x, y + s * 0.88, z);
  prim(P, d, 1.5);
};
/** Ring of kutas along the top edge of a square tier. */
const kutaRing = (P: Parts, cx: number, cz: number, hw: number, hd: number, y: number, s: number) => {
  const inset = s * 0.55;
  const xs = [cx - hw + inset, cx, cx + hw - inset];
  const zs = [cz - hd + inset, cz, cz + hd - inset];
  xs.forEach((x) => zs.forEach((z) => {
    if (x === cx && z === cz) return;
    kuta(P, x, y, z, s);
  }));
};
/** Pilaster strips on the 4 faces of a block. */
const pilasters = (P: Parts, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, step = 2.2, t = 0.22, w = 0.6) => {
  for (let x = x0 + step / 2; x < x1 - 0.5; x += step) {
    box(P, x - w / 2, x + w / 2, y0, y1, z1, z1 + t, 2);
    box(P, x - w / 2, x + w / 2, y0, y1, z0 - t, z0, 2);
  }
  for (let z = z0 + step / 2; z < z1 - 0.5; z += step) {
    box(P, x1, x1 + t, y0, y1, z - w / 2, z + w / 2, 2);
    box(P, x0 - t, x0, y0, y1, z - w / 2, z + w / 2, 2);
  }
};
const cornice = (P: Parts, x0: number, x1: number, y: number, z0: number, z1: number, o = 0.45, h = 0.55) => box(P, x0 - o, x1 + o, y, y + h, z0 - o, z1 + o, 2);
const pillar = (P: Parts, x: number, z: number, y0: number, y1: number, r = 0.32) => {
  box(P, x - r * 1.4, x + r * 1.4, y0, y0 + 0.35, z - r * 1.4, z + r * 1.4, 1);
  const c = new THREE.CylinderGeometry(r, r * 1.08, y1 - y0 - 0.75, 10);
  c.translate(x, (y0 + y1) / 2, z);
  prim(P, c, 1.5);
  box(P, x - r * 1.5, x + r * 1.5, y1 - 0.4, y1, z - r * 1.5, z + r * 1.5, 1);
};

// key dimensions
const V = {cz: -21, hw: 9}; // vimana (sanctum + tower), square, centred at z = -21
const TIERS = [
  {hw: 7.6, y0: 17, y1: 20},
  {hw: 6.2, y0: 20, y1: 23},
  {hw: 4.8, y0: 23, y1: 26},
  {hw: 3.4, y0: 26, y1: 28.5},
];
const PLINTH = {x: 13, z0: -30, z1: 5.5, h: 7.5};
const ELEPHANT_Z = [-26, -19.5, -13, -6.5, 0];
const MANDAPA = {x: 10, z0: -10, z1: 2, top: 15};
const NANDI = {x: 5, z0: 10, z1: 18};
const STAMBHA_X = 10, STAMBHA_Z = 13;
const GATE = {z0: 34, z1: 40};

const templeGeo = () => {
  const P: Parts = [], D: Parts = []; // D = dark openings
  // ---- main plinth with mouldings
  const {x, z0, z1, h} = PLINTH;
  box(P, -x + 0.4, x - 0.4, 0, h, z0 + 0.4, z1 - 0.4, 3);
  box(P, -x - 0.2, x + 0.2, 0, 1.1, z0 - 0.2, z1 + 0.2, 3);
  box(P, -x, x, 1.1, 1.5, z0, z1, 2);
  box(P, -x, x, 5.9, 6.5, z0, z1, 2);
  box(P, -x - 0.35, x + 0.35, 6.5, h, z0 - 0.35, z1 + 0.35, 2);
  // ---- vimana: sanctum walls + stepped tower
  box(P, -V.hw, V.hw, h, 16.4, V.cz - V.hw, V.cz + V.hw, 3);
  pilasters(P, -V.hw, V.hw, h, 16.4, V.cz - V.hw, V.cz + V.hw, 2.25);
  cornice(P, -V.hw, V.hw, 16.4, V.cz - V.hw, V.cz + V.hw, 0.5, 0.6);
  TIERS.forEach((t, i) => {
    box(P, -t.hw, t.hw, t.y0, t.y1 - 0.5, V.cz - t.hw, V.cz + t.hw, 2.5);
    cornice(P, -t.hw, t.hw, t.y1 - 0.5, V.cz - t.hw, V.cz + t.hw, 0.35, 0.5);
    const below = i === 0 ? {hw: V.hw} : TIERS[i - 1];
    kutaRing(P, 0, V.cz, below.hw, below.hw, t.y0, i === 0 ? 1.6 : 1.3 - i * 0.08);
  });
  kutaRing(P, 0, V.cz, TIERS[3].hw, TIERS[3].hw, 28.5, 1.0);
  const neck = new THREE.CylinderGeometry(2.2, 2.4, 1.2, 8);
  neck.translate(0, 29.1, V.cz);
  prim(P, neck, 2);
  const dome = new THREE.SphereGeometry(3.0, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  dome.scale(1, 0.85, 1);
  dome.translate(0, 29.7, V.cz);
  prim(P, dome, 2);
  const fin = new THREE.CylinderGeometry(0.25, 0.45, 0.9, 8);
  fin.translate(0, 32.15, V.cz);
  prim(P, fin, 1);
  // ---- antarala + mandapa (pillared hall) + porch
  box(P, -6, 6, h, 15, -13.2, -9.8, 3);
  box(P, -MANDAPA.x, MANDAPA.x, h, MANDAPA.top, MANDAPA.z0, MANDAPA.z1, 3);
  cornice(P, -MANDAPA.x, MANDAPA.x, MANDAPA.top, MANDAPA.z0, MANDAPA.z1, 0.6, 0.8);
  for (const s of [-1, 1]) {
    // open colonnade on each side: dark recess + 5 pillars
    D.push(...[(() => {
      const g = new THREE.PlaneGeometry(10.5, 5.6);
      g.rotateY(s * Math.PI / 2);
      g.translate(s * (MANDAPA.x + 0.02), h + 3.2, -4);
      return g.toNonIndexed();
    })()]);
    for (let k = 0; k < 5; k++) pillar(P, s * (MANDAPA.x + 0.55), -8.2 + k * 2.1, h, h + 6.2);
    box(P, s > 0 ? MANDAPA.x : -MANDAPA.x - 1.2, s > 0 ? MANDAPA.x + 1.2 : -MANDAPA.x, h + 6.2, MANDAPA.top, -9.6, 1.6, 2);
  }
  pilasters(P, -MANDAPA.x, MANDAPA.x, h, MANDAPA.top, MANDAPA.z0, MANDAPA.z1, 2.4, 0.18, 0.5);
  kutaRing(P, 0, -4, MANDAPA.x + 0.4, 6.4, MANDAPA.top + 0.8, 1.2);
  box(P, -4.4, 4.4, h, h + 0.4, MANDAPA.z1, 5.5, 2);
  for (const px of [-3.2, -1.1, 1.1, 3.2]) pillar(P, px, 4.9, h + 0.4, 13.2, 0.3);
  box(P, -4.7, 4.7, 13.2, 13.9, MANDAPA.z1, 5.6, 2);
  D.push(new THREE.PlaneGeometry(3.2, 4.6).translate(0, h + 2.3, MANDAPA.z1 + 0.02).toNonIndexed());
  // ---- bridges
  box(P, -1.9, 1.9, h - 0.7, h + 0.1, 5.5, NANDI.z0 + 0.5, 2);
  for (const s of [-1, 1]) box(P, s * 1.9 - 0.2, s * 1.9 + 0.2, h + 0.1, h + 1.1, 5.5, NANDI.z0 + 0.5, 1.5);
  box(P, -1.9, 1.9, h - 0.7, h + 0.1, NANDI.z1 - 0.5, GATE.z0 + 0.2, 2);
  for (const s of [-1, 1]) box(P, s * 1.9 - 0.2, s * 1.9 + 0.2, h + 0.1, h + 1.1, NANDI.z1 - 0.5, GATE.z0 + 0.2, 1.5);
  // ---- Nandi mandapa
  box(P, -NANDI.x, NANDI.x, 0, h, NANDI.z0, NANDI.z1, 3);
  box(P, -NANDI.x - 0.2, NANDI.x + 0.2, 0, 1.0, NANDI.z0 - 0.2, NANDI.z1 + 0.2, 2);
  box(P, -NANDI.x - 0.3, NANDI.x + 0.3, 6.6, h, NANDI.z0 - 0.3, NANDI.z1 + 0.3, 2);
  box(P, -4, 4, h, 13, NANDI.z0 + 1, NANDI.z1 - 1, 3);
  pilasters(P, -4, 4, h, 13, NANDI.z0 + 1, NANDI.z1 - 1, 2.0, 0.18, 0.5);
  cornice(P, -4, 4, 13, NANDI.z0 + 1, NANDI.z1 - 1, 0.5, 0.6);
  const roof = new THREE.ConeGeometry(4.6, 3.2, 4, 1);
  roof.rotateY(Math.PI / 4);
  roof.translate(0, 13.6 + 1.6, (NANDI.z0 + NANDI.z1) / 2);
  prim(P, roof, 2);
  const nf = new THREE.SphereGeometry(0.55, 8, 6);
  nf.translate(0, 17.3, (NANDI.z0 + NANDI.z1) / 2);
  prim(P, nf, 1);
  D.push(new THREE.PlaneGeometry(2.4, 3.6).translate(0, h + 1.8, NANDI.z1 - 0.98).toNonIndexed());
  // ---- two flag pillars (dhvajastambha)
  for (const s of [-1, 1]) {
    const px = s * STAMBHA_X;
    box(P, px - 1.3, px + 1.3, 0, 1.6, STAMBHA_Z - 1.3, STAMBHA_Z + 1.3, 2);
    box(P, px - 0.7, px + 0.7, 1.6, 13.4, STAMBHA_Z - 0.7, STAMBHA_Z + 0.7, 2);
    for (const y of [4.5, 8, 11]) box(P, px - 0.8, px + 0.8, y, y + 0.35, STAMBHA_Z - 0.8, STAMBHA_Z + 0.8, 1);
    box(P, px - 1.05, px + 1.05, 13.4, 14.2, STAMBHA_Z - 1.05, STAMBHA_Z + 1.05, 1.5);
    kuta(P, px, 14.2, STAMBHA_Z, 1.2);
    box(P, s * 13.5 - 1.6, s * 13.5 + 1.6, 0, 0.5, 16.6, 22.2, 2); // pedestal of the court elephant
  }
  // ---- gateway screen wall + gopuram
  box(P, PIT.x0, -2.6, 0, 9, GATE.z0, GATE.z1, 3);
  box(P, 2.6, PIT.x1, 0, 9, GATE.z0, GATE.z1, 3);
  box(P, -2.6, 2.6, 6.2, 9, GATE.z0, GATE.z1, 2);
  pilasters(P, PIT.x0 + 0.5, PIT.x1 - 0.5, 0, 9, GATE.z0, GATE.z1, 2.6, 0.18, 0.5);
  cornice(P, PIT.x0, PIT.x1, 9, GATE.z0, GATE.z1, 0.3, 0.6);
  box(P, -6.5, 6.5, 9.6, 13.4, GATE.z0 - 0.2, GATE.z1 + 0.2, 2.5);
  cornice(P, -6.5, 6.5, 13.4, GATE.z0 - 0.2, GATE.z1 + 0.2, 0.4, 0.5);
  const vault = new THREE.CylinderGeometry(2.4, 2.4, 11, 10, 1, false, 0, Math.PI);
  vault.rotateZ(Math.PI / 2);
  vault.rotateX(-Math.PI / 2);
  vault.scale(1, 0.9, 1);
  vault.translate(0, 13.9, (GATE.z0 + GATE.z1) / 2);
  prim(P, vault, 2);
  for (const gx of [-5.4, 5.4]) kuta(P, gx, 13.9, (GATE.z0 + GATE.z1) / 2, 1.3);
  // dark side cells in the gateway
  for (const s of [-1, 1]) D.push(new THREE.PlaneGeometry(2.2, 3.4).translate(s * 9, 1.7, GATE.z1 + 0.02).toNonIndexed());
  // dark sanctum door hint on the back + side niches of the vimana
  for (const s of [-1, 1]) D.push(new THREE.PlaneGeometry(2.2, 3.4).rotateY(s * Math.PI / 2).translate(s * (V.hw + 0.24), h + 2.6, V.cz).toNonIndexed());
  const dark = D.map((g) => {
    g.deleteAttribute('uv');
    return g;
  });
  return {main: mergeGeometries(P)!, dark: mergeGeometries(dark)!};
};

/** One elephant facing +x, standing on y=0, ~3.5 m tall. */
const elephantGeo = () => {
  const P: Parts = [];
  const s = (r: number, sx: number, sy: number, sz: number, x: number, y: number, z: number) => {
    const g = new THREE.SphereGeometry(r, 14, 10);
    g.scale(sx, sy, sz);
    g.translate(x, y, z);
    prim(P, g, 1.5);
  };
  s(1, 1.75, 1.25, 1.1, 0, 2.2, 0); // body
  s(1, 0.9, 0.85, 1.0, -0.6, 2.55, 0); // hump of the back
  s(0.9, 1.0, 1.05, 0.92, 1.75, 2.6, 0); // head
  s(0.35, 1, 1, 1, 1.95, 3.25, 0.3); // forehead domes
  s(0.35, 1, 1, 1, 1.95, 3.25, -0.3);
  for (const z of [-0.95, 0.95]) s(0.8, 0.95, 1.15, 0.22, 1.35, 2.45, z); // flat ears along the head
  for (const [lx, lz] of [[1.0, 0.58], [1.0, -0.58], [-1.05, 0.58], [-1.05, -0.58]]) {
    const c = new THREE.CylinderGeometry(0.42, 0.5, 1.75, 12);
    c.translate(lx, 0.875, lz);
    prim(P, c, 1.5);
    const foot = new THREE.CylinderGeometry(0.52, 0.55, 0.18, 12);
    foot.translate(lx, 0.09, lz);
    prim(P, foot, 1.5);
  }
  const tc = new THREE.CatmullRomCurve3([
    new THREE.Vector3(2.45, 2.45, 0), new THREE.Vector3(2.75, 1.8, 0), new THREE.Vector3(2.72, 1.0, 0), new THREE.Vector3(2.85, 0.45, 0), new THREE.Vector3(3.15, 0.3, 0),
  ]);
  for (let i = 0; i <= 14; i++) {
    const p = tc.getPoint(i / 14);
    s(0.4 - 0.22 * (i / 14), 1, 1, 1, p.x, p.y, p.z); // tapering trunk
  }
  for (const z of [-0.36, 0.36]) {
    const t = new THREE.ConeGeometry(0.11, 1.1, 8);
    t.rotateZ(-Math.PI / 2 - 0.45);
    t.translate(2.7, 1.85, z);
    prim(P, t, 1);
  }
  const tail = new THREE.CylinderGeometry(0.05, 0.08, 1.1, 6);
  tail.rotateZ(-0.2);
  tail.translate(-1.85, 1.75, 0);
  prim(P, tail, 1);
  return mergeGeometries(P)!;
};
/** Elephant placements: [x, z, rotY] — frieze around the plinth + two court elephants. */
const ELEPHANTS: [number, number, number][] = [
  ...ELEPHANT_Z.flatMap((z) => [[PLINTH.x - 0.4 + 0.7, z, 0], [-PLINTH.x + 0.4 - 0.7, z, Math.PI]] as [number, number, number][]),
  [-6, PLINTH.z0 + 0.4 - 0.3, Math.PI / 2], [6, PLINTH.z0 + 0.4 - 0.3, Math.PI / 2],
  [13.5, 18.8, -Math.PI / 2], [-13.5, 18.8, -Math.PI / 2],
];
const COURT_ELEPHANTS = new Set([12, 13]);
const elephantsMerged = (g: THREE.BufferGeometry) =>
  mergeGeometries(ELEPHANTS.map(([x, z, r], i) => {
    const c = g.clone();
    c.rotateY(r);
    c.translate(x, COURT_ELEPHANTS.has(i) ? 0.5 : 0, z);
    return c;
  }))!;

/** Galleries carved into the side cliffs (pillars + dark recess + overhang). */
const galleryGeo = () => {
  const P: Parts = [], D: Parts = [];
  for (const s of [-1, 1]) {
    const wx = s > 0 ? PIT.x1 : PIT.x0;
    for (let z = -37; z <= 27; z += 3.2) pillar(P, wx - s * 1.3, z, 0, 8.2, 0.34);
    box(P, s > 0 ? wx - 2.1 : wx, s > 0 ? wx : wx + 2.1, 8.2, 9.2, -38.8, 28.8, 2);
    box(P, s > 0 ? wx - 2.1 : wx, s > 0 ? wx : wx + 2.1, 0, 0.3, -38.8, 28.8, 2);
    const d = new THREE.PlaneGeometry(67.6, 8.2);
    d.rotateY(-s * Math.PI / 2);
    d.translate(wx - s * 0.04, 4.1, -5);
    D.push(d.toNonIndexed());
  }
  const dark = D.map((g) => {
    g.deleteAttribute('uv');
    return g;
  });
  return {main: mergeGeometries(P)!, dark: mergeGeometries(dark)!};
};

const useClip = (keepAbove: number) => {
  const p = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  p.constant = -keepAbove;
  return useMemo(() => [p], [p]);
};

/**
 * The carved temple. L = carve level (only parts above L exist), eleph = 0 rough blocks .. 1 finished elephants,
 * gal = gallery carve level (galleries exist above it; 9.2 = none yet).
 */
const Temple: React.FC<{L?: number; eleph?: number; gal?: number}> = ({L = -1, eleph = 1, gal = -1}) => {
  const geo = useMemo(templeGeo, []);
  const eGeo = useMemo(() => elephantsMerged(elephantGeo()), []);
  const gGeo = useMemo(galleryGeo, []);
  const clip = useClip(L);
  const gclip = useClip(gal);
  const stone = useMat('basalt_carved', {tint: ROCK_TINT, normalScale: 1.2, clip});
  const gstone = useMat('basalt_carved', {tint: ROCK_TINT, normalScale: 1.2, clip: gclip});
  const dark = useMemo(() => new THREE.MeshStandardMaterial({color: '#0d0a08', roughness: 1, clippingPlanes: clip}), [clip]);
  const gdark = useMemo(() => new THREE.MeshStandardMaterial({color: '#0d0a08', roughness: 1, clippingPlanes: gclip}), [gclip]);
  const blockG = useMemo(() => uvBox(5.2, 3.9, 2.9, 3), []);
  return (
    <group>
      <mesh geometry={geo.main} material={stone} castShadow receiveShadow />
      <mesh geometry={geo.dark} material={dark} />
      {eleph > 0 && <mesh geometry={eGeo} material={stone} castShadow receiveShadow />}
      {ELEPHANTS.map(([x, z, r], i) => {
        // rough block around each elephant, shrinking away as the carvers reveal it (staggered)
        const k = Math.min(1, Math.max(0, eleph * 1.6 - (i % 7) * 0.1));
        if (k >= 1) return null;
        const sc = 1 - 0.65 * k;
        const y0 = COURT_ELEPHANTS.has(i) ? 0.5 : 0;
        return <mesh key={i} geometry={blockG} material={stone} position={[x + Math.cos(r) * 0.9, y0 + 1.95 * sc, z - Math.sin(r) * 0.9]} rotation={[0, r, 0]} scale={[sc, sc, sc]} castShadow receiveShadow />;
      })}
      {gal < 9.2 && (
        <>
          <mesh geometry={gGeo.main} material={gstone} castShadow receiveShadow />
          <mesh geometry={gGeo.dark} material={gdark} />
        </>
      )}
    </group>
  );
};

/** X-ray outline of the future temple inside the rock (drawn through everything), revealed bottom-up to height R. */
const GhostTemple: React.FC<{R: number; opacity: number}> = ({R, opacity}) => {
  const geo = useMemo(templeGeo, []);
  const eGeo = useMemo(() => elephantsMerged(elephantGeo()), []);
  const p = useMemo(() => new THREE.Plane(new THREE.Vector3(0, -1, 0), 0), []);
  p.constant = R;
  const clip = useMemo(() => [p], [p]);
  const edges = useMemo(() => new THREE.EdgesGeometry(geo.main, 35), [geo]);
  const fill = useMemo(() => new THREE.MeshBasicMaterial({color: '#ffcf4a', transparent: true, opacity: 0.1, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, clippingPlanes: clip}), [clip]);
  const line = useMemo(() => new THREE.LineBasicMaterial({color: '#ffd75e', transparent: true, opacity: 0.85, depthTest: false, depthWrite: false, clippingPlanes: clip}), [clip]);
  fill.opacity = 0.1 * opacity;
  line.opacity = 0.85 * opacity;
  return (
    <group renderOrder={10}>
      <mesh geometry={geo.main} material={fill} renderOrder={10} />
      <mesh geometry={eGeo} material={fill} renderOrder={10} />
      <lineSegments geometry={edges} material={line} renderOrder={11} />
    </group>
  );
};

// ============================================================ props
const Basket: React.FC<{at: [number, number, number]; full?: boolean}> = ({at, full = true}) => {
  const m = useMat('straw', {tint: '#c8a870'});
  const rub = useMat('basalt_rough', {tint: '#bbb'});
  return (
    <group position={at}>
      <mesh material={m} castShadow>
        <cylinderGeometry args={[0.36, 0.24, 0.26, 12]} />
      </mesh>
      {full && (
        <mesh position={[0, 0.12, 0]} material={rub} scale={[1, 0.45, 1]} castShadow>
          <sphereGeometry args={[0.33, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2]} />
        </mesh>
      )}
    </group>
  );
};

/** A worker carrying a basket of rubble on the head, walking (feet locked to distance). */
const Carrier: React.FC<{start: [number, number, number]; heading: number; f: number; seed: number; full?: boolean; ground?: (x: number, z: number) => number}> = ({start, heading, f, seed, full = true, ground = worldH}) => {
  const w = walkAlong(start, heading, f, 1.15, ground);
  return (
    <>
      <Person position={w.position} rotY={w.rotY} t={w.t} pose={full ? 'carry' : 'walk'} legs="walk" seed={seed} head={seed % 2 ? 'cloth' : 'hair'} />
      <Basket at={full ? [w.position[0], w.position[1] + 2.05, w.position[2]] : [w.position[0] + Math.cos(w.rotY + 1.57) * 0.35, w.position[1] + 0.95, w.position[2] - Math.sin(w.rotY + 1.57) * 0.35]} full={full} />
    </>
  );
};

/** Ladder leaning on a wall: foot at a, top at b. */
const Ladder: React.FC<{a: [number, number, number]; b: [number, number, number]; side: [number, number, number]}> = ({a, b, side}) => {
  const n = Math.floor(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / 0.4);
  const add = (p: [number, number, number], k: number): [number, number, number] => [p[0] + side[0] * k, p[1] + side[1] * k, p[2] + side[2] * k];
  return (
    <group>
      <Beam a={add(a, -0.3)} b={add(b, -0.3)} r={0.05} />
      <Beam a={add(a, 0.3)} b={add(b, 0.3)} r={0.05} />
      {Array.from({length: n}, (_, i) => {
        const t = (i + 0.5) / n;
        const p: [number, number, number] = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
        return <Beam key={i} a={add(p, -0.3)} b={add(p, 0.3)} r={0.03} />;
      })}
    </group>
  );
};

/** Tall ladder leaning on the right pit wall, in front of the galleries. */
const WallLadder: React.FC = () => <Ladder a={[19.6, 0, 29.2]} b={[PIT.x1 - 0.15, hillH(PIT.x1, 29.2) + 0.6, 29.2]} side={[0, 0, 1]} />;

const HEAP = {x: 46, z: 92};
const HEAP_PATH = {from: [0, 0, 46] as [number, number, number], heading: Math.atan2(-(HEAP.z - 46), HEAP.x)};
const SpoilHeap: React.FC<{s: number}> = ({s}) => {
  const m = useMat('gravel', {tint: '#5f5a55', repeat: [6, 3], normalScale: 1.5});
  const rocks = useMemo(() => Array.from({length: 9}, (_, i) => ({a: rnd(i * 3.3) * Math.PI * 2, r: 0.55 + rnd(i * 5.1) * 0.5, sc: 0.6 + rnd(i * 7.7) * 0.7})), []);
  if (s <= 0.01) return null;
  const R = 9.5 * Math.sqrt(s), H = 5.2 * Math.sqrt(s);
  return (
    <group position={[HEAP.x, 0, HEAP.z]}>
      <mesh position={[0, H / 2 - 0.2, 0]} material={m} castShadow receiveShadow>
        <coneGeometry args={[R, H, 24, 1]} />
      </mesh>
      {rocks.map((k, i) => (
        <Rock key={i} position={[Math.cos(k.a) * R * k.r, 0.3, Math.sin(k.a) * R * k.r]} scale={k.sc} seed={i + 300} tex="basalt_rough" />
      ))}
    </group>
  );
};

// ============================================================ landscape
const FLORA = (() => {
  const out: {kind: number; pos: [number, number, number]; s: number; seed: number}[] = [];
  let i = 0;
  while (out.length < 52 && i < 4000) {
    i++;
    const x = (rnd(i * 3.1) - 0.5) * 420;
    const z = (rnd(i * 7.3) - 0.5) * 420 - 40;
    if (x > PIT.x0 - 8 && x < PIT.x1 + 8 && z > PIT.z0 - 8 && z < PIT.z1 + 30) continue;
    if (x > -10 && x < HEAP.x + 25 && z > 40 && z < HEAP.z + 25) continue;
    const y = hillH(x, z);
    const s1 = hillH(x + 2, z) - y, s2 = hillH(x, z + 2) - y;
    if (Math.hypot(s1, s2) > 1.2) continue; // no trees on the cliff faces
    const kind = y < 5 ? (rnd(i) < 0.35 ? 1 : rnd(i) < 0.6 ? 2 : 0) : rnd(i) < 0.6 ? 0 : 2;
    out.push({kind, pos: [x, y - 0.15, z], s: 1.0 + rnd(i * 11) * 0.8, seed: i});
  }
  return out;
})();

const Landscape: React.FC = () => (
  <group>
    <HillTerrain />
    <PitShell />
    {FLORA.map((t, i) =>
      t.kind === 0 ? <Tree key={i} position={t.pos} scale={t.s} seed={t.seed} leaf={i % 3 ? '#4c7330' : '#5d7d33'} /> :
      t.kind === 1 ? <PalmTree key={i} position={t.pos} scale={t.s} seed={t.seed} /> :
      <Bush key={i} position={t.pos} scale={t.s * 1.5} seed={t.seed} color="#4f6b2c" />,
    )}
    {[0, 1, 2, 3, 4, 5, 6].map((i) => {
      const x = (i % 2 ? 1 : -1) * (32 + rnd(i) * 30), z = 46 + rnd(i + 9) * 8;
      return <Rock key={i} position={[x, hillH(x, z) + 0.3, z]} scale={[2.6, 1.6, 2.2]} seed={i + 40} tex="basalt_rough" />;
    })}
  </group>
);

/** Sky, sun, haze. golden = 0 morning .. 1 sunset. */
const Atmos: React.FC<{f: number; golden?: number; shadow?: number; target?: [number, number, number]}> = ({f, golden = 0, shadow = 70, target = [0, 10, -5]}) => {
  const sunDir: [number, number, number] = [-0.18 - 0.6 * golden, 1.0 - 0.72 * golden, 0.36 + 0.24 * golden];
  const sunCol = new THREE.Color('#fff0d6').lerp(new THREE.Color('#ffb066'), golden).getStyle();
  const hor = new THREE.Color('#cfdbe0').lerp(new THREE.Color('#f0c79a'), golden).getStyle();
  return (
    <>
      <Renderer exposure={0.98 + 0.22 * golden} envIntensity={0.75} />
      <SkyDome top={golden ? '#4b6aa8' : '#3f78bd'} horizon={hor} bottom="#8a8a70" sunDir={sunDir} sunColor={sunCol} clouds={0.55} time={f / 30} />
      <Sun dir={sunDir} intensity={2.9 - 0.3 * golden} color={sunCol} shadowSize={shadow} shadowRes={4096} target={target} skyColor="#c4d6e6" groundColor="#7a7660" hemi={0.95} />
      <fog attach="fog" args={[hor, 170, 760]} />
    </>
  );
};

// ============================================================ stage + labels
const Stage: React.FC<{cam: Cam; children: React.ReactNode; hdri?: string}> = ({cam, children, hdri = 'spruit_sunrise_1k'}) => {
  const {width, height} = useVideoConfig();
  return (
    <AbsoluteFill style={{background: '#0e0b08'}}>
      <ThreeCanvas width={width} height={height} shadows camera={{fov: cam.fov, near: 0.3, far: 3000}}>
        <AssetProvider textures={TEXTURES} hdri={hdri}>
          <CameraRig pos={cam.pos} target={cam.target} fov={cam.fov} />
          {children}
        </AssetProvider>
      </ThreeCanvas>
      <Grade strength={0.32} />
    </AbsoluteFill>
  );
};

const Pin: React.FC<{p: [number, number, number]; cam: Cam; text: string; delay: number; dx?: number; dy?: number; size?: number; anchor?: 'left' | 'right' | 'center'; bg?: string; fg?: string}> = ({p, cam, text, delay, dx = 0, dy = 0, size = 50, anchor = 'center', bg, fg}) => {
  const [x, y, vis] = toScreen(p, cam);
  if (!vis) return null;
  const w = text.length * size * 0.56 + size * 0.9;
  let lx = x + dx;
  const left = anchor === 'left' ? lx : anchor === 'right' ? lx - w : lx - w / 2;
  if (left < 36) lx += 36 - left;
  if (left + w > 1044) lx -= left + w - 1044;
  return <Tag text={text} x={lx} y={Math.min(1480, Math.max(470, y + dy))} delay={delay} size={size} anchor={anchor} bg={bg} fg={fg} />;
};

// global "spoil heap" growth across the 8th-century scenes
const heapAt = (scene: number, f: number) => {
  const a = [0, 0, 0.12, 0.28, 0.5, 0.74, 0.82][scene] ?? 1;
  const b = [0, 0, 0.28, 0.5, 0.74, 0.82, 1][scene] ?? 1;
  return a + (b - a) * Math.min(1, f / LEN[scene]);
};

// ============================================================ S1 hook — the finished temple today
const S1: React.FC = () => {
  const f = useCurrentFrame();
  const cam = groundSafe(camPath(f, [
    {t: 0, pos: [44, 40, 112], target: [0, 9, -8], fov: 44},
    {t: LEN[0], pos: [18, 66, 92], target: [0, 6, -10], fov: 46},
  ]), worldH);
  return (
    <>
      <Stage cam={cam}>
        <Atmos f={f} />
        <Landscape />
        <Temple />
        <Person {...walkAlong([6.5, 0, 31], Math.PI / 2, f, 1.2)} seed={71} outfit="#c0392b" />
        <Person {...walkAlong([7.4, 0, 32.2], Math.PI / 2, f + 11, 1.2)} seed={72} outfit="#e8e2d0" />
        <Person {...walkAlong([-19.5, 0, -10], -Math.PI / 2, f, 1.1)} seed={73} outfit="#2f5d8a" />
      </Stage>
      <Headline top="KAILASA TEMPLE, INDIA" big="1 ROCK" sub="carved, never built" delay={4} y={150} bigSize={170} />
    </>
  );
};

// ============================================================ S2 the uncut hill + the idea inside it
const S2: React.FC = () => {
  const f = useCurrentFrame();
  const L = LEN[1];
  const cam = groundSafe(camPath(f, [
    {t: 0, pos: [58, 22, 128], target: [0, 20, -8], fov: 42},
    {t: L, pos: [34, 34, 98], target: [0, 18, -10], fov: 44},
  ]), worldH);
  const tGhost = wordAt(1, 'imagined');
  const R = -1 + ramp(f, tGhost, tGhost + 50) * 35;
  const ghostOp = ramp(f, tGhost - 4, tGhost + 6);
  const tFinal = wordAt(1, 'Every cut');
  const hz = 26;
  return (
    <>
      <Stage cam={cam}>
        <Atmos f={f} />
        <Landscape />
        <RockFill D={0} L={99} />
        <Person position={[-3, hillH(-3, hz), hz]} rotY={-Math.PI / 2 + 0.3} pose="point" seed={81} head="cloth" />
        <Person position={[-1.6, hillH(-1.6, hz + 0.8), hz + 0.8]} rotY={-Math.PI / 2 - 0.2} pose="stand" seed={82} />
        <GhostTemple R={R} opacity={ghostOp} />
      </Stage>
      <Pin p={[16, 20, 40]} cam={cam} text="BASALT HILL" delay={10} dy={-40} size={50} />
      <Caption text="Ellora, India · 8th century" delay={14} bottom={330} />
      <Sequence from={tFinal} layout="none">
        <Tag text="EVERY CUT IS FINAL" x={540} y={1260} anchor="center" delay={0} size={64} bg={C.red} fg={C.white} />
      </Sequence>
    </>
  );
};

// ============================================================ S3 step 1: three trenches
const S3: React.FC = () => {
  const f = useCurrentFrame();
  const L = LEN[2];
  const D = ramp(f, 8, L - 12, Easing.inOut(Easing.quad)) * 36;
  const cam = groundSafe(camPath(f, [
    {t: 0, pos: [-46, 80, 62], target: [0, 6, -12], fov: 48},
    {t: L, pos: [-36, 86, 58], target: [0, 4, -12], fov: 48},
  ]), worldH);
  const rim: [number, number, number, number][] = [[-25, -14, 0], [-25, 6, 0], [25, -20, Math.PI], [25, 0, Math.PI], [-6, -43, -Math.PI / 2], [8, -43, -Math.PI / 2]];
  return (
    <>
      <Stage cam={cam}>
        <Atmos f={f} shadow={80} />
        <Landscape />
        <RockFill D={D} L={99} />
        {rim.map(([x, z, r], i) => (
          <React.Fragment key={i}>
            <Person position={[x, hillH(x, z), z]} rotY={r} pose={i % 2 ? 'chisel' : 'hammer'} t={f * 0.21 + i} seed={90 + i} head={i % 3 ? 'cloth' : 'hair'} />
            <Dust at={[x + Math.cos(r) * 1.1, hillH(x, z) + 0.2, z - Math.sin(r) * 1.1]} f={f + i * 5} color="#8d867c" />
          </React.Fragment>
        ))}
        <SpoilHeap s={heapAt(2, f)} />
      </Stage>
      <StepBadge n={1} title="CUT 3 TRENCHES" delay={3} />
      <Pin p={[-20.2, hillH(-20, -10) - D * 0.5, -10]} cam={cam} text="TRENCH" delay={22} size={46} dx={-10} />
      <Pin p={[20.2, hillH(20, -30) - D * 0.5, -30]} cam={cam} text="TRENCH" delay={30} size={46} dx={10} />
      <Pin p={[0, hillH(0, -37) - D * 0.4, -37]} cam={cam} text="TRENCH" delay={38} size={46} dy={-50} />
      <Pin p={[-6, hillH(-6, 18), 18]} cam={cam} text="ONE GIANT BLOCK" delay={Math.round(L * 0.62)} size={52} dy={0} />
    </>
  );
};

// ============================================================ S4 step 2: carve from the top down
const S4: React.FC = () => {
  const f = useCurrentFrame();
  const L = LEN[3];
  const lvl = TOP + 0.5 - ramp(f, 6, L - 6, Easing.inOut(Easing.sin)) * (TOP + 0.5 - 17);
  const cam = groundSafe(camPath(f, [
    {t: 0, pos: [-34, 46, 26], target: [0, 28, -20], fov: 50},
    {t: L, pos: [-30, 36, 30], target: [0, 21, -18], fov: 52},
  ]), worldH);
  const crew: [number, number, number][] = [[10.6, -21, Math.PI], [-10.6, -24, 0], [3, -31.6, -Math.PI / 2], [-4, -31.6, -Math.PI / 2], [0, -11.4, Math.PI / 2], [11.5, -27, -2.66]];
  return (
    <>
      <Stage cam={cam}>
        <Atmos f={f} shadow={50} target={[0, 20, -18]} />
        <Landscape />
        <RockFill D={60} L={lvl} />
        <Temple L={lvl} eleph={0} gal={9.2} />
        {crew.map(([x, z, r], i) => {
          const y = Math.min(hillH(x, z), lvl);
          return (
            <React.Fragment key={i}>
              <Person position={[x, y, z]} rotY={r} pose={i % 3 === 2 ? 'hammer' : 'chisel'} t={f * 0.22 + i * 1.3} seed={100 + i} head={i % 2 ? 'cloth' : 'hair'} />
              <Dust at={[x + Math.cos(r) * 0.9, y + 0.15, z - Math.sin(r) * 0.9]} f={f + i * 4} color="#7d776f" />
            </React.Fragment>
          );
        })}
        <WallLadder />
        <SpoilHeap s={heapAt(3, f)} />
      </Stage>
      <StepBadge n={2} title="START AT THE TOP" delay={3} />
      <Pin p={[0, Math.max(lvl, 29), V.cz]} cam={cam} text="TOWER FIRST" delay={wordAt(3, 'tower') - 4} size={50} dy={-80} />
      <Caption text="Carvers stood on the rock they hadn't cut yet" delay={wordAt(3, 'standing') - 6} bottom={330} />
    </>
  );
};

// ============================================================ S5 step 3: hollow it out
const S5: React.FC = () => {
  const f = useCurrentFrame();
  const L = LEN[4];
  const lvl = 17 - ramp(f, 0, L * 0.62, Easing.inOut(Easing.sin)) * 17.3;
  const gal = 9.2 - ramp(f, L * 0.35, L * 0.9) * 9.5;
  const cam = groundSafe(camPath(f, [
    {t: 0, pos: [-20, 42, 66], target: [0, 8, -8], fov: 50},
    {t: L, pos: [-12, 34, 58], target: [0, 7, -6], fov: 52},
  ]), worldH);
  const tHall = wordAt(4, 'sixteen'), tShr = wordAt(4, 'shrines'), tBr = wordAt(4, 'bridge');
  return (
    <>
      <Stage cam={cam}>
        <Atmos f={f} shadow={60} target={[0, 6, -4]} />
        <Landscape />
        <RockFill D={60} L={lvl} />
        <Temple L={lvl} eleph={0} gal={gal} />
        {[0, 1, 2, 3].map((k) => (
          <Carrier key={k} start={[19.4, 0, -36 + k * 15]} heading={-Math.PI / 2} f={f} seed={110 + k} />
        ))}
        <Carrier start={[18.6, 0, 20]} heading={Math.PI / 2} f={f} seed={115} full={false} />
        {[[15.6, 26.5, Math.PI / 2], [-15.6, 27.5, Math.PI / 2]].map(([x, z, r], i) => {
          const y = Math.min(hillH(x, z), lvl);
          return <Person key={i} position={[x, y, z]} rotY={r} pose="chisel" t={f * 0.2 + i} seed={118 + i} head="cloth" />;
        })}
        <WallLadder />
        <SpoilHeap s={heapAt(4, f)} />
      </Stage>
      <StepBadge n={3} title="HOLLOW IT OUT" delay={3} />
      <Pin p={[-MANDAPA.x - 0.6, 11.5, -4]} cam={cam} text="16-PILLAR HALL" delay={tHall - 4} size={46} dx={-20} anchor="right" />
      <Pin p={[0, 15, (NANDI.z0 + NANDI.z1) / 2]} cam={cam} text="SHRINE" delay={tShr - 4} size={46} dy={-70} />
      <Pin p={[0, 8.2, 8]} cam={cam} text="STONE BRIDGE" delay={tBr - 4} size={46} dx={40} dy={60} anchor="left" />
      <Caption text="Still part of the hill underneath" delay={wordAt(4, 'all still')} bottom={330} />
    </>
  );
};

// ============================================================ S6 step 4: elephants
const S6: React.FC = () => {
  const f = useCurrentFrame();
  const L = LEN[5];
  const eleph = ramp(f, 4, L * 0.8, Easing.linear);
  const cam = camPath(f, [
    {t: 0, pos: [-20.3, 2.4, 13], target: [-14, 2.2, -10], fov: 50},
    {t: L, pos: [-19.8, 3.4, 9.5], target: [-13.6, 2.6, -12], fov: 48},
  ]);
  const crew: [number, number, number][] = [[-15.8, -4.3, Math.PI / 2], [-15.8, -11.0, Math.PI / 2], [-15.8, -17.5, Math.PI / 2]];
  return (
    <>
      <Stage cam={cam}>
        <Atmos f={f} shadow={40} target={[-14, 2, -10]} />
        <directionalLight position={[-30, 12, 30]} intensity={0.9} color="#e8eef5" />
        <Landscape />
        <Temple L={-1} eleph={eleph} gal={-1} />
        {crew.map(([x, z, r], i) => (
          <React.Fragment key={i}>
            <Person position={[x, 0, z]} rotY={r} pose={i === 1 ? 'hammer' : 'chisel'} t={f * 0.22 + i * 2} seed={130 + i} head={i % 2 ? 'cloth' : 'hair'} />
            <Dust at={[x + Math.cos(r) * 0.9, 1.3, z - Math.sin(r) * 0.9]} f={f + i * 6} color="#857f77" />
          </React.Fragment>
        ))}
        <Carrier start={[-20.4, 0, -30]} heading={-Math.PI / 2} f={f} seed={136} />
        {Array.from({length: 10}, (_, i) => (
          <Rock key={i} position={[-17.6 - rnd(i) * 1.0, 0.1, -1 - i * 2.3]} scale={0.18 + rnd(i * 3) * 0.2} seed={i + 200} tex="basalt_rough" />
        ))}
      </Stage>
      <StepBadge n={4} title="THE DETAILS" delay={3} />
      <Pin p={[-15.8, 3.6, -6.5]} cam={cam} text="ELEPHANTS" delay={wordAt(5, 'Elephants') - 3} size={52} dy={-90} />
      <Caption text="They seem to hold the whole temple up" delay={wordAt(5, 'make it') - 4} bottom={330} />
    </>
  );
};

// ============================================================ S7 the waste
const S7: React.FC = () => {
  const f = useCurrentFrame();
  const L = LEN[6];
  const cam = groundSafe(camPath(f, [
    {t: 0, pos: [70, 30, 142], target: [16, 4, 52], fov: 50},
    {t: L, pos: [78, 46, 150], target: [14, 6, 40], fov: 52},
  ]), worldH);
  const dir = HEAP_PATH.heading;
  const len = Math.hypot(HEAP.x, HEAP.z - 46) - 12;
  const loaded = Array.from({length: 7}, (_, k) => k * (len / 7));
  return (
    <>
      <Stage cam={cam}>
        <Atmos f={f} shadow={90} target={[15, 4, 50]} />
        <Landscape />
        <Temple />
        <SpoilHeap s={heapAt(6, f)} />
        <WallLadder />
        {loaded.map((d, k) => (
          <Carrier key={k} start={[Math.cos(dir) * d + 1.0, 0, 46 - Math.sin(dir) * d]} heading={dir} f={f} seed={140 + k} />
        ))}
        {loaded.slice(0, 5).map((d, k) => (
          <Carrier key={'r' + k} start={[Math.cos(dir) * (d + 5) - 1.0, 0, 46 - Math.sin(dir) * (d + 5) + 1.2]} heading={dir + Math.PI} f={f} seed={150 + k} full={false} />
        ))}
        {[0, 1, 2].map((k) => (
          <Carrier key={'c' + k} start={[0, 0, 19.5 + k * 7]} heading={-Math.PI / 2} f={f} seed={160 + k} />
        ))}
      </Stage>
      <Headline top="TONNES OF ROCK" big="200,000" sub="carried out (estimate)" delay={wordAt(6, 'two hundred') - 8} y={150} bigSize={150} />
      <Pin p={[HEAP.x, 7, HEAP.z]} cam={cam} text="SPOIL HEAP" delay={18} size={46} dy={-50} />
      <Caption text="Broken off by hand, carried out in baskets" delay={wordAt(6, 'broken') - 4} bottom={330} />
    </>
  );
};

// ============================================================ S8 payoff — golden hour today
const S8: React.FC = () => {
  const f = useCurrentFrame();
  const L = LEN[7];
  const a = interpolate(f, [0, L], [-0.62, -0.3]);
  const R = interpolate(f, [0, L], [104, 118]);
  const cam = groundSafe({pos: [Math.sin(a) * R, 54 + f * 0.04, Math.cos(a) * R - 8], target: [0, 9, -10], fov: 46} as Cam, worldH, 4);
  const tOne = wordAt(7, 'One rock');
  return (
    <>
      <Stage cam={cam} hdri="venice_sunset_1k">
        <Atmos f={f} golden={0.65} shadow={80} />
        <Landscape />
        <Temple />
        <Person {...walkAlong([-0.6, 0, 21], -Math.PI / 2, f, 1.1)} seed={171} outfit="#d9a21b" />
        <Person {...walkAlong([0.6, 0, 22.2], -Math.PI / 2, f + 8, 1.1)} seed={172} outfit="#f1ece0" />
      </Stage>
      <Sequence durationInFrames={tOne - 6} layout="none">
        <Pin p={[0, 32.6, V.cz]} cam={cam} text="~30 M TALL" delay={8} size={56} dy={-70} />
      </Sequence>
      <Caption text="Often called the largest monolith on Earth" delay={wordAt(7, 'often') - 4} bottom={330} />
      <Sequence from={tOne - 6} layout="none">
        <Headline top="ONE ROCK" big="NO BRICKS" sub="no mortar" delay={0} y={150} bigSize={150} />
      </Sequence>
    </>
  );
};

// ============================================================ timeline
const SCENES = [S1, S2, S3, S4, S5, S6, S7, S8];

export const Kailasa: React.FC = () => (
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
        <Audio src={staticFile(`vo/ep007-kailasa_${i}.wav`)} />
      </Sequence>
    ))}
    <Watermark />
  </AbsoluteFill>
);

export const KAILASA_START = START;
export const KAILASA_LEN = LEN;
