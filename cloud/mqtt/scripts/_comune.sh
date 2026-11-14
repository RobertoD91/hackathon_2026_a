# Funzioni comuni agli script di cloud/mqtt (non si esegue da solo).
# Uso: . "$(dirname "$0")/_comune.sh"
# Tutti gli script funzionano da qualsiasi cartella (anche come hook di certbot):
# si spostano nella cartella cloud/mqtt e usano docker compose da lì.
set -euo pipefail

MQTT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$MQTT_DIR"

# Stessa immagine del broker (letta da compose.yaml).
IMMAGINE="$(sed -n 's/^ *image: *\(eclipse-mosquitto:[^ ]*\).*$/\1/p' compose.yaml | head -n1)"
PASSWD_CONTAINER=/mosquitto/utenti/passwd

errore() { echo "ERRORE: $*" >&2; exit 1; }
avviso() { echo "ATTENZIONE: $*" >&2; }

command -v docker >/dev/null 2>&1 || errore "serve Docker (con il plugin compose)"
docker compose version >/dev/null 2>&1 || errore "serve 'docker compose' (plugin Compose v2)"

# Valore di una chiave in .env (senza eseguire il file): env_valore CHIAVE [predefinito]
env_valore() {
    local v=""
    if [ -f .env ]; then
        v="$(sed -n "s/^$1=//p" .env | tail -n1)"
        v="${v%\"}"; v="${v#\"}"; v="${v%\'}"; v="${v#\'}"
    fi
    printf '%s' "${v:-${2:-}}"
}

# Imposta (o aggiunge) una chiave in .env: env_imposta CHIAVE valore
env_imposta() {
    [ -f .env ] || errore "manca .env (cp .env.example .env)"
    if grep -q "^$1=" .env; then
        local tmp; tmp="$(mktemp .env.XXXXXX)"
        awk -v k="$1" -v v="$2" 'BEGIN{FS=OFS="="} $1==k{print k "=" v; next} {print}' .env > "$tmp"
        chmod 600 "$tmp" && mv -f "$tmp" .env
    else
        printf '%s=%s\n' "$1" "$2" >> .env
    fi
}

# Password casuale alfanumerica (24 caratteri, circa 140 bit).
genera_password() {
    local p=""
    while [ "${#p}" -lt 24 ]; do
        p="$p$(head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9')"
    done
    printf '%s' "${p:0:24}"
}

# Nome utente ammesso: quello dei deviceId del contratto, senza ":" (separatore del file
# delle password) e senza / + # (romperebbero i pattern %u delle ACL).
utente_valido() { [[ "$1" =~ ^[A-Za-z0-9._-]{1,64}$ ]]; }

broker_attivo() { [ -n "$(docker compose ps -q --status running mosquitto 2>/dev/null)" ]; }

# Cartelle dei segreti: segreti/ resta dell'utente del server (0700), segreti/utenti/ passa a
# uid 1883 alla prima esecuzione nel container.
prepara_cartelle() { mkdir -p segreti/utenti && chmod 700 segreti; }

# Esegue un comando sh in un container usa-e-getta del servizio mosquitto (stessi volumi),
# come root e senza avvio.sh. Lo standard input passa al comando.
nel_container() { prepara_cartelle; docker compose run --rm --no-deps -T --entrypoint /bin/sh mosquitto -c "$@"; }

elenco_utenti() {
    nel_container "cut -d: -f1 $PASSWD_CONTAINER 2>/dev/null || true" 2>/dev/null
}

# Crea o aggiorna un utente; la password arriva da stdin (mai sulla riga di comando).
imposta_password() { # utente  (password su stdin)
    local pw; IFS= read -r pw
    printf '%s\n%s\n' "$pw" "$pw" | nel_container '
        set -e
        f='"$PASSWD_CONTAINER"'
        if [ -f "$f" ]; then chown 0:0 "$f"; opz=""; else opz="-c"; fi
        mosquitto_passwd $opz "$f" "$1" >/dev/null
        chmod 0600 "$f" && chown 1883:1883 "$f"
        d="$(dirname "$f")"; chown 0:0 "$d"; chmod 0700 "$d"; chown 1883:1883 "$d"' sh "$1"
}

# Controlla la configurazione avviando davvero un broker di prova in un container usa-e-getta
# (rete sua, nessun conflitto di porte), passando da avvio.sh: così vengono caricati
# certificati, file delle password e ACL. "mosquitto --test-config" non basta: non carica i
# plugin, e con un'ACL sbagliata il SIGHUP farebbe USCIRE il broker in funzione.
# La copia ha persistence false, per non scrivere su /mosquitto/data del broker vero.
verifica_configurazione() {
    docker compose run --rm --no-deps -T mosquitto /bin/sh -c '
        sed "s/^persistence true/persistence false/" /mosquitto/config/mosquitto.conf > /tmp/prova.conf
        /usr/sbin/mosquitto -c /tmp/prova.conf > /tmp/prova.log 2>&1 &
        pid=$!
        for i in 1 2 3 4 5 6 7 8 9 10; do
            sleep 0.5
            if grep -q "mosquitto version .* running" /tmp/prova.log; then
                echo "Configurazione valida (broker di prova avviato e fermato)."; exit 0
            fi
            [ -d "/proc/$pid" ] || break
        done
        grep -v "Address family not supported" /tmp/prova.log >&2; exit 1'
    # Il broker di prova (uid 1883) muore con il container usa-e-getta: niente kill.
}

# Ricarica utenti, ACL e certificati senza disconnettere nessuno (se il broker è attivo):
# avvio.sh --copia ricopia acl e certificati in /mosquitto/run, poi SIGHUP.
ricarica_broker() {
    if broker_attivo; then
        docker compose exec -T mosquitto /bin/sh /mosquitto/config/avvio.sh --copia >/dev/null
        docker compose kill -s HUP mosquitto >/dev/null 2>&1
        echo "Broker ricaricato (SIGHUP)."
    else
        echo "Broker non attivo: le modifiche valgono dal prossimo 'docker compose up -d'."
    fi
}
