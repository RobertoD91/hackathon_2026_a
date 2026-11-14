# Mappa "Napoli in tempo reale": il simulatore della presentazione

La mappa della presentazione di TwinCIRO (C5): un hub con agenti e un **simulatore**, con **folla e sensori simulati** e **meteo, aria, trasporti, eventi e allerte veri**. È vetrina: serve al video di consegna (scena «Dati reali», [`../scene/registra_mappa.mjs`](../scene/registra_mappa.mjs)) e alla demo nel browser. Non è la città agentica (quella è [`c5-agentic-city/`](../../c5-agentic-city/)) e non è il cervello dati di TwinCIRO (quello è [`citta-api/`](../../citta-api/README.md)).

Le fonti reali, i luoghi, il simulatore della folla e gli snapshot **non stanno qui**: la pagina e gli agenti li importano da [`../../citta-api/`](../../citta-api/README.md) (`fonti/`, `simulatore/`, `dati/`). Ne esiste una sola copia, la stessa che usa l'API dati città: una correzione alle fonti vale per mappa e API insieme.

**I sensori della mappa sono tutti simulati**: il hub non legge MQTT e non riceve dati da dispositivi reali. Il contratto dei formati interni (letture del simulatore, eventi, agenti) è in [`CONTRATTO.md`](CONTRATTO.md).

**Node.js ≥ 20, ES modules, nessuna dipendenza npm, niente build.**

```
 simulatore (sim/ + citta-api/simulatore) ─ POST /api/readings ─►┌─► agente A ─┐
 dashboard, timeline ─ POST /api/scenario ──────────────────────►│   agente B ─┼─ agent.message ─► orchestrator ─┬─► notify (WhatsApp, simulato)
                                                                 │   ...       ┘                                 ├─► agent.decision, metric (dashboard)
                                                                 │   bus di eventi + stato condiviso              └─► risposta a POST /api/chat
                                                                 └─► GET /api/stream (SSE), /api/state, /api/notifications
```

Tutto passa da un **bus di eventi** in memoria: ogni lettura, scenario, messaggio tra agenti, decisione, notifica e metrica è un evento `{ id, ts, type, source, data }`. Gli agenti si iscrivono ai tipi che li interessano; lo stato condiviso tiene le ultime letture, decisioni, metriche e notifiche; il server HTTP espone tutto alla dashboard.

Lo stesso nucleo gira **anche nel browser**: su GitHub Pages, senza backend, agenti e simulatore girano in locale (modalità demo).

## Avvio rapido

Dalla root della repo:

```bash
node c5-presentazione/mappa/server.js            # hub + 5 agenti + simulatore su http://localhost:8701/
node --test c5-presentazione/mappa/test/         # test (anche: cd c5-presentazione/mappa && npm test)
```

Apri http://localhost:8701/ (reindirizza a `/c5-presentazione/mappa/`): letture in diretta, decisioni, metriche, pulsanti degli scenari, notifiche e chat. La timeline lancia un'ondata di calore dopo 20 s e le nuvole dopo 85 s; la giornata simulata (dalle 15:00, ×60) ricomincia ogni 3 minuti; meteo, aria, allerte, trasporti ed eventi sono **reali** (vedi "Dati reali di Napoli").

Altri comandi:

```bash
# hub senza simulatore interno + simulatore separato (anche da un altro PC)
node c5-presentazione/mappa/server.js --no-sim
node c5-presentazione/mappa/sim/simulate.js --config citta-api/simulatore/sim-config.json --target http://localhost:8701

# una sola lettura per dispositivo (prova veloce del formato)
node c5-presentazione/mappa/sim/simulate.js --config citta-api/simulatore/sim-config.json --once

# modalità demo statica, come su GitHub Pages
python3 -m http.server 8711     # poi apri http://localhost:8711/c5-presentazione/mappa/
```

Online (dopo il push): https://robertodisanto.it/hackathon_2026_a/c5-presentazione/mappa/ (sempre in modalità demo).

## Struttura

| Percorso | Contenuto | Gira in |
|---|---|---|
| `index.html`, `style.css`, `napoli.css` | la pagina | browser |
| `server.js` | hub della mappa (porta 8701): agenti + simulatore, `--no-sim` | Node |
| `app.js` | dashboard: `avviaDashboard(scenario)` (KPI, sensori, decisioni, scenari, notifiche, chat, mappa) | browser |
| `mappa.js` | componente mappa **configurabile** stile [Seoul Real-Time City Data](https://data.seoul.go.kr/SeoulRtd/): luoghi o poligoni colorati su livelli, modalità (indicatori), livelli sovrapposti, vista mappa/lista, ricerca, filtro per categoria, scheda di dettaglio, cerchio che pulsa sul più critico di ogni categoria. Leaflet 1.9.4 da cdnjs, tessere OpenStreetMap. API sotto | browser |
| `napoli.js` | configurazione della dashboard e della mappa (modalità Affollamento, Temperatura, Meteo, Aria; colonne; scheda); i 10 luoghi con capienze indicative sono in `citta-api/fonti/luoghi.js` (l'affollamento arriva da `people_count`) | browser |
| `napoli-fonti.js` | dati reali nella pagina: modalità Meteo e Aria, livelli sovrapposti (metro, funicolari e treni; eventi di oggi; centraline ARPAC; traffico), sezioni della scheda, pannello "Oggi a Napoli", banner di allerta, tabella delle fonti | browser |
| `agents/` | agenti: clima, illuminazione, folla (quando un luogo diventa "Affollato" propone l'alternativa tranquilla più vicina), fonti (dati reali sul bus, scenari degli eventi reali), orchestratore | Node e browser |
| `src/index.js` | punto d'ingresso Node: esporta tutto | Node |
| `src/hub.js` | `createHub`: nucleo + server HTTP, SSE, file statici | Node |
| `src/core.js` | `createCore`: bus + stato + agenti + LLM, senza HTTP | Node e browser |
| `src/agent.js` | classe base `Agent` | Node e browser |
| `src/state.js` | `HubState`: stato condiviso | Node e browser |
| `src/bus.js`, `src/events.js` | bus di eventi, formato degli eventi | Node e browser |
| `src/validate.js` | validazione di letture, scenari, chat | Node e browser |
| `src/llm.js` | adattatore LLM: `mock`, `anthropic`, `openai-compatible` | Node (e browser solo `mock`) |
| `src/log.js` | log leggibili in console | Node e browser |
| `src/client.js` | `connectHub` per la dashboard: modalità live o demo | browser |
| `src/ui-helpers.js` | etichette, formattazione, sparkline SVG | browser |
| `sim/simulate.js` | simulatore da riga di comando, `runSimulator`, `attachSimulator` (il motore è `citta-api/simulatore/sim-core.js`) | Node |
| `test/` | test `node:test` (non serviti dal hub) | Node |
| `../../citta-api/fonti/` | `normalizza.js`, `dati.js` (fonti live con cache, timeout e riserva; snapshot), `luoghi.js` | Node e browser |
| `../../citta-api/simulatore/` | `sim-core.js` (motore del simulatore) e `sim-config.json` (11 dispositivi, scenari, timeline) | Node e browser |
| `../../citta-api/dati/` | snapshot dei dati reali (JSON, ~140 KB), rigenerati da `citta-api/strumenti/aggiorna-dati-napoli.js` | — |

## La pagina

La dashboard (`app.js`) e il componente mappa (`mappa.js`) sono configurati da `napoli.js` (pagina `index.html`, agenti in `agents/`: clima, illuminazione, folla, fonti, orchestratore; simulatore generico più gli scenari degli eventi reali).

Una pagina è solo HTML + `avviaDashboard(configurazione)`; la configurazione dice `simConfig`, `demoAgents`, `firma` (un agente che deve esserci nel hub: se manca, il hub esegue un altro scenario e la pagina va in demo), `mappa`, ordine dei `kpi`, un eventuale `simulatoreDemo`, l'aggancio `eventi(evento, api)` che passa alla mappa dati non dai sensori (`api.mappa.setExtra(nome, dati)`), l'aggancio `avvio(api)` chiamato dopo la creazione della mappa (ci si caricano le fonti reali) ed `etichettaScenario(nome)` per gli scenari non a catalogo.

### Componente mappa (`mappa.js`)

```js
import { createMappa, aggregaSensori, colonna } from './mappa.js';
const mappa = createMappa(document.getElementById('citymap'), {
  titolo: 'Napoli in tempo reale', sottotitolo: '…', nota: 'HTML o (ctx) => HTML', cerca: 'Cerca un luogo…',
  vista: { centro: [40.8435, 14.242], zoom: 13, zoomEtichette: 14, zoomVolo: 15 },   // anche zoomSnap, adattaMobile
  tema: { gradiente: 'linear-gradient(…)', accento: '#4a6fe0' },                     // facoltativo
  categorie: { piazze: 'Piazze e centro', … },
  luoghi: { plebiscito: { nome, categoria, lat, lon, poligono?: [[lat, lon], …], icona?, parole? } },  // chiave = location.zone
  aggrega: (dispositivi, luogo, zona) => aggregato,          // predefinito aggregaSensori: { n, somma, media, sensori, reali, ts }
  storia: (aggregato) => numero,                             // per la sparkline della scheda
  indicatori: [{ id: 'folla', label: 'Affollamento',
                 livelli: [{ id: 'tranquillo', label: 'Tranquillo', colore: '#1fb46a' }, …, { id: 'affollato', label: 'Affollato', colore: '#e5413a', critico: true }],
                 valuta: (aggregato, luogo, zona, ctx) => ({ livello: 'affollato', valore: 1.2 }) }],
  colonne: [colonna.luogo(), colonna.categoria(), colonna.livello(), { titolo, classe: 'num', mobile: false, cella: (riga, ctx) => html }],
  dettaglio: (riga, ctx) => html,                            // corpo della scheda; ctx.badge, ctx.barra, ctx.sparkline, ctx.extra, ctx.ora()
  sovrapposti: [{ id, label, attivo: true, crea: ({ L, map, ctx }) => layer, aggiorna: (layer, ctx) => {} }],
}, { ora: () => oraSimulata });
mappa.update(devices);                 // a ogni lettura (lo fa app.js)
```

**Aggiungere una modalità** (es. qualità dell'aria a Napoli da una fonte reale): un elemento in `INDICATORI` di `napoli.js` (4 livelli con colori, `valuta` che legge l'aggregato dei sensori della zona o `ctx.extra.aria?.[zona]`), oppure `mappa.aggiungiIndicatore(def)` a mappa avviata. I dati esterni entrano con `mappa.setExtra('aria', dati)` (da un agente, tramite l'aggancio `eventi`, o da un `fetch` nella pagina). **Aggiungere un livello sovrapposto** (linee della metro, eventi, stazioni di misura): un elemento in `SOVRAPPOSTI` di `napoli.js` o `mappa.aggiungiSovrapposto(def)`; compare una casella nella legenda. I colori vengono dalla configurazione (`--lv` in linea), non dal CSS: nessuna modifica a `style.css` per un livello nuovo.

### Dati reali di Napoli

La mappa di Napoli unisce la **simulazione** (folla e sensori, come prima) a **fonti reali verificate**. Ogni valore in pagina dice se è reale (con fonte e ora) o simulato, con un cartellino: *dal vivo*, *fonte di riserva*, *ultimo dato salvato*, *snapshot*, *orario programmato*, *simulato*. Se una fonte non risponde la pagina continua a funzionare e lo dichiara. La tabella "Fonti dei dati, stato e licenze" sotto la mappa mostra lo stato di ogni fonte in quel momento. Il catalogo completo della ricerca (anche le fonti valutate e non integrate, licenze, lacune) è in [`docs/fonti-dati-napoli.md`](../../docs/fonti-dati-napoli.md); le fonti sono lette con i moduli di [`citta-api/fonti/`](../../citta-api/README.md), gli stessi dell'API dati città di TwinCIRO.

| Dato | Fonte | Come arriva | Licenza | Se non risponde |
|---|---|---|---|---|
| Meteo per luogo (temperatura, percepita, umidità, pioggia, vento, cielo): modalità **Meteo** e scheda | [Open-Meteo](https://open-meteo.com/), modello ICON-2I di ItaliaMeteo-ARPAE (2,2 km: distingue i luoghi) | browser, una chiamata per i 10 luoghi, cache 15 min | CC BY 4.0 | Open-Meteo modello predefinito → MET Norway (un punto per la città; non dopo un 429, la quota è per IP) → `dati/meteo.json` |
| Allerta meteo per Napoli (Zona 1): banner, scheda, KPI, avviso WhatsApp | Protezione Civile Regione Campania, Centro Funzionale (API del portale) | browser, cache 20 min | © Regione Campania, citata | ultimo avviso salvato |
| Avvisi Meteoalarm (Campania, livello più alto per fenomeno e giorno) | EUMETNET Meteoalarm | **snapshot** (niente CORS) | attribuzione | — |
| Qualità dell'aria: modalità **Aria** | centraline ARPAC (dati orari E2a non validati dall'EEA, letti dai Parquet) entro 1,5 km se il dato ha meno di 48 ore; altrimenti modello Copernicus CAMS via Open-Meteo (celle di 11 km) | centraline: **snapshot**; CAMS: browser, cache 1 h | EEA con citazione; CC BY 4.0 | CAMS → `dati/meteo.json` |
| Livello "Centraline aria (ARPAC)" | come sopra: classe dell'indice europeo EEA (NO2 e O3 orari, PM su 24 ore) | snapshot | | |
| Livello "Metro, funicolari e treni", stazioni vicine nella scheda (con corse programmate in quest'ora) | GTFS ANM (L1, L6, L2, funicolari F1, F3, F4) ed EAV (Cumana, Circumflegrea, Circumvesuviana, Metrocampania), dalle copie di Mobility Database | **snapshot** ridotto (linee semplificate, 92 stazioni, corse per ora feriale/sabato/festivo) | ANM: CC BY 4.0 (Comune di Napoli); EAV: citata | — |
| Prossimi passaggi (pulsante nella scheda, clic su una stazione) | [Transitous](https://transitous.org/sources/) (MOTIS): solo metro, funicolari e treni (Transitous raggruppa con la stazione anche le fermate dei bus vicine, che si scartano) | browser, a richiesta, cache 1 min | servizio per progetti open source non commerciali | messaggio: vale l'orario programmato |
| Avvisi EAV (ascensori fuori servizio, scioperi) | API WordPress di eavsrl.it | browser, cache 15 min | contenuti EAV citati | — |
| Livello "Traffico su tangenziale e autostrade" | Autostrade per l'Italia (viabilita.autostrade.it) | browser, solo quando il livello è acceso, cache 5 min; un riquadro sulla mappa dice quanti eventi ci sono (anche "nessun evento in corso") | © ASPI: dato di contesto citato | "non disponibile" (il traffico urbano non ha fonti aperte: non è mostrato) |
| Eventi di oggi e prossimi (pannello "Oggi a Napoli", livello "Eventi reali di oggi") | Comune di Napoli (API del sito), openfootball (Serie A, aggiornato anche dal vivo), TheSportsDB (coppe), Cruise Timetables (navi), America's Cup (calendario 2027) | **snapshot** (+ Serie A dal vivo) | Comune CC BY 4.0, openfootball CC0, altre citate | — |
| Terremoti dei Campi Flegrei | INGV | browser, cache 30 min | CC BY 4.0 | snapshot |
| Dati di riferimento nella scheda (scala della folla) | visitatori mensili dei siti comunali (Comune, CC BY 4.0), musei (Wikidata, CC0), passeggeri del porto e crocieristi (AdSP, valori citati), affitti brevi entro 600 m (Inside Airbnb, CC BY 4.0), acque di balneazione 2025 (EEA), stagionalità turistica (ISTAT, CC BY 4.0) | snapshot | | |

**Cosa resta simulato e perché.** L'affollamento non ha una fonte pubblica (a Seoul arriva dalle celle telefoniche: andrebbe chiesto a Fastweb + Vodafone), quindi resta la stima del simulatore, ma con la scala presa dai dati reali e con due collegamenti reali dichiarati come ipotesi:
- l'agente **fonti** accende sull'ora simulata gli scenari `evento_<zona>` quando c'è un evento reale (partita in casa al Maradona da 3 ore prima a 3 ore dopo il calcio d'inizio, navi in porto dalle 8 alle 18, eventi del Comune "grandi" come gare e festival, regate dell'America's Cup); gli effetti (persone in più) sono in `citta-api/simulatore/sim-config.json`;
- e lo scenario `stagione_bassa` o `stagione_alta` dal mese: arrivi ISTAT del mese rispetto alla media mensile (novembre 2025: 0,52×, quindi folla −20 % nei luoghi turistici e −10 % a Vomero, Sanità e Garibaldi; il Maradona dipende solo dalle partite).

Anche la temperatura dei sensori resta simulata (serve allo scenario "Ondata di calore"); quella reale è nella modalità Meteo e nella scheda.

**Agente `fonti`** (`agents/fonti.js`, isomorfo): legge gli snapshot e, se c'è rete, le fonti live; pubblica la decisione "Oggi a Napoli: …", le metriche `eventi_oggi`, `temperatura_reale`, `aqi_europeo`, `allerta_meteo` e manda all'orchestratore il contesto (eventi, stazioni vicine a ogni luogo, stagione, meteo, aria, allerta). L'orchestratore lo usa nei consigli anti-folla su WhatsApp, simulati nella dashboard ("Oggi c'è "Tri Gold Caracciolo 2026". Stazione più vicina a Piazza del Plebiscito: Chiaia (L6), 2 min a piedi."), manda l'avviso di allerta gialla o superiore al gruppo e risponde in chat su eventi, "come arrivo a…", aria, allerta e meteo. Opzione `createAgents({ fonti: { rete: false } })` per lavorare senza rete (è automatica sotto `node --test`).

**Snapshot** (`citta-api/dati/`, JSON piccoli, gli stessi dell'API): si rigenerano con `node citta-api/aggiorna.js [--solo eventi,meteo] [--curl]`; dettagli, sezioni e frequenze consigliate nel [README di citta-api](../../citta-api/README.md). Se una fonte non risponde, la sua parte resta quella del file precedente (stato `precedente`, con `datoDel`).

Fonti valutate e lasciate fuori: posizioni dei bus di BusOne (aggregatore non ufficiale, termini per soli privati e no profit, limite di richieste anonime), ViaggiaTreno (API non documentata e senza CORS; i treni regionali e la L2 sono già nei passaggi di Transitous), OpenSky, AIS, TomTom e HERE (serve una chiave), ARPAC open data e portale della Regione (irraggiungibili dalla sandbox), WAQI (i termini vietano la cache).

Tutto ciò che il hub serve (`staticDir`, `src/`, `sim/`, `citta-api/fonti`, `citta-api/simulatore`, `citta-api/dati`) è pubblico: non metterci segreti (i file che iniziano con un punto, come `.env`, non vengono mai serviti). Nelle pagine usa **solo percorsi relativi** e attenzione a maiuscole/minuscole: su GitHub Pages il sito sta sotto `/hackathon_2026_a/`.

## API del nucleo

### `createHub(options)` (Node)

```js
import { createHub, attachSimulator, loadSimConfig } from './src/index.js';   // da c5-presentazione/mappa/

const hub = createHub({
  port: 8701,                                    // predefinito: env PORT o 8701; 0 = porta libera
  host: '0.0.0.0',                               // predefinito: env HOST o 0.0.0.0 (raggiungibile da altri PC in LAN)
  staticDir: new URL('./', import.meta.url),     // cartella della dashboard
  publicDirs: [],                                // altre cartelle da servire (facoltativo)
  agents: createAgents(),                        // da ./agents/index.js
  llm: undefined,                                // predefinito: createLLM() dalle variabili d'ambiente
  token: undefined,                              // predefinito: env HUB_TOKEN (se c'è, le POST lo richiedono)
});
const { url, dashboardUrl } = await hub.start();
const sim = attachSimulator(hub, await loadSimConfig(new URL('../../citta-api/simulatore/sim-config.json', import.meta.url)));
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
import { Agent } from '../src/agent.js';   // da c5-presentazione/mappa/agents/

export class CaldoAgent extends Agent {
  name = 'caldo';                       // unico; è la `source` dei suoi eventi
  subscribes = ['reading', 'scenario']; // tipi di evento ricevuti ('*' = tutti)
  description = 'Avvisa quando un luogo è troppo caldo';

  async onEvent(event, ctx) {
    if (event.type !== 'reading') return;
    const { readings, location } = event.data;
    if (typeof readings.temperature_c !== 'number') return;
    const media = ctx.state.average('temperature_c', { zone: location?.zone });
    ctx.metric('temperatura_media', Math.round(media * 10) / 10, '°C', { label: 'Temperatura media' });
    if (media > 32 && this.cooldown(`caldo:${location?.zone}`, 10 * 60_000)) {
      ctx.send('orchestrator', `Caldo forte in zona ${location?.zone}`, { tipo: 'caldo', zona: location?.zone, media });
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
import { Agent } from '../src/agent.js';   // da c5-presentazione/mappa/agents/

export class Orchestrator extends Agent {
  name = 'orchestrator';
  subscribes = ['agent.message', 'scenario'];

  async onEvent(event, ctx) {
    if (event.type === 'scenario' && event.data.name === 'metro_guasto' && event.data.active !== false) {
      ctx.send('*', 'Guasto in metro: valutate l\'impatto', event.data.params);
    }
    if (event.type === 'agent.message' && event.data.payload?.tipo === 'caldo') {
      const base = `Fa molto caldo in zona ${event.data.payload.zona}: cercate l'ombra e portate dell'acqua.`;
      const { text } = await ctx.llm.complete({
        system: 'Scrivi avvisi brevi e cordiali in italiano per chi è in giro per Napoli.',
        prompt: `Riformula senza cambiare i dati: ${base}`,
        fallback: base,                            // senza LLM (o se fallisce) si usa questo
      });
      ctx.notify('whatsapp', `zona-${event.data.payload.zona}`, text);   // notifica simulata: resta nella dashboard
      ctx.decide(`Avviso inviato alla zona ${event.data.payload.zona}`, { level: 'info', actions: [{ type: 'notify' }] });
    }
  }

  async onChat({ from, text }, ctx) {          // POST /api/chat → { reply }
    const media = ctx.state.average('temperature_c');
    return `Ciao ${from}! Temperatura media ${media?.toFixed(1) ?? 'n/d'} °C.`;
  }
}
```

**Schema consigliato** (come in `agents/orchestrator.js`): costruisci sempre il testo con regole deterministiche e passalo come `fallback`. Con `LLM_PROVIDER=mock` la demo funziona identica senza rete; con un LLM vero il testo viene riformulato.

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
import { connectHub, formatClock } from './src/client.js';

const hub = await connectHub({
  simConfig: '../../citta-api/simulatore/sim-config.json',   // catalogo scenari (hub.scenarios) e, in demo, i dati
  demoAgents: async () => (await import('./agents/index.js')).createAgents(),
});
hub.mode;                                     // 'live' se /api/state risponde, altrimenti 'demo'
const state = await hub.getState();           // come GET /api/state
const off = hub.on('reading', (e) => { ... }); // tipo, array di tipi o '*'
await hub.scenario('metro_guasto', { linea: 1 }, { duration: 120 });
const { reply } = await hub.chat('Come arrivo al Maradona?', { from: 'dashboard' });
hub.onStatus((s) => ...);                     // 'connected' | 'reconnecting' | 'demo'
```

Parametri dell'URL della pagina: `?demo=1` forza la demo; `?api=http://host:8701` usa un hub su un altro indirizzo; `?token=...` per un hub con `HUB_TOKEN`. In demo la verifica di `/api/state` lascia in console un 404: è normale.

`src/ui-helpers.js`: `readingLabel(key)`, `formatReading(key, value)`, `formatNumber`, `formatTime`, `escapeHtml`, `sparklineSvg(points, { width, height })`.

## Simulatore

Configurazione JSON (quella della mappa: [`citta-api/simulatore/sim-config.json`](../../citta-api/simulatore/sim-config.json)):

```json
{
  "name": "esempio-napoli",
  "seed": 42,
  "intervalSec": 3,
  "speed": 60,
  "start": "15:00",
  "timezone": "Europe/Rome",
  "loopSec": 180,
  "devices": [
    {
      "id": "sim-plebiscito",
      "location": { "lat": 40.8359, "lon": 14.2488, "zone": "plebiscito" },
      "readings": {
        "temperature_c": { "kind": "daily", "min": 13, "max": 19, "peakHour": 14, "noise": 0.15,
                           "effects": { "ondata_calore": { "add": 14, "rampSec": 15 } } },
        "humidity_pct":  { "kind": "daily", "min": 55, "max": 80, "peakHour": 5, "noise": 1, "round": 0 },
        "light_lux":     { "kind": "daylight", "max": 40000, "min": 3, "sunrise": 6.8, "sunset": 16.9, "noise": 300, "round": 0,
                           "effects": { "nuvole": { "multiply": 0.008, "rampSec": 6 } } },
        "people_count":  { "kind": "profile", "points": [[0, 100], [9, 600], [12, 1500], [18, 2700], [23, 400]], "noise": 40, "round": 0,
                           "effects": { "stagione_bassa": { "multiply": 0.8, "rampSec": 10 } } },
        "button":        { "kind": "bool", "p": 0.002 }
      }
    }
  ],
  "timeline": [{ "at": 20, "name": "ondata_calore", "params": {}, "duration": 50 }],
  "scenarios": [{ "name": "ondata_calore", "label": "Ondata di calore", "params": {}, "duration": 60 }]
}
```

(Ridotto: la configurazione vera ha 11 dispositivi simulati in 10 luoghi, due al Vomero con `count`, e gli scenari `ondata_calore`, `nuvole`, `pulsante`, `crociere`, `partita`; l'agente `fonti` accende anche `evento_<zona>` e la stagione.)

| Campo | Significato |
|---|---|
| `seed` | stesso seme = stessi dati (ogni dispositivo ha la sua sequenza) |
| `intervalSec` | ogni quanto ogni dispositivo invia (secondi reali; sovrascrivibile per dispositivo) |
| `speed` | secondi simulati per secondo reale (60 = un'ora in un minuto) |
| `start` | ora simulata iniziale: `"HH:MM"` di oggi nel `timezone`, data ISO o ms |
| `loopSec` | facoltativo: ogni N secondi reali ricominciano giornata simulata e timeline |
| `devices[].count`, `jitterM`, `vary` | facoltativi: repliche `id-01`, `id-02`...; posizioni sparse entro `jitterM` metri; valori scalati di ±`vary` |
| `timeline[]` | `{ at: <s reali dall'avvio>, name, params, duration }`: scenari pubblicati sul hub |
| `scenarios[]` | catalogo dei pulsanti della dashboard (`label`, `description`, `params`, `duration`) |

Andamenti (`kind`), valutati sull'ora simulata: `constant` (`value`, o un numero diretto), `daily` (coseno tra `min` e `max` con picco a `peakHour`), `daylight` (campana tra `sunrise` e `sunset`, `min` di notte), `profile` (interpolazione lineare di `points: [[ora, valore], ...]` sulle 24 ore), `ramp` (da `from` a `to` in `periodSec` simulati, poi ricomincia; `loop: false` si ferma), `walk` (passeggiata casuale tra `min` e `max`, passo `step`), `bool` (`true` con probabilità `p`). Opzioni comuni: `noise` (deviazione standard), `round` (decimali, predefinito 1), `clamp: [min, max]`; i valori negativi sono portati a 0 (tranne `walk`, o con `allowNegative: true`).

`effects` collega gli scenari ai dati: mentre lo scenario è attivo il valore diventa `valore × multiply + add` (oppure `set`), raggiunto gradualmente in `rampSec` secondi reali. Vale per gli scenari della timeline **e** per quelli lanciati a mano dalla dashboard (il simulatore ascolta il hub).

Come modulo: `attachSimulator(hub, config)` nello stesso processo; `runSimulator({ configPath, target })` via HTTP; `createSimulator(config, { emit, emitScenario })` per tutto il resto (anche nel browser). Utilità del fuso: `hourOf(ts)` (ora decimale a Napoli) e `formatClock(ts)` (`"HH:MM"`), da usare negli agenti al posto di `new Date().getHours()` (il server può essere in UTC).

## Collegare un LLM vero

Il predefinito è `mock`: nessuna rete, risposte deterministiche. Per un LLM vero, variabili d'ambiente (mai chiavi nel codice o nei file versionati):

```bash
# Anthropic (modello predefinito claude-opus-5-5)
LLM_PROVIDER=anthropic ANTHROPIC_API_KEY=... node c5-presentazione/mappa/server.js

# qualsiasi endpoint compatibile OpenAI (/chat/completions), anche un proxy di OpenClaw
LLM_PROVIDER=openai-compatible LLM_BASE_URL=https://host/v1 LLM_API_KEY=... LLM_MODEL=nome-modello node ...
```

Altre variabili: `LLM_MODEL`, `LLM_TIMEOUT_MS` (45 000), `LLM_MAX_TOKENS` (4096), `LLM_EFFORT` (Anthropic; predefinito `low` sui modelli Claude 5.x, per risposte rapide), `LLM_FALLBACKS=0` (Anthropic: disattiva il modello di riserva lato server che il client chiede in caso di rifiuto). Se la configurazione è incompleta il hub parte comunque in `mock` con un avviso. La chiamata Anthropic usa `fetch` diretto a `https://api.anthropic.com/v1/messages` (header `x-api-key`, `anthropic-version: 2023-06-01`).

Con `json: true` l'adattatore chiede un JSON e lo estrae in modo tollerante (blocchi di codice, testo intorno); se non c'è JSON valido usa il `fallback`.

## Notifiche e chat

Le notifiche "WhatsApp" della mappa sono **simulate**: restano nel hub (`GET /api/notifications?since=<next>&channel=whatsapp`, oppure SSE su `/api/stream?types=notify`) e nella dashboard. TwinCIRO vero (OpenClaw su WhatsApp) non passa da qui: legge i dati della città dall'API [`citta-api/`](../../citta-api/README.md) con la skill `napoli-citta-dati`.

## Test

```bash
node --test c5-presentazione/mappa/test/
```

52 test: validazione delle letture, formato degli eventi, dispatch e routing, protezione dai cicli (auto-eventi e catene tra agenti), isolamento delle eccezioni, ordine e coda per agente, chat, scenari con durata, adattatore LLM (mock, Anthropic e OpenAI-compatibile con `fetch` finto, JSON, timeout, errori), simulatore (determinismo, andamenti, accelerazione, timeline, effetti; configurazione della mappa), server HTTP (tutte le API, SSE, notifiche con cursore, CORS, token, file statici, moduli di `citta-api/` serviti e percorsi vietati), agente fonti con gli scenari degli eventi sull'ora simulata e l'orchestratore che cita stazioni ed eventi (`test/agenti-fonti.test.js`). I test delle fonti (normalizzazione, riserve, lettori ZIP/Parquet, script degli snapshot, snapshot, effetti in `sim-config.json`) sono in `citta-api/test/fonti.test.js`.

## Limiti noti

- Lo stato è solo in memoria: un riavvio del hub lo azzera (per la demo va bene).
- Nessuna autenticazione per le `GET` (stato, stream): su un server pubblico i dati sono leggibili da tutti.
- La modalità demo usa solo l'LLM `mock` (nessuna chiave nel browser).
- Dati reali di Napoli: le fonti live dal browser consumano la quota di ogni visitatore (Open-Meteo: 10.000 chiamate al giorno per IP, una batch di 10 luoghi ne vale 10); gli snapshot vanno rigenerati a mano o con un cron sul server; le API del Centro Funzionale, di EAV e di ASPI non sono open data dichiarati e possono cambiare.
