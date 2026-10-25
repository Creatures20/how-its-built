// "How It's Built" channel style kit: fonts, titles, yellow labels, captions.
import React from 'react';
import {AbsoluteFill, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {loadFont} from '@remotion/fonts';

loadFont({family: 'Lilita One', url: staticFile('fonts/LilitaOne.woff2')});
loadFont({family: 'Nunito', url: staticFile('fonts/Nunito900.woff2'), weight: '900'});

export const C = {
  yellow: '#FFC928',
  ink: '#111111',
  blue: '#123E8C',
  white: '#FFFFFF',
};

const stroke = (w: number): React.CSSProperties => ({
  WebkitTextStroke: `${w}px ${C.ink}`,
  paintOrder: 'stroke fill',
  textShadow: `0 ${w * 0.6}px 0 ${C.ink}`,
});

/** Pop-in helper: 0→1 spring starting at `delay` frames. */
export const usePop = (delay = 0, damping = 11) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  return spring({frame: frame - delay, fps, config: {damping, mass: 0.7}});
};

/** Big white stroked headline, like the thumbnails ("ROOF?", "2,000"). */
export const Headline: React.FC<{
  top?: string;
  big: string;
  sub?: string;
  delay?: number;
  y?: number;
  bigSize?: number;
  bigColor?: string;
}> = ({top, big, sub, delay = 0, y = 150, bigSize = 170, bigColor = C.white}) => {
  const p = usePop(delay);
  const p2 = usePop(delay + 8);
  return (
    <AbsoluteFill style={{alignItems: 'center', top: y, pointerEvents: 'none'}}>
      {top && (
        <div style={{fontFamily: 'Lilita One', fontSize: 64, color: C.yellow, letterSpacing: 2, ...stroke(10), opacity: p, transform: `translateY(${(1 - p) * -30}px)`}}>
          {top}
        </div>
      )}
      <div style={{fontFamily: 'Lilita One', fontSize: bigSize, lineHeight: 1, color: bigColor, textAlign: 'center', ...stroke(16), transform: `scale(${0.6 + 0.4 * p})`, opacity: Math.min(1, p * 1.5)}}>
        {big}
      </div>
      {sub && (
        <div style={{fontFamily: 'Lilita One', fontSize: 58, color: C.white, marginTop: 14, ...stroke(9), opacity: p2, transform: `translateY(${(1 - p2) * 20}px)`}}>
          {sub}
        </div>
      )}
    </AbsoluteFill>
  );
};

/** Yellow outlined pill label ("20 M", "PAVING"). */
export const Tag: React.FC<{text: string; x: number; y: number; delay?: number; size?: number; anchor?: 'left' | 'right' | 'center'}> = ({
  text, x, y, delay = 0, size = 56, anchor = 'left',
}) => {
  const p = usePop(delay, 9);
  const tx = anchor === 'left' ? '0%' : anchor === 'right' ? '-100%' : '-50%';
  return (
    <div style={{position: 'absolute', left: x, top: y, transform: `translate(${tx}, -50%) scale(${p})`, transformOrigin: anchor, opacity: Math.min(1, p * 2)}}>
      <div style={{fontFamily: 'Lilita One', fontSize: size, color: C.ink, background: C.yellow, border: `6px solid ${C.ink}`, borderRadius: 18, padding: `${size * 0.08}px ${size * 0.35}px`, whiteSpace: 'nowrap', boxShadow: `0 7px 0 ${C.ink}`}}>
        {text}
      </div>
    </div>
  );
};

/** Leader line from a point to a tag. */
export const Leader: React.FC<{x1: number; y1: number; x2: number; y2: number; delay?: number}> = ({x1, y1, x2, y2, delay = 0}) => {
  const frame = useCurrentFrame();
  const t = interpolate(frame - delay, [0, 10], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return (
    <svg style={{position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible'}}>
      <line x1={x1} y1={y1} x2={x1 + (x2 - x1) * t} y2={y1 + (y2 - y1) * t} stroke={C.ink} strokeWidth={10} strokeLinecap="round" />
      <line x1={x1} y1={y1} x2={x1 + (x2 - x1) * t} y2={y1 + (y2 - y1) * t} stroke={C.yellow} strokeWidth={5} strokeLinecap="round" />
      <circle cx={x1} cy={y1} r={11 * t} fill={C.yellow} stroke={C.ink} strokeWidth={4} />
    </svg>
  );
};

/** Bottom caption bar with a fact. */
export const Caption: React.FC<{text: string; delay?: number; bottom?: number}> = ({text, delay = 0, bottom = 300}) => {
  const p = usePop(delay, 14);
  return (
    <AbsoluteFill style={{justifyContent: 'flex-end', alignItems: 'center', paddingBottom: bottom, pointerEvents: 'none'}}>
      <div style={{fontFamily: 'Nunito', fontWeight: 900, fontSize: 52, color: C.white, background: 'rgba(17,17,17,0.82)', borderRadius: 22, padding: '18px 34px', maxWidth: 920, textAlign: 'center', lineHeight: 1.2, opacity: p, transform: `translateY(${(1 - p) * 40}px)`}}>
        {text}
      </div>
    </AbsoluteFill>
  );
};

/** "STEP 2" blue badge. */
export const StepBadge: React.FC<{n: number; title: string; delay?: number}> = ({n, title, delay = 0}) => {
  const p = usePop(delay, 12);
  return (
    <AbsoluteFill style={{alignItems: 'center', top: 150, pointerEvents: 'none'}}>
      <div style={{display: 'flex', alignItems: 'center', gap: 22, transform: `translateY(${(1 - p) * -60}px)`, opacity: Math.min(1, p * 1.5)}}>
        <div style={{fontFamily: 'Lilita One', fontSize: 52, color: C.ink, background: C.yellow, border: `6px solid ${C.ink}`, borderRadius: 16, padding: '2px 22px'}}>STEP {n}</div>
      </div>
      <div style={{fontFamily: 'Lilita One', fontSize: 104, color: C.white, marginTop: 16, textAlign: 'center', lineHeight: 1, ...stroke(13), transform: `scale(${0.7 + 0.3 * p})`, opacity: Math.min(1, p * 1.5)}}>
        {title}
      </div>
    </AbsoluteFill>
  );
};

/** Sky gradient behind the transparent 3D canvas. */
export const Sky: React.FC<{top?: string; bottom?: string}> = ({top = '#7EC4F0', bottom = '#F6E7C6'}) => (
  <AbsoluteFill style={{background: `linear-gradient(180deg, ${top} 0%, ${bottom} 62%, ${bottom} 100%)`}} />
);

/** Small channel mark in the corner. */
export const Watermark: React.FC = () => (
  <div style={{position: 'absolute', right: 40, bottom: 70, fontFamily: 'Lilita One', fontSize: 34, color: C.white, background: C.blue, border: `4px solid ${C.yellow}`, borderRadius: 14, padding: '4px 16px', opacity: 0.92}}>
    HOW IT'S <span style={{color: C.yellow}}>BUILT</span>
  </div>
);

/** Fade a scene in/out at its edges (frames are local to the Sequence). */
export const SceneFade: React.FC<{dur: number; children: React.ReactNode; inF?: number; outF?: number}> = ({dur, children, inF = 8, outF = 8}) => {
  const frame = useCurrentFrame();
  const o = Math.min(
    inF ? interpolate(frame, [0, inF], [0, 1], {extrapolateRight: 'clamp'}) : 1,
    outF ? interpolate(frame, [dur - outF, dur], [1, 0], {extrapolateLeft: 'clamp'}) : 1,
  );
  return <AbsoluteFill style={{opacity: o}}>{children}</AbsoluteFill>;
};
