import React from 'react';
import {Composition} from 'remotion';
import {Hello} from './Hello';
import {Scene3D} from './Scene3D';
import {Pyramids, PYRAMIDS_DURATION} from './episodes/Pyramids';
export const Root: React.FC = () => (
  <>
    <Composition id="Hello" component={Hello} durationInFrames={90} fps={30} width={1080} height={1920} />
    <Composition id="Scene3D" component={Scene3D} durationInFrames={180} fps={30} width={1080} height={1920} />
    <Composition id="Pyramids" component={Pyramids} durationInFrames={PYRAMIDS_DURATION} fps={30} width={1080} height={1920} />
  </>
);
