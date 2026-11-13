# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Regole di lavoro (obbligatorie)

- **Lingua:** parla sempre in italiano con il team (risposte, commit message, commenti, documentazione).
- **Branch:** lavora solo su `master`. Niente feature branch, niente PR: commit e push direttamente su `master` (`git push origin master`). Prima di iniziare fai `git pull --rebase origin master`: siamo in 5 a pushare sullo stesso branch.

## Contesto

Repo del team per **The Big Hack 2026** (Codemotion, 40ª edizione di Futuro Remoto), Città della Scienza, Napoli, 14–15 novembre 2026. Dettagli: https://go.codemotion.com/big-hack-hackathon-2026/

Team: Roberto D'Isanto, Francesca Morra, Giovanni Di Stazio, Pasquale Criscuolo, Mario Varlese.

Vincoli che contano per le scelte tecniche:
- **Consegna: domenica 15/11 ore 12:00.** Sabato si lavora 11:00–20:30, domenica dalle 8:30. Privilegia soluzioni che arrivano a una demo funzionante, non architetture complete.
- **Criteri della giuria:** utilità/valore, aderenza alla challenge, chiarezza e completezza del progetto, design/UX, creatività/innovazione. La UX della demo pesa quanto il backend.
- Almeno 2 checkpoint con i mentor durante l'evento.

## Challenge e organizzazione della repo

Testo integrale delle 5 challenge, agenda e regole: [`docs/hackathon.md`](docs/hackathon.md). Decisioni prese, punti di forza del team e strumenti disponibili (FLUX, Cloudflare, Playwright...): [`docs/stato-e-strumenti.md`](docs/stato-e-strumenti.md). Idee per C1, C2, C5 e piano di lavoro con i subagent: [`docs/brainstorming.md`](docs/brainstorming.md). Tieni aggiornati questi file quando si decide qualcosa.

**Una cartella per soluzione, con il prefisso della challenge** (`c1-…`, `c2-…`, `c4-…`, `c5-…`). Per una challenge possono esserci più soluzioni in cartelle diverse. Ogni cartella ha un `README.md` con brief, scelte, come avviarla e stato. Il codice condiviso tra più soluzioni (es. la base IoT + agenti per C2 e C5) va in `shared/`.

Soluzioni esistenti:
- `shared/iot-agents/`: base comune IoT + agenti (Node, HTTP + SSE), usata da C2. C5 (`c5-agentic-city`) ha un suo stack Python/MQTT.
- `c1-feed-simulato/`: C1 Bhblasted, pubblico sintetico che prevede vincitore, CTR per segmento e fascia di CPM (online, modalità mock).
- `c4-jrpg/`: C4 Consorzio Clara, JRPG a turni red team vs blue team (giocabile). Un tower defense per C4 è previsto più avanti. `jrpg/index.html` è solo un redirect al vecchio URL.
- `c5-agentic-city/`: C5 Fastweb + Vodafone, "Napoli Agentic City". Brief e decisioni nel suo README. Non è una webapp: agenti + sensori IoT (ESP32, modulo 5G) + droni. Per un proxy/worker serve un Worker Cloudflare nuovo: **non usare `mbl-privato`**.

## Hosting

GitHub Pages pubblica la root di `master` tramite il workflow `.github/workflows/pages.yml` (a ogni push su master; dominio personalizzato dell'account): https://robertodisanto.it/hackathon_2026_a/ (ogni prototipo in `/<sottocartella>/`). `index.html` in root è la pagina con i link ai prototipi: aggiornala quando ne aggiungi uno. `.nojekyll` disattiva Jekyll. Nei prototipi usa **solo percorsi relativi** (il sito non è servito dalla root del dominio) e attenzione a maiuscole/minuscole nei nomi dei file.

## `c4-jrpg/`

Fork di [Monster Tamer](https://github.com/devshareacademy/monster-tamer) (Phaser 3.60 da CDN, JavaScript ES modules, nessuna build, nessun test).

- Avvio: dalla root della repo `python3 -m http.server 8000` e apri http://localhost:8000/c4-jrpg/
- I contenuti sono dati, non codice: `c4-jrpg/assets/data/*.json` (mostri, mosse, NPC/dialoghi, incontri, oggetti, mappe Tiled). Prima di toccare il codice controlla se basta cambiare i JSON.
- Le mosse in `attacks.json` riusano le animazioni esistenti (`ICE_SHARD`, `SLASH` in `src/battle/attacks/`); una nuova animazione richiede codice in `src/battle/attacks/` e caricamento in `src/scenes/preload-scene.js`.
- Flusso: `PreloadScene` carica tutti gli asset e i JSON nella cache Phaser → `TitleScene` → `WorldScene` (mappa, NPC, eventi da `events.json`/`npcs.json`) → `BattleScene` (macchina a stati in `src/utils/state-machine.js`). Lo stato di gioco persistente è in `src/utils/data-manager.js` (salvato in `localStorage` con chiave `CYBER_JRPG_DATA`).
- **Contromosse** (`src/battle/cyber-types.js`): le unità red team in `monsters.json` hanno un `type` (`SOCIAL`, `NETWORK`, `MALWARE`); le mosse blue team in `attacks.json` hanno `counters` + `tip`. Se `counters` coincide col tipo del bersaglio il danno è ×2 e si mostra `tip`, altrimenti ×0.5 e un suggerimento da `CYBER_TYPE_HINT`. Le mosse red team hanno `description`, mostrata dopo che il nemico le usa. I messaggi extra passano da `#showMessagesAndWaitForInput` in `BattleScene`; l'input durante lo stato `BATTLE` è inoltrato solo se `battleMenu.isWaitingForPlayerInput`.
- Unità: id 1-2 blue team (`Firewall`, `EDR`), id 3-5 red team (`Phisher`, `Botnet`, `Ransomware`). Il team iniziale è definito in `initialState` di `data-manager.js` (non arriva da un evento).
- Inizio partita: le cutscene originali (eventi 1 e 2 di `main_1`) sono saltate tramite `initialState.viewedEvents`. L'NPC 3 (**Black Hat**, oggetto `NPC2` nella mappa `main_1.json`) è a destra del punto di partenza: parlandoci parte la battaglia.
- Testi: dialoghi, cartelli e oggetti sono nei JSON; le stringhe nel codice sono già in italiano. Le voci dei menu restano costanti interne (`FIGHT`, `BAG`, ...) usate dalla logica: il testo mostrato viene da `menuLabel()` in `src/common/labels-it.js`.
- Titolo: sfondo `assets/images/hackathon/title.jpg` (generato con FLUX), titolo e crediti del team disegnati come testo in `title-scene.js` (`TEAM_MEMBERS`).
- Gli asset di terze parti non sono ridistribuibili (vedi `c4-jrpg/README.md`): da sostituire con asset CC0 o nostri prima della consegna.
- Test manuale rapido di una battaglia: in console `game` non è globale; per i test con Playwright si può intercettare `src/main.js` aggiungendo `window.__game = game` e avviare `BATTLE_SCENE` con `{ playerMonsters, enemyMonsters }` presi da `game.cache.json.get('MONSTERS')`.

## `c1-feed-simulato/`

Challenge 01 Bhblasted: pubblico sintetico che prevede vincitore, CTR per segmento, fascia di CPM e perché. Node ≥ 20, nessuna dipendenza npm, nessuna build.
- Avvio: `node c1-feed-simulato/server.js` (porta 8702, serve anche i file statici) oppure statico da GitHub Pages / `python3 -m http.server` dalla root (simulazione nel browser). Test: `node c1-feed-simulato/test/smoke.mjs`. CLI: `node c1-feed-simulato/cli.js <annunci.json|csv> [--risultati r.json] [--llm]`.
- Il motore `src/core/` è fatto di moduli ES condivisi tra Node e browser: annunci e import JSON/CSV (`ads.js`) → pubblico sintetico (`audience.js`) → caratteristiche dell'annuncio (`features.js`) → punteggio euristico deterministico con i motivi (`heuristic.js`) → `simulate.js` → calibrazione in CTR (`calibration.js`), CPM a regole (`cpm.js`), previsione (`predict.js`), verifica (`backtest.js`).
- I dati sono in `data/*.json`, tutti indicativi da tarare in sede. L'LLM è facoltativo e solo lato server (`src/llm/`, `LLM_PROVIDER=mock|anthropic|openai-compatible`, come `shared/iot-agents/CONTRATTO.md` §4): corregge un campione di persone per segmento e scrive i commenti. Con l'LLM fa una chiamata per annuncio × segmento, con cache.
- UI: `index.html`, `app.js`, `style.css`. `server.js` valorizza il meta `c1-backend` per attivare le API; taratura e risultati si salvano in localStorage. `esempi/risultati-demo.json` contiene risultati **inventati**, solo per provare la pagina di verifica.

## `shared/iot-agents/`

Base comune IoT + agenti (contratto: `shared/iot-agents/CONTRATTO.md`, uso e API: `shared/iot-agents/README.md`). Node ≥ 20, ES modules, nessuna dipendenza.
- Esempio: `node shared/iot-agents/example/server.js` → http://localhost:8701/ (hub + agenti + simulatore). Test: `node --test shared/iot-agents/test/`.
- API: `createHub({ port, staticDir, agents, llm })` (con HTTP) o `createCore(...)` (senza HTTP, anche nel browser); agenti = classe `Agent` con `name`, `subscribes`, `onEvent(event, ctx)`, `onChat` per l'orchestratore; `ctx` offre `state`, `llm`, `publish`, `decide`, `send`, `notify`, `metric`. Nel browser `connectHub({ simConfig, demoAgents })` dà la stessa interfaccia in live e in demo (Pages).
- Le soluzioni copiano `example/`, importano `../shared/iot-agents/src/index.js`, hanno un proprio `package.json` con `"type": "module"`. Gli agenti devono essere isomorfi (niente `node:*`) per girare anche nella demo su Pages. Il hub serve i file statici con gli stessi percorsi della repo.
- LLM: `LLM_PROVIDER=mock` predefinito; `anthropic` o `openai-compatible` con variabili d'ambiente, mai chiavi nei file. Il testo deterministico va sempre passato come `fallback`.
- Firmware ESP32 in `shared/iot-agents/firmware/esp32-sensor/` (`config.h` non versionato; non ancora compilato su scheda vera). Ponte OpenClaw simulato: `node shared/iot-agents/tools/openclaw-bridge-sim.js`.
