#!/bin/bash
# Video 3D della regata: città notturna in 3D, camera che ruota, traffico della simulazione con gli agenti,
# colonne della folla per zona, barche, KPI e dialogo tra agenti.
#
#   strumenti/video3d/fai_video.sh [DA] [A] [USCITA]
#   strumenti/video3d/fai_video.sh 13:35 14:50 media/regata_3d.mp4      (default)
#
# Serve: il venv con requirements.txt (+ numpy), Node con Playwright e Chromium, ffmpeg.
# Tempo: circa 1 fotogramma al secondo senza GPU (75 minuti simulati = 2.250 fotogrammi ≈ 40 minuti).
set -euo pipefail
DA=${1:-13:35}
A=${2:-14:50}
QUI=$(cd "$(dirname "$0")" && pwd)
C5=$(cd "$QUI/../.." && pwd)
USCITA=${3:-$C5/media/regata_3d.mp4}
LAVORO=${C5_LAVORO_VIDEO:-$C5/.video3d}
mkdir -p "$LAVORO/lib"

if [ ! -f "$LAVORO/lungomare.osm" ]; then
  echo "Scarico l'estratto OpenStreetMap del lungomare…"
  curl -sSfL -m 180 -o "$LAVORO/lungomare.osm" "https://api.openstreetmap.org/api/0.6/map?bbox=14.222,40.828,14.258,40.842"
fi
if [ ! -f "$LAVORO/lib/deck.min.js" ]; then
  echo "Scarico deck.gl…"
  curl -sSfL -m 120 -o "$LAVORO/lib/deck.min.js" "https://unpkg.com/deck.gl@9.0.38/dist.min.js"
fi
cp "$QUI/pagina.html" "$LAVORO/"
[ -f "$LAVORO/scena.json" ] || python "$QUI/scena.py" --osm "$LAVORO/lungomare.osm" --uscita "$LAVORO/scena.json"

python "$QUI/esporta.py" --da "$DA" --a "$A" --passo 2 --uscita "$LAVORO/fotogrammi.ndjson"
rm -rf "$LAVORO/fotogrammi"
node "$QUI/rendi.mjs" "$LAVORO" "$LAVORO/fotogrammi.ndjson" "$LAVORO/fotogrammi"
mkdir -p "$(dirname "$USCITA")"
ffmpeg -y -loglevel error -framerate 30 -i "$LAVORO/fotogrammi/f_%05d.jpg" \
  -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p -movflags +faststart "$USCITA"
echo "Video: $USCITA"
