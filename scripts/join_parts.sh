#!/usr/bin/env bash
# Join rendered parts in order and make the final file (loudness-normalized, bitrate-capped < 100 MB).
# usage: scripts/join_parts.sh <id> <numberOfParts>   → videos/<id>.mp4
set -e; cd "$(dirname "$0")/.."
L=out/parts/$1_list.txt; : > $L
for i in $(seq 1 $2); do echo "file '$(pwd)/out/parts/$1_$i.mp4'" >> $L; done
ffmpeg -loglevel error -y -f concat -safe 0 -i $L -c copy out/parts/$1_joined.mp4
mkdir -p videos
ffmpeg -loglevel error -y -i out/parts/$1_joined.mp4 -c:v libx264 -preset slow -crf 20 -maxrate 6M -bufsize 12M -pix_fmt yuv420p -movflags +faststart -af loudnorm=I=-14:TP=-1.5:LRA=11 -c:a aac -b:a 192k -ar 48000 "videos/$1.mp4"
ls -la "videos/$1.mp4"; ffprobe -v error -show_entries format=duration -of csv=p=0 "videos/$1.mp4"
