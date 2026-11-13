# Contratto comune IoT + agenti (C2 e C5)

Questo file fissa le interfacce tra firmware, backend, agenti e dashboard. Le soluzioni `c2-*` e `c5-*` lo usano; `shared/iot-agents/` lo implementa. **Se serve cambiarlo, aggiorna prima questo file e avvisa le altre soluzioni.**

## Stack

- **Node.js ≥ 20, JavaScript ES modules, nessuna dipendenza npm** nel nucleo (solo moduli standard: `node:http`, `node:events`, `node:fs`...). Niente build.
- Le soluzioni importano il nucleo con percorsi relativi: `import { createHub } from '../shared/iot-agents/src/index.js'`.
- Le dashboard sono pagine statiche (HTML + JS) servite dallo stesso server Node. Devono funzionare anche aperte su GitHub Pages in **modalità demo** (dati simulati nel browser, nessun backend).

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

- `ts` (millisecondi epoch) è facoltativo: se manca lo mette il server.
- `readings` è una mappa libera `nome_unità → numero | boolean`. Nomi standard: `temperature_c`, `humidity_pct`, `light_lux`, `soil_moisture_pct`, `fill_pct` (cestini), `button` (pulsante), `power_w`, `people_count`.
- `meta.net`: `"5g" | "wifi" | "sim"`. `meta.simulated: true` per i dati del simulatore.
- Risposta: `202 { "ok": true }`. Errore di validazione: `400 { "ok": false, "error": "..." }`.

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
| `reading` | id del dispositivo | il corpo di `POST /api/readings` |
| `scenario` | `scenario` | `{ "name": "metro_guasto", "params": { ... } }`: eventi esterni (guasto, partita, allerta meteo) lanciati dal timeline o a mano |
| `agent.message` | nome agente | `{ "to": "orchestrator" \| "<agente>" \| "*", "text": "...", "payload": { ... } }`: comunicazione tra agenti |
| `agent.decision` | nome agente | `{ "summary": "...", "actions": [ ... ], "reasoning": "...", "metrics": { ... } }`: decisione visibile in dashboard |
| `notify` | nome agente | `{ "channel": "whatsapp" \| "dashboard", "to": "<id utente o gruppo>", "text": "..." }`: messaggio verso le persone |
| `metric` | nome agente | `{ "name": "litri_risparmiati", "value": 120, "unit": "L" }`: KPI da mostrare |

- `GET /api/stream`: Server-Sent Events con tutti gli eventi (per le dashboard).
- `GET /api/state`: istantanea JSON (ultime letture per dispositivo, ultime decisioni, metriche).
- `POST /api/scenario`: corpo `{ "name": "...", "params": { ... } }`, pubblica un evento `scenario` (per i pulsanti della demo).
- `POST /api/chat`: corpo `{ "from": "<utente>", "text": "..." }`, risposta `{ "reply": "..." }`. È il punto d'ingresso per WhatsApp/OpenClaw e per la chat di prova nella dashboard.

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

- L'**orchestratore** è un agente come gli altri, con `name = 'orchestrator'`. Riceve i messaggi degli agenti, decide e risponde a `/api/chat`.
- Gli agenti devono funzionare **anche senza LLM**: regole deterministiche, con l'LLM che aggiunge spiegazioni e linguaggio naturale. Così la demo non dipende dalla rete.

## 4. Adattatore LLM

`ctx.llm.complete({ system, messages, json })` → `{ text, json? }`.

Provider scelto con variabili d'ambiente:
- `LLM_PROVIDER=mock` (predefinito): risposte deterministiche finte, nessuna rete.
- `LLM_PROVIDER=anthropic` + `ANTHROPIC_API_KEY` (+ `LLM_MODEL`).
- `LLM_PROVIDER=openai-compatible` + `LLM_BASE_URL` + `LLM_API_KEY` (+ `LLM_MODEL`): per qualsiasi endpoint compatibile, incluso un eventuale proxy di OpenClaw.

**Nessuna chiave nel codice o nei file versionati.**

## 5. Canali verso le persone (OpenClaw / WhatsApp)

Il nostro backend **non** parla direttamente con WhatsApp. OpenClaw fa da ponte:
- in entrata, OpenClaw inoltra i messaggi degli utenti a `POST /api/chat`;
- in uscita, gli eventi `notify` con `channel: "whatsapp"` sono disponibili su `GET /api/notifications?since=<ts>` (polling) e su SSE; OpenClaw li legge e li invia.

Come configurare OpenClaw è ancora da definire: tutto deve essere provabile senza, tramite la chat della dashboard.

## 6. Simulatore

`node shared/iot-agents/sim/simulate.js --config <file.json> --target http://localhost:<porta>` invia letture realistiche secondo una configurazione (dispositivi, posizioni, andamento nel tempo, rumore) e una **timeline** di eventi `scenario`. Serve a sostituire i dispositivi che non abbiamo fisicamente.

## 7. Firmware ESP32

`shared/iot-agents/firmware/esp32-sensor/`: sketch Arduino che legge i sensori e fa `POST /api/readings` via Wi-Fi ogni N secondi, con configurazione separata (`config.h`, non versionato; si versiona `config.example.h`). Il modulo 5G è da definire: per ora si collega via Wi-Fi a un router/hotspot 5G, che va dichiarato come tale.

## 8. Porte locali (per lavorare in parallelo)

| Cosa | Porta |
|---|---|
| esempio del nucleo `shared/iot-agents` | 8701 |
| `c1-feed-simulato` | 8702 |
| `c2-cer-quartiere` | 8703 |
| `c5-regia-evento` | 8704 |
