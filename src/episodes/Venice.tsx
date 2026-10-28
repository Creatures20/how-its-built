// Episode 6: Venice — a city standing on millions of wooden piles driven into mud (v2 kit).
import React, {useMemo} from 'react';
import {AbsoluteFill, Audio, interpolate, Sequence, staticFile, useCurrentFrame, useVideoConfig, Easing} from 'remotion';
import {ThreeCanvas} from '@remotion/three';
import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import VO from './ep006-venice-vo.json';
import {AssetProvider, Renderer, SkyDome, Sun, TexName, useMat, usePlainMat, uvBox, worldUV} from '../hib/pbr';
import {Beam, Bush, Dust, KIT_TEXTURES, Person, Plank, Rope, Water, rnd} from '../hib/models';
import {CameraRig} from '../hib/three';
import {Cam, camPath, groundSafe, toScreen} from '../hib/project';
import {C, Caption, Grade, Headline, SceneFade, StepBadge, Tag, Watermark} from '../hib/ui';

// ============================================================ timing
const FPS = 30;
const VO_DELAY = 5;
const sceneLen = (i: number, tail: number) => Math.ceil((VO.durations[i] + tail) * FPS) + VO_DELAY;
const LEN = [sceneLen(0, 0.5), sceneLen(1, 0.45), sceneLen(2, 0.45), sceneLen(3, 0.45), sceneLen(4, 0.45), sceneLen(5, 0.45), sceneLen(6, 0.45), sceneLen(7, 1.6)];
const START = LEN.map((_, i) => LEN.slice(0, i).reduce((a, b) => a + b, 0));
export const VENICE_DURATION = LEN.reduce((a, b) => a + b, 0);
/** frame (local to scene i) at which the word `w` is spoken, estimated from character position. */
const wordAt = (i: number, w: string) => Math.round(VO_DELAY + (Math.max(0, VO.lines[i].indexOf(w)) / VO.lines[i].length) * VO.durations[i] * FPS);

const cl = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
const ramp = (f: number, a: number, b: number, ease = Easing.inOut(Easing.cubic)) => interpolate(f, [a, b], [0, 1], {...cl, easing: ease});

const TEXTURES: TexName[] = [
  ...KIT_TEXTURES, 'water', 'lagoon_mud', 'caranto', 'end_grain', 'istrian_stone', 'brick_red', 'plaster_ochre', 'plaster_white',
  'limestone_ashlar', 'roof_tiles', 'stone_face_lime', 'dirt', 'iron_dark',
];

// ============================================================ world layout (metres; y = 0 is the lagoon water level, +z toward the camera)
const MUD = -2.2; // lagoon bed / top of the soft mud
const CAR = -4.9; // top of the caranto (hard clay)
const BOT = -22; // bottom of the cutaway block
const CUT = 2.5; // section plane for cutaway scenes (everything with z > CUT is removed)
const COF = {x: 9, z0: -8, t: 0.45}; // cofferdam inner half-width / back wall / thickness
const SAWN = -1.9; // pile heads sawn level
const BEAM_T = 0.25, PLANK_T = 0.12;
const PLAT = SAWN + BEAM_T + PLANK_T; // top of the wooden platform
const STONE_TOP = 0.9; // Istrian stone base: up to just above high water
const BRICK_TOP = 9.6;
const HOUSE = {w: 12, d: 10, wall: 0.8};
const CHURCH = {x: -40, z: -58, r: 11};

// ---- the pile grid under the new house: 3 x 3 per square metre
const SP = 1 / 3;
const NX = 36, NZ = 30;
type PileDef = {x: number; z: number; i: number; j: number; finalTop: number; tip: number; raw: number};
const PILES: PileDef[] = (() => {
  const out: PileDef[] = [];
  for (let j = 0; j < NZ; j++)
    for (let i = 0; i < NX; i++) {
      const x = -HOUSE.w / 2 + SP / 2 + i * SP;
      const z = -HOUSE.d / 2 + SP / 2 + j * SP;
      const k = j * NX + i;
      const finalTop = -1.55 + rnd(k * 1.37 + 3) * 0.3;
      out.push({x, z, i, j, finalTop, tip: finalTop - 3.5, raw: finalTop});
    }
  return out;
})();
// spiral order: outer ring first, from the first pile (left edge) round and inward
const P0_J = 16; // first pile: left edge, z = +0.5
const SPIRAL: number[] = (() => {
  const cx = 0, cz = 0;
  const a0 = Math.atan2(-(PILES[P0_J * NX].z - cz), PILES[P0_J * NX].x - cx);
  const key = PILES.map((p, k) => {
    const ring = Math.min(p.i, p.j, NX - 1 - p.i, NZ - 1 - p.j);
    const a = Math.atan2(-(p.z - cz), p.x - cx);
    let d = a0 - a; // clockwise seen from above
    d = ((d % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    return {k, v: ring * 10 + d};
  });
  key.sort((a, b) => a.v - b.v);
  return key.map((o) => o.k);
})();
const ORDER = (() => {
  const o = new Array(PILES.length).fill(0);
  SPIRAL.forEach((k, n) => (o[k] = n));
  return o;
})();
const P0 = PILES[SPIRAL[0]];

// ---- neighbouring palazzi (canal-front houses rising straight out of the water)
type Pal = {x: number; z: number; w: number; d: number; h: number; tint: string; tex: TexName; seed: number; sideWin?: number};
const PALAZZI: Pal[] = [
  {x: -16.5, z: -5.5, w: 8, d: 12, h: 11.5, tint: '#e8b48c', tex: 'plaster_ochre', seed: 1, sideWin: 1},
  {x: -25, z: -6.5, w: 8.5, d: 13, h: 13.5, tint: '#f1e2c8', tex: 'plaster_white', seed: 2},
  {x: 16.5, z: -5, w: 8, d: 12, h: 12.5, tint: '#d98a6a', tex: 'plaster_ochre', seed: 3, sideWin: -1},
  {x: 25, z: -6, w: 8.5, d: 12, h: 10.5, tint: '#f0d6a0', tex: 'plaster_ochre', seed: 4},
  {x: -21, z: -23, w: 12, d: 12, h: 14, tint: '#e9c9a0', tex: 'plaster_ochre', seed: 5},
  {x: -9, z: -22.5, w: 11, d: 11, h: 10.5, tint: '#ffffff', tex: 'brick_red', seed: 6},
  {x: 9, z: -22.5, w: 11, d: 11, h: 12, tint: '#e6a48a', tex: 'plaster_ochre', seed: 7},
  {x: 21, z: -23, w: 12, d: 12, h: 15, tint: '#f3e6cf', tex: 'plaster_white', seed: 8},
];

// ============================================================ helpers
const box = (w: number, h: number, d: number, x: number, y: number, z: number, ry = 0) => {
  const g = new THREE.BoxGeometry(w, h, d);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return g;
};
/** Window frames + dark glass on a face. Returns [frameGeo, glassGeo] in the palazzo's local frame (front = +z). */
const windowGeos = (w: number, d: number, h: number, seed: number, sideWin = 0) => {
  const frames: THREE.BufferGeometry[] = [];
  const glass: THREE.BufferGeometry[] = [];
  const floors = Math.max(1, Math.floor((h - STONE_TOP - 1.2) / 3.2));
  const add = (u: number, y: number, face: 'front' | 'side', side = 1, door = false) => {
    const fw = door ? 1.9 : 1.05, fh = door ? 2.4 : 1.75;
    const mk = (ww: number, hh: number, dd: number, off: number) => {
      const r = ww / 2;
      const rect = new THREE.BoxGeometry(ww, hh, dd);
      rect.translate(0, hh / 2, 0);
      const arch = new THREE.CylinderGeometry(r, r, dd, 16, 1, false, 0, Math.PI);
      arch.rotateX(Math.PI / 2);
      arch.rotateZ(Math.PI / 2);
      arch.translate(0, hh, 0);
      const g = mergeGeometries([rect.toNonIndexed(), arch.toNonIndexed()])!;
      if (face === 'front') g.translate(u, y, d / 2 + off);
      else {
        g.rotateY((side * Math.PI) / 2);
        g.translate(side * (w / 2 + off), y, u);
      }
      return g;
    };
    frames.push(mk(fw + 0.24, fh + 0.12, 0.1, 0.03));
    glass.push(mk(fw - 0.1, fh - 0.1, 0.04, 0.09));
  };
  const cols = Math.max(2, Math.floor((w - 1) / 2.3));
  for (let fl = 0; fl < floors; fl++) {
    const y = STONE_TOP + 1.5 + fl * 3.2;
    for (let c = 0; c < cols; c++) {
      const u = -w / 2 + (w / cols) * (c + 0.5);
      if (fl === 1 && cols >= 3 && c > 0 && c < cols - 1 && rnd(seed) < 0.6) add(u, y - 0.2, 'front', 1, false);
      else add(u, y, 'front');
    }
    if (sideWin) {
      const sc = Math.max(2, Math.floor((d - 1) / 2.6));
      for (let c = 0; c < sc; c++) add(-d / 2 + (d / sc) * (c + 0.5), y, 'side', sideWin);
    }
  }
  // water door
  add(rnd(seed + 2) < 0.5 ? 0 : -w / 4, -0.2, 'front', 1, true);
  return [mergeGeometries(frames.map((g) => (g.index ? g.toNonIndexed() : g)))!, mergeGeometries(glass.map((g) => (g.index ? g.toNonIndexed() : g)))!];
};

/** Hip roof as a square pyramid scaled to the footprint. */
const hipRoof = (w: number, d: number, rh: number) => {
  const g = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1);
  g.rotateY(Math.PI / 4);
  g.scale(w, rh, d);
  g.translate(0, rh / 2, 0);
  return worldUV(g.toNonIndexed(), 2.2);
};

// ============================================================ models
const FunnelChimney: React.FC<{p: [number, number, number]; mat: THREE.Material}> = ({p, mat}) => (
  <group position={p}>
    <mesh position={[0, 0.8, 0]} material={mat} castShadow>
      <cylinderGeometry args={[0.24, 0.28, 1.6, 10]} />
    </mesh>
    <mesh position={[0, 1.95, 0]} material={mat} castShadow>
      <cylinderGeometry args={[0.62, 0.26, 0.8, 12]} />
    </mesh>
  </group>
);

/** A Venetian canal house: Istrian stone base at the waterline, plastered/brick walls, arched windows, hip roof, funnel chimneys. */
const Palazzo: React.FC<{p: Pal; clipZ?: number}> = ({p}) => {
  const {w, d, h, seed} = p;
  const wall = useMat(p.tex, {tint: p.tint});
  const stone = useMat('istrian_stone');
  const roof = useMat('roof_tiles', {tint: '#e8b9a0'});
  const frameM = useMat('stone_face_lime', {tint: '#f4efe4'});
  const glassM = usePlainMat('#1d2226', 0.25, 0.3);
  const chim = useMat('plaster_white', {tint: '#e0cfb8'});
  const bodyG = useMemo(() => uvBox(w, h - STONE_TOP, d, 3), [w, h, d]);
  const baseG = useMemo(() => uvBox(w + 0.12, STONE_TOP - MUD, d + 0.12, 2.5), [w, d]);
  const corniceG = useMemo(() => uvBox(w + 0.5, 0.35, d + 0.5, 2), [w, d]);
  const [fg, gg] = useMemo(() => windowGeos(w, d, h, seed, p.sideWin ?? 0), [w, d, h, seed, p.sideWin]);
  const roofG = useMemo(() => hipRoof(w + 0.7, d + 0.7, 2.2), [w, d]);
  return (
    <group position={[p.x, 0, p.z]}>
      <mesh geometry={baseG} position={[0, (STONE_TOP + MUD) / 2, 0]} material={stone} castShadow receiveShadow />
      <mesh geometry={bodyG} position={[0, STONE_TOP + (h - STONE_TOP) / 2, 0]} material={wall} castShadow receiveShadow />
      <mesh geometry={fg} material={frameM} castShadow />
      <mesh geometry={gg} material={glassM} />
      <mesh geometry={corniceG} position={[0, h, 0]} material={frameM} castShadow />
      <mesh geometry={roofG} position={[0, h + 0.17, 0]} material={roof} castShadow receiveShadow />
      <FunnelChimney p={[w * 0.25, h + 0.9, -d * 0.2]} mat={chim} />
      {rnd(seed + 5) < 0.6 && <FunnelChimney p={[-w * 0.3, h + 0.7, d * 0.15]} mat={chim} />}
    </group>
  );
};

/** The new house. stoneT/brickT animate the build; finished adds plaster, roof, chimneys. */
const NewHouse: React.FC<{stoneT: number; brickT: number; finished?: boolean; zMax?: number}> = ({stoneT, brickT, finished = false, zMax = 99}) => {
  const {w, d, wall: t} = HOUSE;
  const front = zMax >= d / 2; // whole house, or a section cut at zMax
  const zE = Math.min(zMax - 0.01, d / 2 - t); // where the side walls end
  const sideL = zE - (-d / 2 + t);
  const sideZ = (zE + (-d / 2 + t)) / 2;
  const stone = useMat('istrian_stone');
  const brick = useMat('brick_red');
  const plaster = useMat('plaster_ochre', {tint: '#de8f6e'});
  const roof = useMat('roof_tiles', {tint: '#e8b9a0'});
  const frameM = useMat('stone_face_lime', {tint: '#f4efe4'});
  const glassM = usePlainMat('#1d2226', 0.25, 0.3);
  const fill = useMat('brick_red', {tint: '#b08a70'});
  // stone base: 5 courses of perimeter walls, placed course by course
  const courses = 5;
  const ch = (STONE_TOP - PLAT) / courses;
  const longG = useMemo(() => uvBox(w, ch - 0.02, t, 1.6), [w, ch, t]);
  const shortG = useMemo(() => uvBox(t, ch - 0.02, front ? d - 2 * t : sideL + t, 1.6), [d, ch, t, front, sideL]);
  const wallH = BRICK_TOP - STONE_TOP;
  const bLong = useMemo(() => uvBox(w, wallH, t * 0.85, 1.4), [w, wallH, t]);
  const bShort = useMemo(() => uvBox(t * 0.85, wallH, front ? d - 2 * t : sideL + t, 1.4), [d, wallH, t, front, sideL]);
  const floorG = useMemo(() => uvBox(w - 2 * t, 0.3, d - 2 * t, 2), [w, d, t]);
  const sz = front ? 0 : sideZ + t / 2;
  const [fg, gg] = useMemo(() => windowGeos(w, d, BRICK_TOP, 11, 1), [w, d]);
  const roofG = useMemo(() => hipRoof(w + 0.8, d + 0.8, 2.6), [w, d]);
  const corniceG = useMemo(() => uvBox(w + 0.5, 0.35, d + 0.5, 2), [w, d]);
  const wm = finished ? plaster : brick;
  const clip = useMemo(() => new THREE.Plane(new THREE.Vector3(0, -1, 0), 0), []);
  clip.constant = STONE_TOP + wallH * brickT;
  const clipArr = useMemo(() => [clip], [clip]);
  const brickClipped = useMat('brick_red', {clip: clipArr});
  return (
    <group>
      {Array.from({length: courses}, (_, c) => {
        const k = Math.min(1, Math.max(0, stoneT * courses - c));
        if (k <= 0) return null;
        const y = PLAT + ch * (c + 0.5) + (1 - Easing.out(Easing.cubic)(k)) * 2.5;
        return (
          <group key={c} position={[0, y, 0]}>
            {front && <mesh geometry={longG} position={[0, 0, d / 2 - t / 2]} material={stone} castShadow receiveShadow />}
            <mesh geometry={longG} position={[0, 0, -d / 2 + t / 2]} material={stone} castShadow receiveShadow />
            <mesh geometry={shortG} position={[w / 2 - t / 2, 0, sz]} material={stone} castShadow receiveShadow />
            <mesh geometry={shortG} position={[-w / 2 + t / 2, 0, sz]} material={stone} castShadow receiveShadow />
          </group>
        );
      })}
      {stoneT >= 1 && finished && <mesh geometry={floorG} position={[0, STONE_TOP - 0.15, 0]} material={fill} receiveShadow />}
      {brickT > 0 && (
        <group position={[0, STONE_TOP + wallH / 2, 0]}>
          {front && <mesh geometry={bLong} position={[0, 0, d / 2 - t / 2]} material={finished ? wm : brickClipped} castShadow receiveShadow />}
          <mesh geometry={bLong} position={[0, 0, -d / 2 + t / 2]} material={finished ? wm : brickClipped} castShadow receiveShadow />
          <mesh geometry={bShort} position={[w / 2 - t / 2, 0, sz]} material={finished ? wm : brickClipped} castShadow receiveShadow />
          <mesh geometry={bShort} position={[-w / 2 + t / 2, 0, sz]} material={finished ? wm : brickClipped} castShadow receiveShadow />
        </group>
      )}
      {finished && (
        <>
          <mesh geometry={fg} material={frameM} castShadow />
          <mesh geometry={gg} material={glassM} />
          <mesh geometry={corniceG} position={[0, BRICK_TOP, 0]} material={frameM} castShadow />
          <mesh geometry={roofG} position={[0, BRICK_TOP + 0.17, 0]} material={roof} castShadow receiveShadow />
          <FunnelChimney p={[w * 0.28, BRICK_TOP + 1.1, -d * 0.15]} mat={frameM} />
          <FunnelChimney p={[-w * 0.25, BRICK_TOP + 0.9, d * 0.1]} mat={frameM} />
        </>
      )}
    </group>
  );
};

/** Original octagonal domed church (baroque-style) on its own stone island. */
const Church: React.FC<{xray?: number}> = ({xray = 0}) => {
  const {x, z, r} = CHURCH;
  const stone = useMat('limestone_ashlar', {tint: '#f3ece0'});
  const smooth = useMat('stone_face_lime', {tint: '#efe8da'});
  const dome = useMat('stone_face_lime', {tint: '#d9d6d0'});
  const dark = usePlainMat('#22252a', 0.4, 0.2);
  const isl = useMat('istrian_stone', {transparent: true});
  isl.opacity = 1 - 0.9 * xray;
  isl.depthWrite = xray < 0.05;
  const islG = useMemo(() => uvBox(36, STONE_TOP - MUD, 40, 2.5), []);
  const steps = useMemo(() => [0, 1, 2].map((i) => uvBox(16 - i * 1.5, 0.3, 1.2, 1.5)), []);
  const pedG = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(-7.4, 0);
    s.lineTo(7.4, 0);
    s.lineTo(0, 3.4);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, {depth: 1.6, bevelEnabled: false});
    return worldUV(g, 3);
  }, []);
  const base = STONE_TOP;
  return (
    <group position={[x, 0, z]}>
      <mesh geometry={islG} position={[0, (STONE_TOP + MUD) / 2, 0]} material={isl} castShadow receiveShadow />
      {steps.map((g, i) => (
        <mesh key={i} geometry={g} position={[0, base + 0.15 + i * 0.3, r + 3.8 - i * 1.1]} material={smooth} castShadow receiveShadow />
      ))}
      {/* octagonal body */}
      <mesh position={[0, base + 10, 0]} rotation={[0, Math.PI / 8, 0]} material={stone} castShadow receiveShadow>
        <cylinderGeometry args={[r, r, 20, 8]} />
      </mesh>
      <mesh position={[0, base + 20.4, 0]} rotation={[0, Math.PI / 8, 0]} material={smooth} castShadow>
        <cylinderGeometry args={[r + 0.6, r + 0.6, 0.8, 8]} />
      </mesh>
      {/* scroll buttresses */}
      {Array.from({length: 8}, (_, i) => {
        const a = (i / 8) * Math.PI * 2;
        return (
          <group key={i} position={[Math.sin(a) * (r - 1.2), base + 22.2, Math.cos(a) * (r - 1.2)]} rotation={[0, a, 0]}>
            <mesh rotation={[0, Math.PI / 2, 0]} material={smooth} castShadow>
              <torusGeometry args={[1.3, 0.55, 8, 16]} />
            </mesh>
          </group>
        );
      })}
      {/* drum with windows */}
      <mesh position={[0, base + 25.5, 0]} material={stone} castShadow>
        <cylinderGeometry args={[7.6, 7.6, 9, 24]} />
      </mesh>
      {Array.from({length: 12}, (_, i) => {
        const a = (i / 12) * Math.PI * 2;
        return (
          <mesh key={i} position={[Math.sin(a) * 7.55, base + 25.5, Math.cos(a) * 7.55]} rotation={[0, a, 0]} material={dark}>
            <boxGeometry args={[1.2, 3.4, 0.3]} />
          </mesh>
        );
      })}
      <mesh position={[0, base + 30.1, 0]} material={smooth} castShadow>
        <cylinderGeometry args={[8.1, 8.1, 0.6, 24]} />
      </mesh>
      {/* main dome + lantern */}
      <mesh position={[0, base + 30.3, 0]} scale={[1, 1.25, 1]} material={dome} castShadow>
        <sphereGeometry args={[7.9, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
      </mesh>
      <mesh position={[0, base + 41.2, 0]} material={stone} castShadow>
        <cylinderGeometry args={[1.5, 1.6, 3.2, 12]} />
      </mesh>
      <mesh position={[0, base + 42.8, 0]} scale={[1, 1.3, 1]} material={dome} castShadow>
        <sphereGeometry args={[1.6, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
      </mesh>
      <mesh position={[0, base + 45.4, 0]} material={stone}>
        <cylinderGeometry args={[0.15, 0.3, 1.6, 8]} />
      </mesh>
      {/* portico */}
      <mesh position={[0, base + 8.5, r + 0.6]} material={stone} castShadow receiveShadow>
        <boxGeometry args={[14, 17, 3]} />
      </mesh>
      {[-5.2, -1.8, 1.8, 5.2].map((cx) => (
        <mesh key={cx} position={[cx, base + 7.5, r + 2.3]} material={smooth} castShadow>
          <cylinderGeometry args={[0.6, 0.65, 15, 14]} />
        </mesh>
      ))}
      <mesh geometry={pedG} position={[0, base + 17, r + 0.6]} material={smooth} castShadow />
      <mesh position={[0, base + 3.2, r + 2.15]} material={dark}>
        <boxGeometry args={[3, 6.4, 0.2]} />
      </mesh>
      {/* rear small dome + bell towers */}
      <mesh position={[0, base + 11, -r - 6]} material={stone} castShadow>
        <cylinderGeometry args={[6, 6, 22, 16]} />
      </mesh>
      <mesh position={[0, base + 22, -r - 6]} scale={[1, 1.15, 1]} material={dome} castShadow>
        <sphereGeometry args={[6, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
      </mesh>
      {[-1, 1].map((s) => (
        <group key={s} position={[s * 8, 0, -r - 8]}>
          <mesh position={[0, base + 13, 0]} material={stone} castShadow>
            <boxGeometry args={[3.2, 26, 3.2]} />
          </mesh>
          <mesh position={[0, base + 27, 0]} scale={[1, 1.4, 1]} material={dome} castShadow>
            <sphereGeometry args={[1.8, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
          </mesh>
        </group>
      ))}
    </group>
  );
};

/** Pile forest under the church island (only visible in the hook's x-ray). */
const ChurchPiles: React.FC = () => {
  const bark = useMat('bark', {repeat: [1, 3], tint: '#e0b890', emissive: '#3a2410', emissiveIntensity: 0.5});
  const end = useMat('end_grain');
  const [sides, caps] = useMemo(() => {
    const a: THREE.BufferGeometry[] = [];
    const b: THREE.BufferGeometry[] = [];
    let k = 0;
    for (let i = 0; i < 44; i++)
      for (let j = 0; j < 48; j++) {
        const x = CHURCH.x - 17.2 + i * 0.8, z = CHURCH.z - 18.8 + j * 0.8;
        const top = -1.3 + rnd(k++) * 0.2;
        const g = new THREE.CylinderGeometry(0.22, 0.2, 3.5, 7, 1, true);
        g.translate(x, top - 1.75, z);
        a.push(g);
        const c = new THREE.CircleGeometry(0.22, 7);
        c.rotateX(-Math.PI / 2);
        c.translate(x, top, z);
        b.push(c);
      }
    return [mergeGeometries(a)!, mergeGeometries(b)!];
  }, []);
  return (
    <group>
      <mesh geometry={sides} material={bark} castShadow />
      <mesh geometry={caps} material={end} />
    </group>
  );
};

/** Boat hull (plan shape extruded), black gondola-like or a wooden barge. */
const Boat: React.FC<{p: [number, number, number]; rotY?: number; len?: number; beam?: number; color?: string; barge?: boolean; children?: React.ReactNode}> = ({p, rotY = 0, len = 10, beam = 1.4, color = '#1c1917', barge = false, children}) => {
  const wood = useMat('wood_oak', {tint: '#9a7a5a'});
  const black = usePlainMat(color, 0.35, 0.1);
  const geo = useMemo(() => {
    const s = new THREE.Shape();
    const L = len / 2, B = beam / 2;
    s.moveTo(-L, 0);
    s.quadraticCurveTo(-L * 0.6, B, 0, B);
    s.quadraticCurveTo(L * 0.6, B, L, 0);
    s.quadraticCurveTo(L * 0.6, -B, 0, -B);
    s.quadraticCurveTo(-L * 0.6, -B, -L, 0);
    const g = new THREE.ExtrudeGeometry(s, {depth: barge ? 0.9 : 0.6, bevelEnabled: true, bevelSize: 0.08, bevelThickness: 0.08, bevelSegments: 2, curveSegments: 12});
    g.rotateX(-Math.PI / 2);
    return worldUV(g, 2);
  }, [len, beam, barge]);
  return (
    <group position={p} rotation={[0, rotY, 0]}>
      <mesh geometry={geo} position={[0, -0.35, 0]} material={barge ? wood : black} castShadow receiveShadow />
      {children}
    </group>
  );
};

/** Bundle of mooring poles (bricola). */
const Bricola: React.FC<{p: [number, number]}> = ({p}) => (
  <group position={[p[0], 0, p[1]]}>
    <Beam a={[0, MUD, 0]} b={[0, 2.6, 0]} r={0.16} tex="wood_oak" />
    <Beam a={[0.3, MUD, 0.1]} b={[0.12, 2.3, 0.04]} r={0.15} tex="wood_oak" />
    <Beam a={[-0.15, MUD, 0.28]} b={[-0.05, 2.2, 0.1]} r={0.15} tex="wood_oak" />
    <Rope a={[-0.2, 1.8, 0.15]} b={[0.28, 1.8, 0.1]} sag={0.05} r={0.04} />
  </group>
);

/** Brick arch bridge over the side canal, with stone edges. */
const ArchBridge: React.FC<{x: number; z: number; span?: number}> = ({x, z, span = 7}) => {
  const brick = useMat('brick_red');
  const stone = useMat('istrian_stone');
  const geo = useMemo(() => {
    const s = new THREE.Shape();
    const L = span / 2 + 1.5;
    s.moveTo(-L, STONE_TOP);
    s.quadraticCurveTo(0, STONE_TOP + 3.2, L, STONE_TOP);
    s.lineTo(L, MUD);
    s.lineTo(span / 2, MUD);
    s.lineTo(span / 2, 0.6);
    s.absarc(0, 0.6, span / 2, 0, Math.PI, false);
    s.lineTo(-span / 2, MUD);
    s.lineTo(-L, MUD);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, {depth: 3, bevelEnabled: false, curveSegments: 18});
    g.translate(0, 0, -1.5);
    return worldUV(g, 1.6);
  }, [span]);
  const railG = useMemo(() => {
    const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(-span / 2 - 1.5, STONE_TOP + 0.5, 0), new THREE.Vector3(0, STONE_TOP + 3.7, 0), new THREE.Vector3(span / 2 + 1.5, STONE_TOP + 0.5, 0));
    return new THREE.TubeGeometry(curve, 24, 0.12, 6, false);
  }, [span]);
  return (
    <group position={[x, 0, z]}>
      <mesh geometry={geo} material={brick} castShadow receiveShadow />
      {[-1.45, 1.45].map((dz) => (
        <mesh key={dz} geometry={railG} position={[0, 0, dz]} material={stone} castShadow />
      ))}
    </group>
  );
};

/** Quay walkway (fondamenta) with Istrian stone edge. */
const Fondamenta: React.FC<{x0: number; x1: number; z0: number; z1: number}> = ({x0, x1, z0, z1}) => {
  const stone = useMat('istrian_stone');
  const pave = useMat('stone_face_lime', {tint: '#cfc6b6'});
  const g = useMemo(() => uvBox(x1 - x0, STONE_TOP - MUD, z1 - z0, 2), [x0, x1, z0, z1]);
  const top = useMemo(() => uvBox(x1 - x0, 0.05, z1 - z0, 1.2), [x0, x1, z0, z1]);
  return (
    <group position={[(x0 + x1) / 2, 0, (z0 + z1) / 2]}>
      <mesh geometry={g} position={[0, (STONE_TOP + MUD) / 2, 0]} material={stone} castShadow receiveShadow />
      <mesh geometry={top} position={[0, STONE_TOP + 0.02, 0]} material={pave} receiveShadow />
    </group>
  );
};

/** Distant city: low blocks + a brick campanile. `maxZ` drops everything in front of a cut. */
const Skyline: React.FC<{maxZ?: number}> = ({maxZ = 999}) => {
  const ref = React.useRef<THREE.InstancedMesh>(null);
  const plaster = useMat('plaster_white', {tint: '#e8cfb0'});
  const brick = useMat('brick_red');
  const roof = useMat('roof_tiles', {tint: '#e8b9a0'});
  const items = useMemo(() => {
    const o: {x: number; z: number; w: number; d: number; h: number}[] = [];
    for (let i = 0; i < 160; i++) {
      const a = rnd(i * 2.1) * Math.PI * 2;
      const r = 70 + rnd(i * 3.7) * 140;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (z > maxZ - 6) continue;
      if (Math.hypot(x - CHURCH.x, z - CHURCH.z) < 30) continue;
      if (z > 10 && Math.abs(x) < 70) continue; // keep the open lagoon in front clear
      o.push({x, z, w: 8 + rnd(i) * 10, d: 8 + rnd(i + 9) * 10, h: 9 + rnd(i * 5) * 9});
    }
    return o;
  }, [maxZ]);
  const geo = useMemo(() => uvBox(1, 1, 1, 0.12), []);
  React.useLayoutEffect(() => {
    const ob = new THREE.Object3D();
    const col = new THREE.Color();
    items.forEach((b, k) => {
      ob.position.set(b.x, b.h / 2 - 0.5, b.z);
      ob.scale.set(b.w, b.h + 1, b.d);
      ob.rotation.y = rnd(k * 1.9) * 0.4;
      ob.updateMatrix();
      ref.current!.setMatrixAt(k, ob.matrix);
      col.setHSL(0.06 + rnd(k) * 0.05, 0.45, 0.62 + rnd(k * 3) * 0.18);
      ref.current!.setColorAt(k, col);
    });
    ref.current!.instanceMatrix.needsUpdate = true;
    if (ref.current!.instanceColor) ref.current!.instanceColor.needsUpdate = true;
  }, [items]);
  const camp = maxZ > -120;
  return (
    <group>
      <instancedMesh ref={ref} args={[geo, plaster, Math.max(1, items.length)]} castShadow receiveShadow frustumCulled={false} />
      {camp && (
        <group position={[46, 0, -125]}>
          <mesh position={[0, 26, 0]} material={brick} castShadow>
            <boxGeometry args={[6, 52, 6]} />
          </mesh>
          <mesh position={[0, 54, 0]} material={plaster}>
            <boxGeometry args={[6.4, 4, 6.4]} />
          </mesh>
          <mesh position={[0, 59.5, 0]} rotation={[0, Math.PI / 4, 0]} material={roof} castShadow>
            <coneGeometry args={[4.6, 8, 4]} />
          </mesh>
        </group>
      )}
    </group>
  );
};

// ============================================================ the lagoon: water, mud, caranto
/** Water surface + (optionally) a translucent water volume box. */
const WaterBox: React.FC<{x0: number; x1: number; z0: number; z1: number; top?: number; f: number; volume?: boolean}> = ({x0, x1, z0, z1, top = 0, f, volume = true}) => {
  const vol = useMemo(() => new THREE.MeshStandardMaterial({color: '#2c6f78', roughness: 0.2, transparent: true, opacity: 0.5, depthWrite: false}), []);
  const h = top - MUD;
  if (x1 <= x0 || z1 <= z0 || h <= 0.01) return null;
  return (
    <group>
      <Water w={x1 - x0} d={z1 - z0} position={[(x0 + x1) / 2, top, (z0 + z1) / 2]} time={f / 30} color="#4f9aa0" texScale={7} />
      {volume && (
        <mesh position={[(x0 + x1) / 2, MUD + h / 2 - 0.01, (z0 + z1) / 2]} material={vol}>
          <boxGeometry args={[x1 - x0, h - 0.02, z1 - z0]} />
        </mesh>
      )}
    </group>
  );
};

/** Mud + caranto block (cut at zMax), textured with world-scaled UVs. */
const Ground3: React.FC<{zMax: number; ext?: number}> = ({zMax, ext = 90}) => {
  const mud = useMat('lagoon_mud');
  const car = useMat('caranto', {tint: '#c9bba0'});
  const mudG = useMemo(() => uvBox(2 * ext, MUD - CAR, zMax + ext, 3), [zMax, ext]);
  const carG = useMemo(() => uvBox(2 * ext, CAR - BOT, zMax + ext, 3.5), [zMax, ext]);
  return (
    <group>
      <mesh geometry={mudG} position={[0, (MUD + CAR) / 2, (zMax - ext) / 2]} material={mud} receiveShadow />
      <mesh geometry={carG} position={[0, (CAR + BOT) / 2, (zMax - ext) / 2]} material={car} receiveShadow />
    </group>
  );
};

// ============================================================ the pile field
export type PileState = {
  prog: number; // spiral piles fully driven (continuous; the fractional one is dropping in)
  p0Top?: number; // explicit top of the first pile while the rig drives it
  sawK?: number; // 0..1 sweep of the saw (left → right)
  cut: boolean;
};
const pileTopAt = (p: PileDef, k: number, s: PileState): number | null => {
  const n = ORDER[k];
  let top: number | null = null;
  if (n === 0 && s.p0Top !== undefined) top = s.p0Top;
  else if (n < Math.floor(s.prog)) top = p.finalTop;
  else if (n === Math.floor(s.prog)) {
    const fr = s.prog - n;
    top = fr <= 0 ? null : p.finalTop + (1 - Easing.out(Easing.quad)(fr)) * 2.8;
  }
  if (top === null) return null;
  if (s.sawK !== undefined) {
    const sweepX = -HOUSE.w / 2 - 0.5 + s.sawK * (HOUSE.w + 1);
    if (p.x < sweepX) top = Math.min(top, SAWN);
  }
  return top;
};

const PileField: React.FC<{s: PileState; pegs?: boolean}> = ({s, pegs = true}) => {
  const ref = React.useRef<THREE.InstancedMesh>(null);
  const pref = React.useRef<THREE.InstancedMesh>(null);
  const bark = useMat('bark', {repeat: [1, 3.5], tint: '#b49a80'});
  const end = useMat('end_grain');
  const pegM = usePlainMat('#e9d8a6', 0.8);
  const geo = useMemo(() => new THREE.CylinderGeometry(0.12, 0.105, 1, 10), []);
  const pegGeo = useMemo(() => new THREE.CylinderGeometry(0.025, 0.02, 1, 5), []);
  const list = useMemo(() => PILES.map((p, k) => ({p, k})).filter(({p}) => !s.cut || p.z <= CUT + 0.01), [s.cut]);
  React.useLayoutEffect(() => {
    const o = new THREE.Object3D();
    let a = 0, b = 0;
    list.forEach(({p, k}) => {
      const top = pileTopAt(p, k, s);
      if (top !== null) {
        const tip = Math.min(top - 0.3, Math.max(p.tip, top - 3.5));
        const len = top - tip;
        o.position.set(p.x, (top + tip) / 2, p.z);
        o.scale.set(1, len, 1);
        o.rotation.set(0, rnd(k) * 6, 0);
        o.updateMatrix();
        ref.current!.setMatrixAt(a++, o.matrix);
      } else if (pegs) {
        o.position.set(p.x, MUD + 0.2, p.z);
        o.scale.set(1, 0.45, 1);
        o.rotation.set(0, 0, 0);
        o.updateMatrix();
        pref.current!.setMatrixAt(b++, o.matrix);
      }
    });
    ref.current!.count = a;
    pref.current!.count = b;
    ref.current!.instanceMatrix.needsUpdate = true;
    pref.current!.instanceMatrix.needsUpdate = true;
  });
  return (
    <group>
      <instancedMesh ref={ref} args={[geo, [bark, end, end], list.length]} castShadow receiveShadow frustumCulled={false} />
      <instancedMesh ref={pref} args={[pegGeo, pegM, list.length]} castShadow frustumCulled={false} />
    </group>
  );
};

/** Wooden platform on the sawn pile heads: cross beams (along x) then planks (along z). */
const Platform: React.FC<{beamT: number; plankT: number; cut: boolean}> = ({beamT, plankT, cut}) => {
  const oak = useMat('wood_oak', {tint: '#c9a27a'});
  const larch = useMat('wood_pine', {tint: '#d8b88e'});
  const zMax = cut ? CUT - 0.02 : HOUSE.d / 2;
  const rows = useMemo(() => {
    const o: number[] = [];
    for (let z = -HOUSE.d / 2 + 0.3; z < zMax - 0.1; z += 1.0) o.push(z);
    return o;
  }, [zMax]);
  const cols = useMemo(() => {
    const o: number[] = [];
    for (let x = -HOUSE.w / 2 + 0.2; x < HOUSE.w / 2; x += 0.42) o.push(x);
    return o;
  }, []);
  const beamG = useMemo(() => uvBox(HOUSE.w, BEAM_T, 0.3, 2), []);
  const plankLen = zMax + HOUSE.d / 2;
  const plankG = useMemo(() => uvBox(0.4, PLANK_T, plankLen, 2), [plankLen]);
  return (
    <group>
      {rows.map((z, i) => {
        const k = Math.min(1, Math.max(0, beamT * rows.length - (rows.length - 1 - i)));
        if (k <= 0) return null;
        return <mesh key={i} geometry={beamG} position={[0, SAWN + BEAM_T / 2 + (1 - Easing.out(Easing.cubic)(k)) * 3, z]} material={oak} castShadow receiveShadow />;
      })}
      {cols.map((x, i) => {
        const k = Math.min(1, Math.max(0, plankT * cols.length - i));
        if (k <= 0) return null;
        return <mesh key={i} geometry={plankG} position={[x, SAWN + BEAM_T + PLANK_T / 2 + (1 - Easing.out(Easing.cubic)(k)) * 3, (zMax - HOUSE.d / 2) / 2]} material={larch} castShadow receiveShadow />;
      })}
    </group>
  );
};

/** Cofferdam: double plank wall filled with clay, posts. `drop` sinks it out of sight (removal). */
const Cofferdam: React.FC<{cut: boolean; drop?: number}> = ({cut, drop = 0}) => {
  const plank = useMat('wood_pine', {tint: '#b89870'});
  const clay = useMat('dirt', {tint: '#9a8a70'});
  const zF = cut ? CUT - 0.06 : -COF.z0;
  const y0 = MUD - 1.2, y1 = 0.6;
  const H = y1 - y0;
  const L = zF - COF.z0 + COF.t;
  const sideG = useMemo(() => uvBox(0.12, H, L, 2), [H, L]);
  const sideFill = useMemo(() => uvBox(COF.t - 0.24, H - 0.3, L, 2), [H, L]);
  const backG = useMemo(() => uvBox(2 * COF.x + 2 * COF.t, H, 0.12, 2), [H]);
  const backFill = useMemo(() => uvBox(2 * COF.x + 2 * COF.t, H - 0.3, COF.t - 0.24, 2), [H]);
  const posts = useMemo(() => {
    const o: [number, number][] = [];
    for (let z = COF.z0; z <= zF - 0.2; z += 1.6) o.push([-COF.x - COF.t / 2, z], [COF.x + COF.t / 2, z]);
    for (let x = -COF.x + 1.6; x < COF.x - 0.5; x += 1.6) o.push([x, COF.z0 - COF.t / 2]);
    if (!cut) for (let x = -COF.x + 1.6; x < COF.x - 0.5; x += 1.6) o.push([x, -COF.z0 + COF.t / 2]);
    return o;
  }, [zF, cut]);
  const zc = (COF.z0 - COF.t + zF) / 2;
  return (
    <group position={[0, -drop, 0]}>
      {[-1, 1].map((s) => (
        <group key={s}>
          <mesh geometry={sideG} position={[s * (COF.x + 0.06), y0 + H / 2, zc]} material={plank} castShadow receiveShadow />
          <mesh geometry={sideG} position={[s * (COF.x + COF.t - 0.06), y0 + H / 2, zc]} material={plank} castShadow receiveShadow />
          <mesh geometry={sideFill} position={[s * (COF.x + COF.t / 2), y0 + (H - 0.3) / 2, zc]} material={clay} receiveShadow />
        </group>
      ))}
      {[COF.z0 - 0.06, COF.z0 - COF.t + 0.06].map((z, i) => (
        <mesh key={i} geometry={backG} position={[0, y0 + H / 2, z]} material={plank} castShadow receiveShadow />
      ))}
      <mesh geometry={backFill} position={[0, y0 + (H - 0.3) / 2, COF.z0 - COF.t / 2]} material={clay} receiveShadow />
      {!cut && (
        <>
          {[-COF.z0 + 0.06, -COF.z0 + COF.t - 0.06].map((z, i) => (
            <mesh key={i} geometry={backG} position={[0, y0 + H / 2, z]} material={plank} castShadow receiveShadow />
          ))}
          <mesh geometry={backFill} position={[0, y0 + (H - 0.3) / 2, -COF.z0 + COF.t / 2]} material={clay} receiveShadow />
        </>
      )}
      {posts.map(([x, z], i) => (
        <Beam key={i} a={[x, y0, z]} b={[x, y1 + 0.5, z]} r={0.12} square tex="wood_oak" />
      ))}
      {/* ladder down into the pit (back wall) */}
      {[-0.35, 0.35].map((dx) => (
        <Beam key={dx} a={[3 + dx, MUD, COF.z0 + 0.9]} b={[3 + dx, y1 + 0.8, COF.z0 + 0.05]} r={0.05} square tex="wood_pine" />
      ))}
      {Array.from({length: 9}, (_, i) => {
        const t = (i + 0.5) / 9;
        return <Beam key={i} a={[2.65, MUD + t * (y1 + 0.8 - MUD), COF.z0 + 0.9 - t * 0.85]} b={[3.35, MUD + t * (y1 + 0.8 - MUD), COF.z0 + 0.9 - t * 0.85]} r={0.035} tex="wood_pine" />;
      })}
    </group>
  );
};

/** Barge loaded with logs (pile timber), moored behind the cofferdam. */
const LogBarge: React.FC<{p: [number, number, number]}> = ({p}) => {
  const bark = useMat('bark', {repeat: [1, 3]});
  const end = useMat('end_grain');
  const tints = ['#c7a98a', '#9a7a62', '#b3a088'];
  const logs = useMemo(() => {
    const o: {x: number; y: number; z: number; t: number}[] = [];
    for (let row = 0; row < 3; row++)
      for (let i = 0; i < 6 - row; i++) o.push({x: 0, y: 0.75 + row * 0.24, z: -1.0 + (i + row * 0.5) * 0.25 + 0.15, t: (i + row) % 3});
    return o;
  }, []);
  const mats = useMemo(() => tints.map((t) => {
    const m = bark.clone();
    m.color = new THREE.Color(t);
    return m;
  }), [bark]);
  return (
    <Boat p={p} len={11} beam={3.2} barge>
      {logs.map((l, i) => (
        <mesh key={i} position={[l.x, l.y, l.z]} rotation={[0, 0, Math.PI / 2]} material={[mats[l.t], end, end]} castShadow>
          <cylinderGeometry args={[0.12, 0.11, 7.5, 10]} />
        </mesh>
      ))}
    </Boat>
  );
};

// ============================================================ the pile driver (battipali)
const RIG_H = 6.3;
const RIG_PERIOD = 38;
/** Lift (m) of the ram at local frame f, and whether an impact happened in the last frames. */
const ramAt = (f: number) => {
  const u = (((f % RIG_PERIOD) + RIG_PERIOD) % RIG_PERIOD) / RIG_PERIOD;
  if (u < 0.66) return 1.5 * Easing.inOut(Easing.sin)(u / 0.66);
  if (u < 0.74) return 1.5;
  if (u < 0.8) return 1.5 * (1 - Math.pow((u - 0.74) / 0.06, 2));
  return 0;
};
const impacts = (f: number) => Math.max(0, Math.floor((f - 0.8 * RIG_PERIOD) / RIG_PERIOD) + 1);
const sinceImpact = (f: number) => {
  const u = (((f - 0.8 * RIG_PERIOD) % RIG_PERIOD) + RIG_PERIOD) % RIG_PERIOD;
  return f < 0.8 * RIG_PERIOD ? 999 : u;
};

/** Six workers pulling ropes that lift the ram over a pulley; the ram drops on the pile head. */
const WORKER_ANG = [0.05, 0.62, 1.2, 1.78, 2.36, 2.95];
const RIG_R = 2.7;
const workerPos = (a: number): [number, number, number] => [P0.x + Math.cos(a) * RIG_R, MUD, P0.z - Math.sin(a) * RIG_R];

const PileDriver: React.FC<{f: number; pileTop: number; active: boolean}> = ({f, pileTop, active}) => {
  const iron = useMat('iron_dark');
  const ramM = useMat('wood_oak', {tint: '#8a6a4a'});
  const wheel = useMat('wood_oak');
  const lift = active ? ramAt(f) : 0;
  const g = MUD;
  const px = P0.x, pz = P0.z;
  const top = g + RIG_H;
  const ramBottom = pileTop + lift;
  const ramTop = ramBottom + 0.7;
  const ringY = g + 3.4 - lift;
  const since = active ? sinceImpact(f) : 999;
  const dustM = useMemo(() => Array.from({length: 7}, () => new THREE.MeshStandardMaterial({color: '#5d544a', roughness: 1, transparent: true, depthWrite: false})), []);
  return (
    <group>
      {/* frame */}
      {[-0.42, 0.42].map((dx) => (
        <Beam key={dx} a={[px + dx, g - 0.4, pz]} b={[px + dx, top, pz]} r={0.09} square tex="wood_oak" />
      ))}
      <Beam a={[px - 0.7, top, pz]} b={[px + 0.7, top, pz]} r={0.11} square tex="wood_oak" />
      <Beam a={[px - 0.42, top - 0.6, pz]} b={[px - 2.0, g, pz - 0.2]} r={0.07} square tex="wood_oak" />
      <Beam a={[px + 0.42, top - 0.6, pz]} b={[px + 2.0, g, pz - 0.2]} r={0.07} square tex="wood_oak" />
      <Beam a={[px, top - 0.3, pz - 0.1]} b={[px, g, pz - 2.4]} r={0.07} square tex="wood_oak" />
      <Beam a={[px - 0.42, g + 0.6, pz]} b={[px + 0.42, g + 0.6, pz]} r={0.05} square tex="wood_oak" />
      {/* pulley */}
      <mesh position={[px, top - 0.25, pz]} rotation={[0, 0, 0]} material={wheel} castShadow>
        <torusGeometry args={[0.28, 0.06, 8, 20]} />
      </mesh>
      {/* ram (maglio): oak block with iron bands */}
      <group position={[px, (ramBottom + ramTop) / 2, pz]}>
        <mesh material={ramM} castShadow>
          <boxGeometry args={[0.6, 0.7, 0.5]} />
        </mesh>
        {[-0.25, 0.25].map((y) => (
          <mesh key={y} position={[0, y, 0]} material={iron} castShadow>
            <boxGeometry args={[0.64, 0.08, 0.54]} />
          </mesh>
        ))}
      </group>
      {/* ropes: ram → pulley → ring → six workers */}
      <Rope a={[px, ramTop, pz]} b={[px - 0.02, top - 0.25, pz]} sag={0} r={0.025} />
      <Rope a={[px + 0.27, top - 0.25, pz]} b={[px + 0.3, ringY, pz - 0.1]} sag={0} r={0.025} />
      <mesh position={[px + 0.3, ringY, pz - 0.1]} rotation={[Math.PI / 2, 0, 0]} material={iron}>
        <torusGeometry args={[0.09, 0.025, 6, 12]} />
      </mesh>
      {WORKER_ANG.map((a, i) => {
        const [wx, , wz] = workerPos(a);
        const sh: [number, number, number] = [wx - Math.cos(a) * 0.05, g + 1.38, wz + Math.sin(a) * 0.05];
        return <Rope key={i} a={[px + 0.3, ringY, pz - 0.1]} b={sh} sag={0.02} r={0.02} />;
      })}
      {WORKER_ANG.map((a, i) => (
        <Person key={i} position={workerPos(a)} rotY={a} pose={active ? 'pull' : 'stand'} seed={60 + i} head={i % 2 ? 'cloth' : 'hair'} outfit={['#e9e0cc', '#8f6d4a', '#7c8b9c', '#c9b48e', '#a2503a', '#6b7c4e'][i]} pants="#5a4a3a" />
      ))}
      {/* mud splash at impact */}
      {since < 18 &&
        dustM.map((m, i) => {
          const ph = since / 18;
          const ang = (i / dustM.length) * Math.PI * 2;
          m.opacity = 0.5 * (1 - ph);
          return (
            <mesh key={i} material={m} position={[px + Math.cos(ang) * (0.25 + ph * 0.6), pileTop + 0.05 + ph * 0.25, pz + Math.sin(ang) * (0.25 + ph * 0.6)]} scale={0.1 + ph * 0.18}>
              <icosahedronGeometry args={[1, 1]} />
            </mesh>
          );
        })}
    </group>
  );
};
/** Top of the first pile while the rig drives it (local frame f since driving started). */
const P0_START = -2.2 + 3.5 - 0.5; // tip 0.5 m into the mud
const P0_STEP = 0.3;
const p0TopAt = (fDrive: number) => Math.max(P0.finalTop, P0_START - impacts(fDrive) * P0_STEP);
const P0_DRIVEN_AT = Math.ceil((P0_START - P0.finalTop) / P0_STEP) * RIG_PERIOD + 0.8 * RIG_PERIOD; // frames to finish

// ============================================================ atmosphere + stage
const Atmos: React.FC<{f: number; golden?: number; shadow?: number; target?: [number, number, number]}> = ({f, golden = 0, shadow = 40, target = [0, 0, 0]}) => {
  const sunDir: [number, number, number] = [-0.5 - 0.35 * golden, 0.95 - 0.6 * golden, 0.55];
  const sunCol = new THREE.Color('#fff1dc').lerp(new THREE.Color('#ffbd72'), golden).getStyle();
  const hor = new THREE.Color('#c4d8ea').lerp(new THREE.Color('#f4cfa0'), golden).getStyle();
  return (
    <>
      <Renderer exposure={1.0 + 0.08 * golden} envIntensity={0.55} />
      <SkyDome top={golden ? '#4470b4' : '#2a62b8'} horizon={hor} bottom="#2a2520" sunDir={sunDir} sunColor={sunCol} clouds={0.42} time={f / 30} />
      <Sun dir={sunDir} intensity={3.0} color={sunCol} shadowSize={shadow} shadowRes={4096} target={target} skyColor="#bcd8f5" groundColor="#7d7a66" />
      <fog attach="fog" args={[hor, 160, 700]} />
    </>
  );
};

const Stage: React.FC<{cam: Cam; children: React.ReactNode; bg?: string}> = ({cam, children, bg = '#1a1612'}) => {
  const {width, height} = useVideoConfig();
  return (
    <AbsoluteFill style={{background: bg}}>
      <ThreeCanvas width={width} height={height} shadows camera={{fov: cam.fov, near: 0.2, far: 3000}}>
        <AssetProvider textures={TEXTURES} hdri="spruit_sunrise_1k">
          <CameraRig pos={cam.pos} target={cam.target} fov={cam.fov} />
          {children}
        </AssetProvider>
      </ThreeCanvas>
      <Grade strength={0.3} />
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
  return <Tag text={text} x={lx} y={Math.min(1480, Math.max(420, y + dy))} delay={delay} size={size} anchor={anchor} bg={bg} fg={fg} />;
};

/** Floating music notes above the singing workers. */
const Notes: React.FC<{p: [number, number, number]; cam: Cam; f: number; from?: number}> = ({p, cam, f, from = 0}) => {
  const [x, y, vis] = toScreen(p, cam);
  if (!vis || f < from) return null;
  return (
    <>
      {[0, 1, 2].map((i) => {
        const per = 48;
        const ph = (((f - from + i * 16) % per) + per) % per / per;
        const op = Math.min(1, ph * 5) * (1 - ph);
        return (
          <div key={i} style={{position: 'absolute', left: x + (i - 1) * 70 + Math.sin(ph * 6 + i) * 18, top: y - ph * 170, fontSize: 64 + i * 8, fontFamily: 'Lilita One', color: C.yellow, WebkitTextStroke: `6px ${C.ink}`, paintOrder: 'stroke fill', opacity: op, transform: 'translate(-50%,-50%)'}}>
            {i === 1 ? '♫' : '♪'}
          </div>
        );
      })}
    </>
  );
};

// ============================================================ worlds
/** Present-day city around the finished house (hook + payoff). xray 0..1 reveals the piles under the church. */
const CityWorld: React.FC<{f: number; xray?: number; boatT?: number; piles?: boolean}> = ({f, xray = 0, boatT = 0, piles = false}) => {
  const bed = useMat('lagoon_mud', {repeat: [60, 60], transparent: true});
  bed.opacity = 1 - 0.85 * xray;
  bed.depthWrite = xray < 0.05;
  const car = useMat('caranto', {repeat: [14, 14]});
  const wat = useMat('water', {repeat: [900 / 7, 900 / 7], roughness: 0.1, metalness: 0.1, tint: '#4f9aa0', normalScale: 0.6, envMapIntensity: 1.4, transparent: true, opacity: 0.88});
  wat.opacity = 0.88 - 0.62 * xray;
  wat.depthWrite = false;
  wat.normalMap!.offset.set((f / 30) * 0.02, (f / 30) * 0.013);
  const isl = useMat('istrian_stone', {transparent: true});
  isl.opacity = 1;
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} material={wat} renderOrder={2}>
        <planeGeometry args={[900, 900]} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, MUD, 0]} material={bed} renderOrder={1}>
        <planeGeometry args={[900, 900]} />
      </mesh>
      {piles && (
        <group visible={xray > 0}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[CHURCH.x, CAR, CHURCH.z]} material={car}>
            <planeGeometry args={[38, 42]} />
          </mesh>
          <ChurchPiles />
        </group>
      )}
      <Church xray={xray} />
      {PALAZZI.map((p, i) => (
        <Palazzo key={i} p={p} />
      ))}
      <NewHouse stoneT={1} brickT={1} finished />
      <Fondamenta x0={-28} x1={-3.5} z0={-17.2} z1={-15.6} />
      <Fondamenta x0={3.5} x1={28} z0={-17.2} z1={-15.6} />
      <ArchBridge x={0} z={-16.4} />
      <Skyline />
      {[[-9.5, 7.5], [9.8, 8.2], [-30, 4], [31, 3], [-12, 2.5]].map(([x, z], i) => (
        <Bricola key={i} p={[x, z]} />
      ))}
      <Boat p={[-11, 0, 6]} rotY={0.15} len={10} />
      <Boat p={[22, 0, 5]} rotY={-0.1} len={9} />
      <Boat p={[-60 + boatT * 40, 0, 16]} rotY={0} len={10}>
        <Person position={[-3.2, 0.25, 0]} rotY={0} pose="push" seed={71} head="hat" headColor="#2a2a2a" outfit="#f2f2f2" pants="#1c1c1c" />
        <Beam a={[-2.7, 1.3, -0.2]} b={[-1.4, -0.4, -0.75]} r={0.04} tex="wood_oak" />
      </Boat>
    </group>
  );
};

/** Makes everything under it see-through by `on` (only the church island + body in the x-ray). */
const XrayFade: React.FC<{on: number; children: React.ReactNode}> = ({on, children}) => {
  const ref = React.useRef<THREE.Group>(null);
  React.useLayoutEffect(() => {
    ref.current?.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m && !Array.isArray(m) && 'opacity' in m && (o as THREE.Mesh).isMesh) {
        // only fade what is below the waterline (the island block); keep the church solid
        const y = (o as THREE.Mesh).position.y;
        if (y < 0) {
          m.transparent = on > 0;
          m.opacity = 1 - 0.85 * on;
          m.depthWrite = on < 0.05;
        }
      }
    });
  });
  return <group ref={ref}>{children}</group>;
};

/** The building site in section (or whole, if !cut): water, mud, caranto, cofferdam, piles, platform, house. */
type SiteProps = {
  f: number;
  cut: boolean;
  piles: PileState;
  pegs?: boolean;
  rig?: {f: number; active: boolean} | null;
  beamT?: number;
  plankT?: number;
  stoneT?: number;
  brickT?: number;
  waterIn?: number; // 0 = drained pit, 1 = water back at sea level inside
  cofDrop?: number;
  children?: React.ReactNode;
};
const SiteWorld: React.FC<SiteProps> = ({f, cut, piles, pegs = true, rig = null, beamT = 0, plankT = 0, stoneT = 0, brickT = 0, waterIn = 0, cofDrop = 0, children}) => {
  const zMax = cut ? CUT : 90;
  const X = COF.x + COF.t, Z0 = COF.z0 - COF.t;
  const zIn = cut ? CUT : -COF.z0 + COF.t;
  const p0Top = piles.p0Top ?? P0.finalTop;
  const wIn = MUD + waterIn * (0 - MUD);
  const cofGone = cofDrop >= 4;
  return (
    <group>
      <Ground3 zMax={zMax} />
      {/* water around the cofferdam (and inside it once it is removed) */}
      <WaterBox x0={-90} x1={-X} z0={-90} z1={zMax} f={f} volume={cut} />
      <WaterBox x0={X} x1={90} z0={-90} z1={zMax} f={f} volume={cut} />
      <WaterBox x0={-X} x1={X} z0={-90} z1={Z0} f={f} volume={cut} />
      {!cut && <WaterBox x0={-X} x1={X} z0={zIn} z1={90} f={f} volume={false} />}
      {waterIn > 0 && (
        <>
          <WaterBox x0={cofGone ? -X : -COF.x} x1={-HOUSE.w / 2} z0={cofGone ? Z0 : COF.z0} z1={zIn} top={wIn} f={f} volume={cut} />
          <WaterBox x0={HOUSE.w / 2} x1={cofGone ? X : COF.x} z0={cofGone ? Z0 : COF.z0} z1={zIn} top={wIn} f={f} volume={cut} />
          <WaterBox x0={-HOUSE.w / 2} x1={HOUSE.w / 2} z0={cofGone ? Z0 : COF.z0} z1={-HOUSE.d / 2} top={wIn} f={f} volume={cut} />
        </>
      )}
      {!cofGone && <Cofferdam cut={cut} drop={cofDrop} />}
      <PileField s={piles} pegs={pegs} />
      {rig && <PileDriver f={rig.f} pileTop={p0Top} active={rig.active} />}
      <Platform beamT={beamT} plankT={plankT} cut={cut} />
      {(stoneT > 0 || brickT > 0) && <NewHouse stoneT={stoneT} brickT={brickT} zMax={cut ? CUT : 99} />}
      {PALAZZI.map((p, i) => (
        <Palazzo key={i} p={p} />
      ))}
      <Fondamenta x0={-28} x1={-3.5} z0={-17.2} z1={-15.6} />
      <Fondamenta x0={3.5} x1={28} z0={-17.2} z1={-15.6} />
      <ArchBridge x={0} z={-16.4} />
      <Church />
      <Skyline maxZ={zMax} />
      <LogBarge p={[-3, 0, -11.6]} />
      {[[-12, 1.5], [12.2, 1.2]].map(([x, z], i) => (
        <Bricola key={i} p={[x, z]} />
      ))}
      {children}
    </group>
  );
};

// ============================================================ camera ground guards
const cityH = (_x: number, _z: number) => 1.2;
const siteH = (x: number, z: number) => (z > CUT ? -50 : Math.abs(x) < COF.x + 0.5 && z > COF.z0 - 0.5 ? MUD : 1.0);
const siteFullH = (x: number, z: number) => (Math.abs(x) < COF.x + 0.5 && Math.abs(z) < -COF.z0 + 0.5 ? MUD : 1.0);

// ============================================================ S1 hook: the church on a million trunks
const S1: React.FC = () => {
  const f = useCurrentFrame();
  const L = LEN[0];
  const cam = groundSafe(camPath(f, [
    {t: 0, pos: [-47, 3.5, 34], target: [CHURCH.x, 20, CHURCH.z], fov: 52},
    {t: L * 0.42, pos: [-50, 12, 18], target: [CHURCH.x, 15, CHURCH.z], fov: 52},
    {t: L, pos: [-52, 44, 10], target: [CHURCH.x, -2, CHURCH.z + 8], fov: 52},
  ]), cityH);
  const xray = ramp(f, L * 0.42, L * 0.78);
  return (
    <>
      <Stage cam={cam}>
        <Atmos f={f} shadow={90} target={[-20, 0, -30]} />
        <CityWorld f={f} xray={xray} boatT={0.25 + f / 900} piles />
      </Stage>
      <Headline top="VENICE, ITALY" big="1,000,000" sub="tree trunks under one church" delay={4} y={140} bigSize={150} />
      <Pin p={[CHURCH.x - 12, -2.5, CHURCH.z + 16]} cam={cam} text="WOODEN PILES" delay={Math.round(L * 0.72)} dy={40} size={54} />
    </>
  );
};

// ============================================================ S2 the problem: islands of soft mud
const MUDFLATS = Array.from({length: 18}, (_, i) => ({
  x: (rnd(i * 3.3) - 0.5) * 340,
  z: (rnd(i * 5.1) - 0.5) * 300 - 20,
  sx: 14 + rnd(i * 7.7) * 30,
  sz: 10 + rnd(i * 2.9) * 24,
  ry: rnd(i * 1.3) * 3,
}));
const Lagoon0: React.FC<{f: number}> = ({f}) => {
  const mud = useMat('lagoon_mud', {repeat: [3, 3], tint: '#b7ab90'});
  const geo = useMemo(() => {
    const g = new THREE.SphereGeometry(1, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      const k = 1 + 0.18 * Math.sin(Math.atan2(z, x) * 3) + 0.1 * Math.sin(Math.atan2(z, x) * 7 + 1);
      p.setX(i, x * k);
      p.setZ(i, z * k);
    }
    g.computeVertexNormals();
    return g;
  }, []);
  return (
    <group>
      <Water w={1200} d={1200} position={[0, 0, 0]} time={f / 30} color="#5a9c9a" texScale={10} />
      {MUDFLATS.map((m, i) => (
        <group key={i} position={[m.x, -0.6, m.z]} rotation={[0, m.ry, 0]}>
          <mesh geometry={geo} scale={[m.sx, 1.0, m.sz]} material={mud} receiveShadow castShadow />
          {Array.from({length: 7}, (_, k) => (
            <Bush key={k} position={[(rnd(i * 9 + k) - 0.5) * m.sx * 1.1, 0.3, (rnd(i * 4 + k * 3) - 0.5) * m.sz * 1.1]} scale={1.0 + rnd(k + i) * 1.0} seed={i * 10 + k} color="#5c6b3a" />
          ))}
        </group>
      ))}
    </group>
  );
};

/** Section: a stone house on a soft mud island, sinking. */
const SinkingHouse: React.FC<{sink: number}> = ({sink}) => {
  const wall = useMat('limestone_ashlar', {tint: '#efe2c8'});
  const roof = useMat('roof_tiles', {tint: '#e8b9a0'});
  const g = useMemo(() => uvBox(7, 6, 5, 2.2), []);
  const r = useMemo(() => hipRoof(7.6, 5.6, 2.2), []);
  return (
    <group position={[0.5, 0.45 - sink * 1.9, -1.0]} rotation={[0, 0, sink * 0.09]}>
      <mesh geometry={g} position={[0, 3, 0]} material={wall} castShadow receiveShadow />
      <mesh geometry={r} position={[0, 6, 0]} material={roof} castShadow />
    </group>
  );
};
const MudIsland: React.FC = () => {
  const mud = useMat('lagoon_mud', {tint: '#b7ab90'});
  const g = useMemo(() => uvBox(22, 0.45 - MUD, 30 + CUT, 3), []);
  return <mesh geometry={g} position={[0, (0.45 + MUD) / 2, (CUT - 30) / 2]} material={mud} castShadow receiveShadow />;
};

const S2: React.FC = () => {
  const f = useCurrentFrame();
  const L = LEN[1];
  const cut = Math.round(L * 0.5);
  const aCam = camPath(f, [
    {t: 0, pos: [70, 150, 150], target: [0, 0, -10], fov: 46},
    {t: cut, pos: [50, 130, 140], target: [0, 0, -14], fov: 46},
  ]);
  const g = f - cut;
  const bCam = groundSafe(camPath(g, [
    {t: 0, pos: [3, 2.6, 25], target: [0, 0.2, -1], fov: 50},
    {t: L - cut, pos: [2, 2.2, 22.5], target: [0, -0.2, -1], fov: 50},
  ]), siteH);
  const sink = ramp(g, 14, L - cut - 10, Easing.inOut(Easing.quad));
  return (
    <>
      <Sequence durationInFrames={cut} layout="none">
        <Stage cam={aCam}>
          <Atmos f={f} shadow={260} />
          <Lagoon0 f={f} />
        </Stage>
        <Pin p={[MUDFLATS[3].x, 1, MUDFLATS[3].z]} cam={aCam} text="MUD ISLANDS" delay={10} dy={-80} size={56} />
        <Caption text="A shallow lagoon with 100+ islands of mud and sand" delay={16} bottom={330} />
      </Sequence>
      <Sequence from={cut} layout="none">
        <SceneFade dur={L - cut} inF={6} outF={0}>
          <Stage cam={bCam}>
            <Atmos f={f} shadow={30} />
            <Ground3 zMax={CUT} />
            <MudIsland />
            <WaterBox x0={-90} x1={-11} z0={-90} z1={CUT} f={f} />
            <WaterBox x0={11} x1={90} z0={-90} z1={CUT} f={f} />
            <WaterBox x0={-11} x1={11} z0={-90} z1={-27.5} f={f} />
            <SinkingHouse sink={sink} />
            <Bush position={[-7, 0.45, -6]} scale={1.6} seed={3} color="#7b8a4c" />
            <Bush position={[7.5, 0.45, -9]} scale={2} seed={5} color="#7b8a4c" />
            <Skyline maxZ={CUT} />
          </Stage>
          <Pin p={[-6, -1.2, CUT]} cam={bCam} text="SOFT MUD" delay={8} size={52} />
          <Tag text="IT SINKS" x={540} y={560} anchor="center" delay={Math.round((L - cut) * 0.45)} size={78} bg={C.red} fg={C.white} />
        </SceneFade>
      </Sequence>
    </>
  );
};

// ============================================================ S3 step 1: drive wooden piles
const Square9: React.FC = () => {
  const m = usePlainMat('#ffc928', 0.4, 0, {emissive: new THREE.Color('#ffb000'), emissiveIntensity: 0.9});
  const y = MUD + 0.05;
  return (
    <group>
      <mesh position={[-2.5, y, -2]} material={m}><boxGeometry args={[1.1, 0.08, 0.1]} /></mesh>
      <mesh position={[-2.5, y, -1]} material={m}><boxGeometry args={[1.1, 0.08, 0.1]} /></mesh>
      <mesh position={[-3, y, -1.5]} material={m}><boxGeometry args={[0.1, 0.08, 1.1]} /></mesh>
      <mesh position={[-2, y, -1.5]} material={m}><boxGeometry args={[0.1, 0.08, 1.1]} /></mesh>
    </group>
  );
};
const Measure: React.FC<{op: number}> = ({op}) => {
  const ghost = useMat('bark', {repeat: [1, 3.5], tint: '#ffe0a0', transparent: true, opacity: 0.85, emissive: '#5a3a10', emissiveIntensity: 0.6});
  ghost.opacity = 0.85 * op;
  const m = usePlainMat('#ffc928', 0.4, 0, {emissive: new THREE.Color('#ffb000'), emissiveIntensity: 0.9});
  const x = -3.5, top = -1.4, tip = top - 3.5;
  if (op <= 0) return null;
  return (
    <group>
      <mesh position={[x, (top + tip) / 2, CUT]} material={ghost}>
        <cylinderGeometry args={[0.12, 0.105, 3.5, 12]} />
      </mesh>
      <group scale={[1, op, 1]} position={[0, top, 0]}>
        <mesh position={[x + 0.42, -1.75, CUT + 0.05]} material={m}><boxGeometry args={[0.1, 3.5, 0.06]} /></mesh>
        <mesh position={[x + 0.42, 0, CUT + 0.05]} material={m}><boxGeometry args={[0.36, 0.06, 0.04]} /></mesh>
        <mesh position={[x + 0.42, -3.5, CUT + 0.05]} material={m}><boxGeometry args={[0.36, 0.06, 0.04]} /></mesh>
      </group>
    </group>
  );
};

const S3_RIG_FROM = 18;
const S3: React.FC = () => {
  const f = useCurrentFrame();
  const L = LEN[2];
  const cam = groundSafe(camPath(f, [
    {t: 0, pos: [3, 5.5, 18.5], target: [-2.4, -2.4, -1], fov: 52},
    {t: L, pos: [1.5, 4.2, 16], target: [-2.8, -2.6, -1], fov: 52},
  ]), siteH);
  const fr = f - S3_RIG_FROM;
  const tNine = wordAt(2, 'nine');
  const tLen = wordAt(2, 'three');
  return (
    <>
      <Stage cam={cam}>
        <Atmos f={f} shadow={36} />
        <SiteWorld f={f} cut piles={{prog: 0, p0Top: p0TopAt(Math.max(0, fr)), cut: true}} rig={{f: Math.max(0, fr), active: fr > 0}}>
          <Measure op={ramp(f, tLen - 6, tLen + 10)} />
          {f > tNine - 4 && <Square9 />}
          <Person position={[4.2, MUD, -3.2]} rotY={2.6} pose="point" seed={81} head="hat" headColor="#3a2a1a" outfit="#7c3a2a" pants="#3a3030" />
          <Person position={[2.6, MUD, -4.6]} rotY={-0.6} pose="carry" seed={82} head="cloth" />
          <Person position={[1.6, MUD, -5.4]} rotY={-0.6} pose="carry" seed={83} />
          <Beam a={[3.1, MUD + 2.0, -3.8]} b={[0.9, MUD + 2.0, -6.1]} r={0.12} tex="bark" />
        </SiteWorld>
      </Stage>
      <StepBadge n={1} title="DRIVE WOODEN PILES" delay={3} />
      <Pin p={[-3, 1.4, -11.6]} cam={cam} text="LARCH · OAK · ALDER" delay={wordAt(2, 'larch')} dy={-40} size={46} />
      <Pin p={[-3.08, -3.1, CUT]} cam={cam} text="UP TO 3.5 M" delay={tLen} dx={40} size={48} anchor="left" />
      <Pin p={[-2.5, MUD, -1.5]} cam={cam} text="9 PER M²" delay={tNine} dy={-70} size={50} />
      <Pin p={[0.5, -5.25, CUT]} cam={cam} text="HARD CLAY" delay={Math.round(L * 0.25)} size={46} />
      <Caption text="Through soft mud, down to a hard clay layer" delay={Math.round(L * 0.5)} bottom={300} />
    </>
  );
};

// ============================================================ S4 battipali + the spiral
const S3_RIG_FRAMES = LEN[2] - S3_RIG_FROM;
const SpiralPath: React.FC<{t: number}> = ({t}) => {
  const curve = useMemo(() => new THREE.CatmullRomCurve3(SPIRAL.filter((_, n) => n % 3 === 0).map((k) => new THREE.Vector3(PILES[k].x, -0.9, PILES[k].z))), []);
  const geo = useMemo(() => new THREE.TubeGeometry(curve, 1600, 0.07, 6, false), [curve]);
  const m = usePlainMat('#ffd23a', 0.3, 0, {emissive: new THREE.Color('#ffb000'), emissiveIntensity: 1.2});
  const idx = geo.index!.count;
  geo.setDrawRange(0, Math.floor((idx * t) / 6) * 6);
  return <mesh geometry={geo} material={m} />;
};

const S4: React.FC = () => {
  const f = useCurrentFrame();
  const L = LEN[3];
  const cut = Math.round(L * 0.5);
  const fr = S3_RIG_FRAMES + f;
  const active = fr < P0_DRIVEN_AT;
  const aCam = groundSafe(camPath(f, [
    {t: 0, pos: [P0.x + 6.5, 0.9, P0.z + 7.2], target: [P0.x - 0.4, MUD + 2.1, P0.z - 0.6], fov: 50},
    {t: cut, pos: [P0.x + 5.4, 1.3, P0.z + 6.0], target: [P0.x - 0.4, MUD + 2.3, P0.z - 0.6], fov: 50},
  ]), siteH);
  const g = f - cut;
  const bCam = groundSafe(camPath(g, [
    {t: 0, pos: [3, 24, 13], target: [0, -2, -0.6], fov: 50},
    {t: L - cut, pos: [1.5, 28, 11], target: [0, -2, -0.6], fov: 50},
  ]), siteFullH);
  const prog = 1 + ramp(g, 8, L - cut - 12, Easing.inOut(Easing.sin)) * (PILES.length - 1);
  const notesAt = workerPos(1.2);
  return (
    <>
      <Sequence durationInFrames={cut} layout="none">
        <Stage cam={aCam}>
          <Atmos f={f} shadow={30} />
          <SiteWorld f={f} cut piles={{prog: 0, p0Top: p0TopAt(fr), cut: true}} rig={{f: fr, active}} />
        </Stage>
        <Notes p={[notesAt[0], MUD + 2.4, notesAt[2]]} cam={aCam} f={f} from={wordAt(3, 'singing') - 8} />
        <Pin p={[workerPos(1.78)[0], MUD + 1.9, workerPos(1.78)[2]]} cam={aCam} text="BATTIPALI" delay={wordAt(3, 'battipali')} dy={-150} size={58} />
        <Caption text="Lift, drop, repeat until the pile won't sink" delay={Math.round(cut * 0.55)} bottom={300} />
      </Sequence>
      <Sequence from={cut} layout="none">
        <SceneFade dur={L - cut} inF={6} outF={0}>
          <Stage cam={bCam}>
            <Atmos f={f} shadow={30} />
            <SiteWorld f={f} cut={false} piles={{prog, cut: false}} rig={{f: fr, active: false}}>
              <SpiralPath t={Math.min(1, prog / PILES.length)} />
            </SiteWorld>
          </Stage>
          <Pin p={[P0.x, -0.9, P0.z]} cam={bCam} text="START: OUTER EDGE" delay={4} dy={-110} size={44} />
          <Pin p={[0, -0.9, 0]} cam={bCam} text="CENTER LAST" delay={Math.round((L - cut) * 0.6)} dy={90} size={48} />
        </SceneFade>
      </Sequence>
    </>
  );
};

// ============================================================ S5 step 2: saw level + platform
const S5: React.FC = () => {
  const f = useCurrentFrame();
  const L = LEN[4];
  const cam = groundSafe(camPath(f, [
    {t: 0, pos: [0.2, 3.2, 14], target: [-3.4, -1.9, -1], fov: 50},
    {t: L, pos: [-0.5, 3.8, 13], target: [-3.0, -1.6, -1.5], fov: 50},
  ]), siteH);
  const sawK = ramp(f, 6, L * 0.36, Easing.linear);
  const beamT = ramp(f, L * 0.36, L * 0.64, Easing.linear);
  const plankT = ramp(f, L * 0.6, L * 0.92, Easing.linear);
  return (
    <>
      <Stage cam={cam}>
        <Atmos f={f} shadow={30} />
        <SiteWorld f={f} cut piles={{prog: PILES.length, sawK, cut: true}} beamT={beamT} plankT={plankT}>
          <Person position={[-6.6, MUD, 1.5]} rotY={0} pose="chisel" t={f * 0.25} seed={91} head="cloth" />
          <Plank size={[0.9, 0.02, 0.12]} position={[-5.9, MUD + 0.8, 1.5]} rotation={[0, 0.2, 0]} tex="iron_dark" />
          <Dust at={[-5.8, MUD + 0.35, 1.5]} f={f} color="#e8d2a0" size={0.12} />
          <Person position={[-1.0, MUD, -6.8]} rotY={0.3} pose="carry" seed={92} />
          <Plank size={[0.4, 0.06, 2.6]} position={[-0.9, MUD + 2.0, -6.8]} rotation={[0, 0.3, 0]} />
          <Person position={[4.5, MUD, -6.6]} rotY={2.4} pose="point" seed={81} head="hat" headColor="#3a2a1a" outfit="#7c3a2a" pants="#3a3030" />
        </SiteWorld>
      </Stage>
      <StepBadge n={2} title="LEVEL + PLATFORM" delay={3} />
      <Pin p={[-11, 0, CUT]} cam={cam} text="WATERLINE" delay={10} dy={-50} size={44} />
      <Pin p={[2.5, SAWN, CUT]} cam={cam} text="SAWN BELOW THE WATER" delay={wordAt(4, 'below')} dy={60} size={44} />
      <Pin p={[0, PLAT, -1]} cam={cam} text="WOODEN PLATFORM" delay={wordAt(4, 'platform')} dy={-110} size={50} />
    </>
  );
};

// ============================================================ S6 step 3: Istrian stone base, then brick
const Droplets: React.FC<{f: number; from: number}> = ({f, from}) => {
  const mats = useMemo(() => Array.from({length: 5}, () => new THREE.MeshStandardMaterial({color: '#5fc8ff', roughness: 0.2, emissive: new THREE.Color('#1aa0ff'), emissiveIntensity: 0.9, transparent: true})), []);
  if (f < from) return null;
  const xs = [-6.18, -6.18, -6.18, 6.18, 6.18];
  const zs = [CUT - 0.6, CUT - 2.2, CUT - 3.8, CUT - 1.2, CUT - 3.0];
  return (
    <group>
      {xs.map((x, i) => {
        const per = 40;
        const ph = (((f - from + i * 9) % per) + per) % per / per;
        const y = -0.5 + Math.min(ph * 1.6, 0.62);
        const op = ph < 0.4 ? 1 : 1 - (ph - 0.4) / 0.6;
        return (
          <mesh key={i} position={[x, y, zs[i]]} scale={[0.14, 0.2, 0.14]} material={(mats[i].opacity = op, mats[i])}>
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
  const cam = groundSafe(camPath(f, [
    {t: 0, pos: [4, 3.2, 14.5], target: [-0.5, -0.8, -1.2], fov: 50},
    {t: L * 0.55, pos: [5, 4.5, 18], target: [-0.6, 0.4, -1.5], fov: 50},
    {t: L, pos: [9, 9.5, 31], target: [-0.6, 3.2, -2], fov: 50},
  ]), siteH);
  const stoneT = ramp(f, 4, L * 0.34, Easing.linear);
  const cofDrop = ramp(f, L * 0.36, L * 0.5) * 4.5;
  const waterIn = ramp(f, L * 0.4, L * 0.55);
  const brickT = ramp(f, L * 0.62, L * 0.98, Easing.inOut(Easing.sin));
  const tSalt = wordAt(5, 'salt');
  return (
    <>
      <Stage cam={cam}>
        <Atmos f={f} shadow={40} />
        <SiteWorld f={f} cut piles={{prog: PILES.length, sawK: 1, cut: true}} pegs={false} beamT={1} plankT={1} stoneT={stoneT} brickT={brickT} waterIn={waterIn} cofDrop={cofDrop}>
          <Person position={[-3.4, PLAT, -2.2]} rotY={Math.PI} pose="hammer" t={f * 0.2} seed={93} head="cloth" />
          <Person position={[2.6, PLAT, -3.4]} rotY={0.4} pose="carry" seed={94} />
          <Droplets f={f} from={tSalt - 10} />
        </SiteWorld>
      </Stage>
      <StepBadge n={3} title="STONE BASE, THEN BRICK" delay={3} />
      <Pin p={[-5.6, -0.3, CUT]} cam={cam} text="ISTRIAN STONE" delay={wordAt(5, 'Istrian')} dx={-20} size={50} anchor="right" />
      <Pin p={[6.2, 0.3, CUT - 1]} cam={cam} text="SALT WATER STOPS HERE" delay={tSalt} dy={-120} size={42} bg={C.red} fg={C.white} />
      <Pin p={[3, 5, -4.8]} cam={cam} text="BRICK WALLS" delay={wordAt(5, 'brick')} dy={-60} size={50} />
    </>
  );
};

// ============================================================ S7 why the wood doesn't rot
const PX = -HOUSE.w / 2 + SP / 2 + 17 * SP; // the cut-row pile we zoom into
const PILE_TOP7 = SAWN;
const Microbes: React.FC<{f: number; bacT: number; waterT: number}> = ({f, bacT, waterT}) => {
  const bac = usePlainMat('#7ddc54', 0.5, 0, {emissive: new THREE.Color('#3aa020'), emissiveIntensity: 0.6});
  const wat = usePlainMat('#58c4ff', 0.2, 0, {emissive: new THREE.Color('#1a90ff'), emissiveIntensity: 1.0});
  const nB = Math.floor(bacT * 30);
  const nW = Math.floor(waterT * 120);
  return (
    <group>
      {Array.from({length: nB}, (_, i) => {
        const y = MUD - 0.4 - rnd(i * 3.1) * 2.6 + Math.sin(f * 0.03 + i) * 0.05;
        const a = (rnd(i * 5.7) - 0.5) * 2.2;
        return (
          <mesh key={i} position={[PX + (i % 5 - 2) * SP + Math.sin(a) * 0.13, y, CUT + Math.cos(a) * 0.13]} rotation={[0, a, 0.6 + i]} material={bac}>
            <capsuleGeometry args={[0.025, 0.07, 4, 8]} />
          </mesh>
        );
      })}
      {Array.from({length: nW}, (_, i) => {
        const y = MUD - 0.2 - rnd(i * 2.3) * 2.9;
        const a = (rnd(i * 7.9) - 0.5) * 2.4;
        return (
          <mesh key={i} position={[PX + (i % 5 - 2) * SP + Math.sin(a) * 0.124, y, CUT + Math.cos(a) * 0.124]} material={wat}>
            <sphereGeometry args={[0.022, 6, 5]} />
          </mesh>
        );
      })}
    </group>
  );
};

const S7: React.FC = () => {
  const f = useCurrentFrame();
  const L = LEN[6];
  const cam = groundSafe(camPath(f, [
    {t: 0, pos: [3.5, 1.2, CUT + 9], target: [PX - 0.3, -2.4, CUT], fov: 50},
    {t: L * 0.3, pos: [PX + 1.8, -2.0, CUT + 5.6], target: [PX, -3.0, CUT], fov: 50},
    {t: L, pos: [PX + 1.3, -2.2, CUT + 4.6], target: [PX, -3.1, CUT], fov: 50},
  ]), siteH);
  const tF = wordAt(6, 'fungi');
  const tB = wordAt(6, 'bacteria');
  const tW = wordAt(6, 'water fills');
  return (
    <>
      <Stage cam={cam}>
        <Atmos f={f} shadow={40} />
        <SiteWorld f={f} cut piles={{prog: PILES.length, sawK: 1, cut: true}} pegs={false} beamT={1} plankT={1} stoneT={1} brickT={1} waterIn={1} cofDrop={5}>
          <Microbes f={f} bacT={ramp(f, tB - 4, tB + 30)} waterT={ramp(f, tW - 4, tW + 60)} />
        </SiteWorld>
      </Stage>
      <Headline top="WHY NO ROT?" big="NO OXYGEN" delay={4} y={140} bigSize={130} />
      <Sequence from={tF} durationInFrames={tB - tF - 2} layout="none">
        <Tag text="NO FUNGI" x={300} y={600} anchor="center" delay={0} size={56} bg={C.red} fg={C.white} />
        <Tag text="NO INSECTS" x={780} y={600} anchor="center" delay={8} size={56} bg={C.red} fg={C.white} />
      </Sequence>
      <Sequence from={tB} layout="none">
        <Tag text="SLOW BACTERIA" x={540} y={600} anchor="center" delay={0} size={58} bg="#3aa020" fg={C.white} />
      </Sequence>
      <Sequence from={tW} layout="none">
        <Tag text="WATER FILLS THE GAPS" x={540} y={1340} anchor="center" delay={0} size={52} />
      </Sequence>
      <Caption text="So the piles keep their shape, under water and mud" delay={tW + 30} bottom={300} />
    </>
  );
};

// ============================================================ S8 payoff
const S8: React.FC = () => {
  const f = useCurrentFrame();
  const L = LEN[7];
  const cam = groundSafe(camPath(f, [
    {t: 0, pos: [34, 12, 44], target: [-8, 8, -16], fov: 50},
    {t: L, pos: [6, 26, 56], target: [-14, 9, -22], fov: 50},
  ]), cityH);
  return (
    <>
      <Stage cam={cam} bg="#f4cfa0">
        <Atmos f={f} golden={0.75} shadow={90} target={[-10, 0, -20]} />
        <CityWorld f={f} boatT={0.6 + f / 700} />
      </Stage>
      <Headline top="VENICE" big="121 ISLANDS" sub="435 bridges" delay={4} y={140} bigSize={140} />
      <Caption text="All standing on an upside-down forest" delay={wordAt(7, 'All')} bottom={330} />
    </>
  );
};

// ============================================================ timeline
const SCENES = [S1, S2, S3, S4, S5, S6, S7, S8];

export const Venice: React.FC = () => (
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
        <Audio src={staticFile(`vo/ep006-venice_${i}.wav`)} />
      </Sequence>
    ))}
    <Watermark />
  </AbsoluteFill>
);

export const VENICE_START = START;
export const VENICE_LEN = LEN;
