#!/usr/bin/env bash
# usage: scripts/stills.sh <CompositionId> f1 f2 f3 ...  → out/contact.png (half-res frames side by side)
set -e; cd "$(dirname "$0")/.."; source scripts/env.sh
C=$1; shift
npx remotion bundle src/index.ts --out-dir build >/dev/null
args=(); i=0
for fr in "$@"; do npx remotion still build $C out/st_$fr.png --frame=$fr $RFLAGS --scale=0.5 --timeout=180000 >/dev/null 2>&1; args+=(-i out/st_$fr.png); i=$((i+1)); done
ffmpeg -loglevel error -y "${args[@]}" -filter_complex "hstack=$i,scale=$((300*i)):-1" out/contact.png
echo out/contact.png
