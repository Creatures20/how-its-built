// Episode 3: How the Romans built aqueducts (Pont du Gard) — v2 kit showcase.
import React, {useMemo} from 'react';
import {AbsoluteFill, Audio, interpolate, Sequence, staticFile, useCurrentFrame, useVideoConfig, Easing} from 'remotion';
import {ThreeCanvas} from '@remotion/three';
import * as THREE from 'three';
import VO from './ep003-aqueduct-vo.json';
import {AssetProvider, Renderer, SkyDome, Sun, TexName, useMat, usePlainMat, uvBox, worldUV} from '../hib/pbr';
import {Beam, Bush, Cypress, Dust, House, KIT_TEXTURES, Person, walkAlong, Pine, Plank, Rock, Rope, ScaffoldBay, Terrain, Tree, Water, rnd} from '../hib/models';
import {CameraRig} from '../hib/three';
import {Cam, camPath, groundSafe, toScreen} from '../hib/project';
import {Caption, Grade, Headline, SceneFade, StepBadge, Tag, Watermark} from '../hib/ui';

// ============================================================ timing
const FPS = 30;
const VO_DELAY = 5;
const sceneLen = (i: number, tail: number) => Math.ceil((VO.durations[i] + tail) * FPS) + VO_DELAY;
const LEN = [sceneLen(0, 0.5), sceneLen(1, 0.5), sceneLen(2, 0.5), sceneLen(3, 0.45), sceneLen(4, 0.45), sceneLen(5, 0.5), sceneLen(6, 0.5), sceneLen(7, 1.6)];
const START = LEN.map((_, i) => LEN.slice(0, i).reduce((a, b) => a + b, 0));
export const AQUEDUCT_DURATION = LEN.reduce((a, b) => a + b, 0);

const cl = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
const ramp = (f: number, a: number, b: number, ease = Easing.inOut(Easing.cubic)) => interpolate(f, [a, b], [0, 1], {...cl, easing: ease});

const TEXTURES: TexName[] = [...KIT_TEXTURES, 'grass', 'dirt', 'limestone_ashlar', 'stone_face_lime', 'stone_face_grey', 'water', 'concrete', 'plaster_ochre', 'roof_tiles', 'gravel'];
const STONE_TINT = '#efd9b0';

// ============================================================ the valley
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerpTable = (x: number, pts: [number, number][]) => {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
    if (x <= x1) return y0 + (y1 - y0) * smooth(x0, x1, x);
  }
  return pts[pts.length - 1][1];
};
const vnoise = (x: number, z: number) => Math.sin(x * 0.031 + 1.3) * Math.cos(z * 0.027 + 0.4) * 0.6 + Math.sin(x * 0.083 + z * 0.061) * 0.4;

// ---- bridge layout (Pont du Gard proportions, metres)
type Tier = {spans: number[]; pier: number; H: number; thick: number; base: number; x0: number; crown: number};
const mkTier = (spans: number[], pier: number, H: number, thick: number, base: number, crown: number, alignArch: number | null, alignX: number, centerX = 0): Tier & {centers: number[]; L: number} => {
  const L = spans.reduce((a, b) => a + b, 0) + pier * (spans.length + 1);
  const centersLocal: number[] = [];
  let x = 0;
  spans.forEach((s) => {
    x += pier;
    centersLocal.push(x + s / 2);
    x += s;
  });
  const x0 = alignArch !== null ? alignX - centersLocal[alignArch] : centerX - L / 2;
  return {spans, pier, H, thick, base, x0, crown, centers: centersLocal.map((c) => c + x0), L};
};
const T1 = mkTier([15, 17, 24.5, 19.5, 17, 14], 5.2, 25, 6.4, -3, 1.6, null, 0, 0);
const RIVER_X = T1.centers[2];
const T2 = mkTier([16.2, 16.2, 16.2, 16.2, 16.2, 24.5, 16.2, 16.2, 16.2, 16.2, 16.2], 4.6, 20, 4.6, 22, 1.4, 5, RIVER_X);
const T3 = mkTier(Array(35).fill(4.6), 3.2, 5.6, 3.0, 42, 0.8, null, 0, (T2.x0 + T2.L / 2));
const CH_Y = T3.base + T3.H; // channel floor (47.6)

const valleyH = (x: number, z: number) => {
  const ax = Math.abs(x - 6 * Math.sin(z / 70));
  let h = lerpTable(ax, [[40, 1.6], [72, 22.5], [100, 33], [122, 43], [140, 50], [175, 56], [300, 62]]);
  h += vnoise(x, z) * smooth(40, 90, ax) * 4;
  const ar = Math.abs(x - RIVER_X + 3 * Math.sin(z / 40));
  const bank = lerpTable(ar, [[12, -2.6], [18, 0.9], [24, 1.4]]);
  if (ar < 24) h = Math.min(h, bank + (h - 1.6) * smooth(18, 24, ar));
  return h;
};

// ---- arcade geometry (one contour: piers + semicircular arches)
const arcadeGeo = (t: Tier) => {
  const s = new THREE.Shape();
  let x = 0;
  s.moveTo(0, 0);
  t.spans.forEach((sp) => {
    x += t.pier;
    const r = sp / 2;
    const spring = t.H - t.crown - r;
    s.lineTo(x, 0);
    s.lineTo(x, spring);
    s.absarc(x + r, spring, r, Math.PI, 0, true);
    s.lineTo(x + sp, 0);
    x += sp;
  });
  x += t.pier;
  s.lineTo(x, 0);
  s.lineTo(x, t.H);
  s.lineTo(0, t.H);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, {depth: t.thick, bevelEnabled: false, curveSegments: 20});
  g.translate(t.x0, t.base, -t.thick / 2);
  return worldUV(g, 5);
};

/** Protruding stones on pier faces (they held the scaffolding). */
const lugPositions = (t: Tier) => {
  const out: [number, number, number][] = [];
  let x = t.x0;
  for (let i = 0; i <= t.spans.length; i++) {
    const cx = x + t.pier / 2;
    for (const y of [0.35, 0.62]) for (const side of [-1, 1]) out.push([cx + (i % 2 ? 0.8 : -0.8), t.base + t.H * y, side * (t.thick / 2 + 0.3)]);
    x += t.pier + (t.spans[i] ?? 0);
  }
  return out;
};

const Lugs: React.FC<{pos: [number, number, number][]; mat: THREE.Material}> = ({pos, mat}) => {
  const ref = React.useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(() => uvBox(0.7, 0.55, 0.6, 1.5), []);
  React.useLayoutEffect(() => {
    const o = new THREE.Object3D();
    pos.forEach((p, i) => {
      o.position.set(...p);
      o.updateMatrix();
      ref.current!.setMatrixAt(i, o.matrix);
    });
    ref.current!.instanceMatrix.needsUpdate = true;
  }, [pos]);
  return <instancedMesh ref={ref} args={[geo, mat, pos.length]} castShadow receiveShadow />;
};

/** The full bridge. rev2/rev3 = reveal heights (world y) for tiers 2 and 3; coverGap opens the channel. */
const Bridge: React.FC<{rev2?: number; rev3?: number; coverGap?: number; waterT?: number; time?: number}> = ({rev2 = 999, rev3 = 999, coverGap = 0, waterT = 1, time = 0}) => {
  const p2 = useMemo(() => new THREE.Plane(new THREE.Vector3(0, -1, 0), 0), []);
  const p3 = useMemo(() => new THREE.Plane(new THREE.Vector3(0, -1, 0), 0), []);
  p2.constant = rev2;
  p3.constant = rev3;
  const c2 = useMemo(() => [p2], [p2]);
  const c3 = useMemo(() => [p3], [p3]);
  const m1 = useMat('limestone_ashlar', {tint: STONE_TINT});
  const m2 = useMat('limestone_ashlar', {tint: STONE_TINT, clip: c2});
  const m3 = useMat('limestone_ashlar', {tint: STONE_TINT, clip: c3});
  const lug = useMat('stone_face_lime', {tint: STONE_TINT, clip: c2});
  const slabM = useMat('stone_face_lime', {tint: '#e6d2ab', clip: c3});
  const waterM = useMemo(() => new THREE.MeshStandardMaterial({color: '#4fb4e0', roughness: 0.1, emissive: new THREE.Color('#2a8fd0'), emissiveIntensity: 0.6, clippingPlanes: c3}), [c3]);
  const g1 = useMemo(() => arcadeGeo(T1), []);
  const g2 = useMemo(() => arcadeGeo(T2), []);
  const g3 = useMemo(() => arcadeGeo(T3), []);
  const wallG = useMemo(() => uvBox(T3.L, 1.9, 0.9, 5), []);
  const lugs = useMemo(() => [...lugPositions(T1), ...lugPositions(T2)], []);
  const slabs = useMemo(() => {
    const out: number[] = [];
    for (let x = T3.x0 + 0.6; x < T3.x0 + T3.L - 0.6; x += 1.15) out.push(x);
    return out;
  }, []);
  const cx = T3.x0 + T3.L / 2;
  const slabGeo = useMemo(() => uvBox(1.1, 0.32, 3.0, 1.5), []);
  const slabRef = React.useRef<THREE.InstancedMesh>(null);
  const visibleSlabs = slabs.filter((x) => Math.abs(x - cx) > coverGap);
  React.useLayoutEffect(() => {
    const o = new THREE.Object3D();
    visibleSlabs.forEach((x, i) => {
      o.position.set(x, CH_Y + 2.06, 0);
      o.updateMatrix();
      slabRef.current!.setMatrixAt(i, o.matrix);
    });
    slabRef.current!.count = visibleSlabs.length;
    slabRef.current!.instanceMatrix.needsUpdate = true;
  });
  const wl = T3.L * waterT;
  return (
    <group>
      <mesh geometry={g1} material={m1} castShadow receiveShadow />
      <mesh geometry={g2} material={m2} castShadow receiveShadow />
      <mesh geometry={g3} material={m3} castShadow receiveShadow />
      <Lugs pos={lugs} mat={lug} />
      {[-1, 1].map((sd) => (
        <mesh key={sd} geometry={wallG} position={[cx, CH_Y + 0.95, sd * 1.05]} material={m3} castShadow receiveShadow />
      ))}
      {waterT > 0 && (
        <mesh position={[T3.x0 + wl / 2, CH_Y + 0.45, 0]} material={waterM}>
          <boxGeometry args={[wl, 0.7, 1.18]} />
        </mesh>
      )}
      <instancedMesh ref={slabRef} args={[slabGeo, slabM, slabs.length]} castShadow receiveShadow />
    </group>
  );
};

const valleyTrees = (() => {
  const out: {kind: number; pos: [number, number, number]; s: number; seed: number}[] = [];
  let i = 0;
  while (out.length < 46 && i < 2000) {
    i++;
    const x = (rnd(i * 3.1) - 0.5) * 560;
    const z = (rnd(i * 7.3) - 0.5) * 560;
    if (Math.abs(z) < 16 && Math.abs(x) < 165) continue;
    if (Math.abs(x - RIVER_X) < 19 && Math.abs(z) < 300) continue;
    const y = valleyH(x, z);
    const kind = y < 8 ? (rnd(i) < 0.5 ? 0 : 1) : rnd(i) < 0.55 ? 2 : 3;
    out.push({kind, pos: [x, y - 0.2, z], s: 1.1 + rnd(i * 11) * 0.9, seed: i});
  }
  return out;
})();

const Valley: React.FC<{f: number}> = ({f}) => (
  <group>
    <Terrain height={valleyH} size={1100} seg={260} tex="grass" texScale={7} />
    <Water w={34} d={1100} position={[RIVER_X, -0.7, 0]} time={f / 30} texScale={8} />
    {valleyTrees.map((t, i) =>
      t.kind === 0 ? <Tree key={i} position={t.pos} scale={t.s} seed={t.seed} leaf="#5a7a35" /> :
      t.kind === 1 ? <Cypress key={i} position={t.pos} scale={t.s} seed={t.seed} /> :
      t.kind === 2 ? <Pine key={i} position={t.pos} scale={t.s * 1.1} seed={t.seed} /> :
      <Bush key={i} position={t.pos} scale={t.s * 1.6} seed={t.seed} color="#557034" />,
    )}
    {[0, 1, 2, 3, 4, 5].map((i) => {
      const x = RIVER_X + (i % 2 ? 19 : -20) + rnd(i) * 4;
      const z = 30 + i * 18;
      return <Rock key={i} position={[x, valleyH(x, z), z]} scale={[2.2, 1.2, 1.8]} seed={i + 4} tex="stone_face_lime" />;
    })}
  </group>
);

/** Shared sky/sun/fog for the valley shots. */
const Atmos: React.FC<{f: number; golden?: number}> = ({f, golden = 0}) => {
  const sunDir: [number, number, number] = [-0.55 - 0.3 * golden, 0.95 - 0.55 * golden, 0.45];
  const sunCol = new THREE.Color('#fff1dc').lerp(new THREE.Color('#ffc27a'), golden).getStyle();
  const hor = new THREE.Color('#b7d2ec').lerp(new THREE.Color('#f2d2a8'), golden).getStyle();
  return (
    <>
      <Renderer exposure={1.0 + 0.1 * golden} envIntensity={0.55} />
      <SkyDome top={golden ? '#3c6db8' : '#1f5bb5'} horizon={hor} sunDir={sunDir} sunColor={sunCol} clouds={0.45} time={f / 30} />
      <Sun dir={sunDir} intensity={3.1} color={sunCol} shadowSize={170} shadowRes={4096} target={[0, 18, 0]} skyColor="#bcd8f5" groundColor="#8b8a5a" />
      <fog attach="fog" args={[hor, 260, 1000]} />
    </>
  );
};

// ============================================================ shared stage
const Stage: React.FC<{cam: Cam; children: React.ReactNode; bg?: string}> = ({cam, children, bg = '#b7d2ec'}) => {
  const {width, height} = useVideoConfig();
  return (
    <AbsoluteFill style={{background: bg}}>
      <ThreeCanvas width={width} height={height} shadows camera={{fov: cam.fov, near: 0.3, far: 3000}}>
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
const Pin: React.FC<{p: [number, number, number]; cam: Cam; text: string; delay: number; dx?: number; dy?: number; size?: number; anchor?: 'left' | 'right' | 'center'}> = ({p, cam, text, delay, dx = 0, dy = 0, size = 50, anchor = 'center'}) => {
  const [x, y, vis] = toScreen(p, cam);
  if (!vis) return null;
  const w = text.length * size * 0.56 + size * 0.9;
  let lx = x + dx;
  const left = anchor === 'left' ? lx : anchor === 'right' ? lx - w : lx - w / 2;
  if (left < 36) lx += 36 - left;
  if (left + w > 1044) lx -= left + w - 1044;
  return <Tag text={text} x={lx} y={Math.min(1500, Math.max(420, y + dy))} delay={delay} size={size} anchor={anchor} />;
};

// ============================================================ S1 hook
const S1: React.FC = () => {
  const f = useCurrentFrame();
  const cam = groundSafe(camPath(f, [
    {t: 0, pos: [RIVER_X - 30, 3, 62], target: [RIVER_X, 30, 0], fov: 52},
    {t: LEN[0], pos: [RIVER_X - 95, 26, 185], target: [0, 24, 0], fov: 42},
  ]), valleyH);
  return (
    <>
      <Stage cam={cam}>
        <Atmos f={f} />
        <Valley f={f} />
        <Bridge time={f / 30} />
        <Person {...walkAlong([RIVER_X - 22, 0, 30], -0.4, f, 1.3, valleyH)} seed={11} head="cloth" />
        <Person {...walkAlong([RIVER_X - 24.5, 0, 32.5], -0.4, f + 9, 1.3, valleyH)} seed={12} />
      </Stage>
      <Headline top="PONT DU GARD, FRANCE" big="49 M TALL" sub="...built to carry a river" delay={4} y={150} bigSize={150} />
    </>
  );
};

// ============================================================ S2 survey (map + chorobates)
const mapH = (x: number, z: number) =>
  12 * Math.sin(x / 140) * Math.cos(z / 160) + 7 * Math.sin((x + z) / 70) + 4 * vnoise(x * 2, z * 2) + 26 * smooth(-200, -420, x) * smooth(-600, -200, -z);
const ROUTE = [
  [-420, -260], [-330, -180], [-300, -60], [-200, 10], [-120, -40], [-40, 30], [40, 120], [140, 90], [220, 170], [320, 230],
] as const;
const routeCurve = new THREE.CatmullRomCurve3(ROUTE.map(([x, z]) => new THREE.Vector3(x, mapH(x, z) + 3, z)));

const RouteTube: React.FC<{t: number}> = ({t}) => {
  const geo = useMemo(() => new THREE.TubeGeometry(routeCurve, 400, 8, 8, false), []);
  const m = usePlainMat('#38b6ff', 0.3, 0, {emissive: new THREE.Color('#1a8fe0'), emissiveIntensity: 0.9});
  const idx = geo.index!.count;
  geo.setDrawRange(0, Math.floor((idx * t) / 6) * 6);
  return <mesh geometry={geo} material={m} />;
};

const Town: React.FC = () => (
  <group position={[330, 0, 240]}>
    {Array.from({length: 16}, (_, i) => {
      const x = (i % 4) * 30 - 45 + rnd(i) * 8;
      const z = Math.floor(i / 4) * 28 - 42 + rnd(i + 3) * 8;
      return <House key={i} position={[x, mapH(330 + x, 240 + z) - 0.5, z]} size={[20, 10, 16]} rotY={rnd(i * 5) * 0.5} wall={i % 3 ? 'plaster_ochre' : 'plaster_ochre'} />;
    })}
  </group>
);

const Chorobates: React.FC<{position: [number, number, number]; rotY?: number}> = ({position, rotY = 0}) => {
  const water = usePlainMat('#53b5e8', 0.1, 0, {emissive: new THREE.Color('#1f7fbf'), emissiveIntensity: 0.4});
  const bob = usePlainMat('#3a3a3a', 0.4, 0.6);
  return (
    <group position={position} rotation={[0, rotY, 0]}>
      <Plank size={[6, 0.16, 0.42]} position={[0, 1.42, 0]} tex="wood_oak" />
      <mesh position={[0, 1.505, 0]} material={water}>
        <boxGeometry args={[3.4, 0.02, 0.12]} />
      </mesh>
      {[-2.7, 2.7].map((x) => (
        <React.Fragment key={x}>
          <Beam a={[x, 0, -0.15]} b={[x, 1.35, -0.15]} r={0.06} square tex="wood_oak" />
          <Beam a={[x, 0, 0.15]} b={[x, 1.35, 0.15]} r={0.06} square tex="wood_oak" />
          <Beam a={[x * 0.55, 1.35, 0.22]} b={[x, 0.5, 0.22]} r={0.04} square tex="wood_oak" />
          <Rope a={[x * 0.7, 1.35, 0.25]} b={[x * 0.7, 0.75, 0.25]} sag={0} r={0.008} color="#222" />
          <mesh position={[x * 0.7, 0.72, 0.25]} material={bob}>
            <coneGeometry args={[0.05, 0.12, 8]} />
          </mesh>
        </React.Fragment>
      ))}
    </group>
  );
};

const S2: React.FC = () => {
  const f = useCurrentFrame();
  const cut = Math.round(LEN[1] * 0.56);
  const mapCam = groundSafe(camPath(f, [
    {t: 0, pos: [520, 1150, 0], target: [-40, 0, -10], fov: 52},
    {t: cut, pos: [560, 1080, 10], target: [-30, 0, -5], fov: 52},
  ]), mapH, 20);
  const pathT = ramp(f, 12, cut - 18);
  const g = f - cut;
  const chCam = camPath(g, [
    {t: 0, pos: [3.5, 3.6, 11.5], target: [0, 1.0, 0], fov: 50},
    {t: LEN[1] - cut, pos: [2.6, 3.0, 9.5], target: [0, 1.1, 0], fov: 50},
  ]);
  const p0 = routeCurve.getPoint(0).toArray() as [number, number, number];
  const p1 = routeCurve.getPoint(1).toArray() as [number, number, number];
  const pm = routeCurve.getPoint(0.5).toArray() as [number, number, number];
  return (
    <>
      <Sequence durationInFrames={cut} layout="none">
        <Stage cam={mapCam}>
          <Renderer envIntensity={0.55} />
          <SkyDome clouds={0.4} time={f / 30} />
          <Sun dir={[-0.5, 1, 0.4]} shadowSize={600} shadowRes={2048} />
          <fog attach="fog" args={['#b7d2ec', 1700, 3200]} />
          <Terrain height={mapH} size={1600} seg={180} tex="grass" texScale={12} />
          <RouteTube t={pathT} />
          <Water w={44} d={44} position={[p0[0], p0[1] - 2.5, p0[2]]} time={f / 30} texScale={6} />
          <Town />
          {Array.from({length: 90}, (_, i) => {
            const x = (rnd(i * 2.3) - 0.5) * 1300, z = (rnd(i * 4.1) - 0.5) * 1300;
            if (Math.hypot(x - 330, z - 240) < 90) return null;
            return i % 3 ? <Pine key={i} position={[x, mapH(x, z), z]} scale={4.5} seed={i} /> : <Tree key={i} position={[x, mapH(x, z), z]} scale={4} seed={i} />;
          })}
          {[0, 1, 2, 3].map((i) => <Rock key={i} position={[p0[0] + Math.cos(i * 1.7) * 22, p0[1] - 2, p0[2] + Math.sin(i * 1.7) * 22]} scale={[7, 4, 6]} seed={i + 90} tex="stone_face_grey" />)}
        </Stage>
        <Pin p={p0} cam={mapCam} text="SPRING" delay={10} dy={-70} />
        <Pin p={p1} cam={mapCam} text="NÎMES" delay={Math.round(cut * 0.75)} dy={-80} />
        <Pin p={pm} cam={mapCam} text="50 KM" delay={Math.round(cut * 0.45)} dy={-70} size={60} />
        <Caption text="Only 17 m of drop in 50 km" delay={Math.round(cut * 0.55)} bottom={330} />
      </Sequence>
      <Sequence from={cut} layout="none">
        <SceneFade dur={LEN[1] - cut} inF={6} outF={0}>
          <Stage cam={chCam}>
            <Renderer envIntensity={0.6} />
            <SkyDome clouds={0.4} time={f / 30} />
            <Sun dir={[-0.6, 0.9, 0.6]} shadowSize={12} />
            <fog attach="fog" args={['#b7d2ec', 40, 220]} />
            <Terrain height={(x, z) => 0.3 * Math.sin(x / 9) * Math.cos(z / 11)} size={400} seg={120} tex="grass" texScale={4} />
            <Chorobates position={[0, 0.1, 0]} rotY={1.05} />
            <Person position={[1.6, 0.05, 3.4]} rotY={2.0} pose="point" seed={21} head="cloth" />
            <Person position={[-2.2, 0.05, -4.6]} rotY={-1.0} pose="stand" seed={22} />
            <Beam a={[-1.8, 0, -4.4]} b={[-1.8, 2.6, -4.4]} r={0.04} square tex="wood_pine" />
            {[0, 1, 2, 3].map((i) => (
              <Pine key={i} position={[-12 + i * 9, 0, -22 - (i % 2) * 6]} scale={1.1} seed={i + 40} />
            ))}
            <Tree position={[14, 0, -12]} scale={1.2} seed={44} />
          </Stage>
          <Pin p={[0, 1.6, 0]} cam={chCam} text="CHOROBATES" delay={8} dy={-120} size={54} />
          <Caption text="A 6-metre water level for checking slopes" delay={18} bottom={330} />
        </SceneFade>
      </Sequence>
    </>
  );
};

// ============================================================ S3 channel construction (cutaway)
const ChannelSeg: React.FC<{f: number; L: number}> = ({f, L}) => {
  const floorT = ramp(f, 6, 40);
  const wallT = ramp(f, 40, 95);
  const liningT = ramp(f, 100, 135);
  const waterT = ramp(f, 135, 190);
  const nSlabs = 9;
  const slabStart = 175;
  const floorM = useMat('concrete', {repeat: [1, 1]});
  const wallM = useMat('limestone_ashlar', {tint: STONE_TINT});
  const linM = useMat('plaster_ochre', {tint: '#e7a58c'});
  const slabM = useMat('stone_face_lime', {tint: '#ead6b0'});
  const waterM = usePlainMat('#3d9ec7', 0.08, 0.1, {transparent: true, opacity: 0.85, emissive: new THREE.Color('#145f86'), emissiveIntensity: 0.3});
  const floorG = useMemo(() => uvBox(2.6, 0.4, L, 2), [L]);
  const wallG = useMemo(() => uvBox(0.65, 1.8, L, 2.2), [L]);
  const linG = useMemo(() => uvBox(0.06, 1.75, L, 1.5), [L]);
  const linFloorG = useMemo(() => uvBox(1.18, 0.05, L, 1.5), [L]);
  const slabG = useMemo(() => uvBox(2.7, 0.3, L / nSlabs - 0.05, 1.5), [L]);
  return (
    <group>
      <mesh geometry={floorG} position={[0, -0.2 - (1 - floorT) * 0.6, 0]} scale={[1, Math.max(0.01, floorT), 1]} material={floorM} castShadow receiveShadow />
      {[-1, 1].map((s) => (
        <mesh key={s} geometry={wallG} position={[s * 0.975, 0.9 * wallT, 0]} scale={[1, Math.max(0.01, wallT), 1]} material={wallM} castShadow receiveShadow />
      ))}
      {liningT > 0 && (
        <>
          {[-1, 1].map((s) => (
            <mesh key={s} geometry={linG} position={[s * 0.615, 0.875 * liningT, 0]} scale={[1, Math.max(0.01, liningT), 1]} material={linM} receiveShadow />
          ))}
          <mesh geometry={linFloorG} position={[0, 0.025, 0]} scale={[liningT, 1, 1]} material={linM} receiveShadow />
        </>
      )}
      {waterT > 0 && (
        <mesh position={[0, 0.06 + 0.32 * waterT, -L / 2 + (L * waterT) / 2]} material={waterM}>
          <boxGeometry args={[1.16, 0.64 * waterT, L * waterT]} />
        </mesh>
      )}
      {Array.from({length: nSlabs}, (_, i) => {
        const t0 = slabStart + (nSlabs - 1 - i) * 9;
        const k = ramp(f, t0, t0 + 14, Easing.out(Easing.quad));
        if (k <= 0) return null;
        const z = -L / 2 + (i + 0.5) * (L / nSlabs);
        return <mesh key={i} geometry={slabG} position={[0, 1.95 + (1 - k) * 2.5, z]} material={slabM} castShadow receiveShadow />;
      })}
    </group>
  );
};

const EarthBank: React.FC<{x0: number; x1: number; zFront: number; h: number}> = ({x0, x1, zFront, h}) => {
  const dirt = useMat('dirt');
  const grass = useMat('grass');
  const w = x1 - x0, d = 80;
  const g = useMemo(() => uvBox(w, h, d, 3), [w, h]);
  const top = useMemo(() => uvBox(w, 0.08, d, 4), [w]);
  return (
    <group position={[(x0 + x1) / 2, 0, zFront - d / 2]}>
      <mesh geometry={g} position={[0, h / 2 - 0.4, 0]} material={dirt} castShadow receiveShadow />
      <mesh geometry={top} position={[0, h - 0.36, 0]} material={grass} receiveShadow />
    </group>
  );
};

const S3: React.FC = () => {
  const f = useCurrentFrame();
  const L = 9;
  const cam = groundSafe(camPath(f, [
    {t: 0, pos: [2.2, 3.6, 12.5], target: [0, 0.8, 1.5], fov: 46},
    {t: LEN[2], pos: [1.4, 4.4, 11.0], target: [0, 0.9, 0.5], fov: 46},
  ]), valleyH);
  const zF = L / 2;
  return (
    <>
      <Stage cam={cam}>
        <Renderer envIntensity={0.6} />
        <SkyDome clouds={0.4} time={f / 30} />
        <Sun dir={[-0.55, 0.95, 0.6]} shadowSize={16} target={[0, 0, 0]} />
        <fog attach="fog" args={['#b7d2ec', 60, 260]} />
        <Terrain height={() => -0.4} size={300} seg={2} tex="dirt" texScale={4} />
        <EarthBank x0={1.32} x1={40} zFront={zF} h={2.6} />
        <EarthBank x0={-40} x1={-1.32} zFront={zF} h={2.6} />
        <ChannelSeg f={f} L={L} />
        <Person position={[2.4, 2.2, -2.5]} rotY={Math.PI} pose="hammer" t={f * 0.2} seed={31} head="cloth" />
        <Person position={[-2.6, 2.2, -4.5]} rotY={0.2} pose="carry" t={f * 0.22} seed={32} />
        <Person position={[-2.3, 2.2, 0.8]} rotY={-0.4} pose="stand" seed={33} />
        <Dust at={[1.7, 2.2, -2.5]} f={f} />
        {[0, 1, 2].map((i) => (
          <Cypress key={i} position={[-14 + i * 13, 2.2, -26 - i * 4]} scale={1.2} seed={i + 60} />
        ))}
        <Tree position={[12, 2.2, -14]} scale={1.1} seed={66} />
      </Stage>
      <StepBadge n={1} title="BUILD THE CHANNEL" delay={3} />
      <Pin p={[0, -0.2, zF]} cam={cam} text="CONCRETE FLOOR" delay={20} dy={40} size={46} />
      <Pin p={[-1.0, 1.4, zF]} cam={cam} text="STONE WALLS" delay={60} dx={-30} size={46} anchor="right" />
      <Pin p={[0.62, 1.1, zF]} cam={cam} text="WATERPROOF LINING" delay={112} dx={60} dy={-40} size={46} anchor="left" />
      <Pin p={[0, 2.1, -1]} cam={cam} text="COVER SLABS" delay={182} dy={-90} size={46} />
      <Caption text="Lining: lime + crushed pottery" delay={118} bottom={170} />
    </>
  );
};

// ============================================================ S4–S6 construction site (arch over the bank)
const SITE_ARCH = 1; // tier-1 arch index used for the close-up
const SITE = (() => {
  const c = T1.centers[SITE_ARCH];
  const span = T1.spans[SITE_ARCH];
  const r = span / 2;
  const spring = T1.base + T1.H - T1.crown - r;
  return {c, span, r, spring, ring: T1.crown + 0.0};
})();

const Pier: React.FC<{x: number; h: number}> = ({x, h}) => {
  const m = useMat('limestone_ashlar', {tint: STONE_TINT});
  const g = useMemo(() => uvBox(T1.pier, 1, T1.thick, 5), []);
  const yb = T1.base;
  return <mesh geometry={g} position={[x, yb + h / 2, 0]} scale={[1, Math.max(0.01, h), 1]} material={m} castShadow receiveShadow />;
};

/** Wooden centering: two semicircular ribs + posts + lagging. `n` = how many members are visible (0..1). */
const Centering: React.FC<{n: number; drop?: number; opacity?: number}> = ({n, drop = 0, opacity = 1}) => {
  const {c, r, spring} = SITE;
  const members = useMemo(() => {
    const out: {a: [number, number, number]; b: [number, number, number]; r: number}[] = [];
    const ribR = r - 0.15;
    const segs = 10;
    for (const z of [-T1.thick / 2 + 0.6, 0, T1.thick / 2 - 0.6]) {
      for (let i = 0; i < segs; i++) {
        const a0 = Math.PI - (i / segs) * Math.PI, a1 = Math.PI - ((i + 1) / segs) * Math.PI;
        out.push({a: [c + Math.cos(a0) * ribR, spring + Math.sin(a0) * ribR, z], b: [c + Math.cos(a1) * ribR, spring + Math.sin(a1) * ribR, z], r: 0.16});
      }
      for (const k of [-0.75, -0.35, 0, 0.35, 0.75]) {
        const x = c + k * ribR;
        const top = spring + Math.sqrt(Math.max(0, ribR * ribR - (k * ribR) ** 2));
        out.push({a: [x, 1.4, z], b: [x, top, z], r: 0.13});
      }
      out.push({a: [c - ribR, spring, z], b: [c + ribR, spring, z], r: 0.13});
      out.push({a: [c - ribR * 0.75, spring, z], b: [c, spring + ribR, z], r: 0.1});
      out.push({a: [c + ribR * 0.75, spring, z], b: [c, spring + ribR, z], r: 0.1});
    }
    return out;
  }, [c, r, spring]);
  const lag = useMemo(() => Array.from({length: 26}, (_, i) => Math.PI - ((i + 0.5) / 26) * Math.PI), []);
  const k = Math.floor(n * (members.length + lag.length));
  return (
    <group position={[0, -drop, 0]}>
      <OpacityGroup opacity={opacity}>
        {members.slice(0, k).map((m, i) => (
          <Beam key={i} a={m.a} b={m.b} r={m.r} square tex="wood_pine" />
        ))}
        {lag.slice(0, Math.max(0, k - members.length)).map((a, i) => (
          <Plank key={i} size={[0.5, 0.08, T1.thick + 0.2]} position={[c + Math.cos(a) * (r - 0.02), spring + Math.sin(a) * (r - 0.02), 0]} rotation={[0, 0, a - Math.PI / 2]} tex="wood_pine" />
        ))}
      </OpacityGroup>
    </group>
  );
};

/** Applies opacity to all child materials by traversing (cheap fade-out). */
const OpacityGroup: React.FC<{opacity: number; children: React.ReactNode}> = ({opacity, children}) => {
  const ref = React.useRef<THREE.Group>(null);
  React.useLayoutEffect(() => {
    ref.current?.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m && 'opacity' in m) {
        m.transparent = opacity < 1;
        m.opacity = opacity;
      }
    });
  });
  return <group ref={ref}>{children}</group>;
};

/** Ring of voussoirs; `placed` = how many (0..N) are in place, `incoming` fraction animates the next pair. */
const VOUSSOIRS = 17;
const Voussoirs: React.FC<{placed: number; keyGlow: number}> = ({placed, keyGlow}) => {
  const {c, r, spring} = SITE;
  const m = useMat('stone_face_lime', {tint: STONE_TINT});
  const km = useMat('stone_face_lime', {tint: '#ffe7a6', emissive: '#c88a10', emissiveIntensity: 0});
  km.emissiveIntensity = keyGlow * 0.55;
  const geos = useMemo(
    () =>
      Array.from({length: VOUSSOIRS}, (_, i) => {
        const gap = 0.012;
        const a0 = Math.PI - (i / VOUSSOIRS) * Math.PI - gap, a1 = Math.PI - ((i + 1) / VOUSSOIRS) * Math.PI + gap;
        const R0 = r, R1 = r + 1.6;
        const s = new THREE.Shape();
        s.moveTo(Math.cos(a0) * R0, Math.sin(a0) * R0);
        s.lineTo(Math.cos(a0) * R1, Math.sin(a0) * R1);
        s.absarc(0, 0, R1, a0, a1, true);
        s.lineTo(Math.cos(a1) * R0, Math.sin(a1) * R0);
        s.absarc(0, 0, R0, a1, a0, false);
        const g = new THREE.ExtrudeGeometry(s, {depth: T1.thick, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 1, curveSegments: 6});
        g.translate(0, 0, -T1.thick / 2);
        return worldUV(g, 2.2);
      }),
    [r],
  );
  // placement order: from both springlines toward the crown, keystone last
  const order: number[] = [];
  for (let i = 0; i < 8; i++) order.push(i, VOUSSOIRS - 1 - i);
  order.push(8);
  return (
    <group position={[c, spring, 0]}>
      {order.map((idx, k) => {
        const local = placed - k; // >1 placed, 0..1 arriving
        if (local <= 0) return null;
        const t = Math.min(1, local);
        const am = Math.PI - ((idx + 0.5) / VOUSSOIRS) * Math.PI;
        const off = (1 - Easing.out(Easing.cubic)(t)) * 3.5;
        return <mesh key={idx} geometry={geos[idx]} position={[Math.cos(am) * off * 0.3, off, 0]} material={idx === 8 ? km : m} castShadow receiveShadow />;
      })}
    </group>
  );
};

/** Roman treadwheel crane. Base at `pos`, jib leaning toward -z. */
const Crane: React.FC<{pos: [number, number, number]; wheelA: number; hookY: number; load: boolean; f: number}> = ({pos, wheelA, hookY, load, f}) => {
  const [bx, by, bz] = pos;
  const apex: [number, number, number] = [bx, by + 25, bz - 8.5];
  const wheelC: [number, number, number] = [bx, by + 2.6, bz + 3.4];
  const R = 2.4;
  const rim = useMat('wood_oak', {repeat: [6, 0.2]});
  const block = useMat('stone_face_lime', {tint: STONE_TINT});
  const blockG = useMemo(() => uvBox(1.7, 0.9, 1.2, 1.5), []);
  return (
    <group>
      {/* A-frame jib */}
      <Beam a={[bx - 1.4, by, bz]} b={apex} r={0.22} square tex="wood_oak" />
      <Beam a={[bx + 1.4, by, bz]} b={apex} r={0.22} square tex="wood_oak" />
      <Beam a={[bx - 1.0, by + 8, bz - 2.7]} b={[bx + 1.0, by + 8, bz - 2.7]} r={0.12} square tex="wood_oak" />
      <Beam a={[bx - 0.6, by + 16, bz - 5.4]} b={[bx + 0.6, by + 16, bz - 5.4]} r={0.1} square tex="wood_oak" />
      {/* back stays */}
      <Rope a={apex} b={[bx - 3, by, bz + 14]} sag={0.01} r={0.04} />
      <Rope a={apex} b={[bx + 3, by, bz + 14]} sag={0.01} r={0.04} />
      {/* wheel frame */}
      <Beam a={[bx - 1.6, by, wheelC[2]]} b={[bx - 1.6, wheelC[1], wheelC[2]]} r={0.15} square tex="wood_oak" />
      <Beam a={[bx + 1.6, by, wheelC[2]]} b={[bx + 1.6, wheelC[1], wheelC[2]]} r={0.15} square tex="wood_oak" />
      <Beam a={[bx - 1.7, wheelC[1], wheelC[2]]} b={[bx + 1.7, wheelC[1], wheelC[2]]} r={0.12} tex="wood_oak" />
      <group position={wheelC} rotation={[wheelA, 0, 0]}>
        {[-1.1, 1.1].map((x) => (
          <mesh key={x} position={[x, 0, 0]} rotation={[0, Math.PI / 2, 0]} material={rim} castShadow>
            <torusGeometry args={[R, 0.12, 8, 40]} />
          </mesh>
        ))}
        {Array.from({length: 8}, (_, i) => {
          const a = (i / 8) * Math.PI * 2;
          return (
            <React.Fragment key={i}>
              <Beam a={[-1.1, 0, 0]} b={[-1.1, Math.sin(a) * R, Math.cos(a) * R]} r={0.06} square tex="wood_oak" />
              <Beam a={[1.1, 0, 0]} b={[1.1, Math.sin(a) * R, Math.cos(a) * R]} r={0.06} square tex="wood_oak" />
            </React.Fragment>
          );
        })}
        {Array.from({length: 28}, (_, i) => {
          const a = (i / 28) * Math.PI * 2;
          return <Plank key={i} size={[2.3, 0.06, 0.4]} position={[0, Math.sin(a) * (R - 0.1), Math.cos(a) * (R - 0.1)]} rotation={[-a, 0, 0]} tex="wood_oak" />;
        })}
      </group>
      {/* walkers inside the wheel */}
      <Person position={[bx - 0.45, wheelC[1] - R + 0.12, wheelC[2]]} rotY={Math.PI / 2} pose="walk" legs="walk" t={f * 0.24} seed={41} />
      <Person position={[bx + 0.45, wheelC[1] - R + 0.12, wheelC[2] + 0.2]} rotY={Math.PI / 2} pose="walk" legs="walk" t={f * 0.24 + 1.6} seed={42} head="cloth" />
      {/* rope: wheel axle -> apex -> hook */}
      <Rope a={wheelC} b={apex} sag={0.0} r={0.04} />
      <Rope a={apex} b={[apex[0], hookY + 1.0, apex[2]]} sag={0} r={0.04} />
      {load && (
        <group position={[apex[0], hookY, apex[2]]}>
          <Rope a={[0, 1.0, 0]} b={[-0.6, 0.45, 0]} sag={0} r={0.03} />
          <Rope a={[0, 1.0, 0]} b={[0.6, 0.45, 0]} sag={0} r={0.03} />
          <mesh geometry={blockG} material={block} castShadow />
        </group>
      )}
    </group>
  );
};

const SiteWorld: React.FC<{f: number; pierT: number; centN: number; ringPlaced: number; keyGlow: number; centDrop: number; centOp: number; crane: {wheelA: number; hookY: number; load: boolean} | null; showCentering: boolean}> = ({
  f, pierT, centN, ringPlaced, keyGlow, centDrop, centOp, crane, showCentering,
}) => {
  const {c, span} = SITE;
  const pierTop = SITE.spring - T1.base;
  const xl = c - span / 2 - T1.pier / 2;
  const xr = c + span / 2 + T1.pier / 2;
  return (
    <group>
      <Atmos f={f} />
      <Valley f={f} />
      <Pier x={xl} h={pierTop * pierT} />
      <Pier x={xr} h={pierTop * pierT} />
      {showCentering && <Centering n={centN} drop={centDrop} opacity={centOp} />}
      <Voussoirs placed={ringPlaced} keyGlow={keyGlow} />
      <ScaffoldBay position={[xl - T1.pier / 2 - 1.6, valleyH(xl - 4, 0), -T1.thick / 2]} w={1.4} d={T1.thick} h={Math.max(2, pierTop * pierT)} levels={4} />
      <ScaffoldBay position={[xr + T1.pier / 2 + 0.2, valleyH(xr + 4, 0), -T1.thick / 2]} w={1.4} d={T1.thick} h={Math.max(2, pierTop * pierT)} levels={4} />
      {crane && <Crane pos={[xl + T1.pier / 2 + 1.8, valleyH(xl, 9), 9]} wheelA={crane.wheelA} hookY={crane.hookY} load={crane.load} f={f} />}
      {/* stone yard */}
      {Array.from({length: 7}, (_, i) => (
        <Rock key={i} position={[c + 6 + i * 1.9, 1.9, 12 + (i % 2) * 1.5]} scale={[0.9, 0.45, 0.6]} seed={i + 80} tex="stone_face_lime" />
      ))}
      <Person position={[c + 5, 1.6, 8]} rotY={2.4} pose="chisel" t={f * 0.2} seed={51} head="cloth" />
      <Person position={[c + 9, 1.6, 9.5]} rotY={-2.2} pose="hammer" t={f * 0.18 + 1} seed={52} />
      <Person position={[c - 3, 1.6, 7]} rotY={-1.2} pose="point" seed={53} head="hat" headColor="#7a5a3a" />
      <Dust at={[c + 5.6, 1.7, 7.6]} f={f} />
    </group>
  );
};

const S4: React.FC = () => {
  const f = useCurrentFrame();
  const {c, spring} = SITE;
  const cam = groundSafe(camPath(f, [
    {t: 0, pos: [c + 14, 8, 52], target: [c, 9, 0], fov: 62},
    {t: LEN[3], pos: [c + 6, 10, 48], target: [c, 11, 0], fov: 62},
  ]), valleyH);
  const pierT = ramp(f, 0, LEN[3] * 0.45);
  const centN = ramp(f, LEN[3] * 0.4, LEN[3] - 8, Easing.linear);
  return (
    <>
      <Stage cam={cam}>
        <SiteWorld f={f} pierT={pierT} centN={centN} ringPlaced={0} keyGlow={0} centDrop={0} centOp={1} crane={null} showCentering />
      </Stage>
      <StepBadge n={2} title="PIERS + CENTERING" delay={3} />
      <Pin p={[c - SITE.span / 2 - T1.pier / 2, spring * 0.6, T1.thick / 2]} cam={cam} text="STONE PIER" delay={18} size={48} dy={-30} />
      <Pin p={[c, spring + SITE.r * 0.6, T1.thick / 2]} cam={cam} text="WOODEN CENTERING" delay={Math.round(LEN[3] * 0.62)} dy={-120} size={48} />
    </>
  );
};

const S5: React.FC = () => {
  const f = useCurrentFrame();
  const {c, spring} = SITE;
  const lift = ramp(f, 10, LEN[4] - 20, Easing.inOut(Easing.sin));
  const hookY = 2.4 + lift * (spring + 6.6 - 2.4);
  const cam = groundSafe(camPath(f, [
    {t: 0, pos: [c + 12, 6, 34], target: [c - 6, 5, 8], fov: 58},
    {t: LEN[4] * 0.45, pos: [c + 10, 9, 38], target: [c - 5, 9, 5], fov: 58},
    {t: LEN[4], pos: [c + 6, 13, 42], target: [c - 3, 13, 2], fov: 58},
  ]), valleyH);
  const placed = ramp(f, LEN[4] * 0.55, LEN[4], Easing.linear) * 2;
  return (
    <>
      <Stage cam={cam}>
        <SiteWorld f={f} pierT={1} centN={1} ringPlaced={placed} keyGlow={0} centDrop={0} centOp={1} crane={{wheelA: -f * 0.05, hookY, load: true}} showCentering />
      </Stage>
      <StepBadge n={3} title="LIFT THE STONES" delay={3} />
      <Pin p={[c - SITE.span / 2 + 1.8, 3, 11.4]} cam={cam} text="TREADWHEEL" delay={16} dy={-40} size={50} />
      <Pin p={[c - SITE.span / 2 + 1.8, hookY, 0.5]} cam={cam} text="UP TO 6 TONNES" delay={Math.round(LEN[4] * 0.4)} dx={150} size={46} anchor="left" />
    </>
  );
};

const S6: React.FC = () => {
  const f = useCurrentFrame();
  const {c, spring, r} = SITE;
  const placed = 2 + ramp(f, 0, LEN[5] * 0.48, Easing.linear) * 15;
  const keyGlow = ramp(f, LEN[5] * 0.45, LEN[5] * 0.55) * (1 - ramp(f, LEN[5] * 0.8, LEN[5]));
  const centDrop = ramp(f, LEN[5] * 0.7, LEN[5] - 6) * 1.2;
  const centOp = 1 - ramp(f, LEN[5] * 0.78, LEN[5] - 4);
  const cam = groundSafe(camPath(f, [
    {t: 0, pos: [c + 4, spring - 1, 46], target: [c, spring + 1.5, 0], fov: 60},
    {t: LEN[5], pos: [c - 2, spring - 1.5, 40], target: [c, spring + 2, 0], fov: 60},
  ]), valleyH);
  return (
    <>
      <Stage cam={cam}>
        <SiteWorld f={f} pierT={1} centN={1} ringPlaced={placed} keyGlow={keyGlow} centDrop={centDrop} centOp={centOp} crane={null} showCentering={centOp > 0.01} />
      </Stage>
      <Pin p={[c, spring + r + 1.6, T1.thick / 2]} cam={cam} text="KEYSTONE" delay={Math.round(LEN[5] * 0.46)} dy={-80} size={56} />
      <Tag text="NO MORTAR" x={540} y={1330} anchor="center" delay={Math.round(LEN[5] * 0.6)} size={60} />
      <Caption text="The arch now holds itself up" delay={Math.round(LEN[5] * 0.72)} bottom={330} />
    </>
  );
};

// ============================================================ S7 tiers + channel
const S7: React.FC = () => {
  const f = useCurrentFrame();
  const L = LEN[6];
  const rev2 = 22 + ramp(f, 4, L * 0.3) * 20.5;
  const rev3 = 42 + ramp(f, L * 0.28, L * 0.5) * 8.5;
  const cx = T3.x0 + T3.L / 2;
  const cam = groundSafe(camPath(f, [
    {t: 0, pos: [RIVER_X - 120, 30, 210], target: [0, 26, 0], fov: 42},
    {t: L * 0.5, pos: [RIVER_X - 110, 44, 190], target: [0, 32, 0], fov: 42},
    {t: L * 0.62, pos: [cx + 14, CH_Y + 16, 16], target: [cx - 2, CH_Y + 0.6, 0], fov: 50},
    {t: L, pos: [cx + 6, CH_Y + 11, 6], target: [cx - 3, CH_Y + 0.4, 0], fov: 50},
  ]), valleyH);
  const gap = ramp(f, L * 0.5, L * 0.62) * 16;
  return (
    <>
      <Stage cam={cam}>
        <Atmos f={f} />
        <Valley f={f} />
        <Bridge rev2={rev2} rev3={rev3} coverGap={gap} waterT={ramp(f, L * 0.55, L * 0.95, Easing.linear)} />
      </Stage>
      <Sequence durationInFrames={Math.round(L * 0.56)} layout="none">
        <Pin p={[T1.centers[2], 12, T1.thick / 2]} cam={cam} text="TIER 1" delay={2} size={46} />
        <Pin p={[T2.centers[5], 34, T2.thick / 2]} cam={cam} text="TIER 2" delay={Math.round(L * 0.18)} size={46} />
        <Pin p={[T3.centers[17], 47, T3.thick / 2]} cam={cam} text="TIER 3 + CHANNEL" delay={Math.round(L * 0.38)} size={46} dy={-50} />
      </Sequence>
      <Sequence from={Math.round(L * 0.62)} layout="none">
        <Headline top="ACROSS THE BRIDGE" big="−2.5 CM" sub="about 1 cm every 180 m" delay={0} y={150} bigSize={150} />
      </Sequence>
    </>
  );
};

// ============================================================ S8 payoff
const S8: React.FC = () => {
  const f = useCurrentFrame();
  const L = LEN[7];
  const a = interpolate(f, [0, L], [0.62, 0.9]);
  const R = interpolate(f, [0, L], [260, 300]);
  const cam = groundSafe({pos: [RIVER_X - Math.sin(a) * R, 18 + f * 0.02, Math.cos(a) * R], target: [RIVER_X - 10, 25, 0], fov: 40} as Cam, valleyH, 4);
  return (
    <>
      <Stage cam={cam} bg="#f2d2a8">
        <Atmos f={f} golden={0.75} />
        <Valley f={f} />
        <Bridge />
      </Stage>
      <Headline top="EVERY DAY" big="40,000 M³" sub="of water for the city" delay={4} y={150} bigSize={140} />
      <Caption text="Still standing after ~2,000 years" delay={Math.round(VO.durations[7] * FPS * 0.55)} bottom={330} />
    </>
  );
};

// ============================================================ timeline
const SCENES = [S1, S2, S3, S4, S5, S6, S7, S8];

export const Aqueduct: React.FC = () => (
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
        <Audio src={staticFile(`vo/ep003-aqueduct_${i}.wav`)} />
      </Sequence>
    ))}
    <Watermark />
  </AbsoluteFill>
);

export const AQUEDUCT_START = START;
export const AQUEDUCT_LEN = LEN;
