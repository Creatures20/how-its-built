# How It's Built — Episode Playbook

Channel: **How It's Built** (@HowItsBuiltIn3D) — "Everyday things, built step by step."
Format: YouTube Short, 1080×1920, 30 fps, **30–45 s**, low-poly 3D (Three.js via `@remotion/three`), male narrator (Kokoro `am_michael`, speed 1.1).
Reference episode: `src/episodes/Pyramids.tsx` (+ `tts/pyramids_script.json`, `src/episodes/pyramids-vo.json`). Copy its structure.

## Episode formula (5 narration lines → 5 beats)
1. **Hook (≤ 6 s)** — one surprising number or a "why does X look like this?" question. Big stroked headline (`Headline`). Show the finished thing first.
2. **Step 1** — the first physical stage (foundation / material / how parts are moved). `StepBadge n={1}` + 1–2 yellow `Tag`s + one `Caption` with a concrete fact.
3. **Step 2** — the thing visibly growing (animate progress 0→1 across the whole beat; instanced blocks/parts via `BlockLayer`). A counter Tag (year, metres, layers) is good.
4. **Step 3** — the finish / the clever detail that makes it work.
5. **Payoff** — a big number or "still standing after N years". End on the finished object, camera pulling back.

Rules:
- Scene length = narration length (`sceneLen(i, tail)` pattern). Never cut the voice.
- On-screen text ≤ 8 words per element; captions ≤ 12 words. Lilita One headlines, Nunito captions, yellow `#FFC928` tags with black outline.
- Facts must be checkable: verify every number with a web search before using it; say "a leading theory" when historians disagree.
- No real brands, logos, or real people. Original low-poly models only.
- Keep the 3D light enough to render in ≤ 40 min on 2 CPU cores: instanced meshes, ≤ ~15k blocks, one shadow light.

## Hook patterns that fit this channel
- Big number + constraint: "2.3 million blocks. No cranes."
- "Why does X have Y?" — curiosity about a visible detail (well roof, castle stairs turning clockwise).
- Longevity: "2,000 years later, still walkable."
- Scale shock: "This bridge is held up by just two cables."

## Title / description
- Title ≤ 60 chars, curiosity + topic: "How the Romans Built Roads That Lasted 2,000 Years".
- Description: 2–3 sentences recapping the steps + `#shorts #howitsbuilt` + 3–4 topic hashtags.
- YouTube: type `short`, public, madeForKids false, category EDUCATION, 5–8 tags.

## Pipeline (cloud session)
```
bash scripts/setup.sh                       # deps, chromium, voice model
# write tts/<id>_script.json  (5 lines)
bash scripts/voice.sh <id>                  # → public/vo/<id>_N.wav + src/episodes/<id>-vo.json
# write src/episodes/<Name>.tsx, register in src/Root.tsx
bash scripts/stills.sh <Comp> <frames...>   # look at out/contact.png, fix framing/overlaps
bash scripts/render.sh <Comp> <epNNN-id>    # → videos/<epNNN-id>.mp4
git add + commit + push                     # raw URL is the public media link for Metricool
```
Public video URL: `https://raw.githubusercontent.com/Creatures20/how-its-built/main/videos/<file>.mp4`
Metricool brand (blogId) **7635373**, timezone Europe/Berlin.
