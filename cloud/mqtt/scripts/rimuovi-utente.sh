#!/usr/bin/env bash
# Elimina un utente MQTT e ricarica il broker.
#   ./scripts/rimuovi-utente.sh <utente>
# Chi è già connesso con quell'utente resta connesso fino alla disconnessione: per
# buttarlo fuori subito, dopo lo script: docker compose restart mosquitto
. "$(dirname "$0")/_comune.sh"

[ $# -eq 1 ] || { sed -n '2,5p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }
UTENTE="$1"
utente_valido "$UTENTE" || errore "nome utente non valido: '$UTENTE'"
elenco_utenti | grep -qx -- "$UTENTE" || errore "l'utente $UTENTE non esiste"

nel_container '
    set -e
    f='"$PASSWD_CONTAINER"'
    chown 0:0 "$f"
    mosquitto_passwd -D "$f" "$1"
    chmod 0600 "$f" && chown 1883:1883 "$f"' sh "$UTENTE"
echo "Utente $UTENTE eliminato."
ricarica_broker
