# `shared/iot-agents`: base comune IoT + agenti

Base tecnica condivisa da `c2-cer-quartiere` (Challenge 02) e `c5-regia-evento` (Challenge 05). Implementa il contratto [`CONTRATTO.md`](CONTRATTO.md): leggilo per i formati; qui c'è come si usa.

**Node.js ≥ 20, ES modules, nessuna dipendenza npm, niente build.**

```
 ESP32 (firmware/)  ─┐                       ┌─► agente A ─┐
 simulatore (sim/)  ─┼─ POST /api/readings ─►│   agente B ─┼─ agent.message ─► orchestrator ─┬─► notify (WhatsApp via OpenClaw)
 dashboard, timeline ┘  POST /api/scenario   │   ...       ┘                                 ├─► agent.decision, metric (dashboard)
                                             │   bus di eventi + stato condiviso              └─► risposta a POST /api/chat
                                             └─► GET /api/stream (SSE), /api/state, /api/notifications
```

Tutto passa da un **bus di eventi** in memoria: ogni lettura, scenario, messaggio tra agenti, decisione, notifica e metrica è un evento `{ id, ts, type, source, data }`. Gli agenti si iscrivono ai tipi che li interessano; lo stato condiviso tiene le ultime letture, decisioni, metriche e notifiche; il server HTTP espone tutto alle dashboard e a OpenClaw.

Lo stesso nucleo gira **anche nel browser**: le dashboard su GitHub Pages, senza backend, fanno girare agenti e simulatore in locale (modalità demo).

## Avvio rapido

Dalla root della repo:

```bash
node shared/iot-agents/example/server.js          # hub + 3 agenti + simulatore su http://localhost:8701/
node --test shared/iot-agents/test/               # test (anche: cd shared/iot-agents && npm test)
```

Apri http://localhost:8701/ (reindirizza a `/shared/iot-agents/example/`): letture in diretta, decisioni, metriche, pulsanti degli scenari, notifiche e chat. La timeline dell'esempio lancia un'ondata di calore dopo 20 s e le nuvole dopo 85 s; la giornata simulata (dalle 15:00, ×60) ricomincia ogni 3 minuti.

Altri comandi:

```bash
# hub senza simulatore interno + simulatore separato (anche da un altro PC)
node shared/iot-agents/example/server.js --no-sim
node shared/iot-agents/sim/simulate.js --config shared/iot-agents/example/sim-config.json --target http://localhost:8701

# una sola lettura per dispositivo (prova veloce del formato)
node shared/iot-agents/sim/simulate.js --config shared/iot-agents/example/sim-config.json --once

# ponte OpenClaw simulato: scrivi come su WhatsApp, vedi le notifiche in uscita
node shared/iot-agents/tools/openclaw-bridge-sim.js
node shared/iot-agents/tools/openclaw-bridge-sim.js --say "che temperatura c'è?"

# modalità demo statica, come su GitHub Pages
python3 -m http.server 8711     # poi apri http://localhost:8711/shared/iot-agents/example/
```

Online (dopo il push): https://robertodisanto.it/hackathon_2026_a/shared/iot-agents/example/ (sempre in modalità demo).

## Struttura

| Percorso | Contenuto | Gira in |
|---|---|---|
| `src/index.js` | punto d'ingresso Node: esporta tutto | Node |
| `src/hub.js` | `createHub`: nucleo + server HTTP, SSE, file statici | Node |
| `src/core.js` | `createCore`: bus + stato + agenti + LLM, senza HTTP | Node e browser |
| `src/agent.js` | classe base `Agent` | Node e browser |
| `src/state.js` | `HubState`: stato condiviso | Node e browser |
| `src/bus.js`, `src/events.js` | bus di eventi, formato degli eventi | Node e browser |
| `src/validate.js` | validazione di letture, scenari, chat | Node e browser |
| `src/llm.js` | adattatore LLM: `mock`, `anthropic`, `openai-compatible` | Node (e browser solo `mock`) |
| `src/log.js` | log leggibili in console | Node e browser |
| `src/client.js` | `connectHub` per le dashboard: modalità live o demo | browser |
| `src/ui-helpers.js` | etichette, formattazione, sparkline SVG | browser |
| `sim/sim-core.js` | motore del simulatore | Node e browser |
| `sim/simulate.js` | simulatore da riga di comando, `runSimulator`, `attachSimulator` | Node |
| `example/` | demo minima da copiare (porta 8701) | — |
| `example/mappa.js`, `example/luoghi.js` | mappa "Napoli in tempo reale" stile [Seoul Real-Time City Data](https://data.seoul.go.kr/SeoulRtd/): 10 luoghi, 4 livelli di affollamento o di caldo, vista mappa/lista, ricerca, filtro per categoria, scheda di dettaglio, cerchio che pulsa sul luogo più critico di ogni categoria. Leaflet 1.9.4 da cdnjs, tessere OpenStreetMap. Luoghi e capienze (indicative) in `luoghi.js`; l'affollamento arriva dalla lettura `people_count` dei sensori della zona | browser |
| `example/agents/folla.js` | agente folla: livello per luogo, quando un luogo diventa "Affollato" propone all'orchestratore l'alternativa tranquilla più vicina (notifica WhatsApp ai turisti) | Node e browser |
| `firmware/esp32-sensor/` | sketch ESP32 ([README](firmware/esp32-sensor/README.md)) | ESP32 |
| `tools/openclaw-bridge-sim.js` | simulazione del ponte OpenClaw | Node |
| `test/` | test `node:test` | Node |

## Creare una soluzione (C2, C5)

1. Copia `example/` nella tua cartella, es. `c2-cer-quartiere/`, e correggi i percorsi relativi (`../src/` → `../shared/iot-agents/src/`, `../../src/` → `../../shared/iot-agents/src/`, idem per `sim/`).
2. Aggiungi un `package.json` con `{ "type": "module" }` (le cartelle sono ES modules).
3. Cambia porta (C2: **8703**, C5: **8704**), agenti, `sim-config.json` e dashboard.
4. Gli agenti devono essere **isomorfi** (niente `node:*`): così girano anche nel browser in modalità demo. Se ti serve qualcosa solo di Node (file, API esterne), mettilo in un agente separato che non passi a `demoAgents`.
5. Nelle pagine usa **solo percorsi relativi** e attenzione a maiuscole/minuscole: su GitHub Pages il sito sta sotto `/hackathon_2026_a/`.

Tutto ciò che sta in `staticDir` diventa pubblico: non metterci segreti (i file che iniziano con un punto, come `.env`, non vengono mai serviti).

## API del nucleo

### `createHub(options)` (Node)

```js
import { createHub, attachSimulator, loadSimConfig } from '../shared/iot-agents/src/index.js';

const hub = createHub({
  port: 8703,                                    // predefinito: env PORT o 8701; 0 = porta libera
  host: '0.0.0.0',                               // predefinito: env HOST o 0.0.0.0 (raggiungibile dagli ESP32)
  staticDir: new URL('./', import.meta.url),     // cartella della dashboard
  publicDirs: [],                                // altre cartelle da servire (facoltativo)
  agents: [new Casa(), new Orchestratore()],
  llm: undefined,                                // predefinito: createLLM() dalle variabili d'ambiente
  token: undefined,                              // predefinito: env HUB_TOKEN (se c'è, le POST lo richiedono)
});
const { url, dashboardUrl } = await hub.start();
const sim = attachSimulator(hub, await loadSimConfig(new URL('./sim-config.json', import.meta.url)));
// ...
sim.stop();
await hub.stop();
```

Altre opzioni (le stesse di `createCore`): `log` (logger), `limits` (`{ maxDecisions: 50, maxNotifications: 200, historySize: 60, ... }`), `maxDepth` (8, protezione cicli), `queueLimit` (200 eventi in coda per agente), `chatTimeoutMs` (60 000).

L'oggetto `hub`:

| Membro | Descrizione |
|---|---|
| `start()` / `stop()` | avvia e ferma server, agenti (`onStart`/`onStop`), timer e client SSE |
| `url`, `dashboardUrl`, `port`, `server` | indirizzi (dopo `start`) e `http.Server` |
| `publish(type, data, { source })` | pubblica un evento (restituisce l'evento) |
| `ingestReading(body)` | come `POST /api/readings` → `{ ok, event }` o `{ ok: false, error }` |
| `scenario(name, params, { duration, active })` | come `POST /api/scenario` |
| `chat({ from, text })` | come `POST /api/chat` → `Promise<{ ok, reply }>` |
| `subscribe(fn, { types })` | ascolta il bus; restituisce la funzione per disiscriversi |
| `state` | lo stato condiviso (`HubState`, vedi sotto) |
| `bus`, `llm`, `log` | bus di eventi, adattatore LLM, logger |
| `addAgent(agent)`, `agents()` | aggiunge un agente anche a hub avviato; elenco degli agenti |
| `idle()` | attende che gli agenti abbiano smaltito le code (utile nei test) |

### `Agent` e il contesto `ctx`

```js
import { Agent } from '../shared/iot-agents/src/agent.js';

export class CasaAgent extends Agent {
  name = 'casa';                       // unico; è la `source` dei suoi eventi
  subscribes = ['reading', 'scenario']; // tipi di evento ricevuti ('*' = tutti)
  description = 'Produzione FV e consumi delle case';

  async onEvent(event, ctx) {
    if (event.type !== 'reading') return;
    const { readings, location } = event.data;
    if (typeof readings.light_lux !== 'number') return;
    const kw = (readings.light_lux / 100_000) * 3;             // luce come proxy del fotovoltaico
    ctx.metric('fv_kw', Math.round(kw * 10) / 10, 'kW', { label: 'Produzione FV' });
    if (kw > 2 && this.cooldown(`sole:${location?.zone}`, 10 * 60_000)) {
      ctx.send('orchestrator', `Sole pieno in zona ${location?.zone}`, { tipo: 'sole', zona: location?.zone, kw });
    }
  }
}
```

| `ctx.` | Descrizione |
|---|---|
| `state` | stato condiviso, sola lettura |
| `llm` | adattatore LLM (`ctx.llm.complete(...)`, `ctx.llm.isMock`) |
| `publish(type, data)` | evento qualsiasi con `source` = nome dell'agente |
| `decide(summary, { actions, reasoning, metrics, level })` | evento `agent.decision` (`level`: `info`, `good`, `warning`, `critical`) |
| `send(to, text, payload)` | evento `agent.message` (`to`: nome agente, `'orchestrator'` o `'*'`) |
| `notify(channel, to, text)` | evento `notify` (`channel`: `'whatsapp'` o `'dashboard'`) |
| `metric(name, value, unit, { label })` | evento `metric` |
| `every(ms, fn)` | timer ripetuto (`fn(ctx)`), fermato da `hub.stop()`; restituisce la funzione per fermarlo |
| `simTime()` | ora simulata in ms (uguale all'ora reale senza simulatore) |
| `log` | logger con il nome dell'agente |
| `event` | evento che ha causato la chiamata (`null` in `onStart`, `onChat`, `every`) |

Metodi facoltativi dell'agente: `onStart(ctx)`, `onStop(ctx)`, `onChat({ from, text }, ctx)` (solo orchestratore). `this.cooldown(chiave, ms)` restituisce `true` al massimo una volta ogni `ms`: usalo per non ripetere notifiche o chiamate LLM a ogni lettura.

Regole di consegna (garantite dal nucleo, provate dai test):
- un agente **non riceve mai i propri eventi**;
- `agent.message` arriva solo se `to` è il suo nome, `'*'` o assente;
- gli eventi arrivano a ciascun agente **uno alla volta, in ordine** (coda per agente; se supera 200 si scartano le letture più vecchie, mai gli scenari);
- un agente che lancia un'eccezione viene registrato (`/api/state` → `agents[].errors`, `lastError`) e **non blocca gli altri**;
- una catena di eventi causati da agenti oltre 8 passaggi viene interrotta (cicli A → B → A...).

Funziona anche un oggetto semplice: `{ name: 'log', subscribes: ['*'], onEvent: (e) => console.log(e.type) }`.

### L'orchestratore

```js
import { Agent } from '../shared/iot-agents/src/agent.js';

export class Orchestrator extends Agent {
  name = 'orchestrator';
  subscribes = ['agent.message', 'scenario'];

  async onEvent(event, ctx) {
    if (event.type === 'scenario' && event.data.name === 'metro_guasto' && event.data.active !== false) {
      ctx.send('*', 'Guasto in metro: valutate l\'impatto', event.data.params);
    }
    if (event.type === 'agent.message' && event.data.payload?.tipo === 'sole') {
      const base = `C'è sole in zona ${event.data.payload.zona}: è il momento di avviare lavatrice e lavastoviglie.`;
      const { text } = await ctx.llm.complete({
        system: 'Scrivi avvisi brevi e cordiali in italiano per una comunità energetica.',
        prompt: `Riformula senza cambiare i dati: ${base}`,
        fallback: base,                            // senza LLM (o se fallisce) si usa questo
      });
      ctx.notify('whatsapp', `cer-${event.data.payload.zona}`, text);
      ctx.decide(`Consiglio inviato alla zona ${event.data.payload.zona}`, { level: 'info', actions: [{ type: 'notify' }] });
    }
  }

  async onChat({ from, text }, ctx) {          // POST /api/chat → { reply }
    const media = ctx.state.average('temperature_c');
    return `Ciao ${from}! Temperatura media ${media?.toFixed(1) ?? 'n/d'} °C.`;
  }
}
```

**Schema consigliato** (come in `example/agents/orchestrator.js`): costruisci sempre il testo con regole deterministiche e passalo come `fallback`. Con `LLM_PROVIDER=mock` la demo funziona identica senza rete; con un LLM vero il testo viene riformulato.

### Stato condiviso (`ctx.state`, `hub.state`)

| Metodo | Restituisce |
|---|---|
| `devices()`, `device(id)`, `byZone(zone)`, `zones()` | dispositivi `{ deviceId, zone, location, readings, readingTs, meta, ts, receivedAt, count, simulated, history }` |
| `values(key, { zone })` | `[{ deviceId, zone, value, ts }]` |
| `average(key, { zone })`, `sum(key, { zone })` | numero o `null` |
| `metric(name)`, `metrics()` | ultime metriche |
| `decisions(n)`, `messages(n)`, `chats(n)` | ultimi eventi (dal più vecchio) |
| `notifications({ since, channel, to })` | eventi `notify` |
| `isActive(name)`, `scenario(name)`, `activeScenarios()` | scenari in corso |
| `simTime()`, `speed()` | ora simulata (da `meta.simTime` del simulatore) e velocità |
| `agents()` | statistiche degli agenti |
| `snapshot()` | il JSON di `GET /api/state` |

Gli oggetti restituiti sono congelati: non modificarli.

### `createCore(options)` (Node e browser)

Come `createHub` ma senza HTTP: `{ bus, state, llm, publish, ingestReading, scenario, chat, subscribe, addAgent, agents, start, stop, idle }`. Lo usa la modalità demo nel browser; serve anche per test e script.

### Dashboard: `connectHub` (browser)

```js
import { connectHub, formatClock } from '../shared/iot-agents/src/client.js';

const hub = await connectHub({
  simConfig: './sim-config.json',      // catalogo scenari (hub.scenarios) e, in demo, i dati
  demoAgents: async () => (await import('./agents/index.js')).createAgents(),
});
hub.mode;                                     // 'live' se /api/state risponde, altrimenti 'demo'
const state = await hub.getState();           // come GET /api/state
const off = hub.on('reading', (e) => { ... }); // tipo, array di tipi o '*'
await hub.scenario('metro_guasto', { linea: 1 }, { duration: 120 });
const { reply } = await hub.chat('Come arrivo al Maradona?', { from: 'dashboard' });
hub.onStatus((s) => ...);                     // 'connected' | 'reconnecting' | 'demo'
```

Parametri dell'URL della pagina: `?demo=1` forza la demo; `?api=http://host:8703` usa un hub su un altro indirizzo; `?token=...` per un hub con `HUB_TOKEN`. In demo la verifica di `/api/state` lascia in console un 404: è normale.

`src/ui-helpers.js`: `readingLabel(key)`, `formatReading(key, value)`, `formatNumber`, `formatTime`, `escapeHtml`, `sparklineSvg(points, { width, height })`.

## Simulatore

Configurazione JSON (esempio completo: [`example/sim-config.json`](example/sim-config.json)):

```json
{
  "name": "cer-quartiere",
  "seed": 42,
  "intervalSec": 3,
  "speed": 60,
  "start": "07:00",
  "timezone": "Europe/Rome",
  "loopSec": 600,
  "devices": [
    {
      "id": "casa",
      "count": 10, "jitterM": 200, "vary": 0.2,
      "location": { "lat": 40.85, "lon": 14.26, "zone": "sanita" },
      "readings": {
        "light_lux":     { "kind": "daylight", "max": 60000, "sunrise": 6.8, "sunset": 16.9, "noise": 800, "round": 0,
                           "effects": { "nuvole": { "multiply": 0.2, "rampSec": 10 } } },
        "temperature_c": { "kind": "daily", "min": 12, "max": 19, "peakHour": 14, "noise": 0.2 },
        "power_w":       { "kind": "profile", "points": [[0, 250], [7, 900], [13, 400], [20, 1500], [23, 400]], "round": 0 },
        "people_count":  { "kind": "walk", "start": 40, "min": 0, "max": 400, "step": 8, "round": 0,
                           "effects": { "metro_guasto": { "add": 300, "rampSec": 60 } } },
        "fill_pct":      { "kind": "ramp", "from": 5, "to": 95, "periodSec": 21600 },
        "button":        { "kind": "bool", "p": 0.01 },
        "humidity_pct":  60
      }
    }
  ],
  "timeline": [{ "at": 30, "name": "nuvole", "params": {}, "duration": 40 }],
  "scenarios": [{ "name": "nuvole", "label": "Passano le nuvole", "params": {}, "duration": 40 }]
}
```

| Campo | Significato |
|---|---|
| `seed` | stesso seme = stessi dati (ogni dispositivo ha la sua sequenza) |
| `intervalSec` | ogni quanto ogni dispositivo invia (secondi reali; sovrascrivibile per dispositivo) |
| `speed` | secondi simulati per secondo reale (60 = un'ora in un minuto) |
| `start` | ora simulata iniziale: `"HH:MM"` di oggi nel `timezone`, data ISO o ms |
| `loopSec` | facoltativo: ogni N secondi reali ricominciano giornata simulata e timeline |
| `devices[].count`, `jitterM`, `vary` | repliche `id-01`, `id-02`...; posizioni sparse entro `jitterM` metri; valori scalati di ±`vary` |
| `timeline[]` | `{ at: <s reali dall'avvio>, name, params, duration }`: scenari pubblicati sul hub |
| `scenarios[]` | catalogo dei pulsanti della dashboard (`label`, `description`, `params`, `duration`) |

Andamenti (`kind`), valutati sull'ora simulata: `constant` (`value`, o un numero diretto), `daily` (coseno tra `min` e `max` con picco a `peakHour`), `daylight` (campana tra `sunrise` e `sunset`, `min` di notte), `profile` (interpolazione lineare di `points: [[ora, valore], ...]` sulle 24 ore), `ramp` (da `from` a `to` in `periodSec` simulati, poi ricomincia; `loop: false` si ferma), `walk` (passeggiata casuale tra `min` e `max`, passo `step`), `bool` (`true` con probabilità `p`). Opzioni comuni: `noise` (deviazione standard), `round` (decimali, predefinito 1), `clamp: [min, max]`; i valori negativi sono portati a 0 (tranne `walk`, o con `allowNegative: true`).

`effects` collega gli scenari ai dati: mentre lo scenario è attivo il valore diventa `valore × multiply + add` (oppure `set`), raggiunto gradualmente in `rampSec` secondi reali. Vale per gli scenari della timeline **e** per quelli lanciati a mano dalla dashboard (il simulatore ascolta il hub).

Come modulo: `attachSimulator(hub, config)` nello stesso processo; `runSimulator({ configPath, target })` via HTTP; `createSimulator(config, { emit, emitScenario })` per tutto il resto (anche nel browser). Utilità del fuso: `hourOf(ts)` (ora decimale a Napoli) e `formatClock(ts)` (`"HH:MM"`), da usare negli agenti al posto di `new Date().getHours()` (il server può essere in UTC).

## Collegare un LLM vero

Il predefinito è `mock`: nessuna rete, risposte deterministiche. Per un LLM vero, variabili d'ambiente (mai chiavi nel codice o nei file versionati):

```bash
# Anthropic (modello predefinito claude-opus-5-5)
LLM_PROVIDER=anthropic ANTHROPIC_API_KEY=... node shared/iot-agents/example/server.js

# qualsiasi endpoint compatibile OpenAI (/chat/completions), anche un proxy di OpenClaw
LLM_PROVIDER=openai-compatible LLM_BASE_URL=https://host/v1 LLM_API_KEY=... LLM_MODEL=nome-modello node ...
```

Altre variabili: `LLM_MODEL`, `LLM_TIMEOUT_MS` (45 000), `LLM_MAX_TOKENS` (4096), `LLM_EFFORT` (Anthropic; predefinito `low` sui modelli Claude 5.x, per risposte rapide), `LLM_FALLBACKS=0` (Anthropic: disattiva il modello di riserva lato server che il client chiede in caso di rifiuto). Se la configurazione è incompleta il hub parte comunque in `mock` con un avviso. La chiamata Anthropic usa `fetch` diretto a `https://api.anthropic.com/v1/messages` (header `x-api-key`, `anthropic-version: 2023-06-01`).

Con `json: true` l'adattatore chiede un JSON e lo estrae in modo tollerante (blocchi di codice, testo intorno); se non c'è JSON valido usa il `fallback`.

## Collegare OpenClaw (WhatsApp)

Non sappiamo ancora come è configurato OpenClaw. Il contratto (sezione 5) fissa il ponte, che deve fare due cose:

1. **In entrata**: per ogni messaggio WhatsApp, `POST /api/chat` con `{ "from": "<numero o id>", "text": "..." }` e rispondere all'utente con `reply`.
2. **In uscita**: ogni 2-5 s `GET /api/notifications?since=<next>&channel=whatsapp`; per ogni elemento inviare `data.text` a `data.to` (un numero o un gruppo: la corrispondenza la decide OpenClaw), poi usare il `next` della risposta come `since` successivo. Alla prima chiamata, senza `since`, prendere solo `next` (per non rimandare lo storico). In alternativa allo polling: SSE su `/api/stream?types=notify`.

Se OpenClaw gira su un altro server, il hub deve essere raggiungibile da lì (server cloud o tunnel) e conviene impostare `HUB_TOKEN` (OpenClaw manda `Authorization: Bearer <token>`).

`tools/openclaw-bridge-sim.js` fa esattamente questo, al posto di OpenClaw: usalo per provare il flusso e come riferimento per configurarlo. Le conversazioni arrivano anche in dashboard (eventi `chat`).

## ESP32

Vedi [`firmware/esp32-sensor/README.md`](firmware/esp32-sensor/README.md): DHT22 o DS18B20, BH1750 o fotoresistenza, pulsante; invio ogni N secondi e subito alla pressione. Per ora in Wi-Fi verso un router/hotspot 5G (dichiarato come `meta.net: "5g"`), con un punto di estensione per il modem 5G.

## Test

```bash
node --test shared/iot-agents/test/
```

50 test: validazione delle letture, formato degli eventi, dispatch e routing, protezione dai cicli (auto-eventi e catene tra agenti), isolamento delle eccezioni, ordine e coda per agente, chat, scenari con durata, adattatore LLM (mock, Anthropic e OpenAI-compatibile con `fetch` finto, JSON, timeout, errori), simulatore (determinismo, andamenti, accelerazione, timeline, effetti), server HTTP (tutte le API, SSE, notifiche con cursore, CORS, token, file statici e percorsi vietati) e gli agenti dell'esempio.

## Limiti noti

- Lo stato è solo in memoria: un riavvio del hub lo azzera (per la demo va bene).
- Nessuna autenticazione per le `GET` (stato, stream): su un server pubblico i dati sono leggibili da tutti.
- Il firmware non è stato compilato su una scheda vera (vedi il suo README).
- La modalità demo usa solo l'LLM `mock` (nessuna chiave nel browser).
