#!/usr/bin/env bash
# Prima installazione del broker (si può rilanciare: non tocca gli utenti già esistenti).
# Non serve root sul server: basta un utente che possa usare Docker.
#   ./scripts/inizializza.sh                 come dice .env (predefinito: MQTT in chiaro, niente TLS)
#   ./scripts/inizializza.sh --autofirmato   accende TLS con certificati autofirmati (prove, portatile)
#
# 1. crea .env da .env.example (se manca) e la cartella segreti/ (0700);
# 2. se TLS è acceso, controlla i certificati (o genera quelli autofirmati);
# 3. crea gli utenti di servizio con password casuali: admin, c5, dashboard, monitor.
#    La password di monitor va anche in .env; tutte sono stampate una volta e salvate in
#    segreti/credenziali-iniziali.txt (0600): distribuiscile e poi cancella il file.
#    Gli utenti dei dispositivi (badge, Tasmota) si creano a parte: ./scripts/aggiungi-utente.sh <id>;
# 4. controlla la configurazione di Mosquitto.
# Segnala gli utenti di servizio che non servono più (ponte, c5-plastico) da eliminare a mano.
. "$(dirname "$0")/_comune.sh"

AUTOFIRMATO=0
[ "${1:-}" = "--autofirmato" ] && AUTOFIRMATO=1

# ------------------------------------------------------------------ 1. .env e segreti/
if [ ! -f .env ]; then
    cp .env.example .env && chmod 600 .env
    echo "Creato .env da .env.example."
fi
prepara_cartelle
if [ "$AUTOFIRMATO" = 1 ]; then
    env_imposta MQTT_CERTIFICATI autofirmato
    env_imposta LETSENCRYPT_DIR ./segreti
fi
DOMINIO="$(env_valore MQTT_DOMINIO twinciro.robertodisanto.it)"
CERTIFICATI="$(env_valore MQTT_CERTIFICATI nessuno)"
LE_DIR="$(env_valore LETSENCRYPT_DIR ./segreti)"

# ------------------------------------------------------------------ 2. certificati
echo "Immagine: $IMMAGINE"
docker image inspect "$IMMAGINE" >/dev/null 2>&1 || docker compose pull mosquitto
case "$CERTIFICATI" in
    nessuno)
        echo "TLS spento (MQTT_CERTIFICATI=nessuno): solo MQTT in chiaro sulla $(env_valore MQTT_PORTA 1883), con password."
        ;;
    letsencrypt)
        # Controllo fatto da un container: è lui che deve leggere i certificati.
        [ -d "$LE_DIR" ] || errore "la cartella $LE_DIR non esiste (LETSENCRYPT_DIR in .env)"
        if ! docker run --rm -v "$(cd "$LE_DIR" && pwd):/le:ro" --entrypoint /bin/sh "$IMMAGINE" \
                -c "for d in /le/live/$DOMINIO /le/$DOMINIO; do test -r \$d/fullchain.pem && test -r \$d/privkey.pem && exit 0; done; exit 1"; then
            errore "non trovo {fullchain,privkey}.pem in $LE_DIR/live/$DOMINIO/ né in $LE_DIR/$DOMINIO/.
  Chiedi all'amministratore del server la copia leggibile dei certificati (README, \"TLS senza root\"),
  oppure torna senza TLS: MQTT_CERTIFICATI=nessuno in .env"
        fi
        echo "Certificati Let's Encrypt trovati in $LE_DIR (dominio $DOMINIO)"
        ;;
    autofirmato)
        if [ ! -f segreti/certs-autofirmati/fullchain.pem ]; then
            "$MQTT_DIR/scripts/certificati-autofirmati.sh"
        else
            echo "Certificati autofirmati già presenti: segreti/certs-autofirmati/"
        fi
        ;;
    *) errore "MQTT_CERTIFICATI in .env deve essere 'nessuno', 'letsencrypt' o 'autofirmato'" ;;
esac

# ------------------------------------------------------------------ 3. utenti di servizio
ESISTENTI="$(elenco_utenti)"
CREDENZIALI=segreti/credenziali-iniziali.txt
NUOVI=()
for u in admin c5 dashboard monitor; do
    if grep -qx -- "$u" <<<"$ESISTENTI"; then
        echo "Utente $u: già presente."
        continue
    fi
    pw="$(genera_password)"
    printf '%s\n' "$pw" | imposta_password "$u"
    NUOVI+=("$u $pw")
    if [ "$u" = monitor ]; then env_imposta MQTT_MONITOR_PASSWORD "$pw"; fi
    echo "Utente $u: creato."
done
if [ "${#NUOVI[@]}" -gt 0 ]; then
    umask 077
    {
        echo "# Credenziali MQTT generate il $(date '+%Y-%m-%d %H:%M') per $DOMINIO."
        echo "# Distribuiscile (gestore di password, non in chat pubbliche) e poi CANCELLA questo file."
        printf '%s\n' "${NUOVI[@]}"
    } >> "$CREDENZIALI"
    echo
    echo "Nuove credenziali (utente password), salvate anche in $CREDENZIALI:"
    printf '  %s\n' "${NUOVI[@]}"
    echo
fi

# Ruoli che non esistono più (il ponte MQTT -> hub e gli ESP32 del plastico sono stati tolti il 14/11).
for u in ponte c5-plastico; do
    if grep -qx -- "$u" <<<"$ESISTENTI"; then
        avviso "l'utente $u non serve più (nessun permesso nell'ACL): ./scripts/rimuovi-utente.sh $u"
    fi
done

# ------------------------------------------------------------------ 4. controllo
echo "Controllo della configurazione..."
verifica_configurazione || errore "configurazione non valida"
ricarica_broker >/dev/null
cat <<EOF

Pronto. Prossimi passi:
  docker compose up -d                    avvia il broker
  docker compose ps                       deve risultare "healthy" dopo qualche secondo
  ./scripts/prova.sh                      prova anonimo rifiutato, formato napoli/, ACL (TLS e WSS se accesi)
  ./scripts/aggiungi-utente.sh <id>       un utente per ogni dispositivo (badge-1, tasmota-1)
EOF
