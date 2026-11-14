#!/usr/bin/env bash
# Stato del broker: container, salute, scadenza del certificato e statistiche da $SYS.
#   ./scripts/stato.sh
# Usa l'utente monitor (password MQTT_MONITOR_PASSWORD in .env).
. "$(dirname "$0")/_comune.sh"

docker compose ps mosquitto
broker_attivo || exit 1

echo
echo "Certificato TLS in uso:"
docker compose exec -T mosquitto /bin/sh -c 'cat /mosquitto/run/fullchain.pem' \
    | openssl x509 -noout -subject -enddate 2>/dev/null | sed 's/^/  /' \
    || echo "  (serve openssl sul server per leggere la scadenza)"

PW="$(env_valore MQTT_MONITOR_PASSWORD)"
if [ -z "$PW" ]; then avviso "MQTT_MONITOR_PASSWORD vuota in .env: niente statistiche"; exit 0; fi
echo
echo "Statistiche (\$SYS):"
docker compose exec -T -e MQTT_PASSWORD="$PW" mosquitto /bin/sh -c '
    mosquitto_sub -h 127.0.0.1 -p 1883 -u monitor -P "$MQTT_PASSWORD" -i "stato-$$" -W 3 -v \
        -t "\$SYS/broker/version" -t "\$SYS/broker/uptime" \
        -t "\$SYS/broker/clients/connected" -t "\$SYS/broker/clients/total" \
        -t "\$SYS/broker/subscriptions/count" -t "\$SYS/broker/retained messages/count" \
        -t "\$SYS/broker/messages/received" -t "\$SYS/broker/messages/sent" \
        -t "\$SYS/broker/load/messages/received/1min" -t "\$SYS/broker/heap/current" \
        2>/dev/null | sed "s|^\$SYS/broker/|  |"; true'
