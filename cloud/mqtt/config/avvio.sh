#!/bin/sh
# Avvio del container mosquitto. Gira come root, prima che Mosquitto scenda all'utente
# "mosquitto" (uid 1883), e poi passa il controllo all'entrypoint dell'immagine.
#
# 1. Copia in /mosquitto/run (tmpfs, solo in memoria), con proprietario uid 1883 e
#    permessi 0600, i file che Mosquitto legge DOPO aver lasciato root:
#    - i certificati TLS, solo se TLS è acceso (MQTT_CERTIFICATI diverso da "nessuno"), insieme
#      a conf.d/tls.conf con le porte 8883 e 8884. Con "nessuno" (predefinito) conf.d resta
#      vuota e il broker ascolta solo in chiaro (1883 con password, 9001 per il proxy locale). Mosquitto 2.1 rifiuta i percorsi con link simbolici e gira come
#      uid 1883, mentre /etc/letsencrypt/live/<dominio>/ contiene link simbolici verso
#      archive/, leggibile solo da root: così i permessi di /etc/letsencrypt restano intatti.
#        MQTT_CERTIFICATI=nessuno      niente TLS (predefinito)
#        MQTT_CERTIFICATI=letsencrypt  /etc/letsencrypt/live/$MQTT_DOMINIO/{fullchain,privkey}.pem
#        MQTT_CERTIFICATI=autofirmato  /mosquitto/segreti/certs-autofirmati/{fullchain,privkey}.pem
#    - l'ACL (config/acl): Mosquitto 2.1 avverte che le versioni future rifiuteranno un'ACL
#      leggibile da tutti o non di proprietà dell'utente mosquitto.
# 2. Sistema proprietario e permessi di /mosquitto/utenti e del file delle password.
# 3. Esegue /docker-entrypoint.sh con il comando ricevuto.
#
# Con --copia fa solo il punto 1 ed esce: lo usano scripts/ricarica.sh (dopo una modifica
# all'ACL) e scripts/rinnova-certificati.sh (dopo il rinnovo di Let's Encrypt), seguiti da
# SIGHUP. Per questo un SIGHUP mandato a mano NON rilegge config/acl né i certificati.
set -eu

UID_MOSQ="${PUID:-1883}"
GID_MOSQ="${PGID:-1883}"
DOMINIO="${MQTT_DOMINIO:-twinciro.robertodisanto.it}"
SORGENTE="${MQTT_CERTIFICATI:-nessuno}"
RUN=/mosquitto/run
PASSWD=/mosquitto/utenti/passwd

errore() { echo "avvio.sh: ERRORE: $*" >&2; exit 1; }

# Proprietario uid 1883 e permessi dati. chown a root prima di chmod: così basta CAP_CHOWN
# anche se il file era già di uid 1883.
a_mosquitto() { # permessi percorso...
    m="$1"; shift
    for p in "$@"; do
        chown 0:0 "$p" && chmod "$m" "$p" && chown "$UID_MOSQ:$GID_MOSQ" "$p"
    done
}

# Copia atomica (file temporaneo + mv) di un file, seguendo i link simbolici.
copia() { # sorgente destinazione
    cat "$1" > "$2.nuovo"
    a_mosquitto 0600 "$2.nuovo"
    mv -f "$2.nuovo" "$2"
}

copia_file() {
    case "$SORGENTE" in
        nessuno) dir="" ;;
        # Struttura di certbot (live/<dominio>/) oppure la copia "piatta" fatta da
        # cloud/certificati/copia-certificati.sh (<dominio>/), con LETSENCRYPT_DIR=/srv/certificati.
        letsencrypt) dir="/etc/letsencrypt/live/$DOMINIO"; [ -d "$dir" ] || dir="/etc/letsencrypt/$DOMINIO" ;;
        autofirmato) dir="/mosquitto/segreti/certs-autofirmati" ;;
        *) errore "MQTT_CERTIFICATI deve essere 'nessuno', 'letsencrypt' o 'autofirmato' (ora: '$SORGENTE')" ;;
    esac
    if [ -n "$dir" ]; then
        for f in fullchain.pem privkey.pem; do
            [ -r "$dir/$f" ] || errore "manca $dir/$f (MQTT_CERTIFICATI=$SORGENTE, MQTT_DOMINIO=$DOMINIO). \
Con Let's Encrypt controlla LETSENCRYPT_DIR in .env; per le prove: ./scripts/certificati-autofirmati.sh; \
senza TLS: MQTT_CERTIFICATI=nessuno"
        done
    fi
    umask 077
    mkdir -p "$RUN" "$RUN/conf.d"
    chown 0:0 "$RUN"
    copia /mosquitto/config/acl "$RUN/acl"
    if [ -n "$dir" ]; then
        copia "$dir/fullchain.pem" "$RUN/fullchain.pem"
        copia "$dir/privkey.pem" "$RUN/privkey.pem"
        printf '%s\n' \
            "# Scritto da avvio.sh (MQTT_CERTIFICATI=$SORGENTE): porte TLS." \
            "listener 8883" "protocol mqtt" \
            "certfile $RUN/fullchain.pem" "keyfile $RUN/privkey.pem" \
            "listener 8884" "protocol websockets" \
            "certfile $RUN/fullchain.pem" "keyfile $RUN/privkey.pem" > "$RUN/conf.d/tls.conf.nuovo"
        a_mosquitto 0600 "$RUN/conf.d/tls.conf.nuovo"
        mv -f "$RUN/conf.d/tls.conf.nuovo" "$RUN/conf.d/tls.conf"
        msg="i certificati di $dir (porte TLS 8883 e 8884 accese) e config/acl"
    else
        rm -f "$RUN/conf.d/tls.conf" "$RUN/fullchain.pem" "$RUN/privkey.pem"
        msg="config/acl (TLS spento: MQTT_CERTIFICATI=nessuno, solo 1883 e 9001)"
    fi
    a_mosquitto 0700 "$RUN/conf.d"
    a_mosquitto 0700 "$RUN"
    echo "avvio.sh: copiati in $RUN $msg"
}

copia_file
[ "${1:-}" = "--copia" ] && exit 0

[ -f "$PASSWD" ] || errore "manca il file delle password $PASSWD: esegui ./scripts/inizializza.sh \
(oppure ./scripts/aggiungi-utente.sh admin)"
a_mosquitto 0700 /mosquitto/utenti
a_mosquitto 0600 "$PASSWD"

exec /docker-entrypoint.sh "$@"
