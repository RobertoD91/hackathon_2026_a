# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Regole di lavoro (obbligatorie)

- **Lingua:** parla sempre in italiano con il team (risposte, commit message, commenti, documentazione).
- **Branch:** lavora solo su `master`. Niente feature branch, niente PR: commit e push direttamente su `master` (`git push origin master`). Prima di iniziare fai `git pull --rebase origin master`: più sessioni (e più persone) pushano sullo stesso branch.

## Contesto

Repo del team per **The Big Hack 2026** (Codemotion, 40ª edizione di Futuro Remoto), Città della Scienza, Napoli, 14–15 novembre 2026. Dettagli: https://go.codemotion.com/big-hack-hackathon-2026/

Team (dal 13/11 sera): **Roberto D'Isanto e Mario Varlese**. Francesca Morra, Giovanni Di Stazio e Pasquale Criscuolo sono in un altro gruppo: hanno forkato questa repo e lavorano su challenge diverse (collaboriamo, ma i loro sviluppi stanno nel loro fork).

**Priorità del nostro team:** C5 Fastweb + Vodafone è la challenge **principale**, C2 Meditech quella **di riserva**, C1 Bhblasted molto improbabile. C4 (`c4-jrpg/`) ora è dell'altro gruppo: la cartella resta qui com'è, non va più modificata.

**Scelta definitiva (14/11): C5 "Napoli Agentic City". Nome del progetto: TwinCiro** (Twin = gemello digitale, Ciro = CiroGPT). Cosa ne pensano i partner (Fastweb e Vodafone, incontro del 14/11):
- la parte **IoT è piaciuta**;
- **CiroGPT** (l'agente OpenClaw di Roberto, già collegato con la skill della città, ora in `c5-agentic-city/openclaw/skills/twinciro-citta/`, che funziona; le skill delle fonti aperte sono nella stessa cartella) è il pezzo **più apprezzato**: va messo al centro;
- il **gemello digitale** è piaciuto, ma meno di CiroGPT;
- la parte **traffico/semafori non è piaciuta**: ridimensionarla. Il video 3D della regata (`c5-agentic-city/media/regata_3d.mp4`) invece è piaciuto.

**Regole di consegna C5:** si consegna un **video di massimo 3 minuti**. La live demo è facoltativa: c'è un gruppo WhatsApp con CiroGPT dentro.

**Il progetto si chiama TwinCiro** ("Napoli che ci pensa"): CiroGPT su WhatsApp + agenti della città + gemello digitale. **Divisione del lavoro tra le sessioni Claude di Roberto** (per non pestarsi i piedi; fai sempre `git pull --rebase` prima di pushare):
- la sessione "Hackathon napoli" possiede **`c5-agentic-city/`** (codice di TwinCiro, `openclaw/` con le skill di CiroGPT, flasher, README di C5);
- la sessione "hackathon-2026-a" possiede **`shared/`** (mappa "Napoli in tempo reale", fonti, base IoT, firmware del badge, `shared/citta-api/` = API dati città per CiroGPT), **`cloud/`**, **`c5-video/`** (video di consegna) e **`docs/`**;
- README principale e `index.html` li aggiornano entrambe, con modifiche piccole e mirate. Le richieste da una sessione all'altra si lasciano in `docs/stato-e-strumenti.md`.

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
- `c2-cer-quartiere/`: C2 Meditech / Federico II, comunità energetica rinnovabile di quartiere sopra `shared/iot-agents` (porta 8703; online in modalità demo). Avvio `node c2-cer-quartiere/server.js`, test `cd c2-cer-quartiere && npm test`, KPI di una giornata `npm run giornata`. Parametri con fonti e stato (verificato/indicativo) in `model/parametri.js`, quartiere in `model/quartiere.js`, ottimizzatore in `model/ottimizzatore.js`; la dashboard riceve il dettaglio dall'evento personalizzato `cer.stato` (via SSE, non in `/api/state`).
- `c4-jrpg/`: C4 Consorzio Clara, JRPG a turni red team vs blue team (giocabile). Un tower defense per C4 è previsto più avanti. `jrpg/index.html` è solo un redirect al vecchio URL.
- `c5-agentic-city/`: C5 Fastweb + Vodafone, "Napoli Agentic City". Brief e decisioni nel suo README. Non è una webapp: agenti + sensori IoT (ESP32, modulo 5G) + droni. Per un proxy/worker serve un Worker Cloudflare nuovo: **non usare `mbl-privato`**. Avvio: `python avvia.py` (venv con `requirements.txt`) oppure `docker compose up -d` dalla cartella (Mosquitto + città); video della simulazione con `strumenti/video_demo.py`. Firmware ESP32 unico in `firmware/twinciro-nodo/` (ruolo semaforo/sensore, Wi-Fi e MQTT si configurano dopo il flash dal portale `TwinCiro-XXXXXX`); flasher web in `flasher/` (ESP Web Tools), binari compilati **solo a mano** dall'action `.github/workflows/firmware-twinciro.yml`, che li committa in `flasher/firmware/` e rilancia Pages.
- `shared/citta-api/`: API dati città, il cervello dati di CiroGPT (sezione sotto). `c5-video/`: video di consegna della C5 (sezione sotto).

## Infrastruttura

- **Docker è disponibile** nelle sessioni cloud di Claude Code, demone compreso (`docker`, `docker compose`, `buildx`): usalo per provare davvero container e compose prima di consegnarli.
- **Server `twinciro.robertodisanto.it`** (di Roberto): ci girano i servizi del team (broker MQTT in `cloud/mqtt/`, API dati città in `cloud/citta-api/`). Si possono aprire tutte le porte. **Lì non abbiamo root e non l'avremo**: niente `sudo`, niente nginx di sistema, niente scritture in `/etc`; solo un utente che usa Docker. Quello che richiede root lo fa l'amministratore, una volta (es. `cloud/certificati/`). Dal 14/11 pomeriggio sostituisce `cloud.robertodisanto.it`, che **non si usa più**: la cartella `cloud/` mantiene il nome, l'host no.

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
- `shared/iot-agents/example/`: due scenari sulla stessa dashboard (`app.js`) e mappa configurabile (`mappa.js`, `createMappa(root, config)`): **Napoli** (`index.html`, `napoli.js`) e **Fattoria "Acqua comune"** (`fattoria/`: San Marzano sul Sarno, sonde di umidità, Open-Meteo con ET0, consorzio che assegna i turni d'acqua, notifiche WhatsApp agli agricoltori). Live: `node shared/iot-agents/example/server.js [--scenario fattoria]` (porta 8701, uno scenario alla volta). Nuove modalità o livelli sovrapposti della mappa: `INDICATORI` e `SOVRAPPOSTI` in `napoli.js` (o `mappa.aggiungiIndicatore/aggiungiSovrapposto`); dati esterni con `mappa.setExtra(nome, dati)`.
- **Dati REALI nella mappa di Napoli** (catalogo verificato delle fonti: `docs/fonti-dati-napoli.md`):
  - `example/napoli-fonti.js`: modalità Meteo e Aria, livelli sovrapposti (metro/funicolari/treni con 92 stazioni da GTFS ANM ed EAV; eventi reali di oggi; centraline ARPAC; traffico ASPI su tangenziale e autostrade), sezioni della scheda, pannello "Oggi a Napoli", banner di allerta (Protezione Civile Campania + Meteoalarm), tabella "Fonti dei dati" con stato, ora e licenza.
  - `example/fonti/normalizza.js` (funzioni pure, condivise con lo script) e `example/fonti/dati.js` (fonti live con CORS, cache, timeout e riserve dichiarate: Open-Meteo → MET Norway → snapshot; Transitous per i prossimi passaggi, bus esclusi).
  - Snapshot in `example/dati/` (~140 KB) rigenerati con `node shared/iot-agents/tools/aggiorna-dati-napoli.js [--solo trasporti,aria,eventi,riferimenti,meteo] [--curl]` (1-6 minuti, senza dipendenze: `tools/zip-mini.js`, `tools/parquet-mini.js`). Se una fonte non risponde la sua parte resta quella del file precedente (stato `precedente`, `datoDel`). Da rigenerare periodicamente (cron sul server: eventi e meteo ogni mattina, aria ogni ora).
  - Agente `fonti` (isomorfo; senza rete: `createAgents({ fonti: { rete: false } })`): accende gli scenari `evento_<zona>` e `stagione_bassa/alta` dagli eventi reali e da ISTAT e passa all'orchestratore eventi, stazioni vicine, meteo, aria e allerta.
  - **Folla e sensori restano simulati** (dichiarato in pagina); due orologi: la folla segue l'ora simulata, meteo/passaggi/eventi l'ora reale. Licenze non aperte (Centro Funzionale, ASPI, EAV, Cruise Timetables, AdSP; Transitous solo non commerciale): citate come fonte per una demo non commerciale. Dalla sandbox Open-Meteo e TheSportsDB danno spesso 429 (IP condiviso).
  - Test: `test/fonti-napoli.test.js` (in tutto 105 test: 104 + 1 saltato).
- L'esempio include la mappa "Napoli in tempo reale" stile Seoul Real-Time City Data (`example/mappa.js` + `example/luoghi.js`, Leaflet da cdnjs, tessere OpenStreetMap: CARTO ora chiede una chiave) e l'agente `folla`; scenari `crociere` e `partita` in `example/sim-config.json` (11 dispositivi simulati: il test in `test/sim.test.js` ne controlla il numero).
- Firmware del **badge Cyber Saiyan WHY2025** in `shared/iot-agents/firmware/why2025-badge/`: ESP-IDF 4.4 (via PlatformIO) per **ESP32-C3**, costruito sopra il repo originale. `build.sh` lo clona in `upstream/` (non versionato) e applica `overlay/`, `patches/` e `sdkconfig.telemetry`; configurazione in `telemetry_config.h` (non versionato); test sul PC con `test/run.sh`. **Il badge non ha un sensore di luce**: serve un BH1750 o VEML7700 sul connettore I2C (3,3 V dal connettore POW); il firmware riconosce anche SHT4x/SHT3x, AHT20, BME280. Compilato (flash all'89%), non ancora provato su hardware.
- MQTT (`CONTRATTO.md` §9): topic `bighack/<zona>/<deviceId>/readings|status|cmd`, status retained con last will. Ponte MQTT → hub senza dipendenze: `node shared/iot-agents/tools/mqtt-bridge.js` (solo variabili d'ambiente; converte anche Tasmota `tele/+/SENSOR` e, a richiesta, i topic `napoli/sensori/...` di c5; il `deviceId` vale sempre quello del topic). Test: `test/mqtt.test.js`. Nella sandbox il proxy non inoltra MQTT verso l'esterno: per le prove usa Mosquitto in Docker.
- Tasmota: va bene per ESP32/ESP8266 generici con sensori e per le prese smart (comandi Backlog nel README del firmware del badge); sul badge no (si perdono display e funzioni del badge).
- Firmware ESP32 in `shared/iot-agents/firmware/esp32-sensor/` (`config.h` non versionato; non ancora compilato su scheda vera). Ponte OpenClaw simulato: `node shared/iot-agents/tools/openclaw-bridge-sim.js`.

## `cloud/`

Servizi Docker per il server di Roberto (`twinciro.robertodisanto.it`), da gestire **senza root**. Qui solo configurazione, mai segreti (`.env` e `segreti/` sono ignorati da git). Guida completa: `cloud/mqtt/README.md`.
- `cloud/mqtt/`: Mosquitto 2.1.2 (`eclipse-mosquitto:2.1.2-alpine`). **MQTT in chiaro sulla 1883 con password, TLS spento** (scelta del 14/11, `MQTT_CERTIFICATI=nessuno`). 9001 ws solo su 127.0.0.1. Nessun accesso anonimo (il healthcheck lo controlla). TLS facoltativo: con `MQTT_CERTIFICATI=letsencrypt|autofirmato` `config/avvio.sh` scrive `/mosquitto/run/conf.d/tls.conf` (8883 e 8884 wss), incluso da `mosquitto.conf` con `include_dir`; `LETSENCRYPT_DIR` accetta `live/<dominio>/` o la cartella piatta `<dominio>/` di `cloud/certificati/`.
- Avvio sul server: `cd cloud/mqtt && ./scripts/inizializza.sh && docker compose up -d && ./scripts/prova.sh` (nessun `sudo`: i `chown` a uid 1883 li fanno gli script dentro un container).
- `cloud/certificati/copia-certificati.sh`: hook di certbot che l'amministratore installa una volta; copia i certificati di `twinciro.robertodisanto.it` in `/srv/certificati/<dominio>/` (privkey 0640 `<utente>:certificati`). Comandi in `cloud/certificati/README.md`.
- Utenti: uno per dispositivo con nome = deviceId (badge/ESP32) o Topic Tasmota (`./scripts/aggiungi-utente.sh <id>`); permessi dai pattern `%u` di `config/acl`. Ruoli fissi: admin, ponte, c5, c5-plastico, dashboard (sola lettura: la sua password finisce nel browser), monitor.
- Dopo una modifica a `config/acl` usa `./scripts/ricarica.sh` (un SIGHUP a mano non rilegge l'ACL: Mosquitto usa una copia in tmpfs fatta da `config/avvio.sh`, come per i certificati Let's Encrypt, che la 2.1 legge come uid 1883 e senza symlink).
- Ponte MQTT → hub: servizio `ponte` (profilo compose `ponte`) con `shared/iot-agents/tools/mqtt-bridge.js`. Per `c5-agentic-city` (il suo `BusMQTT` non supporta utente/password/TLS) c'è il bridge Mosquitto `cloud/mqtt/esempi/ponte-c5-verso-cloud.conf`.
- Mai `docker compose down -v` sul server (cancella i dati). Se Docker Hub risponde 429: `docker pull mirror.gcr.io/library/<immagine>` e `docker tag`.

## `shared/citta-api/` (API dati città, cervello dati di CiroGPT)

- Server Node ≥ 20 senza dipendenze sopra i moduli della mappa: `example/fonti/` (normalizza.js, dati.js), `luoghi.js`, `sim/sim-core.js`, `tools/aggiorna-dati-napoli.js`. Li importa, non li copia: una correzione alle fonti vale per mappa e API insieme.
- Avvio: `node shared/citta-api/server.js` (porta 8791). Test: `node --test shared/citta-api/test/` (43). Contratto e skill pronta per CiroGPT (`napoli-citta-dati`, sezione "Usarla da CiroGPT"): `shared/citta-api/README.md`.
- Endpoint GET sotto `/citta/`: `riassunto` (`?formato=testo` per il contesto dell'agente), `luoghi`, `luogo?nome=|lat&lon`, `meteo`, `aria`, `allerta`, `trasporti/vicino`, `passaggi?stazione=`, `eventi?giorno=`, `terremoti`, `traffico`, `fonti`; più `/salute` (senza token) e gli alias senza `/citta`. Barre doppie e maiuscole nel percorso non contano.
- Ricerca dei luoghi: i 10 di `luoghi.js`, poi i luoghi noti senza sensori di `src/punti.js` (Città della Scienza, aeroporto, Parco Virgiliano, Marechiaro; coordinate indicative), poi le stazioni. Fuori dai 10 luoghi meteo e aria vengono dal luogo monitorato più vicino, dichiarato.
- Ogni risposta ha `fonte.stato` (reale, riserva, salvato, snapshot, programmato, simulato, assente) e un `testo` pronto da citare, con stato e ora del dato. La folla è sempre "simulato".
- Cache per fonte (meteo 15 min, aria 60, allerta 20, passaggi 1, eventi 6 h), richieste uguali coalizzate, dopo un 429 il dominio va in pausa 15 minuti (`src/rete.js`) con la riserva dichiarata. Gli snapshot cambiati su disco si ricaricano da soli.
- Variabili: `PORT`, `CITTA_API_TOKEN` (Bearer), `CITTA_API_CORS`, `NAPOLI_UA` (mai dati personali), `CITTA_DATI`, `CITTA_AGGIORNA` (rinfresco degli snapshot nel processo; con la cartella predefinita riscrive quelli della repo), `CITTA_TIENI_CALDO`, `CITTA_PAUSA_429`. Rigenerazione a mano: `node shared/citta-api/aggiorna.js --solo eventi`.
- Docker per il server in `cloud/citta-api/`: `cp .env.example .env && docker compose up -d --build && ./prova.sh` (build dalla radice della repo con `Dockerfile.dockerignore`; volume `/dati` rigenerabile; healthcheck su `/salute`; nel container non c'è curl, quindi `aggiorna.js --curl` va lanciato fuori). HTTPS senza root con il profilo `https` (nginx 1.29 in un container, `nginx/https.conf`: `/citta-api/` → `citta-api:8791`, certificati da `CITTA_CERTIFICATI_DIR`, ricarica da solo ogni 12 ore): `docker compose --profile https up -d --build`. Per CiroGPT: `CITTA_API=https://twinciro.robertodisanto.it/citta-api`.

## `c5-video/` (video di consegna della C5)

- Massimo 3:00. Bozza attuale `bozza.mp4`: 2:54, 1920×1080, 32 MB, muta con sottotitoli impressi; CiroGPT occupa circa due terzi del tempo. La scena SUMO (traffico) è esclusa con `"salta": true`.
- Copione, voce, riprese da girare e tabella reale/simulato: `copione.md`. Scene, durate, testate, voce e sottotitoli: `scene/scaletta.json` (`salta`, `sovrapposti`, `pezzi`).
- Rimontaggio: `cd c5-video && ./monta.sh [--rigenera] [--rigenera-mappa] [--controllo] [--segnaposto]` (ffmpeg, Node con Playwright, python3; da zero circa 10 minuti). Le scene HTML sono rese fotogramma per fotogramma, non con recordVideo.
- Riprese vere, voce e musica vanno in `girato/` (ignorata da git tranne `LEGGIMI.md`): quando un file c'è prende il posto della scena generata. Senza riprese l'IoT usa riquadri di riserva senza valori inventati.
- La chat di CiroGPT si rigenera dall'API vera di `c5-agentic-city` con `python3 scene/chat_da_api.py` (circa 6 minuti, porta 8805, sola lettura) → `scene/chat.json`. I ritocchi di forma dichiarati sono in `scene/chat_domande.json`, il testo originale in `testo_api`; `--solo-ritocchi` li riapplica senza avviare la città. Se si rigenera la chat, rigenerare anche la mappa nello stesso momento (meteo coerente).
