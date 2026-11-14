#!/usr/bin/env bash
# build.sh: firmware del badge WHY2025/EMF2026 con la telemetria MQTT, costruito SOPRA il repo
# originale (https://github.com/CyberSaiyanIT/why2025-badge, ESP-IDF 4.4 via PlatformIO).
#
#   ./build.sh            prepara upstream/ e compila
#   ./build.sh upload     compila e carica il firmware sul badge (USB-C)
#   ./build.sh uploadfs   carica il filesystem SPIFFS (solo badge nuovi o dopo un reset)
#   ./build.sh monitor    monitor seriale a 115200
#   ./build.sh prepare    solo preparazione (clone + overlay + patch + sdkconfig), senza compilare
#
# Variabili: BADGE_DIR (copia di lavoro, predefinita ./upstream), CONFIG (file di configurazione,
# predefinito ./telemetry_config.h), EXAMPLE_CONFIG=1 (compila con l'esempio: solo per provare
# la compilazione), PIO (comando PlatformIO, predefinito "pio"), PORT (porta seriale).
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
UPSTREAM_URL=${UPSTREAM_URL:-https://github.com/CyberSaiyanIT/why2025-badge}
UPSTREAM_BRANCH=EMF2026
UPSTREAM_COMMIT=861cebc039e3e15dd685c030dcd92f18d786e17b   # 18/07/2026, "Rainbow screen: ..."
BADGE_DIR=${BADGE_DIR:-$HERE/upstream}
CONFIG=${CONFIG:-$HERE/telemetry_config.h}
ENV_NAME=emf2026-badge
PIO=${PIO:-pio}
ACTION=${1:-build}

say() { printf '\033[1m[badge]\033[0m %s\n' "$*"; }
die() { printf '\033[31m[badge] %s\033[0m\n' "$*" >&2; exit 1; }

prepare() {
  # 1) repo originale, alla versione su cui sono state scritte le patch
  if [ ! -d "$BADGE_DIR/.git" ]; then
    say "clone di $UPSTREAM_URL ($UPSTREAM_BRANCH) in $BADGE_DIR"
    git clone --depth 1 --branch "$UPSTREAM_BRANCH" "$UPSTREAM_URL" "$BADGE_DIR"
  fi
  if [ "$(git -C "$BADGE_DIR" rev-parse HEAD)" != "$UPSTREAM_COMMIT" ]; then
    say "porto $BADGE_DIR al commit $UPSTREAM_COMMIT"
    git -C "$BADGE_DIR" fetch --depth 1 origin "$UPSTREAM_COMMIT" && git -C "$BADGE_DIR" checkout -q "$UPSTREAM_COMMIT" \
      || say "ATTENZIONE: commit non disponibile, provo con la versione attuale (le patch potrebbero non applicarsi)"
  fi

  # 2) riparto pulito: file originali ripristinati, file aggiunti in main/ rimossi (la cache .pio resta)
  git -C "$BADGE_DIR" checkout -q -- main "sdkconfig.$ENV_NAME"
  git -C "$BADGE_DIR" clean -fdq -- main

  # 3) file nuovi (overlay/) + configurazione
  cp -R "$HERE/overlay/." "$BADGE_DIR/"
  if [ -f "$CONFIG" ]; then
    cp "$CONFIG" "$BADGE_DIR/main/badge/telemetry_config.h"
  elif [ "${EXAMPLE_CONFIG:-0}" = 1 ]; then
    say "ATTENZIONE: uso telemetry_config.example.h (Wi-Fi e broker d'esempio: il badge non si collegherà)"
    cp "$HERE/telemetry_config.example.h" "$BADGE_DIR/main/badge/telemetry_config.h"
  else
    die "manca $CONFIG: cp telemetry_config.example.h telemetry_config.h e mettici Wi-Fi e broker (oppure EXAMPLE_CONFIG=1 per provare la compilazione)"
  fi

  # 4) modifiche ai file originali (main.c, ui.c, wifi.c)
  for p in "$HERE"/patches/*.patch; do
    say "patch $(basename "$p")"
    git -C "$BADGE_DIR" apply --whitespace=nowarn "$p"
  done

  # 5) opzioni ESP-IDF (sdkconfig.telemetry) dentro sdkconfig.emf2026-badge
  local sdk="$BADGE_DIR/sdkconfig.$ENV_NAME" line name
  while IFS= read -r line || [ -n "$line" ]; do
    name=$(printf '%s\n' "$line" | sed -nE 's/^(# )?(CONFIG_[A-Z0-9_]+)( is not set|=.*)$/\2/p')
    [ -n "$name" ] || continue
    grep -vE "^(# )?${name}( is not set|=)" "$sdk" > "$sdk.tmp" || true
    mv "$sdk.tmp" "$sdk"
    printf '%s\n' "$line" >> "$sdk"
  done < "$HERE/sdkconfig.telemetry"
  say "pronto: $BADGE_DIR"
}

pio_run() {
  command -v "$PIO" >/dev/null 2>&1 || die "PlatformIO non trovato: pip install platformio (oppure PIO=/percorso/pio)"
  (cd "$BADGE_DIR" && "$PIO" run -e "$ENV_NAME" "$@")
}

case "$ACTION" in
  prepare) prepare ;;
  build) prepare; pio_run ;;
  upload) prepare; pio_run -t upload ${PORT:+--upload-port "$PORT"} ;;
  uploadfs) [ -d "$BADGE_DIR/.git" ] || prepare; pio_run -t uploadfs ${PORT:+--upload-port "$PORT"} ;;
  monitor) command -v "$PIO" >/dev/null 2>&1 || die "PlatformIO non trovato"; (cd "$BADGE_DIR" && "$PIO" device monitor -b 115200 ${PORT:+-p "$PORT"}) ;;
  *) die "azione sconosciuta: $ACTION (prepare | build | upload | uploadfs | monitor)" ;;
esac
