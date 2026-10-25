import React from 'react';
import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
export const Hello: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const scale = spring({frame, fps, config: {damping: 12}});
  const opacity = interpolate(frame, [20, 40], [0, 1], {extrapolateRight: 'clamp'});
  const hue = interpolate(frame, [0, 90], [220, 300]);
  return (
    <AbsoluteFill style={{background: `linear-gradient(160deg, hsl(${hue},70%,15%), hsl(${hue+40},80%,35%))`, justifyContent: 'center', alignItems: 'center', fontFamily: 'sans-serif', color: 'white'}}>
      <div style={{fontSize: 140, fontWeight: 800, transform: `scale(${scale})`}}>Rendered</div>
      <div style={{fontSize: 70, opacity, marginTop: 30}}>in the cloud ☁️</div>
    </AbsoluteFill>
  );
};
