#!/usr/bin/env bash
# Test sul PC dei moduli portabili del firmware (nessun hardware, nessun ESP-IDF):
#   - sensor_math.c: conversioni dei sensori (vettori dei datasheet);
#   - contapersone.c: finestra scorrevole delle pressioni della rotella SU;
#   - payload.c: topic e JSON; ogni messaggio prodotto passa da firmware/valida-messaggi.mjs,
#     cioè rispetta il formato unico napoli/ (zone prese dallo scenario di c5-agentic-city, se c'è).
# Uso: firmware/why2025-badge/test/run.sh   (servono cc e node ≥ 18)
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
SRC="$HERE/../overlay/main/badge"
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT
CC=${CC:-cc}
FLAGS=(-std=c11 -Wall -Wextra -Werror -I"$SRC")

$CC "${FLAGS[@]}" "$HERE/sensor_math_host_test.c" "$SRC/sensor_math.c" -lm -o "$OUT/sensor_math"
"$OUT/sensor_math"

$CC "${FLAGS[@]}" "$HERE/contapersone_host_test.c" "$SRC/contapersone.c" -o "$OUT/contapersone"
"$OUT/contapersone"

$CC "${FLAGS[@]}" "$HERE/payload_host_test.c" "$SRC/payload.c" -lm -o "$OUT/payload"
"$OUT/payload" > "$OUT/messaggi.txt"

node "$HERE/../../valida-messaggi.mjs" "$OUT/messaggi.txt"
