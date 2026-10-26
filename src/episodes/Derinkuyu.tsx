// Episode 4: Derinkuyu — a whole city carved underground (v2 kit).
// The city is a cut-away section: ground surface y=0, cut face z=0, carved rock at z<0 (geometry pre-baked by tools/derinkuyu_geo.ts).
import React, {useMemo, useState, useEffect} from 'react';
import {AbsoluteFill, Audio, continueRender, delayRender, interpolate, Sequence, staticFile, useCurrentFrame, useVideoConfig, Easing} from 'remotion';
import {ThreeCanvas} from '@remotion/three';
import * as THREE from 'three';
import VO from './ep004-derinkuyu-vo.json';
import {AssetProvider, Renderer, SkyDome, Sun, TexName, useMat, usePlainMat, uvBox, worldUV} from '../hib/pbr';
import {Beam, Bush, Dust, KIT_TEXTURES, Person, Pose, Plank, Rock, Rope, Terrain, Tree, Water, rnd} from '../hib/models';
import {CameraRig} from '../hib/three';
import {Cam, camPath, toScreen} from '../hib/project';
import {C, Caption, Grade, Headline, SceneFade, StepBadge, Tag, Watermark} from '../hib/ui';
import {BASEMENT, DOOR_X, HOOK_TUNNEL, HOUSE63, LEVELS, N_STAGES, ROOMS, Room, SHAFT, VENTS, WELL, XMAX, carvingRooms, floorY, roomTop, special, tunnelGeom, tunnelSide} from './derinkuyu-city';

// ============================================================ timing
const FPS = 30;
const VO_DELAY = 5;
const sceneLen = (i: number, tail: number) => Math.ceil((VO.durations[i] + tail) * FPS) + VO_DELAY;
const LEN = [sceneLen(0, 0.5), sceneLen(1, 0.5), sceneLen(2, 0.5), sceneLen(3, 0.5), sceneLen(4, 0.5), sceneLen(5, 0.5), sceneLen(6, 0.5), sceneLen(7, 1.6)];
const START = LEN.map((_, i) => LEN.slice(0, i).reduce((a, b) => a + b, 0));
export const DERINKUYU_DURATION = LEN.reduce((a, b) => a + b, 0);

const cl = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
const ramp = (f: number, a: number, b: number, ease = Easing.inOut(Easing.cubic)) => interpolate(f, [a, b], [0, 1], {...cl, easing: ease});
type V3 = [number, number, number];

const TEXTURES: TexName[] = [...KIT_TEXTURES, 'tuff_carved', 'tuff_strata', 'tuff_blocks', 'stone_face_tuff', 'dirt', 'sand', 'grass', 'straw', 'plaster_ochre', 'plaster_white', 'water', 'stone_face_grey', 'gravel'];

// ============================================================ baked geometry
type GeoIndex = Record<string, {groups: {start: number; count: number; materialIndex: number}[]; mats: string[]; n: number}>;
type GeoLib = Record<string, {geo: THREE.BufferGeometry; mats: string[]}>;
let geoPromise: Promise<GeoLib> | null = null;
let geoLib: GeoLib | null = null;
const loadGeoLib = () => {
  if (!geoPromise) {
    geoPromise = (async () => {
      const idx: GeoIndex = await (await fetch(staticFile('geo/ep004/index.json'))).json();
      const lib: GeoLib = {};
      await Promise.all(
        Object.entries(idx).map(async ([k, v]) => {
          const buf = await (await fetch(staticFile(`geo/ep004/${k}.bin`))).arrayBuffer();
          const n = v.n;
          const g = new THREE.BufferGeometry();
          g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(buf, 0, n * 3), 3));
          g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(buf, n * 12, n * 3), 3));
          g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(buf, n * 24, n * 2), 2));
          v.groups.forEach((gr) => g.addGroup(gr.start, gr.count, gr.materialIndex));
          g.computeBoundingSphere();
          lib[k] = {geo: g, mats: v.mats};
        }),
      );
      geoLib = lib;
      return lib;
    })();
  }
  return geoPromise;
};
/** Blocks rendering until the baked rock geometry is loaded. */
const useGeoReady = () => {
  const [ready, setReady] = useState(!!geoLib);
  const [h] = useState(() => (geoLib ? null : delayRender('Loading carved geometry')));
  useEffect(() => {
    if (geoLib) return;
    loadGeoLib().then(() => {
      setReady(true);
      if (h !== null) continueRender(h);
    });
  }, [h]);
  return ready;
};

/** The carved rock block (cut face = layered tuff, carved surfaces = pick-marked tuff). */
const CarvedRock: React.FC<{gkey: string; golden?: number}> = ({gkey}) => {
  const face = useMat('tuff_strata', {repeat: [1 / 13, 1 / 13]});
  const carve = useMat('tuff_carved', {repeat: [1 / 2.6, 1 / 2.6], tint: '#f3e6d2'});
  const e = geoLib![gkey];
  const mats = useMemo(() => e.mats.map((m) => (m === 'face' ? face : carve)), [e, face, carve]);
  return <mesh geometry={e.geo} material={mats} castShadow receiveShadow />;
};

// ============================================================ surface: terrain, houses, volcano on the horizon
const vnoise = (x: number, z: number) => Math.sin(x * 0.021 + 1.3) * Math.cos(z * 0.017 + 0.4) * 0.6 + Math.sin(x * 0.053 + z * 0.041) * 0.4;
const VOLC = {x: 420, z: -1750, r: 620, h: 330};
const surfH = (x: number, z: number) => {
  const far = Math.min(1, Math.max(0, (-z - 40) / 160));
  let h = vnoise(x, z) * 9 * far + Math.max(0, -z - 200) * 0.01;
  const d = Math.hypot(x - VOLC.x, z - VOLC.z);
  const cone = Math.max(0, 1 - d / VOLC.r);
  h += VOLC.h * Math.pow(cone, 1.6) - (d < 60 ? (60 - d) * 0.9 : 0);
  return h;
};

const FlatHouse: React.FC<{position: V3; size?: V3; rotY?: number; seed?: number; cutaway?: boolean}> = ({position, size = [7, 4.2, 6], rotY = 0, seed = 1}) => {
  const [w, h, d] = size;
  const wall = useMat('tuff_blocks', {tint: rnd(seed) < 0.5 ? '#f4e6cf' : '#e9d3b4'});
  const roof = useMat('plaster_white', {tint: '#e8dcc6'});
  const dark = usePlainMat('#2a2018', 0.9);
  const wood = useMat('wood_oak');
  const body = useMemo(() => uvBox(w, h, d, 3), [w, h, d]);
  const slab = useMemo(() => uvBox(w + 0.5, 0.35, d + 0.5, 3), [w, d]);
  const nWin = Math.max(1, Math.floor(w / 2.6));
  return (
    <group position={position} rotation={[0, rotY, 0]}>
      <mesh geometry={body} position={[0, h / 2, 0]} material={wall} castShadow receiveShadow />
      <mesh geometry={slab} position={[0, h + 0.17, 0]} material={roof} castShadow receiveShadow />
      {/* parapet */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[0, h + 0.55, s * (d / 2 + 0.1)]} material={roof} castShadow>
          <boxGeometry args={[w + 0.5, 0.45, 0.25]} />
        </mesh>
      ))}
      {/* door (arched) + windows on +z face */}
      <mesh position={[-w / 2 + 1.3, 1.05, d / 2 + 0.02]} material={wood}>
        <boxGeometry args={[1.1, 2.1, 0.08]} />
      </mesh>
      <mesh position={[-w / 2 + 1.3, 2.1, d / 2 + 0.02]} rotation={[Math.PI / 2, 0, 0]} material={wood}>
        <cylinderGeometry args={[0.55, 0.55, 0.08, 16, 1, false, 0, Math.PI]} />
      </mesh>
      {Array.from({length: nWin}, (_, i) => (
        <mesh key={i} position={[-w / 2 + 2.8 + i * 2.4, h * 0.62, d / 2 + 0.02]} material={dark}>
          <boxGeometry args={[0.8, 1.0, 0.06]} />
        </mesh>
      ))}
    </group>
  );
};

const TOWN = (() => {
  const out: {p: V3; s: V3; r: number; seed: number}[] = [];
  // front row sits just behind the cut
  const front = [-27, -18.5, -9.5, 17, 26];
  front.forEach((x, i) => out.push({p: [x, 0, -4.6 - rnd(i) * 1.5], s: [6.5 + rnd(i + 3) * 2.5, 3.8 + rnd(i + 5) * 1.6, 7], r: 0, seed: i}));
  for (let i = 0; i < 46; i++) {
    const x = (rnd(i * 3.3 + 9) - 0.5) * 170;
    const z = -16 - rnd(i * 5.1 + 2) * 130;
    out.push({p: [x, surfH(x, z), z], s: [6 + rnd(i) * 4, 3.6 + rnd(i + 1) * 2.4, 6 + rnd(i + 2) * 3], r: (rnd(i * 7) - 0.5) * 0.5, seed: i + 20});
  }
  return out;
})();

const Town: React.FC = () => (
  <group>
    {TOWN.map((t, i) => (
      <FlatHouse key={i} position={t.p} size={t.s} rotY={t.r} seed={t.seed} />
    ))}
    {/* the 1963 house over its basement */}
    <FlatHouse position={[(HOUSE63.x0 + HOUSE63.x1) / 2, 0, -3.6]} size={[HOUSE63.x1 - HOUSE63.x0, 4.4, 7]} seed={63} />
    {[[-33, -9], [-4, -12], [31, -10], [12, -26], [-40, -40], [40, -50], [-14, -60]].map(([x, z], i) => (
      <Tree key={i} position={[x, surfH(x, z), z]} scale={0.9 + rnd(i) * 0.4} seed={i + 5} leaf="#6d7d3a" />
    ))}
    {[[-23, -11], [22, -14], [6, -18], [-12, -24]].map(([x, z], i) => (
      <Bush key={i} position={[x, 0, z]} scale={1.2} seed={i + 30} color="#727a3e" />
    ))}
  </group>
);

const Surface: React.FC = () => (
  <>
    <Terrain height={surfH} size={2600} seg={260} tex="dirt" texScale={7} center={[0, -1300]} />
    <Town />
  </>
);

/** Sky + sun + haze for the section shots. Sun comes from the front so it lights into the rooms. */
const Atmos: React.FC<{f: number; golden?: number; shadowSize?: number; target?: V3}> = ({f, golden = 0, shadowSize = 60, target = [0, -35, -5]}) => {
  const sunDir: V3 = [-0.42 - 0.25 * golden, 0.78 - 0.32 * golden, 0.62];
  const sunCol = new THREE.Color('#fff1dc').lerp(new THREE.Color('#ffbe72'), golden).getStyle();
  const hor = new THREE.Color('#c9dcec').lerp(new THREE.Color('#f0cfa4'), golden).getStyle();
  return (
    <>
      <Renderer exposure={1.0 + 0.08 * golden} envIntensity={0.7} />
      <SkyDome top={golden ? '#3a68b0' : '#2a64b8'} horizon={hor} sunDir={sunDir} sunColor={sunCol} clouds={0.4} time={f / 30} />
      <Sun dir={sunDir} intensity={3.0} color={sunCol} shadowSize={shadowSize} shadowRes={4096} target={target} skyColor="#c4dcf2" groundColor="#9a8360" hemi={0.75} />
      <fog attach="fog" args={[hor, 400, 2600]} />
    </>
  );
};

// ============================================================ animals & props
const Goat: React.FC<{position: V3; rotY?: number; seed?: number; t?: number; scale?: number; color?: string}> = ({position, rotY = 0, seed = 1, t = 0, scale = 1, color}) => {
  const coat = usePlainMat(color ?? ['#efe7d6', '#5b4434', '#8a6a4a', '#d8ccb6'][Math.floor(rnd(seed) * 4)], 0.95);
  const dark = usePlainMat('#2a221c', 0.8);
  const nod = Math.sin(t + seed) * 0.15;
  return (
    <group position={position} rotation={[0, rotY, 0]} scale={scale}>
      <mesh position={[0, 0.55, 0]} rotation={[0, 0, Math.PI / 2]} material={coat} castShadow>
        <capsuleGeometry args={[0.22, 0.5, 6, 12]} />
      </mesh>
      {[[0.28, 0.12], [0.28, -0.12], [-0.28, 0.12], [-0.28, -0.12]].map(([x, z], i) => (
        <mesh key={i} position={[x, 0.22, z]} material={coat} castShadow>
          <cylinderGeometry args={[0.04, 0.035, 0.45, 6]} />
        </mesh>
      ))}
      <group position={[0.5, 0.75, 0]} rotation={[0, 0, -0.5 + nod]}>
        <mesh position={[0.12, 0, 0]} rotation={[0, 0, Math.PI / 2]} material={coat} castShadow>
          <capsuleGeometry args={[0.09, 0.2, 4, 8]} />
        </mesh>
        {[-0.06, 0.06].map((z) => (
          <mesh key={z} position={[0.02, 0.12, z]} rotation={[0, 0, 0.6]} material={dark}>
            <coneGeometry args={[0.025, 0.2, 6]} />
          </mesh>
        ))}
        {[-0.1, 0.1].map((z) => (
          <mesh key={z} position={[0.0, 0.03, z * 1.2]} rotation={[z * 8, 0, 0]} material={coat}>
            <boxGeometry args={[0.06, 0.03, 0.12]} />
          </mesh>
        ))}
      </group>
      <mesh position={[-0.52, 0.66, 0]} rotation={[0, 0, 0.8]} material={coat}>
        <coneGeometry args={[0.04, 0.14, 5]} />
      </mesh>
    </group>
  );
};

const Donkey: React.FC<{position: V3; rotY?: number; t?: number}> = ({position, rotY = 0, t = 0}) => {
  const coat = usePlainMat('#7d6f63', 0.95);
  const pale = usePlainMat('#cfc6ba', 0.95);
  const dark = usePlainMat('#2e2722', 0.9);
  return (
    <group position={position} rotation={[0, rotY, 0]}>
      <mesh position={[0, 0.95, 0]} rotation={[0, 0, Math.PI / 2]} material={coat} castShadow>
        <capsuleGeometry args={[0.3, 0.75, 6, 12]} />
      </mesh>
      {[[0.38, 0.15], [0.38, -0.15], [-0.38, 0.15], [-0.38, -0.15]].map(([x, z], i) => (
        <mesh key={i} position={[x, 0.4, z]} material={coat} castShadow>
          <cylinderGeometry args={[0.06, 0.05, 0.8, 6]} />
        </mesh>
      ))}
      <group position={[0.65, 1.2, 0]} rotation={[0, 0, -0.75 + Math.sin(t) * 0.08]}>
        <mesh position={[0.2, 0, 0]} rotation={[0, 0, Math.PI / 2]} material={coat} castShadow>
          <capsuleGeometry args={[0.13, 0.4, 4, 8]} />
        </mesh>
        <mesh position={[0.48, 0, 0]} material={pale}>
          <sphereGeometry args={[0.12, 10, 8]} />
        </mesh>
        {[-0.07, 0.07].map((z) => (
          <mesh key={z} position={[0.0, 0.2, z]} rotation={[z * 3, 0, 0.3]} material={coat}>
            <coneGeometry args={[0.05, 0.32, 6]} />
          </mesh>
        ))}
      </group>
      <mesh position={[0.45, 1.3, 0]} rotation={[0, 0, -0.8]} material={dark}>
        <boxGeometry args={[0.5, 0.06, 0.05]} />
      </mesh>
      <mesh position={[-0.75, 0.8, 0]} rotation={[0, 0, 0.3]} material={dark}>
        <cylinderGeometry args={[0.02, 0.04, 0.6, 5]} />
      </mesh>
    </group>
  );
};

const Jar: React.FC<{position: V3; s?: number; color?: string}> = ({position, s = 1, color = '#a2583a'}) => {
  const m = usePlainMat(color, 0.85);
  const geo = useMemo(() => {
    const pts = [[0.0, 0], [0.12, 0], [0.2, 0.08], [0.27, 0.3], [0.26, 0.55], [0.17, 0.78], [0.1, 0.85], [0.12, 0.9], [0.0, 0.9]].map(([x, y]) => new THREE.Vector2(x, y));
    return new THREE.LatheGeometry(pts, 14);
  }, []);
  return <mesh geometry={geo} position={position} scale={s} material={m} castShadow receiveShadow />;
};

/** Oil lamp with flame; optional real point light. */
const Lamp: React.FC<{position: V3; f: number; light?: number; seed?: number}> = ({position, f, light = 0, seed = 1}) => {
  const clay = usePlainMat('#8c5434', 0.8);
  const flame = usePlainMat('#ffcf6a', 1, 0, {emissive: new THREE.Color('#ffae3a'), emissiveIntensity: 3});
  const fl = 1 + 0.12 * Math.sin(f * 0.9 + seed * 3) + 0.06 * Math.sin(f * 2.3 + seed);
  return (
    <group position={position}>
      <mesh material={clay} scale={[1.4, 0.5, 1]}>
        <sphereGeometry args={[0.08, 10, 8]} />
      </mesh>
      <mesh position={[0.1, 0.07, 0]} material={flame} scale={[1, fl, 1]}>
        <coneGeometry args={[0.025, 0.09, 8]} />
      </mesh>
      {light > 0 && <pointLight position={[0.1, 0.25, 0.1]} color="#ffb060" intensity={light * fl} distance={9} decay={1.6} />}
    </group>
  );
};

const Tandir: React.FC<{position: V3; f: number; light?: number}> = ({position, f, light = 0}) => {
  const clay = useMat('plaster_ochre', {tint: '#c89a72', side: THREE.DoubleSide});
  const glow = usePlainMat('#ff8a2a', 1, 0, {emissive: new THREE.Color('#ff6a10'), emissiveIntensity: 2.2 + 0.4 * Math.sin(f * 0.7)});
  const geo = useMemo(() => worldUV(new THREE.CylinderGeometry(0.55, 0.65, 0.7, 20, 1, true), 1), []);
  return (
    <group position={position}>
      <mesh geometry={geo} position={[0, 0.35, 0]} material={clay} castShadow />
      <mesh position={[0, 0.6, 0]} rotation={[-Math.PI / 2, 0, 0]} material={glow}>
        <circleGeometry args={[0.5, 20]} />
      </mesh>
      {light > 0 && <pointLight position={[0, 1.1, 0.3]} color="#ff9a40" intensity={light} distance={8} decay={1.5} />}
    </group>
  );
};

const Basin: React.FC<{position: V3; size: V3; liquid?: string}> = ({position, size, liquid}) => {
  const m = useMat('tuff_carved', {tint: '#efe0c8'});
  const [w, h, d] = size;
  const g1 = useMemo(() => uvBox(w, 0.15, d, 1.5), [w, d]);
  const gw = useMemo(() => uvBox(0.18, h, d, 1.5), [h, d]);
  const gd = useMemo(() => uvBox(w, h, 0.18, 1.5), [w, h]);
  const lm = usePlainMat(liquid ?? '#000', 0.15, 0, {emissive: new THREE.Color(liquid ?? '#000'), emissiveIntensity: 0.15});
  return (
    <group position={position}>
      <mesh geometry={g1} position={[0, 0.075, 0]} material={m} castShadow receiveShadow />
      {[-1, 1].map((s) => (
        <mesh key={s} geometry={gw} position={[s * (w / 2 - 0.09), h / 2, 0]} material={m} castShadow receiveShadow />
      ))}
      {[-1, 1].map((s) => (
        <mesh key={s} geometry={gd} position={[0, h / 2, s * (d / 2 - 0.09)]} material={m} castShadow receiveShadow />
      ))}
      {liquid && (
        <mesh position={[0, h * 0.6, 0]} rotation={[-Math.PI / 2, 0, 0]} material={lm}>
          <planeGeometry args={[w - 0.36, d - 0.36]} />
        </mesh>
      )}
    </group>
  );
};

const WinePress: React.FC<{position: V3; f: number}> = ({position, f}) => {
  const grape = usePlainMat('#5a2348', 0.6);
  const stone = useMat('stone_face_tuff');
  const press = Math.sin(f * 0.08) * 0.08;
  return (
    <group position={position}>
      <Basin position={[0, 0, 0]} size={[2.2, 0.55, 1.6]} />
      <Basin position={[1.75, 0, 0.1]} size={[1.0, 0.45, 1.0]} liquid="#5b1530" />
      {Array.from({length: 14}, (_, i) => (
        <mesh key={i} position={[(rnd(i) - 0.5) * 1.5, 0.3 + rnd(i + 3) * 0.12, (rnd(i + 7) - 0.5) * 1.0]} material={grape}>
          <sphereGeometry args={[0.13, 8, 6]} />
        </mesh>
      ))}
      {/* lever press: beam pivoting on the back wall, stone weight at the end */}
      <group position={[-1.4, 1.4, -0.2]} rotation={[0, 0, -0.18 + press]}>
        <Beam a={[0, 0, 0]} b={[3.2, 0, 0]} r={0.11} square tex="wood_oak" />
        <mesh position={[3.1, -0.45, 0]} material={stone} castShadow>
          <cylinderGeometry args={[0.32, 0.32, 0.5, 14]} />
        </mesh>
        <Rope a={[3.1, 0, 0]} b={[3.1, -0.22, 0]} sag={0} r={0.03} />
      </group>
      <Beam a={[-1.45, 0, -0.2]} b={[-1.45, 1.6, -0.2]} r={0.1} square tex="wood_oak" />
    </group>
  );
};

const Trough: React.FC<{position: V3; len?: number}> = ({position, len = 2.4}) => <Basin position={position} size={[len, 0.5, 0.6]} liquid="#3d6e74" />;

const Basket: React.FC<{position: V3; full?: boolean}> = ({position, full = true}) => {
  const m = usePlainMat('#9b7a46', 0.95);
  const rub = useMat('stone_face_tuff');
  return (
    <group position={position}>
      <mesh position={[0, 0.2, 0]} material={m} castShadow>
        <cylinderGeometry args={[0.32, 0.24, 0.4, 12, 1, true]} />
      </mesh>
      {full && (
        <mesh position={[0, 0.38, 0]} material={rub} scale={[1, 0.45, 1]}>
          <sphereGeometry args={[0.3, 10, 8]} />
        </mesh>
      )}
    </group>
  );
};

/** Windlass over a shaft: frame + drum + rope + basket at hookY. */
const Windlass: React.FC<{x: number; z: number; hookY: number; drumA: number}> = ({x, z, hookY, drumA}) => (
  <group>
    {[-1.9, 1.9].map((dx) => (
      <React.Fragment key={dx}>
        <Beam a={[x + dx, 0, z - 0.6]} b={[x + dx * 0.85, 2.4, z]} r={0.08} square tex="wood_oak" />
        <Beam a={[x + dx, 0, z + 0.6]} b={[x + dx * 0.85, 2.4, z]} r={0.08} square tex="wood_oak" />
      </React.Fragment>
    ))}
    <group position={[x, 2.4, z]} rotation={[drumA, 0, 0]}>
      <mesh rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.18, 0.18, 3.4, 12]} />
        <meshStandardMaterial color="#7a5a38" roughness={0.9} />
      </mesh>
      {[-1.75, 1.75].map((dx) => (
        <Beam key={dx} a={[dx, -0.6, 0]} b={[dx, 0.6, 0]} r={0.05} square tex="wood_oak" />
      ))}
    </group>
    <Rope a={[x, 2.3, z]} b={[x, hookY + 0.45, z]} sag={0} r={0.03} />
    <Basket position={[x, hookY, z]} />
  </group>
);

// ============================================================ city furnishing
const roomCx = (r: Room) => (r.x0 + r.x1) / 2;

const StableProps: React.FC<{r: Room; f: number}> = ({r, f}) => {
  const straw = useMat('straw', {repeat: [1 / 2.5, 1 / 2.5]});
  const g = useMemo(() => worldUV(new THREE.PlaneGeometry(r.x1 - r.x0 - 0.2, r.d - 0.2).rotateX(-Math.PI / 2), 1), [r]);
  const cx = roomCx(r);
  return (
    <group>
      <mesh geometry={g} position={[cx, r.y0 + 0.02, -r.d / 2]} material={straw} receiveShadow />
      <Trough position={[cx - 0.6, r.y0, -r.d + 0.6]} len={3.4} />
      <Goat position={[cx - 2.2, r.y0, -2.4]} rotY={0.4} seed={3} t={f * 0.1} />
      <Goat position={[cx - 0.7, r.y0, -1.6]} rotY={2.6} seed={5} t={f * 0.1} />
      <Goat position={[cx + 0.4, r.y0, -3.9]} rotY={1.4} seed={8} t={f * 0.1} />
      <Goat position={[cx + 1.6, r.y0, -1.3]} rotY={-0.6} seed={11} t={f * 0.1} scale={0.8} />
      <Donkey position={[cx + 2.3, r.y0, -3.0]} rotY={2.9} t={f * 0.06} />
    </group>
  );
};

const KitchenProps: React.FC<{r: Room; f: number; light?: number}> = ({r, f, light = 0}) => {
  const cx = roomCx(r);
  return (
    <group>
      <Tandir position={[cx - 1.6, r.y0, -2.6]} f={f} light={light} />
      <Jar position={[cx + 2.2, r.y0, -r.d + 0.8]} s={1.1} />
      <Jar position={[cx + 2.9, r.y0, -r.d + 1.0]} s={0.9} color="#b06a40" />
      <Person position={[cx - 0.6, r.y0, -2.0]} rotY={Math.PI} pose="chisel" t={f * 0.12} seed={71} head="cloth" headColor="#c9b07a" />
      <Person position={[cx + 1.4, r.y0, -3.2]} rotY={-2.2} pose="carry" t={f * 0.2} seed={72} />
    </group>
  );
};

const StoreProps: React.FC<{r: Room}> = ({r}) => {
  const cx = roomCx(r);
  return (
    <group>
      {Array.from({length: 12}, (_, i) => (
        <Jar key={i} position={[r.x0 + 0.8 + (i % 6) * ((r.x1 - r.x0 - 1.6) / 5), r.y0, -r.d + 0.7 + Math.floor(i / 6) * 0.9]} s={1.2 + rnd(i) * 0.3} color={i % 3 ? '#a2583a' : '#b9764a'} />
      ))}
      <Basket position={[cx - 1.8, r.y0, -1.5]} />
      <Basket position={[cx - 1.1, r.y0, -1.2]} />
      <Person position={[cx + 0.8, r.y0, -1.9]} rotY={2.4} pose="carry" seed={81} />
    </group>
  );
};

const ChurchProps: React.FC<{r: Room; f: number}> = ({r, f}) => {
  const col = useMat('tuff_carved', {tint: '#f2e3cc'});
  const paint = usePlainMat('#8a3a26', 0.9);
  const cx = roomCx(r);
  const colG = useMemo(() => worldUV(new THREE.CylinderGeometry(0.28, 0.32, r.h + r.vault * 0.6, 14), 1), [r]);
  return (
    <group>
      {[-1, 1].map((s) => (
        <mesh key={s} geometry={colG} position={[cx + s * 1.35, r.y0 + (r.h + r.vault * 0.6) / 2, -3.4]} material={col} castShadow receiveShadow />
      ))}
      {/* altar + painted cross on the back wall */}
      <mesh position={[cx, r.y0 + 0.5, -r.d + 0.7]} material={col} castShadow receiveShadow>
        <boxGeometry args={[1.4, 1.0, 0.8]} />
      </mesh>
      <mesh position={[cx, r.y0 + 2.4, -r.d + 0.03]} material={paint}>
        <boxGeometry args={[0.18, 1.1, 0.02]} />
      </mesh>
      <mesh position={[cx, r.y0 + 2.6, -r.d + 0.03]} material={paint}>
        <boxGeometry args={[0.7, 0.16, 0.02]} />
      </mesh>
      <Lamp position={[cx - 0.5, r.y0 + 1.05, -r.d + 0.6]} f={f} seed={4} />
      <Lamp position={[cx + 0.5, r.y0 + 1.05, -r.d + 0.6]} f={f} seed={5} />
      <Person position={[cx - 0.4, r.y0, -2.0]} rotY={Math.PI / 2} pose="stand" seed={91} head="cloth" headColor="#5a4a3a" />
      <Person position={[cx + 0.6, r.y0, -1.6]} rotY={Math.PI / 2} pose="stand" seed={92} />
    </group>
  );
};

/** Generic living room: a lamp, a bench, a couple of jars, maybe a person. */
const LivingProps: React.FC<{r: Room; f: number; people?: boolean}> = ({r, f, people = true}) => {
  const bench = useMat('tuff_carved', {tint: '#efe0c8'});
  const cx = roomCx(r);
  const w = r.x1 - r.x0;
  const s = r.seed;
  const g = useMemo(() => uvBox(Math.min(2.6, w - 1), 0.45, 0.6, 1.5), [w]);
  const poses: Pose[] = ['stand', 'walk', 'carry', 'point'];
  return (
    <group>
      <mesh geometry={g} position={[cx - 0.3, r.y0 + 0.225, -r.d + 0.4]} material={bench} castShadow receiveShadow />
      <Lamp position={[cx + w / 2 - 0.6, r.y0 + 1.5, -r.d + 0.15]} f={f} seed={s} />
      <Jar position={[r.x0 + 0.6, r.y0, -r.d + 0.6]} s={0.9 + rnd(s) * 0.4} />
      {people && w > 3.6 && (
        <Person position={[cx + (rnd(s + 1) - 0.5) * (w - 2), r.y0, -1.2 - rnd(s + 2) * (r.d - 2.5)]} rotY={rnd(s + 3) * 6.28} pose={poses[Math.floor(rnd(s + 4) * 4)]} t={f * 0.2} seed={s + 100} head={rnd(s + 5) < 0.5 ? 'cloth' : 'hair'} />
      )}
    </group>
  );
};

/** Furnish the rooms of levels in [kMin,kMax] whose centre lies in [xMin,xMax]. */
const Furnish: React.FC<{f: number; kMin?: number; kMax?: number; xMin?: number; xMax?: number; people?: boolean; light?: number}> = ({f, kMin = 0, kMax = LEVELS - 1, xMin = -99, xMax = 99, people = true, light = 0}) => (
  <group>
    {ROOMS.flat()
      .filter((r) => r.k >= kMin && r.k <= kMax && roomCx(r) >= xMin && roomCx(r) <= xMax)
      .map((r, i) =>
        r.type === 'stable' ? <StableProps key={i} r={r} f={f} /> :
        r.type === 'kitchen' ? <KitchenProps key={i} r={r} f={f} light={light} /> :
        r.type === 'winery' ? <WinePress key={i} position={[roomCx(r) - 0.5, r.y0, -3.0]} f={f} /> :
        r.type === 'store' ? <StoreProps key={i} r={r} /> :
        r.type === 'church' ? <ChurchProps key={i} r={r} f={f} /> :
        <LivingProps key={i} r={r} f={f} people={people} />,
      )}
  </group>
);

/** Stone steps inside each sloped tunnel + a ladder in the main shaft. */
const Steps: React.FC<{kMax?: number}> = ({kMax = LEVELS - 2}) => {
  const m = useMat('tuff_carved', {tint: '#e8d6ba'});
  const ref = React.useRef<THREE.InstancedMesh>(null);
  const items = useMemo(() => {
    const out: THREE.Matrix4[] = [];
    for (let k = 0; k <= Math.min(kMax, LEVELS - 2); k++) {
      const t = tunnelGeom(k);
      const n = 11;
      for (let i = 0; i < n; i++) {
        const u = (i + 0.5) / n;
        const x = t.xa + (t.xb - t.xa) * u;
        const ytop = t.ya + (t.yb - t.ya) * u;
        const hh = ytop - (t.yb - 0.1) + 0.02;
        const o = new THREE.Object3D();
        o.position.set(x, t.yb - 0.1 + hh / 2 - 0.2, -0.72);
        o.scale.set(Math.abs(t.xb - t.xa) / n + 0.02, Math.max(0.05, hh), 1.42);
        o.updateMatrix();
        out.push(o.matrix.clone());
      }
    }
    return out;
  }, [kMax]);
  const g = useMemo(() => uvBox(1, 1, 1, 1), []);
  React.useLayoutEffect(() => {
    items.forEach((mm, i) => ref.current!.setMatrixAt(i, mm));
    ref.current!.instanceMatrix.needsUpdate = true;
  }, [items]);
  return <instancedMesh ref={ref} args={[g, m, items.length]} castShadow receiveShadow />;
};

/** Rolling stone door at the top landing of tunnel k; `closed` 0..1 rolls it out of its slot across the passage. */
const DoorStone: React.FC<{k: number; closed: number; glow?: number}> = ({k, closed, glow = 0}) => {
  const m = useMat('stone_face_tuff', {tint: '#d8c6aa', emissive: '#ffb400', emissiveIntensity: 0});
  m.emissiveIntensity = glow * 0.5;
  const g = useMemo(() => worldUV(new THREE.CylinderGeometry(0.78, 0.78, 0.36, 26).rotateZ(Math.PI / 2), 0.8), []);
  const hole = usePlainMat('#3a3026', 0.9);
  const zOpen = -2.35, zClosed = -0.78;
  const z = zOpen + (zClosed - zOpen) * closed;
  const roll = (z - zOpen) / 0.78;
  return (
    <group position={[DOOR_X(k), floorY(k) + 0.79, z]} rotation={[roll, 0, 0]}>
      <mesh geometry={g} material={m} castShadow receiveShadow />
      <mesh rotation={[0, 0, Math.PI / 2]} material={hole}>
        <cylinderGeometry args={[0.13, 0.13, 0.38, 12]} />
      </mesh>
    </group>
  );
};

/** Little light-blue air puffs streaming down the vertical shafts. */
const AirFlow: React.FC<{f: number; amount?: number}> = ({f, amount = 1}) => {
  const m = useMemo(() => new THREE.MeshStandardMaterial({color: '#8fdcff', emissive: new THREE.Color('#38b6ff'), emissiveIntensity: 1.6, transparent: true, opacity: 0.85, depthWrite: false}), []);
  m.opacity = 0.85 * amount;
  const shafts = useMemo(
    () => [
      ...VENTS.map((v) => ({x: v.x, bottom: floorY(v.k) + 1.6, w: 0.25})),
      {x: (SHAFT.x0 + SHAFT.x1) / 2, bottom: SHAFT.y0, w: 1.0},
    ],
    [],
  );
  const ref = React.useRef<THREE.InstancedMesh>(null);
  const N = 26;
  React.useLayoutEffect(() => {
    const o = new THREE.Object3D();
    let i = 0;
    shafts.forEach((s, si) => {
      const L = 2 - s.bottom;
      for (let j = 0; j < N; j++) {
        const ph = ((f * 0.45 + j * (L / N) + si * 3.7) % L) / L;
        const y = 2 - ph * L;
        o.position.set(s.x + Math.sin(j * 2.3 + f * 0.1) * s.w * 0.6, y, -0.35 - rnd(j + si) * 0.4);
        const sc = (0.16 + 0.06 * Math.sin(j * 1.7)) * (s.w > 0.5 ? 1.5 : 1);
        o.scale.set(sc, sc * 2.6, sc);
        o.updateMatrix();
        ref.current!.setMatrixAt(i++, o.matrix);
      }
    });
    ref.current!.count = i;
    ref.current!.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={ref} args={[undefined, m, shafts.length * N]} frustumCulled={false}>
      <sphereGeometry args={[1, 8, 6]} />
    </instancedMesh>
  );
};

/** Water at the bottom of the well + a bucket on a rope. */
const WellBits: React.FC<{f: number; bucketY?: number}> = ({f, bucketY = WELL.y0 + 6}) => {
  const bucket = usePlainMat('#6e4e30', 0.9);
  const cx = (WELL.x0 + WELL.x1) / 2;
  return (
    <group>
      <Water w={WELL.x1 - WELL.x0 - 0.02} d={-WELL.z0 - 0.02} position={[cx, WELL.y0 + 1.1, WELL.z0 / 2]} time={f / 30} texScale={1.5} color="#3a8ea6" />
      <Rope a={[cx, 2.2, -0.8]} b={[cx, bucketY + 0.35, -0.8]} sag={0} r={0.025} />
      <mesh position={[cx, bucketY, -0.8]} material={bucket} castShadow>
        <cylinderGeometry args={[0.22, 0.17, 0.35, 12]} />
      </mesh>
      {/* well head on the surface */}
      <Beam a={[WELL.x0 - 0.3, 0, -0.8]} b={[WELL.x0 - 0.3, 2.4, -0.8]} r={0.08} square tex="wood_oak" />
      <Beam a={[WELL.x1 + 0.3, 0, -0.8]} b={[WELL.x1 + 0.3, 2.4, -0.8]} r={0.08} square tex="wood_oak" />
      <Beam a={[WELL.x0 - 0.4, 2.3, -0.8]} b={[WELL.x1 + 0.4, 2.3, -0.8]} r={0.07} tex="wood_oak" />
    </group>
  );
};

/** The masonry wall in the 1963 basement that hid the tunnel; `brk` 0..1 knocks it through. */
const PLUG = {x: HOOK_TUNNEL.xa - 0.1, y0: BASEMENT.y0, y1: BASEMENT.y0 + 2.1, z0: -1.75, z1: 0.0};
const WallPlug: React.FC<{brk: number}> = ({brk}) => {
  const m = useMat('tuff_blocks', {tint: '#efe2cc'});
  const pieces = useMemo(() => {
    const out: {p: V3; s: V3; v: V3; spin: V3}[] = [];
    const nx = 3, ny = 4;
    const h = (PLUG.y1 - PLUG.y0) / ny, d = (PLUG.z1 - PLUG.z0) / nx;
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++)
        out.push({
          p: [PLUG.x, PLUG.y0 + (j + 0.5) * h, PLUG.z0 + (i + 0.5) * d],
          s: [0.36, h - 0.02, d - 0.02],
          v: [-0.5 - rnd(i + j * 3) * 1.1, 0.3 + rnd(i * 7 + j) * 0.6, (rnd(i + j * 11) - 0.5) * 0.8],
          spin: [rnd(i) * 4, rnd(j) * 4, rnd(i + j) * 4],
        });
    return out;
  }, []);
  const geos = useMemo(() => pieces.map((p) => uvBox(p.s[0], p.s[1], p.s[2], 1.2)), [pieces]);
  return (
    <group>
      {pieces.map((p, i) => {
        const t = Math.max(0, brk * 1.4 - (rnd(i * 13) * 0.4));
        const k = Math.min(1, t);
        const x = p.p[0] + p.v[0] * k;
        // floor under the piece: basement floor, or the tunnel's sloping floor left of the wall
        const slope = (HOOK_TUNNEL.yb - HOOK_TUNNEL.ya) / (HOOK_TUNNEL.xb - HOOK_TUNNEL.xa);
        const floorAt = x > HOOK_TUNNEL.xa ? BASEMENT.y0 : BASEMENT.y0 + (x - HOOK_TUNNEL.xa) * slope;
        let y = p.p[1] + p.v[1] * k - 6 * k * k;
        y = Math.max(y, floorAt + 0.12 + (i % 3) * 0.12);
        return <mesh key={i} geometry={geos[i]} position={[x, y, p.p[2] + p.v[2] * k * 0.4]} rotation={[p.spin[0] * k, p.spin[1] * k, p.spin[2] * k]} material={m} castShadow receiveShadow />;
      })}
    </group>
  );
};

// ============================================================ stage + labels
const Stage: React.FC<{cam: Cam; children: React.ReactNode; bg?: string; grade?: number; near?: number}> = ({cam, children, bg = '#c9dcec', grade = 0.32, near = 0.1}) => {
  const {width, height} = useVideoConfig();
  return (
    <AbsoluteFill style={{background: bg}}>
      <ThreeCanvas width={width} height={height} shadows camera={{fov: cam.fov, near, far: 4000}}>
        <AssetProvider textures={TEXTURES} hdri="spruit_sunrise_1k">
          <CameraRig pos={cam.pos} target={cam.target} fov={cam.fov} />
          {children}
        </AssetProvider>
      </ThreeCanvas>
      <Grade strength={grade} />
    </AbsoluteFill>
  );
};

const Pin: React.FC<{p: V3; cam: Cam; text: string; delay: number; dx?: number; dy?: number; size?: number; anchor?: 'left' | 'right' | 'center'; minY?: number}> = ({p, cam, text, delay, dx = 0, dy = 0, size = 50, anchor = 'center', minY = 420}) => {
  const [x, y, vis] = toScreen(p, cam);
  if (!vis) return null;
  const w = text.length * size * 0.56 + size * 0.9;
  let lx = x + dx;
  const left = anchor === 'left' ? lx : anchor === 'right' ? lx - w : lx - w / 2;
  if (left < 36) lx += 36 - left;
  if (left + w > 1044) lx -= left + w - 1044;
  return <Tag text={text} x={lx} y={Math.min(1500, Math.max(minY, y + dy))} delay={delay} size={size} anchor={anchor} />;
};

/** A dot + line from a 3D point to its label (drawn under the Pin). */
const Leader3D: React.FC<{p: V3; cam: Cam; dx: number; dy: number; delay: number}> = ({p, cam, dx, dy, delay}) => {
  const f = useCurrentFrame();
  const [x, y, vis] = toScreen(p, cam);
  if (!vis) return null;
  const t = interpolate(f - delay, [0, 8], [0, 1], cl);
  return (
    <svg style={{position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none'}}>
      <line x1={x} y1={y} x2={x + dx * t} y2={y + dy * t} stroke={C.ink} strokeWidth={9} strokeLinecap="round" />
      <line x1={x} y1={y} x2={x + dx * t} y2={y + dy * t} stroke={C.yellow} strokeWidth={4.5} strokeLinecap="round" />
      <circle cx={x} cy={y} r={10 * t} fill={C.yellow} stroke={C.ink} strokeWidth={4} />
    </svg>
  );
};

/** City = carved rock + surface + steps + doors + furnishing. */
const City: React.FC<{f: number; gkey?: string; furnish?: React.ReactNode; doors?: number[]; doorGlow?: number[]; air?: number; well?: boolean}> = ({f, gkey = 'all', furnish, doors, doorGlow, air = 0, well = true}) => (
  <group>
    <CarvedRock gkey={gkey} />
    <Surface />
    {gkey === 'all' && <Steps />}
    {gkey === 'all' && Array.from({length: LEVELS - 1}, (_, k) => <DoorStone key={k} k={k} closed={doors?.[k] ?? 0} glow={doorGlow?.[k] ?? 0} />)}
    {gkey === 'all' && well && <WellBits f={f} />}
    {air > 0 && <AirFlow f={f} amount={air} />}
    {furnish}
  </group>
);


// ============================================================ S1 hook: the wall, the tunnel, the city
const WIDE: Cam = {pos: [0, -29, 133], target: [0, -29, 0], fov: 48};

const S1: React.FC = () => {
  const f = useCurrentFrame();
  const L = LEN[0];
  const brk = ramp(f, 82, 112, Easing.out(Easing.quad));
  const cam = camPath(f, [
    {t: 0, pos: [8.8, -1.4, 6.8], target: [5.4, -2.3, -1.6], fov: 52},
    {t: 112, pos: [7.4, -0.9, 10.5], target: [3.6, -3.8, -1.2], fov: 52},
    {t: 172, pos: [6.6, -1.0, 12.0], target: [3.0, -4.6, -1.2], fov: 52},
    {t: 280, pos: WIDE.pos, target: WIDE.target, fov: WIDE.fov},
    {t: L, pos: [0, -30, 128], target: [0, -30, 0], fov: 48},
  ]);
  const wide = f > 175;
  return (
    <>
      <Stage cam={cam}>
        <Atmos f={f} target={wide ? [0, -35, -5] : [6, -2, -2]} shadowSize={wide ? 70 : 14} />
        <City f={f} furnish={f > 160 ? <Furnish f={f} people={true} /> : null} />
        <WallPlug brk={brk} />
        <Person position={[5.0 + brk * 0.3, BASEMENT.y0, -0.9]} rotY={Math.PI} pose={brk < 1 ? 'hammer' : 'point'} t={f * 0.28} seed={63} head="hat" headColor="#4a4a52" outfit="#5d6f86" pants="#3c3a38" />
        <Lamp position={[9.8, BASEMENT.y0 + 1.2, -4.8]} f={f} light={f < 200 ? 1.4 : 0} />
        {f > 100 && f < 230 && <pointLight position={[1.4, -5.6, -0.7]} color="#ffb060" intensity={1.6 * ramp(f, 100, 130)} distance={7} decay={1.5} />}
        {f > 100 && <Lamp position={[0.9, floorY(0) + 0.02, -0.9]} f={f} seed={9} />}
        {brk > 0 && brk < 1 && <Dust at={[3.8, BASEMENT.y0 + 0.9, -0.8]} f={f} size={0.35} count={8} />}
      </Stage>
      <Sequence durationInFrames={176} layout="none">
        <Sequence durationInFrames={110} layout="none">
          <Pin p={[5.0, BASEMENT.y0 + 2.0, -0.9]} cam={cam} text="1963" delay={10} dy={-120} size={72} />
        </Sequence>
        <Pin p={[1.8, -5.6, -0.8]} cam={cam} text="A TUNNEL!" delay={122} dy={70} size={64} />
      </Sequence>
      <Sequence from={205} layout="none">
        <Headline top="DERINKUYU, TURKEY" big="85 M DEEP" sub="a city under a town" delay={0} y={130} bigSize={150} />
      </Sequence>
    </>
  );
};

// ============================================================ S2 volcanoes → tuff → dig down
const VCX = 0, VCZ = -900;
const volcH = (x: number, z: number) => {
  const d = Math.hypot(x - VCX, z - VCZ);
  const cone = Math.max(0, 1 - d / 760);
  let h = 60 * Math.pow(cone, 1.2);
  h += vnoise(x * 1.6, z * 1.6) * 4 * (1 - cone) + Math.sin(x * 0.05) * Math.cos(z * 0.04) * 1.5;
  return h;
};

/** Fairy-chimney rock: tuff cone with a darker cap. */
const Chimney: React.FC<{position: V3; h?: number; seed?: number}> = ({position, h = 14, seed = 1}) => {
  const tuff = useMat('stone_face_tuff', {tint: '#f1dfc2'});
  const cap = useMat('stone_face_grey', {tint: '#8d8379'});
  const geo = useMemo(() => {
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i <= 12; i++) {
      const y = (i / 12) * h;
      const r = 3.2 * Math.pow(1 - i / 12, 1.3) + 0.9 + 0.25 * Math.sin(i * 1.7 + seed);
      pts.push(new THREE.Vector2(r, y));
    }
    return worldUV(new THREE.LatheGeometry(pts, 18), 2.5);
  }, [h, seed]);
  return (
    <group position={position}>
      <mesh geometry={geo} material={tuff} castShadow receiveShadow />
      <mesh position={[0, h + 0.4, 0]} material={cap} scale={[1.6, 0.6, 1.5]} castShadow>
        <sphereGeometry args={[1.0, 14, 10]} />
      </mesh>
    </group>
  );
};

/** Volcano cone: dark rock lathe with a crater, gullies via texture. */
const VolcanoCone: React.FC = () => {
  const rock = useMat('stone_face_grey', {repeat: [1 / 14, 1 / 14], tint: '#9a8d80'});
  const geo = useMemo(() => {
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i <= 24; i++) {
      const u = i / 24;
      pts.push(new THREE.Vector2(700 * (1 - u) + 85 * u, 440 * Math.pow(u, 1.25) - 10));
    }
    pts.push(new THREE.Vector2(60, 420), new THREE.Vector2(0, 395));
    const g = new THREE.LatheGeometry(pts.reverse(), 64);
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const a = Math.atan2(z, x);
      const k = Math.sin(a * 11) * 0.5 + Math.sin(a * 23 + 1) * 0.3;
      const r = Math.hypot(x, z);
      const f = 1 + (y > 20 && y < 410 ? k * 0.035 : 0);
      p.setXYZ(i, (x / (r || 1)) * r * f, y, (z / (r || 1)) * r * f);
    }
    g.computeVertexNormals();
    return worldUV(g, 1);
  }, []);
  return <mesh geometry={geo} position={[VCX, 0, VCZ]} material={rock} castShadow receiveShadow />;
};

const Plume: React.FC<{f: number; grow: number}> = ({f, grow}) => {
  const mats = useMemo(() => [0, 1, 2].map((i) => new THREE.MeshStandardMaterial({color: ['#6f6862', '#8a827a', '#5a544f'][i], roughness: 1, transparent: true, opacity: 0.95})), []);
  const blobs = useMemo(() => Array.from({length: 70}, (_, i) => ({ph: rnd(i * 3.1), a: rnd(i * 5.7) * 6.28, s: 0.6 + rnd(i * 2.2) * 0.8})), []);
  return (
    <group position={[VCX, 410, VCZ]}>
      {blobs.map((b, i) => {
        const u = ((b.ph + f * 0.004) % 1) * grow;
        const y = u * 760;
        const r = 26 + u * 150;
        const sp = u * 160;
        return (
          <mesh key={i} material={mats[i % 3]} position={[Math.cos(b.a) * sp + u * 150, y, Math.sin(b.a) * sp * 0.6]} scale={r * b.s}>
            <icosahedronGeometry args={[1, 4]} />
          </mesh>
        );
      })}
    </group>
  );
};

/** Tuff cliff face (section through ash layers) with a doorway being carved. */
const Cliff: React.FC = () => {
  const face = useMat('tuff_strata', {repeat: [1 / 9, 1 / 9]});
  const carved = useMat('tuff_carved', {repeat: [1 / 2, 1 / 2]});
  const parts: [V3, V3][] = [
    [[-12, 7, -3], [22.6, 14, 6]], // left of door (x -23..-0.7)
    [[12.7, 7, -3], [24, 14, 6]], // right of door (x 0.7..24.7)
    [[0, 8.05, -3], [1.4, 11.9, 6]], // above door
  ];
  const geos = useMemo(() => parts.map(([, s]) => uvBox(s[0], s[1], s[2], 1)), []);
  const inner = useMemo(() => uvBox(1.42, 2.1, 0.05, 1), []);
  return (
    <group>
      {parts.map(([p], i) => (
        <mesh key={i} geometry={geos[i]} position={p} material={face} castShadow receiveShadow />
      ))}
      {/* doorway reveal (carved surfaces) */}
      <mesh geometry={inner} position={[0, 1.05, -2.2]} material={carved} receiveShadow />
      <mesh position={[0, 1.05, -1.1]} material={carved}>
        <boxGeometry args={[1.45, 2.12, 2.2]} />
        <meshStandardMaterial side={THREE.BackSide} color="#5a4636" roughness={1} />
      </mesh>
    </group>
  );
};

const S2: React.FC = () => {
  const f = useCurrentFrame();
  const L = LEN[1];
  const c1 = 112, c2 = 236;
  const camA = camPath(f, [
    {t: 0, pos: [40, 14, 160], target: [0, 230, -900], fov: 50},
    {t: c1, pos: [30, 16, 115], target: [0, 250, -900], fov: 50},
  ]);
  const g = f - c1;
  const camB = camPath(g, [
    {t: 0, pos: [4.2, 2.0, 8.5], target: [-0.2, 1.7, 0], fov: 52},
    {t: c2 - c1, pos: [3.0, 1.8, 6.6], target: [-0.3, 1.5, 0], fov: 52},
  ]);
  const h = f - c2;
  const stage = Math.min(N_STAGES - 1, Math.round(1 + ramp(h, 0, L - c2, Easing.linear) * 5));
  const tt = stage / (N_STAGES - 1);
  const shaftBottom = 1.5 + (floorY(1) - 0.3 - 1.5) * Math.min(1, tt / 0.3);
  const camC = camPath(h, [
    {t: 0, pos: [4.5, 5.5, 13], target: [-2.6, -2.4, -1.4], fov: 55},
    {t: L - c2, pos: [3.6, 4.0, 11], target: [-2.6, -3.4, -1.4], fov: 55},
  ]);
  const hook = shaftBottom + 0.3 + (Math.sin(h * 0.06) * 0.5 + 0.5) * (-shaftBottom + 1.0);
  return (
    <>
      <Sequence durationInFrames={c1} layout="none">
        <Stage cam={camA} bg="#c8c2b8">
          <Renderer exposure={1.0} envIntensity={0.6} />
          <SkyDome top="#3d5f95" horizon="#d8cfc0" sunDir={[-0.5, 0.6, 0.6]} clouds={0.3} time={f / 30} />
          <Sun dir={[-0.5, 0.6, 0.6]} intensity={2.8} shadowSize={120} shadowRes={4096} target={[0, 0, -60]} />
          <fog attach="fog" args={['#cfc6b8', 300, 2400]} />
          <Terrain height={volcH} size={3000} seg={260} tex="sand" texScale={9} center={[0, -1000]} />
          <VolcanoCone />
          <Plume f={f} grow={0.55 + 0.45 * ramp(f, 0, c1)} />
          {[[-30, -60, 16], [-12, -95, 22], [18, -70, 13], [40, -120, 19], [-55, -140, 24], [8, -170, 17], [62, -190, 21], [-80, -230, 18]].map(([x, z, hh], i) => (
            <Chimney key={i} position={[x, volcH(x, z) - 0.5, z]} h={hh} seed={i} />
          ))}
          {[[-20, -30], [25, -40], [0, -48]].map(([x, z], i) => (
            <Bush key={i} position={[x, volcH(x, z), z]} scale={2} seed={i} color="#7a7a45" />
          ))}
        </Stage>
        <Pin p={[-180, 290, VCZ + 180]} cam={camA} text="VOLCANO" delay={8} size={60} />
        <Pin p={[80, 700, VCZ]} cam={camA} text="ASH" delay={40} size={60} />
      </Sequence>
      <Sequence from={c1} durationInFrames={c2 - c1} layout="none">
        <SceneFade dur={c2 - c1} inF={6} outF={0}>
          <Stage cam={camB}>
            <Renderer envIntensity={0.65} />
            <SkyDome clouds={0.4} time={f / 30} />
            <Sun dir={[-0.6, 0.85, 0.7]} shadowSize={14} target={[0, 1, 0]} />
            <fog attach="fog" args={['#c9dcec', 60, 300]} />
            <Terrain height={(x, z) => (z > 0 ? 0 : 0.02 * Math.sin(x))} size={300} seg={30} tex="sand" texScale={5} />
            <Cliff />
            <Person position={[1.3, 0, 0.75]} rotY={Math.PI * 0.82} pose="chisel" t={g * 0.25} seed={33} head="cloth" />
            <Dust at={[0.75, 1.3, 0.25]} f={g} size={0.18} />
            {[0, 1, 2, 3, 4].map((i) => (
              <Rock key={i} position={[-1.6 + i * 0.5 + rnd(i) * 0.3, 0.1, 0.9 + rnd(i + 4) * 0.8]} scale={[0.22, 0.15, 0.2]} seed={i + 40} tex="stone_face_tuff" />
            ))}
            <Basket position={[-1.9, 0, 1.7]} />
          </Stage>
          <Pin p={[-3.2, 4.4, 0]} cam={camB} text="TUFF" delay={6} size={72} />
          <Caption text="Soft enough to carve with hand tools" delay={18} bottom={300} />
        </SceneFade>
      </Sequence>
      <Sequence from={c2} layout="none">
        <SceneFade dur={L - c2} inF={6} outF={0}>
          <Stage cam={camC}>
            <Atmos f={f} target={[-2, -2, -2]} shadowSize={14} />
            <City f={f} gkey={`stage${stage}`} />
            <Windlass x={-2.6} z={-1.4} hookY={hook} drumA={-h * 0.05} />
            <Person position={[-2.6, shaftBottom, -1.0]} rotY={-Math.PI / 2} pose="chisel" t={h * 0.25} seed={36} head="cloth" />
            <Person position={[0.6, 0, -2.6]} rotY={Math.PI} pose="haul" t={h * 0.2} seed={37} />
            <Dust at={[-2.6, shaftBottom + 0.3, -1.4]} f={h} size={0.2} />
          </Stage>
          <Tag text="DIG DOWN, NOT UP" x={540} y={1380} anchor="center" delay={4} size={70} />
        </SceneFade>
      </Sequence>
    </>
  );
};

// ============================================================ S3 step 1: carve, don't build
const stageParams = (i: number) => {
  const t = i / (N_STAGES - 1);
  const sm = (a: number, b: number) => Math.min(1, Math.max(0, (t - a) / (b - a)));
  const shaftBottom = 1.5 + (floorY(1) - 0.3 - 1.5) * sm(0.0, 0.3);
  const rooms = carvingRooms();
  const fr = rooms.map((_, j) => sm(0.22 + (j * 0.62) / rooms.length, 0.22 + (j * 0.62) / rooms.length + 0.16));
  return {shaftBottom, rooms, fr};
};

const S3: React.FC = () => {
  const f = useCurrentFrame();
  const L = LEN[2];
  const stage = Math.round(ramp(f, 4, L - 12, Easing.linear) * (N_STAGES - 1));
  const {shaftBottom, rooms, fr} = stageParams(stage);
  const cam = camPath(f, [
    {t: 0, pos: [-1, -4.5, 31], target: [-1, -6.5, -2], fov: 55},
    {t: L, pos: [-0.5, -6.0, 28], target: [-0.5, -8.0, -2], fov: 55},
  ]);
  const hook = Math.max(shaftBottom, floorY(1)) + 0.3 + (Math.sin(f * 0.07) * 0.5 + 0.5) * 6;
  return (
    <>
      <Stage cam={cam}>
        <Atmos f={f} target={[-1, -8, -2]} shadowSize={24} />
        <City f={f} gkey={`stage${stage}`} />
        <Windlass x={-2.6} z={-1.4} hookY={Math.min(1, hook)} drumA={-f * 0.06} />
        {shaftBottom > floorY(1) + 0.1 && <Person position={[-2.6, shaftBottom, -1.0]} rotY={-Math.PI / 2} pose="chisel" t={f * 0.25} seed={36} head="cloth" />}
        {rooms.map((r, j) => {
          const k = fr[j];
          if (k <= 0.03 || k >= 0.999) return null;
          const right = r.x0 > SHAFT.x1;
          const w = (r.x1 - r.x0) * k;
          const xf = right ? r.x0 + w - 0.55 : r.x1 - w + 0.55;
          return (
            <group key={j}>
              <Person position={[xf, r.y0, -0.9]} rotY={right ? 0 : Math.PI} pose={j % 2 ? 'hammer' : 'chisel'} t={f * 0.26 + j} seed={40 + j} head={j % 2 ? 'cloth' : 'hair'} />
              <Dust at={[xf + (right ? 0.5 : -0.5), r.y0 + 1.2, -0.9]} f={f + j * 5} size={0.22} />
              <Lamp position={[xf - (right ? 1.2 : -1.2), r.y0 + 0.02, -1.4]} f={f} seed={j} />
            </group>
          );
        })}
        {rooms.map((r, j) =>
          fr[j] >= 0.999 ? <Basket key={'b' + j} position={[r.x0 > 0 ? r.x0 + 0.7 : r.x1 - 0.7, r.y0, -1.2]} /> : null,
        )}
        <Person position={[0.8, 0, -2.4]} rotY={Math.PI} pose="haul" t={f * 0.2} seed={37} />
      </Stage>
      <StepBadge n={1} title="CARVE, DON'T BUILD" delay={3} />
      <Pin p={[-1.2, -2.4, 0]} cam={cam} text="SHAFT" delay={14} dx={30} anchor="left" size={52} />
      <Pin p={[-8.8, -5.0, 0]} cam={cam} text="LEVEL 1" delay={92} dy={-20} size={52} />
      <Pin p={[3.4, -9.6, 0]} cam={cam} text="LEVEL 2" delay={150} dy={-10} size={52} />
      <Caption text="Every room is cut out of solid rock" delay={40} bottom={300} />
    </>
  );
};

// ============================================================ S4 step 2: air (and water)
const S4: React.FC = () => {
  const f = useCurrentFrame();
  const L = LEN[3];
  const cam = camPath(f, [
    {t: 0, pos: [-11, -7, 44], target: [-11, -13, 0], fov: 52},
    {t: L * 0.42, pos: [-11, -16, 44], target: [-11, -22, 0], fov: 52},
    {t: L * 0.62, pos: [-13, -30, 46], target: [-14, -34, 0], fov: 52},
    {t: L, pos: [-12, -29, 80], target: [-12, -29.5, 0], fov: 52},
  ]);
  const wellY = WELL.y0 + 1.1;
  return (
    <>
      <Stage cam={cam}>
        <Atmos f={f} target={[-12, -30, -3]} shadowSize={50} />
        <City f={f} air={ramp(f, 4, 20)} furnish={<Furnish f={f} kMax={13} xMin={-30} xMax={4} />} />
        <WellGlow t={ramp(f, L * 0.6, L * 0.75)} />
      </Stage>
      <StepBadge n={2} title="FRESH AIR" delay={3} />
      <Sequence durationInFrames={Math.round(L * 0.58)} layout="none">
        <Pin p={[-13.3, -6, 0]} cam={cam} text="AIR SHAFT" delay={30} dx={30} anchor="left" size={50} />
        <Pin p={[(SHAFT.x0 + SHAFT.x1) / 2, -14, 0]} cam={cam} text="MAIN SHAFT" delay={52} dx={40} anchor="left" size={50} />
        <Caption text="50+ shafts pull fresh air down" delay={38} bottom={300} />
      </Sequence>
      <Sequence from={Math.round(L * 0.62)} layout="none">
        <Leader3D p={[(WELL.x0 + WELL.x1) / 2, wellY, -0.3]} cam={cam} dx={170} dy={-40} delay={0} />
        <Pin p={[(WELL.x0 + WELL.x1) / 2, wellY, 0]} cam={cam} text="WATER" delay={6} dx={170} dy={-40} anchor="left" size={52} />
        <Pin p={[(WELL.x0 + WELL.x1) / 2, -26, 0]} cam={cam} text="WELL: 55 M DEEP" delay={14} dx={60} anchor="left" size={56} />
      </Sequence>
    </>
  );
};

const WellGlow: React.FC<{t: number}> = ({t}) => {
  const m = useMemo(() => new THREE.MeshBasicMaterial({color: '#5fd2ff', transparent: true, opacity: 0, depthWrite: false}), []);
  m.opacity = 0.45 * t;
  const h = -WELL.y0 * t;
  return (
    <mesh material={m} position={[(WELL.x0 + WELL.x1) / 2, -h / 2, 0.06]}>
      <planeGeometry args={[WELL.x1 - WELL.x0 + 0.3, Math.max(0.01, h)]} />
    </mesh>
  );
};

// ============================================================ S5 step 3: everything a town needs
const S5: React.FC = () => {
  const f = useCurrentFrame();
  const L = LEN[4];
  const cam = camPath(f, [
    {t: 0, pos: [9.5, -13.2, 46], target: [9.5, -15.0, 0], fov: 50},
    {t: L, pos: [9.3, -13.8, 41.5], target: [9.3, -15.4, 0], fov: 50},
  ]);
  const labels: [string, string, number][] = [
    ['stable', 'STABLES', 76],
    ['kitchen', 'KITCHEN', 100],
    ['winery', 'WINE + OIL PRESS', 121],
    ['store', 'STOREROOM', 150],
    ['church', 'CHURCH', 183],
  ];
  return (
    <>
      <Stage cam={cam}>
        <Atmos f={f} target={[9, -16, -3]} shadowSize={30} />
        <City f={f} furnish={<Furnish f={f} kMax={6} xMin={-3} xMax={24} light={1.6} />} />
        <pointLight position={[11, -14.2, -2]} color="#ffb060" intensity={2} distance={10} decay={1.5} />
        <pointLight position={[7.4, -23, -2]} color="#ffb060" intensity={2} distance={10} decay={1.5} />
      </Stage>
      <StepBadge n={3} title="A WHOLE TOWN" delay={3} />
      {labels.map(([t, txt, d]) => {
        const r = special(t as never);
        return <Pin key={t} p={[roomCx(r), r.y0 + r.h + 0.2, 0]} cam={cam} text={txt} delay={d} size={48} dy={-8} />;
      })}
    </>
  );
};

// ============================================================ S6 the clever part: rolling stone doors
const DoorSet: React.FC<{f: number; diskX: number}> = ({f, diskX}) => {
  const rock = useMat('tuff_carved', {repeat: [1 / 2.2, 1 / 2.2], tint: '#f0e2cc'});
  const disk = useMat('stone_face_tuff', {tint: '#d7c4a6'});
  const sky = usePlainMat('#fff0d4', 1, 0, {emissive: new THREE.Color('#ffe8c0'), emissiveIntensity: 2.4});
  const boxes: [V3, V3][] = [
    [[0, -0.3, -4], [10, 0.6, 24]], // floor
    [[-1.25, 0.8, -7.4], [1.5, 1.6, 15.3]], // passage left wall
    [[1.5, 0.8, -7.8], [2.0, 1.6, 14.4]], // passage right wall (behind slot)
    [[1.25, 0.8, 0.03], [1.5, 1.6, 0.42]], // right wall in front of slot
    [[2.75, 0.85, -0.4], [0.5, 1.7, 0.44]], // slot back
    [[0.5, 2.1, -7.4], [4.0, 1.0, 15.3]], // passage ceiling
    [[-2.6, 1.4, 0.12], [4.2, 2.8, 0.25]], // room back wall left
    [[2.6, 1.4, 0.12], [4.2, 2.8, 0.25]], // room back wall right
    [[0, 2.2, 0.12], [1.1, 1.2, 0.25]], // above passage
    [[0, 3.0, 4], [10, 0.5, 8]], // room ceiling
    [[-4.2, 1.4, 4], [0.5, 2.8, 8]], // room left wall
    [[4.2, 1.4, 4], [0.5, 2.8, 8]], // room right wall
  ];
  const geos = useMemo(() => boxes.map(([, s]) => uvBox(s[0], s[1], s[2], 1)), []);
  const dg = useMemo(() => worldUV(new THREE.CylinderGeometry(0.78, 0.78, 0.38, 30).rotateX(Math.PI / 2), 0.8), []);
  const roll = (1.45 - diskX) / 0.78;
  return (
    <group>
      {boxes.map(([p], i) => (
        <mesh key={i} geometry={geos[i]} position={p} material={rock} castShadow receiveShadow />
      ))}
      <mesh position={[0, 0.8, -14.9]} material={sky}>
        <planeGeometry args={[1.0, 1.6]} />
      </mesh>
      <pointLight position={[0, 1.0, -13]} color="#ffe2b8" intensity={3} distance={9} decay={1.4} />
      <group position={[diskX, 0.79, -0.4]} rotation={[0, 0, roll]}>
        <mesh geometry={dg} material={disk} castShadow receiveShadow />
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.13, 0.13, 0.4, 12]} />
          <meshStandardMaterial color="#3a3026" roughness={0.9} />
        </mesh>
      </group>
      <Lamp position={[-3.2, 1.35, 0.45]} f={f} light={2.2} seed={2} />
      <Lamp position={[3.3, 1.35, 0.45]} f={f} light={1.6} seed={3} />
      <Jar position={[-3.3, 0, 1.6]} s={1.2} />
      <Jar position={[-2.7, 0, 1.2]} s={0.9} color="#b9764a" />
    </group>
  );
};

const S6: React.FC = () => {
  const f = useCurrentFrame();
  const L = LEN[5];
  const cut = 168;
  const close = ramp(f, 46, 132, Easing.inOut(Easing.sin));
  const diskX = 1.05 - 1.05 * close;
  const camA = camPath(f, [
    {t: 0, pos: [0.35, 1.75, 6.4], target: [-0.05, 0.85, -1.0], fov: 60},
    {t: cut, pos: [0.3, 1.65, 5.6], target: [-0.05, 0.85, -1.0], fov: 60},
  ]);
  const g = f - cut;
  const camB = camPath(g, [
    {t: 0, pos: [52, -21, 36], target: [26.5, -25, -1.2], fov: 46},
    {t: L - cut, pos: [47, -23, 33], target: [26.5, -26, -1.2], fov: 46},
  ]);
  const doors = Array.from({length: LEVELS - 1}, (_, k) => (k % 2 === 0 && k <= 10 ? ramp(g, 8 + (k / 2) * 12, 26 + (k / 2) * 12) : 0));
  const glow = doors.map((d) => d * (d < 1 ? 1 : 0.6));
  return (
    <>
      <Sequence durationInFrames={cut} layout="none">
        <Stage cam={camA} bg="#2a221a" grade={0.45}>
          <Renderer exposure={1.05} envIntensity={0.18} />
          <hemisphereLight args={['#ffe2c0', '#4a3a2a', 0.35]} />
          <DoorSet f={f} diskX={diskX} />
          <Person position={[-0.5 - close * 0.2, 0, 2.7]} rotY={Math.PI - 1.0} pose="pull" t={f * 0.18} seed={61} head="cloth" headColor="#b8a07a" />
          <Rope a={[-0.42 - close * 0.2, 1.2, 2.5]} b={[diskX, 0.79, -0.18]} sag={0.03} r={0.03} />
        </Stage>
        <Headline top="THE CLEVER PART" big="STONE DOORS" delay={2} y={130} bigSize={130} />
        <Pin p={[diskX, 1.6, -0.4]} cam={camA} text="UP TO 500 KG" delay={30} dy={-60} size={58} minY={560} />
        <Sequence from={118} layout="none">
          <Caption text="It only moves from the inside" delay={0} bottom={300} />
        </Sequence>
      </Sequence>
      <Sequence from={cut} layout="none">
        <SceneFade dur={L - cut} inF={6} outF={0}>
          <Stage cam={camB}>
            <Atmos f={f} target={[26, -25, -3]} shadowSize={30} />
            <City f={f} doors={doors} doorGlow={glow} furnish={<Furnish f={f} kMin={0} kMax={10} xMin={14} />} />
          </Stage>
          <Caption text="Every level can be sealed on its own" delay={4} bottom={300} />
        </SceneFade>
      </Sequence>
    </>
  );
};

// ============================================================ S7 levels
const LevelBands: React.FC<{cur: number; split: number}> = ({cur, split}) => {
  const mats = useMemo(() => Array.from({length: LEVELS}, () => new THREE.MeshBasicMaterial({color: '#ffc928', transparent: true, opacity: 0, depthWrite: false})), []);
  const dark = useMemo(() => new THREE.MeshBasicMaterial({color: '#0d0a08', transparent: true, opacity: 0, depthWrite: false}), []);
  const top8 = floorY(8) + 3.9;
  dark.opacity = 0.55 * split;
  return (
    <group>
      {mats.map((m, k) => {
        const d = cur - k;
        m.opacity = (d < -0.5 ? 0 : Math.max(0.14, 0.6 - Math.max(0, d) * 0.15)) * (1 - split) + (k < 8 ? 0.28 * split : 0);
        return (
          <mesh key={k} material={m} position={[0, floorY(k) + 1.75, 0.08]}>
            <planeGeometry args={[2 * XMAX + 14, 3.6]} />
          </mesh>
        );
      })}
      <mesh material={dark} position={[0, (top8 + -90) / 2, 0.12]}>
        <planeGeometry args={[2 * XMAX + 30, top8 + 90]} />
      </mesh>
    </group>
  );
};

const Bracket: React.FC<{cam: Cam; y0: number; y1: number; x: number; delay: number}> = ({cam, y0, y1, x, delay}) => {
  const f = useCurrentFrame();
  const [ax, ay] = toScreen([x, y0, 0], cam);
  const [, by] = toScreen([x, y1, 0], cam);
  const t = interpolate(f - delay, [0, 10], [0, 1], cl);
  const yb = ay + (by - ay) * t;
  return (
    <svg style={{position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none'}}>
      {[[C.ink, 12], [C.yellow, 6]].map(([c, w], i) => (
        <path key={i} d={`M ${ax - 24} ${ay} L ${ax} ${ay} L ${ax} ${yb} L ${ax - 24} ${yb}`} stroke={c as string} strokeWidth={w as number} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </svg>
  );
};

const S7: React.FC = () => {
  const f = useCurrentFrame();
  const L = LEN[6];
  const cam = camPath(f, [
    {t: 0, pos: [0, -31, 126], target: [0, -31, 0], fov: 48},
    {t: L, pos: [3, -33, 121], target: [2, -33, 0], fov: 48},
  ]);
  const cur = ramp(f, 10, 100, Easing.inOut(Easing.sin)) * (LEVELS - 1);
  const split = ramp(f, 112, 128);
  const ck = Math.round(cur);
  return (
    <>
      <Stage cam={cam}>
        <Atmos f={f} />
        <City f={f} furnish={<Furnish f={f} kMax={9} />} />
        <LevelBands cur={cur} split={split} />
      </Stage>
      <Headline top="AS MANY AS" big="18 LEVELS" delay={4} y={130} bigSize={140} />
      {f < 118 && <Tag text={`LEVEL ${ck + 1}`} x={toScreen([-XMAX - 1, floorY(ck) + 1.7, 0], cam)[0]} y={Math.max(560, toScreen([-XMAX - 1, floorY(ck) + 1.7, 0], cam)[1])} anchor="left" size={54} delay={8} />}
      <Sequence from={114} layout="none">
        <Bracket cam={cam} y0={floorY(0) + 3.6} y1={floorY(7)} x={XMAX + 3.5} delay={0} />
        <Pin p={[XMAX + 3.5, (floorY(0) + floorY(7)) / 2 + 2, 0]} cam={cam} text="8 OPEN TODAY" delay={6} dx={-40} anchor="right" size={56} />
      </Sequence>
    </>
  );
};

// ============================================================ S8 payoff
const S8: React.FC = () => {
  const f = useCurrentFrame();
  const L = LEN[7];
  const cam = camPath(f, [
    {t: 0, pos: [12, -24, 62], target: [5, -27, 0], fov: 50},
    {t: L, pos: [-8, -30, 140], target: [0, -31, 0], fov: 48},
  ]);
  return (
    <>
      <Stage cam={cam} bg="#f0cfa4">
        <Atmos f={f} golden={1} />
        <City f={f} furnish={<Furnish f={f} kMax={12} light={0} />} />
      </Stage>
      <Headline top="IT COULD SHELTER" big="20,000 PEOPLE" sub="+ animals + food" delay={6} y={130} bigSize={124} />
      <Caption text="All of it, carved by hand" delay={Math.round(VO.durations[7] * FPS * 0.62)} bottom={300} />
    </>
  );
};

// ============================================================ timeline
const SCENES = [S1, S2, S3, S4, S5, S6, S7, S8];

export const Derinkuyu: React.FC = () => {
  const ready = useGeoReady();
  if (!ready) return null;
  return (
    <AbsoluteFill style={{background: '#c9dcec'}}>
      {SCENES.map((S, i) => (
        <Sequence key={i} from={START[i]} durationInFrames={LEN[i]}>
          <SceneFade dur={LEN[i]} inF={i === 0 ? 0 : 6} outF={i === SCENES.length - 1 ? 0 : 6}>
            <S />
          </SceneFade>
        </Sequence>
      ))}
      {VO.durations.map((_, i) => (
        <Sequence key={i} from={START[i] + VO_DELAY} layout="none">
          <Audio src={staticFile(`vo/ep004-derinkuyu_${i}.wav`)} />
        </Sequence>
      ))}
      <Watermark />
    </AbsoluteFill>
  );
};
export const DERINKUYU_START = START;
export const DERINKUYU_LEN = LEN;
