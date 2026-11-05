import React from 'react';
import {Composition} from 'remotion';
import {KitTest} from './KitTest';
import {Aqueduct, AQUEDUCT_DURATION} from './episodes/Aqueduct';
import {Derinkuyu, DERINKUYU_DURATION} from './episodes/Derinkuyu';
import {Yakhchal, YAKHCHAL_DURATION} from './episodes/Yakhchal';
import {Venice, VENICE_DURATION} from './episodes/Venice';
import {Kailasa, KAILASA_DURATION} from './episodes/Kailasa';
import {Bunker, BUNKER_DURATION} from './episodes/Bunker';
import {AbuSimbel, ABUSIMBEL_DURATION} from './episodes/AbuSimbel';
import {Qeswachaka, QESWACHAKA_DURATION} from './episodes/Qeswachaka';
import {Windcatcher, WINDCATCHER_DURATION} from './episodes/Windcatcher';
import {Pisa, PISA_DURATION} from './episodes/Pisa';
import {ContainerHome, CONTAINER_DURATION} from './episodes/Container';
import {Hello} from './Hello';
import {Scene3D} from './Scene3D';
import {Pyramids, PYRAMIDS_DURATION} from './episodes/Pyramids';
import {CastleEp, CASTLE_DURATION} from './episodes/Castle';
export const Root: React.FC = () => (
  <>
    <Composition id="ContainerHome" component={ContainerHome} durationInFrames={CONTAINER_DURATION} fps={30} width={1080} height={1920} />
    <Composition id="Pisa" component={Pisa} durationInFrames={PISA_DURATION} fps={30} width={1080} height={1920} />
    <Composition id="Windcatcher" component={Windcatcher} durationInFrames={WINDCATCHER_DURATION} fps={30} width={1080} height={1920} />
    <Composition id="Qeswachaka" component={Qeswachaka} durationInFrames={QESWACHAKA_DURATION} fps={30} width={1080} height={1920} />
    <Composition id="AbuSimbel" component={AbuSimbel} durationInFrames={ABUSIMBEL_DURATION} fps={30} width={1080} height={1920} />
    <Composition id="Aqueduct" component={Aqueduct} durationInFrames={AQUEDUCT_DURATION} fps={30} width={1080} height={1920} />
    <Composition id="Derinkuyu" component={Derinkuyu} durationInFrames={DERINKUYU_DURATION} fps={30} width={1080} height={1920} />
    <Composition id="Bunker" component={Bunker} durationInFrames={BUNKER_DURATION} fps={30} width={1080} height={1920} />
    <Composition id="Kailasa" component={Kailasa} durationInFrames={KAILASA_DURATION} fps={30} width={1080} height={1920} />
    <Composition id="Venice" component={Venice} durationInFrames={VENICE_DURATION} fps={30} width={1080} height={1920} />
    <Composition id="Yakhchal" component={Yakhchal} durationInFrames={YAKHCHAL_DURATION} fps={30} width={1080} height={1920} />
    <Composition id="KitTest" component={KitTest} durationInFrames={120} fps={30} width={1080} height={1920} />
    <Composition id="Hello" component={Hello} durationInFrames={90} fps={30} width={1080} height={1920} />
    <Composition id="Scene3D" component={Scene3D} durationInFrames={180} fps={30} width={1080} height={1920} />
    <Composition id="Pyramids" component={Pyramids} durationInFrames={PYRAMIDS_DURATION} fps={30} width={1080} height={1920} />
    <Composition id="Castle" component={CastleEp} durationInFrames={CASTLE_DURATION} fps={30} width={1080} height={1920} />
  </>
);
