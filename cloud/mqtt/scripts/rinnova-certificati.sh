#!/usr/bin/env bash
# Hook di certbot: dopo il rinnovo di Let's Encrypt ricopia i certificati nel container e
# ricarica Mosquitto con SIGHUP, senza disconnettere nessuno. Installazione (una volta):
#   sudo ln -s "$PWD/scripts/rinnova-certificati.sh" /etc/letsencrypt/renewal-hooks/deploy/bighack-mqtt.sh
# Prova a mano: sudo certbot renew --dry-run   (oppure lancia direttamente questo script)
# Se qualcosa va storto basta anche: docker compose restart mosquitto
. "$(dirname "$0")/_comune.sh"

DOMINIO="$(env_valore MQTT_DOMINIO twinciro.robertodisanto.it)"
# certbot passa i domini rinnovati in RENEWED_DOMAINS: ignora i rinnovi di altri siti.
if [ -n "${RENEWED_DOMAINS:-}" ] && [[ " $RENEWED_DOMAINS " != *" $DOMINIO "* ]]; then
    exit 0
fi
if [ "$(env_valore MQTT_CERTIFICATI letsencrypt)" != letsencrypt ]; then
    echo "MQTT_CERTIFICATI non è 'letsencrypt': niente da fare."; exit 0
fi
if ! broker_attivo; then
    echo "Broker non attivo: i certificati nuovi verranno letti al prossimo avvio."; exit 0
fi
ricarica_broker
