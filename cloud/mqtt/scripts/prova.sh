#!/usr/bin/env bash
# Prova completa del broker, da eseguire sul server con il broker avviato:
#   ./scripts/prova.sh [host]        host predefinito: MQTT_DOMINIO di .env
# Crea un utente-dispositivo temporaneo (prova-XXXX), verifica e poi lo elimina:
#   - connessione anonima e password errata rifiutate (1883);
#   - pubblicazione e iscrizione sui propri topic bighack/... (1883, 8883 TLS, 8884 WSS);
#   - ACL: scrittura negata sui topic di un altro dispositivo e su napoli/...;
#   - WebSocket in chiaro su 9001 (solo se l'host è questo server).
# I client girano in un container (stessa immagine del broker): sul server basta Docker.
# Esce con 0 se tutto va bene, altrimenti con il numero di prove fallite.
. "$(dirname "$0")/_comune.sh"

DOMINIO="$(env_valore MQTT_DOMINIO twinciro.robertodisanto.it)"
HOST="${1:-$DOMINIO}"
CERTIFICATI="$(env_valore MQTT_CERTIFICATI letsencrypt)"
broker_attivo || errore "il broker non è attivo (docker compose up -d)"

# Fiducia nel certificato: CA di sistema per Let's Encrypt, ca.crt per gli autofirmati.
CA_MONTA=()
if [ "$CERTIFICATI" = autofirmato ]; then
    TLS="--cafile /ca/ca.crt"
    CA_MONTA=(-v "$MQTT_DIR/segreti/certs-autofirmati:/ca:ro")
else
    TLS="--tls-use-os-certs"
    if [ "$HOST" != "$DOMINIO" ]; then
        avviso "il certificato è per $DOMINIO, non per $HOST: salto la verifica del nome (--insecure)"
        TLS="$TLS --insecure"
    fi
fi
case "$HOST" in localhost|127.0.0.1|::1) WS_LOCALE=1 ;; *) WS_LOCALE=0 ;; esac

UTENTE="prova-$(genera_password | head -c 8)"
PW="$(genera_password)"
pulizia() {
    nel_container '
        set -e; f='"$PASSWD_CONTAINER"'; chown 0:0 "$f"
        mosquitto_passwd -D "$f" "$1" >/dev/null; chmod 0600 "$f"; chown 1883:1883 "$f"' sh "$UTENTE" \
        >/dev/null 2>&1 || avviso "non sono riuscito a eliminare l'utente $UTENTE: ./scripts/rimuovi-utente.sh $UTENTE"
    ricarica_broker >/dev/null
}
trap pulizia EXIT
printf '%s\n' "$PW" | imposta_password "$UTENTE"
ricarica_broker >/dev/null
sleep 1

echo "Prove su $HOST con l'utente temporaneo $UTENTE (certificati: $CERTIFICATI)"
docker run --rm -i --network host "${CA_MONTA[@]}" \
    -e H="$HOST" -e U="$UTENTE" -e PW="$PW" -e TLS="$TLS" -e WS_LOCALE="$WS_LOCALE" \
    -e P1="$(env_valore MQTT_PORTA 1883)" -e P2="$(env_valore MQTTS_PORTA 8883)" \
    -e P3="$(env_valore WSS_PORTA 8884)" -e P4="$(env_valore WS_PORTA 9001)" \
    --entrypoint /bin/sh "$IMMAGINE" -s <<'PROVE'
falliti=0
ok()  { echo "  OK      $1"; }
ko()  { echo "  ERRORE  $1"; [ -n "${2:-}" ] && echo "          $2"; falliti=$((falliti + 1)); }

# Rifiuto: la connessione deve fallire con "not authorised".
rifiuto() { # descrizione, argomenti di mosquitto_pub
    d="$1"; shift
    out="$(mosquitto_pub -h "$H" "$@" -t bighack/prova/x/readings -m x 2>&1 </dev/null)"
    case "$out" in *[Nn]ot\ authori*) ok "$d" ;; *) ko "$d" "$out" ;; esac
}

# Andata e ritorno: iscrizione ai propri topic, pubblicazione, il messaggio deve tornare.
giro() { # descrizione, opzioni di connessione (porta, TLS, --ws)
    d="$1"; shift
    msg="{\"deviceId\":\"$U\",\"readings\":{\"temperature_c\":$(date +%s)},\"prova\":\"$d\"}"
    mosquitto_sub -h "$H" "$@" -u "$U" -P "$PW" -t "bighack/+/$U/#" -C 1 -W 10 > /tmp/ricevuto 2>&1 </dev/null &
    sub=$!
    sleep 1
    pub="$(mosquitto_pub -h "$H" "$@" -u "$U" -P "$PW" -t "bighack/prova/$U/readings" -m "$msg" 2>&1 </dev/null)"
    wait $sub
    if [ "$(cat /tmp/ricevuto)" = "$msg" ]; then ok "$d"; else ko "$d" "$pub $(cat /tmp/ricevuto)"; fi
}

# ACL: pubblicazione MQTT v5 con QoS 1, il broker risponde "not authorized" nel PUBACK.
negato() { # descrizione, topic
    out="$(mosquitto_pub -h "$H" -p "$P1" -V 5 -q 1 -u "$U" -P "$PW" -t "$2" -m x 2>&1 </dev/null)"
    case "$out" in *[Nn]ot\ authori*) ok "$1" ;; *) ko "$1" "risposta: ${out:-nessun errore, pubblicazione accettata}" ;; esac
}

echo "Autenticazione"
rifiuto "anonimo rifiutato su $P1" -p "$P1"
rifiuto "password errata rifiutata su $P1" -p "$P1" -u "$U" -P sbagliata
rifiuto "anonimo rifiutato su $P2 (TLS)" -p "$P2" $TLS
echo "Pubblicazione e iscrizione"
giro "MQTT $P1" -p "$P1"
giro "MQTT su TLS $P2" -p "$P2" $TLS
giro "WebSocket su TLS $P3 (wss://)" -p "$P3" --ws $TLS
if [ "$WS_LOCALE" = 1 ]; then giro "WebSocket in chiaro $P4 (solo locale)" -p "$P4" --ws; fi
echo "Permessi (ACL)"
negato "negato: topic di un altro dispositivo" "bighack/prova/altro-dispositivo/readings"
negato "negato: napoli/kpi" "napoli/kpi"
negato "negato: tele/altro/SENSOR" "tele/altro/SENSOR"

echo
if [ "$falliti" = 0 ]; then echo "Tutte le prove sono passate."; else echo "Prove fallite: $falliti"; fi
exit "$falliti"
PROVE
