// Episode 11 (Format B): Hot desert room -> windcatcher (badgir): air conditioning with no power.
// Look: teal evening sky + low amber sun, architectural section through a mud-brick house, thermal air ribbons (red -> cyan),
// turquoise tiles in the cellar. Very different from EP009 (tan exterior) and EP010 (green gorge).
import React, {useEffect, useMemo} from 'react';
import {AbsoluteFill, Audio, interpolate, Sequence, staticFile, useCurrentFrame, useVideoConfig, Easing} from 'remotion';
import {ThreeCanvas} from '@remotion/three';
import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import VO from './ep011-windcatcher-vo.json';
import {AssetProvider, Renderer, SkyDome, Sun, TexName, useMat, usePlainMat, uvBox, worldUV} from '../hib/pbr';
import {Beam, Dust, KIT_TEXTURES, PalmTree, Person, Plank, Rock, ScaffoldBay, Terrain, Water, rnd, walkAlong} from '../hib/models';
import {CameraRig} from '../hib/three';
import {Cam, camPath, groundSafe, toScreen} from '../hib/project';
import {C, Caption, Grade, Headline, ProbFix, SceneFade, Tag, Watermark} from '../hib/ui';

// ============================================================ timing
const FPS = 30;
const VO_DELAY = 5;
const sceneLen = (i: number, tail: number) => Math.ceil((VO.durations[i] + tail) * FPS) + VO_DELAY;
const LEN = [sceneLen(0, 0.3), sceneLen(1, 0.25), sceneLen(2, 0.25), sceneLen(3, 0.25), sceneLen(4, 0.25), sceneLen(5, 0.25), sceneLen(6, 0.25), sceneLen(7, 1.0)];
const START = LEN.map((_, i) => LEN.slice(0, i).reduce((a, b) => a + b, 0));
export const WINDCATCHER_DURATION = LEN.reduce((a, b) => a + b, 0);
/** frame (local to scene i) at which word `w` is spoken (estimated from character position). */
const wordAt = (i: number, w: string) => {
  const k = VO.lines[i].indexOf(w);
  if (k < 0) throw new Error(`word "${w}" not in line ${i}`);
  return Math.round(VO_DELAY + (k / VO.lines[i].length) * VO.durations[i] * FPS);
};

const cl = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
const ramp = (f: number, a: number, b: number, ease = Easing.inOut(Easing.cubic)) => interpolate(f, [a, b], [0, 1], {...cl, easing: ease});
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const TEXTURES: TexName[] = [
  ...KIT_TEXTURES, 'mud_brick', 'mud_plaster', 'plaster_ochre', 'plaster_white', 'cracked_earth', 'dirt', 'sand', 'kashi_tile', 'persian_rug', 'water', 'stone_face_sand',
];

// ============================================================ layout (metres). Section plane z = 0, camera at +z.
const R = {x0: -4.6, x1: 4.6, z0: -6.05, z1: 6.05, h: 4.2}; // room interior
const THIN = 0.2;
const T = 0.95; // full wall thickness
const ROOFT = 0.55;
const RT = R.h + ROOFT; // roof top
const WIN = {y1: 2.5, z: 1.5}; // opening in the left wall
const TW = {x0: 0.7, x1: 3.7, z0: -1.5, z1: 1.5, t: 0.28, vent: 10.9, top: 13.3};
const TX = (TW.x0 + TW.x1) / 2;
const CL = {x0: -5, x1: 4.4, z0: -5, y0: -3.6, y1: -1.6, stairX: -1.4, slabX: -1.9, pool: -1.4, poolY: -4.5, wat: -3.85};
const GRATE = {x0: 2.4, x1: 3.6};
const DEEP = -24;
const B = 240;

const SUN_DIR: [number, number, number] = [-0.5, 0.52, 0.72];
const SUN_GOLD: [number, number, number] = [-0.72, 0.3, 0.62];

/** ground height for the camera guard */
const groundH = (cut: boolean) => (x: number, z: number) => (cut && z > 0 ? DEEP : 0);

// ---- colours of the air
const HOT = '#ff4a1f';
const WARM = '#ffb030';
const COOL = '#27d8ff';
const WIND = '#dff6ff';

// ---- air paths (x, y) in the section plane
const P3 = (pts: [number, number][], z = -0.4): [number, number, number][] => pts.map(([x, y]) => [x, y, z]);
const PATH = {
  over: P3([[20, 14.9], [10, 14.9], [4, 15.1], [-1, 15.2], [-8, 14.9], [-20, 14.7]]),
  over2: P3([[20, 16.4], [8, 16.5], [0, 16.6], [-10, 16.4], [-20, 16.2]], -0.6),
  over3: P3([[20, 12.3], [14, 12.3], [8, 12.4], [5, 13], [3, 14.4], [0, 14.4], [-3, 13.4], [-7, 12.8], [-20, 12.6]], -0.9),
  street: P3([[13, 0.9], [10.5, 1.0], [8.5, 0.8], [7, 1.1]], 0.3),
  street2: P3([[-16, 1.2], [-13, 1.0], [-10.5, 1.3], [-8, 1.1]], 0.3),
  into: P3([[16, 12.1], [9, 12.1], [5.2, 12.1], [3.4, 11.9], [2.95, 10.9], [2.95, 8], [2.95, 5], [2.9, 3.6], [2.5, 2.1], [1.2, 1.05], [-0.8, 0.8], [-2.6, 1.0]]),
  out: P3([[-2.6, 1.0], [-3.1, 1.9], [-2.2, 2.9], [-0.6, 3.5], [0.6, 3.7], [1.45, 4.3], [1.45, 7], [1.45, 10], [1.4, 11.4], [0.6, 12.1], [-3, 12.7], [-9, 13.2], [-20, 13.6]]),
  loop: P3([[-3.6, 0.8], [-1.5, 2.0], [1.4, 3.5], [3.4, 3.2], [3.0, 1.6], [0.6, 1.0], [-1.8, 2.2], [-3.3, 3.5], [-3.9, 2.2], [-2.6, 0.9]]),
  loop2: P3([[3.4, 0.9], [1.0, 2.1], [-1.5, 3.5], [-3.6, 3.2], [-3.3, 1.7], [-1.0, 1.1], [1.5, 2.4], [3.0, 3.6], [3.8, 2.1]], -0.8),
  winIn: P3([[-15, 1.3], [-11, 1.4], [-7, 1.45], [-5, 1.45], [-3.2, 1.3], [-1.2, 1.5], [0.8, 2.2]]),
  winIn2: P3([[-14, 2.1], [-10, 2.0], [-6.6, 2.05], [-4.4, 1.9], [-2.6, 2.4], [-0.8, 3.1]], -0.7),
  down: P3([[16, 12.1], [9, 12.1], [5.2, 12.1], [3.4, 11.9], [2.95, 10.9], [2.95, 8], [2.95, 5], [3.0, 3.0], [3.0, 1], [3.0, -1.0], [2.95, -2.2], [2.0, -3.1], [0.2, -3.2], [-1.2, -3.1], [-2.0, -2.5], [-2.7, -1.5], [-3.3, -0.5], [-3.4, 0.6], [-2.5, 1.3], [-1, 1.2], [0.4, 1.5], [1.45, 2.8], [1.45, 4.3], [1.45, 7], [1.45, 10], [1.4, 11.4], [0.6, 12.1], [-3, 12.7], [-9, 13.2], [-20, 13.6]]),
  rise: P3([[0.2, -3.2], [-1.2, -3.1], [-2.0, -2.5], [-2.7, -1.5], [-3.3, -0.5], [-3.4, 0.6], [-2.5, 1.3], [-1, 1.3], [0.4, 1.6], [1.45, 3], [1.45, 4.3], [1.45, 7], [1.45, 10], [1.45, 12.3], [1.5, 13.3], [1.6, 15.5], [1.7, 17.5]]),
  rise2: P3([[1.0, -3.3], [-1.2, -3.0], [-2.0, -2.35], [-2.7, -1.35], [-3.2, -0.3], [-3.2, 0.9], [-2.2, 1.5], [0.4, 1.0], [2.0, 1.4], [2.95, 3], [2.95, 4.3], [2.95, 7], [2.95, 10], [2.95, 12.3], [2.9, 13.3], [2.8, 15.5], [2.7, 17.5]], -0.7),
};

const P_SUNWALL = [0, 1, 2].map((k) => P3([[11, 1.0 + k * 1.1 + 0.3 * k], [8.5, 0.9 + k * 1.1 + 0.2 * k], [6.2, 0.9 + k * 1.1], [3.8, 0.9 + k * 1.1]], 0.2));
const P_CANAL = P3([[20, -3.85], [14, -3.82], [9, -3.84], [5, -3.82]], -0.5);
const P_SUNRAY = [0, 1, 2].map((k) => P3([[-9 - k * 0.4, 19.5 - k * 1.5], [-4, 15.6 - k * 2.2], [TW.x0 - 0.12, 12.6 - k * 2.6]], 0.2));

// ============================================================ generic pieces
/** Axis-aligned textured box from extents (world-scaled UVs), optionally cut at z = zMax. */
const Bx: React.FC<{x: [number, number]; y: [number, number]; z: [number, number]; m: THREE.Material | THREE.Material[]; ts?: number; zMax?: number; cast?: boolean}> = ({x, y, z, m, ts = 2, zMax = 999, cast = true}) => {
  const z1 = Math.min(z[1], zMax);
  const r = (v: number) => Math.round(v * 1000) / 1000;
  const w = r(x[1] - x[0]), h = r(y[1] - y[0]), d = r(z1 - z[0]);
  const ok = w > 0.002 && h > 0.002 && d > 0.002;
  const g = useMemo(() => (ok ? uvBox(w, h, d, ts) : null), [ok, w, h, d, ts]);
  useEffect(() => () => g?.dispose(), [g]);
  if (!g) return null;
  return <mesh geometry={g} position={[(x[0] + x[1]) / 2, (y[0] + y[1]) / 2, (z[0] + z1) / 2]} material={m as never} castShadow={cast} receiveShadow />;
};

/** Ground material with large-scale colour variation. */
const useMacro = (base: THREE.MeshStandardMaterial, key: string, amt = 0.4) =>
  useMemo(() => {
    const mm = base.clone();
    mm.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vGPos;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGPos = (modelMatrix * vec4(position,1.0)).xz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec2 vGPos;
float gh(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float gn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(gh(i),gh(i+vec2(1,0)),f.x), mix(gh(i+vec2(0,1)),gh(i+vec2(1,1)),f.x), f.y); }`)
        .replace('#include <map_fragment>', `#include <map_fragment>
float mv = gn(vGPos / 9.0) * 0.5 + gn(vGPos / 37.0) * 0.5;
diffuseColor.rgb *= mix(1.0, 0.74 + 0.52 * mv, ${amt.toFixed(2)});`);
    };
    mm.customProgramCacheKey = () => 'macro_' + key;
    return mm;
  }, [base, key, amt]);

// ---- animated air ribbon
const flowVS = /* glsl */ `varying vec2 vU; void main(){ vU = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const flowFS = /* glsl */ `
uniform vec3 cA; uniform vec3 cB; uniform vec2 mixAt; uniform float time; uniform float opacity; uniform float reveal; uniform float dashes; uniform float solid;
varying vec2 vU;
void main(){
  float s = vU.x;
  if (s > reveal) discard;
  float d = fract(s * dashes - time);
  float a = mix(0.28, 1.0, smoothstep(0.0, 0.1, d) * (1.0 - smoothstep(0.5, 0.78, d)));
  a = mix(a, 1.0, solid);
  a *= smoothstep(0.0, 0.02, s) * (1.0 - smoothstep(0.97, 1.0, s)) * (1.0 - smoothstep(reveal - 0.03, reveal, s) * step(reveal, 0.995));
  vec3 col = mix(cA, cB, smoothstep(mixAt.x, mixAt.y, s));
  gl_FragColor = vec4(col, a * opacity);
}`;
const useFlowMat = (cA: string, cB: string, mixAt: [number, number], dashes: number, solid: number) =>
  useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: flowVS, fragmentShader: flowFS, transparent: true, depthWrite: false, depthTest: false, toneMapped: false,
        uniforms: {cA: {value: new THREE.Color(cA).convertLinearToSRGB()}, cB: {value: new THREE.Color(cB).convertLinearToSRGB()}, mixAt: {value: new THREE.Vector2(...mixAt)}, time: {value: 0}, opacity: {value: 1}, reveal: {value: 1}, dashes: {value: dashes}, solid: {value: solid}},
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cA, cB, mixAt[0], mixAt[1], dashes, solid],
  );

/** Air stream along a path. `f` = frame; speed in path-lengths per dash cycle. Moving chevrons show the direction. */
const Flow: React.FC<{pts: [number, number, number][]; f: number; a?: string; b?: string; mixAt?: [number, number]; r?: number; opacity?: number; reveal?: number; dashes?: number; speed?: number; heads?: number}> = ({pts, f, a = COOL, b, mixAt = [0.4, 0.6], r = 0.1, opacity = 1, reveal = 1, dashes = 6, speed = 0.03, heads = 5}) => {
  const curve = useMemo(() => new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)), false, 'centripetal'), [pts]);
  const geo = useMemo(() => new THREE.TubeGeometry(curve, Math.max(120, pts.length * 26), r, 8, false), [curve, r, pts.length]);
  const glow = useMemo(() => new THREE.TubeGeometry(curve, Math.max(120, pts.length * 26), r * 2.5, 8, false), [curve, r, pts.length]);
  const m = useFlowMat(a, b ?? a, mixAt, dashes, 0);
  const g = useFlowMat(a, b ?? a, mixAt, dashes, 1);
  const hm = useMemo(() => Array.from({length: heads}, () => new THREE.MeshBasicMaterial({transparent: true, depthWrite: false, depthTest: false, toneMapped: false})), [heads]);
  useEffect(() => () => {geo.dispose(); glow.dispose();}, [geo, glow]);
  if (opacity <= 0.01 || reveal <= 0.005) return null;
  const time = f * speed;
  m.uniforms.time.value = time;
  m.uniforms.opacity.value = opacity * 0.82;
  m.uniforms.reveal.value = reveal;
  g.uniforms.opacity.value = opacity * 0.16;
  g.uniforms.reveal.value = reveal;
  const ca = new THREE.Color(a), cb = new THREE.Color(b ?? a);
  const y = new THREE.Vector3(0, 1, 0);
  return (
    <group>
      <mesh geometry={glow} material={g} renderOrder={18} frustumCulled={false} />
      <mesh geometry={geo} material={m} renderOrder={19} frustumCulled={false} />
      {hm.map((mat, i) => {
        const s = (((i + 0.5) / heads + time / dashes) % 1) ;
        if (s > reveal - 0.01 || s < 0.015 || s > 0.985) return null;
        const p = curve.getPointAt(s);
        const q = new THREE.Quaternion().setFromUnitVectors(y, curve.getTangentAt(s));
        mat.color.copy(ca).lerp(cb, THREE.MathUtils.smoothstep(s, mixAt[0], mixAt[1]));
        mat.opacity = opacity;
        return (
          <mesh key={i} position={p} quaternion={q} material={mat} renderOrder={20}>
            <coneGeometry args={[r * 3.1, r * 6.2, 14]} />
          </mesh>
        );
      })}
    </group>
  );
};

// ============================================================ sky + distant world
const Atmos: React.FC<{f: number; golden?: number; shadow?: number; target?: [number, number, number]; res?: number}> = ({f, golden = 0, shadow = 22, target = [0, 3, -3], res = 2048}) => {
  const d = SUN_DIR.map((v, i) => v + (SUN_GOLD[i] - v) * golden) as [number, number, number];
  const sunCol = new THREE.Color('#ffd2a0').lerp(new THREE.Color('#ffc088'), golden).getStyle();
  const hor = new THREE.Color('#b4d8d2').lerp(new THREE.Color('#e6dcb8'), golden).getStyle();
  return (
    <>
      <Renderer exposure={1.0} envIntensity={0.42} envRotation={1.2} />
      <SkyDome top="#07507a" horizon={hor} bottom="#4a3a34" sunDir={d} sunColor={sunCol} clouds={0.3} time={f / 30} />
      <Sun dir={d} intensity={3.4} color={sunCol} shadowSize={shadow} shadowRes={res} target={target} skyColor="#8fc2d8" groundColor="#7a5a48" hemi={0.72} />
      <fog attach="fog" args={[hor, 90, 520]} />
    </>
  );
};

const mtnH = (x: number, z: number) => {
  const k = THREE.MathUtils.smoothstep(-z, 170, 430);
  const n = Math.sin(x * 0.011 + 1.3) * 0.5 + Math.sin(x * 0.027 + z * 0.013) * 0.3 + Math.sin(x * 0.067 - z * 0.03) * 0.13 + Math.sin(x * 0.17 + z * 0.09) * 0.05;
  return -1 + k * (66 + 44 * n);
};
const Mountains: React.FC = () => <Terrain height={mtnH} size={640} seg={140} center={[0, -380]} tex="sand" texScale={18} tint="#93829a" steep={[0.3, 0.27, 0.36]} matte />;

// ---- town: merged static blocks
type Blk = {x: number; z: number; w: number; d: number; h: number; dome: boolean; tower: boolean; seed: number};
const BLOCKS: Blk[] = (() => {
  const out: Blk[] = [];
  let n = 0;
  for (let ix = -8; ix <= 8; ix++)
    for (let iz = -12; iz <= 3; iz++) {
      n++;
      const x = ix * 15 + (rnd(n) - 0.5) * 3.5;
      const z = iz * 15 + (rnd(n + 50) - 0.5) * 3.5;
      const w = 8.5 + rnd(n + 3) * 3.5, d = 8.5 + rnd(n + 4) * 3.5;
      if (Math.abs(x) < 20 && Math.abs(z) < 18) continue; // around the hero house
      if (Math.abs(z) < d / 2 + 2) continue; // never cross the section plane
      out.push({x, z, w, d, h: 3.4 + rnd(n + 5) * 3.2, dome: rnd(n + 6) > 0.55, tower: rnd(n + 7) > 0.35, seed: n});
    }
  return out;
})();

const blockGeos = (front: boolean) => {
  const body: THREE.BufferGeometry[] = [];
  for (const b of BLOCKS) {
    if (b.z > 0 !== front) continue;
    const g = uvBox(b.w, b.h, b.d, 3);
    g.translate(b.x, b.h / 2, b.z);
    body.push(g);
    // parapet
    const pp = uvBox(b.w + 0.3, 0.3, b.d + 0.3, 3);
    pp.translate(b.x, b.h + 0.15, b.z);
    body.push(pp);
    if (b.dome) {
      const r = Math.min(b.w, b.d) * 0.36;
      const dm = worldUV(new THREE.SphereGeometry(r, 18, 9, 0, Math.PI * 2, 0, Math.PI / 2), 3);
      dm.translate(b.x + (rnd(b.seed) - 0.5) * 1.5, b.h + 0.2, b.z + (rnd(b.seed + 1) - 0.5) * 1.5);
      dm.scale(1, 1, 1);
      body.push(dm);
    }
  }
  return mergeGeometries(body.map((g) => g.index ? g.toNonIndexed() : g));
};
const towerGeos = (front: boolean) => {
  const body: THREE.BufferGeometry[] = [];
  const dark: THREE.BufferGeometry[] = [];
  for (const b of BLOCKS) {
    if (b.z > 0 !== front || !b.tower) continue;
    const s = 1.3 + rnd(b.seed + 9) * 0.8;
    const H = 3.4 + rnd(b.seed + 10) * 3.4;
    const tx = b.x + (rnd(b.seed + 11) - 0.5) * 3, tz = b.z + (rnd(b.seed + 12) - 0.5) * 3;
    const g = uvBox(s, H, s, 2);
    g.translate(tx, b.h + H / 2, tz);
    body.push(g);
    const cap = uvBox(s + 0.3, 0.22, s + 0.3, 2);
    cap.translate(tx, b.h + H + 0.11, tz);
    body.push(cap);
    for (const sgn of [-1, 1]) {
      for (let i = -1; i <= 1; i++) {
        const a = uvBox(0.2, 1.3, 0.03, 1);
        a.translate(tx + i * s * 0.3, b.h + H - 0.75, tz + (sgn * s) / 2 + sgn * 0.016);
        dark.push(a);
        const c = uvBox(0.03, 1.3, 0.2, 1);
        c.translate(tx + (sgn * s) / 2 + sgn * 0.016, b.h + H - 0.75, tz + i * s * 0.3);
        dark.push(c);
      }
    }
  }
  const win: THREE.BufferGeometry[] = [];
  for (const b of BLOCKS) {
    if (b.z > 0 !== front) continue;
    for (const u of [-0.3, 0, 0.3]) {
      if (rnd(b.seed + u * 10 + 20) < 0.3) continue;
      const hh = u === 0 ? 2 : 1.1, yy = u === 0 ? 1 : 2;
      const a = uvBox(0.8, hh, 0.04, 1);
      a.translate(b.x + u * b.w, yy, b.z + b.d / 2 + 0.02);
      win.push(a);
      const c = uvBox(0.04, 1.1, 0.8, 1);
      c.translate(b.x - b.w / 2 - 0.02, 2, b.z + u * b.d);
      win.push(c);
      const e = uvBox(0.04, 1.1, 0.8, 1);
      e.translate(b.x + b.w / 2 + 0.02, 2, b.z + u * b.d);
      win.push(e);
    }
  }
  return {body: mergeGeometries(body), dark: mergeGeometries(dark), win: mergeGeometries(win)};
};

const Town: React.FC<{cut: boolean; towers: boolean}> = ({cut, towers}) => {
  const m = useMat('mud_plaster', {tint: '#e6c6a4'});
  const back = useMemo(() => blockGeos(false), []);
  const front = useMemo(() => blockGeos(true), []);
  const tb = useMemo(() => towerGeos(false), []);
  const tf = useMemo(() => towerGeos(true), []);
  const dark = usePlainMat('#2a1d18', 0.9);
  return (
    <group>
      <mesh geometry={back} material={m} castShadow receiveShadow />
      {!cut && <mesh geometry={front} material={m} castShadow receiveShadow />}
      {towers && (
        <>
          <mesh geometry={tb.body} material={m} castShadow receiveShadow />
          <mesh geometry={tb.dark} material={dark} />
          {!cut && <mesh geometry={tf.body} material={m} castShadow receiveShadow />}
          {!cut && <mesh geometry={tf.dark} material={dark} />}
        </>
      )}
      <mesh geometry={tb.win} material={dark} />
      {!cut && <mesh geometry={tf.win} material={dark} />}
    </group>
  );
};

/** The 33 m giant: octagonal tower on a garden pavilion. */
const GiantTower: React.FC<{position: [number, number, number]}> = ({position}) => {
  const m = useMat('mud_plaster', {tint: '#ecd0ac'});
  const dark = usePlainMat('#2a1d18', 0.9);
  const base = useMemo(() => uvBox(17, 8, 15, 3), []);
  const shaft = useMemo(() => worldUV(new THREE.CylinderGeometry(2.9, 3.3, 29, 8), 3), []);
  const cap = useMemo(() => worldUV(new THREE.CylinderGeometry(3.3, 3.3, 0.5, 8), 3), []);
  const H0 = 8;
  return (
    <group position={position}>
      <mesh geometry={base} position={[0, 4, 0]} material={m} castShadow receiveShadow />
      <mesh geometry={shaft} position={[0, H0 + 14.5, 0]} material={m} castShadow receiveShadow />
      <mesh geometry={cap} position={[0, H0 + 29.2, 0]} material={m} castShadow />
      {Array.from({length: 8}, (_, i) => {
        const a = ((i + 0.5) / 8) * Math.PI * 2;
        return (
          <group key={i} rotation={[0, a + Math.PI / 8 - Math.PI / 8, 0]}>
            {[-0.8, 0, 0.8].map((u) => (
              <mesh key={u} position={[u, H0 + 25, 2.82]} rotation={[0.03, 0, 0]} material={dark}>
                <boxGeometry args={[0.36, 6, 0.1]} />
              </mesh>
            ))}
          </group>
        );
      })}
    </group>
  );
};

// ============================================================ the house
type Build = {
  th: number; // thick walls 0..1 (rising)
  tower: number; // 0..1
  part: number; // internal walls 0..1 (grow outward from the centre)
  cap: number; // 0 none, 0..1 dropping, 1 seated
  cellar: boolean;
  water: number; // 0..1 pool level
  heat: number; // 1 hot .. 0 cool
  zMax: number;
  people?: boolean;
  glow?: number; // sun-heated tower
};
const B0: Build = {th: 0, tower: 0, part: 0, cap: 0, cellar: false, water: 0, heat: 1, zMax: 0, people: true};
const FULL: Build = {th: 1, tower: 1, part: 1, cap: 1, cellar: true, water: 1, heat: 0.2, zMax: 0, people: true};

const useHouseMats = () => {
  const mud = useMat('mud_plaster', {tint: '#f0d4b4'});
  const brick = useMat('mud_brick', {tint: '#f2d8bc'});
  const inner = useMat('plaster_white', {tint: '#efe2cc'});
  return {mud, brick, inner};
};

/** x-range wall with outer mud render, inner plaster, brick on the cut. */
const STONES: [number, number, number][] = [
  [-7.2, -2.2, 0.42], [-8.6, -6, 0.6], [-4, -7.4, 0.36], [1, -6.2, 0.5], [5.6, -6.6, 0.44], [7.2, -1.7, 0.36], [9.2, -5.4, 0.55], [-11, -3.6, 0.5],
  [3, -8.6, 0.6], [-2, -9.8, 0.42], [7.6, -9.6, 0.5], [-6.6, -10.6, 0.55], [11.4, -8.2, 0.45], [0.4, -11.6, 0.6], [-12, -8.4, 0.4], [12, -2.4, 0.4],
];
const Earth: React.FC<{cut: boolean; cellar: boolean; zMax: number}> = (p) => (
  <>
    <EarthBody {...p} />
    {p.cut && STONES.map((r, i) => <Rock key={i} position={[r[0], r[1], 0]} scale={[r[2], r[2] * 0.72, r[2] * 0.5]} seed={i + 140} tex="stone_face_sand" />)}
  </>
);
const EarthBody: React.FC<{cut: boolean; cellar: boolean; zMax: number}> = ({cut, cellar, zMax}) => {
  const topBase = useMat('cracked_earth', {tint: '#e6bb94'});
  const top = useMacro(topBase, 'earthtop', 0.5);
  const side = useMat('dirt', {tint: '#a07a64'});
  const cutM = useMat('dirt', {tint: '#a07a64'});
  const mats = useMemo(() => [side, side, top, side, cutM, side], [side, top, cutM]);
  if (!cellar) return (
    <>
      <Bx x={[-B, B]} y={[DEEP, 0]} z={[-B, B]} zMax={zMax} m={mats} ts={5} cast={false} />
      {cut && <Bx x={[-B, B]} y={[DEEP - 1, DEEP]} z={[-B, B]} m={cutM} ts={6} cast={false} />}
    </>
  );
  const Z = zMax;
  return (
    <>
      <Bx x={[-B, B]} y={[DEEP, 0]} z={[-B, CL.z0]} m={mats} ts={5} cast={false} />
      <Bx x={[-B, CL.x0]} y={[DEEP, 0]} z={[CL.z0, Z]} m={mats} ts={5} cast={false} />
      <Bx x={[CL.x1, B]} y={[-3.1, 0]} z={[CL.z0, Z]} m={mats} ts={5} cast={false} />
      <Bx x={[CL.x1, B]} y={[DEEP, CL.poolY]} z={[CL.z0, Z]} m={mats} ts={5} cast={false} />
      <Bx x={[CL.x1, B]} y={[CL.poolY, -3.1]} z={[CL.z0, -1.1]} m={mats} ts={5} cast={false} />
      <Bx x={[CL.x0, CL.x1]} y={[DEEP, CL.poolY]} z={[CL.z0, Z]} m={mats} ts={5} cast={false} />
      <Bx x={[-B, B]} y={[DEEP - 1, DEEP]} z={[-B, B]} m={cutM} ts={6} cast={false} />
      {/* floor slab of the room (over the cellar), with the grate gap and the stair opening */}
      <Bx x={[CL.slabX, GRATE.x0]} y={[CL.y1, 0]} z={[CL.z0, Z]} m={mats} ts={5} cast={false} />
      <Bx x={[GRATE.x1, CL.x1]} y={[CL.y1, 0]} z={[CL.z0, Z]} m={mats} ts={5} cast={false} />
    </>
  );
};

const Cellar: React.FC<{b: Build; f: number}> = ({b, f}) => {
  const Z = b.zMax;
  const wall = useMat('plaster_white', {tint: '#b9d0d0'});
  const tile = useMat('kashi_tile', {roughness: 0.6, envMapIntensity: 1.2});
  const stair = useMat('stone_face_sand', {tint: '#c4a488'});
  const stairCut = useMat('dirt', {tint: '#a07a64'});
  const stairM = useMemo(() => [stair, stair, stair, stair, stairCut, stair], [stair, stairCut]);
  const wood = useMat('wood_oak', {tint: '#9a7650'});
  const waterCut = usePlainMat('#1590a8', 0.15, 0, {transparent: true, opacity: 0.72, emissive: new THREE.Color('#0c6a80'), emissiveIntensity: 0.5});
  const STEPS = 12;
  const lvl = lerp(CL.poolY + 0.02, CL.wat, b.water);
  return (
    <group>
      {/* back wall plaster with a tile dado, pool lining */}
      <Bx x={[CL.x0, CL.x1]} y={[CL.y0, CL.y1 - 0.02]} z={[CL.z0, CL.z0 + 0.03]} m={wall} ts={3} cast={false} />
      <Bx x={[CL.pool, CL.x1]} y={[CL.y0, CL.y0 + 0.9]} z={[CL.z0 + 0.03, CL.z0 + 0.05]} m={tile} ts={1.6} cast={false} />
      <Bx x={[CL.pool, CL.x1]} y={[CL.poolY, CL.poolY + 0.04]} z={[CL.z0, Z]} m={tile} ts={1.6} cast={false} />
      <Bx x={[CL.pool, CL.x1]} y={[CL.poolY, CL.y0]} z={[CL.z0, CL.z0 + 0.04]} m={tile} ts={1.6} cast={false} />
      <Bx x={[CL.x1, 200]} y={[CL.poolY, -3.1]} z={[-1.1, -1.08]} m={wall} ts={3} cast={false} />
      {/* stairs: solid steps rising to the left */}
      {Array.from({length: STEPS}, (_, i) => {
        const top = CL.y0 + (i + 1) * (Math.abs(CL.y0) / STEPS);
        const xr = CL.stairX - ((i + 1) * (CL.stairX - CL.x0)) / (STEPS + 0.5);
        return <Bx key={i} x={[CL.x0, xr]} y={[top - Math.abs(CL.y0) / STEPS, top]} z={[CL.z0, Z]} m={stairM} ts={2} cast={false} />;
      })}
      <Bx x={[CL.x0, CL.pool]} y={[CL.poolY, CL.y0]} z={[CL.z0, Z]} m={stairM} ts={2} cast={false} />
      {/* wooden grate above the shaft */}
      {[GRATE.x0, (GRATE.x0 + GRATE.x1) / 2, GRATE.x1].map((x) => <Bx key={x} x={[x - 0.05, x + 0.05]} y={[-0.14, 0.02]} z={[CL.z0, Z]} m={wood} ts={1} />)}
      {[-4.4, -3.5, -2.6, -1.7, -0.8].map((z) => <Bx key={z} x={[GRATE.x0, GRATE.x1]} y={[-0.08, 0.02]} z={[z - 0.04, z + 0.04]} m={wood} ts={1} />)}
      {/* water */}
      <Water w={CL.x1 - CL.pool + 16} d={5} position={[(CL.pool + CL.x1 + 16) / 2, lvl, -2.5]} time={f / 30} color="#2fb8c8" texScale={3} />
      <Bx x={[CL.pool, CL.x1 + 16]} y={[CL.poolY + 0.03, lvl]} z={[-0.02, 0]} m={waterCut} ts={2} cast={false} />
      <pointLight position={[0.8, -2.3, -2.2]} intensity={16} distance={11} decay={1.5} color="#8fe6f2" />
    </group>
  );
};

/** Pointed arch niche on the back wall. */
const useArchGeo = (w: number, h: number) =>
  useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(-w / 2, 0);
    s.lineTo(-w / 2, h * 0.62);
    s.quadraticCurveTo(-w / 2, h * 0.86, 0, h);
    s.quadraticCurveTo(w / 2, h * 0.86, w / 2, h * 0.62);
    s.lineTo(w / 2, 0);
    s.closePath();
    return worldUV(new THREE.ExtrudeGeometry(s, {depth: 0.03, bevelEnabled: false}), 1.6);
  }, [w, h]);

const Interior: React.FC<{b: Build; f: number}> = ({b, f}) => {
  const rug = useMat('persian_rug');
  const tile = useMat('kashi_tile', {roughness: 0.5});
  const floor = useMat('stone_face_sand', {tint: '#c8ae90'});
  const nicheM = useMat('plaster_ochre', {tint: '#a8805e'});
  const frame = useMat('plaster_white', {tint: '#fff2dc'});
  const cushion = usePlainMat('#2f6d78', 0.9);
  const cushion2 = usePlainMat('#b5482e', 0.9);
  const brass = usePlainMat('#c8a14a', 0.35, 0.8);
  const big = useArchGeo(1.75, 2.95);
  const inner = useArchGeo(1.45, 2.7);
  const zb = R.z0 + 0.01;
  const flX1 = R.x1;
  const flX0 = b.cellar ? CL.slabX : R.x0;
  const hairT = f * 0.22;
  const hotPose = b.heat > 0.62;
  return (
    <group>
      <Bx x={[flX0, b.cellar ? GRATE.x0 : flX1]} y={[-0.08, 0.02]} z={[R.z0, b.zMax]} m={floor} ts={2.4} cast={false} />
      {b.cellar && <Bx x={[GRATE.x1, flX1]} y={[-0.08, 0.02]} z={[R.z0, b.zMax]} m={floor} ts={2.4} cast={false} />}
      <Bx x={[-1.7, 2.15]} y={[0.02, 0.05]} z={[-4.9, Math.min(-0.7, b.zMax)]} m={rug} ts={1.9} cast={false} />
      {/* tile dado and arched niches on the back wall */}
      <Bx x={[R.x0, R.x1]} y={[0, 0.72]} z={[zb, zb + 0.03]} m={tile} ts={1.5} cast={false} />
      {[-3.2, -1.0, 1.2, 3.4].map((x) => (
        <group key={x} position={[x, 0.8, zb + 0.03]}>
          <mesh geometry={big} material={frame} />
          <mesh geometry={inner} position={[0, 0, 0.012]} material={nicheM} />
        </group>
      ))}
      {[-1.5, -0.4, 0.7, 1.7].map((x, i) => (
        <mesh key={x} position={[x, 0.22, -4.55]} scale={[0.5, 0.3, 0.3]} material={i % 2 ? cushion : cushion2} castShadow>
          <sphereGeometry args={[0.8, 14, 10]} />
        </mesh>
      ))}
      <mesh position={[0.1, 0.1, -2.6]} material={brass} castShadow receiveShadow>
        <cylinderGeometry args={[0.46, 0.42, 0.05, 28]} />
      </mesh>
      <mesh position={[0.1, 0.22, -2.6]} material={brass} castShadow>
        <cylinderGeometry args={[0.07, 0.11, 0.2, 14]} />
      </mesh>
      {b.people && (
        <>
          <Person position={[-1.1, 0.05, -2.5]} rotY={-0.15} pose={hotPose ? 'chisel' : 'stand'} tool="none" t={hairT * 0.8} legs="sit" seed={201} outfit="#ece6d6" pants="#b8ae98" head="cloth" headColor="#e6dcc4" />
          <Person position={[1.3, 0.05, -2.2]} rotY={Math.PI + 0.2} pose={hotPose ? 'chisel' : 'stand'} tool="none" t={hairT * 0.9 + 1.5} legs="sit" seed={206} outfit="#2d6a78" pants="#1e3f52" head="cloth" headColor="#1b2f4a" />
        </>
      )}
    </group>
  );
};

/** Street door + small windows on the front face (only seen in uncut shots). */
const FrontFace: React.FC<{b: Build}> = ({b}) => {
  const wood = useMat('wood_oak', {tint: '#8a6444'});
  const dark = usePlainMat('#22170f', 0.9);
  const frame = useMat('plaster_white', {tint: '#f2e4cc'});
  const z = R.z1 + (b.th > 0.5 ? T : THIN) + 0.02;
  if (b.zMax < z + 0.1) return null;
  return (
    <group position={[0, 0, z]}>
      <mesh position={[1.6, 1.15, 0]} material={frame}><boxGeometry args={[1.7, 2.5, 0.05]} /></mesh>
      <mesh position={[1.6, 1.08, 0.03]} material={wood}><boxGeometry args={[1.34, 2.15, 0.05]} /></mesh>
      <mesh position={[1.6, 1.08, 0.06]} material={dark}><boxGeometry args={[0.04, 2.15, 0.02]} /></mesh>
      {[-3.2, -1.2, 3.8].map((x) => (
        <group key={x} position={[x, 2.6, 0]}>
          <mesh material={frame}><boxGeometry args={[1.1, 1.3, 0.05]} /></mesh>
          <mesh position={[0, 0, 0.03]} material={dark}><boxGeometry args={[0.84, 1.04, 0.03]} /></mesh>
          {[-0.2, 0.2].map((u) => <mesh key={u} position={[u, 0, 0.05]} material={wood}><boxGeometry args={[0.05, 1.04, 0.03]} /></mesh>)}
          <mesh position={[0, 0, 0.05]} material={wood}><boxGeometry args={[0.84, 0.05, 0.03]} /></mesh>
        </group>
      ))}
    </group>
  );
};

/** Shutters of the opening in the left wall. */
const Shutters: React.FC<{zMax: number}> = ({zMax}) => (
  <group>
    <Plank size={[0.95, 2.4, 0.06]} position={[R.x0 - T - 0.45, 1.2, -WIN.z - 0.02]} tex="wood_oak" />
    {zMax > WIN.z && <Plank size={[0.95, 2.4, 0.06]} position={[R.x0 - T - 0.45, 1.2, WIN.z + 0.02]} tex="wood_oak" />}
  </group>
);

const House: React.FC<{b: Build}> = ({b}) => {
  const {mud, brick, inner} = useHouseMats();
  const Z = b.zMax;
  const face = Z >= R.z1 + T + 0.01 ? mud : brick;
  const rightM = useMemo(() => [mud, inner, mud, mud, face, inner], [mud, inner, face]); // outer +x
  const leftM = useMemo(() => [inner, mud, mud, mud, face, inner], [mud, inner, face]);
  const backM = useMemo(() => [mud, mud, mud, mud, inner, mud], [mud, inner]);
  const frontM = useMemo(() => [mud, mud, mud, inner, mud, inner], [mud, inner]);
  const roofM = useMemo(() => [mud, mud, mud, inner, face, mud], [mud, inner, face]);
  const lv = R.h * b.th; // top of the rising thick shell
  const xL = R.x0 - THIN, xR = R.x1 + THIN;
  const wood = useMat('wood_pine', {tint: '#a88a64'});
  const hole = b.tower >= 0.999;
  const rx0 = R.x0 - T, rx1 = R.x1 + T, rz0 = R.z0 - T, rz1 = R.z1 + T;
  const tRoof = ROOFT * (0.36 + 0.64 * b.th);
  const rb = R.h, rt = R.h + tRoof;
  const hasThick = b.th > 0.001;
  const X = TW.x0 + 0.26, X1 = TW.x1 - 0.26, Z0 = -1.24, Z1 = 1.24;
  return (
    <group>
      {/* thin inner skin (the original room) */}
      <Bx x={[R.x1, xR]} y={[0, R.h]} z={[R.z0 - THIN, R.z1 + THIN]} zMax={Z} m={rightM} ts={2.4} />
      <Bx x={[xL, R.x0]} y={[WIN.y1, R.h]} z={[-WIN.z, WIN.z]} zMax={Z} m={leftM} ts={2.4} />
      <Bx x={[xL, R.x0]} y={[0, R.h]} z={[R.z0 - THIN, -WIN.z]} zMax={Z} m={leftM} ts={2.4} />
      <Bx x={[xL, R.x0]} y={[0, R.h]} z={[WIN.z, R.z1 + THIN]} zMax={Z} m={leftM} ts={2.4} />
      <Bx x={[R.x0, R.x1]} y={[0, R.h]} z={[R.z0 - THIN, R.z0]} zMax={Z} m={backM} ts={2.4} />
      <Bx x={[R.x0, R.x1]} y={[0, R.h]} z={[R.z1, R.z1 + THIN]} zMax={Z} m={frontM} ts={2.4} />
      {/* thick mud-brick shell rising around it */}
      {hasThick && (
        <>
          <Bx x={[xR, rx1]} y={[0, lv]} z={[rz0, rz1]} zMax={Z} m={rightM} ts={2.4} />
          <Bx x={[rx0, xL]} y={[Math.min(lv, WIN.y1), lv]} z={[-WIN.z, WIN.z]} zMax={Z} m={leftM} ts={2.4} />
          <Bx x={[rx0, xL]} y={[0, lv]} z={[rz0, -WIN.z]} zMax={Z} m={leftM} ts={2.4} />
          <Bx x={[rx0, xL]} y={[0, lv]} z={[WIN.z, rz1]} zMax={Z} m={leftM} ts={2.4} />
          <Bx x={[xL, xR]} y={[0, lv]} z={[rz0, R.z0 - THIN]} zMax={Z} m={backM} ts={2.4} />
          <Bx x={[xL, xR]} y={[0, lv]} z={[R.z1 + THIN, rz1]} zMax={Z} m={frontM} ts={2.4} />
        </>
      )}
      {/* roof slab, with the tower opening once it is built */}
      {!hole ? (
        <Bx x={[hasThick ? rx0 : xL, hasThick ? rx1 : xR]} y={[rb, rt]} z={[hasThick ? rz0 : R.z0 - THIN, hasThick ? rz1 : R.z1 + THIN]} zMax={Z} m={roofM} ts={2.4} />
      ) : (
        <>
          <Bx x={[rx0, X]} y={[rb, rt]} z={[rz0, rz1]} zMax={Z} m={roofM} ts={2.4} />
          <Bx x={[X1, rx1]} y={[rb, rt]} z={[rz0, rz1]} zMax={Z} m={roofM} ts={2.4} />
          <Bx x={[X, X1]} y={[rb, rt]} z={[rz0, Z0]} zMax={Z} m={roofM} ts={2.4} />
          <Bx x={[X, X1]} y={[rb, rt]} z={[Z1, rz1]} zMax={Z} m={roofM} ts={2.4} />
        </>
      )}
      {/* ceiling joists */}
      {Array.from({length: 8}, (_, i) => -5.2 + i * 1.5).filter((z) => z < Z - 0.1).map((z) => (
        <Bx key={z} x={[R.x0, X - 0.02]} y={[R.h - 0.16, R.h]} z={[z - 0.07, z + 0.07]} m={wood} ts={1.2} />
      ))}
      {/* parapet */}
      {b.th > 0.98 && (
        <>
          <Bx x={[rx0, rx1]} y={[rt, rt + 0.42]} z={[rz0, rz0 + 0.3]} zMax={Z} m={roofM} ts={2.4} />
          <Bx x={[rx0, rx0 + 0.3]} y={[rt, rt + 0.42]} z={[rz0, rz1]} zMax={Z} m={roofM} ts={2.4} />
          <Bx x={[rx1 - 0.3, rx1]} y={[rt, rt + 0.42]} z={[rz0, rz1]} zMax={Z} m={roofM} ts={2.4} />
          <Bx x={[rx0, rx1]} y={[rt, rt + 0.42]} z={[rz1 - 0.3, rz1]} zMax={Z} m={roofM} ts={2.4} />
        </>
      )}
    </group>
  );
};

const Diag: React.FC<{a: number; level: number; len: number; m: THREE.Material}> = ({a, level, len, m}) => {
  const y0 = RT - 0.5, H = level - y0;
  const L = 1.74 * len;
  const g = useMemo(() => uvBox(1.74, 1, 0.13, 1.4), []);
  if (H <= 0.02 || len <= 0.01) return null;
  return (
    <group position={[TX, y0 + H / 2, 0]} rotation={[0, a, 0]}>
      <mesh geometry={g} position={[L / 2, 0, 0]} scale={[len, H, 1]} material={m} castShadow receiveShadow />
    </group>
  );
};

const Tower: React.FC<{b: Build}> = ({b}) => {
  const {mud, brick, inner} = useHouseMats();
  const Z = b.zMax;
  const level = RT + (TW.top - RT) * b.tower;
  const lo = Math.min(level, TW.vent);
  const face = Z < 1.4 ? brick : mud;
  const xM = useMemo(() => [mud, mud, mud, mud, face, inner], [mud, face, inner]);
  const zM = useMemo(() => [mud, mud, mud, mud, mud, mud], [mud]);
  const shaftM = useMat('plaster_white', {tint: '#7d6a5e'});
  const heatM = useMemo(() => new THREE.MeshBasicMaterial({color: '#ff6a1a', transparent: true, depthWrite: false, toneMapped: false}), []);
  const fins = [-1.25, -0.625, 0, 0.625, 1.25];
  if (b.tower <= 0) return null;
  const hi = level > TW.vent ? level : 0;
  return (
    <group>
      <Bx x={[TW.x0, TW.x0 + TW.t]} y={[RT, lo]} z={[TW.z0, TW.z1]} zMax={Z} m={xM} ts={2.2} />
      <Bx x={[TW.x1 - TW.t, TW.x1]} y={[RT, lo]} z={[TW.z0, TW.z1]} zMax={Z} m={xM} ts={2.2} />
      <Bx x={[TW.x0 + TW.t, TW.x1 - TW.t]} y={[RT, lo]} z={[TW.z0, TW.z0 + TW.t]} zMax={Z} m={zM} ts={2.2} />
      {Z > 1 && <Bx x={[TW.x0 + TW.t, TW.x1 - TW.t]} y={[RT, lo]} z={[TW.z1 - TW.t, TW.z1]} m={zM} ts={2.2} />}
      {/* vent fins on all four sides */}
      {hi > 0 &&
        fins.map((u) => (
          <group key={u}>
            {/* -x and +x sides: skip the fin on the section plane so the opening reads */}
            {u !== 0 && <Bx x={[TW.x0, TW.x0 + TW.t]} y={[TW.vent, hi]} z={[u - 0.1, u + 0.1]} zMax={Z} m={xM} ts={2.2} />}
            {u !== 0 && <Bx x={[TW.x1 - TW.t, TW.x1]} y={[TW.vent, hi]} z={[u - 0.1, u + 0.1]} zMax={Z} m={xM} ts={2.2} />}
            <Bx x={[TX + u - 0.1, TX + u + 0.1]} y={[TW.vent, hi]} z={[TW.z0, TW.z0 + TW.t]} zMax={Z} m={zM} ts={2.2} />
            {Z > 1 && <Bx x={[TX + u - 0.1, TX + u + 0.1]} y={[TW.vent, hi]} z={[TW.z1 - TW.t, TW.z1]} m={zM} ts={2.2} />}
          </group>
        ))}
      {/* ring beam */}
      {level >= TW.top - 0.01 && (
        <>
          <Bx x={[TW.x0 - 0.1, TW.x1 + 0.1]} y={[TW.top, TW.top + 0.16]} z={[TW.z0 - 0.1, TW.z0 + 0.3]} zMax={Z} m={xM} ts={2.2} />
          {Z > 1 && <Bx x={[TW.x0 - 0.1, TW.x1 + 0.1]} y={[TW.top, TW.top + 0.16]} z={[TW.z1 - 0.3, TW.z1 + 0.1]} m={xM} ts={2.2} />}
          <Bx x={[TW.x0 - 0.1, TW.x0 + 0.3]} y={[TW.top, TW.top + 0.16]} z={[TW.z0 - 0.1, TW.z1 + 0.1]} zMax={Z} m={xM} ts={2.2} />
          <Bx x={[TW.x1 - 0.3, TW.x1 + 0.1]} y={[TW.top, TW.top + 0.16]} z={[TW.z0 - 0.1, TW.z1 + 0.1]} zMax={Z} m={xM} ts={2.2} />
        </>
      )}
      {/* projecting timbers */}
      {[6.3, 8.1, 9.9].filter((y) => y < level).map((y) => (
        <React.Fragment key={y}>
          <Beam a={[TW.x0 - 0.42, y, -1.0]} b={[TW.x1 + 0.42, y, -1.0]} r={0.05} />
          {Z > 1 && <Beam a={[TW.x0 - 0.42, y, 1.0]} b={[TW.x1 + 0.42, y, 1.0]} r={0.05} />}
          <Beam a={[TW.x0 - 0.42, y + 0.5, -1.0]} b={[TW.x0 + 0.2, y + 0.5, -1.0]} r={0.05} />
        </React.Fragment>
      ))}
      {/* internal walls: four radial walls from the centre to the corners */}
      {b.part > 0 && (
        <>
          {(Z > 1 ? [Math.PI / 4, (3 * Math.PI) / 4, -Math.PI / 4, (-3 * Math.PI) / 4] : [Math.PI / 4, (3 * Math.PI) / 4]).map((a) => (
            <Diag key={a} a={-a} level={level} len={b.part} m={Z > 1 ? inner : shaftM} />
          ))}
        </>
      )}
      {b.part > 0.99 && Z < 1 && <Bx x={[TX - 0.1, TX + 0.1]} y={[RT - 0.5, level]} z={[-0.1, Z]} m={brick} ts={2.2} />}
      {/* cap */}
      {b.cap > 0 && (
        <group position={[0, (1 - b.cap) * 15, 0]}>
          <Bx x={[TW.x0 - 0.28, TW.x1 + 0.28]} y={[TW.top + 0.16, TW.top + 0.38]} z={[TW.z0 - 0.28, TW.z1 + 0.28]} zMax={Z} m={xM} ts={2.2} />
          <Bx x={[TW.x0 + 0.1, TW.x1 - 0.1]} y={[TW.top + 0.38, TW.top + 0.62]} z={[TW.z0 + 0.1, TW.z1 - 0.1]} zMax={Z} m={xM} ts={2.2} />
        </group>
      )}
      {/* sun-heated shaft */}
      {(b.glow ?? 0) > 0.01 && (
        <mesh position={[TX, (RT + TW.top) / 2, -0.75]} material={Object.assign(heatM, {opacity: (b.glow ?? 0) * 0.3})} renderOrder={15}>
          <boxGeometry args={[TW.x1 - TW.x0 - 0.6, TW.top - RT, 1.4]} />
        </mesh>
      )}
    </group>
  );
};

/** Coloured air inside the room + light that follows the temperature. */
const RoomAir: React.FC<{heat: number; h?: number}> = ({heat}) => {
  const m = useMemo(() => new THREE.MeshBasicMaterial({transparent: true, depthWrite: false, toneMapped: false}), []);
  const c = new THREE.Color('#2fb4e6').lerp(new THREE.Color('#ff4a1f'), heat);
  m.color.copy(c);
  m.opacity = 0.08 + 0.12 * Math.abs(heat - 0.5) * 2;
  return (
    <>
      <mesh position={[0, R.h / 2, -0.03]} material={m} renderOrder={12}>
        <planeGeometry args={[R.x1 - R.x0, R.h]} />
      </mesh>
      <pointLight position={[0, 3.2, -1.2]} intensity={14} distance={12} decay={1.4} color={c.getStyle()} />
    </>
  );
};

const Courtyard: React.FC<{f: number}> = ({f}) => {
  const tile = useMat('kashi_tile', {roughness: 0.5});
  const wall = useMat('mud_plaster', {tint: '#e8c8a8'});
  return (
    <group>
      <Bx x={[-15, -8]} y={[0, 0.36]} z={[-5.2, -1.6]} m={tile} ts={1.5} />
      <Water w={6.5} d={3.2} position={[-11.5, 0.33, -3.4]} time={f / 30} color="#39b8c4" texScale={3} />
      <PalmTree position={[-13.8, 0, -7.4]} scale={1.05} seed={3} />
      <Bx x={[-24, R.x0 - T]} y={[0, 3.2]} z={[-7.9, -7.2]} m={wall} ts={3} />
    </group>
  );
};

// ============================================================ stage + UI
const Stage: React.FC<{cam: Cam; children: React.ReactNode}> = ({cam, children}) => {
  const {width, height} = useVideoConfig();
  return (
    <AbsoluteFill style={{background: '#0e0b08'}}>
      <ThreeCanvas width={width} height={height} shadows camera={{fov: cam.fov, near: 0.1, far: 3000}}>
        <AssetProvider textures={TEXTURES} hdri="venice_sunset_1k">
          <CameraRig pos={cam.pos} target={cam.target} fov={cam.fov} />
          {children}
        </AssetProvider>
      </ThreeCanvas>
      <Grade strength={0.34} />
    </AbsoluteFill>
  );
};

const Pin: React.FC<{p: [number, number, number]; cam: Cam; text: string; delay: number; dx?: number; dy?: number; size?: number; anchor?: 'left' | 'right' | 'center'; red?: boolean; cool?: boolean}> = ({p, cam, text, delay, dx = 0, dy = 0, size = 46, anchor = 'center', red, cool}) => {
  const [x, y, vis] = toScreen(p, cam);
  if (!vis) return null;
  const w = text.length * size * 0.56 + size * 0.9;
  let lx = x + dx;
  const left = anchor === 'left' ? lx : anchor === 'right' ? lx - w : lx - w / 2;
  if (left < 150) lx += 150 - left;
  if (left + w > 1044) lx -= left + w - 1044;
  return <Tag text={text} x={lx} y={Math.min(1480, Math.max(470, y + dy))} delay={delay} size={size} anchor={anchor} bg={red ? C.red : cool ? '#27d8ff' : C.yellow} fg={red ? C.white : C.ink} />;
};

/** Thermometer: `v` 1 hot .. 0 cool. */
const Thermo: React.FC<{v: number; o?: number}> = ({v, o = 1}) => {
  const col = new THREE.Color('#27c8ff').lerp(new THREE.Color('#ff3b1f'), v).getStyle();
  const H = 300;
  return (
    <div style={{position: 'absolute', left: 46, top: 500, width: 84, height: H + 92, opacity: o}}>
      <div style={{position: 'absolute', left: 21, top: 0, width: 42, height: H + 30, background: '#f6f1e6', border: `6px solid ${C.ink}`, borderRadius: 26, boxShadow: `0 6px 0 ${C.ink}`}} />
      <div style={{position: 'absolute', left: 33, bottom: 40, width: 18, height: 40 + (H - 60) * v, background: col, borderRadius: 9}} />
      <div style={{position: 'absolute', left: 6, bottom: 0, width: 72, height: 72, background: col, border: `6px solid ${C.ink}`, borderRadius: '50%', boxSizing: 'border-box'}} />
    </div>
  );
};

const Worker: React.FC<{position: [number, number, number]; rotY: number; pose: 'hammer' | 'chisel' | 'point' | 'stand' | 'carry' | 'pull' | 'walk' | 'haul'; seed: number; t?: number; legs?: 'walk' | 'still' | 'kneel'; tool?: 'hammer' | 'stone' | 'none'}> = (p) => (
  <Person {...p} outfit={['#c9a878', '#8f6d4a', '#b86a42', '#7c8b9c'][p.seed % 4]} pants="#5a4a3a" head="cloth" headColor="#efe6d2" />
);

/** Brick stack carried on the head. */
const HeadLoad: React.FC<{p: [number, number, number]}> = ({p}) => {
  const m = useMat('mud_brick', {tint: '#f2d8bc'});
  const g = useMemo(() => uvBox(0.5, 0.2, 0.3, 0.6), []);
  return <mesh geometry={g} position={[p[0], p[1] + 2.02, p[2]]} material={m} castShadow />;
};

/** Sun-dried bricks laid out in rows on the ground. */
const BrickRows: React.FC = () => {
  const m = useMat('mud_brick', {tint: '#e8c8a8'});
  const geo = useMemo(() => {
    const parts: THREE.BufferGeometry[] = [];
    for (let ix = 0; ix < 12; ix++)
      for (let iz = 0; iz < 9; iz++) {
        const g = uvBox(0.5, 0.16, 0.26, 0.8);
        g.translate(7.6 + ix * 0.62 + (rnd(ix * 13 + iz) - 0.5) * 0.08, 0.08, -9.4 + iz * 0.4);
        parts.push(g);
      }
    for (let l = 0; l < 6; l++)
      for (let k = 0; k < 4; k++) {
        const g = uvBox(0.5, 0.16, 0.26, 0.8);
        g.translate(7.15 + k * 0.54 + (l % 2) * 0.1, 0.09 + l * 0.17, -3.6);
        parts.push(g);
      }
    return mergeGeometries(parts);
  }, []);
  return <mesh geometry={geo} material={m} castShadow receiveShadow />;
};

const World: React.FC<{cut?: boolean; towers?: boolean; b: Build; f: number; courtyard?: boolean}> = ({cut = true, towers = false, b, f, courtyard = true}) => (
  <>
    <Mountains />
    <Earth cut={cut} cellar={b.cellar} zMax={b.zMax} />
    <Town cut={cut} towers={towers} />
    {courtyard && <Courtyard f={f} />}
    <House b={b} />
    <Tower b={b} />
    <Interior b={b} f={f} />
    <Shutters zMax={b.zMax} />
    <FrontFace b={b} />
    {b.cellar && <Cellar b={b} f={f} />}
  </>
);

const HEAT = [1, 0.84, 0.72, 0.62, 0.5, 0.26, 0.26, 0.14];

// ============================================================ S1 hook: a hot room
const S1: React.FC = () => {
  const f = useCurrentFrame();
  const L = LEN[0];
  const openAt = wordAt(0, 'Open');
  const soAt = wordAt(0, 'So how');
  const wipe = ramp(f, openAt - 14, openAt + 18, Easing.inOut(Easing.quad));
  const zMax = wipe <= 0 ? 400 : wipe >= 1 ? 0 : 42 * (1 - wipe);
  const cam = groundSafe(camPath(f, [
    {t: 0, pos: [-15, 3.4, 30], target: [-1, 2.8, 0], fov: 40},
    {t: openAt, pos: [-8, 3.2, 27], target: [-1, 2.6, -1], fov: 42},
    {t: L, pos: [-2.2, 3.1, 21.5], target: [-1.2, 2.6, -2], fov: 46},
  ]), groundH(false), 1.5, 0.4);
  const b: Build = {...B0, zMax};
  const air = ramp(f, openAt + 10, openAt + 30);
  return (
    <>
      <Stage cam={cam}>
        <Atmos f={f} target={[0, 2, -2]} shadow={26} />
        <World b={b} f={f} />
        <RoomAir heat={1} />
        <Flow pts={PATH.winIn} f={f} a={HOT} r={0.1} opacity={air} reveal={ramp(f, openAt + 10, openAt + 50, Easing.linear)} />
        <Flow pts={PATH.winIn2} f={f} a={HOT} r={0.08} opacity={air} reveal={ramp(f, openAt + 20, openAt + 60, Easing.linear)} />
      </Stage>
      <Headline top="DESERT SUMMER" big="40°C+" sub="NO ELECTRICITY" delay={4} y={150} bigSize={190} />
      <Sequence from={openAt + 6} durationInFrames={Math.max(1, soAt - openAt - 6)} layout="none">
        <Pin p={[R.x0 - 0.5, 1.4, 0]} cam={cam} text="OPEN WINDOW = MORE HEAT" delay={0} dy={230} size={50} red />
      </Sequence>
      <Sequence from={soAt} layout="none">
        <Tag text="HOW DO YOU COOL THIS?" x={540} y={1440} anchor="center" delay={0} size={62} />
      </Sequence>
      <Thermo v={1} o={ramp(f, openAt + 14, openAt + 26)} />
    </>
  );
};

// ============================================================ S2 thick mud-brick walls
const S2: React.FC = () => {
  const f = useCurrentFrame();
  const L = LEN[1];
  const fixAt = wordAt(1, 'Fix');
  const soakAt = wordAt(1, 'It soaks');
  const th = ramp(f, fixAt, soakAt + 12, Easing.linear);
  const cam = groundSafe(camPath(f, [
    {t: 0, pos: [4.2, 3.6, 16], target: [3.4, 2.5, -1.5], fov: 50},
    {t: L, pos: [2.2, 4.2, 20], target: [2.0, 2.6, -2], fov: 50},
  ]), groundH(true));
  const heat = lerp(HEAT[0], HEAT[1], ramp(f, soakAt, L - 20));
  const b: Build = {...B0, th, heat};
  const ph = (k: number) => (f * 0.022 + k * 0.33) % 1;
  const arrow = 1 - ramp(f, fixAt + 40, soakAt + 10);
  const walker = walkAlong([17, 0, -0.7], Math.PI, f, 1.15);
  return (
    <>
      <Stage cam={cam}>
        <Atmos f={f} target={[3, 2, -2]} shadow={20} />
        <World b={b} f={f} />
        <RoomAir heat={heat} />
        <BrickRows />
        <ScaffoldBay position={[5.9, 0, -2.4]} w={1.3} d={1.1} h={3.9} levels={2} />
        <Worker position={[6.4, 2.04, -1.9]} rotY={Math.PI} pose="hammer" seed={3} t={f * 0.22} />
        <Worker position={[6.5, 0, -0.1]} rotY={Math.PI} pose="chisel" seed={2} t={f * 0.18} tool="none" />
        <Worker {...walker} pose="carry" legs="walk" seed={1} />
        <HeadLoad p={walker.position} />
        {/* the sun's heat pushing through the wall */}
        {[0, 1, 2].map((k) => (
          <Flow key={k} pts={P_SUNWALL[k]} f={f} a={HOT} r={0.09} opacity={arrow} reveal={th > 0.5 ? 0.72 : 1} dashes={3} speed={0.04} heads={2} />
        ))}
        {th > 0 && th < 1 && <Dust at={[5.2, R.h * th + 0.1, -0.7]} f={f} count={5} size={0.16} color="#c8a884" />}
      </Stage>
      <ProbFix n={1} problem="THE SUN BAKES THE WALLS" fix="THICK MUD BRICK" fixAt={fixAt} delay={3} />
      <Sequence durationInFrames={fixAt} layout="none">
        <Pin p={[R.x1 + 0.1, 3.0, 0]} cam={cam} text="THIN WALL" delay={12} dx={-60} anchor="right" red />
      </Sequence>
      <Pin p={[R.x1 + 0.5, 1.6, 0]} cam={cam} text="MUD BRICK" delay={fixAt + 26} dx={-80} anchor="right" />
      <Sequence from={soakAt} layout="none">
        <Caption text="Thick walls soak up the day's heat" delay={0} bottom={330} />
      </Sequence>
      <Thermo v={heat} />
    </>
  );
};

// ============================================================ S3 the tower
const S3: React.FC = () => {
  const f = useCurrentFrame();
  const L = LEN[2];
  const fixAt = wordAt(2, 'Fix');
  const upAt = wordAt(2, 'Up above');
  const cAt = wordAt(2, 'cooler');
  const dAt = wordAt(2, 'less dust');
  const sAt = wordAt(2, 'stronger');
  const tower = ramp(f, fixAt + 4, upAt + 34, Easing.inOut(Easing.quad));
  const cam = groundSafe(camPath(f, [
    {t: 0, pos: [0.2, 3.8, 21], target: [0.2, 2.6, -2], fov: 50},
    {t: fixAt, pos: [0.4, 4.2, 22], target: [0.4, 3, -2], fov: 50},
    {t: upAt + 34, pos: [1.6, 10.2, 37], target: [1.0, 9.4, -2], fov: 50},
    {t: L, pos: [1.4, 10.4, 35.5], target: [1.0, 9.6, -2], fov: 50},
  ]), groundH(true));
  const b: Build = {...B0, th: 1, tower, heat: HEAT[1], part: 0};
  const sc = Math.max(tower, ramp(f, fixAt, fixAt + 14) * 0.08);
  const still = 1 - ramp(f, upAt, upAt + 16) * 0.4;
  const wind = ramp(f, upAt - 10, upAt + 16);
  return (
    <>
      <Stage cam={cam}>
        <Atmos f={f} target={[1, 6, -2]} shadow={22} />
        <World b={b} f={f} />
        <RoomAir heat={HEAT[1]} />
        <Flow pts={PATH.loop} f={f} a={HOT} r={0.07} opacity={0.75 * still} speed={0.008} dashes={5} heads={3} />
        <Flow pts={PATH.loop2} f={f} a={HOT} r={0.06} opacity={0.6 * still} speed={0.006} dashes={4} heads={3} />
        <Flow pts={PATH.street} f={f} a={WARM} r={0.05} opacity={0.5} speed={0.008} dashes={2} heads={1} />
        <Flow pts={PATH.street2} f={f} a={WARM} r={0.05} opacity={0.5} speed={0.008} dashes={2} heads={1} />
        <Flow pts={PATH.over} f={f} a={WIND} r={0.14} opacity={wind} speed={0.1} dashes={8} heads={6} />
        <Flow pts={PATH.over2} f={f} a={WIND} r={0.12} opacity={wind * 0.85} speed={0.1} dashes={7} heads={5} />
        <Flow pts={PATH.over3} f={f} a={WIND} r={0.11} opacity={wind * 0.8} speed={0.09} dashes={8} heads={5} />
        {/* builders on the roof */}
        {sc > 0.02 && (
          <group position={[0, RT + 0.42, 0]} scale={[1, sc, 1]}>
            <ScaffoldBay position={[3.75, 0, -2.0]} w={1.15} d={1.1} h={7.2} levels={3} />
            <ScaffoldBay position={[-0.5, 0, -2.0]} w={1.15} d={1.1} h={7.2} levels={3} />
          </group>
        )}
        {tower < 1 && <Dust at={[TX, RT + (TW.top - RT) * tower, -0.6]} f={f} count={6} size={0.22} color="#c8a884" />}
        {sc > 0.3 && <Worker position={[4.3, RT + 0.42 + 4.86 * sc + 0.06, -1.5]} rotY={Math.PI} pose="hammer" seed={3} t={f * 0.22} />}
        {sc > 0.3 && <Worker position={[0.05, RT + 0.42 + 4.86 * sc + 0.06, -1.5]} rotY={0} pose="chisel" seed={2} t={f * 0.2} tool="stone" />}
        <Worker position={[-3.0, RT + 0.42 - 0.42, -2.3]} rotY={0.1} pose="point" seed={1} />
      </Stage>
      <ProbFix n={2} problem="THE AIR JUST SITS THERE" fix="BUILD A TOWER" fixAt={fixAt} delay={3} />
      <Pin p={[-6.6, 11.9, 0]} cam={cam} text="STRONGER" delay={sAt - 2} anchor="left" dx={0} size={50} />
      <Pin p={[-6.6, 10.3, 0]} cam={cam} text="COOLER" delay={cAt} anchor="left" dx={0} size={50} cool />
      <Pin p={[-6.6, 8.7, 0]} cam={cam} text="LESS DUST" delay={dAt} anchor="left" dx={0} size={50} />
      <Thermo v={lerp(HEAT[1], HEAT[2], ramp(f, upAt, L))} />
    </>
  );
};

// ============================================================ S4 the wind shifts -> internal walls (top view)
/** Path of wind arriving from direction k (0 +x, 1 -z, 2 -x, 3 +z) and diving into the shaft on that side. */
const dirPaths = (k: number, through: boolean) => {
  const a = -(k * Math.PI) / 2;
  const c = Math.cos(a), s = Math.sin(a);
  const pt = (r: number, y: number, q = 0): [number, number, number] => [TX + c * r - s * q, y, c * q + s * r];
  return through
    ? [pt(22, 13.4), pt(11, 13.4), pt(2.2, 12.8), pt(0, 12.6), pt(-2.2, 12.8), pt(-11, 13.4), pt(-22, 13.4)]
    : [pt(22, 13.4), pt(11, 13.4), pt(3, 13.1), pt(1.6, 12.6), pt(0.8, 11.2), pt(0.75, 8)];
};
const P_THROUGH = [0, 1, 2, 3].map((k) => dirPaths(k, true));
const P_DIVE = [0, 1, 2, 3].map((k) => dirPaths(k, false));

const ShaftGlow: React.FC<{k: number; o: number}> = ({k, o}) => {
  const m = useMemo(() => new THREE.MeshBasicMaterial({color: '#27d8ff', transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide}), []);
  const geo = useMemo(() => {
    const r = 1.2;
    const s = new THREE.Shape();
    s.moveTo(0, 0);
    s.lineTo(r, r);
    s.lineTo(r, -r);
    s.closePath();
    const g = new THREE.ShapeGeometry(s);
    g.rotateX(-Math.PI / 2);
    return g;
  }, []);
  m.opacity = o * 0.5;
  if (o <= 0.01) return null;
  return <mesh geometry={geo} position={[TX, TW.top + 0.03, 0]} rotation={[0, (k * Math.PI) / 2, 0]} material={m} renderOrder={14} />;
};

const S4: React.FC = () => {
  const f = useCurrentFrame();
  const L = LEN[3];
  const fixAt = wordAt(3, 'Fix');
  const oneAt = wordAt(3, 'One side');
  const part = ramp(f, fixAt + 2, fixAt + 34);
  const capDrop = ramp(f, L - 30, L - 8, Easing.in(Easing.quad));
  const cam = groundSafe(camPath(f, [
    {t: 0, pos: [TX + 6, 23, 15], target: [TX, 11.6, 0], fov: 46},
    {t: fixAt, pos: [TX + 2.6, 25, 8.5], target: [TX, 12, 0], fov: 42},
    {t: L - 30, pos: [TX + 1.2, 26, 5.5], target: [TX, 12.4, 0], fov: 40},
    {t: L, pos: [TX + 5, 22, 13], target: [TX, 11.4, 0], fov: 44},
  ]), groundH(false));
  const b: Build = {...B0, th: 1, tower: 1, part, cap: capDrop, zMax: 999, heat: HEAT[2], people: false};
  // wind direction sequence
  const seq = [0, 1, 3, 2];
  const prob = 3; // directions shown before the fix
  const tProb = (i: number) => (fixAt / prob) * i;
  const probOp = (i: number) => ramp(f, tProb(i) + 2, tProb(i) + 12) * (1 - ramp(f, tProb(i + 1) - 6, tProb(i + 1) + 2));
  const T0 = fixAt + 30;
  const dur = (L - 30 - T0) / 4;
  const fixOp = (i: number) => ramp(f, T0 + dur * i + 2, T0 + dur * i + 10) * (1 - ramp(f, T0 + dur * (i + 1) - 6, T0 + dur * (i + 1) + 1));
  return (
    <>
      <Stage cam={cam}>
        <Atmos f={f} target={[TX, 10, 0]} shadow={24} />
        <World b={b} f={f} cut={false} />
        {[0, 1, 2].map((i) => (
          <Flow key={i} pts={P_THROUGH[seq[i]]} f={f} a={WIND} r={0.09} opacity={probOp(i)} speed={0.09} dashes={8} heads={6} />
        ))}
        {seq.map((k, i) => (
          <group key={k}>
            <Flow pts={P_DIVE[k]} f={f} a={WIND} b={COOL} mixAt={[0.45, 0.7]} r={0.09} opacity={fixOp(i)} speed={0.09} dashes={6} heads={4} />
            <ShaftGlow k={k} o={fixOp(i)} />
          </group>
        ))}
      </Stage>
      <ProbFix n={3} problem="THE WIND KEEPS SHIFTING" fix="SPLIT THE TOWER" fixAt={fixAt} delay={3} />
      <Sequence durationInFrames={fixAt} layout="none">
        <Tag text="IT BLOWS RIGHT THROUGH" x={540} y={1440} anchor="center" delay={14} size={52} bg={C.red} fg={C.white} />
      </Sequence>
      <Sequence from={fixAt + 8} durationInFrames={Math.max(1, oneAt - fixAt - 8)} layout="none">
        <Tag text="WALLS MAKE SHAFTS" x={540} y={1440} anchor="center" delay={0} size={56} />
      </Sequence>
      <Sequence from={oneAt} durationInFrames={L - 34 - oneAt} layout="none">
        <Tag text="ONE SIDE ALWAYS CATCHES IT" x={540} y={1440} anchor="center" delay={0} size={54} bg={'#27d8ff'} />
      </Sequence>
    </>
  );
};

// ============================================================ S5 suction on the far side
const S5: React.FC = () => {
  const f = useCurrentFrame();
  const L = LEN[4];
  const fixAt = wordAt(4, 'Fix');
  const windAt = wordAt(4, 'Wind rushing');
  const suckAt = wordAt(4, 'suction');
  const pullAt = wordAt(4, 'pulling');
  const cam = groundSafe(camPath(f, [
    {t: 0, pos: [0.6, 3.6, 24], target: [0.6, 3.1, -2], fov: 48},
    {t: fixAt, pos: [0.6, 3.8, 25], target: [0.6, 3.4, -2], fov: 48},
    {t: windAt, pos: [1.6, 10, 25], target: [1.4, 9.8, -2], fov: 50},
    {t: pullAt + 6, pos: [1.2, 10.2, 35], target: [1.0, 9.5, -2], fov: 50},
    {t: L, pos: [1.1, 10.0, 36.5], target: [0.9, 9.2, -2], fov: 50},
  ]), groundH(true));
  const hot = 1 - ramp(f, pullAt, pullAt + 30);
  const heat = lerp(HEAT[3], HEAT[4], ramp(f, pullAt, L - 8));
  const b: Build = {...B0, th: 1, tower: 1, part: 1, cap: 1, heat};
  const inO = ramp(f, 0, 14);
  const outR = ramp(f, suckAt, pullAt + 26, Easing.linear);
  return (
    <>
      <Stage cam={cam}>
        <Atmos f={f} target={[1, 6, -2]} shadow={22} />
        <World b={b} f={f} />
        <RoomAir heat={heat} />
        <Flow pts={PATH.loop} f={f} a={HOT} r={0.07} opacity={0.8 * hot} speed={0.012} dashes={5} heads={3} />
        <Flow pts={PATH.loop2} f={f} a={HOT} r={0.06} opacity={0.65 * hot} speed={0.01} dashes={4} heads={3} />
        <Flow pts={PATH.into} f={f} a={WARM} r={0.11} opacity={inO} speed={0.07} dashes={7} heads={6} />
        <Flow pts={PATH.out} f={f} a={HOT} r={0.11} opacity={1} reveal={outR} speed={0.07} dashes={7} heads={6} />
        <Flow pts={PATH.over} f={f} a={WIND} r={0.12} opacity={ramp(f, windAt - 14, windAt + 4)} speed={0.1} dashes={8} heads={6} />
      </Stage>
      <ProbFix n={4} problem="HOT AIR NEEDS A WAY OUT" fix="THE FAR SIDE" fixAt={fixAt} delay={3} />
      <Pin p={[4.2, 10.6, 0]} cam={cam} text="WIND PUSHES IN" delay={windAt - 6} anchor="left" size={40} />
      <Pin p={[-1.6, 10.9, 0]} cam={cam} text="SUCTION" delay={suckAt} anchor="right" size={58} red />
      <Pin p={[1.45, 6.6, 0]} cam={cam} text="STALE AIR OUT" delay={pullAt + 6} dx={-110} anchor="right" size={46} />
      <Thermo v={lerp(HEAT[2], heat, 1)} />
    </>
  );
};

// ============================================================ S6 water in the cellar
const S6: React.FC = () => {
  const f = useCurrentFrame();
  const L = LEN[5];
  const fixAt = wordAt(5, 'Fix');
  const canalAt = wordAt(5, 'underground');
  const evapAt = wordAt(5, 'evaporates');
  const coolAt = wordAt(5, 'comes up');
  const cam = groundSafe(f < fixAt ? camPath(f, [
    {t: 0, pos: [2.0, 8, 27], target: [1.8, 6.6, -2], fov: 50},
    {t: fixAt, pos: [2.0, 5, 24], target: [1.8, 3.8, -2], fov: 50},
  ]) : camPath(f - fixAt, [
    {t: 0, pos: [1.2, 0.2, 22], target: [0.9, -1.0, -2], fov: 48},
    {t: L - fixAt, pos: [0.6, -0.3, 19.5], target: [0.4, -1.0, -2], fov: 48},
  ]), groundH(true));
  const dig = f >= fixAt;
  const water = ramp(f, fixAt + 12, canalAt + 24);
  const heat = lerp(HEAT[4], HEAT[5], ramp(f, coolAt - 8, L - 6));
  const b: Build = {...B0, th: 1, tower: 1, part: 1, cap: 1, cellar: dig, water, heat};
  const dip = Math.max(0, 1 - Math.abs(f - fixAt) / 6);
  const rev = ramp(f, evapAt - 26, coolAt + 26, Easing.linear);
  const DOWN = 80; // frames of walking, then he stands on the last steps
  const wf = Math.min(Math.max(0, f - fixAt - 4), DOWN);
  const walker = walkAlong([-4.45, 0, -0.55], 0, wf, 0.9, (x) => Math.min(0, -3.6 - 1.04 * (x + 1.4)));
  const walking = f - fixAt - 4 < DOWN;
  return (
    <>
      <Stage cam={cam}>
        <Atmos f={f} target={[1, dig ? 0 : 4, -2]} shadow={22} />
        <World b={b} f={f} />
        <RoomAir heat={heat} />
        {!dig && <Flow pts={PATH.into} f={f} a={HOT} r={0.11} speed={0.07} dashes={7} heads={6} />}
        {!dig && <Flow pts={PATH.loop} f={f} a={HOT} r={0.07} opacity={0.75} speed={0.012} dashes={5} heads={3} />}
        {dig && <Flow pts={PATH.down} f={f} a={HOT} b={COOL} mixAt={[0.3, 0.42]} r={0.12} reveal={rev * 0.62 + 0.14} speed={0.1} dashes={14} heads={12} />}
        {/* the canal bringing water in */}
        {dig && <Flow pts={P_CANAL} f={f} a="#7fe8ff" r={0.06} opacity={ramp(f, fixAt + 4, fixAt + 14)} speed={0.06} dashes={6} heads={3} />}
        {/* evaporation */}
        {dig && Array.from({length: 14}, (_, i) => {
          const ph = (f * 0.016 + rnd(i * 3)) % 1;
          return (
            <mesh key={i} position={[-0.8 + rnd(i) * 4.6, CL.wat + 0.05 + ph * 0.75, -0.3 - rnd(i + 9) * 0.3]} renderOrder={17}>
              <sphereGeometry args={[0.05 + 0.05 * ph, 8, 6]} />
              <meshBasicMaterial color="#e4fbff" transparent depthWrite={false} toneMapped={false} opacity={ramp(f, evapAt - 10, evapAt) * 0.8 * (1 - ph)} />
            </mesh>
          );
        })}
        {dig && <Worker position={[-2.05, -3.3, -2.3]} rotY={0} pose="chisel" tool="hammer" seed={3} t={f * 0.2} legs="kneel" />}
        {dig && <Worker {...walker} pose="carry" legs={walking ? 'walk' : 'still'} seed={1} />}
        {dig && <HeadLoad p={walker.position} />}
      </Stage>
      {dip > 0 && <AbsoluteFill style={{background: '#0e0b08', opacity: dip}} />}
      <ProbFix n={5} problem="DESERT WIND IS HOT" fix="WATER" fixAt={fixAt} delay={3} />
      <Sequence from={canalAt - 4} layout="none">
        <Pin p={[5.6, -3.85, 0]} cam={cam} text="UNDERGROUND CANAL" delay={0} dy={150} anchor="right" dx={120} size={44} />
      </Sequence>
      <Sequence from={evapAt - 6} layout="none">
        <Pin p={[0.9, CL.wat, 0]} cam={cam} text="WATER EVAPORATES" delay={0} dy={-260} size={44} cool />
      </Sequence>
      <Sequence from={coolAt} layout="none">
        <Pin p={[-3.2, 0.6, 0]} cam={cam} text="COOLER AIR" delay={0} dy={-170} size={50} cool />
      </Sequence>
      <Thermo v={heat} />
    </>
  );
};

// ============================================================ S7 no wind: the sun drives it
const S7: React.FC = () => {
  const f = useCurrentFrame();
  const L = LEN[6];
  const fixAt = wordAt(6, 'Fix');
  const heatsAt = wordAt(6, 'heats');
  const riseAt = wordAt(6, 'rises');
  const drawAt = wordAt(6, 'draws');
  const cam = groundSafe(camPath(f, [
    {t: 0, pos: [1.6, 9.6, 32], target: [1.4, 9, -2], fov: 50},
    {t: L, pos: [0.8, 7.8, 40], target: [0.8, 6.9, -2], fov: 50},
  ]), groundH(true));
  const glow = ramp(f, heatsAt - 4, riseAt);
  const b: Build = {...FULL, heat: HEAT[5], glow};
  const die = 1 - ramp(f, 2, fixAt - 8);
  const sun = ramp(f, fixAt, heatsAt + 8);
  const r = ramp(f, riseAt - 6, drawAt + 30, Easing.linear);
  return (
    <>
      <Stage cam={cam}>
        <Atmos f={f} target={[1, 5, -2]} shadow={26} />
        <World b={b} f={f} />
        <RoomAir heat={HEAT[5]} />
        <Flow pts={PATH.over} f={f} a={WIND} r={0.12} opacity={die} speed={0.1 * die + 0.01} dashes={8} heads={6} />
        <Flow pts={PATH.into} f={f} a={WIND} b={COOL} r={0.1} opacity={die} speed={0.08 * die + 0.01} dashes={7} heads={6} />
        {[0, 1, 2].map((k) => (
          <Flow key={k} pts={P_SUNRAY[k]} f={f} a={WARM} r={0.11} opacity={sun} dashes={3} speed={0.05} heads={2} />
        ))}
        <Flow pts={PATH.rise} f={f} a={COOL} b={HOT} mixAt={[0.44, 0.72]} r={0.12} reveal={r} speed={0.05} dashes={12} heads={10} />
        <Flow pts={PATH.rise2} f={f} a={COOL} b={HOT} mixAt={[0.46, 0.74]} r={0.1} reveal={r * 0.98} speed={0.05} dashes={12} heads={10} />
      </Stage>
      <ProbFix n={6} problem="NO WIND" fix="THE SUN" fixAt={fixAt} delay={3} />
      <Pin p={[TW.x1, 11.2, 0]} cam={cam} text="SUN HEATS THE TOWER" delay={heatsAt} dy={-70} anchor="right" dx={80} size={44} />
      <Pin p={[1.45, 8.2, 0]} cam={cam} text="HOT AIR RISES" delay={riseAt} dx={-120} anchor="right" size={44} red />
      <Pin p={[-3.3, -0.5, 0]} cam={cam} text="COOL AIR DRAWN UP" delay={drawAt + 4} dy={210} dx={60} size={44} cool />
      <Thermo v={HEAT[5]} />
    </>
  );
};

// ============================================================ S8 payoff
const S8: React.FC = () => {
  const f = useCurrentFrame();
  const L = LEN[7];
  const noAt = wordAt(7, 'No motor');
  const fuelAt = wordAt(7, 'no fuel');
  const noiseAt = wordAt(7, 'no noise');
  const oneAt = wordAt(7, 'One of') + 8;
  const g = f - oneAt;
  const LB = L - oneAt;
  const camA = groundSafe(camPath(f, [
    {t: 0, pos: [0.2, 1.4, 26], target: [0.2, 0.6, -2], fov: 48},
    {t: oneAt, pos: [0.3, 1.0, 22], target: [0.3, 0.2, -2], fov: 48},
  ]), groundH(true));
  const camB = groundSafe(camPath(g, [
    {t: 0, pos: [17, 12, 44], target: [-3, 19, -12], fov: 54},
    {t: LB, pos: [22, 30, 72], target: [-6, 21, -18], fov: 50},
  ]), groundH(false));
  const b: Build = {...FULL, heat: HEAT[7]};
  const bOut: Build = {...FULL, zMax: 400, heat: 0, people: false, cellar: false, water: 0};
  const ph = (i: number) => (f * 0.03 + i * 0.5) % 1;
  return (
    <>
      <Sequence durationInFrames={oneAt} layout="none">
        <Stage cam={camA}>
          <Atmos f={f} target={[0, 2, -2]} shadow={20} />
          <World b={b} f={f} />
          <RoomAir heat={HEAT[7]} />
          <Flow pts={PATH.down} f={f} a={WARM} b={COOL} mixAt={[0.3, 0.42]} r={0.1} speed={0.1} dashes={14} heads={12} />
          {[0, 1].map((i) => <mesh key={i} position={[0.1 + i * 0.12, 0.34 + ph(i) * 0.6, -2.6]}><sphereGeometry args={[0.03, 6, 4]} /><meshBasicMaterial color="#fff" transparent opacity={0.4 * (1 - ph(i))} depthWrite={false} /></mesh>)}
        </Stage>
        <Headline top="IT CAN BE" big="8–12°C" sub="COOLER INSIDE" delay={3} y={150} bigSize={170} bigColor="#9feaff" />
        <Tag text="NO MOTOR" x={200} y={1570} anchor="center" delay={noAt} size={46} />
        <Tag text="NO FUEL" x={540} y={1570} anchor="center" delay={fuelAt} size={46} />
        <Tag text="NO NOISE" x={878} y={1570} anchor="center" delay={noiseAt} size={46} />
        <Thermo v={HEAT[7]} />
      </Sequence>
      <Sequence from={oneAt} layout="none">
        <Stage cam={camB}>
          <Atmos f={f} golden={1} target={[0, 8, -10]} shadow={46} res={4096} />
          <World b={bOut} f={f} cut={false} towers />
          <GiantTower position={[-16, 0, -40]} />
        </Stage>
        <Headline top="YAZD, IRAN" big="33 METERS" sub="ONE TOWER, NO POWER" delay={6} y={150} bigSize={132} />
        <Pin p={[-16, 37, -40]} cam={camB} text="ONE OF THE TALLEST" delay={16} dy={-60} size={44} />
      </Sequence>
    </>
  );
};

// ============================================================ timeline
const SCENES = [S1, S2, S3, S4, S5, S6, S7, S8];

export const Windcatcher: React.FC = () => (
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
        <Audio src={staticFile(`vo/ep011-windcatcher_${i}.wav`)} />
      </Sequence>
    ))}
    <Watermark />
  </AbsoluteFill>
);

export const WINDCATCHER_START = START;
export const WINDCATCHER_LEN = LEN;
