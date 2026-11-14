#!/usr/bin/env bash
# Crea un utente MQTT (o ne cambia la password) e ricarica il broker.
#
#   ./scripts/aggiungi-utente.sh <utente>          genera una password casuale e la stampa
#   ./scripts/aggiungi-utente.sh <utente> -        legge la password da tastiera o da stdin
#
# Dispositivi: nome utente = id del badge oppure = Topic di Tasmota. I permessi arrivano dai
# pattern di config/acl (napoli/sensori/<utente>/#, napoli/nodi/<utente>/#), senza modificarla:
#   ./scripts/aggiungi-utente.sh badge-1
#   ./scripts/aggiungi-utente.sh tasmota-1
# Ruoli fissi (permessi in config/acl): admin, c5, dashboard, monitor.
#
# La password non passa mai sulla riga di comando: arriva a mosquitto_passwd (dentro il
# container, che la salva come hash PBKDF2-SHA512) tramite stdin.
. "$(dirname "$0")/_comune.sh"

[ $# -ge 1 ] && [ $# -le 2 ] || { sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }
UTENTE="$1"
utente_valido "$UTENTE" || errore "nome utente non valido: '$UTENTE' (1-64 caratteri tra lettere, cifre, . _ -)"

if [ "${2:-}" = "-" ]; then
    if [ -t 0 ]; then
        read -r -s -p "Password per $UTENTE: " PW; echo
        read -r -s -p "Ripeti la password: " PW2; echo
        [ "$PW" = "$PW2" ] || errore "le password non coincidono"
    else
        IFS= read -r PW || true
    fi
    [ "${#PW}" -ge 12 ] || errore "password troppo corta (minimo 12 caratteri)"
    GENERATA=0
elif [ $# -eq 1 ]; then
    PW="$(genera_password)"
    GENERATA=1
else
    errore "il secondo argomento può essere solo '-' (password da stdin)"
fi

if elenco_utenti | grep -qx -- "$UTENTE"; then AZIONE="aggiornato"; else AZIONE="creato"; fi
printf '%s\n' "$PW" | imposta_password "$UTENTE"
echo "Utente $UTENTE $AZIONE."
[ "$GENERATA" = 1 ] && echo "Password: $PW"
ricarica_broker
