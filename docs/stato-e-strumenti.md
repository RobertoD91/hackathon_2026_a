# Stato del lavoro e strumenti

Diario delle decisioni e di quello che sappiamo sull'ambiente di lavoro. Aggiornalo quando cambia qualcosa.

## Convenzioni della repo

- Una cartella per soluzione, con prefisso della challenge: `c1-...`, `c2-...`, `c4-...`, `c5-...`. **Per una stessa challenge possono esserci più soluzioni** (es. `c5-agentic-city`, `c5-heatescape`).
- Ogni cartella ha il suo `README.md` con brief, scelte, come avviarla e stato.
- Tutto su `master`, in italiano (vedi `CLAUDE.md`).

## Cronologia delle decisioni

| Quando | Decisione |
|---|---|
| 13/11 | Repo predisposta: `CLAUDE.md` (regole: solo `master`, italiano), README, `.gitignore`. Team di 5. |
| 13/11 | C4: cercato codice open da riusare prima di scrivere da zero. Scelto **Monster Tamer** (Phaser 3, MIT). Scartati RPG-JS (troppo grande, combattimento in tempo reale), phaser-rpg (senza battaglie), giochi cyber esistenti (non sono JRPG). |
| 13/11 | Hosting su **GitHub Pages** con workflow Actions; dominio dell'account `robertodisanto.it`. |
| 13/11 | C4: contromosse red vs blue, tutto in italiano, partenza diretta con Black Hat, titolo con immagine FLUX e nomi del team. |
| 13/11 | Un'altra sessione ha aperto `c5-agentic-city/` (direzione: niente webapp, agenti + ESP32 + droni; Worker Cloudflare nuovo, **non `mbl-privato`**). |
| 13/11 | `jrpg/` rinominata `c4-jrpg/` (resta un redirect in `jrpg/index.html`). Brainstorming su C1, C2, C5 in [`brainstorming.md`](brainstorming.md). |
| 13/11 | Lanciati i subagent. Partiti subito: `c1-feed-simulato` e la base `shared/iot-agents` (contratto in `shared/iot-agents/CONTRATTO.md`). Dopo la base partono `c2-cer-quartiere` (scelta la comunità energetica: usa solo luce e temperatura) e `c5-regia-evento` (grande evento + guasto metro; cartella separata da `c5-agentic-city`). LLM non ancora scelto: adattatore con modalità `mock` predefinita. |
| 13/11 | `c1-feed-simulato` integrato e online. **C5 resta interamente a `c5-agentic-city`** (l'altra sessione: Python/MQTT, gemello SUMO, semafori ESP32, OpenClaw): niente `c5-regia-evento` per non duplicare. `shared/iot-agents` serve quindi a C2. |
| 13/11 | `shared/iot-agents` completata (50 test) e `c2-cer-quartiere` integrata: su una giornata simulata gli agenti portano la quota di energia condivisa dal 51% all'86% circa. Parametri economici indicativi da verificare (`c2-cer-quartiere/model/parametri.js`). |
| 13/11 | Esempio IoT: mappa "Napoli in tempo reale" stile Seoul RTD e agente folla. |
| 13/11 sera | **Il team si divide:** qui restano Roberto D'Isanto e Mario Varlese; Francesca, Giovanni e Pasquale hanno forkato la repo e lavorano su challenge diverse. |
| 13/11 sera | Avviati: ricerca e verifica delle fonti dati pubbliche di Napoli (catalogo in `docs/fonti-dati-napoli.md`), versione fattoria della mappa, firmware del badge WHY2025 con MQTT verso `cloud.robertodisanto.it` (+ ponte MQTT → hub, valutazione Tasmota), Docker del broker MQTT in `cloud/mqtt/`. |
| 13/11 sera | Priorità: **C5 principale**, C2 di riserva, C1 molto improbabile. C4 passa all'altro gruppo; le cartelle restano come sono. |
| 14/11 | Confermato: Docker con demone disponibile nelle sessioni cloud; su `cloud.robertodisanto.it` si possono aprire tutte le porte. |
| 14/11 notte | Consegnati: Docker MQTT in `cloud/mqtt/`; firmware del badge WHY2025 (ESP32-C3, **senza sensore di luce**: serve un BH1750/VEML7700 I2C) con MQTT e ponte MQTT → hub (Tasmota sì per ESP32 generici, no sul badge); versione Fattoria "Acqua comune" della mappa. |
| 14/11 mattina | Fonti dati di Napoli: 59 fonti in 4 domini, verificate da agenti scettici, catalogo in `docs/fonti-dati-napoli.md`. Integrate nella mappa di Napoli: meteo e aria reali, allerta, metro/funicolari/treni con prossimi passaggi, eventi di oggi, visitatori e riferimenti, traffico ASPI. Mancano (e restano simulati): presenze da rete mobile (da chiedere a Fastweb + Vodafone) e traffico urbano. |
| 14/11 | **Scelta C5.** Feedback di Fastweb e Vodafone: IoT piaciuto; CiroGPT (agente OpenClaw di Roberto con la skill di `c5-agentic-city`, funzionante) il più apprezzato; gemello digitale piaciuto ma meno; traffico/semafori non piaciuto; video 3D della regata piaciuto. Consegna: **video di massimo 3 minuti**, live demo facoltativa (gruppo WhatsApp con CiroGPT). |
| 14/11 pomeriggio | Riordino e divisione del lavoro tra le due sessioni Claude di Roberto: "Hackathon napoli" possiede `c5-agentic-city/` (TwinCiro, skill di CiroGPT, flasher); "hackathon-2026-a" possiede `shared/`, `cloud/`, `c5-video/`, `docs/`. La mappa "Napoli in tempo reale" diventa il **cervello dati di CiroGPT**: in costruzione `shared/citta-api/` (una API con cache sopra le 59 fonti verificate, Docker in `cloud/citta-api/`) e il **video di consegna** in `c5-video/`. |
| 14/11 pomeriggio | Pronti, con revisione indipendente: **API dati città** `shared/citta-api/` (43 test, Docker in `cloud/citta-api/` provato in locale, non ancora sul server) e **bozza del video** `c5-video/bozza.mp4` (2:54, muta con sottotitoli, CiroGPT per circa due terzi; scena SUMO esclusa; IoT con riquadri di riserva finché non arrivano le riprese). La mappa ora tratta "nessun avviso in vigore" della Protezione Civile come dato vero e non come guasto. |
| — | Tower defense per C4: non più nostro (altro gruppo). |

## Richieste tra le sessioni

Richieste da una sessione Claude all'altra (vedi la divisione del lavoro in `CLAUDE.md`). Chi la chiude la segna come fatta.

| Da → a | Richiesta | Stato |
|---|---|---|
| hackathon-2026-a → Hackathon napoli | Installare la skill **`napoli-citta-dati`** in `c5-agentic-city/openclaw/skills/` (o fonderla con `twinciro-citta`). Testo pronto e curl provati in `shared/citta-api/README.md`, sezione "Usarla da CiroGPT". Variabili su OpenClaw: `CITTA_API` e `CITTA_API_TOKEN`. | aperta |
| hackathon-2026-a → Hackathon napoli | Testi dell'API `/chiedi` che su WhatsApp si vedono così come sono (la skill li inoltra): la prima risposta inoltra il testo della pizzeria («Alle 13:00 siamo pieni…») e sembra parlare la pizzeria; «A Rotonda Diaz (village)… è molto più tranquillo»; «Linea 6 della metro se attiva»; il messaggio al drone «volo di verifica? verifica affluenza». File: `c5-agentic-city/citta/agenti/assistente.py`, `citta/agenti/turismo.py`, `citta/agenti/orchestratore.py` (drone), `dati/luoghi.json`. Nel video sono corretti con ritocchi dichiarati (`c5-video/scene/chat_domande.json`); se li correggete nell'API, la chat del video si rigenera con `python3 c5-video/scene/chat_da_api.py`. | aperta |
| hackathon-2026-a → Hackathon napoli | Verificare che l'heartbeat di OpenClaw legga `/notifiche`: senza, l'avviso proattivo («Rotonda Diaz piena…») non arriva su WhatsApp vero. | aperta |

## Punti di forza del team

- Hardware IoT: **ESP32** con sensori (luce, temperatura), possibilità di modulo **5G** (rilevante per Fastweb + Vodafone), droni.
- **OpenClaw** già funzionante come orchestratore di agenti, con canale WhatsApp.
- Server su cloud e deploy veloce con Claude Code.

## Strumenti e servizi disponibili nelle sessioni cloud di Claude Code

| Servizio | Uso | Note |
|---|---|---|
| GitHub Pages | Hosting statico dei prototipi | Workflow `.github/workflows/pages.yml`, deploy in ~20 s dopo il push. URL: https://robertodisanto.it/hackathon_2026_a/ |
| FLUX.1 Kontext (Hugging Face Space) | Generazione immagini (titoli, creatività pubblicitarie per C1, mockup) | `tools/flux-gen.sh "<prompt>" out.webp`. Funziona dalle sessioni cloud (credenziali iniettate dal proxy); altrove serve un token Hugging Face. Restituisce WebP 1024×1024. |
| Hunyuan3D 2.1 (Hugging Face Space) | Generazione di modelli 3D da immagine | Non ancora usato. |
| Cloudflare API | Workers, deploy di backend leggeri | Per C5: Worker **nuovo**, non toccare `mbl-privato`. |
| **Docker (client + demone)** | Container per broker MQTT, build del firmware (immagini ESP-IDF/PlatformIO), servizi di prova | Docker 29.9.2 con compose v5.6.1 e buildx, demone attivo (`/var/run/docker.sock`). Disponibile nelle sessioni cloud di Claude Code: **usarlo** per provare davvero compose e immagini. |
| Server `cloud.robertodisanto.it` | Server di Roberto per i servizi (broker MQTT in `cloud/mqtt/`, hub, ponti) | Si possono aprire **tutte le porte** (es. 1883 MQTT con autenticazione, 8883 MQTT/TLS, WebSocket). |
| Playwright + Chromium | Test end-to-end e screenshot dei prototipi | Già installati nel container. |
| ffmpeg | Conversione audio/immagini | Usato per i WAV → MP3 di C4. |

## C4 (`c4-jrpg/`) in breve

Vedi [`../c4-jrpg/README.md`](../c4-jrpg/README.md) e la sezione in `CLAUDE.md`. Giocabile su https://robertodisanto.it/hackathon_2026_a/c4-jrpg/

Da fare:
- sostituire gli asset di terze parti non ridistribuibili;
- grafica a tema (mostri e mappa sono ancora fantasy);
- progressione, livelli e punteggi (richiesti esplicitamente dal brief);
- tecnologie Cisco, per esempio missioni ispirate a Packet Tracer.
