#!/usr/bin/env bash
# Post-render QA. usage: scripts/qa.sh videos/<id>.mp4
# Produces out/qa/sheet_N.png (1 frame per second, 8 per sheet, timestamped)
# and out/qa/cuts.png (last/first frame around every detected scene cut), then lists them.
set -e; cd "$(dirname "$0")/.."
V="$1"; Q=out/qa; rm -rf $Q; mkdir -p $Q
D=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$V")
ffmpeg -loglevel error -i "$V" -vf "fps=1,scale=240:-1,drawtext=text='%{pts\:hms}':x=6:y=6:fontsize=20:fontcolor=yellow:box=1:boxcolor=black@0.6" $Q/f_%03d.png
n=$(ls $Q/f_*.png | wc -l); s=0
for ((i=1; i<=n; i+=8)); do
  args=(); k=0
  for ((j=i; j<i+8 && j<=n; j++)); do args+=(-i $(printf "$Q/f_%03d.png" $j)); k=$((k+1)); done
  s=$((s+1)); if [ $k -gt 1 ]; then ffmpeg -loglevel error -y "${args[@]}" -filter_complex "hstack=$k" $Q/sheet_$s.png; else cp $(printf "$Q/f_%03d.png" $i) $Q/sheet_$s.png; fi
done
# scene cuts
ffmpeg -i "$V" -vf "select='gt(scene,0.25)',showinfo" -an -f null - 2>&1 | grep -o 'pts_time:[0-9.]*' | cut -d: -f2 > $Q/cuts.txt || true
args=(); k=0
while read t; do
  a=$(python3 -c "print(max(0,$t-0.12))"); b=$(python3 -c "print($t+0.12)")
  ffmpeg -nostdin -loglevel error -y -ss $a -i "$V" -frames:v 1 -vf scale=160:-1 $Q/c_${k}a.png
  ffmpeg -nostdin -loglevel error -y -ss $b -i "$V" -frames:v 1 -vf scale=160:-1 $Q/c_${k}b.png
  args+=(-i $Q/c_${k}a.png -i $Q/c_${k}b.png); k=$((k+1))
done < $Q/cuts.txt
[ $k -gt 0 ] && ffmpeg -loglevel error -y "${args[@]}" -filter_complex "hstack=$((k*2))" $Q/cuts.png
echo "duration $D s, $n frames sampled, $s sheets, $k cuts at: $(tr '\n' ' ' < $Q/cuts.txt)"
ls $Q/sheet_*.png $Q/cuts.png 2>/dev/null
