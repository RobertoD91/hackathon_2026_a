# Broker MQTT su twinciro.robertodisanto.it

Broker MQTT del team per The Big Hack 2026: **Eclipse Mosquitto 2.1.2 in Docker**, con autenticazione obbligatoria, permessi per ruolo, persistenza, log, healthcheck e limiti.

**Scelte del 14/11:** MQTT **in chiaro** sulla 1883, con utente e password, **senza TLS** (`MQTT_CERTIFICATI=nessuno`, predefinito). Sul server **non abbiamo root**: basta un utente che possa usare Docker. TLS (8883 e `wss://` 8884) resta pronto e si accende cambiando una riga di `.env`, con i certificati resi leggibili dall'amministratore (sezione [TLS](#tls-facoltativo-spento-di-serie)).

Lo usano i **due dispositivi veri** di TwinCIRO, il badge Cyber Saiyan WHY2025 e la scheda Tasmota (collegati all'hotspot del team, firmware e configurazione in [`../../firmware/`](../../firmware/README.md)), e la città agentica `c5-agentic-city`. **Un solo formato**, quello della città: topic `napoli/...` (specifica completa in [`firmware/README.md`](../../firmware/README.md#formato-mqtt-unico)). I vecchi `bighack/...` e `tele/...` fuori da `napoli/` non sono più permessi.

| Porta | Protocollo | Per chi |
|---|---|---|
| **1883** | MQTT con utente e password (in chiaro) | **tutti**: badge, Tasmota, città c5, amministrazione |
| 8883 | MQTT su TLS | solo con TLS acceso (`MQTT_CERTIFICATI=letsencrypt`) |
| 8884 | MQTT su WebSocket con TLS (`wss://`) | solo con TLS acceso: dashboard nel browser (una pagina https usa solo `wss://`) |
| 9001 | WebSocket in chiaro, **solo su 127.0.0.1** del server | eventuale reverse proxy (opzionale) |

Nessun accesso anonimo su nessuna porta: se qualcuno lo riattivasse, il container risulterebbe `unhealthy`.

## Contenuto

```
cloud/mqtt/
  compose.yaml              broker (servizio mosquitto) e monitor (profilo "monitor")
  .env.example              configurazione: dominio, certificati, porte, password del monitor
  config/
    mosquitto.conf          porte, limiti, persistenza, log, plugin di autenticazione e ACL
    acl                     permessi sui topic napoli/ per ruolo (versionato, nessun segreto)
    avvio.sh                avvio del container: copia ACL (e certificati, se TLS è acceso), sistema i permessi
  scripts/
    inizializza.sh          prima installazione: .env, utenti di servizio (e controllo TLS, se acceso)
    aggiungi-utente.sh      crea un utente o ne cambia la password (mosquitto_passwd nel container)
    rimuovi-utente.sh       elimina un utente
    elenca-utenti.sh        elenco degli utenti
    ricarica.sh             dopo una modifica all'ACL: controlla e ricarica senza disconnettere
    certificati-autofirmati.sh  CA e certificato di prova
    rinnova-certificati.sh  hook di certbot: nuovi certificati senza riavviare
    prova.sh                prova completa: anonimo rifiutato, formato napoli/, ACL (TLS e WSS se accesi)
    stato.sh                stato, scadenza del certificato, statistiche $SYS
  esempi/
    ponte-c5-verso-cloud.conf   bridge dal Mosquitto locale di c5-agentic-city al cloud (copia napoli/#)
    nginx-mqtt-websocket.conf   wss sulla 443 tramite nginx (opzionale)
  segreti/                  NON versionata: utenti/passwd, certificati autofirmati, credenziali
```

`.env` e `segreti/` sono nel `.gitignore`: **nessuna password o chiave va mai nella repo**.

## Requisiti

- Server Linux con **Docker Engine** e il plugin **Compose v2** (`docker compose version`), `git`. Un utente **senza root** va bene, purché possa usare Docker (gruppo `docker`, oppure Docker rootless).
- Record DNS `A` di `twinciro.robertodisanto.it` verso l'IP del server (oggi 34.154.255.49).
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

Crea `.env` (da `.env.example`: TLS spento) e gli **utenti di servizio con password casuali**: `admin`, `c5`, `dashboard`, `monitor`. Le password vengono stampate una volta e salvate in `segreti/credenziali-iniziali.txt` (permessi 0600): distribuiscile al team in modo privato e poi **cancella il file**. Quella di `monitor` finisce anche in `.env`, dove la leggono il servizio `monitor`, `stato.sh` e `prova.sh`. Si può rilanciare: gli utenti esistenti non vengono toccati, e se trova i vecchi `ponte` o `c5-plastico` dice di eliminarli.

### 4. Avvio e prova

```bash
docker compose up -d
docker compose ps                  # STATUS "Up ... (healthy)" dopo una ventina di secondi
docker compose logs -f mosquitto   # Ctrl+C per uscire
./scripts/prova.sh                 # deve finire con "Tutte le prove sono passate."
```

`prova.sh` crea un utente-dispositivo temporaneo e verifica: anonimo e password errata rifiutati; andata e ritorno sui propri comandi `napoli/nodi/<utente>/cmd` sulla 1883 (e su 8883 e 8884 se TLS è acceso); una lettura `napoli/sensori/<utente>/temperatura` e lo stato trattenuto `napoli/nodi/<utente>/stato` accettati e ricevuti dall'utente `monitor`; ACL che nega le letture e lo stato di un altro dispositivo, `napoli/folla/...`, `napoli/eventi/manuale` e il vecchio `bighack/...`. Poi cancella lo stato di prova ed elimina l'utente.

### 5. (Solo con TLS) certificati e rinnovo

Vedi [TLS](#tls-facoltativo-spento-di-serie). Con TLS spento non c'è nulla da rinnovare.

### 6. Un utente per ogni dispositivo

```bash
./scripts/aggiungi-utente.sh badge-1        # stampa la password generata (va in telemetry_config.h del badge)
./scripts/aggiungi-utente.sh tasmota-1      # stampa la password (va in MqttPassword di Tasmota)
./scripts/aggiungi-utente.sh badge-1 -      # cambia la password (chiesta da tastiera)
./scripts/rimuovi-utente.sh tasmota-1
./scripts/elenca-utenti.sh
```

Le modifiche valgono subito (SIGHUP), senza riavvio. Chi è già connesso resta connesso fino alla disconnessione: per buttarlo fuori subito, `docker compose restart mosquitto`.

## Aggiornare il server già attivo

Il broker sul server è stato installato prima del passaggio al formato unico (14/11 pomeriggio). Dopo `git pull`, dalla cartella `cloud/mqtt` (sempre **senza** `docker compose down -v`, che cancellerebbe il volume `dati`):

```bash
cd ~/hackathon_2026_a && git pull --rebase origin master && cd cloud/mqtt
./scripts/ricarica.sh                      # 1. nuova ACL (solo napoli/): controllata e ricaricata senza disconnettere nessuno
docker compose up -d --remove-orphans      # 2. toglie il container del ponte, se era acceso (il servizio non esiste più)
./scripts/elenca-utenti.sh                 # 3. se ci sono ponte e/o c5-plastico:
./scripts/rimuovi-utente.sh ponte          #    (solo se esiste)
./scripts/rimuovi-utente.sh c5-plastico    #    (solo se esiste)
./scripts/prova.sh                         # 4. deve finire con "Tutte le prove sono passate."
```

- Al passo 1 Docker può avvisare `Found orphan containers (bighack-mqtt-ponte-1)`: è il ponte, lo toglie il passo 2.
- Il passo 2 non tocca il broker (stessa immagine e configurazione: resta acceso, nessuno viene disconnesso) e non cancella volumi. Se il ponte non era acceso non fa nulla.
- Rilanciare `./scripts/inizializza.sh` non serve; se lo si fa, non tocca gli utenti esistenti e segnala `ponte` e `c5-plastico` da eliminare.
- In `.env` possono restare `MQTT_PONTE_PASSWORD`, `HUB_URL`, `HUB_TOKEN`, `PONTE_*`: non li legge più nessuno, si possono cancellare.
- Gli utenti dei dispositivi creati per il vecchio formato (es. `badge-ab12`, `esp32-...`, `tasmota-serra`) funzionano ancora come utenti, ma i loro permessi ora valgono solo sotto `napoli/`: elimina quelli che non servono e crea `badge-1` e `tasmota-1` (sezione 6).
- I vecchi messaggi trattenuti `bighack/.../status` restano nel volume ma non vengono più consegnati a nessuno (`check_retain_source true`: chi li ha pubblicati non ha più il permesso di scriverli): non serve fare nulla.
- `cloud/mqtt` non usa più nulla fuori dalla sua cartella: la cartella `shared/` sparita con il pull non lo riguarda.

## Utenti e permessi

Il **nome utente di un dispositivo è il suo id** (badge) o il suo **Topic** (Tasmota): i permessi arrivano dai pattern `%u` di `config/acl` e non serve modificarla. Nomi ammessi: 1-64 caratteri tra lettere, cifre, `.`, `_`, `-`. Non usare come nome di un dispositivo i nomi dei ruoli fissi.

| Utente | Legge | Scrive |
|---|---|---|
| dispositivo `<id>` (badge `badge-1`, Tasmota `tasmota-1`) | `napoli/nodi/<id>/cmd` (badge), `napoli/nodi/<id>/cmnd/#` (Tasmota) | `napoli/sensori/<id>/#` (letture), `napoli/nodi/<id>/#` (stato, last will, topic interni di Tasmota) |
| `c5` (città agentica, o il suo bridge) | `napoli/#` | `napoli/#` (anche i comandi ai dispositivi) |
| `dashboard` (browser) | `napoli/#` | niente: la sua password è pubblica |
| `monitor` | `#`, `$SYS/#` | niente |
| `admin` | tutto, `$SYS/#` | tutto |

Un dispositivo **non** può scrivere sotto il nome di un altro, né sui topic della città (`napoli/folla/...`, `napoli/eventi/...`, `napoli/semafori/...`), né fuori da `napoli/`. I ruoli `ponte` e `c5-plastico` non esistono più (sezione [Aggiornare il server già attivo](#aggiornare-il-server-già-attivo)).

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

I client devono fidarsi di `segreti/certs-autofirmati/ca.crt` (`--cafile`, `TELEMETRY_MQTT_CA_PEM` sul badge). Il browser rifiuta `wss://` autofirmato finché non apri una volta `https://<host>:8884/` e accetti l'avviso.

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
# un terminale ascolta (città), l'altro pubblica come il badge (1883 in chiaro)
mosquitto_sub -h $H -p 1883 -u c5 -P '<password c5>' -t 'napoli/sensori/#' -t 'napoli/nodi/#' -v
mosquitto_pub -h $H -p 1883 -u badge-1 -P '<password>' \
  -t napoli/sensori/badge-1/temperatura -m '{"zona":"rotonda_diaz","valore":24.1}'
mosquitto_pub -h $H -p 1883 -u badge-1 -P '<password>' -r -q 1 \
  -t napoli/nodi/badge-1/stato -m '{"online":true,"ruolo":"badge","zona":"rotonda_diaz","versione":"prova"}'
# ACL: pubblicazione vietata, MQTT 5 + QoS 1 risponde "Not authorized"
mosquitto_pub -h $H -p 1883 -V 5 -q 1 -u badge-1 -P '<password>' -t napoli/sensori/tasmota-1/luce -m x
# comando dalla città al badge (testo sullo schermo)
mosquitto_pub -h $H -p 1883 -u c5 -P '<password c5>' -t napoli/nodi/badge-1/cmd -m '{"text":"ciao dalla città"}'
# solo con TLS acceso: 8883 (CA di sistema) e WebSocket su TLS 8884
mosquitto_sub -h $H -p 8883 --tls-use-os-certs -u admin -P '<password>' -t '#' -v
mosquitto_sub -h $H -p 8884 --ws --tls-use-os-certs -u dashboard -P '<password>' -t 'napoli/#' -v
```

Senza installare nulla: `docker run --rm -it --entrypoint mosquitto_sub eclipse-mosquitto:2.1.2-alpine -h $H ...` (stessi argomenti). Il formato dei messaggi si controlla con `... -v | node firmware/valida-messaggi.mjs` dalla radice della repo.

Strumenti grafici: [MQTT Explorer](https://mqtt-explorer.com/) o [MQTTX](https://mqttx.app/) con host `twinciro.robertodisanto.it`, porta 1883, TLS spento, utente `admin`.

## Configurazione dei client

### Badge WHY2025 e scheda Tasmota

I due dispositivi veri si collegano all'hotspot del team (`iBob12`) e a questo broker sulla 1883, con un utente ciascuno (`badge-1`, `tasmota-1`). Configurazione completa in [`firmware/why2025-badge/`](../../firmware/why2025-badge/README.md) e [`firmware/tasmota/`](../../firmware/tasmota/README.md); in breve:

- **badge**: in `telemetry_config.h` solo `TELEMETRY_MQTT_USER "badge-1"` e la password (hotspot, host, porta 1883 e trasporto `"mqtt"` sono già i predefiniti). Pubblica `napoli/sensori/badge-1/<grandezza>`, lo stato trattenuto con last will su `napoli/nodi/badge-1/stato` e ascolta `napoli/nodi/badge-1/cmd`;
- **Tasmota**: `Topic` = utente e `FullTopic napoli/nodi/%topic%/%prefix%/`, così anche i suoi topic interni (`cmnd`, `stat`, `tele`, `LWT`) restano sotto `napoli/nodi/tasmota-1/`; le letture nel formato `napoli/sensori/...` le scrivono le Rules. Un solo comando `Backlog` dalla console web.

### c5-agentic-city

La città si collega a questo broker con l'utente `c5` (legge e scrive `napoli/#`). Due strade:

1. **Collegamento diretto (la più semplice):** il `BusMQTT` della città (Python, paho-mqtt) prende utente e password dalle variabili `C5_MQTT_UTENTE` e `C5_MQTT_PASSWORD`, sulla 1883 in chiaro:
   ```bash
   cd c5-agentic-city
   C5_MQTT_UTENTE=c5 C5_MQTT_PASSWORD='<password c5>' python avvia.py --broker twinciro.robertodisanto.it:1883
   ```
   Sul server stesso il broker è `localhost:1883`. Con Docker (`c5-agentic-city/compose.yaml`) il broker si sceglie con `C5_BROKER` (dal container il server è `host.docker.internal:1883`) e la città si avvia **sempre con `--no-deps`** (`docker compose up -d --no-deps citta`): senza, parte anche il Mosquitto locale di c5, che cerca di prendersi la 1883 di questo broker. Guida: [Collegarsi al broker del team](../../c5-agentic-city/README.md#collegarsi-al-broker-del-team).
2. **Bridge (se il portatile della città deve funzionare anche senza internet):** la città resta sul suo Mosquitto locale anonimo (`c5-agentic-city/docker/mosquitto.conf`), che copia `napoli/#` nei due sensi verso il cloud con l'utente `c5`. Istruzioni in `esempi/ponte-c5-verso-cloud.conf`: un file non versionato con la password, un volume in più e la riga `include_dir /mosquitto/config/conf.d` in fondo alla loro `mosquitto.conf`.

Cosa ne fa la città: legge tutte le letture `napoli/sensori/+/+` e lo stato dei nodi (`napoli/nodi/+/stato` e, per Tasmota, `napoli/nodi/+/tele/LWT`) e li mostra nella sala (pannello "Sensori reali") e in `GET /stato` (chiavi `sensori` e `nodi`). L'agente Meteo&Mare dice in dialogo la temperatura vera; l'agente Folla somma `persone × moltiplicatore` alla stima della zona, ignorando le letture più vecchie di 180 s, i nodi offline e i numeri non validi. Formato completo in [`firmware/README.md`](../../firmware/README.md#formato-mqtt-unico).

### Dashboard nel browser

Le pagine servite in https (GitHub Pages) possono aprire solo `wss://`: **serve TLS acceso** (oggi è spento, e nessuna pagina del progetto legge il broker). Con [mqtt.js](https://github.com/mqttjs/MQTT.js):

```js
import mqtt from 'https://cdn.jsdelivr.net/npm/mqtt@5.16.1/+esm';
const client = mqtt.connect('wss://twinciro.robertodisanto.it:8884/mqtt', {
  username: 'dashboard', password: '<password dashboard>', protocolVersion: 5,
});
client.on('connect', () => client.subscribe(['napoli/sensori/#', 'napoli/nodi/+/stato']));
client.on('message', (topic, payload) => console.log(topic, payload.toString()));
```

Tutto ciò che sta in una pagina web è pubblico, password compresa: per questo `dashboard` può **solo leggere** e non ha nemmeno i permessi da dispositivo. Se la password finisce dove non deve, cambiala con `./scripts/aggiungi-utente.sh dashboard`.

## Monitor e stato

```bash
docker compose --profile monitor run --rm monitor                  # tutti i messaggi, Ctrl+C per uscire
MONITOR_TOPIC='napoli/sensori/#' docker compose --profile monitor run --rm monitor   # solo le letture dei dispositivi
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
| errori di certificato sul badge (solo con TLS acceso) | CA sbagliata (radice di Let's Encrypt) |
| il dispositivo è connesso ma i suoi messaggi non arrivano | utente diverso dall'id nel topic (badge) o dal `Topic` (Tasmota): l'ACL li scarta |
| container `unhealthy` o in riavvio | `docker compose logs mosquitto`: di solito manca il file delle password, oppure TLS è acceso e mancano i certificati (`avvio.sh: ERRORE`) |

## Cosa è stato verificato

**14/11 sera, formato unico `napoli/`** (Docker, Mosquitto 2.1.2, copie della cartella con porte 18831-18844 e nomi di progetto di prova, eliminati alla fine):
- `inizializza.sh` (crea solo `admin`, `c5`, `dashboard`, `monitor`), avvio `healthy`, `prova.sh` con tutte le prove verdi, `ricarica.sh`, `stato.sh`, monitor con `MONITOR_TOPIC`, `aggiungi-utente.sh` e `rimuovi-utente.sh`;
- badge (`badge-prova`): letture `napoli/sensori/badge-prova/temperatura` e `.../persone` e stato trattenuto accettati; negati i topic di un altro dispositivo, `napoli/eventi/manuale`, i `cmnd` di Tasmota e il vecchio `bighack/`; riceve i comandi della città su `napoli/nodi/badge-prova/cmd` e non riceve nulla dei topic altrui; **last will** `{"online":false}` trattenuto alla caduta senza DISCONNECT;
- Tasmota (`tasmota-prova`, FullTopic `napoli/nodi/%topic%/%prefix%/`): `tele/LWT` trattenuto, `tele/STATE`, `tele/SENSOR`, `stat/RESULT`, lettura delle Rules `napoli/sensori/tasmota-prova/luce` e stato con `rssi` accettati; riceve `napoli/nodi/tasmota-prova/cmnd/...` dalla città; negato il vecchio `tele/tasmota-prova/SENSOR`;
- `c5` riceve tutto `napoli/#` e può comandare i dispositivi, ma non scrivere fuori da `napoli/`; `dashboard` e `monitor` leggono e non possono scrivere nemmeno sotto il proprio nome;
- i messaggi ricevuti da `c5` passano `firmware/valida-messaggi.mjs`;
- **aggiornamento del server già attivo**, partendo dalla versione precedente con il ponte acceso e i vecchi utenti: i passi della sezione [Aggiornare il server già attivo](#aggiornare-il-server-già-attivo) tolgono il ponte senza riavviare il broker, il volume resta, `prova.sh` passa, e il vecchio stato trattenuto `bighack/.../status` non viene più consegnato nemmeno ad `admin` e `monitor`.

In precedenza (14/11 pomeriggio e prima), con il vecchio formato: TLS con certificati autofirmati e con `LETSENCRYPT_DIR` nella forma "piatta" di `../certificati/`; persistenza dei messaggi trattenuti dopo il riavvio; limite di 256 KB e keepalive oltre 300 s rifiutati; `ricarica.sh` che blocca un'ACL sbagliata; rinnovo dei certificati senza riavvio; wss con mqtt.js, anche attraverso nginx sulla 443 con `esempi/nginx-mqtt-websocket.conf`; il bridge di `esempi/ponte-c5-verso-cloud.conf` con la `mosquitto.conf` di c5, nei due sensi. Queste parti non sono cambiate.

Non provati: certificati Let's Encrypt veri, il server di Roberto, i dispositivi veri (badge e scheda Tasmota) sull'hotspot.
