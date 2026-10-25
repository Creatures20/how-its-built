// Episode 002: How a medieval stone castle was built (curtain wall, towers, spiral stairs)
import React, {useMemo} from 'react';
import {AbsoluteFill, Audio, Easing, interpolate, Sequence, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import VO from './ep002-castle-vo.json';
import {ThreeCanvas} from '@remotion/three';
import * as THREE from 'three';
import {BlockLayer, CameraRig, rand, SunLights, Worker} from '../hib/three';
import {C, Caption, Headline, Leader, SceneFade, Sky, StepBadge, Tag, Watermark} from '../hib/ui';

// ---------- timing: every scene is as long as its narration line ----------
const FPS = 30;
const VO_DELAY = 4;
const sceneLen = (i: number, tail: number) => Math.ceil((VO.durations[i] + tail) * FPS) + VO_DELAY;
const HOOK = sceneLen(0, 0.4);
const WALL = sceneLen(1, 0.45);
const RISE = sceneLen(2, 0.45);
const STAIRS = sceneLen(3, 0.5);
const REVEAL = sceneLen(4, 1.4);

const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
const ease = Easing.bezier(0.45, 0, 0.25, 1);

const FOG = '#DCEBD2';
const STONE_HUE: [number, number] = [30, 42];

// ---------- castle geometry (8 towers, like Conwy's long plan) ----------
const HX = 14; // half length
const HZ = 6; // half width
const CH = 0.5; // course height
const COURSES = 12; // wall height 6
const WALL_H = CH * COURSES;
const TOWER_H = 8.6;
const TOWER_R = 2.1;
const TOWERS: [number, number][] = [-HX, -HX / 3, HX / 3, HX].flatMap((x) => [[x, HZ], [x, -HZ]] as [number, number][]);

type Course = {positions: [number, number, number][]; start: number};
const useCourses = () =>
  useMemo(() => {
    const courses: Course[] = [];
    let start = 0;
    for (let k = 0; k < COURSES; k++) {
      const positions: [number, number, number][] = [];
      const off = k % 2 ? 0.5 : 0;
      for (let x = -HX + 0.5 + off; x < HX; x += 1) {
        positions.push([x, k * CH + CH / 2, HZ]);
        positions.push([x, k * CH + CH / 2, -HZ]);
      }
      for (let z = -HZ + 0.5 + off; z < HZ; z += 1) {
        positions.push([HX, k * CH + CH / 2, z]);
        positions.push([-HX, k * CH + CH / 2, z]);
      }
      courses.push({positions, start});
      start += positions.length;
    }
    return {courses, total: start};
  }, []);

const WALL_BLOCK: [number, number, number] = [0.96, CH * 0.94, 1.3];
const WALL_BLOCK_Z: [number, number, number] = [1.3, CH * 0.94, 0.96];

const Stone: React.FC<{color?: string}> = ({color = '#B8B0A2'}) => <meshStandardMaterial color={color} roughness={0.95} flatShading />;

/** Merlons ring on a tower top. */
const TowerTop: React.FC<{y: number}> = ({y}) => (
  <group position={[0, y, 0]}>
    {Array.from({length: 10}).map((_, i) => {
      const a = (i / 10) * Math.PI * 2;
      return (
        <mesh key={i} position={[Math.cos(a) * (TOWER_R + 0.05), 0.35, Math.sin(a) * (TOWER_R + 0.05)]} rotation={[0, -a, 0]} castShadow>
          <boxGeometry args={[0.5, 0.7, 0.75]} />
          <Stone color="#A9A194" />
        </mesh>
      );
    })}
  </group>
);

/** Spiral scaffold ramp on putlog timbers, climbing with the tower. */
const SpiralScaffold: React.FC<{h: number; t: number}> = ({h, t}) => {
  const pitch = 3.2;
  const n = 56;
  const items = [];
  for (let i = 0; i < n; i++) {
    const a = (i / 14) * Math.PI * 2;
    const y = (a / (Math.PI * 2)) * pitch + 0.4;
    if (y > h - 0.2) break;
    items.push(
      <group key={i} position={[0, y, 0]} rotation={[0, -a, 0]}>
        <mesh position={[TOWER_R + 0.55, 0, 0]} castShadow>
          <boxGeometry args={[1.0, 0.1, 0.9]} />
          <meshStandardMaterial color="#9a6a3c" flatShading />
        </mesh>
        <mesh position={[TOWER_R + 0.2, -0.12, 0]}>
          <boxGeometry args={[1.2, 0.12, 0.12]} />
          <meshStandardMaterial color="#6e4524" />
        </mesh>
      </group>,
    );
  }
  // a worker carrying a stone up the ramp
  const s = t % 1;
  const maxA = (Math.max(0, h - 0.8) / pitch) * Math.PI * 2;
  const wa = s * maxA;
  const wy = (wa / (Math.PI * 2)) * pitch + 0.45;
  return (
    <group>
      {items}
      {h > 1.5 && (
        <group rotation={[0, -wa, 0]}>
          <group position={[TOWER_R + 0.55, wy, 0]}>
            <Worker position={[0, 0, 0]} rotY={-Math.PI / 2} t={t * 60} scale={0.6} />
            <mesh position={[0, 1.15, 0]} castShadow>
              <boxGeometry args={[0.45, 0.3, 0.35]} />
              <Stone color="#CFC6B5" />
            </mesh>
          </group>
        </group>
      )}
    </group>
  );
};

const Castle: React.FC<{progress: number; scaffold?: boolean; t?: number}> = ({progress, scaffold = false, t = 0}) => {
  const {courses, total} = useCourses();
  const placed = progress * total;
  const th = Math.max(0.01, progress * TOWER_H);
  const done = progress >= 0.999;
  return (
    <group>
      {courses.map((c, k) => (
        <React.Fragment key={k}>
          <BlockLayer
            positions={c.positions.filter((p) => Math.abs(p[2]) === HZ)}
            size={WALL_BLOCK}
            count={Math.floor((placed - c.start) * (2 * HX * 2) / c.positions.length)}
            seed={k + 1}
            hue={STONE_HUE}
            sat={0.08}
            light={0.6}
          />
          <BlockLayer
            positions={c.positions.filter((p) => Math.abs(p[2]) !== HZ)}
            size={WALL_BLOCK_Z}
            count={Math.floor((placed - c.start) * (2 * HZ * 2) / c.positions.length)}
            seed={k + 50}
            hue={STONE_HUE}
            sat={0.08}
            light={0.6}
          />
        </React.Fragment>
      ))}
      {/* merlons on the wall walk */}
      {done &&
        [...Array.from({length: 14}).flatMap((_, i) => [[-HX + 1 + i * 2, HZ], [-HX + 1 + i * 2, -HZ]]), ...Array.from({length: 6}).flatMap((_, i) => [[HX, -HZ + 1 + i * 2], [-HX, -HZ + 1 + i * 2]])].map(([x, z], i) => (
          <mesh key={i} position={[x, WALL_H + 0.3, z]} castShadow>
            <boxGeometry args={[0.8, 0.6, 0.8]} />
            <Stone color="#AEA699" />
          </mesh>
        ))}
      {TOWERS.map(([x, z], i) => (
        <group key={i} position={[x, 0, z]}>
          <mesh position={[0, th / 2, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[TOWER_R, TOWER_R * 1.08, th, 14]} />
            <Stone color={i % 2 ? '#B3AB9D' : '#BDB5A7'} />
          </mesh>
          {done && <TowerTop y={TOWER_H} />}
          {scaffold && i === 0 && <SpiralScaffold h={th} t={t} />}
        </group>
      ))}
      {/* gate */}
      {progress > 0.5 && (
        <mesh position={[0, 1.4, HZ + 0.66]}>
          <boxGeometry args={[2, 2.8, 0.05]} />
          <meshStandardMaterial color="#3a2a1c" />
        </mesh>
      )}
    </group>
  );
};

const Trees: React.FC = () => (
  <group>
    {[[-26, -14, 1.2], [-30, 4, 1], [24, -16, 1.3], [30, 2, 1.1], [-22, 18, 0.9], [26, 16, 1.0], [6, -24, 1.2], [-10, -26, 1]].map(([x, z, s], i) => (
      <group key={i} position={[x, 0, z]} scale={s}>
        <mesh position={[0, 1, 0]} castShadow>
          <cylinderGeometry args={[0.2, 0.3, 2, 6]} />
          <meshStandardMaterial color="#7a5232" flatShading />
        </mesh>
        <mesh position={[0, 3, 0]} castShadow>
          <coneGeometry args={[1.5, 3.4, 7]} />
          <meshStandardMaterial color={i % 2 ? '#3f7d3a' : '#4d8f43'} flatShading />
        </mesh>
      </group>
    ))}
  </group>
);

const Stage: React.FC<{children: React.ReactNode; shadow?: number}> = ({children, shadow = 34}) => {
  const {width, height} = useVideoConfig();
  return (
    <ThreeCanvas width={width} height={height} shadows gl={{antialias: true, alpha: true}} camera={{fov: 40, near: 0.5, far: 400}}>
      <fog attach="fog" args={[FOG, 110, 320]} />
      <SunLights shadowSize={shadow} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[600, 600]} />
        <meshStandardMaterial color="#86B46A" roughness={1} />
      </mesh>
      {children}
    </ThreeCanvas>
  );
};

const CastleSky = () => <Sky top="#7EC4F0" bottom={FOG} />;

// ---------- Scene 1: hook ----------
const Hook: React.FC = () => {
  const f = useCurrentFrame();
  const a = interpolate(f, [0, HOOK], [0.5, 0.8]);
  const r = interpolate(f, [0, HOOK], [62, 54]);
  return (
    <AbsoluteFill>
      <CastleSky />
      <Stage>
        <CameraRig pos={[Math.sin(a) * r, 14, Math.cos(a) * r]} target={[0, 3, 0]} />
        <Castle progress={1} />
        <Trees />
      </Stage>
      <Headline top="CASTLE STAIRS" big="CLOCKWISE?" sub="Why do they spiral?" delay={4} bigSize={150} />
      <Caption text="Let's build a castle and find out" delay={Math.round(HOOK * 0.5)} />
    </AbsoluteFill>
  );
};

// ---------- Scene 2: foundation + wall cross-section ----------
const SEG = 8; // wall segment length
const SEC_COURSES = 9;
const useSection = () =>
  useMemo(() => {
    const rubble: [number, number, number][] = [];
    for (let y = 0; y < 2; y++)
      for (let x = 0; x < 14; x++)
        for (let z = 0; z < 6; z++)
          rubble.push([-3.9 + x * 0.6 + (rand(x * 7 + z + y * 31) - 0.5) * 0.15, 0.15 + y * 0.3, -1.6 + z * 0.62 + (rand(x + z * 13 + y) - 0.5) * 0.15]);
    const faces: [number, number, number][][] = [];
    const core: [number, number, number][][] = [];
    for (let k = 0; k < SEC_COURSES; k++) {
      const y = 0.6 + k * 0.5 + 0.25;
      const off = k % 2 ? 0.5 : 0;
      const fl: [number, number, number][] = [];
      for (let x = -SEG / 2 + 0.5 + off; x < SEG / 2; x += 1) {
        fl.push([x, y, 1.0]);
        fl.push([x, y, -1.0]);
      }
      faces.push(fl);
      const cl: [number, number, number][] = [];
      for (let x = 0; x < 15; x++)
        for (let z = 0; z < 3; z++) cl.push([-3.75 + x * 0.52 + (rand(k * 99 + x) - 0.5) * 0.1, y + (rand(x * 3 + z + k) - 0.5) * 0.12, -0.5 + z * 0.5]);
      core.push(cl);
    }
    return {rubble, faces, core};
  }, []);

const WallSection: React.FC = () => {
  const f = useCurrentFrame();
  const {rubble, faces, core} = useSection();
  const rub = interpolate(f, [6, WALL * 0.3], [0, rubble.length], clamp);
  const wall = interpolate(f, [WALL * 0.3, WALL - 14], [0, SEC_COURSES], {...clamp, easing: Easing.inOut(Easing.quad)});
  const a = interpolate(f, [0, WALL], [0.85, 1.05]);
  const r = interpolate(f, [0, WALL], [19, 17]);
  const tgtY = interpolate(f, [0, WALL], [0.6, 2.2], {...clamp, easing: ease});
  return (
    <AbsoluteFill>
      <CastleSky />
      <Stage shadow={14}>
        <CameraRig pos={[1.5 + Math.sin(a) * r, 8, Math.cos(a) * r]} target={[0.5, tgtY, 0]} fov={42} />
        {/* trench, wider than the wall */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]} receiveShadow>
          <planeGeometry args={[9, 4]} />
          <meshStandardMaterial color="#6b4e33" roughness={1} />
        </mesh>
        <BlockLayer positions={rubble} size={[0.55, 0.28, 0.55]} count={Math.floor(rub)} seed={3} hue={[25, 35]} sat={0.06} light={0.45} />
        {faces.map((fl, k) => (
          <React.Fragment key={k}>
            <BlockLayer positions={fl} size={[0.96, 0.47, 0.5]} count={Math.floor((wall - k) * fl.length)} seed={k + 7} hue={STONE_HUE} sat={0.08} light={0.66} />
            <BlockLayer positions={core[k]} size={[0.42, 0.36, 0.4]} count={Math.floor((wall - k - 0.6) * core[k].length)} seed={k + 70} hue={[20, 30]} sat={0.1} light={0.38} />
          </React.Fragment>
        ))}
        <Worker position={[-3.2, 0, 2.6]} rotY={0.6} t={f * 0.2} pull={0.2} scale={0.8} />
        <Worker position={[-1.5, 0, -2.8]} rotY={-0.4} t={f * 0.2 + 2} scale={0.8} />
      </Stage>
      <StepBadge n={1} title="FOUNDATION & WALL" delay={3} />
      <Tag text="RUBBLE TRENCH" x={540} y={1330} anchor="center" delay={14} />
      <Tag text="CUT STONE FACES" x={70} y={720} anchor="left" delay={Math.round(WALL * 0.42)} size={50} />
      <Leader x1={850} y1={1070} x2={850} y2={890} delay={Math.round(WALL * 0.55)} />
      <Tag text="RUBBLE + MORTAR CORE" x={1030} y={860} anchor="right" delay={Math.round(WALL * 0.55)} size={50} />
      <Caption text="Walls often about 2.5 m thick" delay={Math.round(WALL * 0.72)} bottom={250} />
    </AbsoluteFill>
  );
};

// ---------- Scene 3: walls & towers rise, spiral scaffold ----------
const Rise: React.FC = () => {
  const f = useCurrentFrame();
  const progress = interpolate(f, [6, RISE - 10], [0.04, 1], {...clamp, easing: Easing.inOut(Easing.quad)});
  const a = interpolate(f, [0, RISE], [-0.35, 0.1], {...clamp, easing: ease});
  const r = interpolate(f, [0, RISE], [36, 31], clamp);
  const course = Math.max(1, Math.round(progress * COURSES));
  return (
    <AbsoluteFill>
      <CastleSky />
      <Stage>
        <CameraRig pos={[-HX + Math.sin(a) * r, 12, HZ + Math.cos(a) * r]} target={[-HX + 4, 4, HZ - 2]} />
        <Castle progress={progress} scaffold t={f / 90} />
        <Trees />
      </Stage>
      <StepBadge n={2} title="WALLS & TOWERS" delay={3} />
      <Tag text={`COURSE ${course}`} x={70} y={1400} anchor="left" delay={12} size={60} />
      <Tag text="SPIRAL RAMP" x={300} y={600} anchor="center" delay={Math.round(RISE * 0.45)} />
      <Caption text="Timbers in putlog holes held a spiral ramp" delay={Math.round(RISE * 0.5)} bottom={250} />
    </AbsoluteFill>
  );
};

// ---------- Scene 4: the spiral stair (cutaway tower) ----------
const STEPS = 26;
const RISER = 0.32;
const Stairs: React.FC = () => {
  const f = useCurrentFrame();
  const shown = interpolate(f, [4, STAIRS * 0.45], [0, STEPS], clamp);
  const camY = interpolate(f, [0, STAIRS], [3, 6], {...clamp, easing: ease});
  const towerH = STEPS * RISER + 1.5;
  const fightT = Math.max(0, f - STAIRS * 0.5);
  const swing = Math.sin(fightT * 0.35) * 0.6;
  // clockwise seen from above when going up: angle increases (x=cos, z=sin)
  const step = (i: number) => ({a: (i / 13) * Math.PI * 2 - Math.PI / 2, y: i * RISER});
  const top = step(18);
  const low = step(8);
  const arrowP = interpolate(f, [STAIRS * 0.3, STAIRS * 0.6], [0, 1], clamp);
  return (
    <AbsoluteFill>
      <Sky top="#6BA8D6" bottom="#CFE0C8" />
      <Stage shadow={10}>
        <CameraRig pos={[0.3, camY + 7, 17]} target={[0, camY + 1.2, 0]} fov={40} />
        {/* back half of the tower wall (cutaway) */}
        <mesh position={[0, towerH / 2, 0]} receiveShadow>
          <cylinderGeometry args={[3.1, 3.1, towerH, 20, 1, true, Math.PI / 2, Math.PI]} />
          <meshStandardMaterial color="#B5AD9F" side={THREE.DoubleSide} roughness={0.95} flatShading />
        </mesh>
        <mesh position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <circleGeometry args={[3.1, 20]} />
          <meshStandardMaterial color="#8f877a" />
        </mesh>
        {/* newel post */}
        <mesh position={[0, towerH / 2, 0]} castShadow>
          <cylinderGeometry args={[0.38, 0.38, towerH, 10]} />
          <Stone color="#9E9689" />
        </mesh>
        {Array.from({length: STEPS}).map((_, i) => {
          const {a, y} = step(i);
          const vis = Math.min(1, Math.max(0, shown - i));
          if (vis <= 0) return null;
          return (
            <group key={i} position={[0, y + RISER / 2, 0]} rotation={[0, -a, 0]} scale={[1, vis, 1]}>
              <mesh position={[1.7, 0, 0]} castShadow receiveShadow>
                <boxGeometry args={[2.7, RISER * 0.95, 0.95]} />
                <Stone color={i % 2 ? '#CFC7B8' : '#C4BCAD'} />
              </mesh>
            </group>
          );
        })}
        {f > STAIRS * 0.45 && (
          <>
            <group position={[Math.cos(top.a) * 1.8, top.y + RISER, Math.sin(top.a) * 1.8]}>
              <Worker position={[0, 0, 0]} rotY={-top.a - Math.PI / 2} scale={0.75} />
              <mesh position={[0.5, 1.2, 0.2]} rotation={[0, 0, -0.6 - swing]} castShadow>
                <boxGeometry args={[0.08, 0.9, 0.08]} />
                <meshStandardMaterial color="#d8dde3" metalness={0.6} roughness={0.3} />
              </mesh>
            </group>
            <group position={[Math.cos(low.a) * 1.8, low.y + RISER, Math.sin(low.a) * 1.8]}>
              <Worker position={[0, 0, 0]} rotY={-low.a + Math.PI / 2} scale={0.75} />
            </group>
          </>
        )}
      </Stage>
      <StepBadge n={3} title="SPIRAL STAIRS" delay={3} />
      <svg style={{position: 'absolute', left: 390, top: 520, width: 300, height: 300, overflow: 'visible', opacity: arrowP}}>
        <path d={`M 150 30 A 120 120 0 ${arrowP > 0.5 ? 1 : 0} 1 ${150 + 120 * Math.sin(arrowP * 5.2)} ${150 - 120 * Math.cos(arrowP * 5.2)}`} fill="none" stroke={C.ink} strokeWidth={22} strokeLinecap="round" />
        <path d={`M 150 30 A 120 120 0 ${arrowP > 0.5 ? 1 : 0} 1 ${150 + 120 * Math.sin(arrowP * 5.2)} ${150 - 120 * Math.cos(arrowP * 5.2)}`} fill="none" stroke={C.yellow} strokeWidth={12} strokeLinecap="round" />
      </svg>
      <Tag text="CLOCKWISE (GOING UP)" x={540} y={880} anchor="center" delay={Math.round(STAIRS * 0.32)} size={50} />
      <Tag text="DEFENDER" x={850} y={1010} anchor="center" delay={Math.round(STAIRS * 0.5)} size={46} />
      <Tag text="ATTACKER" x={360} y={1380} anchor="center" delay={Math.round(STAIRS * 0.52)} size={46} />
      <Caption text="A popular theory. Many historians doubt it." delay={Math.round(STAIRS * 0.68)} bottom={150} />
    </AbsoluteFill>
  );
};

// ---------- Scene 5: payoff ----------
const Reveal: React.FC = () => {
  const f = useCurrentFrame();
  const a = interpolate(f, [0, REVEAL], [0.35, 0.75], {...clamp, easing: ease});
  const r = interpolate(f, [0, REVEAL], [44, 74], {...clamp, easing: ease});
  const y = interpolate(f, [0, REVEAL], [8, 16], {...clamp, easing: ease});
  return (
    <AbsoluteFill>
      <CastleSky />
      <Stage>
        <CameraRig pos={[Math.sin(a) * r, y, Math.cos(a) * r]} target={[0, 2.5, 0]} />
        <Castle progress={1} />
        <Trees />
      </Stage>
      <Headline top="CONWY CASTLE, WALES" big="~4 YEARS" sub="1283 – 1287 · 8 towers" delay={8} bigSize={150} y={140} />
      <Caption text="Built in about four years, still standing today" delay={Math.round(VO.durations[4] * FPS * 0.5)} bottom={250} />
    </AbsoluteFill>
  );
};

// ---------- timeline ----------
export const CASTLE_DURATION = HOOK + WALL + RISE + STAIRS + REVEAL;

const Line: React.FC<{i: number; from: number}> = ({i, from}) => (
  <Sequence from={from + VO_DELAY} layout="none">
    <Audio src={staticFile(`vo/ep002-castle_${i}.wav`)} />
  </Sequence>
);

const SCENES: [React.FC, number][] = [[Hook, HOOK], [WallSection, WALL], [Rise, RISE], [Stairs, STAIRS], [Reveal, REVEAL]];

export const CastleEp: React.FC = () => {
  let t = 0;
  const starts = SCENES.map(([, d]) => {
    const s = t;
    t += d;
    return s;
  });
  return (
    <AbsoluteFill style={{background: FOG}}>
      {SCENES.map(([S, d], i) => (
        <Sequence key={i} from={starts[i]} durationInFrames={d}>
          <SceneFade dur={d} inF={i === 0 ? 0 : 6} outF={i === SCENES.length - 1 ? 0 : 6}>
            <S />
          </SceneFade>
        </Sequence>
      ))}
      {starts.map((s, i) => (
        <Line key={i} i={i} from={s} />
      ))}
      <Watermark />
    </AbsoluteFill>
  );
};
