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
- Render speed ≈ 2.5–3.5 s/frame on 2 cores → a 70 s episode ≈ 1.5–2.5 h. Start early.

## Review loop (mandatory, at least 2 rounds)
`bash scripts/stills.sh <Comp> <one frame per scene + extra for long scenes>` → Read `out/contact.png`. For EVERY scene check: subject fully in frame, nothing important cut off, no empty/odd shots (camera inside objects, staring at grass), labels readable and not overlapping each other/captions/headline, text matches narration. Fix and re-check before the full render. After rendering, extract 8 frames from the mp4 and check again.

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
bash scripts/render.sh <Comp> <epNNN-id>    # → videos/<epNNN-id>.mp4
git add + commit + push                     # raw URL is the public media link for Metricool
```
Public video URL: `https://raw.githubusercontent.com/Creatures20/how-its-built/main/videos/<file>.mp4`
Metricool brand (blogId) **7635373**, timezone Europe/Berlin.
