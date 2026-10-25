import json, sys, soundfile as sf
from kokoro_onnx import Kokoro
k = Kokoro("kokoro-v1.0.onnx", "voices-v1.0.bin")
spec = json.load(open(sys.argv[1])); out = sys.argv[2]
durs = []
for i, t in enumerate(spec["lines"]):
    a, sr = k.create(t, voice=spec.get("voice", "am_michael"), speed=spec.get("speed", 1.1), lang="en-us")
    sf.write(f"{out}/{spec['id']}_{i}.wav", a, sr)
    durs.append(round(len(a) / sr, 3))
json.dump({"id": spec["id"], "durations": durs, "lines": spec["lines"]}, open(sys.argv[3], "w"), indent=1)
print(durs)
