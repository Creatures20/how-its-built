#!/usr/bin/env bash
# usage: scripts/render.sh <CompositionId> <episode-id>  → videos/<episode-id>.mp4 (loudness-normalized)
set -e; cd "$(dirname "$0")/.."; source scripts/env.sh
npx remotion bundle src/index.ts --out-dir build >/dev/null
npx remotion render build "$1" out/raw.mp4 $RFLAGS --concurrency=$(nproc) --crf=18 --audio-codec=aac --timeout=180000
mkdir -p videos
# re-encode: capped bitrate keeps files < 100 MB (GitHub limit) at good quality
ffmpeg -loglevel error -y -i out/raw.mp4 -c:v libx264 -preset slow -crf 20 -maxrate 6M -bufsize 12M -pix_fmt yuv420p -movflags +faststart -af loudnorm=I=-14:TP=-1.5:LRA=11 -c:a aac -b:a 192k -ar 48000 "videos/$2.mp4"
ls -la "videos/$2.mp4"
