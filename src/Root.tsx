import React from 'react';
import {Composition} from 'remotion';
import {KitTest} from './KitTest';
import {Aqueduct, AQUEDUCT_DURATION} from './episodes/Aqueduct';
import {Derinkuyu, DERINKUYU_DURATION} from './episodes/Derinkuyu';
import {Yakhchal, YAKHCHAL_DURATION} from './episodes/Yakhchal';
import {Hello} from './Hello';
import {Scene3D} from './Scene3D';
import {Pyramids, PYRAMIDS_DURATION} from './episodes/Pyramids';
import {CastleEp, CASTLE_DURATION} from './episodes/Castle';
export const Root: React.FC = () => (
  <>
    <Composition id="Aqueduct" component={Aqueduct} durationInFrames={AQUEDUCT_DURATION} fps={30} width={1080} height={1920} />
    <Composition id="Derinkuyu" component={Derinkuyu} durationInFrames={DERINKUYU_DURATION} fps={30} width={1080} height={1920} />
    <Composition id="Yakhchal" component={Yakhchal} durationInFrames={YAKHCHAL_DURATION} fps={30} width={1080} height={1920} />
    <Composition id="KitTest" component={KitTest} durationInFrames={120} fps={30} width={1080} height={1920} />
    <Composition id="Hello" component={Hello} durationInFrames={90} fps={30} width={1080} height={1920} />
    <Composition id="Scene3D" component={Scene3D} durationInFrames={180} fps={30} width={1080} height={1920} />
    <Composition id="Pyramids" component={Pyramids} durationInFrames={PYRAMIDS_DURATION} fps={30} width={1080} height={1920} />
    <Composition id="Castle" component={CastleEp} durationInFrames={CASTLE_DURATION} fps={30} width={1080} height={1920} />
  </>
);
