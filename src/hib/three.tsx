// Reusable low-poly 3D pieces for "How It's Built" episodes.
import React, {useLayoutEffect, useMemo} from 'react';
import {useThree} from '@react-three/fiber';
import * as THREE from 'three';

/** Sets the camera every frame (Remotion re-renders per frame). */
export const CameraRig: React.FC<{pos: [number, number, number]; target: [number, number, number]; fov?: number}> = ({pos, target, fov}) => {
  const {camera} = useThree();
  useLayoutEffect(() => {
    camera.position.set(...pos);
    if (fov && (camera as THREE.PerspectiveCamera).fov !== fov) {
      (camera as THREE.PerspectiveCamera).fov = fov;
      camera.updateProjectionMatrix();
    }
    camera.lookAt(...target);
  });
  return null;
};

/** Enables clipping planes on the renderer. */
export const EnableClipping: React.FC = () => {
  const {gl} = useThree();
  useLayoutEffect(() => {
    gl.localClippingEnabled = true;
  }, [gl]);
  return null;
};

/** Warm desert sun + sky fill. */
export const SunLights: React.FC<{shadowSize?: number}> = ({shadowSize = 30}) => (
  <>
    <hemisphereLight args={['#cfe8ff', '#d9b77a', 1.1]} />
    <directionalLight
      position={[-20, 30, 16]}
      intensity={2.6}
      color="#fff3dc"
      castShadow
      shadow-mapSize-width={2048}
      shadow-mapSize-height={2048}
      shadow-camera-left={-shadowSize}
      shadow-camera-right={shadowSize}
      shadow-camera-top={shadowSize}
      shadow-camera-bottom={-shadowSize}
      shadow-camera-near={1}
      shadow-camera-far={120}
      shadow-bias={-0.0006}
    />
  </>
);

export const SandGround: React.FC<{color?: string}> = ({color = '#E3C48A'}) => (
  <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
    <planeGeometry args={[600, 600]} />
    <meshStandardMaterial color={color} roughness={1} />
  </mesh>
);

/** Low-poly palm tree. */
export const Palm: React.FC<{position: [number, number, number]; scale?: number; lean?: number}> = ({position, scale = 1, lean = 0.12}) => (
  <group position={position} scale={scale} rotation={[0, 0, lean]}>
    <mesh position={[0, 2, 0]} castShadow>
      <cylinderGeometry args={[0.16, 0.24, 4, 6]} />
      <meshStandardMaterial color="#8a5a32" flatShading />
    </mesh>
    {[0, 1, 2, 3, 4].map((i) => (
      <mesh key={i} position={[Math.cos((i / 5) * Math.PI * 2) * 0.9, 4, Math.sin((i / 5) * Math.PI * 2) * 0.9]} rotation={[Math.sin((i / 5) * Math.PI * 2) * 0.9, 0, -Math.cos((i / 5) * Math.PI * 2) * 0.9]} castShadow>
        <coneGeometry args={[0.45, 2.2, 4]} />
        <meshStandardMaterial color="#4f9a3a" flatShading />
      </mesh>
    ))}
  </group>
);

/** Simple worker figure. `pull` leans forward, `t` drives walk bob. */
export const Worker: React.FC<{position: [number, number, number]; rotY?: number; pull?: number; t?: number; scale?: number}> = ({
  position, rotY = 0, pull = 0, t = 0, scale = 1,
}) => {
  const bob = Math.abs(Math.sin(t)) * 0.06;
  return (
    <group position={[position[0], position[1] + bob, position[2]]} rotation={[0, rotY, 0]} scale={scale}>
      <group rotation={[0, 0, -pull]}>
        <mesh position={[0, 0.55, 0]} castShadow>
          <cylinderGeometry args={[0.2, 0.28, 0.5, 8]} />
          <meshStandardMaterial color="#f2eee2" flatShading />
        </mesh>
        <mesh position={[0, 1.0, 0]} castShadow>
          <capsuleGeometry args={[0.18, 0.4, 4, 8]} />
          <meshStandardMaterial color="#a8693a" flatShading />
        </mesh>
        <mesh position={[0, 1.48, 0]} castShadow>
          <sphereGeometry args={[0.17, 10, 8]} />
          <meshStandardMaterial color="#a8693a" flatShading />
        </mesh>
      </group>
      <mesh position={[0.08, 0.2, 0.1]} rotation={[0, 0, Math.sin(t) * 0.4]} castShadow>
        <cylinderGeometry args={[0.07, 0.07, 0.45, 6]} />
        <meshStandardMaterial color="#a8693a" />
      </mesh>
      <mesh position={[0.08, 0.2, -0.1]} rotation={[0, 0, -Math.sin(t) * 0.4]} castShadow>
        <cylinderGeometry args={[0.07, 0.07, 0.45, 6]} />
        <meshStandardMaterial color="#a8693a" />
      </mesh>
    </group>
  );
};

/** Deterministic pseudo-random (renders must be identical across frames/workers). */
export const rand = (seed: number) => {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** Instanced block grid helper: one InstancedMesh, `count` controls how many are visible. */
export const BlockLayer: React.FC<{
  positions: [number, number, number][];
  size: [number, number, number];
  count: number;
  seed: number;
  hue?: [number, number];
}> = ({positions, size, count, seed, hue = [36, 44]}) => {
  const mesh = React.useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(() => new THREE.BoxGeometry(...size), [size]);
  const mat = useMemo(() => new THREE.MeshStandardMaterial({roughness: 0.95, flatShading: true}), []);
  useLayoutEffect(() => {
    const m = mesh.current!;
    const o = new THREE.Object3D();
    const col = new THREE.Color();
    positions.forEach((p, i) => {
      o.position.set(...p);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
      const r = rand(seed * 1000 + i);
      col.setHSL((hue[0] + (hue[1] - hue[0]) * r) / 360, 0.36 + 0.1 * rand(i + seed), 0.62 + 0.1 * rand(i * 3 + seed));
      m.setColorAt(i, col);
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [positions, seed, hue]);
  return <instancedMesh ref={mesh} args={[geo, mat, positions.length]} count={Math.max(0, Math.min(count, positions.length))} castShadow receiveShadow frustumCulled={false} />;
};
