# How It's Built — Episode Playbook (v2 quality bar)

Channel: **How It's Built** (@HowItsBuiltIn3D) — "Everyday things, built step by step."
Format: YouTube Short, 1080×1920, 30 fps, **55–75 s**, textured 3D (Three.js via `@remotion/three`), male narrator (Kokoro `am_michael`, speed 1.1).

**Reference episode: `src/episodes/Aqueduct.tsx`** (+ `tts/ep003-aqueduct_script.json`). It is the quality bar. Copy its structure, not Pyramids/Castle (those are the old flat-colour style).
Quality matters more than speed: there is a whole day of render budget. Never ship a flat-coloured or untextured episode.

## Episode formula (7–9 narration lines → 7–9 scenes)
1. **Hook (≤ 7 s)** — the finished thing, beautiful wide shot, one big surprising number (`Headline`).
2. **Context / problem** — why it was hard (map, scale comparison, a tool like the chorobates).
3–6. **Steps** — one scene per physical stage, each with `StepBadge`, 2–4 `Pin` labels anchored to 3D parts, one `Caption` with a concrete fact. Show the thing being BUILT: parts rising, dropping in, assembling, people working (hammer/chisel/carry/pull poses), cranes, scaffolds, dust.
7. **The clever detail** — cutaway or close-up that explains *why it works* (keystone, lining, gradient…).
8. **Payoff** — golden-hour wide shot + big number / "still standing after N years".

Rules:
- Scene length = narration length (`sceneLen(i, tail)`). Never cut the voice.
- Every fact checked with web search (Wikipedia + one more source). Say "a leading theory" when experts disagree.
- On-screen text ≤ 8 words per element; captions ≤ 12 words.
- No real brands/logos/real people. Original models only.

## Format B — "Problem → Fix ladder" (modern / everyday topics)
Use for every 2nd or 3rd episode so the channel isn't all ancient history. Inspired by "What a hole in your yard can become: a bunker".
1. **Hook**: the dumbest possible version. "Dig a hole and climb in. Is that a bunker?"
2. **Problem 1 → fix** ("The walls collapse." → shoring / concrete walls). Show the failure briefly (dirt sliding in), then the fix being built.
3. **Problem 2 → fix** ("Rain floods it." → waterproof membrane + drainage)… usually 4–6 problems, each one a scene: problem label (red Tag), fix label (yellow Tag), the fix animating into place.
4. **Payoff**: pull back to the finished real thing, cutaway showing all layers at once, one closing number.
Visual notes: modern setting (suburban garden, house, fence, lawn, modern workers with `head="hardhat"` and hi-vis colours `outfit="#f2a900"`), cutaway sections through the ground (see S3 of Aqueduct.tsx for the earth-bank cutaway technique), modern materials (concrete, concrete_formed, steel, gravel, asphalt). Narration is punchy: short problem sentence, short fix sentence.

## Visual kit (src/hib)
- `pbr.tsx`: `AssetProvider` (list every texture used + `hdri`), `useMat(tex, {tint, repeat, clip…})`, `uvBox` / `worldUV` (world-scaled UVs → textures keep real size), `Renderer` (ACES, soft shadows, HDRI env), `SkyDome` (gradient + sun + clouds), `Sun`, `Ground`, `GroundPatch`.
- `models.tsx`: `Person` (poses: walk, pull, push, carry, hammer, chisel, haul, point, stand; heads: hair, cloth, helmet, hardhat, hat), `Tree`, `Cypress`, `Pine`, `PalmTree`, `Bush`, `Rock`, `Terrain(height fn)`, `House`, `Beam`, `Plank`, `Rope`, `ScaffoldBay`, `Water`, `Dust`.
- `project.ts`: `camPath(f, keys)` smooth camera keyframes; `toScreen(p, cam)` to pin 2D labels to 3D points.
- `ui.tsx`: `Headline`, `StepBadge`, `Tag`, `Caption`, `Grade` (vignette), `Watermark`, `SceneFade`.
- Textures (public/tex, from `tools/texgen.py`): sandstone_blocks, limestone_ashlar, castle_stone, granite_blocks, tuff_blocks, brick_red, roman_brick, mud_brick, rubble_wall, rubble_core, cobblestones, stone_face_{sand,lime,grey,tuff}, sand, dirt, gravel, grass, snow, water, wood_oak, wood_pine, bark, roof_tiles, concrete, concrete_formed, asphalt, steel, steel_painted_red, steel_rusty, iron_dark, plaster_white, plaster_ochre, linen. Need a new surface? Add a generator to texgen.py and run it.
- HDRIs (public/hdri): spruit_sunrise_1k, venice_sunset_1k, quarry_01_1k.

## Hard-won lessons
- **Portrait framing**: horizontal FOV ≈ 0.56 × vertical. A 27 m wide subject needs ~60 m distance at fov 50, or fov 60 at ~45 m. Frame tall subjects; run long things (routes, bridges) top-to-bottom or diagonally.
- Materials must be stable across frames: memoize clip-plane arrays (`useMemo(() => [plane], [plane])`), never pass changing objects to `usePlainMat`. A new material per frame = recompiles = very slow.
- `Pin` hides labels whose point is off-screen and clamps to the frame; keep labels out of the caption zone (y > 1500).
- Carved/cut-away subjects (caves, tunnels, rooms in rock): subtract boxes with `three-bvh-csg` and **bake offline** (see `tools/derinkuyu_geo.ts` → `public/geo/ep004`); in-browser CSG of 400 cuts takes ~45 s. Put the base block's offset into the geometry (not the Brush position), convert the result `toNonIndexed()` before saving, and offset brushes slightly so faces are never coplanar.
- Render speed ≈ 2.5–4 s/frame on 2 cores → a 70 s episode ≈ 1.5–3 h. A single background command is killed after 2 h, so ALWAYS render in parts of ≤ 730 frames (render_part.sh) and join them (join_parts.sh). Re-renders for QA fixes can redo only the parts that changed.
- **Never let the camera go under the terrain** (the ground vanishes and everything looks like it floats). Wrap EVERY camera in a scene with Terrain/hills: `const cam = groundSafe(camPath(...), heightFn)` (project.ts) — it lifts the camera above the ground AND keeps the line of sight to the target clear of hills. Watch the ends of camera moves: wide pull-backs and orbits drift into hillsides.
- **People must behave physically**: `pose="walk"` only if the person actually moves — use `walkAlong(start, heading, f, speed, heightFn)` (models.tsx) so feet don't slide. Static workers use hammer/chisel/carry/point/stand; pull/push automatically brace their legs. Treadmill/wheel walkers: `legs="walk"`. Feet on the ground (place with the terrain height), never floating or sunk, never intersecting walls. Ropes must connect hand-to-object.
- **Continuity between scenes**: same world, same time of day and same models across scenes unless the story changes them; whatever was built in scene N must still be there in scene N+1 (no resets/pop-ins); a recurring character keeps the same `seed`/outfit; labels and numbers stay consistent.
- **Stills can lie about instancing**: an `instancedMesh` whose matrices are set only once (useLayoutEffect with deps) rendered fine in `remotion still` but was INVISIBLE in the real sequential render (EP006 hook). Either update instance matrices every frame (no deps, like PileField in Venice.tsx) or merge static copies with `mergeGeometries`. Always check a short real render (`npx remotion render ... --frames=a-b --every-nth-frame=15 --scale=0.4`) of any x-ray/reveal shot.
- Heavy cutaway scenes (1000+ instanced piles, 4096 shadows) render at ~9 s/frame on 2 cores, so a 730-frame part can take ~2 h. Keep heavy scenes' parts ≤ 600 frames, or budget for it.
- **Transitions**: dip to dark (root `AbsoluteFill` background `#0e0b08`, SceneFade inF 5 / outF 4) or hard cuts. Never fade over a light/sky-coloured background (looks like a blank flash).

## Visual variety (check against the last 2 episodes before building)
Look at the frames of the previous two videos (`bash scripts/qa.sh videos/<prev>.mp4`). The new episode must look clearly different in at least 3 of: dominant colour palette, setting (desert / water / snow / city / forest / interior), time of day or weather, main material/texture, camera style (cutaway vs. exterior vs. aerial). Don't default to tan/sand palettes and striped earth cutaways — reuse the kit, not the look. If the topic is naturally similar (e.g. two desert topics), change time of day, weather and framing deliberately, and say in the report what was varied.

## Review loop (mandatory, at least 2 rounds)
`bash scripts/stills.sh <Comp> <one frame per scene + extra for long scenes>` → Read `out/contact.png`. For EVERY scene check: subject fully in frame, nothing important cut off, no empty/odd shots (camera inside objects, staring at grass), labels readable and not overlapping each other/captions/headline, text matches narration. Include the FIRST and LAST frame of every scene (camera extremes) — that's where underground cameras and odd framing hide. Fix and re-check before the full render.

## Post-render QA (mandatory, before publishing)
`bash scripts/qa.sh videos/<id>.mp4` → Read every `out/qa/sheet_*.png` (1 frame per second, timestamped) and `out/qa/cuts.png` (frames around each cut). Fail the video if ANY of these appear:
1. blank / flat-colour / washed-out frames (transitions, scenes not loading)
2. camera under the ground or inside geometry; ground missing so buildings/trees/people float
3. people sliding without stepping, walking in place, floating, sunk, clipping through objects, or behaving inconsistently between shots
4. continuity breaks between consecutive scenes (built parts disappearing, different world/lighting, a character changing look)
5. subjects cut off by the vertical frame, labels clipped or overlapping captions/headlines, text not matching narration
6. audio missing or cut off
If it fails: fix the code, re-render the affected parts with render_part.sh (re-bundle first), join again, run qa.sh again. Repeat until it passes (max 3 renders; if it still fails, report instead of publishing).

## Title / description
- Title ≤ 60 chars, curiosity + topic. Description: 2–3 sentences + `#shorts #howitsbuilt` + 3–4 topic hashtags.
- YouTube: type `short`, public, madeForKids false, category EDUCATION, 5–8 tags.

## Pipeline (cloud session)
```
bash scripts/setup.sh                       # deps, chromium, voice model
# write tts/<id>_script.json  (7–9 lines)
bash scripts/voice.sh <id>                  # → public/vo/<id>_N.wav + src/episodes/<id>-vo.json
# write src/episodes/<Name>.tsx, register in src/Root.tsx
bash scripts/stills.sh <Comp> <frames...>   # review loop
# RENDER IN PARTS: one background command may run at most 2 h, and a full episode takes 1.5–3 h.
source scripts/env.sh && npx remotion bundle src/index.ts --out-dir build   # bundle once
bash scripts/render_part.sh <Comp> <id> 1 0 729        # each part ≤ 730 frames, one run_in_background
bash scripts/render_part.sh <Comp> <id> 2 730 1459     # (wait for each to finish; parts must be
bash scripts/render_part.sh <Comp> <id> 3 1460 <last>  #  contiguous and cover every frame)
bash scripts/join_parts.sh <id> 3                       # → videos/<id>.mp4
bash scripts/qa.sh videos/<id>.mp4                      # post-render QA
git add + commit + push                     # raw URL is the public media link for Metricool
```
Public video URL: `https://raw.githubusercontent.com/Creatures20/how-its-built/main/videos/<file>.mp4`
Metricool brand (blogId) **7635373**, timezone Europe/Berlin.
