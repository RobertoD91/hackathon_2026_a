#!/usr/bin/env bash
# Monta il video di consegna di TwinCiro: c5-video/bozza.mp4 (1920×1080, 30 fps, H.264, ≤ 3:00, ≤ 40 MB).
#
#   ./monta.sh                    # rimonta con le sorgenti in cache (circa 10 minuti la prima volta, poi 2-3)
#   ./monta.sh --rigenera         # rigenera cartelli, architettura e chat (dopo aver cambiato testi o chat.json)
#   ./monta.sh --rigenera-mappa   # registra di nuovo la mappa con i dati live di adesso
#   ./monta.sh --controllo        # alla fine estrae un fotogramma ogni 5 s per controllare impaginazione e refusi
#   ./monta.sh --segnaposto       # dove manca una ripresa vera mostra il cartello "Qui va una ripresa reale"
#
# Le riprese vere vanno in girato/ (vedi girato/LEGGIMI.md): se un file c'è, prende il posto della scena generata.
# La voce va in girato/voce.m4a (o .wav/.mp3); la musica, solo se libera da diritti, in girato/musica.mp3.
# Serve: ffmpeg, Node con Playwright e Chromium, python3 (solo libreria standard).
set -euo pipefail
QUI="$(cd "$(dirname "$0")" && pwd)"
export C5_VIDEO_LAVORO="${C5_VIDEO_LAVORO:-${TMPDIR:-/tmp}/c5-video-lavoro}"
for c in ffmpeg ffprobe node python3; do
  command -v "$c" >/dev/null || { echo "Manca $c" >&2; exit 1; }
done
# Playwright: va bene sia installato nel progetto sia globale (NODE_PATH)
if ! node -e "require('playwright')" 2>/dev/null; then
  export NODE_PATH="${NODE_PATH:-$(npm root -g 2>/dev/null)}"
  node -e "require('playwright')" 2>/dev/null || { echo "Manca Playwright per Node (npm i -g playwright && npx playwright install chromium)" >&2; exit 1; }
fi
exec python3 "$QUI/scene/monta.py" "$@"
