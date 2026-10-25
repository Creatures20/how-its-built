import React, {useMemo} from 'react';
import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {ThreeCanvas} from '@remotion/three';

const Orbiter: React.FC<{i: number; n: number; frame: number}> = ({i, n, frame}) => {
  const a = (i / n) * Math.PI * 2 + frame * 0.03;
  const r = 2.6;
  const y = Math.sin(frame * 0.05 + i) * 0.6;
  return (
    <mesh position={[Math.cos(a) * r, y, Math.sin(a) * r]} rotation={[frame * 0.04, frame * 0.03, 0]}>
      <boxGeometry args={[0.35, 0.35, 0.35]} />
      <meshStandardMaterial color={`hsl(${(i / n) * 360}, 85%, 60%)`} metalness={0.4} roughness={0.25} />
    </mesh>
  );
};

export const Scene3D: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps, width, height, durationInFrames} = useVideoConfig();
  const pop = spring({frame, fps, config: {damping: 10, mass: 0.8}});
  const camZ = interpolate(frame, [0, durationInFrames], [9, 7]);
  const titleOpacity = interpolate(frame, [30, 55], [0, 1], {extrapolateRight: 'clamp'});
  const n = 12;
  const items = useMemo(() => Array.from({length: n}, (_, i) => i), []);
  return (
    <AbsoluteFill style={{background: 'radial-gradient(circle at 50% 45%, #2a1a5e 0%, #0b0618 70%)'}}>
      <ThreeCanvas width={width} height={height} camera={{fov: 45, position: [0, 1.2, camZ]}}>
        <ambientLight intensity={0.35} />
        <pointLight position={[5, 6, 5]} intensity={120} color="#ffffff" />
        <pointLight position={[-6, -3, -4]} intensity={60} color="#7c5cff" />
        <group scale={pop}>
          <mesh rotation={[frame * 0.015, frame * 0.025, 0]}>
            <torusKnotGeometry args={[1.1, 0.36, 220, 32]} />
            <meshStandardMaterial color="#ff4fa3" metalness={0.7} roughness={0.18} />
          </mesh>
          {items.map((i) => <Orbiter key={i} i={i} n={n} frame={frame} />)}
        </group>
      </ThreeCanvas>
      <AbsoluteFill style={{justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 260, fontFamily: 'sans-serif', color: 'white', opacity: titleOpacity}}>
        <div style={{fontSize: 96, fontWeight: 800, letterSpacing: -2}}>3D in Remotion</div>
        <div style={{fontSize: 44, opacity: 0.7, marginTop: 12}}>rendered in the cloud</div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
