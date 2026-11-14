#!/usr/bin/env bash
# Solo con TLS acceso (MQTT_CERTIFICATI=letsencrypt; oggi è spento). Dopo il rinnovo di Let's
# Encrypt ricopia i certificati nel container e ricarica Mosquitto con SIGHUP, senza disconnettere
# nessuno. Senza root sul server (twinciro.robertodisanto.it) va nel crontab dell'utente, che
# rilegge la copia fatta da cloud/certificati/copia-certificati.sh:
#   (crontab -l; echo "17 4 * * * $PWD/scripts/rinnova-certificati.sh >/dev/null") | crontab -
# Chi ha root può invece agganciarlo agli hook di certbot (renewal-hooks/deploy).
# Se qualcosa va storto basta anche: docker compose restart mosquitto
. "$(dirname "$0")/_comune.sh"

DOMINIO="$(env_valore MQTT_DOMINIO twinciro.robertodisanto.it)"
# certbot passa i domini rinnovati in RENEWED_DOMAINS: ignora i rinnovi di altri siti.
if [ -n "${RENEWED_DOMAINS:-}" ] && [[ " $RENEWED_DOMAINS " != *" $DOMINIO "* ]]; then
    exit 0
fi
if [ "$(env_valore MQTT_CERTIFICATI nessuno)" != letsencrypt ]; then
    echo "MQTT_CERTIFICATI non è 'letsencrypt': niente da fare."; exit 0
fi
if ! broker_attivo; then
    echo "Broker non attivo: i certificati nuovi verranno letti al prossimo avvio."; exit 0
fi
ricarica_broker
