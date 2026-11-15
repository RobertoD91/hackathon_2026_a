#!/usr/bin/env bash
# Riavvia da zero i servizi di TwinCIRO sul server (utente openclaw, Docker senza root):
#   1. spegne tutto (MAI con -v: i dati e gli utenti del broker restano);
#   2. broker MQTT (cloud/mqtt);
#   3. API dati città (cloud/citta-api), con HTTPS (443, oppure 8443 se il Docker rootless non può) se ci sono i certificati;
#   4. città TwinCIRO (c5-agentic-city), collegata al broker con l'utente c5.
# A ogni problema si ferma (o avvisa) e scrive COSA FARE.
#
# Uso, dalla radice della repo:
#   git pull && bash cloud/riavvia-tutto.sh
# Opzioni (variabili d'ambiente): SALTA_CITTA=1 non avvia la città; SALTA_PROVE=1 salta le prove lunghe.
set -uo pipefail

RADICE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MQTT="$RADICE/cloud/mqtt"
API="$RADICE/cloud/citta-api"
CITTA="$RADICE/c5-agentic-city"
DOMINIO="twinciro.robertodisanto.it"

if [ -t 1 ]; then V=$'\e[32m'; G=$'\e[33m'; R=$'\e[31m'; B=$'\e[1m'; N=$'\e[0m'; else V=; G=; R=; B=; N=; fi
passo()  { echo; echo "${B}== $*${N}"; }
ok()     { echo "  ${V}OK${N}  $*"; }
avviso() { echo "  ${G}ATTENZIONE${N}  $*"; }
fai()    { echo "  ${B}COSA FARE:${N} $*"; }
ferma()  { echo; echo "${R}${B}FERMO:${N} $1"; shift; for r in "$@"; do fai "$r"; done; echo; riepilogo; exit 1; }

ESITO_BROKER="non avviato"; ESITO_API="non avviata"; ESITO_HTTPS="spento"; ESITO_CITTA="non avviata"
riepilogo() {
    echo "${B}== Riepilogo${N}"
    echo "  Broker MQTT:      $ESITO_BROKER"
    echo "  API dati città:   $ESITO_API"
    echo "  HTTPS dell'API:   $ESITO_HTTPS"
    echo "  Città TwinCIRO:   $ESITO_CITTA"
    echo "  Porte da aprire nel firewall del provider: 1883 (MQTT), $(p="$(valore_env "$API/.env" CITTA_HTTPS_PORTA)"; echo "${p:-443}") (HTTPS dell'API); 8791 e 8080 solo se servono da fuori."
}

# Stato di salute di un servizio compose (cartella, servizio): healthy, starting, unhealthy, running, assente…
salute() {
    local id
    id="$(cd "$1" && docker compose ps -q "$2" 2>/dev/null | head -n1)"
    [ -n "$id" ] || { echo assente; return; }
    docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id" 2>/dev/null || echo assente
}
aspetta_sano() { # cartella servizio secondi
    local i s
    for ((i = 0; i < $3; i += 3)); do
        s="$(salute "$1" "$2")"
        [ "$s" = healthy ] && return 0
        sleep 3
    done
    return 1
}
# true se questo Docker può pubblicare la 443: con root sì; rootless solo con la capability su
# rootlesskit (sudo setcap cap_net_bind_service=ep "$(command -v rootlesskit)") o con il sysctl.
porte_basse_ok() {
    [ "${ROOTLESS:-0}" = 1 ] || return 0
    [ "$(cat /proc/sys/net/ipv4/ip_unprivileged_port_start 2>/dev/null || echo 1024)" -le 443 ] && return 0
    local rk gc
    rk="$(command -v rootlesskit 2>/dev/null)"; gc="$(command -v getcap 2>/dev/null || echo /usr/sbin/getcap)"
    [ -n "$rk" ] && [ -x "$gc" ] && "$gc" "$rk" 2>/dev/null | grep -q cap_net_bind_service && return 0
    return 1
}
valore_env() { # file chiave
    [ -f "$1" ] && sed -n "s/^$2=//p" "$1" | tail -n1 | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
}
imposta_env() { # file chiave valore (toglie le righe vecchie della chiave e aggiunge quella nuova)
    touch "$1" && chmod 600 "$1"
    sed -i "/^$2=/d" "$1"
    printf '%s=%s\n' "$2" "$3" >> "$1"
}

# ------------------------------------------------------------------ 0. controlli
passo "0. Controlli"
command -v docker >/dev/null || ferma "manca Docker." "installa Docker o usa l'utente che lo può usare (openclaw)."
docker info >/dev/null 2>&1 || ferma "Docker non risponde." \
    "con Docker rootless: systemctl --user start docker  (poi rilancia lo script)" \
    "controlla anche: echo \$DOCKER_HOST  (deve puntare al socket dell'utente, es. unix:///run/user/\$(id -u)/docker.sock)"
docker compose version >/dev/null 2>&1 || ferma "manca docker compose (plugin v2)." "installa il plugin docker-compose v2."
[ -d "$MQTT" ] && [ -d "$API" ] && [ -d "$CITTA" ] || ferma "non trovo cloud/mqtt, cloud/citta-api o c5-agentic-city in $RADICE." \
    "lancia lo script dalla repo aggiornata: cd ~/hackathon_2026_a && git pull && bash cloud/riavvia-tutto.sh"
ROOTLESS=0
if docker info -f '{{.SecurityOptions}}' 2>/dev/null | grep -q rootless; then
    ROOTLESS=1
    if porte_basse_ok; then ok "Docker rootless, con le porte basse abilitate (HTTPS sulla 443)"; else ok "Docker rootless senza porte basse (HTTPS sulla 8443)"; fi
else ok "Docker con root"; fi
ok "repo: $RADICE ($(git -C "$RADICE" log --oneline -1 2>/dev/null))"

# ------------------------------------------------------------------ 1. spegni tutto (senza -v)
passo "1. Spengo tutto (i dati restano: niente -v)"
(cd "$CITTA" && docker compose --profile sala down --remove-orphans >/dev/null 2>&1) && ok "città spenta" || avviso "città: niente da spegnere"
(cd "$API" && docker compose --profile https down --remove-orphans >/dev/null 2>&1) && ok "API spenta" || avviso "API: niente da spegnere"
(cd "$MQTT" && docker compose --profile monitor down --remove-orphans >/dev/null 2>&1) && ok "broker spento" || avviso "broker: niente da spegnere"
# Client di prova rimasti appesi (stessa immagine del broker, senza progetto compose).
togli_client_appesi() {
    local c
    for c in $(docker ps -aq --filter ancestor=eclipse-mosquitto:2.1.2-alpine); do
        if [ -z "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$c" 2>/dev/null)" ]; then
            docker rm -f "$c" >/dev/null 2>&1 && ok "tolto il client di prova rimasto appeso ($c)"
        fi
    done
}
togli_client_appesi
rimasti="$(docker ps --format '{{.Names}}')"
[ -z "$rimasti" ] && ok "nessun container acceso" || avviso "restano accesi altri container (non di TwinCIRO, li lascio): $(echo $rimasti)"

# ------------------------------------------------------------------ 2. broker MQTT
passo "2. Broker MQTT"
cd "$MQTT" || exit 1
./scripts/inizializza.sh > /tmp/twinciro-inizializza.log 2>&1 || ferma "inizializza.sh del broker è fallito (log: /tmp/twinciro-inizializza.log)." \
    "guarda le ultime righe: tail -n 30 /tmp/twinciro-inizializza.log" \
    "se dice 'configurazione non valida' su config/acl o mosquitto.conf: git -C $RADICE status (file modificati a mano?) e git -C $RADICE checkout -- cloud/mqtt/config"
grep -E "Utente .*: creato|ATTENZIONE" /tmp/twinciro-inizializza.log | sed 's/^/  /'
docker compose up -d >/dev/null 2>&1 || ferma "il broker non parte." \
    "guarda: cd $MQTT && docker compose logs --tail 30 mosquitto" \
    "se la porta 1883 è occupata: ss -ltnp | grep 1883 (un altro Mosquitto? spegnilo: docker ps, poi docker rm -f <nome>)"
if aspetta_sano "$MQTT" mosquitto 60; then
    ok "broker healthy sulla 1883"; ESITO_BROKER="${V}acceso${N} (1883, in chiaro con password)"
else
    ferma "il broker non diventa healthy (stato: $(salute "$MQTT" mosquitto))." \
        "guarda: cd $MQTT && docker compose logs --tail 30 mosquitto" \
        "se manca il file delle password: ./scripts/inizializza.sh e poi rilancia questo script"
fi
for u in badge-1 tasmota-1; do
    if ./scripts/elenca-utenti.sh 2>/dev/null | grep -qx "$u"; then
        ok "utente $u presente"
    else
        echo "  Creo l'utente $u (la password stampata qui sotto va nel dispositivo, poi non la rivedi più):"
        ./scripts/aggiungi-utente.sh "$u" 2>&1 | grep -vE "^ *Container |Broker ricaricato" | sed 's/^/    /'
    fi
done
if [ "${SALTA_PROVE:-0}" != 1 ]; then
    # Tempo massimo con kill: con Docker rootless il client di prova (--network host) può restare
    # appeso verso il dominio pubblico. In rootless provo solo in locale.
    prova_mqtt() { timeout -k 5 45 ./scripts/prova.sh "$@" < /dev/null; local e=$?; togli_client_appesi >/dev/null; return $e; }
    if [ "$ROOTLESS" != 1 ] && prova_mqtt > /tmp/twinciro-prova-mqtt.log 2>&1; then
        ok "prova del broker dal dominio pubblico ($DOMINIO:1883): tutte le prove passate"
    elif prova_mqtt localhost > /tmp/twinciro-prova-mqtt-locale.log 2>&1; then
        ok "prova del broker in locale: tutte le prove passate"
        [ "$ROOTLESS" = 1 ] && fai "da fuori provalo da un portatile: mosquitto_sub -h $DOMINIO -p 1883 -u monitor -P '<password di monitor>' -t 'napoli/#' -v (porta 1883 aperta nel firewall del provider)" \
            || { avviso "dal dominio pubblico la prova non passa (log: /tmp/twinciro-prova-mqtt.log)"; fai "controlla che la porta TCP 1883 sia aperta nel firewall del provider"; }
    else
        avviso "la prova automatica del broker non è riuscita o è scaduta (log: /tmp/twinciro-prova-mqtt-locale.log). Il broker è healthy: probabilmente è il client di prova, non il broker."
        fai "provalo da un portatile: mosquitto_sub -h $DOMINIO -p 1883 -u monitor -P '<password di monitor>' -t 'napoli/#' -v"
    fi
fi

# ------------------------------------------------------------------ 3. API dati città
passo "3. API dati città"
cd "$API" || exit 1
if [ ! -f .env ]; then
    cp .env.example .env && chmod 600 .env
    TOKEN="$(openssl rand -hex 24 2>/dev/null || head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
    imposta_env .env CITTA_API_TOKEN "$TOKEN"
    avviso "creato cloud/citta-api/.env con un token nuovo: $TOKEN"
    fai "su OpenClaw imposta CITTA_API_TOKEN con questo valore."
fi
[ -n "$(valore_env .env CITTA_API_TOKEN)" ] || avviso "CITTA_API_TOKEN è vuoto: l'API è aperta a tutti."
# Un .env vecchio non ha le chiavi aggiunte dopo (il 14/11 mancava CITTA_CERTIFICATI_DIR).
# Certificati e porta li sistema lo script qui sotto; per le altre avvisa soltanto.
MANCANTI=""
for K in $(sed -n 's/^\([A-Z_][A-Z0-9_]*\)=..*/\1/p' .env.example); do
    case "$K" in CITTA_CERTIFICATI_DIR|CITTA_HTTPS_PORTA) continue ;; esac
    grep -q "^$K=" .env || MANCANTI="$MANCANTI $K"
done
[ -z "$MANCANTI" ] || { avviso "nel .env mancano chiavi nuove di .env.example:$MANCANTI (valgono i predefiniti del compose)"; fai "se servono, copiale da cloud/citta-api/.env.example in cloud/citta-api/.env e rilancia lo script"; }
if [ -z "$(valore_env .env CITTA_HTTPS_PORTA)" ]; then
    if porte_basse_ok; then imposta_env .env CITTA_HTTPS_PORTA 443; else imposta_env .env CITTA_HTTPS_PORTA 8443; fi
    ok "CITTA_HTTPS_PORTA impostata a $(valore_env .env CITTA_HTTPS_PORTA)"
elif [ "$(valore_env .env CITTA_HTTPS_PORTA)" = 443 ] && ! porte_basse_ok; then
    avviso "questo Docker rootless non può pubblicare la 443: uso la 8443"
    fai "per usare la 443: sudo setcap cap_net_bind_service=ep \"\$(command -v rootlesskit)\" && systemctl --user restart docker, poi metti CITTA_HTTPS_PORTA=443 in cloud/citta-api/.env"
    imposta_env .env CITTA_HTTPS_PORTA 8443
fi
url_https() { local p; p="$(valore_env "$API/.env" CITTA_HTTPS_PORTA)"; [ "$p" = 443 ] && echo "https://$DOMINIO/citta-api" || echo "https://$DOMINIO:$p/citta-api"; }
docker compose up -d --build > /tmp/twinciro-api.log 2>&1 || ferma "l'API non parte (log: /tmp/twinciro-api.log)." \
    "guarda: tail -n 30 /tmp/twinciro-api.log" \
    "se la porta 8791 è occupata: ss -ltnp | grep 8791"
if aspetta_sano "$API" citta-api 90; then
    ok "API healthy sulla 8791"; ESITO_API="${V}accesa${N} (http://$DOMINIO:8791)"
else
    ferma "l'API non diventa healthy." "guarda: cd $API && docker compose logs --tail 30 citta-api"
fi
if [ "${SALTA_PROVE:-0}" != 1 ]; then
    timeout -k 5 60 ./prova.sh > /tmp/twinciro-prova-api.log 2>&1 && ok "prova dell'API: $(grep -o 'Esito:.*' /tmp/twinciro-prova-api.log)" \
        || avviso "prova dell'API con qualche errore: tail -n 20 /tmp/twinciro-prova-api.log"
fi
# compose legge i certificati solo da CITTA_CERTIFICATI_DIR nel .env: se manca, è vuota o punta
# a una cartella senza certificati, e quelli di $DOMINIO ci sono, la scrive lo script.
CERT_DEF="/srv/certificati/$DOMINIO"
CERT="$(valore_env .env CITTA_CERTIFICATI_DIR)"
if [ "$CERT" != "$CERT_DEF" ] && [ ! -r "$CERT/fullchain.pem" ] && [ -r "$CERT_DEF/fullchain.pem" ] && [ -r "$CERT_DEF/privkey.pem" ]; then
    [ -n "$CERT" ] && avviso "in $CERT (dal .env) non ci sono i certificati: uso $CERT_DEF"
    imposta_env .env CITTA_CERTIFICATI_DIR "$CERT_DEF"
    ok "CITTA_CERTIFICATI_DIR=$CERT_DEF scritta in cloud/citta-api/.env"
fi
CERT="$(valore_env .env CITTA_CERTIFICATI_DIR)"; CERT="${CERT:-$CERT_DEF}"
if [ -r "$CERT/fullchain.pem" ] && [ -r "$CERT/privkey.pem" ]; then
    if ! docker compose --profile https up -d > /tmp/twinciro-https.log 2>&1; then
        if grep -qi "privileged port" /tmp/twinciro-https.log && [ "$(valore_env .env CITTA_HTTPS_PORTA)" != 8443 ]; then
            avviso "la porta $(valore_env .env CITTA_HTTPS_PORTA) è stata rifiutata (porta privilegiata con Docker rootless): passo alla 8443"
            imposta_env .env CITTA_HTTPS_PORTA 8443
            docker compose --profile https up -d > /tmp/twinciro-https.log 2>&1 || true
        fi
    fi
    if aspetta_sano "$API" https 40; then
        ok "HTTPS acceso: $(url_https)"; ESITO_HTTPS="${V}acceso${N} ($(url_https))"
        fai "su OpenClaw: CITTA_API=$(url_https)"
        if [ "${SALTA_PROVE:-0}" != 1 ]; then
            timeout -k 5 60 ./prova.sh "$(url_https)" > /tmp/twinciro-prova-https.log 2>&1 \
                && ok "prova in HTTPS passata" \
                || { avviso "la prova in HTTPS dal server non passa (log: /tmp/twinciro-prova-https.log)"; fai "apri la porta $(valore_env .env CITTA_HTTPS_PORTA) nel firewall del provider e prova da fuori: curl -s $(url_https | sed 's#/citta-api##')/salute"; }
        fi
    else
        avviso "il container HTTPS non diventa healthy."
        fai "guarda: cd $API && docker compose --profile https logs --tail 20 https"
        fai "se dice 'Mancano fullchain.pem e privkey.pem': controlla i permessi con ls -l $CERT"
        (cd "$API" && docker compose --profile https stop https >/dev/null 2>&1)
        ESITO_HTTPS="${R}errore${N} (vedi sopra)"
    fi
else
    avviso "HTTPS spento: in $CERT mancano fullchain.pem e privkey.pem leggibili."
    fai "chiedi all'amministratore del server di lanciare i comandi di cloud/certificati/README.md, poi rilancia questo script."
    ESITO_HTTPS="${G}spento${N} (mancano i certificati in $CERT)"
fi

# ------------------------------------------------------------------ 4. città TwinCIRO
passo "4. Città TwinCIRO"
if [ "${SALTA_CITTA:-0}" = 1 ]; then
    avviso "città saltata (SALTA_CITTA=1)"; ESITO_CITTA="saltata"
else
    cd "$CITTA" || exit 1
    ENVC="$CITTA/.env"
    PW="$(valore_env "$ENVC" C5_MQTT_PASSWORD)"
    if [ -z "$PW" ]; then
        PW="$(grep -E '^c5 ' "$MQTT/segreti/credenziali-iniziali.txt" 2>/dev/null | tail -n1 | cut -d' ' -f2)"
        if [ -z "$PW" ] && [ -t 0 ]; then
            read -rsp "  Password MQTT dell'utente c5 (non la trovo in cloud/mqtt/segreti/credenziali-iniziali.txt): " PW; echo
        fi
        [ -n "$PW" ] || ferma "non ho la password MQTT dell'utente c5." \
            "creane una nuova: cd $MQTT && ./scripts/aggiungi-utente.sh c5   (stampa la password)" \
            "poi rilancia questo script e incollala quando la chiede."
        imposta_env "$ENVC" C5_MQTT_PASSWORD "$PW"
        ok "password di c5 salvata in c5-agentic-city/.env (0600, non versionato)"
    fi
    imposta_env "$ENVC" C5_MQTT_UTENTE c5
    [ -n "$(valore_env "$ENVC" C5_BROKER)" ] || imposta_env "$ENVC" C5_BROKER host.docker.internal:1883
    avvia_citta() {
        docker compose up -d --build --no-deps citta > /tmp/twinciro-citta.log 2>&1 || return 2
        local i
        for ((i = 0; i < 60; i += 3)); do
            sleep 3
            if docker compose logs citta 2>&1 | grep -q "\[bus\] collegato"; then return 0; fi
            if docker compose logs citta 2>&1 | grep -q "rifiuta utente o password"; then return 3; fi
        done
        return 1
    }
    avvia_citta; esito=$?
    if [ $esito = 1 ] && [ "$(valore_env "$ENVC" C5_BROKER)" = host.docker.internal:1883 ]; then
        avviso "la città non raggiunge il broker su host.docker.internal: provo con $DOMINIO:1883"
        imposta_env "$ENVC" C5_BROKER "$DOMINIO:1883"
        avvia_citta; esito=$?
    fi
    case $esito in
        0) ok "città collegata al broker ($(valore_env "$ENVC" C5_BROKER), utente c5)"
           if curl -sf -m 5 http://127.0.0.1:8080/stato >/dev/null; then ok "API della città risponde su :8080 (/chiedi, /notifiche, /stato)"; else avviso "la città è collegata ma :8080 non risponde ancora: riprova tra poco con curl -s http://127.0.0.1:8080/stato"; fi
           ESITO_CITTA="${V}accesa${N} (API :8080, broker $(valore_env "$ENVC" C5_BROKER))" ;;
        3) ferma "il broker rifiuta la password di c5." \
               "rigenerala: cd $MQTT && ./scripts/aggiungi-utente.sh c5   (stampa la password nuova)" \
               "poi: sed -i '/^C5_MQTT_PASSWORD=/d' $ENVC && bash $RADICE/cloud/riavvia-tutto.sh   (la richiede)" ;;
        2) ferma "il container della città non parte (log: /tmp/twinciro-citta.log)." \
               "guarda: tail -n 30 /tmp/twinciro-citta.log" \
               "se la porta 8080 è occupata: ss -ltnp | grep 8080" ;;
        *) ferma "la città non si collega al broker entro 60 s." \
               "guarda: cd $CITTA && docker compose logs --tail 30 citta" \
               "se il broker non è raggiungibile: apri la 1883 nel firewall del provider, poi rilancia lo script" ;;
    esac
fi

echo; riepilogo
echo; echo "${V}${B}Fatto.${N} Log nei file /tmp/twinciro-*.log"
