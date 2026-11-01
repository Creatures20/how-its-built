// Episode 9: Abu Simbel — the temple that was sawn into blocks and moved 65 m uphill (1964–68). v2 kit.
import React, {useMemo} from 'react';
import {AbsoluteFill, Audio, interpolate, Sequence, staticFile, useCurrentFrame, useVideoConfig, Easing} from 'remotion';
import {ThreeCanvas} from '@remotion/three';
import * as THREE from 'three';
import VO from './ep009-abusimbel-vo.json';
import {AssetProvider, Renderer, SkyDome, Sun, TexName, useMat, usePlainMat, uvBox, worldUV} from '../hib/pbr';
import {Dust, KIT_TEXTURES, PalmTree, Person, Rock, Rope, ScaffoldBay, Terrain, walkAlong, rnd} from '../hib/models';
import {CameraRig} from '../hib/three';
import {Cam, camPath, groundSafe, toScreen} from '../hib/project';
import {C, Caption, Grade, Headline, SceneFade, StepBadge, Tag, Watermark} from '../hib/ui';

// ============================================================ timing
const FPS = 30;
const VO_DELAY = 5;
const sceneLen = (i: number, tail: number) => Math.ceil((VO.durations[i] + tail) * FPS) + VO_DELAY;
const TAILS = [0.45, 0.45, 0.45, 0.45, 0.45, 0.45, 0.45, 0.5, 1.8];
const LEN = TAILS.map((t, i) => sceneLen(i, t));
const START = LEN.map((_, i) => LEN.slice(0, i).reduce((a, b) => a + b, 0));
export const ABUSIMBEL_DURATION = LEN.reduce((a, b) => a + b, 0);
const wordAt = (i: number, w: string) => Math.round(VO_DELAY + (Math.max(0, VO.lines[i].indexOf(w)) / VO.lines[i].length) * VO.durations[i] * FPS);

const cl = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
const ramp = (f: number, a: number, b: number, ease = Easing.inOut(Easing.cubic)) => interpolate(f, [a, b], [0, 1], {...cl, easing: ease});

const TEXTURES: TexName[] = [...KIT_TEXTURES, 'sand', 'stone_face_sand', 'sandstone_blocks', 'water', 'concrete', 'steel', 'gravel', 'dirt', 'iron_dark'];
const STONE = '#ecd3b0';
const ROCK = '#c9a47c';

// ============================================================ the landscape (metres; facade of the original temple at z = 0, facing +z = the Nile)
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const vnoise = (x: number, z: number) => Math.sin(x * 0.031 + 1.3) * Math.cos(z * 0.027 + 0.4) * 0.6 + Math.sin(x * 0.083 + z * 0.061) * 0.4;

const NEW: [number, number, number] = [0, 65, -200]; // new site: 65 m higher, 200 m back
const RIVER_Y = -1;
const LAKE_Y = 52;

/** the natural cliff (no excavation) */
const cliffBase = (x: number, z: number) => {
  const ax = Math.abs(x);
  const crest = 34 + 4 * Math.sin(x / 37 + 1) * smooth(48, 90, ax);
  const bank = -8 * smooth(22, 46, z) + 0.25 * vnoise(x * 3, z * 3);
  const cliff = crest * smooth(5, -6, z);
  const up = 31 * smooth(-10, -150, z);
  const dunes = (vnoise(x * 1.7, z * 1.7) * 1.6 + vnoise(x * 4.1 + 9, z * 3.3) * 0.5) * smooth(-12, -40, z);
  const far = 14 * smooth(-330, -460, z) * (0.6 + 0.4 * Math.sin(x / 60));
  return bank + cliff + up + dunes + far;
};
/** ground with the excavated pit at the old site and the flat pad at the new site */
const H = (x: number, z: number) => {
  const ax = Math.abs(x);
  let h = cliffBase(x, z);
  const pitK = smooth(47, 39, ax) * smooth(-82, -73, z) * smooth(20, 10, z);
  h = h * (1 - pitK);
  const padK = smooth(95, 75, ax) * smooth(-120, -140, z) * smooth(-320, -300, z);
  return h + (65 - h) * padK;
};
/** top of the (not yet excavated) rock block above the old temple */
const blockTop = (z: number) => 34 + 31 * smooth(-10, -150, z);

// ============================================================ shared materials with "saw cut" lines
type CutU = {cutAmt: {value: number}; cutGlow: {value: number}; cutTop: {value: number}};
const useCutMat = (tex: TexName, tint: string, clip: THREE.Plane[], U: CutU) => {
  const base = useMat(tex, {tint, clip, side: THREE.DoubleSide});
  return useMemo(() => {
    const m = base.clone();
    m.clippingPlanes = clip;
    m.onBeforeCompile = (sh) => {
      sh.uniforms.cutAmt = U.cutAmt;
      sh.uniforms.cutGlow = U.cutGlow;
      sh.uniforms.cutTop = U.cutTop;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vCW; varying vec3 vCN;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCW = (modelMatrix * vec4(position, 1.0)).xyz; vCN = normalize(mat3(modelMatrix) * normal);');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vCW; varying vec3 vCN; uniform float cutAmt; uniform float cutGlow; uniform float cutTop; float cutLine = 0.0;')
        .replace('#include <map_fragment>', `#include <map_fragment>
if (cutAmt > 0.0) {
  vec3 an = abs(vCN);
  vec2 q = an.y > 0.6 ? vCW.xz : (an.x > an.z ? vCW.zy : vCW.xy);
  vec2 cell = vec2(3.1, 2.6);
  vec2 d = cell * 0.5 - abs(fract(q / cell) - 0.5) * cell;
  float l = 1.0 - smoothstep(0.035, 0.1, min(d.x, d.y));
  cutLine = l * step(cutTop, vCW.y) * cutAmt;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.09, 0.06, 0.04), cutLine);
}`)
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.62, 0.12) * cutLine * cutGlow * 1.6;');
    };
    m.customProgramCacheKey = () => 'sawcut';
    return m;
  }, [base, clip, U]);
};

const B: React.FC<{s: [number, number, number]; p: [number, number, number]; m: THREE.Material; r?: [number, number, number]; ts?: number}> = ({s, p, m, r, ts = 2.5}) => {
  const g = useMemo(() => uvBox(s[0], s[1], s[2], ts), [s[0], s[1], s[2], ts]); // eslint-disable-line react-hooks/exhaustive-deps
  return <mesh geometry={g} position={p} rotation={r} material={m} castShadow receiveShadow />;
};

// ============================================================ the seated colossus (original stylised model, ~21 m tall incl. crown)
type Mats = {stone: THREE.Material; dark: THREE.Material};
const Colossus: React.FC<{x: number; mats: Mats; headOff?: [number, number, number]; scale?: number; z?: number; y?: number}> = ({x, mats, headOff = [0, 0, 0], scale = 1, z = 0, y = 0}) => {
  const {stone, dark} = mats;
  const nemesG = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(-1.75, 18.9);
    s.lineTo(1.75, 18.9);
    s.lineTo(2.95, 15.0);
    s.lineTo(-2.95, 15.0);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, {depth: 2.3, bevelEnabled: true, bevelThickness: 0.15, bevelSize: 0.15, bevelSegments: 2});
    g.translate(0, 0, 0.75);
    return worldUV(g, 2.5);
  }, []);
  const headG = useMemo(() => worldUV(new THREE.SphereGeometry(1.45, 22, 16), 2.5), []);
  const torsoG = useMemo(() => worldUV(new THREE.CylinderGeometry(3.1, 2.25, 4.6, 22), 2.5), []);
  return (
    <group position={[x, y, z]} scale={scale}>
      <B s={[7.2, 1.2, 9.6]} p={[0, 0.6, 4.8]} m={stone} />
      <B s={[6.4, 8.2, 5.4]} p={[0, 5.3, 2.7]} m={stone} />
      {[-1, 1].map((sd) => (
        <React.Fragment key={sd}>
          <B s={[1.7, 7.2, 2.0]} p={[sd * 1.25, 4.8, 6.3]} m={stone} />
          <B s={[1.75, 0.8, 2.8]} p={[sd * 1.25, 1.6, 7.7]} m={stone} />
          <B s={[1.9, 1.7, 5.0]} p={[sd * 1.25, 9.25, 4.9]} m={stone} />
          <mesh position={[sd * 3.15, 12.9, 2.4]} rotation={[0.12, 0, sd * 0.05]} material={stone} castShadow>
            <capsuleGeometry args={[0.72, 3.4, 4, 10]} />
          </mesh>
          <B s={[1.2, 1.0, 4.4]} p={[sd * 2.55, 10.55, 4.9]} m={stone} />
          <mesh position={[sd * 3.0, 15.0, 2.2]} material={stone} castShadow>
            <sphereGeometry args={[1.0, 14, 10]} />
          </mesh>
        </React.Fragment>
      ))}
      <B s={[4.6, 1.4, 4.0]} p={[0, 9.8, 3.3]} m={stone} />
      <mesh geometry={torsoG} position={[0, 13.5, 2.1]} scale={[1, 1, 0.5]} material={stone} castShadow receiveShadow />
      <mesh position={[0, 15.9, 2.3]} material={stone} castShadow>
        <cylinderGeometry args={[0.95, 1.05, 1.3, 14]} />
      </mesh>
      {/* head group (can be lifted off by a crane) */}
      <group position={headOff}>
        <mesh geometry={headG} position={[0, 17.4, 2.4]} scale={[1, 1.18, 1.05]} material={stone} castShadow receiveShadow />
        <mesh geometry={nemesG} material={stone} castShadow receiveShadow />
        {[-1, 1].map((sd) => (
          <B key={sd} s={[0.95, 2.7, 0.5]} p={[sd * 2.0, 14.7, 3.15]} m={stone} />
        ))}
        <B s={[0.38, 0.85, 0.55]} p={[0, 17.15, 3.85]} m={stone} />
        {[-1, 1].map((sd) => (
          <B key={sd} s={[0.55, 0.17, 0.12]} p={[sd * 0.55, 17.75, 3.76]} m={dark} />
        ))}
        <B s={[0.9, 0.16, 0.12]} p={[0, 16.55, 3.86]} m={dark} />
        <B s={[0.6, 1.6, 0.6]} p={[0, 15.55, 3.45]} m={stone} r={[0.12, 0, 0]} />
        <mesh position={[0, 19.55, 2.0]} material={stone} castShadow>
          <cylinderGeometry args={[1.6, 1.45, 1.5, 18]} />
        </mesh>
        <mesh position={[0, 21.3, 2.0]} material={stone} castShadow>
          <cylinderGeometry args={[0.55, 1.1, 2.4, 16]} />
        </mesh>
        <mesh position={[0, 22.5, 2.0]} material={stone} castShadow>
          <sphereGeometry args={[0.62, 12, 10]} />
        </mesh>
        <B s={[0.3, 0.7, 0.3]} p={[0, 18.95, 3.7]} m={stone} />
      </group>
    </group>
  );
};

const STATUE_X = [-13.6, -5.6, 5.6, 13.6];

/** The Great Temple: carved facade, 4 colossi, baboon frieze, falcon-headed god in a niche; `shell` = the outer rock of the inner halls. */
const Temple: React.FC<{at: [number, number, number]; rev?: number; cut?: {amt: number; glow: number; top: number}; headOff?: [number, number, number]; shell?: boolean; heads?: boolean}> = ({
  at, rev = 999, cut = {amt: 0, glow: 0, top: 0}, headOff, shell = false,
}) => {
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, -1, 0), 0), []);
  plane.constant = at[1] + rev;
  const clip = useMemo(() => [plane], [plane]);
  const U = useMemo<CutU>(() => ({cutAmt: {value: 0}, cutGlow: {value: 0}, cutTop: {value: 0}}), []);
  U.cutAmt.value = cut.amt;
  U.cutGlow.value = cut.glow;
  U.cutTop.value = at[1] + cut.top;
  const stone = useCutMat('stone_face_sand', STONE, clip, U);
  const facadeM = useCutMat('stone_face_sand', '#e3c49d', clip, U);
  const shellM = useCutMat('stone_face_sand', ROCK, clip, U);
  const dark = useMemo(() => new THREE.MeshStandardMaterial({color: '#140d07', roughness: 1, clippingPlanes: clip, side: THREE.DoubleSide}), [clip]);
  const mats = useMemo(() => ({stone, dark}), [stone, dark]);
  const slabG = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(-19, 0);
    s.lineTo(19, 0);
    s.lineTo(17.5, 31);
    s.lineTo(-17.5, 31);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, {depth: 3.5, bevelEnabled: false});
    g.translate(0, 0, -3.5);
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) - p.getY(i) * 0.045);
    g.computeVertexNormals();
    return worldUV(g, 4);
  }, []);
  const baboons = useMemo(() => Array.from({length: 22}, (_, i) => -16.1 + (i * 32.2) / 21), []);
  return (
    <group position={at}>
      <mesh geometry={slabG} material={facadeM} castShadow receiveShadow />
      <B s={[36.6, 1.3, 1.6]} p={[0, 30.3, -1.05]} m={facadeM} />
      <B s={[36.0, 0.5, 1.2]} p={[0, 28.9, -0.95]} m={facadeM} />
      {baboons.map((x, i) => (
        <group key={i} position={[x, 31.0, -1.3]}>
          <mesh position={[0, 0.75, 0]} scale={[1, 1.25, 0.9]} material={stone} castShadow>
            <sphereGeometry args={[0.55, 10, 8]} />
          </mesh>
          <mesh position={[0, 1.65, 0.12]} material={stone} castShadow>
            <sphereGeometry args={[0.36, 10, 8]} />
          </mesh>
        </group>
      ))}
      {/* doorway + niche with the falcon-headed sun god */}
      <B s={[5.6, 9.4, 0.5]} p={[0, 4.7, 0.05]} m={facadeM} />
      <B s={[4.0, 7.8, 0.3]} p={[0, 3.9, 0.36]} m={dark} />
      <B s={[4.6, 7.4, 0.3]} p={[0, 13.9, -0.5]} m={dark} />
      <mesh position={[0, 12.6, 0.0]} material={stone} castShadow>
        <cylinderGeometry args={[0.85, 1.05, 4.6, 12]} />
      </mesh>
      <mesh position={[0, 15.4, 0.05]} material={stone} castShadow>
        <sphereGeometry args={[0.72, 12, 10]} />
      </mesh>
      <mesh position={[0, 16.7, -0.1]} rotation={[Math.PI / 2, 0, 0]} material={stone} castShadow>
        <cylinderGeometry args={[0.85, 0.85, 0.3, 18]} />
      </mesh>
      {/* terrace */}
      <B s={[40, 0.6, 12]} p={[0, 0.3, 5.5]} m={facadeM} ts={4} />
      {STATUE_X.map((x, i) => (
        <Colossus key={i} x={x} mats={mats} headOff={i === 2 ? headOff : undefined} />
      ))}
      {shell && (
        <>
          <B s={[22, 12.5, 21]} p={[0, 6.25, -14]} m={shellM} ts={4} />
          <B s={[16, 9.5, 12]} p={[0, 4.75, -30.5]} m={shellM} ts={4} />
          <B s={[11, 7.5, 14]} p={[0, 3.75, -43.5]} m={shellM} ts={4} />
          {[-1, 1].map((sd) => (
            <B key={sd} s={[8, 6.5, 14]} p={[sd * 15, 3.25, -14]} m={shellM} ts={4} />
          ))}
        </>
      )}
    </group>
  );
};

/** the cliff as it was before excavation: in the temple zone the rock face starts right behind the facade */
const cliffT = (x: number, z: number) => {
  const ax = Math.abs(x);
  const k = smooth(50, 44, ax);
  const crest = 34 + 4 * Math.sin(x / 37 + 1) * smooth(48, 90, ax);
  const front = smooth(5, -6, z) * (1 - k) + smooth(-0.8, -5.5, z) * k;
  const up = 31 * smooth(-10, -150, z);
  const dunes = (vnoise(x * 1.7, z * 1.7) * 1.6 + vnoise(x * 4.1 + 9, z * 3.3) * 0.5) * smooth(-12, -40, z);
  return crest * front + up + dunes;
};
const SAND = '#dcb98e';
/** macro colour variation + rocky steep slopes (same look as the kit Terrain) */
const macroShader = (mm: THREE.MeshStandardMaterial, key: string) => {
  mm.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTPos; varying vec3 vTN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTPos = (modelMatrix * vec4(position,1.0)).xyz; vTN = normal;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vTPos; varying vec3 vTN;
float th(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float tn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(th(i),th(i+vec2(1,0)),f.x), mix(th(i+vec2(0,1)),th(i+vec2(1,1)),f.x), f.y); }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
float mv = tn(vTPos.xz / 23.0) * 0.6 + tn(vTPos.xz / 71.0) * 0.4;
diffuseColor.rgb *= 0.74 + 0.5 * mv;
float steep = 1.0 - smoothstep(0.62, 0.86, normalize(vTN).y);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.30, 0.18, 0.10) * (0.8 + 0.4 * mv), steep * 0.85);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = max(roughnessFactor, 0.92);');
  };
  mm.envMapIntensity = 0.6;
  mm.customProgramCacheKey = () => key;
};

/** Rock still covering the old temple: a heightfield = original cliff cut down to `level` (world y), never below the pit. */
const Fill: React.FC<{level: number}> = ({level}) => {
  const base = useMat('sand', {tint: SAND});
  const m = useMemo(() => {
    const mm = base.clone();
    mm.polygonOffset = true;
    mm.polygonOffsetFactor = 2;
    mm.polygonOffsetUnits = 2;
    macroShader(mm, 'fillMacro');
    return mm;
  }, [base]);
  const geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(104, 94, 208, 188);
    g.rotateX(-Math.PI / 2);
    g.translate(0, 0, -45);
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / 7, p.getZ(i) / 7);
    return g;
  }, []);
  const p = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    p.setY(i, Math.max(H(x, z), Math.min(cliffT(x, z), level)));
  }
  p.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  if (level <= 0.05) return null;
  return <mesh geometry={geo} material={m} castShadow receiveShadow />;
};

/** height of the artificial hill above the new pad (0..~38 m); vertical rock face right behind the facade */
const moundH = (x: number, z: number) => {
  const ax = Math.abs(x);
  const across = Math.pow(Math.max(0, 1 - (x / 78) ** 2), 0.55);
  const k = smooth(36, 28, ax);
  const front = smooth(-200.6, -203.5, z) * k + smooth(-182, -236, z) * (1 - k);
  const back = smooth(-345, -285, z);
  return 38 * across * front * back + 1.2 * vnoise(x * 3, z * 3) * front;
};
/** Artificial hill + concrete dome at the new site. dome = 0..1 length built, hill = 0..1 height. */
const NewHill: React.FC<{dome: number; hill: number}> = ({dome, hill}) => {
  const conc = useMat('concrete', {tint: '#d8d2c8', side: THREE.DoubleSide});
  const base = useMat('sand', {tint: SAND});
  const m = useMemo(() => {
    const mm = base.clone();
    macroShader(mm, 'moundMacro');
    return mm;
  }, [base]);
  const geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(170, 170, 200, 220);
    g.rotateX(-Math.PI / 2);
    g.translate(0, 0, -285);
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / 7, p.getZ(i) / 7);
    return g;
  }, []);
  const p = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    p.setY(i, NEW[1] - 1.0 + Math.max(0, moundH(x, z)) * hill);
  }
  p.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  const domeG = useMemo(() => {
    const g = new THREE.CylinderGeometry(22, 22, 54, 40, 6, true, Math.PI / 2, Math.PI);
    g.rotateX(Math.PI / 2);
    g.translate(0, 0, -27);
    return worldUV(g, 5);
  }, []);
  const ribs = useMemo(() => Array.from({length: 10}, (_, i) => -2 - i * 5.6), []);
  return (
    <group>
      {dome > 0.001 && (
        <group position={[NEW[0], NEW[1], NEW[2] - 3]} scale={[1, 1, Math.max(0.01, dome)]}>
          <mesh geometry={domeG} material={conc} castShadow receiveShadow />
          {ribs.map((z, i) => (
            <mesh key={i} position={[0, 0, z]} material={conc} castShadow>
              <torusGeometry args={[22.3, 0.7, 6, 40, Math.PI]} />
            </mesh>
          ))}
        </group>
      )}
      {hill > 0.001 && <mesh geometry={geo} material={m} castShadow receiveShadow />}
    </group>
  );
};

// ============================================================ machines
const Strut: React.FC<{a: [number, number, number]; b: [number, number, number]; r: number; m: THREE.Material}> = ({a, b, r, m}) => {
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
  const mid = va.clone().add(vb).multiplyScalar(0.5);
  const len = va.distanceTo(vb);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
  return (
    <mesh position={mid} quaternion={q} material={m} castShadow>
      <boxGeometry args={[r * 2, len, r * 2]} />
    </mesh>
  );
};

const PIV: [number, number] = [1.4, 3.6];
type CraneAim = {rotY: number; a: number; L: number};
/** aim a crawler crane standing at `pos` so its boom tip is at `tip` */
const aimCrane = (pos: [number, number, number], tip: [number, number, number]): CraneAim => {
  const dx = tip[0] - pos[0], dz = tip[2] - pos[2];
  const rotY = Math.atan2(-dz, dx);
  const horiz = Math.hypot(dx, dz) - PIV[0];
  const vert = tip[1] - pos[1] - PIV[1];
  return {rotY, a: Math.atan2(vert, horiz), L: Math.hypot(horiz, vert)};
};

/** 1960s crawler crane with a lattice boom. Cable hangs from the tip down to world height `hookY`. */
const Crane: React.FC<{pos: [number, number, number]; aim: CraneAim; hookY: number}> = ({pos, aim, hookY}) => {
  const paint = usePlainMat('#e0a52a', 0.5, 0.35);
  const steel = useMat('steel', {tint: '#e3a62c', metalness: 0.4, roughness: 0.6});
  const dark = usePlainMat('#2a2622', 0.8, 0.3);
  const glass = usePlainMat('#1d2730', 0.15, 0.6);
  const {rotY, a, L} = aim;
  const n = Math.max(4, Math.round(L / 4));
  const ch = (t: number) => {
    const w = 0.85 * (1 - t) + 0.3 * t, h = 0.75 * (1 - t) + 0.3 * t;
    return [[0, h, w], [0, h, -w], [0, -h, w], [0, -h, -w]].map(([_, y, z]) => [t * L, y, z] as [number, number, number]);
  };
  const tipLocal: [number, number, number] = [PIV[0] + L * Math.cos(a), PIV[1] + L * Math.sin(a), 0];
  const drop = Math.max(1, pos[1] + tipLocal[1] - hookY);
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[0, 0.65, s * 2.0]} material={dark} castShadow receiveShadow>
          <boxGeometry args={[7.2, 1.3, 1.3]} />
        </mesh>
      ))}
      <mesh position={[-0.8, 2.4, 0]} material={paint} castShadow>
        <boxGeometry args={[5.2, 2.2, 3.6]} />
      </mesh>
      <mesh position={[-3.5, 2.7, 0]} material={paint} castShadow>
        <boxGeometry args={[1.4, 1.8, 3.4]} />
      </mesh>
      <mesh position={[1.1, 3.9, 1.3]} material={paint} castShadow>
        <boxGeometry args={[1.8, 1.9, 1.3]} />
      </mesh>
      <mesh position={[1.75, 4.1, 1.3]} material={glass}>
        <boxGeometry args={[0.6, 1.0, 1.1]} />
      </mesh>
      <Strut a={[-2.2, 3.5, 0.9]} b={[-1.4, 7.6, 0]} r={0.12} m={paint} />
      <Strut a={[-2.2, 3.5, -0.9]} b={[-1.4, 7.6, 0]} r={0.12} m={paint} />
      <group position={[PIV[0], PIV[1], 0]} rotation={[0, 0, a]}>
        {[0, 1, 2, 3].map((k) => (
          <Strut key={k} a={ch(0)[k]} b={ch(1)[k]} r={0.13} m={steel} />
        ))}
        {Array.from({length: n}, (_, i) => {
          const c0 = ch(i / n), c1 = ch((i + 1) / n);
          return (
            <React.Fragment key={i}>
              <Strut a={c0[0]} b={c1[1]} r={0.06} m={steel} />
              <Strut a={c0[2]} b={c1[3]} r={0.06} m={steel} />
              <Strut a={c0[0]} b={c1[2]} r={0.06} m={steel} />
              <Strut a={c0[1]} b={c1[3]} r={0.06} m={steel} />
            </React.Fragment>
          );
        })}
      </group>
      <Rope a={[-1.4, 7.6, 0]} b={tipLocal} sag={0.01} r={0.05} color="#333" />
      <Rope a={tipLocal} b={[tipLocal[0], tipLocal[1] - drop + 0.8, 0]} sag={0} r={0.05} color="#222" />
      <mesh position={[tipLocal[0], tipLocal[1] - drop + 0.5, 0]} material={dark} castShadow>
        <boxGeometry args={[0.6, 0.9, 0.4]} />
      </mesh>
    </group>
  );
};
const craneTip = (pos: [number, number, number], aim: CraneAim): [number, number, number] => {
  const lx = PIV[0] + aim.L * Math.cos(aim.a);
  return [pos[0] + lx * Math.cos(aim.rotY), pos[1] + PIV[1] + aim.L * Math.sin(aim.a), pos[2] - lx * Math.sin(aim.rotY)];
};

/** A sawn sandstone block (with its painted number band). */
const Block: React.FC<{p: [number, number, number]; s?: [number, number, number]; rotY?: number}> = ({p, s = [3.0, 2.4, 2.4], rotY = 0}) => {
  const m = useMat('stone_face_sand', {tint: STONE});
  const paint = usePlainMat('#f4f1ea', 0.8);
  const g = useMemo(() => uvBox(s[0], s[1], s[2], 2.5), [s[0], s[1], s[2]]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <group position={p} rotation={[0, rotY, 0]}>
      <mesh geometry={g} material={m} castShadow receiveShadow />
      <mesh position={[0, s[1] * 0.18, s[2] / 2 + 0.01]} material={paint}>
        <planeGeometry args={[s[0] * 0.45, s[1] * 0.16]} />
      </mesh>
    </group>
  );
};

/** Flatbed truck facing +x (local), `dist` drives the wheel rotation. */
const Truck: React.FC<{p: [number, number, number]; rotY: number; dist: number; load?: 'block' | 'rubble'; color?: string}> = ({p, rotY, dist, load = 'block', color = '#6f8a6a'}) => {
  const body = usePlainMat(color, 0.55, 0.2);
  const dark = usePlainMat('#1d1b19', 0.85);
  const glass = usePlainMat('#25313a', 0.15, 0.5);
  const rub = useMat('gravel', {tint: '#b58d5f'});
  return (
    <group position={p} rotation={[0, rotY, 0]}>
      <mesh position={[0, 1.2, 0]} material={dark} castShadow>
        <boxGeometry args={[8, 0.5, 2.0]} />
      </mesh>
      <mesh position={[3.1, 2.45, 0]} material={body} castShadow>
        <boxGeometry args={[2.0, 2.3, 2.4]} />
      </mesh>
      <mesh position={[3.9, 1.95, 0]} material={body} castShadow>
        <boxGeometry args={[1.0, 1.3, 2.3]} />
      </mesh>
      <mesh position={[3.6, 3.0, 0]} material={glass}>
        <boxGeometry args={[1.05, 0.8, 2.2]} />
      </mesh>
      <mesh position={[-1.0, 1.6, 0]} material={body} castShadow receiveShadow>
        <boxGeometry args={[5.8, 0.35, 2.5]} />
      </mesh>
      {[3.0, -1.4, -3.0].map((x) =>
        [-1.15, 1.15].map((z) => (
          <mesh key={x + '_' + z} position={[x, 0.55, z]} rotation={[Math.PI / 2, 0, -dist / 0.55]} material={dark} castShadow>
            <cylinderGeometry args={[0.55, 0.55, 0.45, 14]} />
          </mesh>
        )),
      )}
      {load === 'block' && <Block p={[-1.1, 2.97, 0]} s={[3.0, 2.4, 2.2]} />}
      {load === 'rubble' && (
        <mesh position={[-1.1, 2.1, 0]} scale={[2.6, 0.9, 1.1]} material={rub} castShadow>
          <sphereGeometry args={[1, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
        </mesh>
      )}
    </group>
  );
};

/** Drive along a straight line (no sliding): returns props for <Truck/> or <Dozer/>. */
const drive = (start: [number, number, number], heading: number, f: number, speed: number, ground: (x: number, z: number) => number) => {
  const d = (speed * f) / 30;
  const x = start[0] + Math.cos(heading) * d, z = start[2] - Math.sin(heading) * d;
  return {p: [x, ground(x, z), z] as [number, number, number], rotY: heading, dist: d};
};

const Dozer: React.FC<{p: [number, number, number]; rotY: number}> = ({p, rotY}) => {
  const body = usePlainMat('#d99a22', 0.5, 0.3);
  const dark = usePlainMat('#22201d', 0.85);
  const blade = useMat('steel', {tint: '#8d8a85', metalness: 0.5, roughness: 0.5});
  return (
    <group position={p} rotation={[0, rotY, 0]}>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[0, 0.5, s * 1.1]} material={dark} castShadow>
          <boxGeometry args={[4.2, 1.0, 0.7]} />
        </mesh>
      ))}
      <mesh position={[-0.3, 1.65, 0]} material={body} castShadow>
        <boxGeometry args={[3.2, 1.4, 1.8]} />
      </mesh>
      <mesh position={[-0.9, 3.0, 0]} material={body} castShadow>
        <boxGeometry args={[1.3, 1.3, 1.6]} />
      </mesh>
      <mesh position={[0.5, 2.7, 0.5]} material={dark}>
        <cylinderGeometry args={[0.08, 0.08, 1.4, 6]} />
      </mesh>
      <mesh position={[2.45, 0.8, 0]} material={blade} castShadow>
        <boxGeometry args={[0.3, 1.4, 3.1]} />
      </mesh>
    </group>
  );
};

/** Nile sailing boat (felucca), facing +x. */
const Felucca: React.FC<{p: [number, number, number]; rotY?: number}> = ({p, rotY = 0}) => {
  const hull = useMat('wood_oak', {tint: '#c9a27a'});
  const sail = useMat('linen', {tint: '#fbf6ea', side: THREE.DoubleSide});
  const sailG = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(0.2, 1.2);
    s.lineTo(1.2, 9.5);
    s.lineTo(-5.8, 1.6);
    s.closePath();
    return worldUV(new THREE.ShapeGeometry(s), 2);
  }, []);
  return (
    <group position={p} rotation={[0, rotY, 0]}>
      <mesh scale={[3.6, 0.9, 1.1]} material={hull} castShadow>
        <sphereGeometry args={[1, 18, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2]} />
      </mesh>
      <mesh position={[0.4, 3.4, 0]} material={hull} castShadow>
        <cylinderGeometry args={[0.07, 0.09, 6.8, 6]} />
      </mesh>
      <mesh geometry={sailG} position={[0.3, 0, 0]} material={sail} castShadow />
    </group>
  );
};

/** Flat water (river / lake) with animated normals. */
const Lake: React.FC<{y: number; z0: number; time: number; opacity?: number; color?: string}> = ({y, z0, time, opacity = 0.9, color = '#3c8fb0'}) => {
  const d = 1400 - z0;
  const m = useMat('water', {repeat: [1600 / 9, d / 9], roughness: 0.08, metalness: 0.1, tint: color, normalScale: 0.7, envMapIntensity: 1.3, transparent: true, opacity});
  m.normalMap!.offset.set(time * 0.02, time * 0.013);
  m.map!.offset.set(time * 0.01, 0);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, y, z0 + d / 2]} material={m} receiveShadow>
      <planeGeometry args={[1600, d]} />
    </mesh>
  );
};

// ============================================================ world dressing
const palms = (() => {
  const out: {p: [number, number, number]; s: number; seed: number}[] = [];
  for (let i = 0; out.length < 14 && i < 400; i++) {
    const x = (rnd(i * 3.7) - 0.5) * 300;
    const z = 6 + rnd(i * 5.3) * 18;
    if (Math.abs(x) < 48) continue;
    out.push({p: [x, H(x, z), z], s: 1.0 + rnd(i) * 0.5, seed: i});
  }
  return out;
})();
const rocks = Array.from({length: 26}, (_, i) => {
  const x = (rnd(i * 9.1) - 0.5) * 520;
  const z = -30 - rnd(i * 4.3) * 300;
  return {p: [x, H(x, z) - 0.4, z] as [number, number, number], s: [2 + rnd(i) * 3, 1 + rnd(i + 2) * 1.5, 2 + rnd(i + 4) * 2.5] as [number, number, number], seed: i + 3};
}).filter((r) => !(Math.abs(r.p[0]) < 75 && r.p[2] < -130 && r.p[2] > -300) && !(Math.abs(r.p[0]) < 50 && r.p[2] > -85));

const CLIFF_ROCKS = Array.from({length: 18}, (_, i) => {
  const sd = i % 2 ? 1 : -1;
  const x = sd * (47 + rnd(i * 3.3) * 50);
  const z = -2.5 - rnd(i * 1.7) * 4;
  return {p: [x, 4 + rnd(i * 5.1) * 26, z] as [number, number, number], s: [3 + rnd(i) * 4, 2.5 + rnd(i + 1) * 3, 2 + rnd(i + 2) * 2] as [number, number, number], seed: 90 + i};
});
const Land: React.FC<{f: number; water?: number; lakeOpacity?: number; palmsOn?: boolean; z0?: number}> = ({f, water = RIVER_Y, lakeOpacity = 0.9, palmsOn = true, z0}) => (
  <group>
    <Terrain height={H} size={1300} seg={300} tex="sand" texScale={7} center={[0, -150]} tint={SAND} steep={[0.3, 0.18, 0.1]} matte />
    <Lake y={water} z0={z0 ?? (water > 10 ? -90 : 30)} time={f / 30} opacity={lakeOpacity} />
    {palmsOn && water < 10 && palms.map((p, i) => <PalmTree key={i} position={p.p} scale={p.s} seed={p.seed} />)}
    {rocks.map((r, i) => (
      <Rock key={i} position={r.p} scale={r.s} seed={r.seed} tex="stone_face_sand" />
    ))}
    {water < 30 && CLIFF_ROCKS.map((r, i) => <Rock key={'c' + i} position={r.p} scale={r.s} seed={r.seed} tex="stone_face_sand" />)}
  </group>
);

const Atmos: React.FC<{f: number; golden?: number; shadow?: number; target?: [number, number, number]; res?: number}> = ({f, golden = 0, shadow = 70, target = [0, 12, 0], res = 4096}) => {
  const sunDir: [number, number, number] = [0.72 - 0.12 * golden, 0.62 - 0.32 * golden, 0.48 + 0.27 * golden];
  const sunCol = new THREE.Color('#fff0d8').lerp(new THREE.Color('#ffb768'), golden).getStyle();
  const hor = new THREE.Color('#dcdcd4').lerp(new THREE.Color('#f3c995'), golden).getStyle();
  return (
    <>
      <Renderer exposure={0.94 + 0.08 * golden} envIntensity={0.5} />
      <SkyDome top={golden ? '#3463b0' : '#1c5cc2'} horizon={hor} bottom="#c9a77a" sunDir={sunDir} sunColor={sunCol} clouds={0.18} time={f / 30} />
      <Sun dir={sunDir} intensity={3.3} color={sunCol} shadowSize={shadow} shadowRes={res} target={target} skyColor="#bcd4f0" groundColor="#c19a68" />
      <fog attach="fog" args={[hor, 380, 1200]} />
    </>
  );
};

// ============================================================ shared stage + labels
const Stage: React.FC<{cam: Cam; children: React.ReactNode; bg?: string; grade?: number}> = ({cam, children, bg = '#c9d9ea', grade = 0.3}) => {
  const {width, height} = useVideoConfig();
  return (
    <AbsoluteFill style={{background: bg}}>
      <ThreeCanvas width={width} height={height} shadows camera={{fov: cam.fov, near: 0.3, far: 3000}}>
        <AssetProvider textures={TEXTURES} hdri="quarry_01_1k">
          <CameraRig pos={cam.pos} target={cam.target} fov={cam.fov} />
          {children}
        </AssetProvider>
      </ThreeCanvas>
      <Grade strength={grade} />
    </AbsoluteFill>
  );
};

const Pin: React.FC<{p: [number, number, number]; cam: Cam; text: string; delay: number; dx?: number; dy?: number; size?: number; anchor?: 'left' | 'right' | 'center'; red?: boolean}> = ({p, cam, text, delay, dx = 0, dy = 0, size = 50, anchor = 'center', red}) => {
  const [x, y, vis] = toScreen(p, cam);
  if (!vis) return null;
  const w = text.length * size * 0.56 + size * 0.9;
  let lx = x + dx;
  const left = anchor === 'left' ? lx : anchor === 'right' ? lx - w : lx - w / 2;
  if (left < 36) lx += 36 - left;
  if (left + w > 1044) lx -= left + w - 1044;
  return <Tag text={text} x={lx} y={Math.min(1480, Math.max(440, y + dy))} delay={delay} size={size} anchor={anchor} bg={red ? C.red : undefined} fg={red ? C.white : undefined} />;
};

/** Worker standing on the terrain. */
const W: React.FC<{x: number; z: number; rotY: number; pose: 'hammer' | 'chisel' | 'point' | 'stand' | 'carry' | 'pull'; f: number; seed: number; y?: number; outfit?: string}> = ({x, z, rotY, pose, f, seed, y, outfit}) => (
  <Person position={[x, y ?? H(x, z), z]} rotY={rotY} pose={pose} t={f * 0.2 + seed} seed={seed} head="hardhat" headColor={seed % 3 ? '#f2f0ea' : '#f2b705'} outfit={outfit ?? ['#c9b48e', '#8f6d4a', '#e9e0cc', '#7c8b9c'][seed % 4]} pants="#4b4238" />
);

/** Temporary cofferdam in front of the temple; k = 0..1 built height (base on the riverbed at y = -6). */
const Cofferdam: React.FC<{k: number}> = ({k}) => {
  const m = useMat('gravel', {tint: '#c39a6c'});
  const top = useMat('dirt', {tint: '#c7a179'});
  const g = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(22, 0);
    s.lineTo(35, 18);
    s.lineTo(42, 18);
    s.lineTo(56, 0);
    s.closePath();
    const ge = new THREE.ExtrudeGeometry(s, {depth: 360, bevelEnabled: false});
    ge.rotateY(-Math.PI / 2);
    ge.translate(180, 0, 0);
    return worldUV(ge, 4);
  }, []);
  const tg = useMemo(() => uvBox(360, 0.2, 7, 4), []);
  if (k <= 0.001) return null;
  return (
    <group position={[0, -6, 0]} scale={[1, k, 1]}>
      <mesh geometry={g} material={m} castShadow receiveShadow />
      <mesh geometry={tg} position={[0, 18.05, 38.5]} material={top} receiveShadow />
    </group>
  );
};
const damTop = (k: number) => -6 + 18 * k; // world y of the crest

/** Yellow arrow drawn progressively from a to b (t = 0..1). */
const Arrow: React.FC<{a: [number, number, number]; b: [number, number, number]; t: number}> = ({a, b, t}) => {
  const m = usePlainMat('#ffc928', 0.4, 0, {emissive: new THREE.Color('#ffb000'), emissiveIntensity: 0.9});
  if (t <= 0.001) return null;
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
  const end = va.clone().lerp(vb, t);
  const dir = vb.clone().sub(va).normalize();
  const len = va.distanceTo(end);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  const mid = va.clone().add(end).multiplyScalar(0.5);
  return (
    <group>
      <mesh position={mid} quaternion={q} material={m}>
        <cylinderGeometry args={[0.9, 0.9, len, 10]} />
      </mesh>
      <mesh position={end} quaternion={q} material={m}>
        <coneGeometry args={[2.6, 6, 14]} />
      </mesh>
    </group>
  );
};

// ============================================================ S1 hook
const S1: React.FC = () => {
  const f = useCurrentFrame();
  const cam = groundSafe(camPath(f, [
    {t: 0, pos: [13, 3, 44], target: [0, 15.5, 0], fov: 54},
    {t: LEN[0], pos: [-30, 32, 128], target: [0, 15, 0], fov: 46},
  ]), H);
  return (
    <>
      <Stage cam={cam}>
        <Atmos f={f} />
        <Land f={f} />
        <Fill level={99} />
        <Temple at={[0, 0, 0]} />
        <Felucca p={[-60 + f * 0.12, RIVER_Y, 92]} />
        <Felucca p={[70 - f * 0.08, RIVER_Y, 130]} rotY={Math.PI} />
        <Person {...walkAlong([-26, 0, 17], 0, f, 1.2, H)} seed={11} head="cloth" outfit="#efe8da" />
        <Person {...walkAlong([-28.5, 0, 18.2], 0, f + 6, 1.2, H)} seed={12} head="cloth" outfit="#7c8b9c" />
      </Stage>
      <Headline top="ABU SIMBEL, EGYPT" big="MOVED 65 M UP" sub="...in over 1,000 pieces" delay={4} y={150} bigSize={130} />
    </>
  );
};

// ============================================================ S2 the problem: the new lake
const S2: React.FC = () => {
  const f = useCurrentFrame();
  const L = LEN[1];
  const lvl = RIVER_Y + (LAKE_Y - RIVER_Y) * ramp(f, L * 0.18, L * 0.8);
  const cam = groundSafe(camPath(f, [
    {t: 0, pos: [72, 66, 185], target: [0, 12, -15], fov: 48},
    {t: L, pos: [58, 80, 168], target: [0, 14, -20], fov: 48},
  ]), H);
  return (
    <>
      <Stage cam={cam}>
        <Atmos f={f} shadow={120} target={[0, 10, 0]} />
        <Land f={f} water={lvl} lakeOpacity={0.8} z0={-90} />
        <Fill level={99} />
        <Temple at={[0, 0, 0]} />
      </Stage>
      <Headline top="THE 1960s" big="A NEW LAKE" sub="behind the Aswan High Dam" delay={4} y={150} bigSize={130} />
      <Pin p={[0, 33, 0]} cam={cam} text="TEMPLE" delay={14} dy={-60} size={46} />
      <Sequence from={Math.round(L * 0.55)} layout="none">
        <Pin p={[-40, lvl, 60]} cam={cam} text="FUTURE WATER LEVEL" delay={0} size={46} red />
      </Sequence>
      <Caption text="The temple would end up underwater" delay={wordAt(1, 'The water')} bottom={330} />
    </>
  );
};

// ============================================================ S3 step 1: cofferdam
const S3: React.FC = () => {
  const f = useCurrentFrame();
  const L = LEN[2];
  const k = ramp(f, 4, L * 0.7);
  const wl = RIVER_Y + 5 * ramp(f, L * 0.45, L);
  const cam = groundSafe(camPath(f, [
    {t: 0, pos: [-78, 30, 102], target: [0, 7, 18], fov: 50},
    {t: L, pos: [-62, 37, 90], target: [0, 9, 16], fov: 50},
  ]), H);
  const dz = drive([-30, 0, 38.5], 0, f, 2.2, () => damTop(k));
  return (
    <>
      <Stage cam={cam}>
        <Atmos f={f} shadow={90} target={[0, 5, 15]} />
        <Land f={f} water={wl} />
        <Fill level={99} />
        <Temple at={[0, 0, 0]} />
        <Cofferdam k={k} />
        <Dozer p={dz.p} rotY={dz.rotY} />
        <Dust at={[dz.p[0] - 2.5, dz.p[1] + 0.4, dz.p[2]]} f={f} size={0.5} count={8} color="#c8a57c" />
        <Truck {...drive([-60, 0, 15], 0, f, 4.5, H)} load="rubble" />
        <Truck {...drive([-84, 0, 13], 0, f, 4.5, H)} load="rubble" color="#8a6f4e" />
        <W x={6} z={15} rotY={-1.9} pose="point" f={f} seed={21} />
        <W x={8} z={13.5} rotY={2.6} pose="stand" f={f} seed={22} />
        <W x={-12} z={18} rotY={0.4} pose="stand" f={f} seed={23} />
        <Felucca p={[30 - f * 0.05, wl, 110]} rotY={Math.PI} />
      </Stage>
      <StepBadge n={1} title="HOLD BACK THE NILE" delay={3} />
      <Pin p={[-35, damTop(k) + 1, 38]} cam={cam} text="TEMPORARY DAM" delay={Math.round(L * 0.35)} dy={-40} size={48} />
      <Pin p={[40, wl, 80]} cam={cam} text="NILE" delay={Math.round(L * 0.5)} size={48} />
      <Pin p={[12, 1, 14]} cam={cam} text="DRY WORK SITE" delay={wordAt(2, 'so the crews')} dy={80} size={48} />
    </>
  );
};

// ============================================================ S4 step 2: remove the mountain
const S4: React.FC = () => {
  const f = useCurrentFrame();
  const L = LEN[3];
  const level = 47 - 46.7 * ramp(f, 8, L - 22, Easing.inOut(Easing.quad));
  const cam = groundSafe(camPath(f, [
    {t: 0, pos: [-64, 84, -112], target: [0, 10, -22], fov: 50},
    {t: L, pos: [-52, 72, -100], target: [0, 6, -22], fov: 50},
  ]), H);
  const fillH = (x: number, z: number) => Math.max(H(x, z), Math.min(cliffT(x, z), level));
  const dozers = [
    drive([-40, 0, -30], 0, f, 1.0, fillH),
    drive([38, 0, -55], Math.PI, f, 1.0, fillH),
    drive([-36, 0, -62], 0.2, f, 0.9, fillH),
  ];
  return (
    <>
      <Stage cam={cam}>
        <Atmos f={f} shadow={90} target={[0, 5, -25]} res={2048} />
        <Land f={f} water={RIVER_Y + 5} />
        <Cofferdam k={1} />
        <Fill level={level} />
        <Temple at={[0, 0, 0]} shell />
        {dozers.map((d, i) => (
            <React.Fragment key={i}>
              <Dozer p={d.p} rotY={d.rotY} />
              <Dust at={[d.p[0] + Math.cos(d.rotY) * 2.8, d.p[1] + 0.4, d.p[2] - Math.sin(d.rotY) * 2.8]} f={f + i * 7} size={0.6} count={7} color="#d2ad80" />
            </React.Fragment>
          ))}
      </Stage>
      <StepBadge n={2} title="REMOVE THE ROCK" delay={3} />
      <Sequence durationInFrames={Math.round(L * 0.55)} layout="none">
        <Pin p={[-30, level, -50]} cam={cam} text="ROCK DUG AWAY" delay={14} size={48} />
      </Sequence>
      <Pin p={[0, 12.5, -14]} cam={cam} text="HALLS" delay={wordAt(3, 'until')} dy={-40} size={48} />
      <Pin p={[0, 7.5, -44]} cam={cam} text="SANCTUARY" delay={wordAt(3, 'carved')} dy={-40} size={48} />
    </>
  );
};

// ============================================================ S5 step 3: cut it up
const S5_CRANE: [number, number, number] = [27, 0, 21];
const S5_AIM = aimCrane(S5_CRANE, [5.6, 33.5, 2.3]);
const S5: React.FC = () => {
  const f = useCurrentFrame();
  const L = LEN[4];
  const cutTop = 33 - 33 * ramp(f, 6, L * 0.55, Easing.linear);
  const glow = ramp(f, 4, 14) * (1 - 0.7 * ramp(f, L * 0.55, L * 0.75));
  const lift = ramp(f, L * 0.62, L - 4, Easing.inOut(Easing.sin));
  const headOff: [number, number, number] = [0, lift * 7, lift * 2.5];
  const hookY = 23.6 + 6 * (1 - ramp(f, 0, L * 0.5)) + lift * 7;
  const cam = groundSafe(camPath(f, [
    {t: 0, pos: [27, 13, 44], target: [5.6, 14.5, 2], fov: 50},
    {t: L, pos: [23, 17, 49], target: [5.6, 19, 2], fov: 50},
  ]), H);
  const tip = craneTip(S5_CRANE, S5_AIM);
  const slung = f > L * 0.5;
  return (
    <>
      <Stage cam={cam}>
        <Atmos f={f} shadow={45} target={[5, 12, 3]} />
        <Land f={f} water={RIVER_Y + 5} />
        <Cofferdam k={1} />
        <Temple at={[0, 0, 0]} shell cut={{amt: 1, glow, top: cutTop}} headOff={headOff} />
        <Crane pos={S5_CRANE} aim={S5_AIM} hookY={hookY} />
        {slung &&
          [-1, 1].map((s) => (
            <Rope key={s} a={[tip[0], hookY + 0.1, tip[2]]} b={[5.6 + s * 1.5, 19.2 + headOff[1], 2.2 + headOff[2]]} sag={0} r={0.04} color="#2a2a2a" />
          ))}
        <ScaffoldBay position={[8.95, 1.2, 0.6]} w={1.35} d={4.2} h={18} levels={6} />
        <W x={9.4} z={2.6} y={13.25} rotY={Math.PI} pose="chisel" f={f} seed={31} />
        <W x={9.5} z={1.6} y={16.25} rotY={Math.PI} pose="chisel" f={f} seed={32} />
        <W x={9.5} z={3.8} y={7.25} rotY={Math.PI} pose="hammer" f={f} seed={33} />
        <Dust at={[8.8, 13.6, 2.6]} f={f} size={0.25} />
        <Dust at={[8.8, 16.6, 1.6]} f={f + 9} size={0.25} />
        {[0, 1, 2, 3, 4].map((i) => (
          <Block key={i} p={[12 + i * 3.4, 1.2, 16 + (i % 2) * 2.8]} rotY={rnd(i) * 0.2} />
        ))}
        <Block p={[13.7, 3.6, 16]} />
        <W x={18} z={13} rotY={2.5} pose="point" f={f} seed={34} />
        <W x={22} z={17} rotY={-2.4} pose="stand" f={f} seed={35} />
      </Stage>
      <StepBadge n={3} title="CUT IT UP" delay={3} />
      <Pin p={[5.6, 11.5, 4.6]} cam={cam} text="SAW CUTS" delay={wordAt(4, 'sawed')} dx={-40} size={48} anchor="right" />
      <Pin p={[17, 3.5, 17]} cam={cam} text="NUMBERED BLOCKS" delay={wordAt(4, 'numbered')} dy={30} size={46} />
      <Sequence from={Math.round(L * 0.66)} layout="none">
        <Pin p={[5.6, 23 + headOff[1], 2.3]} cam={cam} text="UP TO 30 TONNES" delay={0} dx={-60} size={48} anchor="right" />
      </Sequence>
      <Caption text="Over 1,000 blocks, cut by hand" delay={wordAt(4, 'more than')} bottom={300} />
    </>
  );
};

// ============================================================ S6 step 4: lift + move
const S6_CRANE: [number, number, number] = [-54, H(-54, -11), -11];
const S6_AIM = aimCrane(S6_CRANE, [-27, 52, 14]);
const ROUTE_START: [number, number, number] = [-40, 0, -30];
const ROUTE_HEAD = Math.atan2(135, 28);
const S6: React.FC = () => {
  const f = useCurrentFrame();
  const L = LEN[5];
  const rev = 15 - 10 * ramp(f, 0, L);
  const lift = ramp(f, 10, L * 0.75, Easing.inOut(Easing.sin));
  const hookY = 2.6 + lift * 42;
  const cam = groundSafe(camPath(f, [
    {t: 0, pos: [-62, 168, 178], target: [-8, 28, -92], fov: 48},
    {t: L, pos: [-55, 158, 168], target: [-8, 30, -96], fov: 48},
  ]), H);
  const arrowV = ramp(f, wordAt(5, 'sixty'), wordAt(5, 'sixty') + 30);
  const arrowH = ramp(f, wordAt(5, 'two hundred'), wordAt(5, 'two hundred') + 30);
  return (
    <>
      <Stage cam={cam}>
        <Atmos f={f} shadow={200} target={[0, 30, -95]} />
        <Land f={f} water={RIVER_Y + 5} />
        <Cofferdam k={1} />
        <Temple at={[0, 0, 0]} rev={rev} cut={{amt: 1, glow: 0.2, top: -5}} />
        <Temple at={NEW} rev={2 + 4 * ramp(f, 0, L)} cut={{amt: 1, glow: 0, top: -5}} shell />
        <Crane pos={S6_CRANE} aim={S6_AIM} hookY={hookY + 1.4} />
        <Block p={[craneTip(S6_CRANE, S6_AIM)[0], hookY, craneTip(S6_CRANE, S6_AIM)[2]]} />
        {[0, 48, 96].map((d0, i) => {
          const tr = drive(ROUTE_START, ROUTE_HEAD, f + (d0 / 5.5) * 30, 5.5, H);
          return <Truck key={i} {...tr} color={i % 2 ? '#8a6f4e' : '#6f8a6a'} />;
        })}
        {[0, 1, 2, 3].map((i) => (
          <Block key={i} p={[-30 + i * 3.4, 1.2, 15 + (i % 2) * 2.6]} />
        ))}
        <Crane pos={S7_CRANE} aim={S7_AIM} hookY={96.4} />
        <Block p={[craneTip(S7_CRANE, S7_AIM)[0], 95, craneTip(S7_CRANE, S7_AIM)[2]]} />
        <W x={-27} z={10} rotY={1.2} pose="point" f={f} seed={41} />
        <W x={-22} z={12} rotY={2.2} pose="stand" f={f} seed={42} />
        <Arrow a={[26, 0, 4]} b={[26, 65, 4]} t={arrowV} />
        <Arrow a={[26, 65, 4]} b={[26, 65, -200]} t={arrowH} />
      </Stage>
      <StepBadge n={4} title="LIFT IT UP" delay={3} />
      <Pin p={[-27, hookY + 2, 14]} cam={cam} text="CRANE LIFT" delay={16} dx={-30} size={44} anchor="right" />
      <Pin p={[NEW[0], NEW[1] + 8, NEW[2]]} cam={cam} text="NEW SITE" delay={Math.round(L * 0.3)} dy={-60} size={46} />
      <Sequence from={wordAt(5, 'sixty')} layout="none">
        <Pin p={[26, 32, 4]} cam={cam} text="65 M HIGHER" delay={10} dx={50} size={52} anchor="left" />
      </Sequence>
      <Sequence from={wordAt(5, 'two hundred')} layout="none">
        <Pin p={[26, 65, -100]} cam={cam} text="200 M BACK" delay={10} dx={50} size={52} anchor="left" />
      </Sequence>
    </>
  );
};

// ============================================================ S7 rebuild + dome + artificial hill
const S7_CRANE: [number, number, number] = [-42, 65, -172];
const S7_AIM = aimCrane(S7_CRANE, [-9, 101, -195]);
const S7: React.FC = () => {
  const f = useCurrentFrame();
  const L = LEN[6];
  const rev = 6 + 28 * ramp(f, 0, L * 0.42, Easing.inOut(Easing.quad));
  const dome = ramp(f, wordAt(6, 'giant') - 8, wordAt(6, 'giant') + 40);
  const hill = ramp(f, wordAt(6, 'covered') - 6, L - 10);
  const cam = groundSafe(camPath(f, [
    {t: 0, pos: [46, 90, -118], target: [0, 80, -222], fov: 52},
    {t: L, pos: [58, 110, -104], target: [-2, 84, -232], fov: 52},
  ]), H);
  const tip = craneTip(S7_CRANE, S7_AIM);
  const hookY = 95 - 12 * ramp(f, 0, L * 0.5);
  return (
    <>
      <Stage cam={cam}>
        <Atmos f={f} shadow={90} target={[0, 75, -215]} />
        <Land f={f} water={RIVER_Y + 5} />
        <Temple at={NEW} rev={rev} cut={{amt: 1, glow: 0, top: -5}} shell />
        <NewHill dome={dome} hill={hill} />
        <Crane pos={S7_CRANE} aim={S7_AIM} hookY={hookY + 1.4} />
        <Block p={[tip[0], hookY, tip[2]]} />
        <W x={-24} z={-178} rotY={0.6} pose="point" f={f} seed={51} />
        <W x={-12} z={-182} rotY={0.5} pose="stand" f={f} seed={52} />
        <W x={-16} z={-179} rotY={-0.6} pose="carry" f={f} seed={53} />
        <Truck {...drive([-60, 0, -172], 0.05, f, 3, H)} />
      </Stage>
      <StepBadge n={5} title="REBUILD + COVER" delay={3} />
      <Sequence durationInFrames={wordAt(6, 'concrete') - 3} layout="none">
        <Pin p={[-8, 65 + Math.min(rev, 31) - 2, -199]} cam={cam} text="PIECE BY PIECE" delay={12} size={46} anchor="right" />
      </Sequence>
      <Sequence from={wordAt(6, 'concrete')} durationInFrames={Math.max(1, wordAt(6, 'artificial') - 2 - wordAt(6, 'concrete'))} layout="none">
        <Pin p={[0, 65 + 25, -240]} cam={cam} text="CONCRETE DOME" delay={0} dy={-40} size={50} />
      </Sequence>
      <Sequence from={wordAt(6, 'artificial')} layout="none">
        <Pin p={[-30, 65 + 30 * hill, -250]} cam={cam} text="ARTIFICIAL HILL" delay={0} dy={-50} size={50} />
      </Sequence>
    </>
  );
};

// ============================================================ S8 the sun alignment (inside the temple)
const Interior: React.FC<{beam: number; lit: number}> = ({beam, lit}) => {
  const wall = useMat('stone_face_sand', {tint: '#d9ab78'});
  const floor = useMat('stone_face_sand', {tint: '#b98d60'});
  const stone = useMat('stone_face_sand', {tint: STONE});
  const dark = usePlainMat('#140d07', 1);
  const mats = useMemo(() => ({stone, dark}), [stone, dark]);
  const beamM = useMemo(() => new THREE.MeshBasicMaterial({color: '#ffbf6a', transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false}), []);
  beamM.opacity = 0.17 * Math.min(1, beam * 4);
  const spot = useMemo(() => new THREE.SpotLight('#ffcf8a', 0, 0, 0.026, 0.35, 0), []);
  spot.intensity = 6 * lit;
  const a = new THREE.Vector3(0, 4.4, 30), b = new THREE.Vector3(0, 1.7, -40);
  const end = a.clone().lerp(b, Math.max(0.001, beam));
  const len = a.distanceTo(end);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  const mid = a.clone().add(end).multiplyScalar(0.5);
  const osiris = [-17.5, -13, -8.5, -4];
  return (
    <group>
      <B s={[18, 0.4, 54]} p={[0, -0.2, -26]} m={floor} ts={3} />
      {/* hall 1 */}
      {[-1, 1].map((sd) => (
        <B key={sd} s={[1, 9, 19]} p={[sd * 8.5, 4.5, -9.5]} m={wall} ts={3} />
      ))}
      <B s={[18, 1, 19]} p={[0, 9.5, -9.5]} m={wall} ts={3} />
      <B s={[6, 9, 1]} p={[-5, 4.5, 0.5]} m={wall} ts={3} />
      <B s={[6, 9, 1]} p={[5, 4.5, 0.5]} m={wall} ts={3} />
      <B s={[4, 1.5, 1]} p={[0, 8.25, 0.5]} m={wall} ts={3} />
      <B s={[6, 9, 1]} p={[-5, 4.5, -19.5]} m={wall} ts={3} />
      <B s={[6, 9, 1]} p={[5, 4.5, -19.5]} m={wall} ts={3} />
      <B s={[4, 3.5, 1]} p={[0, 7.25, -19.5]} m={wall} ts={3} />
      {osiris.map((z) =>
        [-1, 1].map((sd) => (
          <group key={z + '_' + sd}>
            <B s={[1.6, 9, 1.6]} p={[sd * 4.2, 4.5, z]} m={wall} ts={3} />
            <mesh position={[sd * 3.15, 3.6, z]} material={stone} castShadow>
              <cylinderGeometry args={[0.45, 0.6, 6.0, 10]} />
            </mesh>
            <mesh position={[sd * 3.15, 7.0, z]} material={stone} castShadow>
              <sphereGeometry args={[0.42, 12, 10]} />
            </mesh>
            <mesh position={[sd * 3.15, 8.1, z]} material={stone} castShadow>
              <cylinderGeometry args={[0.18, 0.4, 1.2, 10]} />
            </mesh>
          </group>
        )),
      )}
      {/* hall 2 */}
      {[-1, 1].map((sd) => (
        <B key={sd} s={[1, 6, 11]} p={[sd * 6, 3, -25]} m={wall} ts={3} />
      ))}
      <B s={[13, 1, 11]} p={[0, 6.5, -25]} m={wall} ts={3} />
      {[-22.5, -27.5].map((z) => [-1, 1].map((sd) => <B key={z + '_' + sd} s={[1.4, 6, 1.4]} p={[sd * 2.7, 3, z]} m={wall} ts={3} />))}
      <B s={[4, 6, 1]} p={[-3.5, 3, -30.5]} m={wall} ts={3} />
      <B s={[4, 6, 1]} p={[3.5, 3, -30.5]} m={wall} ts={3} />
      <B s={[3, 2, 1]} p={[0, 5, -30.5]} m={wall} ts={3} />
      {/* sanctuary */}
      {[-1, 1].map((sd) => (
        <B key={sd} s={[1, 4.5, 10]} p={[sd * 4, 2.25, -36]} m={wall} ts={3} />
      ))}
      <B s={[9, 1, 10]} p={[0, 5, -36]} m={wall} ts={3} />
      <B s={[9, 4.5, 1]} p={[0, 2.25, -41.5]} m={wall} ts={3} />
      <B s={[7, 0.8, 1.6]} p={[0, 0.4, -40.1]} m={stone} ts={3} />
      {[-2.4, -0.8, 0.8, 2.4].map((x) => (
        <Colossus key={x} x={x} mats={mats} scale={0.105} z={-41} y={0} />
      ))}
      <primitive object={spot} position={[0, 4.4, 30]} />
      <primitive object={spot.target} position={[0, 1.4, -41]} />
      {beam > 0.001 && (
        <mesh position={mid} quaternion={q} material={beamM}>
          <cylinderGeometry args={[0.9, 1.15, len, 16, 1, true]} />
        </mesh>
      )}
    </group>
  );
};

const S8: React.FC = () => {
  const f = useCurrentFrame();
  const L = LEN[7];
  const beam = ramp(f, 6, L * 0.45, Easing.inOut(Easing.quad));
  const lit = ramp(f, L * 0.4, L * 0.55);
  const cam = camPath(f, [
    {t: 0, pos: [1.2, 5.6, -1.5], target: [0, 2.2, -40], fov: 46},
    {t: L, pos: [0.6, 3.0, -23], target: [0, 1.6, -41], fov: 40},
  ]);
  return (
    <>
      <Stage cam={cam} bg="#0e0b08" grade={0.5}>
        <Renderer exposure={1.05} envIntensity={0.07} />
        <ambientLight intensity={0.22} color="#ffd8a8" />
        <pointLight position={[0, 6, -6]} intensity={30} distance={40} decay={2} color="#ffb870" />
        <pointLight position={[0, 3.5, -34]} intensity={2 + 10 * lit} distance={14} decay={2} color="#ffc27a" />
        <fog attach="fog" args={['#120c07', 20, 90]} />
        <Interior beam={beam} lit={lit} />
      </Stage>
      <Headline top="TWICE A YEAR" big="FEB 22 · OCT 22" delay={4} y={150} bigSize={112} />
      <Caption text="One day later than before the move" delay={wordAt(7, 'just one')} bottom={300} />
    </>
  );
};

// ============================================================ S9 payoff
const S9: React.FC = () => {
  const f = useCurrentFrame();
  const L = LEN[8];
  const cam = groundSafe(camPath(f, [
    {t: 0, pos: [-52, 86, 62], target: [0, 75, -196], fov: 34},
    {t: L, pos: [-40, 81, 36], target: [0, 77, -197], fov: 33},
  ]), H, 3);
  return (
    <>
      <Stage cam={cam} bg="#f3c995">
        <Atmos f={f} golden={0.8} shadow={110} target={[0, 70, -200]} />
        <Land f={f} water={LAKE_Y} />
        <Temple at={NEW} cut={{amt: 0.5, glow: 0, top: -5}} shell />
        <NewHill dome={1} hill={1} />
        <Felucca p={[-14 + f * 0.08, LAKE_Y, -66]} />
        <Person {...walkAlong([-26, 0, -168], 0.15, f, 1.2, H)} seed={61} head="cloth" outfit="#efe8da" />
        <Person {...walkAlong([-29, 0, -166], 0.15, f + 8, 1.2, H)} seed={62} head="hat" outfit="#7c8b9c" />
      </Stage>
      <Headline top="1964 – 1968" big="$40 MILLION" sub="to save one temple" delay={4} y={150} bigSize={140} />
      <Caption text="Still high above the lake today" delay={wordAt(8, 'the temple')} bottom={330} />
    </>
  );
};

// ============================================================ timeline
const SCENES = [S1, S2, S3, S4, S5, S6, S7, S8, S9];

export const AbuSimbel: React.FC = () => (
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
        <Audio src={staticFile(`vo/ep009-abusimbel_${i}.wav`)} />
      </Sequence>
    ))}
    <Watermark />
  </AbsoluteFill>
);
export const ABUSIMBEL_START = START;
export const ABUSIMBEL_LEN = LEN;
