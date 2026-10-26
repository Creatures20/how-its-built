// Camera helpers shared by 3D scenes and 2D overlays (so labels stick to 3D points).
import * as THREE from 'three';

export type Cam = {pos: [number, number, number]; target: [number, number, number]; fov: number};

const tmp = new THREE.PerspectiveCamera();
/** Project a world point to screen pixels for a 1080x1920 frame. Returns [x, y, visible]. */
export const toScreen = (p: [number, number, number], cam: Cam, w = 1080, h = 1920): [number, number, boolean] => {
  tmp.fov = cam.fov;
  tmp.aspect = w / h;
  tmp.near = 0.3;
  tmp.far = 3000;
  tmp.updateProjectionMatrix();
  tmp.position.set(...cam.pos);
  tmp.lookAt(...cam.target);
  tmp.updateMatrixWorld();
  const v = new THREE.Vector3(...p).project(tmp);
  return [((v.x + 1) / 2) * w, ((1 - v.y) / 2) * h, v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1];
};

/** Interpolate camera keyframes [{t, pos, target, fov}] with smooth easing between keys. t in frames. */
export const camPath = (f: number, keys: {t: number; pos: [number, number, number]; target: [number, number, number]; fov?: number}[]): Cam => {
  if (f <= keys[0].t) return {pos: keys[0].pos, target: keys[0].target, fov: keys[0].fov ?? 45};
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (f <= b.t) {
      let u = (f - a.t) / (b.t - a.t);
      u = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2; // easeInOutCubic
      const L = (x: number, y: number) => x + (y - x) * u;
      return {
        pos: [L(a.pos[0], b.pos[0]), L(a.pos[1], b.pos[1]), L(a.pos[2], b.pos[2])],
        target: [L(a.target[0], b.target[0]), L(a.target[1], b.target[1]), L(a.target[2], b.target[2])],
        fov: L(a.fov ?? 45, b.fov ?? 45),
      };
    }
  }
  const k = keys[keys.length - 1];
  return {pos: k.pos, target: k.target, fov: k.fov ?? 45};
};

/**
 * Ground guard: returns `cam` lifted (smoothly, continuously) so that
 *  1) the camera is at least `clearance` m above the terrain under it, and
 *  2) the line of sight to the target is not blocked by terrain (checked over the first `upTo` of the way).
 * Use on EVERY camera in a scene with Terrain/hills: `const cam = groundSafe(camPath(...), heightFn)`.
 * Pins/labels must use the returned cam so they stay attached.
 */
export const groundSafe = (cam: Cam, height: (x: number, z: number) => number, clearance = 2.5, margin = 1.5, upTo = 0.85): Cam => {
  const [px, py, pz] = cam.pos;
  const [tx, ty, tz] = cam.target;
  let lift = Math.max(0, height(px, pz) + clearance - py);
  const N = 40;
  for (let i = 1; i <= N; i++) {
    const s = (i / N) * upTo;
    const x = px + (tx - px) * s, z = pz + (tz - pz) * s;
    const yLine = py + (ty - py) * s;
    const need = (height(x, z) + margin - yLine) / (1 - s);
    if (need > lift) lift = need;
  }
  return lift > 0 ? {...cam, pos: [px, py + lift, pz]} : cam;
};
