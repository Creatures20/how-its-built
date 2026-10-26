// Precompute the carved Derinkuyu geometry (CSG is slow) → public/geo/ep004/<key>.bin + index.json
// run: npx esbuild tools/derinkuyu_geo.ts --bundle --platform=node --outfile=/tmp/dgeo.js && node /tmp/dgeo.js
import * as fs from 'fs';
import {allSpecs, carve, carvingStage, N_STAGES} from '../src/episodes/derinkuyu-city';
const out = 'public/geo/ep004';
fs.mkdirSync(out, {recursive: true});
const warn = console.warn; console.warn = () => {};
const idx: Record<string, {groups: {start: number; count: number; materialIndex: number}[]; mats: string[]; n: number; ni: number}> = {};
const save = (key: string, specs: ReturnType<typeof allSpecs>) => {
  const t = Date.now();
  const c = carve(key, specs);
  const g = c.geo;
  const pos = g.getAttribute('position').array as Float32Array, nrm = g.getAttribute('normal').array as Float32Array, uv = g.getAttribute('uv').array as Float32Array;
  const n = pos.length / 3;
  const buf = Buffer.concat([Buffer.from(pos.buffer, pos.byteOffset, pos.byteLength), Buffer.from(nrm.buffer, nrm.byteOffset, nrm.byteLength), Buffer.from(uv.buffer, uv.byteOffset, uv.byteLength)]);
  fs.writeFileSync(`${out}/${key}.bin`, buf);
  idx[key] = {groups: g.groups.map((x) => ({...x, materialIndex: x.materialIndex ?? 0})), mats: c.matKeys, n, ni: 0};
  warn(key, n, 'verts', Date.now() - t, 'ms');
};
save('all', allSpecs());
for (let i = 0; i < N_STAGES; i++) save(`stage${i}`, carvingStage(i));
fs.writeFileSync(`${out}/index.json`, JSON.stringify(idx));
