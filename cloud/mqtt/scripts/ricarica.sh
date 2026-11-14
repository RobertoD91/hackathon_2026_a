#!/usr/bin/env bash
# Dopo una modifica a config/acl o config/mosquitto.conf: controlla la configurazione e,
# se è valida, ricarica il broker con SIGHUP (nessuna disconnessione).
#   ./scripts/ricarica.sh
# Le opzioni "listener", "plugin" e "user" non si ricaricano: per quelle
#   docker compose restart mosquitto
. "$(dirname "$0")/_comune.sh"

echo "Controllo della configurazione..."
verifica_configurazione || errore "configurazione non valida: broker NON ricaricato"
ricarica_broker
