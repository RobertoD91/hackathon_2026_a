#!/usr/bin/env bash
# Test sul PC dei moduli portabili del firmware (nessun hardware, nessun ESP-IDF):
#   - sensor_math.c: conversioni dei sensori (vettori dei datasheet);
#   - payload.c: JSON e topic; ogni lettura prodotta passa dal validatore del hub
#     (shared/iot-agents/src/validate.js), cioè rispetta il contratto.
# Uso: shared/iot-agents/firmware/why2025-badge/test/run.sh   (servono cc e node ≥ 20)
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
SRC="$HERE/../overlay/main/badge"
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT
CC=${CC:-cc}

$CC -std=c11 -Wall -Wextra -Werror -I"$SRC" "$HERE/sensor_math_host_test.c" "$SRC/sensor_math.c" -lm -o "$OUT/sensor_math"
"$OUT/sensor_math"

$CC -std=c11 -Wall -Wextra -Werror -I"$SRC" "$HERE/payload_host_test.c" "$SRC/payload.c" -lm -o "$OUT/payload"
"$OUT/payload" > "$OUT/readings.txt"

node --input-type=module -e "
import { readFileSync } from 'node:fs';
import { validateReading } from '$HERE/../../../src/validate.js';
const lines = readFileSync('$OUT/readings.txt', 'utf8').split('\n').filter((l) => l.startsWith('READING '));
let bad = 0;
for (const l of lines) {
  const body = JSON.parse(l.slice(8));
  const r = validateReading(body);
  if (!r.ok) { bad++; console.error('NON VALIDA:', r.error, l); }
}
console.log(\`validate.js: \${lines.length - bad}/\${lines.length} letture del firmware valide per il hub\`);
process.exit(bad ? 1 : 0);
"
