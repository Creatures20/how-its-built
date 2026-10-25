import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {ThreeCanvas} from '@remotion/three';
import {AssetProvider, GroundPatch, Ground, Renderer, SkyDome, Sun, useMat, uvBox} from './hib/pbr';
import {Beam, Bush, Cypress, Dust, KIT_TEXTURES, Person, Pine, Rock, Rope, ScaffoldBay, Tree, Water, scatter} from './hib/models';
import {CameraRig} from './hib/three';
import {Grade, Watermark} from './hib/ui';

const Wall: React.FC = () => {
  const m = useMat('castle_stone');
  const g = React.useMemo(() => uvBox(8, 4, 1.2, 2.5), []);
  return <mesh geometry={g} position={[0, 2, -3]} material={m} castShadow receiveShadow />;
};
const Block: React.FC<{p: [number, number, number]}> = ({p}) => {
  const m = useMat('stone_face_sand');
  const g = React.useMemo(() => uvBox(1.4, 0.8, 0.9, 1.5), []);
  return <mesh geometry={g} position={p} material={m} castShadow receiveShadow />;
};

const Scene: React.FC = () => {
  const f = useCurrentFrame();
  const a = 0.5 + f * 0.004;
  return (
    <>
      <Renderer exposure={1.0} envIntensity={0.5} />
      <CameraRig pos={[Math.sin(a) * 15, 4.5, Math.cos(a) * 15]} target={[0, 1.6, 0]} fov={45} />
      <SkyDome clouds={0.55} time={f / 30} />
      <Sun dir={[-0.6, 0.9, 0.55]} shadowSize={22} />
      <fog attach="fog" args={['#cfe2f2', 60, 260]} />
      <Ground tex="grass" texScale={5} />
      <GroundPatch tex="dirt" w={18} d={12} position={[0, 0, 0]} />
      <Wall />
      <Block p={[-2, 0.4, 2]} />
      <Block p={[-0.4, 0.4, 2.2]} />
      <ScaffoldBay position={[2, 0, -1.7]} w={2.5} h={4.5} levels={2} />
      <Person position={[-3.5, 0, 1]} pose="walk" t={f * 0.25} seed={2} head="cloth" />
      <Person position={[-1.2, 0, 3.3]} rotY={Math.PI / 2} pose="chisel" t={f * 0.2} seed={3} />
      <Person position={[1.5, 0, 2.5]} rotY={2.6} pose="pull" t={f * 0.25} seed={5} />
      <Person position={[3.4, 2.3, -1.2]} rotY={Math.PI / 2} pose="hammer" t={f * 0.18} seed={4} head="cloth" />
      <Person position={[0.5, 0, 0.6]} rotY={-0.6} pose="carry" t={f * 0.25} seed={8} />
      <Rope a={[1.4, 1.4, 2.4]} b={[-0.4, 0.6, 2.2]} sag={0.05} />
      <Beam a={[-5, 0, -1]} b={[-5, 3, -1]} r={0.1} />
      <Water w={14} d={5} position={[0, 0.03, 9]} time={f / 30} />
      <Dust at={[-1.0, 0.1, 2.6]} f={f} />
      {scatter(14, 14, 45, 3).map((s, i) => (i % 3 === 0 ? <Cypress key={i} position={s.pos} scale={s.s} seed={s.seed} /> : i % 3 === 1 ? <Tree key={i} position={s.pos} scale={s.s} seed={s.seed} /> : <Pine key={i} position={s.pos} scale={s.s} seed={s.seed} />))}
      {scatter(10, 7, 20, 9).map((s, i) => (i % 2 ? <Bush key={i} position={s.pos} scale={s.s} seed={s.seed} /> : <Rock key={i} position={s.pos} scale={s.s * 0.6} seed={s.seed} />))}
    </>
  );
};

export const KitTest: React.FC = () => {
  const {width, height} = useVideoConfig();
  return (
    <AbsoluteFill style={{background: '#cfe2f2'}}>
      <ThreeCanvas width={width} height={height} shadows camera={{fov: 45, near: 0.3, far: 900}}>
        <AssetProvider textures={[...KIT_TEXTURES, 'grass', 'dirt', 'castle_stone', 'stone_face_sand', 'stone_face_grey', 'water']} hdri="spruit_sunrise_1k">
          <Scene />
        </AssetProvider>
      </ThreeCanvas>
      <Grade />
      <Watermark />
    </AbsoluteFill>
  );
};
