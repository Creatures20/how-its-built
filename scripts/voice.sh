#!/usr/bin/env bash
# usage: scripts/voice.sh <episode-id>   (reads tts/<id>_script.json)
set -e; cd "$(dirname "$0")/.."
cd tts && python3 vo_ep.py "${1}_script.json" ../public/vo "../src/episodes/${1}-vo.json" 2>&1 | grep -v Warn
