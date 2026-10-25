#!/usr/bin/env bash
# usage: scripts/render.sh <CompositionId> <episode-id>  → videos/<episode-id>.mp4 (loudness-normalized)
set -e; cd "$(dirname "$0")/.."; source scripts/env.sh
npx remotion bundle src/index.ts --out-dir build >/dev/null
npx remotion render build "$1" out/raw.mp4 $RFLAGS --concurrency=$(nproc) --crf=20 --audio-codec=aac
mkdir -p videos
ffmpeg -loglevel error -y -i out/raw.mp4 -c:v copy -af loudnorm=I=-14:TP=-1.5:LRA=11 -c:a aac -b:a 192k -ar 48000 "videos/$2.mp4"
ls -la "videos/$2.mp4"
