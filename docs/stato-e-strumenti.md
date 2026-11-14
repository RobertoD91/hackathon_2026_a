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
| 14/11 pomeriggio | **Cambio host:** i servizi del team (broker MQTT, API dati città) vanno su `twinciro.robertodisanto.it` (34.154.255.49), non più su `cloud.robertodisanto.it`. Aggiornati configurazioni, script, esempi nginx, firmware del badge, ponte MQTT e documentazione. Le righe precedenti del diario citano il vecchio nome. |
| 14/11 pomeriggio | Server `twinciro.robertodisanto.it` **senza root** (scelta definitiva). MQTT **in chiaro** sulla 1883 con password: TLS del broker spento di serie e facoltativo. HTTPS dell'API dati città con un nginx in Docker (profilo `https` di `cloud/citta-api`); i certificati li rende leggibili l'amministratore con l'hook `cloud/certificati/copia-certificati.sh`. Provati con Docker: broker senza TLS (7/7), con TLS autofirmato (10/10), API in HTTPS (6/6), hook con un finto certbot. |
| — | Tower defense per C4: non più nostro (altro gruppo). |

## Richieste tra le sessioni

Richieste da una sessione Claude all'altra (vedi la divisione del lavoro in `CLAUDE.md`). Chi la chiude la segna come fatta.

| Da → a | Richiesta | Stato |
|---|---|---|
| hackathon-2026-a → Hackathon napoli | Installare la skill **`napoli-citta-dati`** in `c5-agentic-city/openclaw/skills/` (o fonderla con `twinciro-citta`). Testo pronto e curl provati in `shared/citta-api/README.md`, sezione "Usarla da CiroGPT". Variabili su OpenClaw: `CITTA_API` e `CITTA_API_TOKEN`. | **fatta** (Hackathon napoli): installata in `c5-agentic-city/openclaw/skills/napoli-citta-dati/`, messa per prima nell'ordine d'uso; le skill delle fonti dirette ora sono la riserva. |
| hackathon-2026-a → Hackathon napoli | Testi dell'API `/chiedi` che su WhatsApp si vedono così come sono (la skill li inoltra): la prima risposta inoltra il testo della pizzeria («Alle 13:00 siamo pieni…») e sembra parlare la pizzeria; «A Rotonda Diaz (village)… è molto più tranquillo»; «Linea 6 della metro se attiva»; il messaggio al drone «volo di verifica? verifica affluenza». File: `c5-agentic-city/citta/agenti/assistente.py`, `citta/agenti/turismo.py`, `citta/agenti/orchestratore.py` (drone), `dati/luoghi.json`. Nel video sono corretti con ritocchi dichiarati (`c5-video/scene/chat_domande.json`); se li correggete nell'API, la chat del video si rigenera con `python3 c5-video/scene/chat_da_api.py`. | **fatta** (Hackathon napoli): CiroGPT racconta l'esito con la sua voce («La Pizzeria 'O Scoglio alle 13:30 non ha posto, ma vi propone le 14:30 per 4. Prenoto?»), un orario già passato diventa una proposta e non una prenotazione, frasi corrette per zone e luoghi (`citta/testi.py`, campo `dove` in `dati/luoghi.json`), Linea 6 vera, drone «Puoi fare un volo di verifica a Rotonda Diaz? Il motivo: …», offerte scadute escluse. La chat del video si può rigenerare. |
| hackathon-2026-a → Hackathon napoli | Verificare che l'heartbeat di OpenClaw legga `/notifiche`: senza, l'avviso proattivo («Rotonda Diaz piena…») non arriva su WhatsApp vero. | aperta: **da verificare da Roberto su OpenClaw** (da qui non si può). La skill `twinciro-citta` dice già di leggere `/notifiche` nell'heartbeat. |
| hackathon-2026-a → Hackathon napoli | Cambio host: `cloud.robertodisanto.it` → `twinciro.robertodisanto.it`. Restano da aggiornare `c5-agentic-city/firmware/README.md` (broker del team) e `c5-agentic-city/openclaw/skills/README.md` (esempio di `CITTA_API`), più eventuali impostazioni dei nodi già flashati. | **fatta** (Hackathon napoli): aggiornati i due README; nei sorgenti e nei valori predefiniti del portale dei nodi non c'era il vecchio host (il predefinito è l'IP del portatile). I nodi già flashati con il vecchio host si riconfigurano dal portale (BOOT 3 s). |
| hackathon-2026-a → Hackathon napoli | **Visore 3D della regata nel browser** (richiesta di Roberto, 14/11). Oggi `strumenti/video3d/pagina.html` è una "telecamera" per `fai_video.sh`: senza `lib/deck.min.js` e `scena.json` (in `.video3d/`, ignorata da git) è vuota e disegna solo quando `rendi.mjs` le passa i fotogrammi. Serve una pagina **nuova e separata** (es. `c5-agentic-city/visore3d/`), client side e servita da GitHub Pages con percorsi relativi, che si anima da sola (play/pausa, velocità, ora simulata), col controllo del mouse acceso e i dati pubblicati accanto (deck.gl da CDN con versione esatta, `scena.json`, fotogrammi campionati, pochi MB). **Non toccare** `pagina.html`, `rendi.mjs`, `esporta.py`, `scena.py`, `fai_video.sh` né `media/regata_3d.mp4`: se si riusa codice, copiarlo o estrarlo senza cambiare il risultato, e provare con `rendi.mjs --campioni` che alcuni fotogrammi escono identici a prima. Link in `index.html` quando funziona. | aperta |

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
| Server `twinciro.robertodisanto.it` | Server di Roberto per i servizi (broker MQTT in `cloud/mqtt/`, API dati città in `cloud/citta-api/`, ponti). Dal 14/11 pomeriggio sostituisce `cloud.robertodisanto.it`, che non si usa più. **Senza root**: solo Docker da utente normale | Si possono aprire **tutte le porte** (es. 1883 MQTT con autenticazione, 8883 MQTT/TLS, WebSocket). |
| Playwright + Chromium | Test end-to-end e screenshot dei prototipi | Già installati nel container. |
| ffmpeg | Conversione audio/immagini | Usato per i WAV → MP3 di C4. |

## C4 (`c4-jrpg/`) in breve

Vedi [`../c4-jrpg/README.md`](../c4-jrpg/README.md) e la sezione in `CLAUDE.md`. Giocabile su https://robertodisanto.it/hackathon_2026_a/c4-jrpg/

Da fare:
- sostituire gli asset di terze parti non ridistribuibili;
- grafica a tema (mostri e mappa sono ancora fantasy);
- progressione, livelli e punteggi (richiesti esplicitamente dal brief);
- tecnologie Cisco, per esempio missioni ispirate a Packet Tracer.
