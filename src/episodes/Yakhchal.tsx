// Episode 5 (Format B): Desert pit -> yakhchal, making ice in the desert with no electricity.
import React, {useMemo} from 'react';
import {AbsoluteFill, Audio, interpolate, Sequence, staticFile, useCurrentFrame, useVideoConfig, Easing} from 'remotion';
import {ThreeCanvas} from '@remotion/three';
import * as THREE from 'three';
import VO from './ep005-yakhchal-vo.json';
import {AssetProvider, Renderer, SkyDome, Sun, TexName, useMat, usePlainMat, uvBox, worldUV} from '../hib/pbr';
import {Beam, Bush, Dust, KIT_TEXTURES, PalmTree, Person, Plank, Rock, Rope, ScaffoldBay, Terrain, Water, rnd, walkAlong} from '../hib/models';
import {CameraRig} from '../hib/three';
import {Cam, camPath, groundSafe, toScreen} from '../hib/project';
import {C, Caption, Grade, Headline, ProbFix, SceneFade, Tag, Watermark} from '../hib/ui';

// ============================================================ timing
const FPS = 30;
const VO_DELAY = 5;
const sceneLen = (i: number, tail: number) => Math.ceil((VO.durations[i] + tail) * FPS) + VO_DELAY;
const LEN = [sceneLen(0, 0.45), sceneLen(1, 0.45), sceneLen(2, 0.45), sceneLen(3, 0.45), sceneLen(4, 0.45), sceneLen(5, 0.45), sceneLen(6, 0.45), sceneLen(7, 1.6)];
const START = LEN.map((_, i) => LEN.slice(0, i).reduce((a, b) => a + b, 0));
export const YAKHCHAL_DURATION = LEN.reduce((a, b) => a + b, 0);
/** frame (local to scene i) at which the word `w` is spoken, estimated from character position. */
const wordAt = (i: number, w: string) => Math.round(VO_DELAY + (VO.lines[i].indexOf(w) / VO.lines[i].length) * VO.durations[i] * FPS);

const cl = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
const ramp = (f: number, a: number, b: number, ease = Easing.inOut(Easing.cubic)) => interpolate(f, [a, b], [0, 1], {...cl, easing: ease});
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const TEXTURES: TexName[] = [...KIT_TEXTURES, 'cracked_earth', 'sand', 'dirt', 'mud_plaster', 'mud_brick', 'ice', 'water', 'straw', 'stone_face_sand', 'tuff_strata'];
const MUD = '#f3dcc0';

// ============================================================ world layout (metres; +z = south, sun comes from the south)
const DOME = {R0: 9.0, H: 16.2, Ri: 6.8, Hi: 15.4, top: 0.75, topOut: 1.2, pit: 7};
const WALL = {x0: -32, x1: 32, z: -15, h: 10, t0: 1.7, t1: 0.8};
const POOLS = [-18.6, -22.6, -26.6].map((z) => ({z, x0: -28, x1: 28, w: 3.0}));
const QANAT_X = -34;
const HOLE = {x: 44, z: 34, s: 3.2, d: 1.6}; // the "dumb" pit of the hook

const SUN_DIR: [number, number, number] = [0.42, 0.55, 0.9];

/** distant dunes + mountain ridge to the north; near area sits below the ground slab. */
const farH = (x: number, z: number, near: number) => {
  const e = Math.max(Math.abs(x), Math.abs(z));
  const rise = smooth(192, 222, e);
  const dunes = (Math.sin(x * 0.021 + 1.1) * Math.cos(z * 0.017) * 6 + Math.sin(x * 0.047 + z * 0.031) * 3 + 5) * smooth(215, 300, e);
  const ridge = 70 * smooth(260, 430, -z) * (0.7 + 0.3 * Math.sin(x * 0.012 + 2));
  return near * (1 - rise) + rise * (dunes + ridge);
};
const heightNormal = (x: number, z: number) => farH(x, z, -2.5);
const heightCut = (x: number, z: number) => farH(x, z, -10.6);
/** ground used by groundSafe: top of the slab where it exists. */
const groundAt = (cut: boolean) => (x: number, z: number) => {
  if (Math.abs(x) < 200 && Math.abs(z) < 200) {
    if (cut && z > 0) return -10.5;
    return 0;
  }
  return cut ? heightCut(x, z) : heightNormal(x, z);
};

// ---- materials with large-scale colour variation (hides tiling on big flat ground)
const useMacroMat = (tex: TexName, texScale: number, tint?: string) => {
  const base = useMat(tex, {tint});
  return useMemo(() => {
    const m = base.clone();
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vMPos;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMPos = (modelMatrix * vec4(position,1.0)).xz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec2 vMPos;
float mh(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float mn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(mh(i),mh(i+vec2(1,0)),f.x), mix(mh(i+vec2(0,1)),mh(i+vec2(1,1)),f.x), f.y); }`)
        .replace('#include <map_fragment>', `#include <map_fragment>
float mv = mn(vMPos / 19.0) * 0.6 + mn(vMPos / 57.0) * 0.4;
diffuseColor.rgb *= 0.8 + 0.4 * mv;`);
    };
    m.customProgramCacheKey = () => 'macro' + tex + texScale;
    return m;
  }, [base, tex, texScale]);
};

// ============================================================ ground slab (extruded top-view shape, so holes/cutaways have real walls)
const slabGeo = (cut: boolean) => {
  const W = 200, D = 10.5;
  const s = new THREE.Shape();
  if (cut) {
    // region z in [-200, 0] (shape y = -z in [0, 200]) with a half-circle notch for the pit
    s.moveTo(-W, 0);
    s.lineTo(-DOME.Ri, 0);
    s.absarc(0, 0, DOME.Ri, Math.PI, 0, true);
    s.lineTo(W, 0);
    s.lineTo(W, W);
    s.lineTo(-W, W);
    s.closePath();
  } else {
    s.moveTo(-W, -W);
    s.lineTo(W, -W);
    s.lineTo(W, W);
    s.lineTo(-W, W);
    s.closePath();
    const h = new THREE.Path();
    const {x, z, s: hs} = HOLE;
    h.moveTo(x - hs / 2, -z - hs / 2);
    h.lineTo(x - hs / 2, -z + hs / 2);
    h.lineTo(x + hs / 2, -z + hs / 2);
    h.lineTo(x + hs / 2, -z - hs / 2);
    h.closePath();
    s.holes.push(h);
  }
  const g = new THREE.ExtrudeGeometry(s, {depth: D, bevelEnabled: false, curveSegments: 48});
  g.rotateX(-Math.PI / 2);
  g.translate(0, -D, 0);
  return worldUV(g, 4);
};

const World: React.FC<{cut?: boolean; f: number; showWall?: number; showDome?: number; pools?: {fill: number; freeze: number}; hidePool0?: boolean}> = ({
  cut = false, f, showWall = 1, showDome = 1, pools = {fill: 1, freeze: 1}, hidePool0 = false,
}) => {
  const top = useMacroMat('cracked_earth', 4, '#f4e2c8');
  const side = useMat('tuff_strata', {tint: '#c49a74'});
  const g = useMemo(() => slabGeo(cut), [cut]);
  const mats = useMemo(() => [top, side], [top, side]);
  const holeFloor = useMat('dirt');
  return (
    <group>
      <Terrain height={cut ? heightCut : heightNormal} size={900} seg={200} tex="sand" texScale={6} />
      <mesh geometry={g} material={mats} receiveShadow castShadow />
      {!cut && (
        <mesh position={[HOLE.x, -HOLE.d, HOLE.z]} rotation={[-Math.PI / 2, 0, 0]} material={holeFloor} receiveShadow>
          <planeGeometry args={[HOLE.s, HOLE.s]} />
        </mesh>
      )}
      <Qanat />
      <Pools fill={pools.fill} freeze={pools.freeze} f={f} hide0={hidePool0} />
      {showWall > 0 && <ShadeWall reveal={showWall >= 1 ? 99 : showWall * WALL.h} />}
      {showDome > 0 && (cut ? <DomeCut reveal={showDome >= 1 ? 99 : showDome * DOME.H} /> : <DomeFull />)}
      <Scenery />
    </group>
  );
};

// ============================================================ the dome (stepped mud cone)
const rOut = (y: number) => DOME.topOut + (DOME.R0 - DOME.topOut) * Math.pow(1 - y / DOME.H, 1.12);
const rIn = (y: number) => DOME.top + (DOME.Ri - DOME.top) * Math.pow(1 - y / DOME.Hi, 1.08);
const domeProfile = () => {
  const pts: THREE.Vector2[] = [];
  pts.push(new THREE.Vector2(DOME.Ri, 0));
  pts.push(new THREE.Vector2(DOME.R0 + 0.15, 0));
  // stepped outside: 9 terraces in the lower 70%, smooth above
  const steps = 9;
  const yStepTop = DOME.H * 0.7;
  for (let k = 0; k < steps; k++) {
    const y0 = (k / steps) * yStepTop, y1 = ((k + 1) / steps) * yStepTop;
    const r0 = rOut(y0) + 0.15, r1 = rOut(y1) + 0.15;
    pts.push(new THREE.Vector2(r0, y0 + (y1 - y0) * 0.78));
    pts.push(new THREE.Vector2(r1 + 0.02, y0 + (y1 - y0) * 0.78 + 0.01));
    pts.push(new THREE.Vector2(r1, y1));
  }
  for (let k = 1; k <= 8; k++) {
    const y = yStepTop + (k / 8) * (DOME.H - yStepTop);
    pts.push(new THREE.Vector2(rOut(y), y));
  }
  pts.push(new THREE.Vector2(DOME.top, DOME.H));
  for (let k = 0; k <= 16; k++) {
    const y = DOME.Hi * (1 - k / 16);
    pts.push(new THREE.Vector2(rIn(y), y));
  }
  return pts;
};

const domeGeos = (half: boolean) => {
  const pts = domeProfile();
  const lathe = new THREE.LatheGeometry(pts, 128, half ? Math.PI / 2 : 0, half ? Math.PI : Math.PI * 2).toNonIndexed();
  lathe.computeVertexNormals();
  worldUV(lathe, 3);
  let cap: THREE.BufferGeometry | null = null;
  if (half) {
    const sh = new THREE.Shape(pts.slice(0, -1).map((p) => new THREE.Vector2(p.x, p.y)));
    const a = new THREE.ShapeGeometry(sh, 4);
    const b = a.clone();
    b.scale(-1, 1, 1);
    const merged = new THREE.BufferGeometry();
    const pa = a.getAttribute('position').array as Float32Array, pb = b.getAttribute('position').array as Float32Array;
    const ia = a.index!.array, ib = b.index!.array;
    const pos = new Float32Array(pa.length + pb.length);
    pos.set(pa, 0);
    pos.set(pb, pa.length);
    const idx: number[] = [...Array.from(ia)];
    const off = pa.length / 3;
    for (let i = 0; i < ib.length; i += 3) idx.push(ib[i] + off, ib[i + 2] + off, ib[i + 1] + off); // flip winding back
    merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    merged.setIndex(idx);
    merged.computeVertexNormals();
    cap = worldUV(merged, 2.2);
  }
  return {lathe, cap};
};

const DomeFull: React.FC = () => {
  const m = useMat('mud_plaster', {tint: MUD});
  const {lathe} = useMemo(() => domeGeos(false), []);
  return <mesh geometry={lathe} material={m} castShadow receiveShadow />;
};

const DomeCut: React.FC<{reveal: number}> = ({reveal}) => {
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, -1, 0), 99), []);
  plane.constant = reveal;
  const clip = useMemo(() => [plane], [plane]);
  const m = useMat('mud_plaster', {tint: MUD, clip, side: THREE.DoubleSide});
  const capM = useMat('mud_brick', {tint: '#e39a66', clip, side: THREE.DoubleSide, normalScale: 1.4});
  const {lathe, cap} = useMemo(() => domeGeos(true), []);
  return (
    <group>
      <mesh geometry={lathe} material={m} castShadow receiveShadow />
      <mesh geometry={cap!} position={[0, 0, 0.002]} material={capM} receiveShadow />
    </group>
  );
};

/** Pit interior for cutaway scenes: floor at -7, fill below it with a drain slot. */
const PitInterior: React.FC<{drain?: boolean}> = ({drain = false}) => {
  const floor = useMat('dirt', {tint: '#b49a80'});
  const side = useMat('tuff_strata', {tint: '#c49a74'});
  const grate = usePlainMat('#3b2c20', 0.9);
  const r = DOME.Ri;
  const yF = -DOME.pit;
  const fillH = 10.5 - DOME.pit;
  const boxL = useMemo(() => uvBox(r - 0.4, fillH, r, 4), [r, fillH]);
  const boxB = useMemo(() => uvBox(0.8, fillH, r - 0.8, 4), [r, fillH]);
  return (
    <group>
      <mesh position={[0, yF, 0]} rotation={[-Math.PI / 2, 0, 0]} material={floor} receiveShadow>
        <circleGeometry args={[r, 48, 0, Math.PI]} />
      </mesh>
      <mesh geometry={boxL} position={[-(r + 0.4) / 2, yF - 0.02 - fillH / 2, -r / 2]} material={side} receiveShadow />
      <mesh geometry={boxL} position={[(r + 0.4) / 2, yF - 0.02 - fillH / 2, -r / 2]} material={side} receiveShadow />
      <mesh geometry={boxB} position={[0, yF - 0.02 - fillH / 2, -0.8 - (r - 0.8) / 2]} material={side} receiveShadow />
      {drain && (
        <mesh position={[0, yF + 0.01, -0.4]} rotation={[-Math.PI / 2, 0, 0]} material={grate}>
          <planeGeometry args={[0.8, 0.8]} />
        </mesh>
      )}
    </group>
  );
};

// ============================================================ shade wall (mud brick, east–west, buttressed)
const ShadeWall: React.FC<{reveal: number}> = ({reveal}) => {
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, -1, 0), 99), []);
  plane.constant = reveal;
  const clip = useMemo(() => [plane], [plane]);
  const m = useMat('mud_brick', {tint: '#f2d8b8', clip});
  const geo = useMemo(() => {
    const L = WALL.x1 - WALL.x0;
    const s = new THREE.Shape();
    s.moveTo(-WALL.t0 / 2, 0);
    s.lineTo(WALL.t0 / 2, 0);
    s.lineTo(WALL.t1 / 2, WALL.h);
    s.lineTo(-WALL.t1 / 2, WALL.h);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, {depth: L, bevelEnabled: false});
    g.rotateY(Math.PI / 2);
    g.translate(WALL.x0, 0, WALL.z);
    return worldUV(g, 3);
  }, []);
  const butt = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(0, 0);
    s.lineTo(2.2, 0);
    s.lineTo(0, WALL.h * 0.78);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, {depth: 1.1, bevelEnabled: false});
    g.rotateY(-Math.PI / 2);
    return worldUV(g, 3);
  }, []);
  const bx = useMemo(() => Array.from({length: 9}, (_, i) => WALL.x0 + 0.6 + i * ((WALL.x1 - WALL.x0 - 1.2) / 8)), []);
  return (
    <group>
      <mesh geometry={geo} material={m} castShadow receiveShadow />
      {bx.map((x) => (
        <mesh key={x} geometry={butt} position={[x - 0.55, 0, WALL.z + WALL.t0 / 2 - 0.05]} material={m} castShadow receiveShadow />
      ))}
    </group>
  );
};

// ============================================================ pools (long shallow channels with mud kerbs)
const Pools: React.FC<{fill: number; freeze: number; f: number; hide0?: boolean}> = ({fill, freeze, f, hide0}) => {
  const kerb = useMat('mud_plaster', {tint: '#e8cdb0'});
  const iceM = useMat('ice', {tint: '#eaf6ff', roughness: 0.55, transparent: true, opacity: 0, envMapIntensity: 0.3, emissive: '#26486e', emissiveIntensity: 0.35});
  iceM.opacity = Math.min(1, freeze * 1.15);
  iceM.visible = freeze > 0.01;
  const kerbLong = useMemo(() => uvBox(56.8, 0.5, 0.4, 2), []);
  const kerbEnd = useMemo(() => uvBox(0.4, 0.5, 3.0, 2), []);
  return (
    <group>
      {POOLS.map((p, i) => {
        const L = p.x1 - p.x0;
        if (hide0 && i === 0) return null;
        return (
          <group key={i}>
            {[-1, 1].map((s) => (
              <mesh key={s} geometry={kerbLong} position={[0, 0.25, p.z + s * (p.w / 2 + 0.2)]} material={kerb} castShadow receiveShadow />
            ))}
            {[-1, 1].map((s) => (
              <mesh key={'e' + s} geometry={kerbEnd} position={[s * (L / 2 + 0.2), 0.25, p.z]} material={kerb} castShadow receiveShadow />
            ))}
            {fill > 0.01 && <Water w={L} d={p.w} position={[0, 0.02 + 0.38 * fill, p.z]} time={f / 30 + i} color="#4e9fb0" texScale={4} />}
            {freeze > 0.01 && (
              <mesh position={[0, 0.41 + 0.01, p.z]} rotation={[-Math.PI / 2, 0, 0]} material={iceM} receiveShadow>
                <planeGeometry args={[L, p.w]} />
              </mesh>
            )}
          </group>
        );
      })}
      {/* feeder channel from the qanat outlet */}
      <mesh position={[(QANAT_X + POOLS[0].x0) / 2 - 0.2, 0.25, POOLS[1].z]} material={kerb} castShadow receiveShadow geometry={useMemo(() => uvBox(Math.abs(POOLS[0].x0 - QANAT_X) + 0.4, 0.5, 0.4, 2), [])} />
    </group>
  );
};

// ============================================================ qanat: line of access-shaft mounds coming from the mountains
const QANAT_SHAFTS = Array.from({length: 13}, (_, i) => ({x: QANAT_X + Math.sin(i * 0.7) * 2, z: POOLS[1].z - 14 - i * 14}));
const Qanat: React.FC = () => {
  const dirt = useMat('dirt', {tint: '#d9b48c'});
  const hole = usePlainMat('#1d140d', 1);
  const g = useMemo(() => worldUV(new THREE.CylinderGeometry(0.9, 2.6, 1.3, 20, 1, true), 1.5), []);
  return (
    <group>
      {QANAT_SHAFTS.map((s, i) => (
        <group key={i} position={[s.x, 0, s.z]}>
          <mesh geometry={g} position={[0, 0.6, 0]} material={dirt} castShadow receiveShadow />
          <mesh position={[0, 1.2, 0]} rotation={[-Math.PI / 2, 0, 0]} material={hole}>
            <circleGeometry args={[0.92, 20]} />
          </mesh>
        </group>
      ))}
    </group>
  );
};

// ============================================================ scenery
const SCENERY = (() => {
  const out: {k: number; p: [number, number, number]; s: number; seed: number}[] = [];
  let i = 0;
  while (out.length < 34 && i < 3000) {
    i++;
    const x = (rnd(i * 3.3) - 0.5) * 360, z = (rnd(i * 5.7) - 0.5) * 360;
    if (x > -45 && x < 50 && z > -40 && z < 45) continue;
    if (Math.abs(x - QANAT_X) < 8 && z < -20) continue;
    if (z > 0 && Math.abs(x) < 200 && Math.abs(z) < 200 && rnd(i * 1.7) < 0.5) continue;
    out.push({k: rnd(i) < 0.25 ? 0 : rnd(i + 1) < 0.6 ? 1 : 2, p: [x, 0, z], s: 0.8 + rnd(i * 9) * 0.7, seed: i});
  }
  return out;
})();
const Scenery: React.FC = () => (
  <group>
    {SCENERY.map((t, i) =>
      t.k === 0 ? <PalmTree key={i} position={t.p} scale={t.s} seed={t.seed} /> :
      t.k === 1 ? <Bush key={i} position={t.p} scale={t.s * 0.7} seed={t.seed} color="#7c7a46" /> :
      <Rock key={i} position={[t.p[0], 0.2, t.p[2]]} scale={[t.s * 1.2, t.s * 0.6, t.s]} seed={t.seed} tex="stone_face_sand" />,
    )}
  </group>
);

// ============================================================ atmosphere (day -> night, golden)
const STAR_POS = (() => {
  const a = new Float32Array(900 * 3);
  for (let i = 0; i < 900; i++) {
    const u = rnd(i * 1.37), v = rnd(i * 2.71 + 4);
    const th = u * Math.PI * 2, ph = Math.acos(1 - v * 0.95);
    a[i * 3] = Math.sin(ph) * Math.cos(th) * 380;
    a[i * 3 + 1] = Math.cos(ph) * 380;
    a[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * 380;
  }
  return a;
})();
const Stars: React.FC<{opacity: number; at: [number, number, number]}> = ({opacity, at}) => {
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(STAR_POS, 3));
    return g;
  }, []);
  const m = useMemo(() => new THREE.PointsMaterial({color: '#ffffff', size: 2.6, sizeAttenuation: false, transparent: true, fog: false, depthWrite: false}), []);
  m.opacity = opacity;
  if (opacity <= 0.01) return null;
  return <points geometry={geo} material={m} position={at} frustumCulled={false} renderOrder={0} />;
};

const lerpC = (a: string, b: string, t: number) => new THREE.Color(a).lerp(new THREE.Color(b), t).getStyle();
const Atmos: React.FC<{f: number; cam: Cam; night?: number; golden?: number; shadowTarget?: [number, number, number]; shadowSize?: number}> = ({f, cam, night = 0, golden = 0, shadowTarget = [0, 0, -8], shadowSize = 48}) => {
  const n = night;
  const sunDir: [number, number, number] = golden ? [0.75, 0.3, 0.6] : n > 0.5 ? [-0.3, 0.8, -0.4] : SUN_DIR;
  const dayHor = lerpC('#e9d6b6', '#f4c48a', golden);
  const hor = lerpC(dayHor, '#26324f', n);
  const top = lerpC(lerpC('#2a66b8', '#3a63a6', golden), '#050a1c', n);
  const sunCol = lerpC(lerpC('#fff0d8', '#ffbb70', golden), '#9fb6e6', n);
  return (
    <>
      <Renderer exposure={1.0 - 0.15 * n + 0.08 * golden} envIntensity={0.55 * (1 - n * 0.82)} />
      <SkyDome top={top} horizon={hor} bottom={lerpC('#cbb08a', '#141a2a', n)} sunDir={sunDir} sunColor={n > 0.5 ? '#000000' : sunCol} clouds={0.18 * (1 - n)} time={f / 30} />
      <Stars opacity={smooth(0.45, 1, n)} at={cam.pos} />
      <Sun dir={sunDir} intensity={3.3 * (1 - n) + 1.2 * n} color={sunCol} shadowSize={shadowSize} shadowRes={4096} target={shadowTarget}
        skyColor={lerpC('#cfe0f2', '#5a72b0', n)} groundColor={lerpC('#b8996e', '#2a2a3a', n)} hemi={0.55 - 0.1 * n} />
      <fog attach="fog" args={[hor, 160 + 80 * golden, 720]} />
    </>
  );
};

// ============================================================ stage + pins
const Stage: React.FC<{cam: Cam; children: React.ReactNode; bg?: string}> = ({cam, children, bg = '#e9d6b6'}) => {
  const {width, height} = useVideoConfig();
  return (
    <AbsoluteFill style={{background: bg}}>
      <ThreeCanvas width={width} height={height} shadows camera={{fov: cam.fov, near: 0.3, far: 3000}}>
        <AssetProvider textures={TEXTURES} hdri="quarry_01_1k">
          <CameraRig pos={cam.pos} target={cam.target} fov={cam.fov} />
          {children}
        </AssetProvider>
      </ThreeCanvas>
      <Grade strength={0.3} />
    </AbsoluteFill>
  );
};

const Pin: React.FC<{p: [number, number, number]; cam: Cam; text: string; delay: number; dx?: number; dy?: number; size?: number; anchor?: 'left' | 'right' | 'center'; red?: boolean}> = ({p, cam, text, delay, dx = 0, dy = 0, size = 50, anchor = 'center', red}) => {
  const [x, y, vis] = toScreen(p, cam);
  if (!vis) return null;
  const w = text.length * size * 0.56 + size * 0.9;
  let lx = x + dx;
  const left = anchor === 'left' ? lx : anchor === 'right' ? lx - w : lx - w / 2;
  if (left < 36) lx += 36 - left;
  if (left + w > 1044) lx -= left + w - 1044;
  return <Tag text={text} x={lx} y={Math.min(1480, Math.max(440, y + dy))} delay={delay} size={size} anchor={anchor} bg={red ? C.red : C.yellow} fg={red ? C.white : C.ink} />;
};

// ============================================================ props
const IceBlock: React.FC<{position: [number, number, number]; size?: [number, number, number]; rot?: number; tex?: TexName}> = ({position, size = [1, 0.5, 0.8], rot = 0, tex = 'ice'}) => {
  const mat = useMat(tex, tex === 'ice' ? {tint: '#eaf6ff', roughness: 0.3} : {tint: '#f0d6b8'});
  const g = useMemo(() => uvBox(size[0], size[1], size[2], 1.2), [size]);
  return <mesh geometry={g} position={position} rotation={[0, rot, 0]} material={mat} castShadow receiveShadow />;
};

/** Glowing arrow (heat / air flow). */
const Arrow: React.FC<{from: [number, number, number]; dir: [number, number, number]; len: number; color: string; opacity: number; r?: number}> = ({from, dir, len, color, opacity, r = 0.12}) => {
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

/** Person carrying an ice block above the head. Walks if `walk` given. */
const Carrier: React.FC<{position: [number, number, number]; rotY: number; t: number; seed: number; walk?: boolean; load?: TexName}> = ({position, rotY, t, seed, walk, load = 'ice'}) => (
  <group position={position} rotation={[0, rotY, 0]}>
    <Person pose="carry" legs={walk ? 'walk' : 'still'} t={t} seed={seed} head="cloth" />
    <IceBlock position={[-0.05, 2.2, 0]} size={[0.6, 0.35, 0.75]} tex={load} />
  </group>
);

const DimBar: React.FC<{a: [number, number, number]; b: [number, number, number]}> = ({a, b}) => {
  const m = usePlainMat(C.yellow, 0.5, 0, {emissive: new THREE.Color('#b98a00'), emissiveIntensity: 0.6});
  const k = usePlainMat('#111111', 0.6);
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
  const mid = va.clone().add(vb).multiplyScalar(0.5);
  const len = va.distanceTo(vb);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
  return (
    <group>
      <mesh position={mid} quaternion={q} material={k}>
        <cylinderGeometry args={[0.13, 0.13, len, 8]} />
      </mesh>
      <mesh position={mid} quaternion={q} material={m}>
        <cylinderGeometry args={[0.09, 0.09, len + 0.02, 8]} />
      </mesh>
      {[va, vb].map((v, i) => (
        <mesh key={i} position={v} material={m}>
          <sphereGeometry args={[0.22, 12, 8]} />
        </mesh>
      ))}
    </group>
  );
};

// ============================================================ S1 hook: hole + ice, then the real thing
const S1: React.FC = () => {
  const f = useCurrentFrame();
  const cut = wordAt(0, "Here's");
  const melt = ramp(f, 10, cut, Easing.in(Easing.quad));
  const puddle = usePlainMat('#5b8fa0', 0.05, 0.1, {transparent: true, opacity: 0.8});
  const {x, z, d} = HOLE;
  const camA = camPath(f, [
    {t: 0, pos: [x + 4.5, 3.6, z + 6.5], target: [x, -0.9, z], fov: 50},
    {t: cut, pos: [x + 3.2, 2.7, z + 5.0], target: [x, -1.0, z], fov: 50},
  ]);
  const g = f - cut;
  const L2 = LEN[0] - cut;
  const camB = groundSafe(camPath(g, [
    {t: 0, pos: [20, 2.2, 31], target: [-1, 7.5, -3], fov: 52},
    {t: L2, pos: [25, 3.2, 35], target: [-2, 7.5, -4], fov: 52},
  ]), groundAt(false));
  const blocks: [number, number, number, number][] = [
    [-0.7, 0.25, -0.5, 0.3], [0.5, 0.25, -0.6, -0.2], [-0.2, 0.25, 0.6, 0.1], [0.75, 0.25, 0.55, 0.5], [0.0, 0.75, -0.1, 0.8], [-0.6, 0.75, 0.4, -0.4],
  ];
  const sc = 1 - 0.62 * melt;
  return (
    <>
      <Sequence durationInFrames={cut} layout="none">
        <Stage cam={camA}>
          <Atmos f={f} cam={camA} shadowTarget={[x, 0, z]} shadowSize={14} />
          <World f={f} />
          <group position={[x, -d, z]}>
            {blocks.map(([bx, by, bz, r], i) => (
              <IceBlock key={i} position={[bx, by * sc + 0.02, bz]} size={[0.9 * sc, 0.5 * sc, 0.75 * sc]} rot={r} />
            ))}
            <mesh position={[0, 0.015, 0]} rotation={[-Math.PI / 2, 0, 0]} material={puddle} scale={0.3 + 1.0 * melt}>
              <circleGeometry args={[1.5, 32]} />
            </mesh>
          </group>
          {[0, 1, 2].map((i) => (
            <Arrow key={i} from={[x - 0.8 + i * 0.8, -0.4 + ((f * 0.04 + i * 0.4) % 1.2), z]} dir={[0, 1, 0]} len={0.9} color="#ff8a2a" opacity={0.75 * ramp(f, 8, 20)} r={0.06} />
          ))}
          <Person position={[x - 1.95, 0, z - 1.0]} rotY={0} pose="point" seed={7} head="cloth" />
        </Stage>
        <Headline top="DIG A HOLE, ADD ICE..." big="SUMMER?" delay={4} y={150} bigSize={160} />
        <Tag text="NOT A CHANCE" x={540} y={1180} anchor="center" delay={wordAt(0, 'Not a')} size={66} bg={C.red} fg={C.white} />
      </Sequence>
      <Sequence from={cut} layout="none">
        <Stage cam={camB}>
          <Atmos f={f} cam={camB} />
          <World f={f} />
          <Person {...walkAlong([14, 0, 18], 2.6, g, 1.2)} seed={21} head="cloth" />
        </Stage>
        <Headline top="THE PERSIAN ICE PIT" big="YAKHCHAL" delay={2} y={150} bigSize={150} />
      </Sequence>
    </>
  );
};

// ============================================================ S2 qanat + pools
// qanat cutaway set: surface rises to the east (x>0); tunnel almost flat; outlet at x=0
const QS = {surf: (x: number) => (x <= 0 ? 0 : 0.16 * Math.min(x, 130)), floor: (x: number) => -0.45 + 0.004 * x, tunH: 2.0, slice: 1.4, x1: 300, vis: 95};
const QSHAFTS = [12, 26, 40, 54, 68, 82];
const qanatSetH = (x: number, z: number) => {
  const e = Math.max(Math.abs(x), Math.abs(z));
  const rise = smooth(270, 310, e);
  return -14.5 * (1 - rise) + rise * (8 + Math.sin(x * 0.02) * Math.cos(z * 0.017) * 6 + 60 * smooth(320, 440, -z));
};
const QanatSection: React.FC<{water: number; f: number}> = ({water, f}) => {
  const top = useMat('cracked_earth', {tint: '#f4e2c8'});
  const sec = useMat('tuff_strata', {tint: '#c49a74'});
  const mats = useMemo(() => [sec, top], [sec, top]);
  const waterM = usePlainMat('#3d9ec7', 0.08, 0.1, {emissive: new THREE.Color('#1a6f99'), emissiveIntensity: 0.35});
  const geos = useMemo(() => {
    const ex = (pts: [number, number][], depth: number, z0: number) => {
      const s = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
      const g = new THREE.ExtrudeGeometry(s, {depth, bevelEnabled: false});
      g.translate(0, 0, z0);
      return worldUV(g, 3);
    };
    const base = -14;
    const out: THREE.BufferGeometry[] = [];
    // lower piece (below tunnel floor)
    const lower: [number, number][] = [[-300, base], [QS.x1, base], [QS.x1, QS.floor(QS.x1)]];
    lower.push([0, QS.floor(0)], [0, 0], [-300, 0]);
    out.push(ex(lower, QS.slice, -QS.slice));
    // upper pieces between shafts (tunnel ceiling -> surface)
    const edges = [0.9, ...QSHAFTS.flatMap((s) => [s - 0.6, s + 0.6]), QS.x1];
    for (let i = 0; i < edges.length; i += 2) {
      const a = edges[i], b = edges[i + 1];
      const pts: [number, number][] = [[a, QS.floor(a) + QS.tunH], [b, QS.floor(b) + QS.tunH]];
      for (let x = b; x > a; x -= 10) pts.push([x, QS.surf(x)]);
      pts.push([a, QS.surf(a)]);
      out.push(ex(pts, QS.slice, -QS.slice));
    }
    // back block (tunnel back wall), full section behind the slice
    const back: [number, number][] = [[-300, base], [QS.x1, base], [QS.x1, QS.surf(QS.x1)], [130, QS.surf(130)], [0, 0], [-300, 0]];
    out.push(ex(back, 300, -QS.slice - 300));
    return out;
  }, []);
  const wx = QS.vis - water * QS.vis;
  return (
    <group>
      {geos.map((g, i) => (
        <mesh key={i} geometry={g} material={mats} castShadow receiveShadow />
      ))}
      {water > 0 && (
        <mesh position={[(wx + QS.x1) / 2, QS.floor((wx + QS.x1) / 2) + 0.22, -QS.slice / 2]} rotation={[0, 0, Math.atan(0.004)]} material={waterM}>
          <boxGeometry args={[QS.x1 - wx, 0.4, QS.slice - 0.02]} />
        </mesh>
      )}
      {water > 0.98 && <Water w={14} d={6} position={[-7, 0.05, -2.2]} time={f / 30} color="#4e9fb0" texScale={4} />}
      {QSHAFTS.map((s) => (
        <Rope key={s} a={[s - 0.3, QS.surf(s) + 2.2, -0.7]} b={[s - 0.3, QS.surf(s) - 3.5, -0.7]} sag={0} r={0.025} />
      ))}
      {QSHAFTS.map((s) => (
        <group key={'w' + s} position={[s, QS.surf(s), -0.7]}>
          <Beam a={[-0.9, 0, 0]} b={[-0.3, 2.3, 0]} r={0.06} square tex="wood_oak" />
          <Beam a={[0.3, 0, 0]} b={[-0.3, 2.3, 0]} r={0.06} square tex="wood_oak" />
        </group>
      ))}
    </group>
  );
};

const S2: React.FC = () => {
  const f = useCurrentFrame();
  const fixAt = wordAt(1, 'Fix');
  const cut = wordAt(1, 'On clear') - 6;
  const water = ramp(f, fixAt - 4, cut - 6, Easing.linear);
  const camA = camPath(f, [
    {t: 0, pos: [34, 8, 15], target: [66, 3.5, -1], fov: 54},
    {t: cut, pos: [-9, 4.5, 13], target: [16, 0.5, -1], fov: 54},
  ]);
  const g = f - cut;
  const L2 = LEN[1] - cut;
  const night = ramp(g, 4, L2 * 0.55);
  const fill = 1;
  const freeze = ramp(g, L2 * 0.5, L2 - 6);
  const camB = groundSafe(camPath(g, [
    {t: 0, pos: [36, 16, -2], target: [0, 0, -22], fov: 50},
    {t: L2, pos: [30, 11, -6], target: [2, 0, -22], fov: 50},
  ]), groundAt(false));
  return (
    <>
      <Sequence durationInFrames={cut} layout="none">
        <Stage cam={camA}>
          <Atmos f={f} cam={camA} shadowTarget={[40, 4, 0]} shadowSize={60} />
          <Terrain height={qanatSetH} size={900} seg={200} tex="sand" texScale={6} />
          <QanatSection water={water} f={f} />
          <Person position={[26.4, QS.surf(26.4), 0.6]} rotY={-1.9} pose="pull" seed={31} head="cloth" />
          <Person position={[54.5, QS.surf(54.5) + 0.0, -1.5]} rotY={-2.6} pose="stand" seed={32} head="cloth" />
          {[0, 1, 2].map((i) => <PalmTree key={i} position={[-8 - i * 5, 0, -6 - i * 3]} scale={0.9} seed={i + 70} />)}
        </Stage>
        <ProbFix n={1} problem="NO ICE" fix="QANAT CANAL" fixAt={fixAt} delay={3} />
        <Pin p={[70, QS.floor(70) + 0.8, 0]} cam={camA} text="UNDERGROUND CANAL" delay={fixAt + 8} dy={60} size={46} />
        <Pin p={[40, QS.surf(40) + 2.4, 0]} cam={camA} text="ACCESS SHAFT" delay={fixAt + 22} dy={-50} size={44} />
      </Sequence>
      <Sequence from={cut} layout="none">
        <Stage cam={camB} bg="#1a2033">
          <Atmos f={f} cam={camB} night={night} />
          <World f={f} showWall={0} showDome={0} pools={{fill, freeze}} />
        </Stage>
        <ProbFix n={1} problem="NO ICE" fix="SHALLOW POOLS" fixAt={0} delay={0} />
        <Pin p={[10, 0.5, POOLS[0].z]} cam={camB} text="SHALLOW POOLS" delay={6} dy={-60} size={48} />
        <Caption text="Clear winter nights: the water freezes" delay={Math.round(L2 * 0.45)} bottom={330} />
      </Sequence>
    </>
  );
};

// ============================================================ S3 the secret: the night sky
const PoolCut: React.FC<{xc: number; iceT: number; f: number}> = ({xc, iceT, f}) => {
  const P = POOLS[0];
  const waterM = useMat('water', {tint: '#7fd0f0', roughness: 0.1, envMapIntensity: 0.8, emissive: '#1d7fb0', emissiveIntensity: 0.55});
  waterM.normalMap!.offset.set(f * 0.0006, 0);
  const iceM = useMat('ice', {tint: '#ffffff', roughness: 0.4, envMapIntensity: 0.6, emissive: '#9cc8ec', emissiveIntensity: 0.55});
  const kerb = useMat('mud_plaster', {tint: '#e8cdb0'});
  const L = 40;
  const kerbG = useMemo(() => uvBox(L, 0.5, 0.4, 2), []);
  const waterG = useMemo(() => uvBox(L, 1, P.w - 0.01, 2), [P.w]);
  const iceG = useMemo(() => uvBox(L, 1, P.w - 0.005, 1.2), [P.w]);
  return (
    <group position={[xc - L / 2, 0, P.z]}>
      {[-1, 1].map((s) => <mesh key={s} geometry={kerbG} position={[0, 0.25, s * (P.w / 2 + 0.2)]} material={kerb} castShadow receiveShadow />)}
      <mesh geometry={waterG} position={[0, 0.2 - iceT / 2, 0]} scale={[1, 0.4 - iceT, 1]} material={waterM} />
      {iceT > 0.004 && <mesh geometry={iceG} position={[0, 0.4 - iceT / 2 + 0.003, 0]} scale={[1, iceT, 1]} material={iceM} castShadow />}
    </group>
  );
};

const S3: React.FC = () => {
  const f = useCurrentFrame();
  const L = LEN[2];
  const P = POOLS[0];
  const xc = 18;
  const iceT = 0.015 + ramp(f, L * 0.3, L - 8, Easing.linear) * 0.15;
  const cam = camPath(f, [
    {t: 0, pos: [xc + 6.5, 1.0, P.z + 0.9], target: [xc - 2.5, 2.1, P.z], fov: 50},
    {t: L, pos: [xc + 5.6, 1.0, P.z + 0.7], target: [xc - 2.5, 2.4, P.z], fov: 50},
  ]);
  return (
    <>
      <Stage cam={cam} bg="#121a2c">
        <Atmos f={f} cam={cam} night={1} shadowTarget={[xc, 0, P.z]} shadowSize={14} />
        <World f={f} showWall={0} showDome={0} pools={{fill: 1, freeze: 1}} hidePool0 />
        <PoolCut xc={xc} iceT={iceT} f={f} />
        {Array.from({length: 8}, (_, i) => {
          const ph = ((f * 0.022 + i * 0.37) % 1);
          return <Arrow key={i} from={[xc - 0.5 - (i % 4) * 1.3, 0.6 + ph * 5.0, P.z - 0.8 + (i % 2) * 1.4]} dir={[0, 1, 0]} len={1.1} color="#ff9a3c" opacity={0.85 * Math.sin(ph * Math.PI) * ramp(f, 6, 18)} r={0.07} />;
        })}
      </Stage>
      <Headline top="THE SECRET" big="NIGHT SKY" delay={3} y={150} bigSize={140} />
      <Pin p={[xc - 2.0, 3.6, P.z]} cam={cam} text="HEAT ESCAPES TO SPACE" delay={wordAt(2, 'soaks') } size={44} />
      <Tag text="AIR: JUST ABOVE 0°C" x={540} y={1040} anchor="center" delay={wordAt(2, 'even')} size={50} />
      <Pin p={[xc, 0.4, P.z + 0.6]} cam={cam} text="ICE FORMS" delay={Math.round(L * 0.55)} dy={90} size={50} />
    </>
  );
};

// ============================================================ S4 the sun -> shade wall, ice harvest
const S4: React.FC = () => {
  const f = useCurrentFrame();
  const L = LEN[3];
  const fixAt = wordAt(3, 'Fix');
  const harvestAt = wordAt(3, 'The ice');
  const wallT = ramp(f, fixAt, harvestAt - 6, Easing.inOut(Easing.quad));
  const cam = groundSafe(camPath(f, [
    {t: 0, pos: [44, 26, -52], target: [4, 2, -20], fov: 52},
    {t: harvestAt, pos: [40, 22, -50], target: [4, 3, -19], fov: 52},
    {t: L, pos: [19, 5.5, -35], target: [10, 1, -21], fov: 52},
  ]), groundAt(false));
  const P = POOLS;
  return (
    <>
      <Stage cam={cam}>
        <Atmos f={f} cam={cam} />
        <World f={f} showWall={Math.max(0.001, wallT)} showDome={0} pools={{fill: 1, freeze: 1}} />
        {wallT < 1 && wallT > 0 && (
          <>
            <ScaffoldBay position={[-6, 0, WALL.z - WALL.t0 / 2 - 1.4]} w={4} d={1.2} h={Math.max(1.5, wallT * WALL.h)} levels={4} />
            <ScaffoldBay position={[10, 0, WALL.z - WALL.t0 / 2 - 1.4]} w={4} d={1.2} h={Math.max(1.5, wallT * WALL.h)} levels={4} />
            <Person position={[-4.5, wallT * WALL.h * 0.75 + 0.1, WALL.z - WALL.t0 / 2 - 0.8]} rotY={Math.PI / 2} pose="hammer" t={f * 0.25} seed={41} head="cloth" />
            <Person position={[11.5, wallT * WALL.h * 0.75 + 0.1, WALL.z - WALL.t0 / 2 - 0.8]} rotY={Math.PI / 2} pose="carry" t={0} seed={42} head="cloth" />
            <Dust at={[-4.2, wallT * WALL.h, WALL.z - 0.4]} f={f} />
          </>
        )}
        {/* harvest: workers on the ice cutting and carrying blocks */}
        {f >= harvestAt - 10 && (
          <>
            <Person position={[8, 0.42, P[0].z]} rotY={0.3} pose="chisel" t={f * 0.2} seed={43} head="cloth" />
            <Person position={[13, 0.42, P[1].z]} rotY={2.8} pose="chisel" t={f * 0.2 + 1} seed={44} head="cloth" />
            <IceBlock position={[9.2, 0.62, P[0].z]} size={[0.8, 0.35, 0.9]} />
            <IceBlock position={[11.8, 0.62, P[1].z + 0.4]} size={[0.8, 0.35, 0.9]} rot={0.4} />
            <Carrier {...walkAlong([18, 0, P[0].z + 3.6], Math.PI * 0.55, f - harvestAt, 1.1)} seed={45} walk />
            <Carrier {...walkAlong([20.5, 0, P[1].z + 3.8], Math.PI * 0.62, f - harvestAt + 18, 1.1)} seed={46} walk />
          </>
        )}
        <DimBar a={[WALL.x1 - 8, 0.1, WALL.z - 1.3]} b={[WALL.x1 - 8, WALL.h * Math.max(0.02, wallT), WALL.z - 1.3]} />
      </Stage>
      <ProbFix n={2} problem="THE SUN" fix="A SHADE WALL" fixAt={fixAt} delay={3} />
      {f > fixAt + 4 && <Pin p={[WALL.x1 - 8, WALL.h * wallT, WALL.z - 1.3]} cam={cam} text="UP TO 10 M" delay={fixAt + 20} dy={-60} size={48} />}
      <Pin p={[-10, WALL.h * Math.max(0.3, wallT), WALL.z]} cam={cam} text="EAST–WEST" delay={wordAt(3, 'running')} dy={-70} size={46} />
      <Caption text="Ice is cut before sunrise" delay={harvestAt} bottom={330} />
    </>
  );
};

// ============================================================ S5 heat seeps in -> thick sarooj walls (cutaway)
const MortarPit: React.FC<{position: [number, number, number]; f: number}> = ({position, f}) => {
  const mud = useMat('mud_plaster', {tint: '#c9a27c'});
  const kerb = useMat('mud_brick', {tint: '#f0d6b8'});
  const kG = useMemo(() => uvBox(3.2, 0.5, 0.3, 2), []);
  const kG2 = useMemo(() => uvBox(0.3, 0.5, 2.0, 2), []);
  return (
    <group position={position}>
      <mesh position={[0, 0.18, 0]} rotation={[-Math.PI / 2, 0, 0]} material={mud} receiveShadow>
        <planeGeometry args={[3.0, 1.8]} />
      </mesh>
      {[-1, 1].map((s) => <mesh key={s} geometry={kG} position={[0, 0.25, s * 1.0]} material={kerb} castShadow receiveShadow />)}
      {[-1, 1].map((s) => <mesh key={'e' + s} geometry={kG2} position={[s * 1.6, 0.25, 0]} material={kerb} castShadow receiveShadow />)}
      <Person position={[-0.6, 0.15, 0.1]} rotY={0.2} pose="push" seed={51} head="cloth" />
      <Beam a={[0.2, 1.25, 0.1]} b={[0.9, 0.1, 0.1]} r={0.04} tex="wood_oak" />
      <Dust at={[0.8, 0.3, 0.1]} f={f} color="#b89a76" />
    </group>
  );
};

const CUT_CAM_BASE = {pos: [0, 4.5, 41] as [number, number, number], target: [0, 3.2, 0] as [number, number, number]};

const S5: React.FC = () => {
  const f = useCurrentFrame();
  const L = LEN[4];
  const fixAt = wordAt(4, 'Fix');
  const thickAt = wordAt(4, 'at least');
  const reveal = ramp(f, fixAt, L - 10, Easing.inOut(Easing.quad)) * 6.5;
  const heatIn = 1 - ramp(f, fixAt + 10, fixAt + 40);
  const cam = camPath(f, [
    {t: 0, pos: [16, 9, 36], target: [0, 0, 0], fov: 52},
    {t: L, pos: [9, 5, 39], target: [0, 1.5, 0], fov: 52},
  ]);
  const goat = wordAt(4, 'goat');
  return (
    <>
      <Stage cam={cam}>
        <Atmos f={f} cam={cam} shadowTarget={[0, 0, -6]} />
        <World cut f={f} showWall={1} showDome={reveal > 0.05 ? reveal / DOME.H : 0} pools={{fill: 1, freeze: 1}} />
        <PitInterior />
        {/* heat arrows pushing into the bare pit before the walls exist */}
        {[-5, -2.5, 0, 2.5, 5].map((x, i) => (
          <Arrow key={i} from={[x * 1.6 + (x > 0 ? 3 : -3), 5 - ((f * 0.05 + i * 0.3) % 1.4) * 3, -2]} dir={[x > 0 ? -0.6 : 0.6, -1, 0]} len={1.6} color="#ff7a20" opacity={0.85 * heatIn} r={0.12} />
        ))}
        <MortarPit position={[13.5, 0, -6]} f={f} />
        <Carrier {...walkAlong([12, 0, -9.5], Math.PI * 0.95, f, 0.9)} seed={52} walk load="mud_brick" />
        <ScaffoldBay position={[-DOME.R0 - 1.6, 0, -4]} w={1.3} d={1.3} h={Math.max(1.5, reveal + 0.5)} levels={3} rotY={0} />
        <Person position={[-DOME.R0 - 1.0, Math.max(0, reveal - 1.5), -3.3]} rotY={0} pose="hammer" t={f * 0.24} seed={53} head="cloth" />
        {f > thickAt - 8 && <DimBar a={[DOME.Ri + 0.05, 0.45, 0.25]} b={[DOME.R0 + 0.1, 0.45, 0.25]} />}
      </Stage>
      <ProbFix n={3} problem="HEAT SEEPS IN" fix="SAROOJ WALLS" fixAt={fixAt} delay={3} />
      <Pin p={[13.5, 0.8, -6]} cam={cam} text="SAND · CLAY · LIME · ASH" delay={wordAt(4, 'sand')} dy={-150} size={42} />
      <Pin p={[13.5, 0.8, -6]} cam={cam} text="+ GOAT HAIR · EGG WHITE" delay={goat} dy={-75} size={42} />
      {f > thickAt - 8 && <Pin p={[(DOME.Ri + DOME.R0) / 2, 0.5, 0.25]} cam={cam} text="2 M THICK" delay={thickAt} dy={90} size={54} />}
    </>
  );
};

// ============================================================ S6 hot air trapped -> tall cone, air flow
const AIR = Array.from({length: 26}, (_, i) => ({ph: rnd(i * 3.1), x: (rnd(i * 5.3) - 0.5) * 2, warm: i % 2 === 0, side: rnd(i * 7.7) < 0.5 ? -1 : 1}));
const AirFlow: React.FC<{f: number; amt: number}> = ({f, amt}) => {
  const warm = useMemo(() => new THREE.MeshBasicMaterial({color: '#ff8c2e', transparent: true, depthWrite: false, fog: false, toneMapped: false}), []);
  const cold = useMemo(() => new THREE.MeshBasicMaterial({color: '#58c4ff', transparent: true, depthWrite: false, fog: false, toneMapped: false}), []);
  warm.opacity = 0.9 * amt;
  cold.opacity = 0.9 * amt;
  if (amt <= 0.01) return null;
  return (
    <group>
      {AIR.map((a, i) => {
        const t = (a.ph + f * 0.011) % 1;
        let p: [number, number, number];
        if (a.warm) {
          // rise up the middle and out of the top hole
          const y = -3 + t * 22;
          const r = y < DOME.Hi ? rIn(Math.max(0, y)) * 0.25 * a.x : 0.3 * a.x;
          p = [r, y, -0.8];
        } else {
          // sink down along the inner wall into the pit
          const y = 13 - t * 18.5;
          const r = y > 0 ? (rIn(y) - 0.8) * a.side : (DOME.Ri - 1.5) * a.side;
          p = [r, y, -0.8];
        }
        const o = Math.sin(t * Math.PI);
        return (
          <mesh key={i} position={p} material={a.warm ? warm : cold} scale={0.5 * (0.4 + 0.6 * o)}>
            <sphereGeometry args={[1, 10, 8]} />
          </mesh>
        );
      })}
    </group>
  );
};

const S6: React.FC = () => {
  const f = useCurrentFrame();
  const L = LEN[5];
  const fixAt = wordAt(5, 'Fix');
  const reveal = 6.5 + ramp(f, fixAt - 6, wordAt(5, 'Warm') - 4) * (DOME.H + 0.5 - 6.5);
  const airAmt = ramp(f, wordAt(5, 'Warm') - 6, wordAt(5, 'Warm') + 10);
  const trapped = 1 - ramp(f, fixAt - 4, fixAt + 10);
  const cam = camPath(f, [
    {t: 0, pos: [9, 5, 39], target: [0, 1.5, 0], fov: 52},
    {t: fixAt + 20, pos: [4, 6, 44], target: [0, 4.5, 0], fov: 52},
    {t: L, pos: [1, 6.5, 44], target: [0, 5, 0], fov: 52},
  ]);
  return (
    <>
      <Stage cam={cam}>
        <Atmos f={f} cam={cam} shadowTarget={[0, 4, -6]} />
        <World cut f={f} showWall={1} showDome={reveal / DOME.H} pools={{fill: 1, freeze: 1}} />
        <PitInterior />
        <AirFlow f={f} amt={airAmt} />
        {/* trapped hot air: swirling orange blobs under a low lid */}
        {trapped > 0.01 && [0, 1, 2, 3, 4].map((i) => (
          <Arrow key={i} from={[Math.sin(f * 0.08 + i * 1.3) * 3.5, 1 + (i % 3) * 1.2, -1]} dir={[Math.cos(f * 0.08 + i), 0.3, 0]} len={1.4} color="#ff6a1a" opacity={0.85 * trapped} r={0.12} />
        ))}
        <ScaffoldBay position={[-DOME.R0 - 1.6, 0, -4]} w={1.3} d={1.3} h={Math.min(10, reveal * 0.62)} levels={4} />
      </Stage>
      <ProbFix n={4} problem="HOT AIR TRAPPED" fix="A TALL CONE" fixAt={fixAt} delay={3} />
      <Pin p={[0, DOME.H + 1, -0.5]} cam={cam} text="HOT AIR OUT" delay={wordAt(5, 'escapes')} dy={-40} size={48} />
      <Pin p={[-(DOME.Ri - 2), 1.0, -0.8]} cam={cam} text="COLD AIR SINKS" delay={wordAt(5, 'cold air')} dy={40} size={46} />
    </>
  );
};

// ============================================================ S7 melting/sticking -> straw layers + drain
const LAYER_H = 0.55, STRAW_H = 0.2;
const ICE_CELLS = (() => {
  const out: {x: number; z: number; k: number}[] = [];
  const r = DOME.Ri - 0.25;
  for (let k = 0; k < 8; k++)
    for (let x = -r + 0.55; x < r; x += 1.12)
      for (let z = -0.45; z > -r; z -= 0.92) if (Math.hypot(x, z) < r - 0.55) out.push({x: x + (k % 2) * 0.25, z, k});
  return out;
})();
const IceStack: React.FC<{layers: number}> = ({layers}) => {
  const iceM = useMat('ice', {tint: '#eaf6ff', roughness: 0.3});
  const strawM = useMat('straw', {tint: '#e8c070'});
  const ref = React.useRef<THREE.InstancedMesh>(null);
  const g = useMemo(() => uvBox(1.04, LAYER_H, 0.86, 1.2), []);
  const strawG = useMemo(() => worldUV(new THREE.CylinderGeometry(DOME.Ri - 0.05, DOME.Ri - 0.05, STRAW_H, 48, 1, false, Math.PI / 2, Math.PI), 1.5), []);
  const yF = -DOME.pit;
  React.useLayoutEffect(() => {
    const o = new THREE.Object3D();
    let n = 0;
    ICE_CELLS.forEach((c) => {
      const lk = layers - c.k; // 0..1 arriving
      if (lk <= 0) return;
      const drop = (1 - Easing.out(Easing.cubic)(Math.min(1, lk))) * 2.5;
      o.position.set(c.x, yF + c.k * (LAYER_H + STRAW_H) + LAYER_H / 2 + drop, c.z);
      o.updateMatrix();
      ref.current!.setMatrixAt(n++, o.matrix);
    });
    ref.current!.count = n;
    ref.current!.instanceMatrix.needsUpdate = true;
  });
  return (
    <group>
      <instancedMesh ref={ref} args={[g, iceM, ICE_CELLS.length]} castShadow receiveShadow />
      {Array.from({length: 8}, (_, k) => {
        const s = layers - k - 1.0;
        if (s <= 0) return null;
        return <mesh key={k} geometry={strawG} position={[0, yF + (k + 1) * (LAYER_H + STRAW_H) - STRAW_H / 2, 0]} scale={[1, Math.min(1, s * 4), 1]} material={strawM} receiveShadow />;
      })}
    </group>
  );
};

const S7: React.FC = () => {
  const f = useCurrentFrame();
  const L = LEN[6];
  const fixAt = wordAt(6, 'Fix');
  const drainAt = wordAt(6, 'and a drain');
  const layers = ramp(f, 4, drainAt - 4, Easing.linear) * 7.2;
  const waterM = usePlainMat('#3d9ec7', 0.08, 0.1, {emissive: new THREE.Color('#1a6f99'), emissiveIntensity: 0.45});
  const dripM = usePlainMat('#7fd0ff', 0.1, 0, {emissive: new THREE.Color('#2a8fd0'), emissiveIntensity: 0.8});
  const drainOn = ramp(f, drainAt - 4, drainAt + 12);
  const cam = camPath(f, [
    {t: 0, pos: [4, 1.5, 27], target: [0, -2.8, -2], fov: 50},
    {t: drainAt, pos: [3, 0.0, 25], target: [0, -4.0, -2], fov: 50},
    {t: L, pos: [1.5, -2.5, 20], target: [0, -5.8, -2], fov: 50},
  ]);
  return (
    <>
      <Stage cam={cam}>
        <Atmos f={f} cam={cam} shadowTarget={[0, -3, -3]} shadowSize={30} />
        <World cut f={f} showWall={1} showDome={1} pools={{fill: 1, freeze: 0}} />
        <PitInterior drain />
        <IceStack layers={layers} />
        {drainOn > 0 && (
          <>
            <mesh position={[0, -DOME.pit - 1.7, -0.4]} material={waterM} scale={[1, drainOn, 1]}>
              <boxGeometry args={[0.6, 3.4, 0.79]} />
            </mesh>
            {[0, 1, 2, 3].map((i) => {
              const t = (f * 0.06 + i * 0.25) % 1;
              return (
                <mesh key={i} position={[-0.1 + (i % 2) * 0.2, -DOME.pit - t * 3.2, 0.05]} material={dripM} scale={0.09 * drainOn}>
                  <sphereGeometry args={[1, 8, 6]} />
                </mesh>
              );
            })}
          </>
        )}
      </Stage>
      <ProbFix n={5} problem="MELTING + STICKING" fix="STRAW + DRAIN" fixAt={fixAt} delay={3} />
      <Pin p={[3.5, -DOME.pit + 2 * (LAYER_H + STRAW_H) - 0.05, 0]} cam={cam} text="STRAW LAYERS" delay={wordAt(6, 'layers of straw')} dx={60} size={46} anchor="left" />
      <Pin p={[0, -DOME.pit - 2, 0]} cam={cam} text="MELTWATER DRAIN" delay={drainAt + 4} dy={40} size={46} />
    </>
  );
};

// ============================================================ S8 payoff
const S8: React.FC = () => {
  const f = useCurrentFrame();
  const L = LEN[7];
  const a = interpolate(f, [0, L], [0.35, 0.75]);
  const R = interpolate(f, [0, L], [62, 72]);
  const cam = groundSafe({pos: [Math.sin(a) * R, 10 + f * 0.02, Math.cos(a) * R - 6], target: [0, 6, -8], fov: 50} as Cam, groundAt(false), 3);
  return (
    <>
      <Stage cam={cam} bg="#f4c48a">
        <Atmos f={f} cam={cam} golden={1} shadowSize={60} />
        <World f={f} pools={{fill: 1, freeze: 1}} />
        <Person {...walkAlong([18, 0, 14], 2.5, f, 1.1)} seed={81} head="cloth" />
        <Carrier {...walkAlong([21, 0, 16.5], 2.5, f + 20, 1.1)} seed={82} walk />
      </Stage>
      <Headline top="ICE ALL SUMMER" big="0 WATTS" sub="water + shade + night sky" delay={4} y={150} bigSize={150} />
      <Caption text="Filled in winter, opened in summer" delay={Math.round(L * 0.35)} bottom={330} />
    </>
  );
};

// ============================================================ timeline
const SCENES = [S1, S2, S3, S4, S5, S6, S7, S8];

export const Yakhchal: React.FC = () => (
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
        <Audio src={staticFile(`vo/ep005-yakhchal_${i}.wav`)} />
      </Sequence>
    ))}
    <Watermark />
  </AbsoluteFill>
);

export const YAKHCHAL_START = START;
export const YAKHCHAL_LEN = LEN;
