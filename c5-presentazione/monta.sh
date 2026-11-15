#!/usr/bin/env bash
# Monta il video di consegna di TwinCIRO: c5-presentazione/bozza.mp4 (1920×1080, 30 fps, H.264, ≤ 3:00, ≤ 40 MB).
# Accanto scrive clip/ (una clip per scena senza sottotitoli, gli SRT, il video intero senza sottotitoli: vedi
# clip/LEGGIMI.md) e voce/ (le battute da leggere, con chi le legge: vedi voce/COPIONE-VOCE.md). Tutte e due vanno nel repository.
#
#   ./monta.sh                    # rimonta con le sorgenti in cache (circa 10 minuti la prima volta, poi 3-4)
#   ./monta.sh --rigenera         # rigenera cartelli, architettura e chat (dopo aver cambiato testi o chat.json)
#   ./monta.sh --rigenera-mappa   # registra di nuovo la mappa con i dati live di adesso
#   ./monta.sh --solo-clip        # rifà clip, SRT e testi della voce, non bozza.mp4 (salta la codifica in due passate)
#   ./monta.sh --solo-testi       # rifà solo voce/ e controlla tempi e ritmo delle battute (un secondo, niente video)
#   ./monta.sh --controllo        # alla fine estrae un fotogramma ogni 5 s per controllare impaginazione e refusi
#   ./monta.sh --segnaposto       # dove manca una ripresa vera mostra il cartello "Qui va una ripresa reale"
#   ./monta.sh --senza-voce-sintetica   # solo la voce registrata: le battute non registrate restano mute
#   ./monta.sh --senza-musica     # niente musica di sottofondo
#
# Le riprese vere vanno in girato/ (vedi girato/LEGGIMI.md): se un file c'è, prende il posto della scena generata.
# La voce: girato/voce.m4a (tutto il video), oppure girato/voce/NN-<scena>.m4a (una clip) o girato/voce/NN-<scena>-K.m4a
# (la battuta K), con i nomi scritti in voce/COPIONE-VOCE.md. La musica, solo se libera da diritti, in girato/musica.mp3.
# Dove girato/ non ha di meglio si usano la musica CC0 e la voce sintetica di prova di audio/ (vedi audio/LEGGIMI.md).
# Serve: ffmpeg, Node con Playwright e Chromium, python3 (solo libreria standard).
set -euo pipefail
QUI="$(cd "$(dirname "$0")" && pwd)"
export C5_VIDEO_LAVORO="${C5_VIDEO_LAVORO:-${TMPDIR:-/tmp}/c5-video-lavoro}"
export PYTHONDONTWRITEBYTECODE=1
# Solo i testi della voce: bastano python3 e la scaletta
for arg in "$@"; do
  [ "$arg" = "--solo-testi" ] && exec python3 "$QUI/scene/monta.py" "$@"
done
for c in ffmpeg ffprobe node python3; do
  command -v "$c" >/dev/null || { echo "Manca $c" >&2; exit 1; }
done
# Playwright: va bene sia installato nel progetto sia globale (NODE_PATH)
if ! node -e "require('playwright')" 2>/dev/null; then
  export NODE_PATH="${NODE_PATH:-$(npm root -g 2>/dev/null)}"
  node -e "require('playwright')" 2>/dev/null || { echo "Manca Playwright per Node (npm i -g playwright && npx playwright install chromium)" >&2; exit 1; }
fi
exec python3 "$QUI/scene/monta.py" "$@"
