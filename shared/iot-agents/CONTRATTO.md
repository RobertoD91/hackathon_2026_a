# Contratto comune IoT + agenti (C2 e C5)

Questo file fissa le interfacce tra firmware, backend, agenti e dashboard. Le soluzioni `c2-*` e `c5-*` lo usano; `shared/iot-agents/` lo implementa. **Se serve cambiarlo, aggiorna prima questo file e avvisa le altre soluzioni.**

## Stack

- **Node.js ≥ 20, JavaScript ES modules, nessuna dipendenza npm** nel nucleo (solo moduli standard: `node:http`, `node:events`, `node:fs`...). Niente build.
- Le soluzioni importano il nucleo con percorsi relativi: `import { createHub } from '../shared/iot-agents/src/index.js'`.
- Le dashboard sono pagine statiche (HTML + JS) servite dallo stesso server Node. Devono funzionare anche aperte su GitHub Pages in **modalità demo** (dati simulati nel browser, nessun backend).
- Il server Node serve i file statici con **gli stessi percorsi della repo** (come GitHub Pages): `/c2-cer-quartiere/public/` → `<repo>/c2-cer-quartiere/public/`. Così i percorsi relativi verso `shared/iot-agents/` funzionano uguali nei due casi.

## 1. Lettura dei sensori (ESP32 → backend)

`POST /api/readings`, `Content-Type: application/json`

```json
{
  "deviceId": "esp32-plebiscito-01",
  "ts": 1763000000000,
  "location": { "lat": 40.8359, "lon": 14.2488, "zone": "plebiscito" },
  "readings": { "temperature_c": 24.1, "light_lux": 5300, "humidity_pct": 61 },
  "meta": { "fw": "0.1.0", "net": "5g", "simulated": false }
}
```

- `ts` (millisecondi epoch) è facoltativo: se manca lo mette il server. Se non è plausibile (< 10¹², es. `millis()` di un ESP32 senza NTP) il server mette la sua ora e conserva l'originale in `meta.deviceTs`.
- `deviceId`: 1-64 caratteri tra lettere, cifre e `. _ : -`.
- `location` è facoltativa (`lat`, `lon`, `zone` tutti facoltativi), ma senza `zone` gli agenti non possono ragionare per zona.
- `readings` è una mappa libera `nome_unità → numero | boolean` (non vuota, max 32 grandezze, nomi `[A-Za-z][A-Za-z0-9_]*`). Nomi standard: `temperature_c`, `humidity_pct`, `light_lux`, `soil_moisture_pct`, `fill_pct` (cestini), `button` (pulsante), `power_w`, `people_count`. Una lettura parziale non cancella le altre grandezze del dispositivo nello stato.
- `meta.net`: `"5g" | "wifi" | "sim"`. `meta.simulated: true` per i dati del simulatore. Il simulatore aggiunge `meta.simTime` (ora simulata, ms epoch) e `meta.speed` (secondi simulati per secondo reale). Altre chiavi di `meta` sono libere (es. `rssi`).
- Il corpo può essere anche un **array** di letture (max 100, tutto o niente).
- Risposta: `202 { "ok": true, "accepted": <n> }`. Errore di validazione: `400 { "ok": false, "error": "..." }`. Corpo oltre 64 KB: `413`.

## 2. Eventi

Tutto passa da un bus di eventi in memoria. Formato unico:

```json
{
  "id": "evt_...",
  "ts": 1763000000000,
  "type": "reading",
  "source": "esp32-plebiscito-01",
  "data": { }
}
```

Tipi:
| `type` | `source` | `data` |
|---|---|---|
| `reading` | id del dispositivo | il corpo di `POST /api/readings` (normalizzato: `ts` sempre presente) |
| `scenario` | `scenario` | `{ "name": "metro_guasto", "params": { ... }, "active": true, "duration": 60 }`: eventi esterni (guasto, partita, allerta meteo) lanciati dalla timeline o a mano. `active` (predefinito `true`) vale `false` quando lo scenario finisce; `duration` (secondi, facoltativa) fa pubblicare al hub la fine in automatico |
| `agent.message` | nome agente | `{ "to": "orchestrator" \| "<agente>" \| "*", "text": "...", "payload": { ... } }`: comunicazione tra agenti |
| `agent.decision` | nome agente | `{ "summary": "...", "actions": [ ... ], "reasoning": "...", "metrics": { ... }, "level": "info" }`: decisione visibile in dashboard. `level` facoltativo: `info` \| `good` \| `warning` \| `critical` |
| `notify` | nome agente | `{ "channel": "whatsapp" \| "dashboard", "to": "<id utente o gruppo>", "text": "..." }`: messaggio verso le persone |
| `metric` | nome agente | `{ "name": "litri_risparmiati", "value": 120, "unit": "L", "label": "Litri risparmiati" }`: KPI da mostrare (`label` facoltativa) |
| `chat` | `chat` | `{ "from": "<utente>", "text": "...", "reply": "..." }`: una domanda a `/api/chat` con la risposta dell'orchestratore (per mostrare in dashboard anche le conversazioni WhatsApp) |

- I `ts` degli eventi sono assegnati dal hub e **strettamente crescenti**: si possono usare come cursore.
- `GET /api/stream`: Server-Sent Events con tutti gli eventi (per le dashboard). Un messaggio `data: <evento JSON>` per evento (nessun campo `event:`, quindi basta `onmessage`). `?types=scenario,notify` filtra per tipo. Ping di commento ogni 15 s.
- `GET /api/state`: istantanea JSON: `{ ok, now, simTime, speed, devices: { <id>: { readings, history, location, zone, meta, ... } }, metrics, decisions, notifications, messages, chats, scenarios: { active, recent }, agents, stats }`.
- `POST /api/scenario`: corpo `{ "name": "...", "params": { ... }, "active"?: true, "duration"?: <s> }`, pubblica un evento `scenario` (per i pulsanti della demo). Risposta `202 { ok, event }`.
- `POST /api/chat`: corpo `{ "from": "<utente>", "text": "..." }`, risposta `{ "reply": "..." }` (più `ok`). È il punto d'ingresso per WhatsApp/OpenClaw e per la chat di prova nella dashboard.
- `GET /api/health`: `{ ok, uptime }`.
- Se il server ha la variabile `HUB_TOKEN`, le `POST` richiedono `Authorization: Bearer <token>` (o `?token=`). Le `GET` restano libere. Predefinito: nessun token.
- CORS aperto (`*`) per la demo.

## 3. Agenti

```js
export class MioAgente extends Agent {
  name = 'meteo';
  subscribes = ['reading', 'scenario'];       // tipi di evento che riceve
  async onEvent(event, ctx) {
    // ctx.state: stato condiviso in sola lettura (ultime letture, ecc.)
    // ctx.llm: adattatore LLM (vedi sotto)
    // ctx.publish(type, data): pubblica un nuovo evento con source = this.name
  }
}
```

- L'**orchestratore** è un agente come gli altri, con `name = 'orchestrator'`. Riceve i messaggi degli agenti, decide e risponde a `/api/chat` con il metodo `async onChat({ from, text }, ctx)` → stringa.
- Regole di consegna: un agente **non riceve mai i propri eventi**; un `agent.message` arriva solo se `to` è il suo nome, `"*"` o assente; gli eventi arrivano a ogni agente uno alla volta, in ordine; un agente in errore non ferma gli altri; le catene di eventi tra agenti più lunghe di 8 passaggi vengono interrotte (protezione dai cicli).
- Gli agenti devono funzionare **anche senza LLM**: regole deterministiche, con l'LLM che aggiunge spiegazioni e linguaggio naturale. Così la demo non dipende dalla rete.

## 4. Adattatore LLM

`ctx.llm.complete({ system, messages, json })` → `{ text, json? }`.

- `prompt: "..."` è una scorciatoia per `messages: [{ role: "user", content: "..." }]`.
- `fallback`: testo (o oggetto, con `json: true`) da usare se l'LLM non c'è o fallisce. Con `fallback` la chiamata **non lancia mai eccezioni**: restituisce il fallback con `fallback: true` ed `error`. Con `mock` restituisce direttamente il fallback.
- `ctx.llm.isMock` dice se c'è un LLM vero.

Provider scelto con variabili d'ambiente:
- `LLM_PROVIDER=mock` (predefinito): risposte deterministiche finte, nessuna rete.
- `LLM_PROVIDER=anthropic` + `ANTHROPIC_API_KEY` (+ `LLM_MODEL`).
- `LLM_PROVIDER=openai-compatible` + `LLM_BASE_URL` + `LLM_API_KEY` (+ `LLM_MODEL`): per qualsiasi endpoint compatibile, incluso un eventuale proxy di OpenClaw.

**Nessuna chiave nel codice o nei file versionati.**

## 5. Canali verso le persone (OpenClaw / WhatsApp)

Il nostro backend **non** parla direttamente con WhatsApp. OpenClaw fa da ponte:
- in entrata, OpenClaw inoltra i messaggi degli utenti a `POST /api/chat`;
- in uscita, gli eventi `notify` con `channel: "whatsapp"` sono disponibili su `GET /api/notifications?since=<ts>&channel=whatsapp` (polling) e su SSE (`/api/stream?types=notify`); OpenClaw li legge e li invia.
  - Risposta: `{ "ok": true, "now": <ts>, "next": <ts>, "notifications": [ <evento notify>, ... ] }`. Il testo è in `data.text`, il destinatario in `data.to`.
  - `since` è esclusivo (eventi con `ts > since`). Alla chiamata successiva si passa `since=<next>`: nessun messaggio perso o duplicato.
  - Senza `since` restituisce le ultime 50 notifiche: alla prima chiamata il ponte di norma le salta e tiene solo `next`.
  - Filtri facoltativi: `channel`, `to`.

Come configurare OpenClaw è ancora da definire: tutto deve essere provabile senza, tramite la chat della dashboard.

## 6. Simulatore

`node shared/iot-agents/sim/simulate.js --config <file.json> --target http://localhost:<porta>` invia letture realistiche secondo una configurazione (dispositivi, posizioni, andamento nel tempo, rumore) e una **timeline** di eventi `scenario`. Serve a sostituire i dispositivi che non abbiamo fisicamente.

- Gli scenari (della timeline o lanciati a mano) possono modificare i dati simulati tramite `effects` nella configurazione (es. `nuvole` → luce × 0,1).
- Lo stesso motore (`sim/sim-core.js`) gira nel browser per la modalità demo e si può avviare dentro il processo del hub (`attachSimulator`). Formato della configurazione: `README.md`, sezione "Simulatore".

## 7. Firmware ESP32

`shared/iot-agents/firmware/esp32-sensor/`: sketch Arduino che legge i sensori e fa `POST /api/readings` via Wi-Fi ogni N secondi, con configurazione separata (`config.h`, non versionato; si versiona `config.example.h`). Il modulo 5G è da definire: per ora si collega via Wi-Fi a un router/hotspot 5G, che va dichiarato come tale.

## 8. Porte locali (per lavorare in parallelo)

| Cosa | Porta |
|---|---|
| esempio del nucleo `shared/iot-agents` | 8701 |
| `c1-feed-simulato` | 8702 |
| `c2-cer-quartiere` | 8703 |
| `c5-regia-evento` | 8704 |

## 9. MQTT (broker `cloud.robertodisanto.it`)

Alternativa a `POST /api/readings` per i dispositivi: pubblicano sul broker e il **ponte** `tools/mqtt-bridge.js` inoltra al hub. Il hub non cambia: riceve sempre le letture della sezione 1.

| Topic | Chi pubblica | Contenuto |
|---|---|---|
| `bighack/<zona>/<deviceId>/readings` | badge, ESP32 | la lettura della sezione 1 (anche un array). Il `deviceId` è **sempre quello del topic**, che sul broker del team è autenticato dall'ACL; uno diverso nel JSON finisce in `meta.claimedDeviceId`. Se manca `location.zone` si prende dal topic. Forma corta ammessa: `{"light_lux": 12, "button": true}` (numeri e boolean di primo livello diventano `readings`) |
| `bighack/<zona>/<deviceId>/status` | dispositivo, **retained**, anche come last will | `{"deviceId": "...", "online": true \| false, ...}` (o il testo `online`/`offline`) → il ponte lo inoltra come lettura `{ "online": true \| false }` |
| `bighack/<zona>/<deviceId>/cmd` | cloud/agenti → dispositivo | comandi (badge: `{"text": "..."}`, `{"read": true}`, `{"interval": 30}`); il ponte non li legge |
| `tele/<topic>/SENSOR`, `STATE`, `LWT` | Tasmota (FullTopic predefinito) | telemetria Tasmota, convertita dal ponte (sotto) |
| `bighack/<zona>/<topic>/tele/SENSOR` | Tasmota con `FullTopic bighack/<zona>/%topic%/%prefix%/` | come sopra, con la zona presa dal topic |
| `napoli/sensori/<nodo>/<grandezza>` | ESP32 di `c5-agentic-city` | `{"valore": n, "zona": "...", "moltiplicatore": m}`: letto dal ponte solo con `MQTT_C5=1` |
| `napoli/nodi/<nodo>/stato` | nodi TwinCiro (`c5-agentic-city/firmware/twinciro-nodo/`), retained con last will | `{"online": bool, "ruolo", "zona", "versione", "ip", "rssi"}` → lettura `{ online }` con zona e ruolo (l'IP non viene inoltrato); solo con `MQTT_C5=1` |

- `<zona>` e `<deviceId>` sono un livello di topic ciascuno: niente `/`, `+`, `#`, spazi (il firmware li sostituisce con `_`). Zona sconosciuta: `senza-zona`.
- Sul broker del team (`cloud/mqtt/`) il **nome utente MQTT di un dispositivo è il suo deviceId** (o il Topic di Tasmota): l'ACL gli fa scrivere solo `bighack/+/<utente>/#`, `tele/<utente>/#`, `stat/<utente>/#` e `napoli/sensori/<utente>/#`. Il ponte usa l'utente `ponte` (lettura di `bighack/#`, `tele/#`, `stat/#`). Porte: 1883 (utente e password), 8883 (TLS), 8884 (WebSocket TLS).
- QoS: letture 0 o 1, stato 1 retained. Keepalive consigliato 30 s (il broker accetta fino a 300), così l'offline arriva entro ~45 s.
- **Dimensione**: una lettura completa del badge è ~500 byte. Il firmware del badge (ESP-MQTT) ha buffer da 1024 byte, Tasmota ~1200, il broker accetta fino a 256 KB. Con **PubSubClient** (sketch Arduino) il limite predefinito è **256 byte compreso il topic**: chiama `mqtt.setBufferSize(1024)` prima di `connect()`, altrimenti `publish()` restituisce `false` senza altri errori.
- `ts` solo se l'ora del dispositivo è sincronizzata (NTP); altrimenti lo mette il hub alla ricezione, come in sezione 1.

### Il ponte MQTT → hub

`node shared/iot-agents/tools/mqtt-bridge.js` (nessuna dipendenza npm; client MQTT 3.1.1 in `tools/mqtt-client.js`, conversioni in `tools/mqtt-convert.js`). Configurazione solo da variabili d'ambiente:

| Variabile | Predefinito | |
|---|---|---|
| `MQTT_URL` | `mqtt://cloud.robertodisanto.it:1883` | anche `mqtts://`, `ws://`, `wss://` |
| `MQTT_USER`, `MQTT_PASSWORD` | — | |
| `MQTT_TOPICS` | `bighack/#` + `tele/+/SENSOR,STATE,LWT` + (`napoli/sensori/+/+`, `napoli/nodi/+/stato`) | filtri separati da virgola |
| `MQTT_TASMOTA`, `MQTT_C5`, `MQTT_STATUS` | 1, 0, 1 | quali formati leggere |
| `MQTT_MAP` / `MQTT_MAP_FILE` | — | `{"<deviceId o topic Tasmota o nodo c5>": {"zone", "lat", "lon", "deviceId"}}`: posizione (vince su quella del dispositivo) e nome nel hub |
| `MQTT_DEFAULT_ZONE` | — | zona dei Tasmota/c5 senza mappa |
| `MQTT_CA_FILE`, `MQTT_INSECURE` | —, 0 | TLS con CA propria / senza verifica (solo prove) |
| `HUB_URL`, `HUB_TOKEN` | `http://localhost:8701`, — | |
| `DRY_RUN`, `HEALTH_PORT`, `LOG` | 0, —, `info` | stampa senza inviare; `GET /health` (200 se connesso al broker); `quiet`/`debug` |

- Ogni messaggio diventa una `POST /api/readings` (una alla volta, in ordine).
  - Il hub giù o in errore 5xx: fino a 5 tentativi, poi la lettura si scarta.
  - Errori 4xx: si scarta e si registra.
  - Coda massima 1000.
- Riconnessione al broker con attesa da 1 a 30 s e nuova iscrizione.
- A ogni lettura il ponte aggiunge `meta.via = "mqtt"`.
- **Tasmota**: `deviceId` = Topic; `meta.source = "tasmota"`, `meta.tasmotaTopic`, `meta.sensors`, `meta.deviceTime` (il campo `Time`, ora locale senza fuso: il `ts` lo mette il hub), `meta.rssi` da `tele/<topic>/STATE`.
  - Campi convertiti:
    - `Illuminance` → `light_lux`; `Temperature` → `temperature_c` (°F convertiti); `Humidity` → `humidity_pct`;
    - `Pressure` → `pressure_hpa` (mmHg/inHg convertiti); `DewPoint` → `dew_point_c`;
    - `CarbonDioxide` → `co2_ppm`, `eCO2` → `eco2_ppm`, `TVOC` → `tvoc_ppb`; `PM2.5`/`PM10` → `pm25_ugm3`/`pm10_ugm3`; `Distance` → `distance_cm`;
    - `ENERGY.Power` → `power_w` (multicanale: `power_w_1`... e la somma in `power_w`), `Voltage` → `voltage_v`, `Current` → `current_a`, `Today`/`Total` → `energy_today_kwh`/`energy_total_kwh`;
    - `ANALOG.A0` → `analog_a0`; `Switch1` → `switch1`; `POWER` in STATE → `relay`; LWT `Online`/`Offline` → `online`.
  - Più sensori dello stesso tipo: il primo prende il nome standard, gli altri `temperature_c_ds18b20_2` e simili. I campi sconosciuti si saltano.
- **c5**: `deviceId` = nodo, `location.zone` = `zona`.
  - `persone` → `people_count` = `valore × moltiplicatore` (come l'agente Folla); `luce` → `light_lux`, `temperatura` → `temperature_c`, `umidita` → `humidity_pct`, `tensione` → `supply_v`.
  - I messaggi con `deviceId` sono copie di un dispositivo `bighack/` e si saltano (niente doppioni).
