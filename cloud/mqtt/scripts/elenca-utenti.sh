#!/usr/bin/env bash
# Elenca gli utenti MQTT (solo i nomi: le password sono salvate come hash).
#   ./scripts/elenca-utenti.sh
. "$(dirname "$0")/_comune.sh"
elenco_utenti
