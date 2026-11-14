# Contratto del hub della mappa (IoT + agenti)

Questo file fissa le interfacce tra simulatore, hub, agenti e dashboard della mappa "Napoli in tempo reale" (`c5-presentazione/mappa/`, che lo implementa): è il simulatore della presentazione, con folla e sensori simulati. Qui non c'è MQTT e non arrivano dispositivi reali: il loro formato è uno solo, quello della città agentica (`napoli/...`), descritto in [`firmware/`](../../firmware/).

## Stack

- **Node.js ≥ 20, JavaScript ES modules, nessuna dipendenza npm** nel nucleo (solo moduli standard: `node:http`, `node:events`, `node:fs`...). Niente build.
- Pagina, agenti e server importano il nucleo con percorsi relativi (`./src/index.js`, `../src/agent.js`); fonti, luoghi, simulatore e snapshot arrivano da `../../citta-api/` (una sola copia, condivisa con l'API dati città).
- Le dashboard sono pagine statiche (HTML + JS) servite dallo stesso server Node. Devono funzionare anche aperte su GitHub Pages in **modalità demo** (dati simulati nel browser, nessun backend).
- Il server Node serve i file statici con **gli stessi percorsi della repo** (come GitHub Pages): `/c5-presentazione/mappa/` → `<repo>/c5-presentazione/mappa/`. Così i percorsi relativi verso `citta-api/` funzionano uguali nei due casi.

## 1. Lettura dei sensori (simulatore → hub)

`POST /api/readings`, `Content-Type: application/json`

```json
{
  "deviceId": "sim-plebiscito",
  "ts": 1763000000000,
  "location": { "lat": 40.8359, "lon": 14.2488, "zone": "plebiscito" },
  "readings": { "temperature_c": 24.1, "light_lux": 5300, "humidity_pct": 61, "people_count": 1500 },
  "meta": { "simulated": true, "simTime": 1763049600000, "speed": 60 }
}
```

- `ts` (millisecondi epoch) è facoltativo: se manca lo mette il server. Se non è plausibile (< 10¹², es. il contatore di un dispositivo senza orologio) il server mette la sua ora e conserva l'originale in `meta.deviceTs`.
- `deviceId`: 1-64 caratteri tra lettere, cifre e `. _ : -`.
- `location` è facoltativa (`lat`, `lon`, `zone` tutti facoltativi), ma senza `zone` gli agenti non possono ragionare per zona.
- `readings` è una mappa libera `nome_unità → numero | boolean` (non vuota, max 32 grandezze, nomi `[A-Za-z][A-Za-z0-9_]*`). Nomi usati dalla mappa: `temperature_c`, `humidity_pct`, `light_lux`, `people_count` (folla), `button` (pulsante). Una lettura parziale non cancella le altre grandezze del dispositivo nello stato.
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
  "source": "sim-plebiscito",
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
| `chat` | `chat` | `{ "from": "<utente>", "text": "...", "reply": "..." }`: una domanda a `/api/chat` con la risposta dell'orchestratore |

- I `ts` degli eventi sono assegnati dal hub e **strettamente crescenti**: si possono usare come cursore.
- `GET /api/stream`: Server-Sent Events con tutti gli eventi (per le dashboard). Un messaggio `data: <evento JSON>` per evento (nessun campo `event:`, quindi basta `onmessage`). `?types=scenario,notify` filtra per tipo. Ping di commento ogni 15 s.
- `GET /api/state`: istantanea JSON: `{ ok, now, simTime, speed, devices: { <id>: { readings, history, location, zone, meta, ... } }, metrics, decisions, notifications, messages, chats, scenarios: { active, recent }, agents, stats }`.
- `POST /api/scenario`: corpo `{ "name": "...", "params": { ... }, "active"?: true, "duration"?: <s> }`, pubblica un evento `scenario` (per i pulsanti della demo). Risposta `202 { ok, event }`.
- `POST /api/chat`: corpo `{ "from": "<utente>", "text": "..." }`, risposta `{ "reply": "..." }` (più `ok`). Lo usa la chat della dashboard.
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

## 5. Notifiche (WhatsApp simulato)

Le notifiche della mappa sono **simulate**: gli eventi `notify` con `channel: "whatsapp"` restano nel hub e si vedono nella dashboard. CiroGPT vero (OpenClaw su WhatsApp) non passa da qui: legge i dati della città dall'API [`citta-api/`](../../citta-api/README.md) con la skill `napoli-citta-dati`.
- `GET /api/notifications?since=<ts>&channel=whatsapp` (polling) e SSE (`/api/stream?types=notify`).
  - Risposta: `{ "ok": true, "now": <ts>, "next": <ts>, "notifications": [ <evento notify>, ... ] }`. Il testo è in `data.text`, il destinatario in `data.to`.
  - `since` è esclusivo (eventi con `ts > since`). Alla chiamata successiva si passa `since=<next>`: nessun messaggio perso o duplicato.
  - Senza `since` restituisce le ultime 50 notifiche.
  - Filtri facoltativi: `channel`, `to`.

## 6. Simulatore

`node c5-presentazione/mappa/sim/simulate.js --config citta-api/simulatore/sim-config.json --target http://localhost:8701` invia letture realistiche secondo una configurazione (dispositivi, posizioni, andamento nel tempo, rumore) e una **timeline** di eventi `scenario`. Nella mappa tutti i sensori vengono da qui.

- Gli scenari (della timeline o lanciati a mano) possono modificare i dati simulati tramite `effects` nella configurazione (es. `nuvole` → luce × 0,1).
- Lo stesso motore (`citta-api/simulatore/sim-core.js`) gira nel browser per la modalità demo e si può avviare dentro il processo del hub (`attachSimulator`). Formato della configurazione: `README.md`, sezione "Simulatore".

## 7. Porta locale

Il hub della mappa ascolta sulla **8701** (`PORT` per cambiarla); l'API dati città sulla 8791.
