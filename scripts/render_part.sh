#!/usr/bin/env bash
# Render one chunk (each background command has a 2 h limit, so long episodes are rendered in parts).
# usage: scripts/render_part.sh <CompositionId> <id> <partNo> <fromFrame> <toFrame>   → out/parts/<id>_<partNo>.mp4
# Bundle once first:  source scripts/env.sh && npx remotion bundle src/index.ts --out-dir build
set -e; cd "$(dirname "$0")/.."; source scripts/env.sh
mkdir -p out/parts
npx remotion render build "$1" "out/parts/$2_$3.mp4" $RFLAGS --concurrency=$(nproc) --crf=18 --audio-codec=aac --timeout=180000 --frames="$4-$5"
ls -la "out/parts/$2_$3.mp4"
