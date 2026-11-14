# Broker MQTT su twinciro.robertodisanto.it

Broker MQTT del team per The Big Hack 2026: **Eclipse Mosquitto 2.1.2 in Docker**, con autenticazione obbligatoria, permessi per ruolo, persistenza, log, healthcheck e limiti.

**Scelte del 14/11:** MQTT **in chiaro** sulla 1883, con utente e password, **senza TLS** (`MQTT_CERTIFICATI=nessuno`, predefinito). Sul server **non abbiamo root**: basta un utente che possa usare Docker. TLS (8883 e `wss://` 8884) resta pronto e si accende cambiando una riga di `.env`, con i certificati resi leggibili dall'amministratore (sezione [TLS](#tls-facoltativo-spento-di-serie)).

Lo usano i badge WHY2025 e gli ESP32 (`shared/iot-agents/firmware/`), i dispositivi Tasmota, il ponte MQTT → hub (`shared/iot-agents/tools/`) e la città agentica `c5-agentic-city` (topic `napoli/#`).

| Porta | Protocollo | Per chi |
|---|---|---|
| **1883** | MQTT con utente e password (in chiaro) | **tutti**: badge, ESP32, Tasmota, ponte, c5, amministrazione |
| 8883 | MQTT su TLS | solo con TLS acceso (`MQTT_CERTIFICATI=letsencrypt`) |
| 8884 | MQTT su WebSocket con TLS (`wss://`) | solo con TLS acceso: dashboard nel browser (una pagina https usa solo `wss://`) |
| 9001 | WebSocket in chiaro, **solo su 127.0.0.1** del server | eventuale reverse proxy (opzionale) |

Nessun accesso anonimo su nessuna porta: se qualcuno lo riattivasse, il container risulterebbe `unhealthy`.

## Contenuto

```
cloud/mqtt/
  compose.yaml              broker (servizio mosquitto), monitor (profilo "monitor"), ponte (profilo "ponte")
  .env.example              configurazione: dominio, certificati, porte, password di ponte e monitor
  config/
    mosquitto.conf          porte, limiti, persistenza, log, plugin di autenticazione e ACL
    acl                     permessi sui topic per ruolo (versionato, nessun segreto)
    avvio.sh                avvio del container: copia ACL (e certificati, se TLS è acceso), sistema i permessi
  scripts/
    inizializza.sh          prima installazione: .env, utenti di servizio (e controllo TLS, se acceso)
    aggiungi-utente.sh      crea un utente o ne cambia la password (mosquitto_passwd nel container)
    rimuovi-utente.sh       elimina un utente
    elenca-utenti.sh        elenco degli utenti
    ricarica.sh             dopo una modifica all'ACL: controlla e ricarica senza disconnettere
    certificati-autofirmati.sh  CA e certificato di prova
    rinnova-certificati.sh  hook di certbot: nuovi certificati senza riavviare
    prova.sh                prova completa: anonimo rifiutato, ACL, MQTT (TLS e WSS se accesi)
    stato.sh                stato, scadenza del certificato, statistiche $SYS
  esempi/
    ponte-c5-verso-cloud.conf   bridge dal Mosquitto del plastico di c5 al cloud
    nginx-mqtt-websocket.conf   wss sulla 443 tramite nginx (opzionale)
  segreti/                  NON versionata: utenti/passwd, certificati autofirmati, credenziali
```

`.env` e `segreti/` sono nel `.gitignore`: **nessuna password o chiave va mai nella repo**.

## Requisiti

- Server Linux con **Docker Engine** e il plugin **Compose v2** (`docker compose version`), `git`. Un utente **senza root** va bene, purché possa usare Docker (gruppo `docker`, oppure Docker rootless).
- Record DNS `A` di `twinciro.robertodisanto.it` verso l'IP del server (oggi 34.154.255.49).
- La repo intera clonata sul server se si usa il ponte (monta `shared/iot-agents/`).
- Solo se si accende TLS: i certificati di `twinciro.robertodisanto.it` leggibili dall'utente (vedi [`../certificati/`](../certificati/README.md)).

Gli script non usano mai `sudo`: quello che richiede root (proprietario uid 1883 dei file di Mosquitto) lo fanno dentro un container. Funzionano da qualsiasi cartella.

## Installazione sul server, passo per passo

### 1. DNS e porte

```bash
dig +short twinciro.robertodisanto.it      # deve rispondere con l'IP del server
```

Apri nel firewall del provider (pannello cloud / security group) la porta **TCP 1883**. Le porte 8883 e 8884 servono solo con TLS acceso.

> **Attenzione a ufw:** Docker scrive regole iptables proprie e le porte pubblicate da un container sono raggiungibili **anche se ufw le blocca**. Il filtro vero è il firewall del provider, oppure le porte in `.env`. La 9001 è già legata a 127.0.0.1.

### 2. Codice

```bash
git clone https://github.com/RobertoD91/hackathon_2026_a.git
cd hackathon_2026_a/cloud/mqtt
```

### 3. Prima inizializzazione

```bash
./scripts/inizializza.sh
```

Crea `.env` (da `.env.example`: TLS spento) e gli **utenti di servizio con password casuali**: `admin`, `ponte`, `c5`, `c5-plastico`, `dashboard`, `monitor`. Le password vengono stampate una volta e salvate in `segreti/credenziali-iniziali.txt` (permessi 0600): distribuiscile al team in modo privato e poi **cancella il file**. Quelle di `ponte` e `monitor` finiscono anche in `.env`, dove le leggono i servizi. Si può rilanciare: gli utenti esistenti non vengono toccati.

### 4. Avvio e prova

```bash
docker compose up -d
docker compose ps                  # STATUS "Up ... (healthy)" dopo una ventina di secondi
docker compose logs -f mosquitto   # Ctrl+C per uscire
./scripts/prova.sh                 # deve finire con "Tutte le prove sono passate."
```

`prova.sh` crea un utente-dispositivo temporaneo e verifica: anonimo e password errata rifiutati, pubblicazione e iscrizione sulla 1883 (e su 8883 e 8884 se TLS è acceso), ACL che nega i topic di un altro dispositivo e `napoli/...`. Poi elimina l'utente.

### 5. (Solo con TLS) certificati e rinnovo

Vedi [TLS](#tls-facoltativo-spento-di-serie). Con TLS spento non c'è nulla da rinnovare.

### 6. Un utente per ogni dispositivo

```bash
./scripts/aggiungi-utente.sh badge-ab12             # stampa la password generata
./scripts/aggiungi-utente.sh esp32-plebiscito-01
./scripts/aggiungi-utente.sh tasmota-serra
./scripts/aggiungi-utente.sh esp32-plebiscito-01 -  # cambia la password (chiesta da tastiera)
./scripts/rimuovi-utente.sh tasmota-serra
./scripts/elenca-utenti.sh
```

Le modifiche valgono subito (SIGHUP), senza riavvio. Chi è già connesso resta connesso fino alla disconnessione: per buttarlo fuori subito, `docker compose restart mosquitto`.

## Utenti e permessi

Il **nome utente di un dispositivo è il suo deviceId** (badge, ESP32) o il suo **Topic** (Tasmota): i permessi arrivano dai pattern `%u` di `config/acl` e non serve modificarla. Nomi ammessi: 1-64 caratteri tra lettere, cifre, `.`, `_`, `-` (il contratto ammette anche `:`, ma qui no: è il separatore del file delle password).

| Utente | Legge | Scrive |
|---|---|---|
| dispositivo `<id>` (badge, ESP32) | `bighack/+/<id>/#` (es. `.../cmd`) | `bighack/+/<id>/#` (`readings`, `status`), `napoli/sensori/<id>/#` |
| dispositivo Tasmota `<topic>` | `cmnd/<topic>/#` | `tele/<topic>/#`, `stat/<topic>/#` |
| `ponte` | `bighack/#`, `tele/#`, `stat/#`, `napoli/sensori/#` | niente (comandi ai dispositivi: righe commentate nell'ACL) |
| `c5` | `napoli/#` | `napoli/#` |
| `c5-plastico` (ESP32 di c5) | `napoli/semafori/#` | `napoli/sensori/#`, `napoli/eventi/manuale`, `napoli/semafori/+/riflesso` |
| `dashboard` (browser) | `bighack/#`, `tele/#`, `napoli/#` | niente: la sua password è pubblica |
| `monitor` | `#`, `$SYS/#` | niente |
| `admin` | tutto, `$SYS/#` | tutto |

Un'iscrizione più ampia dei permessi (es. `#`) viene accettata, ma il client riceve solo i messaggi che può leggere. Una pubblicazione vietata viene scartata: con MQTT 5 e QoS 1 il client riceve `Not authorized`, con MQTT 3.1.1 non riceve nulla e nemmeno i log del broker lo segnalano. Per controllare un permesso usa quindi MQTT 5 con QoS 1 (esempio in [Prove dal proprio PC](#prove-dal-proprio-pc)).

Per cambiare i permessi modifica `config/acl` e lancia `./scripts/ricarica.sh`: avvia un broker di prova con la nuova configurazione e ricarica quello vero **solo se è valida** (un'ACL sbagliata ricaricata con SIGHUP farebbe uscire Mosquitto). Un SIGHUP mandato a mano non rilegge l'ACL: Mosquitto usa una copia in `/mosquitto/run`, aggiornata da `ricarica.sh`.

## TLS (facoltativo, spento di serie)

Di serie (`MQTT_CERTIFICATI=nessuno`) il broker ascolta solo sulla 1883 in chiaro, con password, e sulla 9001 locale. È la scelta del team: la password di ogni dispositivo viaggia in chiaro, quindi **un utente per dispositivo** e niente password riusate.

Per accendere TLS (8883 e `wss://` 8884) servono i certificati leggibili dall'utente che usa Docker. Sul server non abbiamo root, quindi l'amministratore li copia con l'hook di [`../certificati/`](../certificati/README.md), in `/srv/certificati/twinciro.robertodisanto.it/`. Poi in `.env`:

```bash
MQTT_CERTIFICATI=letsencrypt
LETSENCRYPT_DIR=/srv/certificati          # avvio.sh cerca <dir>/live/<dominio>/ oppure <dir>/<dominio>/
```

e `./scripts/inizializza.sh && docker compose up -d --force-recreate`. `config/avvio.sh` copia `fullchain.pem` e `privkey.pem` in un tmpfs (`/mosquitto/run`, solo in memoria) con proprietario uid 1883, e scrive `conf.d/tls.conf` con le porte 8883 e 8884, che `mosquitto.conf` include. Con `nessuno` la cartella resta vuota.

Al rinnovo i file nuovi vanno ricopiati nel container: `docker compose restart mosquitto` (i client si riconnettono da soli), oppure `./scripts/rinnova-certificati.sh`, che li ricarica con SIGHUP senza disconnettere nessuno. La scadenza del certificato in uso si vede con `./scripts/stato.sh`.

### Autofirmati (prove)

```bash
./scripts/certificati-autofirmati.sh [altri nomi o IP]   # es. l'IP del portatile in rete locale
# in .env: MQTT_CERTIFICATI=autofirmato (LETSENCRYPT_DIR=./segreti va bene)
docker compose up -d --force-recreate
```

I client devono fidarsi di `segreti/certs-autofirmati/ca.crt` (`--cafile`, `setCACert` sull'ESP32, `TELEMETRY_MQTT_CA_PEM` sul badge). Il browser rifiuta `wss://` autofirmato finché non apri una volta `https://<host>:8884/` e accetti l'avviso.

### WebSocket sulla 443 (opzionale)

La 8884 basta quasi sempre. Alcune reti (Wi-Fi di eventi, aziende) lasciano passare solo la 443:
- se sulla 443 del server non c'è nulla, metti `WSS_PORTA=443` in `.env` e `docker compose up -d`: `wss://twinciro.robertodisanto.it/mqtt`;
- se c'è già nginx, aggiungi il blocco di `esempi/nginx-mqtt-websocket.conf` (inoltra `/mqtt` alla 9001 locale).

Un reverse proxy dedicato (Caddy, Traefik) non serve: Mosquitto parla `wss://` da solo con lo stesso certificato.

## Prove dal proprio PC

Con `mosquitto-clients` (`sudo apt install mosquitto-clients`, oppure `brew install mosquitto`) o con il container: `docker run --rm -it --entrypoint sh eclipse-mosquitto:2.1.2-alpine`.

```bash
H=twinciro.robertodisanto.it
# anonimo: deve rispondere "Connection Refused: not authorised"
mosquitto_pub -h $H -p 1883 -t prova -m x
# un terminale ascolta, l'altro pubblica (1883 in chiaro)
mosquitto_sub -h $H -p 1883 -u admin -P '<password>' -t 'bighack/#' -v
mosquitto_pub -h $H -p 1883 -u esp32-plebiscito-01 -P '<password>' \
  -t bighack/plebiscito/esp32-plebiscito-01/readings \
  -m '{"deviceId":"esp32-plebiscito-01","readings":{"temperature_c":24.1}}'
# ACL: pubblicazione vietata, MQTT 5 + QoS 1 risponde "Not authorized"
mosquitto_pub -h $H -p 1883 -V 5 -q 1 -u esp32-plebiscito-01 -P '<password>' -t napoli/kpi -m x
# solo con TLS acceso: 8883 (CA di sistema) e WebSocket su TLS 8884
mosquitto_sub -h $H -p 8883 --tls-use-os-certs -u admin -P '<password>' -t '#' -v
mosquitto_sub -h $H -p 8884 --ws --tls-use-os-certs -u dashboard -P '<password>' -t 'bighack/#' -v
```

Strumenti grafici: [MQTT Explorer](https://mqtt-explorer.com/) o [MQTTX](https://mqttx.app/) con host `twinciro.robertodisanto.it`, porta 1883, TLS spento, utente `admin`.

## Configurazione dei client

### Badge WHY2025 (`shared/iot-agents/firmware/why2025-badge/`)

In `telemetry_config.h` (copia di `telemetry_config.example.h`, non versionata):

```c
#define TELEMETRY_MQTT_HOST        "twinciro.robertodisanto.it"
#define TELEMETRY_MQTT_TRANSPORT   "mqtt"           // broker del team: in chiaro ("mqtts" 8883 solo con TLS acceso)
#define TELEMETRY_MQTT_PORT        1883
#define TELEMETRY_DEVICE_ID        "badge-ab12"     // meglio esplicito: deve essere = utente MQTT
#define TELEMETRY_MQTT_USER        "badge-ab12"
#define TELEMETRY_MQTT_PASSWORD    "<password di aggiungi-utente.sh>"
#define TELEMETRY_MQTT_TLS_INSECURE 0               // conta solo con "mqtts"/"wss"
```

Il badge pubblica `bighack/<zona>/<deviceId>/readings`, lo stato trattenuto (e LWT) su `.../status` e ascolta `.../cmd`: tutto coperto dai pattern dell'ACL. `"wss"` con porta 443 funziona solo con l'opzione [WebSocket sulla 443](#websocket-sulla-443-opzionale); sulla 8884 usa `"wss"` e `TELEMETRY_MQTT_PORT 8884`. Con `TELEMETRY_C5_COMPAT 1` il pulsante scrive anche su `napoli/eventi/manuale`: va concesso badge per badge in `config/acl` (esempio commentato nel file).

### ESP32 (Arduino, PubSubClient)

Il firmware `esp32-sensor` oggi invia via HTTP al hub. Per uno sketch MQTT (broker in chiaro sulla 1883):

```cpp
#include <WiFi.h>
#include <PubSubClient.h>

WiFiClient rete;
PubSubClient mqtt(rete);
const char* ID = "esp32-plebiscito-01";                      // = utente MQTT
const char* STATO = "bighack/plebiscito/esp32-plebiscito-01/status";

void setup() {
  // ... Wi-Fi ...
  mqtt.setServer("twinciro.robertodisanto.it", 1883);
  mqtt.setBufferSize(1024);          // il predefinito (256 byte) è poco per il JSON delle letture
  mqtt.setKeepAlive(30);             // massimo accettato dal broker: 300 s
}

bool connetti() {
  // LWT: se l'ESP32 sparisce, il broker pubblica online:false (trattenuto) al posto suo.
  if (!mqtt.connect(ID, ID, MQTT_PASSWORD, STATO, 1, true, "{\"deviceId\":\"esp32-plebiscito-01\",\"online\":false}"))
    return false;
  mqtt.publish(STATO, "{\"deviceId\":\"esp32-plebiscito-01\",\"online\":true}", true);
  return true;
}
// letture: mqtt.publish("bighack/plebiscito/esp32-plebiscito-01/readings", json);
```

Con TLS acceso sul broker: `WiFiClientSecure`, `rete.setCACert(...)` con le radici di Let's Encrypt (ISRG Root X1 e X2) e porta 8883.

### Tasmota

Dalla console web del dispositivo (un comando, `<password>` da `aggiungi-utente.sh tasmota-serra`):

```
Backlog MqttHost twinciro.robertodisanto.it; MqttPort 1883; MqttUser tasmota-serra; MqttPassword <password>; Topic tasmota-serra; FullTopic %prefix%/%topic%/; TelePeriod 60
```

Il **Topic deve essere uguale al nome utente**: Tasmota pubblica `tele/tasmota-serra/SENSOR`, `STATE` e `LWT` (trattenuto `Online`/`Offline`), `stat/tasmota-serra/...` e ascolta `cmnd/tasmota-serra/...`. Il topic di gruppo `cmnd/tasmotas/...` non è concesso. Con il FullTopic predefinito il topic non dice la zona: il ponte usa `PONTE_ZONA_PREDEFINITA` o `PONTE_MAPPA` di `.env`. In alternativa `FullTopic bighack/serra/%topic%/%prefix%/` mette la zona nel topic (`bighack/serra/tasmota-serra/tele/SENSOR`): lo riconoscono sia l'ACL sia il ponte. Il broker del team è in chiaro sulla 1883, che va bene per tutte le build (con TLS acceso, le build ESP32 possono usare `SetOption103 1` e `MqttPort 8883`).

Prova dal PC: `mosquitto_pub ... -u admin -t cmnd/tasmota-serra/POWER -m TOGGLE`.

### Ponte MQTT → hub

Il ponte `shared/iot-agents/tools/mqtt-bridge.js` si iscrive a `bighack/#` e ai topic Tasmota con l'utente `ponte`, converte e inoltra le letture al hub con `POST /api/readings` (`shared/iot-agents/CONTRATTO.md`). In `compose.yaml` è il servizio `ponte` (profilo `ponte`, quindi non parte con un semplice `up`):

```bash
# in .env: HUB_URL (e HUB_TOKEN se il hub lo richiede); MQTT_PONTE_PASSWORD c'è già
docker compose --profile ponte up -d
docker compose --profile ponte ps          # ponte "healthy" = connesso al broker
docker compose logs -f ponte               # una riga "→ hub <deviceId> ..." per lettura
```

Il container (Node 22, nessuna dipendenza npm) monta `shared/iot-agents` in sola lettura e riceve `MQTT_URL=mqtt://mosquitto:1883` (rete interna di Docker), `MQTT_USER=ponte`, `MQTT_PASSWORD`, `HUB_URL`, `HUB_TOKEN` (inviato come `Authorization: Bearer`) e le facoltative `PONTE_ZONA_PREDEFINITA`, `PONTE_MAPPA`, `PONTE_C5` di `.env` (le altre opzioni sono nell'intestazione di `mqtt-bridge.js`). Il healthcheck interroga `GET /health` del ponte. Se il hub gira sullo stesso server fuori da Docker usa `HUB_URL=http://host.docker.internal:8701`, con il hub in ascolto su `0.0.0.0` (non solo su 127.0.0.1). Il ponte si può anche lanciare fuori da Docker, da un portatile: `MQTT_URL=mqtt://twinciro.robertodisanto.it:1883 MQTT_USER=ponte MQTT_PASSWORD=... HUB_URL=http://localhost:8701 node shared/iot-agents/tools/mqtt-bridge.js`.

### c5-agentic-city

c5 usa un Mosquitto locale anonimo sul portatile del plastico (`c5-agentic-city/docker/mosquitto.conf`) e il suo `BusMQTT` (Python, paho-mqtt) oggi **non** passa utente e password né usa TLS. Due strade:

1. **Bridge (consigliato, nessuna modifica al codice):** il broker del plastico copia `napoli/#` nei due sensi verso il cloud con l'utente `c5` sulla 1883. Il plastico continua a funzionare anche senza internet. Istruzioni in `esempi/ponte-c5-verso-cloud.conf`: un file non versionato con la password, un volume in più e la riga `include_dir /mosquitto/config/conf.d` in fondo alla loro `mosquitto.conf`. Provato con la loro configurazione: plastico → cloud e cloud → plastico.
2. **Collegamento diretto:** il gruppo c5 dovrebbe aggiungere in `citta/bus.py`, prima di `connect`, `self._mqtt.username_pw_set(os.environ["C5_MQTT_UTENTE"], os.environ["C5_MQTT_PASSWORD"])` poi `python avvia.py --broker twinciro.robertodisanto.it:1883`. Gli ESP32 del plastico (`firmware/semaforo`, `firmware/sensore`) userebbero `mqtt.connect(id, "c5-plastico", password)`.

### Dashboard nel browser

Le pagine servite in https (GitHub Pages) possono aprire solo `wss://`: **serve TLS acceso** (oggi è spento; la mappa usa il hub via SSE, non MQTT). Con [mqtt.js](https://github.com/mqttjs/MQTT.js):

```js
import mqtt from 'https://cdn.jsdelivr.net/npm/mqtt@5.16.1/+esm';
const client = mqtt.connect('wss://twinciro.robertodisanto.it:8884/mqtt', {
  username: 'dashboard', password: '<password dashboard>', protocolVersion: 5,
});
client.on('connect', () => client.subscribe(['bighack/#', 'tele/#', 'napoli/#']));
client.on('message', (topic, payload) => console.log(topic, payload.toString()));
```

Tutto ciò che sta in una pagina web è pubblico, password compresa: per questo `dashboard` può **solo leggere** e non ha nemmeno i permessi da dispositivo. Se la password finisce dove non deve, cambiala con `./scripts/aggiungi-utente.sh dashboard`.

## Monitor e stato

```bash
docker compose --profile monitor run --rm monitor                  # tutti i messaggi, Ctrl+C per uscire
MONITOR_TOPIC='bighack/#' docker compose --profile monitor run --rm monitor
./scripts/stato.sh            # container, salute, scadenza TLS, client connessi, messaggi
docker compose logs --since 1h mosquitto | grep -i -E 'denied|not authori|error'
```

Uno strumento di amministrazione web non è incluso: la dashboard `http_api` integrata in Mosquitto 2.1 non ha autenticazione (e in questa immagine non si avvia). Per guardare dentro al broker bastano monitor, `stato.sh` e MQTT Explorer con l'utente `admin`.

## Backup e ripristino

Da salvare: `.env`, `segreti/` (password, credenziali, certificati autofirmati) e il volume `dati` (sessioni e messaggi trattenuti, per esempio l'ultimo stato dei dispositivi). La configurazione è nella repo; i certificati Let's Encrypt li gestisce certbot.

```bash
docker compose kill -s USR1 mosquitto     # scrive subito il database su disco
tar czf ~/backup-mqtt-$(date +%F).tgz .env segreti/credenziali-iniziali.txt segreti/certs-autofirmati 2>/dev/null
# segreti/utenti è di uid 1883 (0700): si salva da un container, senza root sul server
docker compose run --rm --no-deps -T --entrypoint tar mosquitto czf - -C /mosquitto utenti > ~/backup-mqtt-utenti-$(date +%F).tgz
docker run --rm -v bighack-mqtt_dati:/dati:ro -v ~/:/backup --entrypoint tar eclipse-mosquitto:2.1.2-alpine \
  czf /backup/backup-mqtt-dati-$(date +%F).tgz -C /dati .
```

Ripristino: estrai il primo archivio in `cloud/mqtt/`; gli utenti con `docker compose run --rm --no-deps -T --entrypoint tar mosquitto xzf - -C /mosquitto < ~/backup-mqtt-utenti-AAAA-MM-GG.tgz` (poi `./scripts/ricarica.sh` ne sistema i permessi). Il volume, con il broker fermo (`docker compose stop mosquitto`):

```bash
docker run --rm -v bighack-mqtt_dati:/dati -v ~/:/backup --entrypoint tar eclipse-mosquitto:2.1.2-alpine \
  xzf /backup/backup-mqtt-dati-AAAA-MM-GG.tgz -C /dati
docker compose up -d
```

Mai `docker compose down -v`: cancella il volume `dati`.

## Aggiornamento

1. Leggi il [ChangeLog di Mosquitto](https://mosquitto.org/ChangeLog.txt) e fai un backup.
2. Cambia la versione dell'immagine in `compose.yaml` (servizi `mosquitto` e `monitor`).
3. `docker compose pull && ./scripts/ricarica.sh && docker compose up -d`, poi `./scripts/prova.sh`.
4. Per tornare indietro: rimetti la versione precedente e `docker compose up -d`.

Se Docker Hub risponde `429 Too Many Requests`, si scarica la stessa immagine dal mirror di Google:
`docker pull mirror.gcr.io/library/eclipse-mosquitto:2.1.2-alpine && docker tag mirror.gcr.io/library/eclipse-mosquitto:2.1.2-alpine eclipse-mosquitto:2.1.2-alpine`.

## Sicurezza

- **Nessun accesso anonimo** (`allow_anonymous false`); il healthcheck lo verifica di continuo.
- **Un utente per dispositivo**, che scrive solo sotto il proprio nome: un dispositivo rubato o una password trapelata non permettono di impersonare gli altri. Password generate a caso (24 caratteri alfanumerici, circa 140 bit), salvate come hash PBKDF2-SHA512 (l'immagine non supporta argon2id: con password casuali così lunghe non cambia nulla in pratica).
- La **1883 è in chiaro** ed è la porta del team (scelta del 14/11, TLS spento): chi intercetta il traffico legge la password di quel dispositivo. Per questo un utente per dispositivo, nessuna password riusata, e `rimuovi-utente.sh` a fine evento. Se serve più protezione: TLS (sezione sopra).
- La password di `dashboard` è pubblica per natura: solo lettura.
- Limiti: 1000 connessioni contemporanee, pacchetti fino a 256 KB (oltre, il client viene disconnesso), keepalive massimo 300 s, code limitate per i client lenti, sessioni abbandonate eliminate dopo 14 giorni.
- Container indurito: file system in sola lettura, solo 4 capability (servono ad `avvio.sh`; Mosquitto gira come uid 1883 senza capability), `no-new-privileges`, limiti di CPU e memoria, log con rotazione (5 × 10 MB).
- Con TLS acceso, la chiave privata nel container esiste solo in memoria (tmpfs).
- Docker scavalca ufw (vedi [DNS e porte](#1-dns-e-porte)): filtra con il firewall del provider.
- Fine evento: elimina gli utenti dei dispositivi con `rimuovi-utente.sh`, oppure ferma tutto con `docker compose down` (senza `-v`, per tenere i dati).

## Problemi comuni

| Sintomo | Causa probabile |
|---|---|
| `Connection Refused: not authorised` | utente o password errati, oppure utente creato ma non ricaricato (`./scripts/ricarica.sh`) |
| `identifier rejected` | keepalive del client oltre 300 s, oppure client id già usato da un altro client |
| `The connection was lost` subito dopo una pubblicazione | messaggio oltre 256 KB (`max_packet_size`) |
| messaggi pubblicati che non arrivano | ACL: con MQTT 3.1.1 il rifiuto è silenzioso, anche nei log; riprova con `mosquitto_pub -V 5 -q 1` per vedere `Not authorized` |
| errori di certificato sull'ESP32 | CA sbagliata (radice di Let's Encrypt) oppure ora non sincronizzata (serve NTP prima del TLS) |
| container `unhealthy` o in riavvio | `docker compose logs mosquitto`: di solito manca il file delle password, oppure TLS è acceso e mancano i certificati (`avvio.sh: ERRORE`) |

## Cosa è stato verificato

Il 14/11 pomeriggio, dopo il passaggio a TLS facoltativo: `inizializza.sh`, avvio `healthy` e `prova.sh` con TLS spento (7 prove su 7), con certificati autofirmati (10 su 10) e con `LETSENCRYPT_DIR` nella forma "piatta" di `../certificati/` (chiave 0640 di un altro utente).

In precedenza, con Docker in un ambiente di prova, su porte 18840-18843 al posto di 1883/8883/8884/9001, eseguendo gli script così come sono:
- `docker compose config` della repo; `inizializza.sh` (autofirmato e Let's Encrypt), avvio e stato `healthy`;
- `prova.sh`: anonimo e password errata rifiutati, andata e ritorno su MQTT, MQTT su TLS, wss e ws locale, ACL negate;
- ogni ruolo dell'ACL (ponte, dispositivo, Tasmota, dashboard, c5, c5-plastico, monitor, admin), sia nei permessi concessi sia in quelli negati;
- LWT trattenuto alla caduta di un dispositivo e messaggi trattenuti dopo il riavvio del broker (persistenza);
- limite di 256 KB e keepalive oltre 300 s rifiutati; `ricarica.sh` che blocca un'ACL sbagliata;
- una finta `/etc/letsencrypt` identica a quella di certbot (link simbolici, `archive/` 0700, chiave 0600) e il rinnovo con l'hook: nuovo certificato su 8883 e 8884 senza riavvio, con un client TLS rimasto connesso;
- wss con mqtt.js (il client delle dashboard), anche attraverso nginx sulla 443 con `esempi/nginx-mqtt-websocket.conf`;
- il bridge di `esempi/ponte-c5-verso-cloud.conf` con la `mosquitto.conf` di c5, nei due sensi;
- il servizio `ponte` con `mqtt-bridge.js` vero e un hub finto raggiungibile via `host.docker.internal`: lettura di un badge, stato trattenuto e telemetria Tasmota arrivati al hub convertiti nel formato del contratto, con `HUB_TOKEN` come `Authorization: Bearer` e healthcheck `healthy`;
- nessun volume anonimo lasciato dagli script e dal monitor.

Non provati: certificati Let's Encrypt veri, il server di Roberto, dispositivi reali (badge, ESP32, Tasmota).
