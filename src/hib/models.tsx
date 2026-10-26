// Detailed reusable models for "How It's Built" (v2 kit): people, vegetation, rocks, scaffolding, ropes, water, dust.
// Textured pieces require their textures to be listed in <AssetProvider> (see KIT_TEXTURES).
import React, {useMemo} from 'react';
import * as THREE from 'three';
import {TexName, useMat, usePlainMat, uvBox, worldUV} from './pbr';

export const KIT_TEXTURES: TexName[] = ['bark', 'wood_pine', 'wood_oak', 'linen'];

/** Deterministic pseudo-random in [0,1). */
export const rnd = (seed: number) => {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

// ---------------------------------------------------------------- people
export type Pose = 'stand' | 'walk' | 'pull' | 'push' | 'carry' | 'hammer' | 'haul' | 'point' | 'chisel';
const SKINS = ['#8d5a3b', '#a8693a', '#c68a5c', '#e0b08a', '#6e452c'];
const TUNICS = ['#e9e0cc', '#c9b48e', '#8f6d4a', '#7c8b9c', '#a2503a', '#6b7c4e'];

const Limb: React.FC<{len: number; r: number; mat: THREE.Material; rot: [number, number, number]; children?: React.ReactNode; pos?: [number, number, number]}> = ({len, r, mat, rot, children, pos = [0, 0, 0]}) => (
  <group position={pos} rotation={rot}>
    <mesh position={[0, -len / 2, 0]} material={mat} castShadow>
      <capsuleGeometry args={[r, len - r * 2, 4, 10]} />
    </mesh>
    <group position={[0, -len, 0]}>{children}</group>
  </group>
);

/**
 * Articulated person, ~1.75 m tall, facing +X. `t` = animation phase (radians, advance ~0.25/frame for walking).
 * `seed` picks skin/clothing. `outfit` and `head` override style.
 */
export const Person: React.FC<{
  position?: [number, number, number];
  rotY?: number;
  pose?: Pose;
  t?: number;
  seed?: number;
  scale?: number;
  outfit?: string;
  pants?: string;
  head?: 'cloth' | 'hair' | 'helmet' | 'hardhat' | 'hat';
  headColor?: string;
  /** Leg motion. 'walk' swings the legs — ONLY use it when the person really moves (see walkAlong) or walks on a treadmill/wheel.
   *  Default: 'walk' for pose walk, 'brace' (planted stance) for pull/push, 'still' for everything else. */
  legs?: 'walk' | 'brace' | 'still';
}> = ({position = [0, 0, 0], rotY = 0, pose = 'stand', t = 0, seed = 1, scale = 1, outfit, pants, head = 'hair', headColor, legs}) => {
  const skin = usePlainMat(SKINS[Math.floor(rnd(seed) * SKINS.length)], 0.65);
  const cloth = usePlainMat(outfit ?? TUNICS[Math.floor(rnd(seed + 7) * TUNICS.length)], 0.92);
  const leg = usePlainMat(pants ?? SKINS[Math.floor(rnd(seed) * SKINS.length)], pants ? 0.9 : 0.65);
  const dark = usePlainMat('#3a2a1e', 0.9);
  const hcol = usePlainMat(headColor ?? (head === 'hardhat' ? '#f2b705' : head === 'helmet' ? '#9a9da3' : head === 'cloth' ? '#efe6d2' : '#2b1d14'), head === 'helmet' ? 0.35 : 0.7, head === 'helmet' ? 0.8 : 0);

  const legMode = legs ?? (pose === 'walk' ? 'walk' : pose === 'pull' || pose === 'push' ? 'brace' : 'still');
  const walking = legMode === 'walk';
  const s = Math.sin(t);
  const legA = walking ? s * 0.55 : legMode === 'brace' ? 0.38 : 0;
  const kneeA = walking ? Math.max(0, -Math.cos(t)) * 0.7 : legMode === 'brace' ? 0.28 : 0;
  const kneeB = walking ? Math.max(0, Math.cos(t)) * 0.7 : legMode === 'brace' ? 0.05 : 0;
  const bob = walking ? Math.abs(Math.cos(t)) * 0.04 : 0;

  // torso lean (around Z, forward is +X) and arm angles [shoulder, elbow] for left/right (rotation about Z)
  let lean = 0;
  let armL: [number, number, number] = [0, 0, 0.1]; // shoulderZ, elbowZ, shoulderX (spread)
  let armR: [number, number, number] = [0, 0, -0.1];
  switch (pose) {
    case 'walk': armL = [-s * 0.5, 0.3, 0.08]; armR = [s * 0.5, 0.3, -0.08]; break;
    case 'pull': lean = 0.45; armL = [0.6, 0.2, 0.15]; armR = [0.8, 0.1, -0.15]; break;
    case 'push': lean = 0.55; armL = [1.45, 0.15, 0.12]; armR = [1.45, 0.15, -0.12]; break;
    case 'carry': lean = 0.05; armL = [2.7, 1.2, 0.3]; armR = [2.7, 1.2, -0.3]; break;
    case 'hammer': { const k = Math.abs(Math.sin(t)); lean = 0.25; armL = [0.9, 0.6, 0.2]; armR = [0.6 + 2.2 * (1 - k), 0.4, -0.2]; break; }
    case 'chisel': { const k = Math.abs(Math.sin(t * 2)); lean = 0.5; armL = [1.0, 0.5, 0.15]; armR = [1.2 + 0.6 * k, 0.6, -0.15]; break; }
    case 'haul': { lean = -0.05; armL = [2.6 + 0.4 * s, 0.3, 0.1]; armR = [2.6 - 0.4 * s, 0.3, -0.1]; break; }
    case 'point': armR = [1.5, 0.05, -0.3]; armL = [0.1, 0.2, 0.1]; break;
  }
  const holdHammer = pose === 'hammer' || pose === 'chisel';

  return (
    <group position={[position[0], position[1] + bob, position[2]]} rotation={[0, rotY, 0]} scale={scale}>
      {/* legs */}
      {[0.11, -0.11].map((z, i) => (
        <Limb key={z} pos={[0, 0.92, z]} len={0.46} r={0.075} mat={leg} rot={[0, 0, i === 0 ? legA : -legA]}>
          <Limb len={0.44} r={0.065} mat={leg} rot={[0, 0, -(i === 0 ? kneeA : kneeB)]}>
            <mesh position={[0.06, -0.03, 0]} material={dark} castShadow>
              <boxGeometry args={[0.24, 0.07, 0.11]} />
            </mesh>
          </Limb>
        </Limb>
      ))}
      {/* torso (leans from the hips) */}
      <group position={[0, 0.92, 0]} rotation={[0, 0, -lean]}>
        {/* tunic skirt + body */}
        <mesh position={[0, 0.02, 0]} material={cloth} castShadow>
          <cylinderGeometry args={[0.2, 0.27, 0.32, 14]} />
        </mesh>
        <mesh position={[0, 0.36, 0]} material={cloth} castShadow scale={[0.8, 1, 1]}>
          <capsuleGeometry args={[0.2, 0.3, 6, 14]} />
        </mesh>
        <mesh position={[0, 0.17, 0]} rotation={[Math.PI / 2, 0, 0]} material={dark} castShadow>
          <torusGeometry args={[0.19, 0.025, 6, 18]} />
        </mesh>
        {/* neck + head */}
        <mesh position={[0, 0.66, 0]} material={skin}>
          <cylinderGeometry args={[0.055, 0.065, 0.1, 10]} />
        </mesh>
        <group position={[0, 0.8, 0]}>
          <mesh material={skin} castShadow scale={[1, 1.12, 0.95]}>
            <sphereGeometry args={[0.12, 18, 14]} />
          </mesh>
          <mesh position={[0.115, -0.01, 0]} material={skin}>
            <sphereGeometry args={[0.025, 8, 6]} />
          </mesh>
          {head === 'hair' && (
            <mesh position={[-0.015, 0.035, 0]} material={hcol} scale={[1.04, 0.9, 1.04]}>
              <sphereGeometry args={[0.122, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55]} />
            </mesh>
          )}
          {head === 'cloth' && (
            <mesh position={[-0.01, 0.03, 0]} material={hcol} scale={[1.08, 0.95, 1.08]}>
              <sphereGeometry args={[0.125, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.62]} />
            </mesh>
          )}
          {(head === 'helmet' || head === 'hardhat') && (
            <group position={[0, 0.04, 0]}>
              <mesh material={hcol} castShadow>
                <sphereGeometry args={[0.135, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5]} />
              </mesh>
              <mesh position={[head === 'hardhat' ? 0.05 : 0, 0, 0]} material={hcol}>
                <cylinderGeometry args={[head === 'hardhat' ? 0.17 : 0.15, head === 'hardhat' ? 0.17 : 0.15, 0.015, 18]} />
              </mesh>
            </group>
          )}
          {head === 'hat' && (
            <group position={[0, 0.07, 0]}>
              <mesh material={hcol} castShadow>
                <cylinderGeometry args={[0.1, 0.12, 0.1, 14]} />
              </mesh>
              <mesh position={[0, -0.04, 0]} material={hcol}>
                <cylinderGeometry args={[0.22, 0.22, 0.012, 18]} />
              </mesh>
            </group>
          )}
        </group>
        {/* arms */}
        {[
          [0.24, armL],
          [-0.24, armR],
        ].map(([z, a], i) => {
          const [sh, el, sp] = a as [number, number, number];
          return (
            <group key={i} position={[0, 0.55, z as number]} rotation={[sp, 0, sh]}>
              <Limb len={0.3} r={0.06} mat={i === 0 ? cloth : cloth} rot={[0, 0, 0]}>
                <Limb len={0.28} r={0.05} mat={skin} rot={[0, 0, el]}>
                  <mesh material={skin} castShadow>
                    <sphereGeometry args={[0.055, 10, 8]} />
                  </mesh>
                  {holdHammer && i === 1 && (
                    <group rotation={[0, 0, -Math.PI / 2]}>
                      <mesh position={[0, 0.16, 0]} material={dark}>
                        <cylinderGeometry args={[0.018, 0.018, 0.36, 6]} />
                      </mesh>
                      <mesh position={[0, 0.34, 0]} material={dark}>
                        <boxGeometry args={[0.08, 0.08, 0.16]} />
                      </mesh>
                    </group>
                  )}
                </Limb>
              </Limb>
            </group>
          );
        })}
      </group>
    </group>
  );
};

/**
 * Position + phase for a person walking in a straight line (no moonwalking).
 * heading = rotY used for the Person (0 = +X). Returns {position, rotY, t} to spread into <Person/>.
 * speed ≈ 1.3 m/s normal walk; leg phase is derived from distance so feet don't slide.
 */
export const walkAlong = (start: [number, number, number], heading: number, f: number, speed = 1.3, groundY?: (x: number, z: number) => number) => {
  const d = (speed * f) / 30;
  const x = start[0] + Math.cos(heading) * d;
  const z = start[2] - Math.sin(heading) * d;
  return {position: [x, groundY ? groundY(x, z) : start[1], z] as [number, number, number], rotY: heading, t: d * 4.2, pose: 'walk' as Pose};
};

// ---------------------------------------------------------------- vegetation
const blobGeo = (seed: number, r: number, detail = 2, amp = 0.22) => {
  const g = new THREE.IcosahedronGeometry(r, detail);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = Math.sin(v.x * 3.1 + seed) * Math.sin(v.y * 2.7 + seed * 1.3) * Math.sin(v.z * 3.3 + seed * 0.7);
    // jitter keyed on position (not index) so shared corners move together -> no cracks
    const k = rnd(Math.round(v.x * 1000) * 0.131 + Math.round(v.y * 1000) * 0.173 + Math.round(v.z * 1000) * 0.197 + seed);
    v.multiplyScalar(1 + amp * n + amp * 0.5 * (k - 0.5));
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
};

/** Leafy deciduous tree (~6-8 m). */
export const Tree: React.FC<{position: [number, number, number]; scale?: number; seed?: number; leaf?: string}> = ({position, scale = 1, seed = 1, leaf = '#4f7a2e'}) => {
  const barkM = useMat('bark', {repeat: [1, 2]});
  const leafA = usePlainMat(leaf, 1, 0, {envMapIntensity: 0.5});
  const leafB = usePlainMat(new THREE.Color(leaf).offsetHSL(0.02, 0.05, 0.06).getStyle(), 1, 0, {envMapIntensity: 0.5});
  const blobs = useMemo(
    () =>
      Array.from({length: 7}, (_, i) => ({
        g: blobGeo(seed * 10 + i, 1.3 + rnd(seed + i) * 0.9),
        p: [(rnd(seed * 3 + i) - 0.5) * 2.6, 4.6 + rnd(seed * 5 + i) * 2.2, (rnd(seed * 7 + i) - 0.5) * 2.6] as [number, number, number],
      })),
    [seed],
  );
  return (
    <group position={position} scale={scale} rotation={[0, rnd(seed) * 6, 0]}>
      <mesh position={[0, 2.2, 0]} material={barkM} castShadow>
        <cylinderGeometry args={[0.18, 0.32, 4.4, 10]} />
      </mesh>
      {[0, 1, 2].map((i) => (
        <mesh key={i} position={[Math.cos(i * 2.1) * 0.5, 3.9, Math.sin(i * 2.1) * 0.5]} rotation={[Math.sin(i * 2.1) * 0.6, 0, -Math.cos(i * 2.1) * 0.6]} material={barkM} castShadow>
          <cylinderGeometry args={[0.07, 0.13, 1.8, 7]} />
        </mesh>
      ))}
      {blobs.map((b, i) => (
        <mesh key={i} geometry={b.g} position={b.p} material={i % 2 ? leafA : leafB} castShadow receiveShadow />
      ))}
    </group>
  );
};

/** Tall Mediterranean cypress (~9 m). */
export const Cypress: React.FC<{position: [number, number, number]; scale?: number; seed?: number}> = ({position, scale = 1, seed = 1}) => {
  const leaf = usePlainMat('#2f4f26', 1, 0, {envMapIntensity: 0.5});
  const leaf2 = usePlainMat('#3b5e2c', 1, 0, {envMapIntensity: 0.5});
  const barkM = useMat('bark', {repeat: [1, 1]});
  const blobs = useMemo(() => Array.from({length: 6}, (_, i) => blobGeo(seed * 13 + i, 1, 2, 0.18)), [seed]);
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, 0.6, 0]} material={barkM} castShadow>
        <cylinderGeometry args={[0.12, 0.18, 1.2, 8]} />
      </mesh>
      {blobs.map((g, i) => {
        const y = 1.6 + i * 1.25;
        const r = 0.95 * Math.sin(((i + 0.6) / 6.6) * Math.PI) + 0.25;
        return <mesh key={i} geometry={g} position={[0, y, 0]} scale={[r, 1.05, r]} material={i % 2 ? leaf : leaf2} castShadow />;
      })}
    </group>
  );
};

/** Pine/fir (~8 m). */
export const Pine: React.FC<{position: [number, number, number]; scale?: number; seed?: number}> = ({position, scale = 1, seed = 1}) => {
  const leaf = usePlainMat('#29452a', 0.9);
  const barkM = useMat('bark', {repeat: [1, 2]});
  return (
    <group position={position} scale={scale} rotation={[0, rnd(seed) * 6, 0]}>
      <mesh position={[0, 1.5, 0]} material={barkM} castShadow>
        <cylinderGeometry args={[0.12, 0.22, 3, 8]} />
      </mesh>
      {[0, 1, 2, 3, 4].map((i) => (
        <mesh key={i} position={[0, 2.2 + i * 1.2, 0]} material={leaf} castShadow>
          <coneGeometry args={[2.1 - i * 0.38, 2.2, 9]} />
        </mesh>
      ))}
    </group>
  );
};

/** Curved palm tree (~7 m). */
export const PalmTree: React.FC<{position: [number, number, number]; scale?: number; seed?: number}> = ({position, scale = 1, seed = 1}) => {
  const barkM = useMat('bark', {repeat: [1, 4]});
  const frond = usePlainMat('#4c7f2f', 0.8, 0, {side: THREE.DoubleSide});
  const curve = useMemo(() => new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.4, 2.5, 0), new THREE.Vector3(1.3, 5, 0), new THREE.Vector3(2.2, 6.6, 0)]), []);
  const trunk = useMemo(() => new THREE.TubeGeometry(curve, 24, 0.2, 8, false), [curve]);
  const frondGeo = useMemo(() => {
    const g = new THREE.PlaneGeometry(3.4, 0.7, 12, 2);
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i) + 1.7;
      p.setZ(i, -0.12 * x * x);
      p.setY(i, p.getY(i) * (1 - x / 3.6));
    }
    g.translate(0, 0, 0);
    g.computeVertexNormals();
    return g;
  }, []);
  const top = curve.getPoint(1);
  return (
    <group position={position} scale={scale} rotation={[0, rnd(seed) * 6, 0]}>
      <mesh geometry={trunk} material={barkM} castShadow />
      <group position={top}>
        {Array.from({length: 9}, (_, i) => (
          <group key={i} rotation={[0, (i / 9) * Math.PI * 2 + rnd(seed + i), 0]}>
            <mesh geometry={frondGeo} position={[1.6, 0, 0]} rotation={[Math.PI / 2 - 0.25 + rnd(seed * 3 + i) * 0.3, 0, 0]} material={frond} castShadow />
          </group>
        ))}
      </group>
    </group>
  );
};

/** Low bush. */
export const Bush: React.FC<{position: [number, number, number]; scale?: number; seed?: number; color?: string}> = ({position, scale = 1, seed = 1, color = '#4a6d2a'}) => {
  const m = usePlainMat(color, 0.9);
  const g = useMemo(() => blobGeo(seed * 31, 0.8, 2, 0.25), [seed]);
  return <mesh geometry={g} position={[position[0], position[1] + 0.45 * scale, position[2]]} scale={[scale * 1.3, scale * 0.8, scale]} material={m} castShadow receiveShadow />;
};

/** Natural rock using a stone texture. */
export const Rock: React.FC<{position: [number, number, number]; scale?: number | [number, number, number]; seed?: number; tex?: TexName}> = ({position, scale = 1, seed = 1, tex = 'stone_face_grey'}) => {
  const m = useMat(tex, {repeat: [1, 1]});
  const g = useMemo(() => worldUV(blobGeo(seed * 17, 1, 2, 0.35), 2), [seed]);
  return <mesh geometry={g} position={position} scale={scale as never} rotation={[rnd(seed) * 3, rnd(seed + 1) * 3, 0]} material={m} castShadow receiveShadow />;
};

/** Scatter helper: deterministic positions in a ring around the origin (avoids the work area). */
export const scatter = (n: number, rMin: number, rMax: number, seed: number) =>
  Array.from({length: n}, (_, i) => {
    const a = rnd(seed + i * 3) * Math.PI * 2;
    const r = rMin + rnd(seed + i * 5) * (rMax - rMin);
    return {pos: [Math.cos(a) * r, 0, Math.sin(a) * r] as [number, number, number], s: 0.75 + rnd(seed + i * 7) * 0.6, seed: seed + i};
  });

// ---------------------------------------------------------------- construction props
/** Wooden pole between two points (scaffolding, frames). */
export const Beam: React.FC<{a: [number, number, number]; b: [number, number, number]; r?: number; square?: boolean; tex?: TexName}> = ({a, b, r = 0.08, square = false, tex = 'wood_pine'}) => {
  const m = useMat(tex, {repeat: [0.4, 2]});
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
  const mid = va.clone().add(vb).multiplyScalar(0.5);
  const len = va.distanceTo(vb);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
  return (
    <mesh position={mid} quaternion={q} material={m} castShadow receiveShadow>
      {square ? <boxGeometry args={[r * 2, len, r * 2]} /> : <cylinderGeometry args={[r, r, len, 8]} />}
    </mesh>
  );
};

/** Plank / board (world-scaled UVs). */
export const Plank: React.FC<{size: [number, number, number]; position: [number, number, number]; rotation?: [number, number, number]; tex?: TexName}> = ({size, position, rotation = [0, 0, 0], tex = 'wood_pine'}) => {
  const m = useMat(tex);
  const g = useMemo(() => uvBox(size[0], size[1], size[2], 2), [size]);
  return <mesh geometry={g} position={position} rotation={rotation} material={m} castShadow receiveShadow />;
};

/** Rope between two points with optional sag. */
export const Rope: React.FC<{a: [number, number, number]; b: [number, number, number]; sag?: number; r?: number; color?: string}> = ({a, b, sag = 0.1, r = 0.025, color = '#8a6a44'}) => {
  const m = usePlainMat(color, 0.95);
  const geo = useMemo(() => {
    const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
    const mid = va.clone().add(vb).multiplyScalar(0.5);
    mid.y -= sag * va.distanceTo(vb);
    return new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(va, mid, vb), 16, r, 6, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.join(), b.join(), sag, r]);
  return <mesh geometry={geo} material={m} castShadow />;
};

/** Scaffold bay: 4 poles + ledgers + plank deck at each level. Facing +Z. */
export const ScaffoldBay: React.FC<{position: [number, number, number]; w?: number; d?: number; h?: number; levels?: number; rotY?: number}> = ({position, w = 3, d = 1.2, h = 6, levels = 3, rotY = 0}) => {
  const lv = Array.from({length: levels}, (_, i) => ((i + 1) * h) / levels);
  return (
    <group position={position} rotation={[0, rotY, 0]}>
      {[[0, 0], [w, 0], [0, d], [w, d]].map(([x, z], i) => (
        <Beam key={i} a={[x, 0, z]} b={[x, h + 0.6, z]} r={0.06} />
      ))}
      {lv.map((y, i) => (
        <React.Fragment key={i}>
          <Beam a={[0, y, 0]} b={[w, y, 0]} r={0.045} />
          <Beam a={[0, y, d]} b={[w, y, d]} r={0.045} />
          <Plank size={[w, 0.05, d]} position={[w / 2, y + 0.06, d / 2]} />
        </React.Fragment>
      ))}
      <Beam a={[0, 0.2, d]} b={[w, h * 0.66, d]} r={0.04} />
    </group>
  );
};

/** Animated water surface (scroll normal map with `time`). */
export const Water: React.FC<{w: number; d: number; position?: [number, number, number]; time?: number; color?: string; texScale?: number}> = ({w, d, position = [0, 0, 0], time = 0, color = '#3f8fa0', texScale = 6}) => {
  const base = useMat('water', {repeat: [w / texScale, d / texScale], roughness: 0.1, metalness: 0.1, tint: color, normalScale: 0.6, envMapIntensity: 1.4, transparent: true, opacity: 0.88});
  base.normalMap!.offset.set(time * 0.02, time * 0.013);
  base.map!.offset.set(time * 0.01, 0);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={position} material={base} receiveShadow>
      <planeGeometry args={[w, d]} />
    </mesh>
  );
};

/** Little dust puffs at a point, driven by local frame `f` (loops every `period`). */
export const Dust: React.FC<{at: [number, number, number]; f: number; period?: number; count?: number; size?: number; color?: string}> = ({at, f, period = 24, count = 6, size = 0.22, color = '#c9b796'}) => {
  const mats = useMemo(() => Array.from({length: count}, () => new THREE.MeshStandardMaterial({color, roughness: 1, transparent: true, depthWrite: false})), [count, color]);
  return (
    <group position={at}>
      {mats.map((m, i) => {
        const ph = ((f + (i * period) / count) % period) / period;
        const a = (i / count) * Math.PI * 2 + rnd(i) * 0.6;
        m.opacity = 0.32 * (1 - ph) * Math.min(1, ph * 6);
        return (
          <mesh key={i} material={m} position={[Math.cos(a) * ph * 0.8, ph * 0.6, Math.sin(a) * ph * 0.8]} scale={size * (0.5 + ph)}>
            <icosahedronGeometry args={[1, 1]} />
          </mesh>
        );
      })}
    </group>
  );
};

// ---------------------------------------------------------------- terrain & buildings
/**
 * Heightfield terrain. `height(x,z)` in metres. Textured with `tex` plus large-scale colour variation,
 * and steep areas blended toward `slopeTint`.
 */
export const Terrain: React.FC<{
  height: (x: number, z: number) => number;
  size?: number;
  seg?: number;
  tex?: TexName;
  texScale?: number;
  center?: [number, number];
}> = ({height, size = 900, seg = 220, tex = 'grass', texScale = 6, center = [0, 0]}) => {
  const base = useMat(tex, {repeat: [1, 1]});
  const geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(size, size, seg, seg);
    g.rotateX(-Math.PI / 2);
    g.translate(center[0], 0, center[1]);
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      p.setY(i, height(x, z));
      uv.setXY(i, x / texScale, z / texScale);
    }
    g.computeVertexNormals();
    return g;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, seg, texScale, center[0], center[1]]);
  const m = useMemo(() => {
    const mm = base.clone();
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
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.37, 0.30) * (0.8 + 0.4 * mv), steep * 0.85);`);
    };
    mm.customProgramCacheKey = () => 'terrainMacro';
    return mm;
  }, [base]);
  return <mesh geometry={geo} material={m} receiveShadow />;
};

/** Small Mediterranean house: plaster walls + terracotta roof. Facing +Z. */
export const House: React.FC<{position: [number, number, number]; size?: [number, number, number]; rotY?: number; wall?: TexName}> = ({
  position, size = [6, 4, 5], rotY = 0, wall = 'plaster_ochre',
}) => {
  const [w, h, d] = size;
  const wm = useMat(wall);
  const rm = useMat('roof_tiles');
  const body = useMemo(() => uvBox(w, h, d, 3), [w, h, d]);
  const roofGeo = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(-w / 2 - 0.4, 0);
    s.lineTo(w / 2 + 0.4, 0);
    s.lineTo(0, h * 0.45);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, {depth: d + 0.8, bevelEnabled: false});
    g.translate(0, 0, -(d + 0.8) / 2);
    return worldUV(g, 2.5);
  }, [w, h, d]);
  return (
    <group position={position} rotation={[0, rotY, 0]}>
      <mesh geometry={body} position={[0, h / 2, 0]} material={wm} castShadow receiveShadow />
      <mesh geometry={roofGeo} position={[0, h, 0]} material={rm} castShadow />
    </group>
  );
};
