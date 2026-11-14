#!/bin/sh
# Avvio del container mosquitto. Gira come root, prima che Mosquitto scenda all'utente
# "mosquitto" (uid 1883), e poi passa il controllo all'entrypoint dell'immagine.
#
# 1. Copia in /mosquitto/run (tmpfs, solo in memoria), con proprietario uid 1883 e
#    permessi 0600, i file che Mosquitto legge DOPO aver lasciato root:
#    - i certificati TLS. Mosquitto 2.1 rifiuta i percorsi con link simbolici e gira come
#      uid 1883, mentre /etc/letsencrypt/live/<dominio>/ contiene link simbolici verso
#      archive/, leggibile solo da root: così i permessi di /etc/letsencrypt restano intatti.
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
DOMINIO="${MQTT_DOMINIO:-cloud.robertodisanto.it}"
SORGENTE="${MQTT_CERTIFICATI:-letsencrypt}"
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
        letsencrypt) dir="/etc/letsencrypt/live/$DOMINIO" ;;
        autofirmato) dir="/mosquitto/segreti/certs-autofirmati" ;;
        *) errore "MQTT_CERTIFICATI deve essere 'letsencrypt' o 'autofirmato' (ora: '$SORGENTE')" ;;
    esac
    for f in fullchain.pem privkey.pem; do
        [ -r "$dir/$f" ] || errore "manca $dir/$f (MQTT_CERTIFICATI=$SORGENTE, MQTT_DOMINIO=$DOMINIO). \
Con Let's Encrypt controlla LETSENCRYPT_DIR in .env; per le prove: ./scripts/certificati-autofirmati.sh"
    done
    umask 077
    mkdir -p "$RUN"
    chown 0:0 "$RUN"
    copia "$dir/fullchain.pem" "$RUN/fullchain.pem"
    copia "$dir/privkey.pem" "$RUN/privkey.pem"
    copia /mosquitto/config/acl "$RUN/acl"
    a_mosquitto 0700 "$RUN"
    echo "avvio.sh: copiati in $RUN i certificati di $dir e config/acl"
}

copia_file
[ "${1:-}" = "--copia" ] && exit 0

[ -f "$PASSWD" ] || errore "manca il file delle password $PASSWD: esegui ./scripts/inizializza.sh \
(oppure ./scripts/aggiungi-utente.sh admin)"
a_mosquitto 0700 /mosquitto/utenti
a_mosquitto 0600 "$PASSWD"

exec /docker-entrypoint.sh "$@"
