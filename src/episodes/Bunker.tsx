// Episode 8 (Format B): Backyard hole -> real underground shelter (walls, water, air, radiation, door).
// Look: modern suburban garden, late-afternoon autumn light, grey concrete / black membrane / hi-vis workers.
import React, {useEffect, useMemo} from 'react';
import {AbsoluteFill, Audio, interpolate, Sequence, staticFile, useCurrentFrame, useVideoConfig, Easing} from 'remotion';
import {ThreeCanvas} from '@remotion/three';
import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import VO from './ep008-bunker-vo.json';
import {AssetProvider, Renderer, SkyDome, Sun, TexName, useMat, usePlainMat, uvBox, worldUV} from '../hib/pbr';
import {Beam, Bush, Dust, KIT_TEXTURES, Person, Plank, Rock, Tree, House, rnd, walkAlong} from '../hib/models';
import {CameraRig} from '../hib/three';
import {Cam, camPath, groundSafe, toScreen} from '../hib/project';
import {C, Caption, Grade, Headline, ProbFix, SceneFade, Tag, Watermark} from '../hib/ui';

// ============================================================ timing
const FPS = 30;
const VO_DELAY = 5;
const sceneLen = (i: number, tail: number) => Math.ceil((VO.durations[i] + tail) * FPS) + VO_DELAY;
const LEN = [sceneLen(0, 0.35), sceneLen(1, 0.35), sceneLen(2, 0.35), sceneLen(3, 0.35), sceneLen(4, 0.35), sceneLen(5, 0.35), sceneLen(6, 0.35), sceneLen(7, 1.2)];
const START = LEN.map((_, i) => LEN.slice(0, i).reduce((a, b) => a + b, 0));
export const BUNKER_DURATION = LEN.reduce((a, b) => a + b, 0);
/** frame (local to scene i) at which word `w` is spoken (estimated from character position). */
const wordAt = (i: number, w: string) => {
  const k = VO.lines[i].indexOf(w);
  if (k < 0) throw new Error(`word "${w}" not in line ${i}`);
  return Math.round(VO_DELAY + (k / VO.lines[i].length) * VO.durations[i] * FPS);
};

const cl = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
const ramp = (f: number, a: number, b: number, ease = Easing.inOut(Easing.cubic)) => interpolate(f, [a, b], [0, 1], {...cl, easing: ease});

const TEXTURES: TexName[] = [
  ...KIT_TEXTURES, 'lawn_autumn', 'loam_section', 'dirt', 'gravel', 'concrete', 'concrete_formed', 'membrane', 'steel', 'steel_rusty',
  'iron_dark', 'plaster_white', 'plaster_ochre', 'brick_red', 'roof_tiles', 'stone_face_grey',
];

// ============================================================ layout (metres). +z = toward the camera (south), house to the north.
type Rect = {x0: number; x1: number; z0: number; z1: number; d: number};
const PIT: Rect = {x0: -4.2, x1: 5.2, z0: -3, z1: 3, d: 3.8};
const HOLE: Rect = {x0: -1.0, x1: 1.0, z0: -0.75, z1: 0.75, d: 1.2};
const BX = {x0: -2.9, x1: 2.9, z0: -1.6, z1: 1.6, yb: -3.6, fl: -3.35, ci: -1.15, yt: -0.9, t: 0.25};
const SH = {x0: 3.4, x1: 5.0, z0: -0.8, z1: 0.8, top: 0.35, t: 0.2};
const DOOR = {z: 0.6, top: -1.35};
const VENTS = [{x: -1.6, z: -0.9}, {x: 1.4, z: -0.9}];
const MEM = 0.07;
const COVER0 = BX.yt + MEM; // top of the membrane on the roof (-0.87)
const BAND = -COVER0 / 10; // 10 halving layers of ~9 cm
const DEEP = -14;

const SUN_DIR: [number, number, number] = [-0.62, 0.5, 0.62];
const SUN_GOLD: [number, number, number] = [-0.75, 0.3, 0.58];

/** ground height for the camera guard. */
const groundH = (cut: boolean, pit: Rect) => (x: number, z: number) => {
  if (cut && z > 0 && Math.abs(x) < 200) return DEEP;
  if (x > pit.x0 && x < pit.x1 && z > pit.z0 && z < pit.z1) return -pit.d;
  return 0;
};

// ============================================================ generic pieces
/** Axis-aligned textured box from extents (world-scaled UVs). Geometry is rebuilt when the size changes. */
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

/** Ground material with large-scale colour variation (like pbr Ground). */
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

/** Glowing arrow (water / air / heat flow). */
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

/** Straight glowing beam segment (gamma rays). */
const Beam3: React.FC<{a: [number, number, number]; b: [number, number, number]; opacity: number; r?: number; color?: string}> = ({a, b, opacity, r = 0.035, color = '#d8ff3a'}) => {
  const m = useMemo(() => new THREE.MeshBasicMaterial({color, transparent: true, depthWrite: false, fog: false, toneMapped: false}), [color]);
  m.opacity = opacity;
  if (opacity <= 0.01) return null;
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
  const mid = va.clone().add(vb).multiplyScalar(0.5);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
  return (
    <mesh position={mid} quaternion={q} material={m}>
      <cylinderGeometry args={[r, r, va.distanceTo(vb), 8]} />
    </mesh>
  );
};

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
        <cylinderGeometry args={[0.05, 0.05, len, 8]} />
      </mesh>
      <mesh position={mid} quaternion={q} material={m}>
        <cylinderGeometry args={[0.032, 0.032, len + 0.01, 8]} />
      </mesh>
      {[va, vb].map((v, i) => (
        <mesh key={i} position={v} rotation={[0, 0, Math.PI / 2]} material={m}>
          <cylinderGeometry args={[0.03, 0.03, 0.35, 8]} />
        </mesh>
      ))}
    </group>
  );
};

// ============================================================ the garden
const FenceRun: React.FC<{x: number; z0: number; z1: number}> = ({x, z0, z1}) => {
  const m = useMat('wood_pine', {tint: '#c9a27a'});
  const post = useMat('wood_oak', {tint: '#8a6a4a'});
  const geo = useMemo(() => {
    const parts: THREE.BufferGeometry[] = [];
    for (let z = z0; z < z1 - 0.1; z += 0.16) {
      const h = 1.8 + (Math.floor((z - z0) / 0.16) % 2) * 0.04;
      const g = uvBox(0.03, h, 0.14, 1.2);
      g.translate(x, h / 2, z + 0.07);
      parts.push(g);
    }
    return mergeGeometries(parts);
  }, [x, z0, z1]);
  const posts = useMemo(() => {
    const parts: THREE.BufferGeometry[] = [];
    for (let z = z0; z <= z1; z += 2.4) {
      const g = uvBox(0.1, 1.9, 0.1, 1);
      g.translate(x + (x > 0 ? 0.07 : -0.07), 0.95, z);
      parts.push(g);
    }
    return mergeGeometries(parts);
  }, [x, z0, z1]);
  return (
    <>
      <mesh geometry={geo} material={m} castShadow receiveShadow />
      <mesh geometry={posts} material={post} castShadow receiveShadow />
    </>
  );
};

const ModernHouse: React.FC<{position: [number, number, number]}> = ({position}) => {
  const W = 12, H = 6.4, D = 8;
  const wall = useMat('plaster_white', {tint: '#f2eee6'});
  const roof = useMat('roof_tiles', {tint: '#6f7378'});
  const deck = useMat('wood_oak', {tint: '#b08a64'});
  const glass = usePlainMat('#2a3440', 0.08, 0.4, {envMapIntensity: 1.6});
  const warm = usePlainMat('#ffcf8a', 0.6, 0, {emissive: new THREE.Color('#ffb25a'), emissiveIntensity: 0.55});
  const frame = usePlainMat('#3a3d42', 0.5, 0.3);
  const body = useMemo(() => uvBox(W, H, D, 3), []);
  const roofGeo = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(-D / 2 - 0.5, 0);
    s.lineTo(D / 2 + 0.5, 0);
    s.lineTo(0, 2.6);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, {depth: W + 0.6, bevelEnabled: false});
    g.translate(0, 0, -(W + 0.6) / 2);
    g.rotateY(Math.PI / 2);
    return worldUV(g, 2.2);
  }, []);
  const win = (x: number, y: number, w: number, h: number, lit = false) => (
    <group key={`${x}_${y}`} position={[x, y, D / 2 + 0.02]}>
      <mesh material={frame}>
        <boxGeometry args={[w + 0.16, h + 0.16, 0.06]} />
      </mesh>
      <mesh position={[0, 0, 0.035]} material={lit ? warm : glass}>
        <boxGeometry args={[w, h, 0.02]} />
      </mesh>
      <mesh position={[0, 0, 0.05]} material={frame}>
        <boxGeometry args={[0.05, h, 0.02]} />
      </mesh>
    </group>
  );
  return (
    <group position={position}>
      <mesh geometry={body} position={[0, H / 2, 0]} material={wall} castShadow receiveShadow />
      <mesh geometry={roofGeo} position={[0, H, 0]} material={roof} castShadow receiveShadow />
      {win(-3.4, 1.4, 3.2, 2.2)}
      {win(1.2, 1.25, 2.0, 2.5, true)}
      {win(4.2, 1.6, 1.6, 1.6)}
      {win(-3.6, 4.6, 1.6, 1.3)}
      {win(0, 4.6, 1.6, 1.3, true)}
      {win(3.6, 4.6, 1.6, 1.3)}
      <mesh geometry={useMemo(() => uvBox(W + 1, 0.22, 3, 2), [])} position={[0, 0.11, D / 2 + 1.5]} material={deck} castShadow receiveShadow />
    </group>
  );
};

const Shed: React.FC<{position: [number, number, number]; rotY?: number}> = ({position, rotY = 0}) => {
  const wood = useMat('wood_pine', {tint: '#7d8f6a', rotation: Math.PI / 2});
  const roof = useMat('iron_dark', {tint: '#5a5550'});
  const body = useMemo(() => uvBox(2.6, 2.1, 2.0, 1.5), []);
  return (
    <group position={position} rotation={[0, rotY, 0]}>
      <mesh geometry={body} position={[0, 1.05, 0]} material={wood} castShadow receiveShadow />
      <mesh position={[0, 2.25, 0]} rotation={[0.12, 0, 0]} material={roof} castShadow>
        <boxGeometry args={[3.0, 0.08, 2.5]} />
      </mesh>
      <mesh position={[0.4, 0.95, 1.01]} material={roof}>
        <boxGeometry args={[0.9, 1.8, 0.03]} />
      </mesh>
    </group>
  );
};

const Excavator: React.FC<{position: [number, number, number]; rotY?: number; dig?: number}> = ({position, rotY = 0, dig = 0}) => {
  const yellow = usePlainMat('#e8a417', 0.45, 0.25);
  const dark = useMat('iron_dark', {tint: '#4a4a4a'});
  const glass = usePlainMat('#203040', 0.1, 0.3, {transparent: true, opacity: 0.7});
  const steel = useMat('steel', {tint: '#8a8a8a'});
  const a1 = -0.55 + 0.15 * Math.sin(dig);
  const a2 = 1.25 + 0.2 * Math.sin(dig + 0.6);
  return (
    <group position={position} rotation={[0, rotY, 0]}>
      {[-0.85, 0.85].map((z) => (
        <group key={z} position={[0, 0.3, z]}>
          <mesh material={dark} castShadow receiveShadow>
            <boxGeometry args={[2.6, 0.5, 0.45]} />
          </mesh>
          {[-1.3, 1.3].map((x) => (
            <mesh key={x} position={[x, 0, 0]} rotation={[Math.PI / 2, 0, 0]} material={dark} castShadow>
              <cylinderGeometry args={[0.25, 0.25, 0.45, 14]} />
            </mesh>
          ))}
        </group>
      ))}
      <mesh position={[0, 0.65, 0]} material={dark}>
        <cylinderGeometry args={[0.7, 0.7, 0.2, 18]} />
      </mesh>
      <mesh position={[-0.3, 1.05, 0]} material={yellow} castShadow receiveShadow>
        <boxGeometry args={[2.2, 0.65, 1.6]} />
      </mesh>
      <mesh position={[-1.2, 1.2, 0]} material={yellow} castShadow>
        <boxGeometry args={[0.6, 0.8, 1.6]} />
      </mesh>
      <group position={[0.15, 1.38, 0.35]}>
        <mesh position={[0, 0.65, 0]} material={yellow} castShadow>
          <boxGeometry args={[1.1, 0.08, 0.9]} />
        </mesh>
        {[[-0.5, -0.4], [0.5, -0.4], [-0.5, 0.4], [0.5, 0.4]].map(([x, z], i) => (
          <mesh key={i} position={[x, 0.32, z]} material={yellow}>
            <boxGeometry args={[0.07, 0.65, 0.07]} />
          </mesh>
        ))}
        <mesh position={[0.02, 0.32, 0]} material={glass}>
          <boxGeometry args={[1.0, 0.6, 0.82]} />
        </mesh>
      </group>
      {/* boom -> stick -> bucket */}
      <group position={[0.7, 1.2, -0.35]} rotation={[0, 0, a1 + 1.1]}>
        <mesh position={[1.3, 0, 0]} material={yellow} castShadow>
          <boxGeometry args={[2.6, 0.32, 0.28]} />
        </mesh>
        <mesh position={[1.0, 0.2, 0]} rotation={[0, 0, 0]} material={steel}>
          <cylinderGeometry args={[0.06, 0.06, 1.4, 8]} />
        </mesh>
        <group position={[2.6, 0, 0]} rotation={[0, 0, -a2 - 0.6]}>
          <mesh position={[0.9, 0, 0]} material={yellow} castShadow>
            <boxGeometry args={[1.8, 0.24, 0.24]} />
          </mesh>
          <group position={[1.8, 0, 0]} rotation={[0, 0, -0.8 - 0.4 * Math.sin(dig + 1.2)]}>
            <mesh position={[0.25, -0.1, 0]} material={dark} castShadow>
              <boxGeometry args={[0.5, 0.45, 0.6]} />
            </mesh>
          </group>
        </group>
      </group>
    </group>
  );
};

const Shovel: React.FC<{position: [number, number, number]; rot?: [number, number, number]}> = ({position, rot = [0, 0, 0]}) => {
  const wood = useMat('wood_oak', {tint: '#c8a070'});
  const steel = useMat('steel', {tint: '#9a9a9a'});
  return (
    <group position={position} rotation={rot}>
      <mesh position={[0, 0.75, 0]} material={wood} castShadow>
        <cylinderGeometry args={[0.02, 0.02, 1.2, 8]} />
      </mesh>
      <mesh position={[0, 0.06, 0]} material={steel} castShadow>
        <boxGeometry args={[0.24, 0.3, 0.02]} />
      </mesh>
    </group>
  );
};

const TREES: {p: [number, number, number]; s: number; leaf: string; seed: number}[] = [
  {p: [-8.2, 0, -13.5], s: 1.15, leaf: '#c8642a', seed: 3},
  {p: [7.6, 0, -12.5], s: 1.05, leaf: '#d8952a', seed: 5},
  {p: [14.5, 0, -24], s: 1.3, leaf: '#b5452a', seed: 7},
  {p: [-15, 0, -27], s: 1.4, leaf: '#c97f2c', seed: 9},
  {p: [-13.5, 0, -6], s: 1.2, leaf: '#7f7a34', seed: 11},
  {p: [15.5, 0, -6], s: 1.1, leaf: '#c25a2a', seed: 13},
  {p: [3.5, 0, -32], s: 1.6, leaf: '#a9732c', seed: 15},
  {p: [-24, 0, -18], s: 1.5, leaf: '#d2a03a', seed: 17},
  {p: [24, 0, -14], s: 1.4, leaf: '#9a4426', seed: 19},
  // foreground (only when not cut)
  {p: [8.5, 0, 7.5], s: 1.0, leaf: '#cf7a2c', seed: 21},
  {p: [-8.8, 0, 9], s: 1.1, leaf: '#b8502a', seed: 23},
];

const SECTION_STONES: [number, number, number][] = [
  [-6.2, -2.2, 0.35], [-5.1, -6.4, 0.5], [-1.8, -5.2, 0.3], [1.9, -6.9, 0.45], [4.1, -4.6, 0.28], [6.6, -2.9, 0.4], [7.4, -7.4, 0.55],
  [-8.3, -5.0, 0.42], [0.3, -8.6, 0.38], [-3.6, -8.0, 0.32], [3.0, -9.5, 0.5], [-7.0, -9.8, 0.4], [6.0, -10.5, 0.36],
];

/** Lawn = slabs around a rectangular pit. `cut`: everything in front of z=0 is removed (section view). */
const Garden: React.FC<{pit: Rect; cut: boolean; sodPit?: boolean}> = ({pit, cut, sodPit}) => {
  const lawnBase = useMat('lawn_autumn', {tint: '#e8e2c4'});
  const lawn = useMacro(lawnBase, 'lawn', 0.45);
  const loam = useMat('loam_section', {tint: '#f0e2d0'});
  const top = useMat('loam_section', {tint: '#7a6a5a'});
  const mats = useMemo(() => [loam, loam, lawn, loam, loam, loam], [loam, lawn]);
  const zE = cut ? 0 : 200;
  const B = 200;
  return (
    <group>
      {/* slabs around the pit */}
      <Bx x={[-B, B]} y={[DEEP, 0]} z={[-B, pit.z0]} m={mats} ts={3.5} cast={false} />
      <Bx x={[-B, pit.x0]} y={[DEEP, 0]} z={[pit.z0, zE]} m={mats} ts={3.5} cast={false} />
      <Bx x={[pit.x1, B]} y={[DEEP, 0]} z={[pit.z0, zE]} m={mats} ts={3.5} cast={false} />
      {!cut && <Bx x={[pit.x0, pit.x1]} y={[DEEP, 0]} z={[pit.z1, B]} m={mats} ts={3.5} cast={false} />}
      <Bx x={[pit.x0, pit.x1]} y={[DEEP, -pit.d]} z={[pit.z0, cut ? 0 : pit.z1]} m={loam} ts={2.5} cast={false} />
      {sodPit && <Bx x={[pit.x0, pit.x1]} y={[-0.4, 0.0]} z={[pit.z0, cut ? 0 : pit.z1]} m={mats} ts={3.5} cast={false} />}
      {/* dark topsoil band on the section face */}
      {cut && (
        <>
          <Bx x={[-60, pit.x0]} y={[-0.38, 0]} z={[-0.01, 0.012]} m={top} ts={2} cast={false} />
          <Bx x={[pit.x1, 60]} y={[-0.38, 0]} z={[-0.01, 0.012]} m={top} ts={2} cast={false} />
        </>
      )}
      {cut && SECTION_STONES.map((r, i) => <Rock key={i} position={[r[0], r[1], 0]} scale={[r[2], r[2] * 0.7, r[2] * 0.6]} seed={i + 120} tex="stone_face_grey" />)}
      {/* section floor far below the cut */}
      {cut && <Bx x={[-B, B]} y={[DEEP - 1, DEEP]} z={[0, B]} m={loam} ts={4} cast={false} />}
      <ModernHouse position={[-2.5, 0, -21]} />
      <House position={[-21, 0, -15]} size={[9, 5.5, 7]} rotY={0.25} wall="brick_red" />
      <House position={[20, 0, -17]} size={[8, 5, 7]} rotY={-0.3} wall="plaster_ochre" />
      <FenceRun x={-10.5} z0={-25} z1={cut ? -0.05 : 22} />
      <FenceRun x={10.5} z0={-25} z1={cut ? -0.05 : 22} />
      <Shed position={[7.4, 0, -7.2]} rotY={-0.35} />
      {TREES.filter((t) => !cut || t.p[2] < -2).map((t, i) => (
        <Tree key={i} position={t.p} scale={t.s} seed={t.seed} leaf={t.leaf} />
      ))}
      {[[-9.4, -20], [-9.4, -3], [9.4, -1], [9.6, -20], [-9.2, 4], [9.3, 12]].filter(([, z]) => !cut || z < -1.5).map(([x, z], i) => (
        <Bush key={i} position={[x, 0, z]} scale={1.1} seed={i + 30} color={i % 2 ? '#6b6a2c' : '#5a6a30'} />
      ))}
    </group>
  );
};

/** Sky, sun, haze. golden: 0 late afternoon .. 1 sunset. */
const Atmos: React.FC<{f: number; golden?: number; shadow?: number; target?: [number, number, number]}> = ({f, golden = 0, shadow = 16, target = [0.5, -1.5, -1]}) => {
  const d = SUN_DIR.map((v, i) => v + (SUN_GOLD[i] - v) * golden) as [number, number, number];
  const sunCol = new THREE.Color('#ffe2b8').lerp(new THREE.Color('#ffb26a'), golden).getStyle();
  const hor = new THREE.Color('#efcfaa').lerp(new THREE.Color('#f2b783'), golden).getStyle();
  return (
    <>
      <Renderer exposure={1.02 + 0.1 * golden} envIntensity={0.55} />
      <SkyDome top={'#41689f'} horizon={hor} bottom="#7a6a50" sunDir={d} sunColor={sunCol} clouds={0.42} time={f / 30} />
      <Sun dir={d} intensity={3.2 - 0.3 * golden} color={sunCol} shadowSize={shadow} shadowRes={4096} target={target} skyColor="#c2d2e6" groundColor="#7a6a4c" hemi={0.75} />
      <fog attach="fog" args={[hor, 70, 420]} />
    </>
  );
};

// ============================================================ the shelter
type Build = {
  gravelBed: number; // 0..1
  rebar: number; // 0..1
  pour: number; // 0..1 concrete level
  membrane: number; // 0..1
  drain: number; // 0..1
  backfill: number; // 0..1 (sides up to roof level)
  vents: number; // 0..1
  cover: number; // 0..1 (10 earth layers)
  sod: number; // 0..1
  hatch: number; // 0 open .. 1 closed (hidden when < 0)
  interior: boolean;
  people?: boolean;
  slump: number; // 0..1 cave-in wedge (S2)
};
const B0: Build = {gravelBed: 0, rebar: 0, pour: 0, membrane: 0, drain: 0, backfill: 0, vents: 0, cover: 0, sod: 0, hatch: -1, interior: false, slump: 0};
const FULL: Build = {gravelBed: 1, rebar: 1, pour: 1, membrane: 1, drain: 1, backfill: 1, vents: 1, cover: 1, sod: 1, hatch: 1, interior: true, slump: 0};

const Rebar: React.FC<{level: number; zMax: number}> = ({level, zMax}) => {
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, -1, 0), 0), []);
  plane.constant = level;
  const clip = useMemo(() => [plane], [plane]);
  const m = useMat('steel_rusty', {tint: '#e08a5a', clip, roughness: 0.7});
  const geo = useMemo(() => {
    const parts: THREE.BufferGeometry[] = [];
    const bar = (a: [number, number, number], b: [number, number, number]) => {
      const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
      const g = new THREE.CylinderGeometry(0.032, 0.032, va.distanceTo(vb), 5, 1, true);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
      g.applyQuaternion(q);
      const mid = va.add(vb).multiplyScalar(0.5);
      g.translate(mid.x, mid.y, mid.z);
      parts.push(g);
    };
    const y0 = BX.yb + 0.08, y1 = BX.yt - 0.08;
    const zb = BX.z0 + BX.t / 2;
    const ze = Math.min(zMax, BX.z1 - 0.1);
    for (let x = BX.x0 + 0.15; x <= BX.x1 - 0.1; x += 0.3) bar([x, y0, zb], [x, y1, zb]);
    for (let y = y0 + 0.1; y <= y1; y += 0.3) bar([BX.x0 + 0.08, y, zb], [BX.x1 - 0.08, y, zb]);
    for (const xs of [BX.x0 + BX.t / 2, BX.x1 - BX.t / 2]) {
      for (let z = zb + 0.3; z <= ze; z += 0.3) bar([xs, y0, z], [xs, y1, z]);
      for (let y = y0 + 0.1; y <= y1; y += 0.3) bar([xs, y, zb], [xs, y, ze]);
    }
    for (let x = BX.x0 + 0.15; x <= BX.x1 - 0.1; x += 0.3) bar([x, BX.yb + 0.12, BX.z0 + 0.1], [x, BX.yb + 0.12, ze]);
    for (let z = BX.z0 + 0.15; z <= ze; z += 0.3) bar([BX.x0 + 0.08, BX.yb + 0.14, z], [BX.x1 - 0.08, BX.yb + 0.14, z]);
    return mergeGeometries(parts);
  }, [zMax]);
  if (level <= BX.yb + 0.01) return null;
  return <mesh geometry={geo} material={m} castShadow />;
};

const Vent: React.FC<{x: number; z: number; grow: number}> = ({x, z, grow}) => {
  const m = useMat('steel', {tint: '#b9bcc0', metalness: 0.6, roughness: 0.45});
  const y0 = BX.ci, top = 0.95;
  const h = (top - y0) * grow;
  if (grow <= 0.01) return null;
  return (
    <group>
      <mesh position={[x, y0 + h / 2, z]} material={m} castShadow>
        <cylinderGeometry args={[0.075, 0.075, h, 14]} />
      </mesh>
      {grow > 0.98 && (
        <>
          <mesh position={[x + 0.17, top, z]} material={m} castShadow>
            <torusGeometry args={[0.17, 0.075, 10, 16, Math.PI]} />
          </mesh>
          <mesh position={[x + 0.34, top - 0.12, z]} material={m} castShadow>
            <cylinderGeometry args={[0.085, 0.085, 0.24, 14]} />
          </mesh>
        </>
      )}
    </group>
  );
};

const Hatch: React.FC<{closed: number; zMax: number}> = ({closed, zMax}) => {
  const m = useMat('steel', {tint: '#5d6a48', metalness: 0.5, roughness: 0.55});
  const z1 = Math.min(SH.z1, zMax);
  const w = SH.x1 - SH.x0;
  const ang = (1 - closed) * 1.75;
  const g = useMemo(() => uvBox(w, 0.07, z1 - SH.z0, 1), [w, z1]);
  return (
    <group position={[SH.x1, SH.top + 0.035, 0]} rotation={[0, 0, ang]}>
      <mesh geometry={g} position={[-w / 2, 0, (SH.z0 + z1) / 2]} material={m} castShadow receiveShadow />
      <mesh position={[-w + 0.2, 0.06, (SH.z0 + z1) / 2]} material={m}>
        <boxGeometry args={[0.08, 0.06, 0.4]} />
      </mesh>
    </group>
  );
};

const Interior: React.FC<{f: number; people: boolean}> = ({f, people}) => {
  const wood = useMat('wood_oak', {tint: '#c49a6c'});
  const linen = useMat('linen', {tint: '#8fa0b8'});
  const jug = usePlainMat('#5aa6d8', 0.25, 0, {transparent: true, opacity: 0.85});
  const box = usePlainMat('#a8865a', 0.85);
  const bulb = usePlainMat('#fff1c8', 0.4, 0, {emissive: new THREE.Color('#ffd27a'), emissiveIntensity: 2.2});
  const steel = useMat('steel', {tint: '#9aa0a6'});
  const fl = BX.fl;
  const zb = BX.z0 + BX.t;
  return (
    <group>
      {/* bunk bed along the back wall */}
      {[0.35, 1.25].map((h, i) => (
        <group key={i}>
          <Bx x={[-2.55, -0.55]} y={[fl + h, fl + h + 0.06]} z={[zb + 0.02, zb + 0.82]} m={wood} ts={1.5} />
          <Bx x={[-2.5, -0.6]} y={[fl + h + 0.06, fl + h + 0.2]} z={[zb + 0.05, zb + 0.78]} m={linen} ts={1} />
        </group>
      ))}
      {[[-2.55, zb + 0.04], [-0.6, zb + 0.04], [-2.55, zb + 0.78], [-0.6, zb + 0.78]].map(([x, z], i) => (
        <Bx key={i} x={[x, x + 0.06]} y={[fl, fl + 1.75]} z={[z, z + 0.06]} m={wood} ts={1} />
      ))}
      {/* shelves with water and supplies */}
      {[0.05, 0.75, 1.45].map((h, i) => (
        <group key={i}>
          <Bx x={[0.6, 2.5]} y={[fl + h, fl + h + 0.04]} z={[zb + 0.02, zb + 0.5]} m={wood} ts={1.5} />
          {[0, 1, 2, 3].map((k) => (
            <mesh key={k} position={[0.8 + k * 0.45, fl + h + 0.24, zb + 0.26]} material={(k + i) % 3 === 0 ? box : jug} castShadow>
              {(k + i) % 3 === 0 ? <boxGeometry args={[0.36, 0.38, 0.36]} /> : <cylinderGeometry args={[0.13, 0.13, 0.4, 14]} />}
            </mesh>
          ))}
        </group>
      ))}
      {[0.6, 2.46].map((x) => (
        <Bx key={x} x={[x, x + 0.04]} y={[fl, fl + 1.95]} z={[zb + 0.02, zb + 0.5]} m={wood} ts={1} />
      ))}
      {/* filter box + fan under the intake */}
      <Bx x={[VENTS[0].x - 0.3, VENTS[0].x + 0.3]} y={[BX.ci - 0.42, BX.ci]} z={[VENTS[0].z - 0.25, VENTS[0].z + 0.25]} m={steel} ts={0.6} />
      <mesh position={[VENTS[0].x, BX.ci - 0.21, VENTS[0].z + 0.26]} rotation={[Math.PI / 2, 0, 0]} material={steel}>
        <cylinderGeometry args={[0.16, 0.16, 0.04, 18]} />
      </mesh>
      {/* lamp */}
      <mesh position={[0.2, BX.ci - 0.08, -0.6]} material={bulb}>
        <sphereGeometry args={[0.08, 12, 8]} />
      </mesh>
      <pointLight position={[0.2, BX.ci - 0.3, -0.4]} intensity={6} distance={7} decay={1.6} color="#ffd9a0" />
      {people && (
        <>
          <Person position={[-0.2, fl, -0.55]} rotY={-1.2} pose="stand" seed={61} outfit="#3f6c94" pants="#2d3440" head="hair" />
          <Person position={[0.55, fl, -0.25]} rotY={-2.0} pose="point" seed={62} outfit="#a8473a" pants="#3a3530" head="hair" headColor="#5a3a20" />
          <Person position={[0.15, fl, 0.1 - 0.4]} rotY={-1.6} pose="stand" seed={63} outfit="#d8b04a" pants="#3a4a5a" scale={0.68} t={f * 0.1} />
        </>
      )}
    </group>
  );
};

/** The shelter and everything in the pit. `zMax` = 0 for the section view. */
const Shelter: React.FC<{b: Build; f: number; zMax: number}> = ({b, f, zMax}) => {
  const conc = useMat('concrete_formed', {tint: '#e2ddd4'});
  const slab = useMat('concrete', {tint: '#d8d4cc'});
  const memM = useMat('membrane', {tint: '#ffffff', roughness: 0.5});
  const grav = useMat('gravel', {tint: '#dcd6cc'});
  const fill = useMat('loam_section', {tint: '#e6cdb2'});
  const bandA = useMat('loam_section', {tint: '#d9bea0'});
  const bandB = useMat('loam_section', {tint: '#b89a7c'});
  const pipeM = usePlainMat('#e9e4da', 0.5, 0.05);
  const holeM = usePlainMat('#3a3530', 0.8);
  const Z = zMax;
  const lvl = BX.yb + (SH.top - BX.yb) * b.pour; // concrete level
  const cy = (y0: number, y1: number): [number, number] => [y0, Math.min(y1, lvl)];
  // ---- concrete pieces [x, y, z]
  const pieces: [[number, number], [number, number], [number, number], THREE.Material][] = [
    [[BX.x0, BX.x1], [BX.yb, BX.fl], [BX.z0, BX.z1], slab], // floor
    [[BX.x1, SH.x1], [BX.yb, BX.fl], [SH.z0, SH.z1], slab], // tunnel + shaft floor
    [[BX.x0, BX.x1], [BX.fl, BX.ci], [BX.z0, BX.z0 + BX.t], conc], // back wall
    [[BX.x0, BX.x1], [BX.fl, BX.ci], [BX.z1 - BX.t, BX.z1], conc], // front wall
    [[BX.x0, BX.x0 + BX.t], [BX.fl, BX.ci], [BX.z0 + BX.t, BX.z1 - BX.t], conc], // left end
    [[BX.x1 - BX.t, BX.x1], [BX.fl, BX.ci], [BX.z0 + BX.t, -DOOR.z], conc], // right end (around door)
    [[BX.x1 - BX.t, BX.x1], [BX.fl, BX.ci], [DOOR.z, BX.z1 - BX.t], conc],
    [[BX.x1 - BX.t, BX.x1], [DOOR.top, BX.ci], [-DOOR.z, DOOR.z], conc],
    [[BX.x0, BX.x1], [BX.ci, BX.yt], [BX.z0, BX.z1], slab], // roof
    [[BX.x1, SH.x0], [BX.fl, BX.ci], [SH.z0, -DOOR.z], conc], // tunnel side walls
    [[BX.x1, SH.x0], [BX.fl, BX.ci], [DOOR.z, SH.z1], conc],
    [[BX.x1, SH.x0], [DOOR.top, BX.ci], [-DOOR.z, DOOR.z], conc], // tunnel roof
    [[BX.x1, SH.x0], [BX.ci, BX.yt], [SH.z0, SH.z1], slab],
    [[SH.x0, SH.x0 + SH.t], [DOOR.top, SH.top], [-DOOR.z, DOOR.z], conc], // shaft wall above the opening
    [[SH.x1 - SH.t, SH.x1], [BX.fl, SH.top], [SH.z0, SH.z1], conc], // shaft far wall
    [[SH.x0, SH.x1], [BX.fl, SH.top], [SH.z0, SH.z0 + SH.t], conc], // shaft side walls
    [[SH.x0, SH.x1], [BX.fl, SH.top], [SH.z1 - SH.t, SH.z1], conc],
  ];
  // ---- membrane (outside faces), rises with b.membrane
  const ml = BX.yb + (COVER0 - BX.yb) * b.membrane;
  const my = (y0: number, y1: number): [number, number] => [y0, Math.min(y1, ml)];
  const gl = PIT.d * -1 + 0.9 * b.drain; // gravel top
  const bl = -2.9 + (COVER0 + 2.9) * b.backfill; // backfill top
  const cvl = COVER0 + (0 - COVER0) * b.cover; // cover top
  const slump = b.slump;
  return (
    <group>
      {b.gravelBed > 0 && <Bx x={[PIT.x0, PIT.x1]} y={[-PIT.d, -PIT.d + 0.2 * b.gravelBed]} z={[PIT.z0, PIT.z1]} zMax={Z} m={grav} ts={1.2} cast={false} />}
      <Rebar level={BX.yb + (BX.yt - BX.yb + 0.1) * b.rebar} zMax={Z} />
      {b.pour > 0 && pieces.map(([x, y, z, m], i) => <Bx key={i} x={x} y={cy(y[0], y[1])} z={z} zMax={Z} m={m} ts={2} />)}
      {/* membrane */}
      {b.membrane > 0 && (
        <>
          <Bx x={[BX.x0 - MEM, BX.x1 + MEM]} y={my(BX.yb, BX.yt)} z={[BX.z0 - MEM, BX.z0]} zMax={Z} m={memM} ts={1.5} />
          <Bx x={[BX.x0 - MEM, BX.x0]} y={my(BX.yb, BX.yt)} z={[BX.z0, BX.z1]} zMax={Z} m={memM} ts={1.5} />
          <Bx x={[BX.x1, BX.x1 + MEM]} y={my(BX.yb, BX.yt)} z={[BX.z0, SH.z0]} zMax={Z} m={memM} ts={1.5} />
          {ml >= BX.yt - 0.01 && <Bx x={[BX.x0 - MEM, SH.x0]} y={[BX.yt, COVER0]} z={[BX.z0 - MEM, BX.z1]} zMax={Z} m={memM} ts={1.5} />}
        </>
      )}
      {/* drainage gravel + perforated pipe on the left side and behind */}
      {b.drain > 0 && (
        <>
          <Bx x={[PIT.x0, BX.x0 - MEM]} y={[-PIT.d + 0.2, gl]} z={[BX.z0 - MEM, PIT.z1]} zMax={Z} m={grav} ts={1.2} />
          <Bx x={[PIT.x0, PIT.x1]} y={[-PIT.d + 0.2, gl]} z={[PIT.z0, BX.z0 - MEM]} zMax={Z} m={grav} ts={1.2} />
        </>
      )}
      {b.drain > 0.45 && (
        <group>
          <mesh position={[-3.62, -3.42, (PIT.z0 + Math.min(Z, PIT.z1)) / 2]} rotation={[Math.PI / 2, 0, 0]} material={pipeM} castShadow>
            <cylinderGeometry args={[0.15, 0.15, Math.min(Z, PIT.z1) - PIT.z0, 18]} />
          </mesh>
          {[-2.6, -1.8, -1.0, -0.2].filter((z) => z < Z).map((z) => (
            <mesh key={z} position={[-3.62, -3.36, z]} material={holeM}>
              <sphereGeometry args={[0.03, 6, 4]} />
            </mesh>
          ))}
          {Z > 0 ? null : (
            <mesh position={[-3.62, -3.42, Z + 0.002]} material={holeM}>
              <circleGeometry args={[0.12, 18]} />
            </mesh>
          )}
        </group>
      )}
      {/* backfill around the box, up to the roof */}
      {b.backfill > 0 && (
        <>
          <Bx x={[PIT.x0, BX.x0 - MEM]} y={[-2.9, bl]} z={[BX.z0 - MEM, PIT.z1]} zMax={Z} m={fill} ts={2} />
          <Bx x={[PIT.x0, PIT.x1]} y={[-2.9, bl]} z={[PIT.z0, BX.z0 - MEM]} zMax={Z} m={fill} ts={2} />
          <Bx x={[BX.x1 + MEM, PIT.x1]} y={[BX.yb, bl]} z={[BX.z0 - MEM, SH.z0]} zMax={Z} m={fill} ts={2} />
          <Bx x={[SH.x1, PIT.x1]} y={[BX.yb, bl]} z={[SH.z0, SH.z1]} zMax={Z} m={fill} ts={2} />
          {Z > 1 && <Bx x={[BX.x1 + MEM, PIT.x1]} y={[BX.yb, bl]} z={[SH.z1, PIT.z1]} m={fill} ts={2} />}
          {Z > 1 && <Bx x={[BX.x0 - MEM, BX.x1 + MEM]} y={[BX.yb, bl]} z={[BX.z1, PIT.z1]} m={fill} ts={2} />}
        </>
      )}
      {/* earth cover: 10 halving layers */}
      {b.cover > 0 &&
        Array.from({length: 10}, (_, i) => {
          const y0 = COVER0 + i * BAND;
          if (cvl <= y0 + 0.002) return null;
          const yr: [number, number] = [y0, Math.min(y0 + BAND, cvl)];
          const m = i % 2 ? bandA : bandB;
          return (
            <group key={i}>
              <Bx x={[PIT.x0, SH.x0]} y={yr} z={[PIT.z0, PIT.z1]} zMax={Z} m={m} ts={2} cast={false} />
              <Bx x={[SH.x0, SH.x1]} y={yr} z={[PIT.z0, SH.z0]} zMax={Z} m={m} ts={2} cast={false} />
              {Z > 1 && <Bx x={[SH.x0, SH.x1]} y={yr} z={[SH.z1, PIT.z1]} m={m} ts={2} cast={false} />}
              <Bx x={[SH.x1, PIT.x1]} y={yr} z={[PIT.z0, PIT.z1]} zMax={Z} m={m} ts={2} cast={false} />
            </group>
          );
        })}
      {b.sod > 0 && <Sod t={b.sod} zMax={Z} />}
      {VENTS.map((v, i) => <Vent key={i} x={v.x} z={v.z} grow={ramp(b.vents, i * 0.3, i * 0.3 + 0.7)} />)}
      {b.hatch >= 0 && <Hatch closed={b.hatch} zMax={Z} />}
      {b.pour > 0.99 && <Ladder zMax={Z} />}
      {b.interior && <Interior f={f} people={!!b.people} />}
      {slump > 0 && <Slump t={slump} />}
    </group>
  );
};

const Sod: React.FC<{t: number; zMax: number}> = ({t, zMax}) => {
  const lawnBase = useMat('lawn_autumn', {tint: '#e8e2c4'});
  const lawn = useMacro(lawnBase, 'lawn', 0.45);
  const x1 = PIT.x0 + (PIT.x1 - PIT.x0) * t;
  return (
    <>
      <Bx x={[PIT.x0, Math.min(x1, SH.x0)]} y={[0, 0.025]} z={[PIT.z0, PIT.z1]} zMax={zMax} m={lawn} ts={3.5} cast={false} />
      {x1 > SH.x0 && <Bx x={[SH.x0, Math.min(x1, SH.x1)]} y={[0, 0.025]} z={[PIT.z0, SH.z0]} zMax={zMax} m={lawn} ts={3.5} cast={false} />}
      {x1 > SH.x0 && zMax > 1 && <Bx x={[SH.x0, Math.min(x1, SH.x1)]} y={[0, 0.025]} z={[SH.z1, PIT.z1]} m={lawn} ts={3.5} cast={false} />}
      {x1 > SH.x1 && <Bx x={[SH.x1, x1]} y={[0, 0.025]} z={[PIT.z0, PIT.z1]} zMax={zMax} m={lawn} ts={3.5} cast={false} />}
    </>
  );
};

const Ladder: React.FC<{zMax: number}> = ({zMax}) => {
  const m = useMat('steel', {tint: '#8f969c', metalness: 0.6, roughness: 0.4});
  const z = SH.z0 + SH.t + 0.07;
  if (z > zMax) return null;
  return (
    <group>
      {[3.85, 4.4].map((x) => (
        <mesh key={x} position={[x, (BX.fl + SH.top) / 2, z]} material={m} castShadow>
          <cylinderGeometry args={[0.025, 0.025, SH.top - BX.fl, 8]} />
        </mesh>
      ))}
      {Array.from({length: 12}, (_, i) => (
        <mesh key={i} position={[4.125, BX.fl + 0.3 + i * 0.3, z]} rotation={[0, 0, Math.PI / 2]} material={m} castShadow>
          <cylinderGeometry args={[0.018, 0.018, 0.55, 6]} />
        </mesh>
      ))}
    </group>
  );
};

/** Cave-in: a wedge of soil breaking off the back face of the excavation and sliding in. */
const Slump: React.FC<{t: number}> = ({t}) => {
  const m = useMat('loam_section', {tint: '#c8ab8c'});
  const geo = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(0, 0);
    s.lineTo(1.9, 0);
    s.lineTo(0, 3.2);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, {depth: 4.5, bevelEnabled: false});
    g.translate(0, 0, -2.25);
    g.rotateY(-Math.PI / 2);
    return worldUV(g, 2);
  }, []);
  const k = Easing.in(Easing.quad)(Math.min(1, t * 1.25));
  const fade = t > 0.8 ? 1 - (t - 0.8) / 0.2 : 1;
  return (
    <group scale={[1, Math.max(0.01, fade), 1]} position={[0, -PIT.d * (1 - Math.max(0.01, fade)), 0]}>
      <group position={[-1.5, -PIT.d + 0.6 - k * 0.6, PIT.z0 - 1.9 + k * 2.1]}>
        <mesh geometry={geo} material={m} castShadow receiveShadow />
      </group>
      {[0, 1, 2, 3, 4].map((i) => {
        const kk = Easing.in(Easing.quad)(Math.min(1, Math.max(0, t * 1.4 - i * 0.06)));
        return <Rock key={i} position={[-3 + i * 0.8, -0.3 - kk * 3.2, PIT.z0 + 0.3 + kk * (1.6 + (i % 2) * 0.5)]} scale={0.32 + (i % 3) * 0.08} seed={i + 90} tex={'loam_section' as TexName} />;
      })}
    </group>
  );
};

// ============================================================ stage + pins
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
      <Grade strength={0.32} />
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

const HI = '#f2a900';
const PANTS = '#34383f';
const Worker: React.FC<{position: [number, number, number]; rotY: number; pose: 'hammer' | 'point' | 'stand' | 'push' | 'carry' | 'pull' | 'chisel'; seed: number; t?: number}> = (p) => (
  <Person {...p} outfit={HI} pants={PANTS} head="hardhat" />
);

/** Spoil heap from the excavation (shrinks as it goes back in as backfill). */
const Heap: React.FC<{s: number}> = ({s}) => (s > 0.02 ? <Rock position={[-7.6, -0.4 * s, -9.5]} scale={[3.4 * s, 1.7 * s, 2.6 * s]} seed={5} tex={'dirt' as TexName} /> : null);

// ============================================================ S1 hook: a hole in the lawn
const S1: React.FC = () => {
  const f = useCurrentFrame();
  const notAt = wordAt(0, 'Not even');
  const cam = groundSafe(camPath(f, [
    {t: 0, pos: [3.6, 2.3, 7.4], target: [0, -0.1, -0.4], fov: 50},
    {t: LEN[0], pos: [2.5, 1.8, 5.6], target: [0, -0.2, -0.4], fov: 50},
  ]), groundH(false, HOLE), 1.2, 0.3, 0.6);
  return (
    <>
      <Stage cam={cam}>
        <Atmos f={f} target={[0, 0, -2]} shadow={22} />
        <Garden pit={HOLE} cut={false} />
        <Rock position={[-1.9, -0.15, -0.3]} scale={[1.1, 0.55, 0.9]} seed={3} tex={'dirt' as TexName} />
        <Shovel position={[-1.7, 0.2, 0.2]} rot={[0.15, 0.4, 0.25]} />
        <Person position={[0.1, -HOLE.d, 0.0]} rotY={-1.25} pose="stand" seed={41} outfit="#4a6f8f" pants="#3a3f48" head="hair" headColor="#3a2a1a" />
      </Stage>
      <Headline top="DIG A HOLE, CLIMB IN..." big="BUNKER?" delay={4} y={150} bigSize={160} />
      <Tag text="NOT EVEN CLOSE" x={540} y={1180} anchor="center" delay={notAt} size={66} bg={C.red} fg={C.white} />
    </>
  );
};

// ============================================================ S2 walls cave in -> rebar + concrete
const S2: React.FC = () => {
  const f = useCurrentFrame();
  const L = LEN[1];
  const cut = wordAt(1, 'One cubic') - 4;
  const fixAt = wordAt(1, 'Fix');
  // part A: the hook hole caves in
  const camA = groundSafe(camPath(f, [
    {t: 0, pos: [-2.3, 1.9, 4.2], target: [0.1, -0.4, -0.3], fov: 50},
    {t: cut, pos: [-1.9, 1.7, 3.6], target: [0.1, -0.5, -0.3], fov: 50},
  ]), groundH(false, HOLE), 1.2, 0.3, 0.6);
  const fall = (k: number) => ramp(f, 8 + k * 7, 26 + k * 7, Easing.in(Easing.quad));
  // part B: section through the real excavation
  const g = f - cut;
  const LB = L - cut;
  const camB = groundSafe(camPath(g, [
    {t: 0, pos: [0.6, 1.6, 19.5], target: [0.5, -2.0, -1], fov: 52},
    {t: LB, pos: [0.6, 0.9, 17.0], target: [0.5, -1.9, -1], fov: 52},
  ]), groundH(true, PIT));
  const D = fixAt - cut - 2; // time jump (dip to dark) between the cave-in and the fix
  const slump = g >= D ? 0 : 0.8 * ramp(g, 4, D - 8, Easing.linear);
  const dip = Math.max(0, 1 - Math.abs(g - D) / 6);
  const rebar = ramp(f, cut + D + 1, fixAt + 26);
  const pour = ramp(f, fixAt + 14, L - 6, Easing.inOut(Easing.quad));
  const b: Build = {...B0, gravelBed: 1, rebar, pour, slump, hatch: pour > 0.995 ? 0 : -1};
  return (
    <>
      <Sequence durationInFrames={cut} layout="none">
        <Stage cam={camA}>
          <Atmos f={f} target={[0, 0, -2]} shadow={22} />
          <Garden pit={HOLE} cut={false} />
          <Rock position={[-1.9, -0.15, -0.3]} scale={[1.1, 0.55, 0.9]} seed={3} tex={'dirt' as TexName} />
          <Shovel position={[-1.7, 0.2, 0.2]} rot={[0.15, 0.4, 0.25]} />
          {Array.from({length: 9}, (_, k) => {
            const side = k % 4;
            const t = fall(k * 0.6);
            const u = (rnd(k + 3) - 0.5) * 1.4;
            const start: [number, number, number] = side === 0 ? [u, -0.15, HOLE.z0 + 0.05] : side === 1 ? [HOLE.x1 - 0.05, -0.15, u * 0.6] : side === 2 ? [u, -0.15, HOLE.z1 - 0.05] : [HOLE.x0 + 0.05, -0.15, u * 0.6];
            const pos: [number, number, number] = [start[0] * (1 - 0.45 * t), start[1] - t * 0.85, start[2] * (1 - 0.45 * t)];
            return <Rock key={k} position={pos} scale={[0.26, 0.16, 0.22]} seed={k + 50} tex={'dirt' as TexName} />;
          })}
          <Rock position={[0, -HOLE.d - 0.35 + 0.45 * ramp(f, 14, cut - 4), 0]} scale={[0.95, 0.55, 0.7]} seed={57} tex={'dirt' as TexName} />
          <Dust at={[0, -0.7, 0]} f={f} count={6} size={0.14} color="#8a7258" />
          <Person position={[1.7, 0, 1.4]} rotY={-2.6} pose="point" seed={41} outfit="#4a6f8f" pants="#3a3f48" head="hair" headColor="#3a2a1a" />
        </Stage>
        <ProbFix n={1} problem="WALLS CAVE IN" fix="REBAR + CONCRETE" fixAt={9999} delay={3} />
      </Sequence>
      <Sequence from={cut} layout="none">
        <Stage cam={camB}>
          <Atmos f={f} />
          <Garden pit={PIT} cut />
          <Shelter b={b} f={f} zMax={0} />
          <Heap s={1} />
          <Excavator position={[-8.4, 0, -4.6]} rotY={0} dig={f * 0.06} />
          {g >= D && <Worker position={[-3.55, -3.6, -0.7]} rotY={0} pose="hammer" t={f * 0.25} seed={71} />}
          {g >= D && <Worker position={[1.6, -3.6, -2.35]} rotY={-1.9} pose="chisel" t={f * 0.22} seed={72} />}
          <Worker position={[-5.4, 0, -3.6]} rotY={-0.7} pose="point" seed={73} />
          {slump > 0.5 && <Dust at={[-1.5, -3.3, -2.0]} f={f} count={8} size={0.3} color="#a88a68" />}
        </Stage>
        {dip > 0 && <AbsoluteFill style={{background: '#0e0b08', opacity: dip}} />}
        <ProbFix n={1} problem="WALLS CAVE IN" fix="REBAR + CONCRETE" fixAt={fixAt - cut} delay={0} />
        <Sequence durationInFrames={fixAt - cut} layout="none">
          <Caption text="1 cubic yard of soil can weigh as much as a car" delay={6} bottom={300} />
        </Sequence>
        <Pin p={[-1.5, -3.6, 0]} cam={camB} text="STEEL REBAR" delay={fixAt - cut + 4} dy={70} />
        <Pin p={[-2.78, -2.0, 0]} cam={camB} text="POURED CONCRETE" delay={fixAt - cut + 30} dx={-40} anchor="right" dy={-120} />
      </Sequence>
    </>
  );
};

// ============================================================ S3 water -> membrane + drain
const S3: React.FC = () => {
  const f = useCurrentFrame();
  const L = LEN[2];
  const fixAt = wordAt(2, 'Fix');
  const drainAt = wordAt(2, 'drain pipe');
  const mem = ramp(f, fixAt + 2, fixAt + 40);
  const drain = ramp(f, drainAt - 10, drainAt + 18);
  const backfill = ramp(f, L - 52, L - 8);
  const b: Build = {...B0, gravelBed: 1, rebar: 1, pour: 1, membrane: mem, drain, backfill, interior: true, hatch: 0};
  const cam = groundSafe(camPath(f, [
    {t: 0, pos: [-1.4, 0.4, 11.5], target: [-2.0, -2.3, -1], fov: 52},
    {t: L, pos: [-1.8, 0.1, 10.0], target: [-2.3, -2.4, -1], fov: 52},
  ]), groundH(true, PIT));
  const leak = 1 - ramp(f, fixAt + 10, fixAt + 40);
  const puddle = ramp(f, 6, fixAt) * (1 - ramp(f, fixAt + 20, drainAt + 20));
  const water = usePlainMat('#4a9cc8', 0.08, 0.1, {transparent: true, opacity: 0.75, emissive: new THREE.Color('#1a5f8a'), emissiveIntensity: 0.4});
  const ph = (k: number) => ((f * 0.025 + k * 0.33) % 1);
  return (
    <>
      <Stage cam={cam}>
        <Atmos f={f} target={[-2, -2, -1]} shadow={10} />
        <Garden pit={PIT} cut />
        <Shelter b={b} f={f} zMax={0} />
        <Heap s={1 - 0.3 * backfill} />
        <Excavator position={[-8.4, 0, -4.6]} rotY={0} dig={f * 0.04} />
        {/* water pushing in from the soil */}
        {[0, 1, 2].map((k) => (
          <Arrow key={'a' + k} from={[-4.05 + ph(k) * 0.6, -3.2 + k * 0.7, 0.05]} dir={[1, 0, 0]} len={0.55} color="#4fc3ff" opacity={0.9 * leak * ramp(f, 4, 14)} />
        ))}
        {[0, 1].map((k) => (
          <Arrow key={'d' + k} from={[-2.62, -1.7 - ph(k) * 1.2, -0.3 - k * 0.4]} dir={[0, -1, 0]} len={0.3} color="#4fc3ff" opacity={0.85 * leak * ramp(f, 10, 20)} r={0.045} />
        ))}
        {puddle > 0.01 && (
          <mesh position={[-1.6, BX.fl + 0.012, -0.7]} rotation={[-Math.PI / 2, 0, 0]} scale={[1.6 * puddle, 0.6 * puddle + 0.05, 1]} material={water}>
            <circleGeometry args={[1, 28]} />
          </mesh>
        )}
        {/* after the fix: water runs down the gravel into the pipe */}
        {[0, 1, 2].map((k) => (
          <Arrow key={'g' + k} from={[-3.85, -2.95 - ph(k) * 0.4, 0.05]} dir={[0, -1, 0]} len={0.35} color="#4fc3ff" opacity={0.9 * ramp(f, drainAt + 6, drainAt + 18) * (1 - ramp(f, L - 50, L - 30))} r={0.05} />
        ))}
        <Worker position={[-5.0, 0, -1.6]} rotY={-0.25} pose="point" seed={74} />
      </Stage>
      <ProbFix n={2} problem="WATER SEEPS IN" fix="MEMBRANE + DRAIN" fixAt={fixAt} delay={3} />
      <Pin p={[-2.9, -1.6, 0]} cam={cam} text="WATERPROOF MEMBRANE" delay={fixAt + 14} dx={60} anchor="left" dy={-20} />
      <Pin p={[-3.62, -3.42, 0]} cam={cam} text="DRAIN PIPE" delay={drainAt + 2} dy={90} />
      <Pin p={[-3.9, -3.0, 0]} cam={cam} text="GRAVEL" delay={drainAt + 12} dx={-30} anchor="right" dy={-40} />
    </>
  );
};

// ============================================================ S4 air -> vent pipes + filter
const S4: React.FC = () => {
  const f = useCurrentFrame();
  const L = LEN[3];
  const fixAt = wordAt(3, 'Fix');
  const inAt = wordAt(3, 'Fresh air');
  const outAt = wordAt(3, 'stale air goes');
  const vents = ramp(f, fixAt - 2, inAt + 6);
  const b: Build = {...FULL, cover: 0, sod: 0, hatch: 0, vents, interior: true, people: true};
  const cam = groundSafe(camPath(f, [
    {t: 0, pos: [0.1, -0.2, 11.2], target: [0, -1.9, -1], fov: 54},
    {t: L, pos: [-0.2, 0.3, 12.6], target: [-0.1, -1.5, -1], fov: 54},
  ]), groundH(true, PIT));
  const heat = 1 - ramp(f, inAt + 10, outAt + 20);
  const ph = (k: number) => (f * 0.02 + k * 0.37) % 1;
  return (
    <>
      <Stage cam={cam}>
        <Atmos f={f} shadow={10} />
        <Garden pit={PIT} cut />
        <Shelter b={b} f={f} zMax={0} />
        <Heap s={0.7} />
        <Excavator position={[-8.4, 0, -4.6]} rotY={0} />
        {/* heat + stale air rising from people */}
        {[0, 1, 2].map((k) => (
          <Arrow key={'h' + k} from={[-0.4 + k * 0.45, -2.0 + ph(k) * 0.5, -0.3]} dir={[0, 1, 0]} len={0.45} color="#ff7a2a" opacity={0.85 * heat * ramp(f, 6, 16)} r={0.05} />
        ))}
        {/* fresh air in (down the intake), stale out (up the exhaust) */}
        <Arrow from={[VENTS[0].x, 0.6 - ph(0) * 1.2, VENTS[0].z + 0.2]} dir={[0, -1, 0]} len={0.5} color="#5fd0ff" opacity={0.95 * ramp(f, inAt, inAt + 10)} r={0.06} />
        <Arrow from={[VENTS[0].x + 0.4, BX.ci - 0.6, VENTS[0].z + 0.5]} dir={[1, -0.3, 0.3]} len={0.5 + 0.2 * Math.sin(f * 0.2)} color="#5fd0ff" opacity={0.9 * ramp(f, inAt + 8, inAt + 18)} r={0.05} />
        <Arrow from={[VENTS[1].x, -0.9 + ph(1) * 1.2, VENTS[1].z + 0.2]} dir={[0, 1, 0]} len={0.5} color="#ffa14a" opacity={0.95 * ramp(f, outAt, outAt + 10)} r={0.06} />
        <Worker position={[-3.6, COVER0, -2.0]} rotY={0.4} pose="point" seed={75} />
      </Stage>
      <ProbFix n={3} problem="STALE, HOT AIR" fix="TWO AIR PIPES" fixAt={fixAt} delay={3} />
      <Pin p={[VENTS[0].x, BX.ci - 0.2, -0.65]} cam={cam} text="FILTER" delay={inAt + 6} dy={60} dx={-40} anchor="right" />
      <Pin p={[VENTS[0].x, 0.9, VENTS[0].z]} cam={cam} text="FRESH IN" delay={inAt + 4} dy={-70} />
      <Pin p={[VENTS[1].x, 0.9, VENTS[1].z]} cam={cam} text="STALE OUT" delay={outAt + 2} dy={-70} />
    </>
  );
};

// ============================================================ S5 radiation -> 90 cm of packed earth
const S5: React.FC = () => {
  const f = useCurrentFrame();
  const L = LEN[4];
  const fixAt = wordAt(4, 'Fix');
  const nineAt = wordAt(4, 'Every nine');
  const ninetyAt = wordAt(4, 'Ninety');
  const cover = ramp(f, fixAt + 2, nineAt + 30, Easing.inOut(Easing.quad));
  const sod = ramp(f, ninetyAt + 24, L - 6);
  const b: Build = {...FULL, cover, sod, hatch: 0, interior: true, people: true};
  const cam = groundSafe(camPath(f, [
    {t: 0, pos: [0.4, 0.3, 9.6], target: [0.3, -1.1, -1], fov: 48},
    {t: L, pos: [0.6, 0.0, 8.0], target: [0.4, -0.8, -1], fov: 48},
  ]), groundH(true, PIT));
  // gamma rays from above: through the bare roof first, then halved by each layer
  const rays = [-2.2, -0.9, 0.4, 1.7];
  const flow = (f * 0.04) % 1;
  const before = 1 - ramp(f, fixAt, fixAt + 12);
  const after = ramp(f, nineAt - 6, nineAt + 10);
  return (
    <>
      <Stage cam={cam}>
        <Atmos f={f} shadow={10} />
        <Garden pit={PIT} cut />
        <Shelter b={b} f={f} zMax={0} />
        <Heap s={0.7 - 0.45 * cover} />
        <Excavator position={[-8.4, 0, -4.6]} rotY={0} dig={f * 0.05} />
        {rays.map((x, i) => (
          <group key={i}>
            {/* problem: straight through the roof into the room */}
            <Beam3 a={[x, 4, 0.06]} b={[x, BX.fl, 0.06]} opacity={0.85 * before * ramp(f, 4, 14)} r={0.045} />
            {/* fix: full strength above ground, halved by every 9 cm layer */}
            <Beam3 a={[x, 4, 0.06]} b={[x, 0, 0.06]} opacity={0.9 * after} r={0.045} />
            {Array.from({length: 10}, (_, k) => {
              const y1 = -k * BAND, y0 = -(k + 1) * BAND;
              return <Beam3 key={k} a={[x, y1, 0.06]} b={[x, y0 + 0.006, 0.06]} opacity={0.95 * after * Math.pow(0.6, k + 1)} r={0.05 * Math.pow(0.85, k + 1)} />;
            })}
            <mesh position={[x, 4 - ((flow + i * 0.25) % 1) * 4, 0.06]}>
              <sphereGeometry args={[0.07, 8, 6]} />
              <meshBasicMaterial color="#f4ff9a" transparent opacity={0.9 * Math.max(before * ramp(f, 4, 14), after)} toneMapped={false} />
            </mesh>
          </group>
        ))}
        {after > 0.01 && <DimBar a={[-4.0, COVER0, 0.12]} b={[-4.0, 0, 0.12]} />}
        <Worker position={[-5.2, 0, -2.6]} rotY={-0.3} pose="point" seed={76} />
      </Stage>
      <ProbFix n={4} problem="RADIATION" fix="BURY IT" fixAt={fixAt} delay={3} />
      <Pin p={[2.6, -BAND * 0.5, 0]} cam={cam} text="9 CM = HALF" delay={nineAt + 4} dx={50} anchor="left" dy={-40} />
      <Pin p={[-4.0, COVER0 / 2, 0.12]} cam={cam} text="90 CM" delay={ninetyAt} dx={-30} anchor="right" size={56} />
      <Sequence from={ninetyAt + 6} layout="none">
        <Caption text="10 layers: ½ × ½ × … = 1/1,024" delay={0} bottom={150} />
      </Sequence>
    </>
  );
};

// ============================================================ S6 the door -> entrance that turns a corner
const S6: React.FC = () => {
  const f = useCurrentFrame();
  const L = LEN[5];
  const fixAt = wordAt(5, 'Fix');
  const cornerAt = wordAt(5, 'turns a corner');
  const hatchAt = wordAt(5, 'steel hatch');
  const closed = ramp(f, hatchAt + 4, L - 10, Easing.inOut(Easing.quad));
  const b: Build = {...FULL, sod: 1, hatch: closed, interior: true};
  const cam = groundSafe(camPath(f, [
    {t: 0, pos: [3.1, 1.6, 10.5], target: [3.5, -1.3, -0.6], fov: 50},
    {t: L, pos: [3.4, 1.1, 9.0], target: [3.6, -1.2, -0.6], fov: 50},
  ]), groundH(true, PIT));
  // rays travel in straight lines from the sky into the open shaft and stop on the walls / floor
  const shoot = ramp(f, 8, fixAt + 4, Easing.linear);
  const RAYS: {a: [number, number, number]; b: [number, number, number]}[] = [
    {a: [1.4, 5.5, 0.06], b: [4.8, -1.2, 0.06]},
    {a: [2.1, 5.5, 0.06], b: [4.8, -2.4, 0.06]},
    {a: [6.4, 5.5, 0.06], b: [3.6, -0.3, 0.06]},
    {a: [4.2, 5.5, 0.06], b: [4.2, BX.fl, 0.06]},
  ];
  const corner = ramp(f, cornerAt, cornerAt + 16);
  return (
    <>
      <Stage cam={cam}>
        <Atmos f={f} target={[3.5, -1, -1]} shadow={9} />
        <Garden pit={PIT} cut />
        <Shelter b={b} f={f} zMax={0} />
        <Heap s={0.25} />
        <Excavator position={[-8.4, 0, -4.6]} rotY={0} />
        {RAYS.map((r, i) => {
          const end: [number, number, number] = [r.a[0] + (r.b[0] - r.a[0]) * shoot, r.a[1] + (r.b[1] - r.a[1]) * shoot, 0.06];
          return (
            <group key={i}>
              <Beam3 a={r.a} b={end} opacity={0.85 * (1 - 0.6 * closed)} />
              {shoot > 0.98 && (
                <mesh position={r.b}>
                  <sphereGeometry args={[0.12 + 0.03 * Math.sin(f * 0.5 + i), 10, 8]} />
                  <meshBasicMaterial color="#f4ff9a" transparent opacity={0.8 * (1 - 0.6 * closed)} toneMapped={false} />
                </mesh>
              )}
            </group>
          );
        })}
        {/* the safe path around the corner */}
        <Arrow from={[4.15, -2.4, 0.08]} dir={[-1, 0, 0]} len={1.6 * corner} color="#7dff8a" opacity={0.9 * corner} r={0.06} />
        <Person position={[1.2, BX.fl, -0.6]} rotY={0.1} pose="stand" seed={61} outfit="#3f6c94" pants="#2d3440" head="hair" />
      </Stage>
      <ProbFix n={5} problem="THE DOOR" fix="A CORNER + HATCH" fixAt={fixAt} delay={3} />
      <Pin p={[4.8, -1.8, 0]} cam={cam} text="RAYS HIT THE WALL" delay={fixAt - 30} dx={-10} dy={-260} />
      <Pin p={[2.4, -2.3, 0]} cam={cam} text="SAFE AROUND THE CORNER" delay={cornerAt + 6} dy={150} size={42} />
      <Pin p={[4.2, SH.top + 0.2, -0.4]} cam={cam} text="STEEL HATCH" delay={hatchAt + 2} dy={-110} />
    </>
  );
};

// ============================================================ S7 every layer has one job (full section)
const S7: React.FC = () => {
  const f = useCurrentFrame();
  const L = LEN[6];
  const cam = groundSafe(camPath(f, [
    {t: 0, pos: [0.4, 2.2, 21], target: [0.5, -1.6, -1], fov: 52},
    {t: L, pos: [0.6, 0.8, 17.2], target: [0.6, -1.9, -1], fov: 52},
  ]), groundH(true, PIT));
  const cAt = wordAt(6, 'Concrete');
  const mAt = wordAt(6, 'membrane');
  const pAt = wordAt(6, 'pipes');
  const eAt = wordAt(6, 'earth is');
  return (
    <>
      <Stage cam={cam}>
        <Atmos f={f} shadow={14} />
        <Garden pit={PIT} cut />
        <Shelter b={{...FULL, people: true}} f={f} zMax={0} />
        <Heap s={0.25} />
        <Excavator position={[-8.4, 0, -4.6]} rotY={0} />
        <Person {...walkAlong([-6.5, 0, -2.4], 0, f, 0.9)} seed={77} outfit="#6a4a7a" pants="#2d3440" head="hair" />
      </Stage>
      <Headline top="EVERY LAYER HAS" big="ONE JOB" delay={4} y={150} bigSize={130} />
      <Pin p={[-2.78, -2.4, 0]} cam={cam} text="CONCRETE" delay={cAt} dx={-30} anchor="right" dy={20} size={42} />
      <Pin p={[-3.62, -3.42, 0]} cam={cam} text="MEMBRANE + DRAIN" delay={mAt} dy={90} size={42} />
      <Pin p={[VENTS[1].x, 0.9, VENTS[1].z]} cam={cam} text="AIR PIPES" delay={pAt} dy={-80} size={42} />
      <Pin p={[2.0, COVER0 / 2, 0]} cam={cam} text="90 CM SHIELD" delay={eAt} dx={60} anchor="left" dy={-30} size={42} />
    </>
  );
};

// ============================================================ S8 payoff: the garden again
const S8: React.FC = () => {
  const f = useCurrentFrame();
  const L = LEN[7];
  const belowAt = wordAt(7, 'Below');
  const a = interpolate(f, [0, L], [0.44, 0.32]);
  const R = interpolate(f, [0, L], [12.2, 13.4]);
  const cam = groundSafe({pos: [1.5 + Math.sin(a) * R, 2.2 + f * 0.004, -1.0 + Math.cos(a) * R], target: [1.4, 0.6, -2.0], fov: 50} as Cam, groundH(false, PIT), 1.5);
  return (
    <>
      <Stage cam={cam}>
        <Atmos f={f} golden={0.6} target={[0, 0, -3]} shadow={24} />
        <Garden pit={PIT} cut={false} />
        <Shelter b={{...FULL, interior: false}} f={f} zMax={99} />
        <Person {...walkAlong([2.55, 0, 3.6], Math.PI / 2, f, 0.85)} seed={77} outfit="#6a4a7a" pants="#2d3440" head="hair" />
      </Stage>
      <Sequence durationInFrames={belowAt + 4} layout="none">
        <Pin p={[4.2, SH.top + 0.1, 0]} cam={cam} text="HATCH" delay={14} dy={-90} />
        <Pin p={[VENTS[0].x, 1.0, VENTS[0].z]} cam={cam} text="2 PIPES" delay={34} dy={-110} />
      </Sequence>
      <Sequence from={belowAt} layout="none">
        <Headline top="3 FEET OF DIRT BLOCKS" big="99.9%" sub="of the radiation" delay={0} y={150} bigSize={170} />
      </Sequence>
    </>
  );
};

// ============================================================ timeline
const SCENES = [S1, S2, S3, S4, S5, S6, S7, S8];

export const Bunker: React.FC = () => (
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
        <Audio src={staticFile(`vo/ep008-bunker_${i}.wav`)} />
      </Sequence>
    ))}
    <Watermark />
  </AbsoluteFill>
);

export const BUNKER_START = START;
export const BUNKER_LEN = LEN;
