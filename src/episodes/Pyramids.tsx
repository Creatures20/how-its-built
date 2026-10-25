// Episode: How the Great Pyramid was built (pilot)
import React, {useMemo} from 'react';
import {AbsoluteFill, Audio, Easing, interpolate, Sequence, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import VO from './pyramids-vo.json';
import {ThreeCanvas} from '@remotion/three';
import * as THREE from 'three';
import {BlockLayer, CameraRig, EnableClipping, Palm, SandGround, SunLights, Worker} from '../hib/three';
import {C, Caption, Headline, Leader, SceneFade, Sky, StepBadge, Tag, Watermark} from '../hib/ui';

// ---------- geometry constants ----------
const N = 24; // base width in blocks
const LH = 0.635; // layer height → 51.8° slope with 0.5 inset per layer
const LAYERS = N - 1; // block layers; capstone sits on top
const CASE_HW = N / 2 + 0.5; // casing half-width at ground
const CASE_H = CASE_HW * 2 * LH; // casing apex height (~15.9)
const CAP_H = 1.3;
const CAP_HW = (CAP_H / (2 * LH));

// ---------- timing: every scene is as long as its narration line ----------
const FPS = 30;
const VO_DELAY = 4; // frames before a line starts
const sceneLen = (i: number, tail: number) => Math.ceil((VO.durations[i] + tail) * FPS) + VO_DELAY;
const HOOK = sceneLen(0, 0.35);
const HAUL = sceneLen(1, 0.45);
const BUILD = sceneLen(2, 0.4); // layer by layer
const FINISH = sceneLen(3, 0.6); // capstone + casing
const REVEAL = sceneLen(4, 1.3); // height reveal + outro

const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
const ease = Easing.bezier(0.45, 0, 0.25, 1);

type LayerData = {positions: [number, number, number][]; start: number};
const useLayers = () =>
  useMemo(() => {
    let start = 0;
    const layers: LayerData[] = [];
    for (let k = 0; k < LAYERS; k++) {
      const w = N - k;
      const positions: [number, number, number][] = [];
      for (let r = 0; r < w; r++)
        for (let c = 0; c < w; c++) positions.push([c - (w - 1) / 2, k * LH + LH / 2, r - (w - 1) / 2]);
      layers.push({positions, start});
      start += positions.length;
    }
    return {layers, total: start};
  }, []);

const BLOCK_SIZE: [number, number, number] = [0.94, LH * 0.94, 0.94];

/** Wedge ramp rising toward the pyramid's front (+z) face. */
const Ramp: React.FC<{h: number; t: number}> = ({h, t}) => {
  const geo = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(0, 0);
    s.lineTo(1, 0);
    s.lineTo(0, 1);
    s.lineTo(0, 0);
    return new THREE.ExtrudeGeometry(s, {depth: 1, bevelEnabled: false});
  }, []);
  if (h < 0.05) return null;
  const L = h * 2.6;
  const W = 4.2;
  const gz = CASE_HW - h / (2 * LH) - 0.2;
  const ang = Math.atan(h / L);
  // a block being hauled up, looping
  const s = (t % 1);
  const bz = gz + L * (1 - s);
  const by = h * s;
  return (
    <group>
      <group position={[W / 2, 0, gz]} rotation={[0, -Math.PI / 2, 0]} scale={[L, h, W]}>
        <mesh geometry={geo} castShadow receiveShadow>
          <meshStandardMaterial color="#B98A55" roughness={1} flatShading />
        </mesh>
      </group>
      <group position={[0, by, bz]} rotation={[ang, 0, 0]}>
        <mesh position={[0, 0.42, 0]} castShadow>
          <boxGeometry args={[1, 0.62, 1.3]} />
          <meshStandardMaterial color="#D9C08F" flatShading />
        </mesh>
        {[0, 1, 2].map((i) => (
          <Worker key={i} position={[(i % 2 ? 0.6 : -0.6), 0, -1.6 - i * 0.9]} rotY={Math.PI / 2} pull={0.35} t={t * 40 + i} scale={0.55} />
        ))}
      </group>
    </group>
  );
};

/** The pyramid: blocks placed by `progress`, casing revealed above `casingFrom`, capstone drop offset. */
const Pyramid: React.FC<{progress: number; casingFrom?: number | null; capDrop?: number | null; showBlocks?: boolean}> = ({
  progress, casingFrom = null, capDrop = null, showBlocks = true,
}) => {
  const {layers, total} = useLayers();
  const placed = progress * total;
  const clip = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  clip.constant = -(casingFrom ?? 0);
  return (
    <group>
      {showBlocks &&
        layers.map((l, k) => (
          <BlockLayer key={k} positions={l.positions} size={BLOCK_SIZE} count={Math.floor(placed - l.start)} seed={k + 1} />
        ))}
      {casingFrom !== null && casingFrom < CASE_H && (
        <mesh position={[0, CASE_H / 2, 0]} rotation={[0, Math.PI / 4, 0]} castShadow receiveShadow>
          <coneGeometry args={[CASE_HW * Math.SQRT2, CASE_H, 4, 1]} />
          <meshStandardMaterial color="#EEDDB8" roughness={0.6} flatShading clippingPlanes={[clip]} />
        </mesh>
      )}
      {capDrop !== null && (
        <mesh position={[0, CASE_H - CAP_H / 2 + capDrop, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
          <coneGeometry args={[CAP_HW * Math.SQRT2 * 1.04, CAP_H * 1.04, 4, 1]} />
          <meshStandardMaterial color="#F5C243" metalness={0.75} roughness={0.25} flatShading emissive="#5a3a00" emissiveIntensity={0.3} />
        </mesh>
      )}
    </group>
  );
};

/** Distant Giza pyramids + palms for context. */
const Backdrop: React.FC = () => (
  <group>
    {[[-34, -40, 0.72], [-58, -66, 0.5]].map(([x, z, s], i) => (
      <mesh key={i} position={[x, (CASE_H * s) / 2, z]} rotation={[0, Math.PI / 4, 0]} scale={s} castShadow receiveShadow>
        <coneGeometry args={[CASE_HW * Math.SQRT2, CASE_H, 4, 1]} />
        <meshStandardMaterial color="#E7D2A6" roughness={0.9} flatShading />
      </mesh>
    ))}
    {[[26, 10, 1.3], [30, 16, 1.0], [-24, 22, 1.2], [-29, 17, 0.9], [34, -10, 1.1]].map(([x, z, s], i) => (
      <Palm key={i} position={[x, 0, z]} scale={s} lean={0.1 + (i % 3) * 0.06} />
    ))}
  </group>
);

const Stage: React.FC<{children: React.ReactNode}> = ({children}) => {
  const {width, height} = useVideoConfig();
  return (
    <ThreeCanvas width={width} height={height} shadows gl={{antialias: true, alpha: true}} camera={{fov: 40, near: 0.5, far: 400}}>
      <EnableClipping />
      <fog attach="fog" args={['#F6E7C6', 110, 320]} />
      <SunLights shadowSize={42} />
      <SandGround />
      {children}
    </ThreeCanvas>
  );
};

// ---------- Scene 1: hook ----------
const Hook: React.FC = () => {
  const f = useCurrentFrame();
  const a = interpolate(f, [0, HOOK], [0.55, 0.85]);
  const r = interpolate(f, [0, HOOK], [78, 70]);
  return (
    <AbsoluteFill>
      <Sky />
      <Stage>
        <CameraRig pos={[Math.sin(a) * r, 4, Math.cos(a) * r]} target={[0, 6, 0]} />
        <Pyramid progress={1} showBlocks={false} casingFrom={0} capDrop={0} />
        <Backdrop />
      </Stage>
      <Headline top="THE GREAT PYRAMID" big={'2.3 MILLION'} sub="stone blocks. No cranes." delay={4} />
      <Caption text="So how did they actually build it?" delay={Math.round(HOOK * 0.55)} />
    </AbsoluteFill>
  );
};

// ---------- Scene 2: moving a block ----------
const Rope: React.FC<{a: THREE.Vector3; b: THREE.Vector3}> = ({a, b}) => {
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const len = a.distanceTo(b);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return (
    <mesh position={mid} quaternion={q}>
      <cylinderGeometry args={[0.035, 0.035, len, 5]} />
      <meshStandardMaterial color="#6b4a2b" />
    </mesh>
  );
};

const Haul: React.FC = () => {
  const f = useCurrentFrame();
  const sx = interpolate(f, [0, HAUL], [-3.5, 3.0]);
  const walk = f * 0.28;
  const workers: [number, number][] = [];
  for (let i = 0; i < 4; i++) {
    workers.push([sx + 3.2 + i * 1.25, -0.75]);
    workers.push([sx + 3.6 + i * 1.25, 0.75]);
  }
  const front = new THREE.Vector3(sx + 1.25, 0.35, 0);
  const pour = 0.5 + 0.5 * Math.sin(f * 0.4);
  return (
    <AbsoluteFill>
      <Sky />
      <Stage>
        <CameraRig pos={[sx + 3, 8.5, 21]} target={[sx + 3.2, 0.4, 0]} fov={42} />
        {/* wet sand: ahead of and under the sledge */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[sx + 1.2, 0.012, 0]} receiveShadow>
          <planeGeometry args={[4.2, 2.6]} />
          <meshStandardMaterial color="#B98B53" roughness={0.6} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[sx - 3, 0.01, 0]} receiveShadow>
          <planeGeometry args={[6, 2.2]} />
          <meshStandardMaterial color="#CDA46A" roughness={0.8} />
        </mesh>
        {/* sledge */}
        <group position={[sx, 0, 0]}>
          {[-0.55, 0.55].map((z) => (
            <mesh key={z} position={[0, 0.12, z]} castShadow>
              <boxGeometry args={[2.6, 0.22, 0.22]} />
              <meshStandardMaterial color="#7a4f2a" flatShading />
            </mesh>
          ))}
          {[-1, -0.5, 0, 0.5, 1].map((x) => (
            <mesh key={x} position={[x, 0.27, 0]} castShadow>
              <boxGeometry args={[0.22, 0.09, 1.5]} />
              <meshStandardMaterial color="#8d5e34" flatShading />
            </mesh>
          ))}
          <mesh position={[0, 0.92, 0]} castShadow receiveShadow>
            <boxGeometry args={[2.0, 1.2, 1.25]} />
            <meshStandardMaterial color="#D8BF8C" flatShading roughness={0.95} />
          </mesh>
          {/* water carrier on the front of the sledge */}
          <Worker position={[1.05, 0.3, 0.45]} rotY={0} pull={-0.25} t={0} scale={0.95} />
          <mesh position={[1.45, 1.35, 0.45]} rotation={[0, 0, -1.2 - 0.2 * pour]}>
            <cylinderGeometry args={[0.13, 0.17, 0.42, 8]} />
            <meshStandardMaterial color="#b0603a" flatShading />
          </mesh>
          <mesh position={[1.7, 0.7, 0.45]}>
            <cylinderGeometry args={[0.03, 0.05, 1.25, 6]} />
            <meshStandardMaterial color="#5fb7ff" transparent opacity={0.85} emissive="#2a7fd0" emissiveIntensity={0.3} />
          </mesh>
        </group>
        {workers.map(([x, z], i) => (
          <React.Fragment key={i}>
            <Worker position={[x, 0, z]} rotY={0} pull={0.45} t={walk + i * 0.7} />
            <Rope a={front.clone().setZ(z * 0.45)} b={new THREE.Vector3(x - 0.15, 0.95, z)} />
          </React.Fragment>
        ))}
        <Palm position={[sx + 9, 0, -6]} scale={1.1} />
        <Palm position={[sx - 8, 0, -7]} scale={0.9} />
      </Stage>
      <StepBadge n={1} title={'DRAG THE STONE'} delay={3} />
      <Tag text="≈ 2.5 TONNES" x={380} y={800} anchor="center" delay={22} />
      <Leader x1={330} y1={1030} x2={650} y2={995} delay={50} />
      <Tag text="WET SAND" x={760} y={990} anchor="center" delay={55} />
      <Caption text="Wetting the sand roughly halves the pulling force" delay={62} />
    </AbsoluteFill>
  );
};

// ---------- Scenes 3-5: build, finish, reveal (one continuous 3D shot) ----------

const Build: React.FC = () => {
  const f = useCurrentFrame();
  const progress = interpolate(f, [8, BUILD - 8], [0, 1], {...clamp, easing: Easing.inOut(Easing.quad)});
  // height of finished layers so far
  const layersDone = progress * LAYERS;
  const topH = Math.min(layersDone, LAYERS) * LH;

  // phase 2 (finish)
  const f2 = f - BUILD;
  const capDrop = interpolate(f2, [0, 36], [9, 0], {...clamp, easing: Easing.out(Easing.bounce)});
  const casing = interpolate(f2, [40, FINISH - 8], [CASE_H, 0], {...clamp, easing: ease});
  const inFinish = f >= BUILD;
  const rampH = inFinish ? Math.min(LAYERS * LH, Math.max(0, casing - 0.4)) : topH;

  // camera: orbit while building, swing to front for finish, pull back for reveal
  const f3 = f - BUILD - FINISH;
  const ang = interpolate(f, [0, BUILD, BUILD + FINISH, BUILD + FINISH + REVEAL], [0.25, 1.05, 0.55, 0.62], {...clamp, easing: ease});
  const rad = interpolate(f, [0, BUILD, BUILD + FINISH, BUILD + FINISH + REVEAL], [52, 60, 46, 84], {...clamp, easing: ease});
  const camY = interpolate(f, [0, BUILD, BUILD + FINISH, BUILD + FINISH + REVEAL], [26, 22, 12, 6], {...clamp, easing: ease});
  const tgtY = interpolate(f, [0, BUILD, BUILD + FINISH, BUILD + FINISH + REVEAL], [3, 6, 8.5, 6], {...clamp, easing: ease});
  const pole = interpolate(f3, [10, 50], [0, CASE_H], {...clamp, easing: ease});

  const year = Math.min(20, 1 + Math.floor(progress * 20));
  return (
    <AbsoluteFill>
      <Sky />
      <Stage>
        <CameraRig pos={[Math.sin(ang) * rad, camY, Math.cos(ang) * rad]} target={[0, tgtY, 4]} />
        <Pyramid progress={progress} casingFrom={inFinish ? casing : null} capDrop={inFinish ? capDrop : null} showBlocks={!(inFinish && casing <= 0.01)} />
        <Ramp h={rampH} t={f / 75} />
        <Backdrop />
        {f3 > 0 && (
          <group position={[14.5, 0, 6]}>
            <mesh position={[0, pole / 2, 0]}>
              <boxGeometry args={[0.45, Math.max(0.01, pole), 0.45]} />
              <meshStandardMaterial color={C.yellow} emissive="#7a5a00" emissiveIntensity={0.35} />
            </mesh>
            {pole > 0.5 && (
              <mesh position={[0, pole, 0]}>
                <boxGeometry args={[2.2, 0.3, 0.3]} />
                <meshStandardMaterial color={C.yellow} emissive="#7a5a00" emissiveIntensity={0.35} />
              </mesh>
            )}
            <mesh position={[0, 0.15, 0]}>
              <boxGeometry args={[2.2, 0.3, 0.3]} />
              <meshStandardMaterial color={C.yellow} emissive="#7a5a00" emissiveIntensity={0.35} />
            </mesh>
          </group>
        )}
      </Stage>

      <Sequence durationInFrames={BUILD} layout="none">
        <StepBadge n={2} title={'LAYER BY LAYER'} delay={3} />
        <Tag text={`YEAR ${year}`} x={70} y={1360} anchor="left" delay={12} size={64} />
        <Tag text="RAMP" x={760} y={1250} anchor="center" delay={Math.round(BUILD * 0.38)} />
        <Caption text="A leading theory: ramps grew taller with every layer" delay={Math.round(BUILD * 0.42)} bottom={250} />
      </Sequence>
      <Sequence from={BUILD} durationInFrames={FINISH} layout="none">
        <StepBadge n={3} title={'THE FINISH'} delay={3} />
        <Tag text="CAPSTONE" x={540} y={560} anchor="center" delay={30} />
        <Tag text="WHITE LIMESTONE CASING" x={540} y={1430} anchor="center" delay={55} size={50} />
        <Caption text="Polished casing stones turned the steps into smooth faces" delay={62} bottom={250} />
      </Sequence>
      <Sequence from={BUILD + FINISH} durationInFrames={REVEAL} layout="none">
        <Headline top="ORIGINALLY" big="146 M TALL" sub="Tallest thing humans built" delay={8} bigSize={150} y={140} />
        <Caption text="...for about 3,800 years." delay={Math.round(VO.durations[4] * FPS * 0.55)} bottom={250} />
      </Sequence>
    </AbsoluteFill>
  );
};

// ---------- timeline ----------
export const PYRAMIDS_DURATION = HOOK + HAUL + BUILD + FINISH + REVEAL;

const Line: React.FC<{i: number; from: number}> = ({i, from}) => (
  <Sequence from={from + VO_DELAY} layout="none">
    <Audio src={staticFile(`vo/pyramids_${i}.wav`)} />
  </Sequence>
);

export const Pyramids: React.FC = () => {
  const t1 = HOOK, t2 = t1 + HAUL, t3 = t2 + BUILD, t4 = t3 + FINISH;
  return (
    <AbsoluteFill style={{background: '#F6E7C6'}}>
      <Sequence durationInFrames={HOOK}>
        <SceneFade dur={HOOK} inF={0} outF={6}>
          <Hook />
        </SceneFade>
      </Sequence>
      <Sequence from={t1} durationInFrames={HAUL}>
        <SceneFade dur={HAUL} inF={6} outF={6}>
          <Haul />
        </SceneFade>
      </Sequence>
      <Sequence from={t2} durationInFrames={BUILD + FINISH + REVEAL}>
        <SceneFade dur={BUILD + FINISH + REVEAL} inF={6} outF={0}>
          <Build />
        </SceneFade>
      </Sequence>
      <Line i={0} from={0} />
      <Line i={1} from={t1} />
      <Line i={2} from={t2} />
      <Line i={3} from={t3} />
      <Line i={4} from={t4} />
      <Watermark />
    </AbsoluteFill>
  );
};
