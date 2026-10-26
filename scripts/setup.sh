#!/usr/bin/env bash
# One-time setup in a fresh cloud session. Safe to re-run.
set -e
cd "$(dirname "$0")/.."
npm ci --no-audit --no-fund >/dev/null 2>&1 || npm install --no-audit --no-fund >/dev/null
rm -rf node_modules/.cache   # stale webpack cache breaks bundles after dependency changes
# Chromium: Remotion's own download host is blocked, use the npm-bundled one
node -e "require('@sparticuz/chromium').default.executablePath().then(p=>console.log('chromium:',p))"
# Voice: Kokoro (offline TTS), model files from GitHub
pip install --break-system-packages -q kokoro-onnx soundfile 2>/dev/null
mkdir -p tts/models
for f in kokoro-v1.0.onnx voices-v1.0.bin; do
  [ -s tts/models/$f ] || curl -sSL -o tts/models/$f https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/$f
done
echo "setup ok"
