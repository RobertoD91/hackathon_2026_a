# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Regole di lavoro (obbligatorie)

- **Lingua:** parla sempre in italiano con il team (risposte, commit message, commenti, documentazione).
- **Branch:** lavora solo su `master`. Niente feature branch, niente PR: commit e push direttamente su `master` (`git push origin master`). Prima di iniziare fai `git pull --rebase origin master`: più sessioni (e più persone) pushano sullo stesso branch.

## Contesto

Repo del team per **The Big Hack 2026** (Codemotion, 40ª edizione di Futuro Remoto), Città della Scienza, Napoli, 14–15 novembre 2026. Dettagli: https://go.codemotion.com/big-hack-hackathon-2026/

Team (dal 13/11 sera): **Roberto D'Isanto e Mario Varlese**. Francesca Morra, Giovanni Di Stazio e Pasquale Criscuolo sono in un altro gruppo: hanno forkato questa repo e lavorano su challenge diverse (collaboriamo, ma i loro sviluppi stanno nel loro fork).

**Scelta definitiva (14/11): C5 Fastweb + Vodafone, "Napoli Agentic City". Il progetto si chiama TwinCiro** ("Napoli che ci pensa"; Twin = gemello digitale, Ciro = CiroGPT): CiroGPT su WhatsApp + agenti della città + gemello digitale. Le altre challenge non si fanno: i prototipi di C1, C2 e C4 sono stati tolti dalla repo il 14/11 (restano nella storia git e nel fork dell'altro gruppo).

Cosa ne pensano i partner (Fastweb e Vodafone, incontro del 14/11):
- la parte **IoT è piaciuta**;
- **CiroGPT** (l'agente OpenClaw di Roberto, skill in `c5-agentic-city/openclaw/skills/`) è il pezzo **più apprezzato**: va messo al centro;
- il **gemello digitale** è piaciuto, ma meno di CiroGPT;
- la parte **traffico/semafori non è piaciuta**: ridimensionarla. Il video 3D della regata (`c5-agentic-city/media/regata_3d.mp4`) invece è piaciuto.

**Regole di consegna C5:** si consegna un **video di massimo 3 minuti**. La live demo è facoltativa: c'è un gruppo WhatsApp con CiroGPT dentro.

**Percorso della demo:** badge WHY2025 e scheda Tasmota → MQTT `napoli/...` sul server → città Python (`c5-agentic-city`) → CiroGPT su WhatsApp. Le skill di CiroGPT (`c5-agentic-city/openclaw/skills/`) sono tre:
- `twinciro-citta`: parla con gli agenti della città (`/chiedi`, `/notifiche` di `c5-agentic-city`);
- `napoli-citta-dati`: il **modo unico** per i dati veri, da `citta-api/`;
- `napoli-fonti-riserva`: legge le fonti aperte **solo se l'API non risponde**, più i dati che l'API non ha (mare, farmacie, indirizzi con Nominatim, percorsi in auto con OSRM).

**Divisione del lavoro tra le sessioni Claude di Roberto** (per non pestarsi i piedi; fai sempre `git pull --rebase` prima di pushare):
- la sessione "Hackathon napoli" possiede **`c5-agentic-city/`** (città Python, skill di CiroGPT in `openclaw/`, visore e video 3D, README di C5). Il riordino del 14/11 sera dentro `c5-agentic-city/` l'ha fatto la sessione "hackathon-2026-a", d'accordo con l'altra: skill ridotte a tre, la città che legge badge e Tasmota, tolti il firmware `twinciro-nodo`, il `flasher/` e la loro action `firmware-twinciro.yml`;
- la sessione "hackathon-2026-a" possiede **`citta-api/`**, **`firmware/`**, **`cloud/`**, **`c5-presentazione/`** e **`docs/`**;
- README principale, `index.html` e questo file li aggiornano entrambe, con modifiche piccole e mirate. Le richieste da una sessione all'altra si lasciano in `docs/stato-e-strumenti.md` (sezione "Richieste tra le sessioni").

Vincoli che contano per le scelte tecniche:
- **Consegna: domenica 15/11 ore 12:00.** Sabato si lavora 11:00–20:30, domenica dalle 8:30. Privilegia soluzioni che arrivano a una demo funzionante, non architetture complete.
- **Criteri della giuria:** utilità/valore, aderenza alla challenge, chiarezza e completezza del progetto, design/UX, creatività/innovazione. La UX della demo pesa quanto il backend.
- Almeno 2 checkpoint con i mentor durante l'evento.

## Organizzazione della repo

| Cartella | Cosa | Di chi |
|---|---|---|
| `c5-agentic-city/` | città agentica Python: agenti, assistenti personali, API per CiroGPT, gemello digitale, skill di CiroGPT, visore e video 3D | Hackathon napoli |
| `citta-api/` | API dati città (Node), il cervello dati di CiroGPT | hackathon-2026-a |
| `firmware/` | i due dispositivi reali: badge WHY2025 e scheda Tasmota; formato MQTT unico | hackathon-2026-a |
| `cloud/` | servizi Docker sul server `twinciro.robertodisanto.it` (broker MQTT, API dati città) | hackathon-2026-a |
| `c5-presentazione/` | vetrina: video di consegna, copione, scene, mappa "Napoli in tempo reale" (simulata) | hackathon-2026-a |
| `docs/` | `hackathon.md` (testo delle challenge, agenda, regole), `stato-e-strumenti.md` (diario, richieste tra sessioni, strumenti), `fonti-dati-napoli.md` (le 59 fonti verificate), `brainstorming.md` (storico) | hackathon-2026-a |
| `tools/` | `flux-gen.sh` (immagini con FLUX) | tutti |

- Ogni cartella ha un `README.md` con brief, scelte, avvio e stato. Tieni aggiornati i file di `docs/` quando si decide qualcosa.
- **Reale e vetrina separati:** quello che è simulato o serve solo alla presentazione sta in `c5-presentazione/` e lo dichiara in pagina.
- **Niente `shared/` e niente copie:** un modulo usato da più parti sta nella cartella che lo possiede e gli altri lo importano (la mappa importa fonti, luoghi, simulatore e snapshot da `citta-api/`).

## `c5-agentic-city/` (dell'altra sessione: leggerla sì, modificarla no)

- Avvio: `python avvia.py` (venv con `requirements.txt`) oppure `docker compose up -d` dalla cartella (Mosquitto locale + città + API su :8080), `docker compose run --rm sala` per la sala operativa; video della simulazione con `strumenti/video_demo.py`.
- Zone dello scenario: `dati/scenario_regata.json` (chiave `"zone"`), le stesse del formato MQTT.
- Il video di consegna usa in sola lettura `media/regata_3d.mp4`, `media/demo_gemello.mp4` e l'API `/chiedi` e `/notifiche`.
- Per un proxy/worker serve un Worker Cloudflare nuovo: **non usare `mbl-privato`**.

## `citta-api/` (API dati città, cervello dati di CiroGPT)

- Node ≥ 20, nessuna dipendenza npm, **autonoma**: `fonti/` (`normalizza.js` funzioni pure, `dati.js` con cache, timeout e riserve, `luoghi.js` con i 10 luoghi), `simulatore/` (`sim-core.js` + `sim-config.json`: la folla simulata), `dati/` (snapshot JSON, ~140 KB), `strumenti/` (`aggiorna-dati-napoli.js`, `zip-mini.js`, `parquet-mini.js`), `src/` (server). Una correzione alle fonti vale per API e mappa insieme.
- Avvio: `node citta-api/server.js` (porta 8791). Test: `node --test citta-api/test/` (57). Contratto e testo della skill `napoli-citta-dati` (sezione "Usarla da CiroGPT"): `citta-api/README.md`. Catalogo delle fonti: `docs/fonti-dati-napoli.md`.
- Endpoint GET sotto `/citta/`: `riassunto` (`?formato=testo` per il contesto dell'agente), `luoghi`, `luogo?nome=|lat&lon`, `meteo`, `aria`, `allerta`, `trasporti/vicino`, `passaggi?stazione=`, `eventi?giorno=`, `terremoti`, `traffico`, `fonti`; più `/salute` (senza token) e gli alias senza `/citta`. Barre doppie e maiuscole nel percorso non contano.
- Ricerca dei luoghi: i 10 di `fonti/luoghi.js`, poi i luoghi noti senza sensori di `src/punti.js` (coordinate indicative), poi le stazioni. Fuori dai 10 luoghi meteo e aria vengono dal luogo monitorato più vicino, dichiarato.
- Ogni risposta ha `fonte.stato` (reale, riserva, salvato, snapshot, programmato, simulato, assente) e un `testo` pronto da citare, con stato e ora del dato. La folla è sempre "simulato". Mai dati inventati.
- Cache per fonte (meteo 15 min, aria 60, allerta 20, passaggi 1, eventi 6 h), richieste uguali coalizzate, dopo un 429 il dominio va in pausa 15 minuti (`src/rete.js`) con la riserva dichiarata. Gli snapshot cambiati su disco si ricaricano da soli.
- Snapshot: `node citta-api/aggiorna.js [--solo trasporti,aria,eventi,riferimenti,meteo] [--curl]` (1-6 minuti). Se una fonte non risponde la sua parte resta quella del file precedente (stato `precedente`, `datoDel`). Dalla sandbox Open-Meteo e TheSportsDB danno spesso 429 (IP condiviso).
- Variabili: `PORT`, `CITTA_API_TOKEN` (Bearer), `CITTA_API_CORS`, `NAPOLI_UA` (mai dati personali), `CITTA_DATI`, `CITTA_DATI_INIZIALI`, `CITTA_AGGIORNA` (rinfresco degli snapshot nel processo; con la cartella predefinita riscrive quelli della repo), `CITTA_TIENI_CALDO`, `CITTA_PAUSA_429`.
- Licenze non aperte (Centro Funzionale, ASPI, EAV, Cruise Timetables, AdSP; Transitous solo non commerciale): citate come fonte per una demo non commerciale.

## `firmware/` (i due dispositivi reali)

- **Solo due dispositivi**, collegati all'hotspot di Roberto (SSID `iBob12`, password `IguanaCheDaUnaCapata`: nella repo su sua richiesta, gli unici segreti ammessi; solo 2,4 GHz, sull'iPhone "Massimizza compatibilità"):
  - **badge Cyber Saiyan WHY2025** in `firmware/why2025-badge/`: ESP32-C3, ESP-IDF 4.4 via PlatformIO, costruito sopra il repo originale (`build.sh` lo clona in `upstream/` e applica `overlay/`, `patches/` e `sdkconfig.telemetry`); configurazione in `telemetry_config.h` (non versionato: solo utente e password MQTT, il resto è predefinito); test sul PC con `test/run.sh`. Compilato (flash all'89%), **non ancora provato sul badge**. Fa da contapersone a mano (rotella SU = un gruppo visto, GIÙ = azzera); non ha un sensore di luce: BH1750 o VEML7700 sul connettore I2C (3,3 V dal connettore POW); riconosce anche SHT4x/SHT3x, AHT20, BME280. Tasmota sul badge no (si perdono display e funzioni);
  - **scheda con Tasmota** in `firmware/tasmota/`: niente da compilare, Rules + un comando `Backlog` dalla console web. Non ancora provata sulla scheda.
- **Formato MQTT unico**, quello della città Python (specifica completa in `firmware/README.md`, validatore `firmware/valida-messaggi.mjs`):
  - letture `napoli/sensori/<id>/<grandezza>` con `{"zona":"<zona>","valore":<numero>}` (per `persone` anche `"moltiplicatore"`); grandezze `temperatura` (°C), `umidita` (%), `luce` (lux), `pressione` (hPa), `persone`; `<zona>` tra quelle di `c5-agentic-city/dati/scenario_regata.json` (l'agente Folla scarta le zone che non conosce);
  - stato `napoli/nodi/<id>/stato`, trattenuto, `{"online":true,"ruolo":"badge|tasmota","zona":"...","versione":"...","ip":"...","rssi":-60}`, last will `{"online":false}` (per Tasmota il last will resta su `napoli/nodi/<topic>/tele/LWT`);
  - comandi `napoli/nodi/<id>/cmd` (badge); Tasmota con `FullTopic napoli/nodi/%topic%/%prefix%/`;
  - `<id>` = utente MQTT = deviceId (`badge-1`, `tasmota-1`). Niente `bighack/...` né `tele/...` fuori da `napoli/`.
- La città legge tutte le letture `napoli/sensori/+/+` e lo stato dei nodi (`napoli/nodi/+/stato`, per Tasmota `napoli/nodi/+/tele/LWT`) e li mostra nella sala (pannello "Sensori reali") e in `GET /stato` (chiavi `sensori` e `nodi`). Meteo&Mare dice in dialogo la temperatura vera; la Folla somma `persone × moltiplicatore` e ignora le letture più vecchie di 180 s, i nodi offline e i numeri non validi. Al broker del team si collega con `C5_MQTT_UTENTE`/`C5_MQTT_PASSWORD` (utente `c5`).

## `cloud/` (server `twinciro.robertodisanto.it`)

- Server di Roberto: si possono aprire tutte le porte, ma **non abbiamo root e non l'avremo**: solo l'utente **`openclaw`**, che usa Docker. Niente `sudo`, niente nginx di sistema, niente scritture in `/etc`; quello che richiede root lo fa l'amministratore, una volta (`cloud/certificati/`). Sostituisce `cloud.robertodisanto.it`, che non si usa più (la cartella `cloud/` mantiene il nome).
- **Attivi dal 14/11 pomeriggio:** broker MQTT (`cloud/mqtt/`) e API dati città (`cloud/citta-api/`). Riavvio completo, con diagnosi e "COSA FARE" a ogni errore: `git pull && bash cloud/riavvia-tutto.sh` (dalla radice della repo). Ogni modifica deve dire cosa fare sul server dopo il `git pull`. **Mai `docker compose down -v`** sul server (sul broker cancella i dati).
- Qui solo configurazione, mai segreti (`.env` e `segreti/` sono ignorati da git).
- `cloud/mqtt/`: Mosquitto 2.1.2 (`eclipse-mosquitto:2.1.2-alpine`). **MQTT in chiaro sulla 1883 con password, TLS spento** (`MQTT_CERTIFICATI=nessuno`; facoltativo con `letsencrypt|autofirmato`: 8883 e 8884 wss). 9001 ws solo su 127.0.0.1. Nessun accesso anonimo (il healthcheck lo controlla). Guida completa e sezione "Aggiornare il server già attivo": `cloud/mqtt/README.md`.
  - Prima installazione: `cd cloud/mqtt && ./scripts/inizializza.sh && docker compose up -d && ./scripts/prova.sh` (i `chown` a uid 1883 li fanno gli script dentro un container).
  - **ACL solo `napoli/`**: un utente per dispositivo con nome = id (`./scripts/aggiungi-utente.sh <id>`), permessi dai pattern `%u` di `config/acl`; ruoli fissi `admin`, `c5` (legge e scrive `napoli/#`), `dashboard` (sola lettura: la sua password finisce nel browser), `monitor` (sola lettura). Il ponte MQTT → hub e i ruoli `ponte` e `c5-plastico` non esistono più.
  - Dopo una modifica a `config/acl`: `./scripts/ricarica.sh` (un SIGHUP a mano non rilegge l'ACL: Mosquitto usa una copia in tmpfs fatta da `config/avvio.sh`, come per i certificati).
  - La città si collega con l'utente `c5`: direttamente (`C5_MQTT_UTENTE=c5 C5_MQTT_PASSWORD=... python avvia.py --broker twinciro.robertodisanto.it:1883`; in Docker con `C5_BROKER`, sul server `host.docker.internal:1883`, e sempre `docker compose up -d --no-deps citta`, se no il Mosquitto locale di c5 cerca di prendersi la 1883) oppure dal suo Mosquitto locale con il bridge `cloud/mqtt/esempi/ponte-c5-verso-cloud.conf` (connessione `cloud-twinciro`).
  - Se Docker Hub risponde 429: `docker pull mirror.gcr.io/library/<immagine>` e `docker tag`.
- `cloud/citta-api/`: `cp .env.example .env && docker compose --profile https up -d --build && ./prova.sh`. Build dalla radice della repo con `Dockerfile.dockerignore` (copia solo `citta-api/`, test esclusi); volume `/dati` rigenerabile; healthcheck su `/salute`; nel container non c'è curl, quindi `aggiorna.js --curl` va lanciato fuori. HTTPS senza root con il profilo `https` sulla **443** (il Docker del server è **rootless**: le porte basse sono abilitate con `setcap cap_net_bind_service` su rootlesskit; senza, 8443; nginx 1.29 in un container: `/citta-api/` → `citta-api:8791`, certificati da `CITTA_CERTIFICATI_DIR`, ricarica da solo ogni 12 ore). Dopo un pull che tocca `citta-api/`: `docker compose --profile https up -d --build`. Per CiroGPT: `CITTA_API=https://twinciro.robertodisanto.it/citta-api`.
- **Docker è disponibile** anche nelle sessioni cloud di Claude Code, demone compreso (`docker`, `docker compose`, `buildx`): usalo per provare davvero container e compose prima di consegnarli. Dalla sandbox la 1883 verso il server non passa: le prove del broker si fanno con Mosquitto in Docker.

## `c5-presentazione/` (vetrina: video di consegna e mappa simulata)

- **Video:** massimo 3:00. Bozza `bozza.mp4`: 2:54, 1920×1080, 32 MB, muta con sottotitoli impressi; CiroGPT occupa circa due terzi del tempo. La scena SUMO (traffico) è esclusa con `"salta": true`. L'IoT (scene `06-badge` e `07-tasmota`) usa riquadri di riserva senza valori inventati: i due dispositivi reali e il formato `napoli/`.
- Copione, voce, riprese da girare (R1 chat di CiroGPT, R2 badge, R3 Tasmota, R4 voce) e tabella reale/simulato: `copione.md`. Scene, durate, testate, voce e sottotitoli: `scene/scaletta.json` (`salta`, `sovrapposti`, `pezzi`).
- Rimontaggio: `cd c5-presentazione && ./monta.sh [--rigenera] [--rigenera-mappa] [--controllo] [--segnaposto]` (ffmpeg, Node con Playwright, python3; da zero circa 10 minuti; cache in `$C5_VIDEO_LAVORO`, predefinita `/tmp/c5-video-lavoro`). Le scene HTML sono rese fotogramma per fotogramma, non con recordVideo.
- Riprese vere, voce e musica in `girato/` (ignorata da git tranne `LEGGIMI.md`): `cirogpt.mp4`, `badge.mp4`, `tasmota.mp4`, `voce.m4a`, `musica.mp3`. Quando un file c'è prende il posto della scena generata.
- La chat di CiroGPT si rigenera dall'API vera di `c5-agentic-city` con `python3 scene/chat_da_api.py` (circa 6 minuti, porta 8805, sola lettura) → `scene/chat.json`. I ritocchi di forma dichiarati sono in `scene/chat_domande.json`, il testo originale in `testo_api`; `--solo-ritocchi` li riapplica senza avviare la città. Se si rigenera la chat, rigenerare anche la mappa nello stesso momento (meteo coerente).
- **Mappa "Napoli in tempo reale"** in `c5-presentazione/mappa/` (il simulatore della presentazione): **folla e sensori simulati** (non legge MQTT), **meteo, aria, trasporti, eventi e allerte veri** dai moduli di `citta-api/`. Pagina `mappa/index.html`, online su https://robertodisanto.it/hackathon_2026_a/c5-presentazione/mappa/ (modalità demo: agenti e simulatore nel browser). Hub Node: `node c5-presentazione/mappa/server.js` (porta 8701). Test: `node --test c5-presentazione/mappa/test/` (52).
  - `mappa.js` (componente configurabile stile Seoul Real-Time City Data, Leaflet da cdnjs, tessere OpenStreetMap), `napoli.js` (modalità e livelli: `INDICATORI`, `SOVRAPPOSTI`), `napoli-fonti.js` (dati reali in pagina, tabella delle fonti), `app.js` (dashboard), `agents/` (clima, illuminazione, folla, fonti, orchestratore: isomorfi, niente `node:*`), `src/` (hub: `createHub`, `createCore`, `connectHub`), `sim/simulate.js`; contratto in `mappa/CONTRATTO.md`.
  - Due orologi: la folla segue l'ora simulata, meteo, passaggi ed eventi l'ora reale. 11 dispositivi simulati (`test/sim.test.js` ne controlla il numero). LLM: `LLM_PROVIDER=mock` predefinito, `anthropic` o `openai-compatible` con variabili d'ambiente, mai chiavi nei file; il testo deterministico va sempre passato come `fallback`.

## Hosting

GitHub Pages pubblica la root di `master` tramite il workflow `.github/workflows/pages.yml` (a ogni push su master; dominio personalizzato dell'account): https://robertodisanto.it/hackathon_2026_a/ (ogni pagina dalla sua sottocartella, es. `/c5-presentazione/mappa/`). `index.html` in root è la pagina con i link: aggiornala quando aggiungi una pagina. `.nojekyll` disattiva Jekyll (i `.md` non vengono resi: da `index.html` si linkano su GitHub). Nelle pagine usa **solo percorsi relativi** (il sito non è servito dalla root del dominio) e attenzione a maiuscole/minuscole nei nomi dei file.

## Strumenti

FLUX (`tools/flux-gen.sh`), Playwright con Chromium, ffmpeg, Cloudflare e gli altri servizi disponibili nelle sessioni cloud: tabella in `docs/stato-e-strumenti.md`.
