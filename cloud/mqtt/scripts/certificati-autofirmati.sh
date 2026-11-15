#!/usr/bin/env bash
# Certificati TLS autofirmati per le prove (o finché Let's Encrypt non è pronto).
#   ./scripts/certificati-autofirmati.sh [nome-host ...]
# Crea in segreti/certs-autofirmati/ una piccola CA (ca.crt, ca.key) e il certificato del
# broker (fullchain.pem, privkey.pem) valido per MQTT_DOMINIO, localhost, 127.0.0.1 e gli
# eventuali nomi o IP passati come argomenti (es. l'IP del portatile in una rete locale).
# Poi in .env: MQTT_CERTIFICATI=autofirmato e LETSENCRYPT_DIR=./segreti, e riavvia.
#
# I client devono fidarsi di ca.crt: mosquitto_sub --cafile ca.crt, badge TELEMETRY_MQTT_CA_PEM,
# MQTT Explorer "Server certificate (CA)". Il browser invece rifiuta wss:// autofirmato
# finché non apri una volta https://<host>:8884/ e accetti il certificato.
. "$(dirname "$0")/_comune.sh"
command -v openssl >/dev/null || errore "serve openssl (apt install openssl)"

DOMINIO="$(env_valore MQTT_DOMINIO twinciro.robertodisanto.it)"
DIR=segreti/certs-autofirmati
prepara_cartelle && mkdir -p "$DIR" && chmod 700 "$DIR"

SAN="DNS:$DOMINIO,DNS:localhost,IP:127.0.0.1"
for nome in "$@"; do
    if [[ "$nome" =~ ^[0-9.]+$ || "$nome" == *:* ]]; then SAN="$SAN,IP:$nome"; else SAN="$SAN,DNS:$nome"; fi
done

umask 077
if [ ! -f "$DIR/ca.key" ]; then
    openssl req -x509 -newkey rsa:3072 -sha256 -nodes -days 3650 \
        -subj "/CN=Big Hack MQTT CA di prova" \
        -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign" \
        -keyout "$DIR/ca.key" -out "$DIR/ca.crt" 2>/dev/null
    echo "Creata la CA di prova: $DIR/ca.crt"
fi
openssl req -newkey rsa:2048 -sha256 -nodes -subj "/CN=$DOMINIO" \
    -keyout "$DIR/privkey.pem" -out "$DIR/server.csr" 2>/dev/null
printf 'basicConstraints=CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=%s\n' "$SAN" > "$DIR/server.ext"
openssl x509 -req -sha256 -days 825 -in "$DIR/server.csr" -CA "$DIR/ca.crt" -CAkey "$DIR/ca.key" \
    -CAcreateserial -extfile "$DIR/server.ext" -out "$DIR/server.crt" 2>/dev/null
cat "$DIR/server.crt" "$DIR/ca.crt" > "$DIR/fullchain.pem"
rm -f "$DIR/server.csr" "$DIR/server.ext" "$DIR/server.crt" "$DIR/ca.srl"
# ca.crt è pubblico (va sui client); le chiavi restano 0600.
chmod 644 "$DIR/ca.crt"

echo "Certificato del broker: $DIR/fullchain.pem (nomi: $SAN)"
if [ "$(env_valore MQTT_CERTIFICATI letsencrypt)" != autofirmato ]; then
    echo "Per usarlo, in .env: MQTT_CERTIFICATI=autofirmato e LETSENCRYPT_DIR=./segreti, poi"
    echo "docker compose up -d --force-recreate"
elif broker_attivo; then
    ricarica_broker
fi
