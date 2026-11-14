# C5 — Napoli Agentic City

Challenge 05 di The Big Hack 2026, promossa da **Fastweb + Vodafone**: *"Napoli Agentic City: la città che Ci pensa"*.

> **In una frase:** un ecosistema di agenti AI che **negoziano tra loro**. Ci sono gli agenti della città, gli agenti personali di cittadini e turisti, e gli agenti delle imprese. Hanno un sistema nervoso fisico (semafori ESP32 su un plastico, sensori, droni) e un **gemello digitale sulle strade vere di Napoli** che misura quanto si guadagna rispetto a una città senza agenti.

## Feedback dei partner e consegna (14/11)

Incontro con Fastweb e Vodafone:

| Parte | Giudizio |
|---|---|
| IoT (ESP32, sensori, plastico) | piaciuta |
| **CiroGPT** (agente OpenClaw su WhatsApp con la skill di `openclaw/`) | **la più apprezzata**: va messa al centro |
| Gemello digitale | piaciuto, ma meno di CiroGPT |
| Traffico e semafori | **non piaciuto**: da ridimensionare |
| Video 3D della regata (`media/regata_3d.mp4`) | piaciuto |

**Consegna:** un **video di massimo 3 minuti**. La live demo è facoltativa: c'è un gruppo WhatsApp con CiroGPT dentro.

## Il brief (in sintesi)

- Un **sistema di agenti AI che collaborano**: ognuno segue un servizio o un problema (mobilità, turismo, servizi pubblici, ambiente) e un **agente orchestratore** li coordina, mette insieme le informazioni e propone risposte anche quando la situazione cambia.
- **Problema e target li scegliamo noi.**
- Bonus: agenti come **assistenti personali** che suggeriscono, anticipano esigenze e facilitano prenotazioni e acquisti, con nuove opportunità per le imprese del territorio.
- **Dati**: open data di Comune e Regione, trasporto pubblico, ISTAT, mappe, meteo. Dove mancano si usano **simulazioni realistiche spiegando le ipotesi**.
- **Consegna**: prototipo o demo in cui **si vede come gli agenti si coordinano e reagiscono ai cambiamenti**.
- **Per vincere**: visione, originalità e concretezza, con **benefici misurabili** (meno attese, meno congestione, decisioni più rapide, nuovi servizi). Spiegare perché Napoli dovrebbe adottarla.
- Premio: 2.500 € in buoni Amazon al primo team.

Testo integrale in [`../docs/hackathon.md`](../docs/hackathon.md).

## Scenario: "Napoli 2027, giornata di festa"

Napoli ospita l'**America's Cup nel 2027**. Raccontiamo un sabato di festa, **senza guasti né emergenze**. L'unico "problema" è far stare bene tutti:

| Ora | Cosa succede | Chi si muove |
|---|---|---|
| 09:30 – 11:00 | Due navi da crociera alla Stazione Marittima | ~6.000 croceristi verso centro, lungomare, Castel dell'Ovo |
| 14:00 – 17:30 | Regata dell'America's Cup davanti a via Caracciolo, village a Rotonda Diaz | Folla e traffico verso Mergellina e la Riviera |
| 17:30 – 19:00 | Fine regata, deflusso | Lungomare → Beverello, metro, funicolari |
| 19:00 – 20:45 | Partita al Maradona (Fuorigrotta) | Traffico verso ovest da Mergellina e Viale Gramsci |

**Target:** il turista (croceristi, visitatori della regata), il cittadino (deve muoversi nonostante l'evento) e l'operatore della sala operativa comunale (vede e approva le decisioni degli agenti).

## Architettura

```
            SENSI (ESP32)                      OCCHI (drone)            ATTUATORI (ESP32)
  conteggio auto/persone, pulsanti,     pilota umano + frame  ──┐     semafori del plastico,
  meteo locale, (modulo 5G)                al modello visione   │     pannelli alle fermate
        │                                                       │             ▲
        ▼                                                       ▼             │
 ═══════════════════════════  BUS MQTT  napoli/#  ═══════════════════════════════════
        │          │            │            │            │            │          │
   Agente      Agente       Agente       Agente       Agente       Agenti     Gemello
   Meteo&Mare  Eventi       Folla        Traffico     Turismo      Imprese    digitale
   (Open-Meteo)(calendario) (sensori,    (piani       (luoghi,     (pizzeria, (SUMO sulle
                             celle,       semafori,    visitatori,  bar, gozzi, strade OSM:
                             drone)       onde verdi)  offerte)     museo)      con vs senza
        │          │            │            │            │            │       agenti)
        └──────────┴────────────┴─────┬──────┴────────────┴────────────┘
                                      ▼
                              ORCHESTRATORE  ── decisioni motivate ──► Sala operativa
                                      ▲                                (console, operatore
                                      │ richieste / risposte            approva o blocca)
                          Agenti personali (cittadini, turisti)
                          WhatsApp via OpenClaw  ·  chat da terminale
```

### I tre lati che negoziano

1. **Agenti della città**: Meteo&Mare, Eventi, Folla, Traffico, Turismo, più l'**Orchestratore**. Ognuno pubblica sul bus ciò che sa e ascolta ciò che gli serve.
2. **Agenti personali** di cittadini e turisti. L'utente scrive su WhatsApp (OpenClaw, già funzionante nel team) o da terminale. Il suo agente **negozia con la città**: chiede un percorso, l'orchestratore risponde tenendo conto di traffico, folla ed eventi. Poi negozia con le imprese (prenotazione, controproposta).
3. **Agenti delle imprese**: pubblicano disponibilità e offerte. Quando un posto è pieno fanno una **controproposta**, per esempio *"alle 13:00 siamo pieni, alle 14:15 c'è posto e 10% di sconto"*. L'agente Turismo li usa per spostare la folla, e le imprese riempiono le ore morte.

### Sistema nervoso in due livelli

- **Riflessi (ESP32):** ogni semaforo del plastico ha un ciclo locale. Se non riceve piani dal bus per qualche secondo continua da solo, e i semafori vicini si coordinano in **ESP-NOW** senza rete. *Se cade internet la città non si ferma, perde solo la strategia.*
- **Cervello (LLM):** gli agenti ragionano **solo quando succede qualcosa** (arriva una nave, inizia la regata, cambia il vento, un cittadino chiede). Il ciclo veloce dei semafori è codice normale, quindi poche chiamate al modello.

### Gemello digitale (i numeri per la giuria)

- **SUMO** (simulatore di traffico open source) sulla **rete stradale vera** del lungomare, da Mergellina a Piazza Municipio, presa da OpenStreetMap: 494 strade, 8 incroci semaforizzati.
- La **stessa giornata gira due volte in parallelo**, con la stessa domanda di traffico. Da una parte i semafori fissi di oggi, dall'altra i semafori guidati dagli agenti.
- KPI in diretta: tempo perso in coda, durata media dei viaggi, veicoli fermi, CO₂.
- I semafori del plastico **rispecchiano 4 incroci veri** del gemello:
  - Viale Gramsci / via Campanella (Mergellina);
  - Riviera di Chiaia / via San Pasquale;
  - Riviera di Chiaia / via Santa Maria in Portico;
  - Galleria della Vittoria / via Acton (verso il Beverello).

### Il drone

È un **tool dell'orchestratore con umano nel loop**. L'orchestratore chiede *"verifica affluenza a Mergellina"*. La richiesta arriva al pilota (DJI Mini 4 o i droni iNav/Betaflight), che vola. Un frame del video va a `strumenti/drone_osserva.py`: il modello di visione conta le persone e il dato torna sul bus all'agente Folla. Se il volo al chiuso non è permesso si usa un video registrato prima.

### Canali verso le persone

- **Sala operativa:** console a schermo intero nel terminale (`sala.py`), niente webapp. Mostra:
  - i messaggi tra agenti ("chi dice cosa a chi");
  - lo stato dei semafori;
  - la folla per zona;
  - i KPI con e senza agenti.

  L'operatore può approvare o bloccare le decisioni.
- **Cittadini e turisti:** WhatsApp tramite una **skill OpenClaw** che chiama l'API HTTP della città (`/chiedi`). In alternativa `strumenti/chat.py` da terminale.
- **La giuria dentro la demo:** un QR sul plastico apre la chat. *"Sei un crocerista sbarcato alle 10, hai 6 ore."*

## Topic MQTT (contratto tra agenti, firmware e strumenti)

Tutti i messaggi sono JSON. Il prefisso è `napoli/`.

| Topic | Chi pubblica | Contenuto |
|---|---|---|
| `napoli/orologio` | avvio | ora simulata `{"ora": "14:05", "t": 50700}` |
| `napoli/meteo` | Meteo&Mare | vento, raffiche, onde, temperatura, `regata_ok` |
| `napoli/eventi/previsioni` | Eventi | flussi attesi per zona e fascia oraria |
| `napoli/eventi/manuale` | pulsanti ESP32 | `{"evento": "nave_arrivata"}` e simili |
| `napoli/sensori/<nodo>/<grandezza>` | ESP32 | `{"valore": 12}` (conteggi, temperatura, ...) |
| `napoli/folla/<zona>` | Folla | `{"persone": 4200, "livello": "alto", "fonte": [...]}` |
| `napoli/drone/richieste` | Orchestratore | `{"zona": "mergellina", "motivo": "..."}` |
| `napoli/drone/osservazioni` | strumento drone | `{"zona": ..., "persone_stimate": ..., "foto": ...}` |
| `napoli/semafori/piano` | Traffico | pesi per corridoio e onde verdi |
| `napoli/semafori/<incrocio>/stato` | gemello | `{"fase": "verde"|"giallo"|"rosso", "direzione": "ns"|"eo"}` → letto dagli ESP32 |
| `napoli/kpi` | gemello | KPI con e senza agenti |
| `napoli/imprese/offerte` | Imprese | disponibilità e offerte |
| `napoli/imprese/<id>/richieste` · `.../risposte` | assistenti ↔ imprese | prenotazioni e controproposte |
| `napoli/agenti/dialogo` | tutti gli agenti | messaggi agente→agente leggibili `{"da", "a", "testo"}` (per la sala) |
| `napoli/orchestratore/decisioni` | Orchestratore | decisione + motivazione + azioni |
| `napoli/operatore/comandi` | Sala operativa | approva / blocca |

## Struttura della cartella

```
c5-agentic-city/
  avvia.py                  # avvia città, agenti e gemello (bus in memoria o MQTT)
  citta/
    bus.py                  # bus in memoria o MQTT, stessa interfaccia
    llm/                    # provider intercambiabili: claude.py, codex.py (+ regole senza LLM)
    agenti/                 # meteo, eventi, folla, traffico, turismo, imprese, orchestratore, assistente
    gemello/                # SUMO: domanda di traffico, controllo semafori, KPI
    api.py                  # HTTP per la skill OpenClaw (/chiedi, /stato)
    sala.py                 # console della sala operativa
  dati/                     # scenario, luoghi, imprese, rete stradale SUMO
  strumenti/                # chat.py, drone_osserva.py, confronto.py (KPI senza GUI)
  firmware/                 # sketch ESP32: semaforo (MQTT + ESP-NOW), sensore
  openclaw/                 # skill per collegare l'assistente WhatsApp
```

È tutto in questa cartella. Il bus e il firmware sono scritti per poter essere spostati in `shared/` se servono anche a C2.

## LLM

- I provider sono intercambiabili e si scelgono con `--llm`:
  - `claude`: SDK Anthropic, legge `ANTHROPIC_API_KEY`;
  - `codex`: CLI `codex exec` con l'abbonamento ChatGPT;
  - `regole`: nessun LLM, decisioni a regole. Serve per provare tutto senza chiavi e come piano B in demo.
- Gli agenti chiedono all'LLM **JSON strutturato**: decisione + motivazione leggibile. La motivazione è quella mostrata in sala.

## Fonti dati

**Usate davvero nel codice:**
- **OpenStreetMap**: rete stradale del gemello (`dati/lungomare.net.xml`, generata con `netconvert` da un estratto dell'API OSM).
- **Open-Meteo**: vento, raffiche, onda e temperatura per l'agente Meteo&Mare, con `--meteo reale`. In modalità `scenario` si usano valori fissi, così la demo è stabile.

**Trovate e raggiungibili, da integrare se c'è tempo:**
- Open data del Comune di Napoli (dati.comune.napoli.it):
  - visitatori di Castel dell'Ovo, Maschio Angioino, PAN, Pausilypon e altri;
  - parcheggi ANM 2025;
  - incidenti stradali.
- EAV (Cumana, Circumflegrea) su dati.gov.it: linee, corse, stazioni.
- ISTAT ed Eurostat (presenze turistiche), OpenSky (voli su Capodichino).

**Simulati, con le ipotesi dichiarate in `dati/scenario_regata.json` (campo `ipotesi`):**
- orari e passeggeri delle navi;
- presenze da rete mobile (il tipo di dato degli sponsor);
- flussi della regata e della partita;
- traffico di fondo;
- disponibilità delle imprese, che sono di fantasia.

## Risultati del gemello

Giornata 13:00–20:30, circa 10.000 veicoli, identici nelle due simulazioni, sulla rete vera del lungomare. Per non fidarci di un'estrazione fortunata, **ripetiamo tutto con 4 semi diversi della domanda di traffico** (42, 7, 99, 2027). Ogni seme genera orari e percorsi diversi degli stessi flussi.

Ore perse in coda rispetto ai semafori fissi di oggi (negativo = meglio):

| Controllo | seme 42 | seme 7 | seme 99 | seme 2027 | **media** |
|---|---|---|---|---|---|
| Piano degli agenti prima della taratura | −13,6% | +2,0% | −7,3% | −5,1% | **−6,0%** |
| Adattivo neutro (nessuna priorità) | −15,1% | −4,1% | −8,3% | −4,2% | **−7,9%** |
| **Agenti, tarato** | −18,4% | −1,4% | −9,4% | −6,6% | **−9,0%** |

Con il controllo tarato, in media sui 4 semi: **−9% di ore perse in coda, −4% di durata media del viaggio, −3,5% di CO₂**.

Cosa dire in giuria, onestamente:
- **il guadagno dipende molto dalla giornata**: da −1% a −18% secondo il seme. Il "−15%" che avevamo prima veniva da un solo seme favorevole;
- il controllo è volutamente semplice (verde esteso dove c'è coda, cambio fase quando l'altra direzione aspetta di più). Con dati veri di flusso e un controllo più evoluto il margine cresce, ma serve un pilota su strada per misurarlo davvero.

### Taratura

`strumenti/taratura.py` rigioca i piani registrati dell'agente Traffico (`dati/piani_registrati.json`) su una sola simulazione per variante, in parallelo, e confronta con i semafori fissi. Due giri sul seme 42, poi la verifica sui 4 semi:

| Variante (seme 42) | Ore perse | Durata | CO₂ |
|---|---|---|---|
| Pesi pieni, verde max 75 s (prima) | −13,6% | −5,0% | −4,4% |
| Pesi a metà, verde max 60 s | −16,6% | −7,5% | −5,6% |
| Pesi a metà, verde max 50 s / 70 s | −10,6% / −10,5% | | |
| Pesi ×0,4 / ×0,6 | −9,4% / −16,0% | | |
| **Pesi a metà, verde max 60 s, soglia 1,2** | **−18,4%** | **−8,1%** | **−5,7%** |

Scelte applicate:
- in `citta/gemello/gemello.py`: `FORZA_PESI = 0.5` (peso effettivo = 1 + 0,5 × (peso − 1)), `SOGLIA_CAMBIO = 1.2`, verde massimo limitato a 60 s;
- l'agente Traffico ora propone verdi massimi tra 40 e 60 s.

Il motivo:
- con pesi pieni la priorità al corridoio scelto allunga le code sulle traverse;
- verdi più lunghi di 60 s svuotano una direzione ma ne riempiono un'altra.

Si vede anche che i risultati sono "nervosi" (×0,4 dà −9%, ×0,5 dà −17%): un segnale in più per guardare la media sui semi e non il singolo numero.

### Consigli di percorso non coordinati

Abbiamo provato a dare consigli di percorso "ingenui" al 20% dei guidatori (`--quota-assistiti 0.2`, seme 42). Le ore perse sono calate solo del **10,5%**, contro il 15,1% del controllo neutro senza consigli, perché le auto deviate intasano i vicoli del centro. **I consigli non coordinati spostano il problema: per questo serve un orchestratore.**

### Screenshot

`strumenti/screenshot_sumo.py` affianca "oggi" e "con agenti" alla stessa ora. I veicoli sono colorati per velocità: rosso = fermo, arancione = lento, bianco = scorre. Le immagini sono in `media/`. Su un server senza schermo si usa `xvfb-run`.

## Come si avvia

```bash
cd c5-agentic-city
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
```

```bash
python avvia.py --llm regole              # tutto in un processo, senza chiavi, sala a schermo intero
```

| Opzione | Cosa fa |
|---|---|
| `--llm claude` / `codex` / `regole` | provider degli agenti. `auto` (default) usa Claude se c'è `ANTHROPIC_API_KEY`, altrimenti Codex se c'è la CLI, altrimenti le regole |
| `--velocita 20` | secondi simulati per secondo reale. Con 20, la giornata di 7,5 ore dura circa 22 minuti; con 0 va al massimo |
| `--inizio 13:45 --fine 15:30` | finestra della demo |
| `--broker localhost` | bus MQTT (serve Mosquitto) per gli ESP32 del plastico |
| `--gui` | apre `sumo-gui` sulla simulazione con agenti, da mettere sul secondo schermo |
| `--approvazione` | le decisioni dell'orchestratore aspettano l'operatore (`strumenti/operatore.py approva D3`) |
| `--meteo reale` | dati di oggi da Open-Meteo |
| `--senza-sala` | stampa il dialogo tra agenti a righe |
| `--api-porta 8080` | API per OpenClaw, la chat e il drone (0 = spenta) |

Variabili per l'LLM:
- Claude: `ANTHROPIC_API_KEY`, `C5_MODELLO` (default `claude-opus-5-5`), `C5_EFFORT` (default `low`).
- Codex: `C5_CODEX_ARGS`.

Altri strumenti, mentre `avvia.py` è acceso:

```bash
python strumenti/chat.py --utente Marta                     # chat con l'assistente personale
```

```bash
python strumenti/drone_osserva.py ascolta                   # il pilota riceve le richieste di volo
```

```bash
python strumenti/drone_osserva.py foto --zona castel_ovo --file frame.jpg --scala 100
```

```bash
python strumenti/operatore.py evento pullman --veicoli 25   # come il pulsante sul plastico
```

```bash
python -m citta.sala --broker localhost                     # sala su un altro PC (con MQTT)
```

## Con Docker

```bash
cd c5-agentic-city
docker compose up -d                 # broker Mosquitto (:1883) + città: agenti, gemello SUMO, API (:8080)
```

```bash
docker compose run --rm sala         # sala operativa a schermo intero nel terminale
```

```bash
docker compose logs -f citta         # dialogo tra agenti a righe
```

- **Chiavi e opzioni** si prendono dall'ambiente della macchina, mai scritte nei file: `ANTHROPIC_API_KEY`, `C5_LLM`, `C5_MODELLO`, `C5_API_TOKEN`, `C5_VELOCITA` (default 20), `C5_INIZIO` (default 13:00), `C5_METEO`.
- **Gli ESP32** si collegano al broker sulla porta 1883 del portatile.
- **Fine giornata**: alla fine della giornata simulata il servizio `citta` riparte da capo (`restart: unless-stopped`).
- **Cosa resta fuori**:
  - `sumo-gui` (`--gui`) gira solo fuori da Docker, sul portatile con lo schermo;
  - Codex (`--llm codex`) richiede la CLI installata.

Provato: costruzione dell'immagine, città + Mosquitto su MQTT, API (`/stato`, `/chiedi` con negoziazione con la pizzeria), sala in container.

## Video della simulazione

`media/demo_gemello.mp4` (1920×1080, circa un minuto): la giornata 13:00–20:30 con a sinistra i semafori di oggi e a destra quelli guidati dagli agenti, stessi veicoli. Il fotogramma mostra:
- orologio ed evento in corso;
- piano dei semafori;
- KPI cumulati;
- dialogo tra gli agenti.

Il pilota del drone è simulato: risponde dopo 3 minuti con la stima ±10%, ed è scritto nel video.

Per rifarlo, anche solo per una finestra:

```bash
xvfb-run -a -s "-screen 0 1920x1080x24" python strumenti/video_demo.py
```

```bash
xvfb-run -a -s "-screen 0 1920x1080x24" python strumenti/video_demo.py --inizio 13:45 --fine 15:30 --uscita media/regata.mp4
```

Sul portatile con lo schermo basta `python strumenti/video_demo.py`, senza `xvfb-run`.

### Video 3D della regata

`media/regata_3d.mp4`: la finestra della regata (13:35–14:50) vista dall'alto in 3D, a 1 minuto simulato per secondo di video.
- La camera arriva da lontano, ruota lentamente attorno al lungomare e alla fine si allarga.
- **Città notturna**: edifici estrusi da OpenStreetMap (altezze stimate dove mancano), mare dalla linea di costa.
- **Traffico**: i veicoli della simulazione "con agenti" (azzurro = scorre, arancione = lento, rosso = fermo).
- **Folla**: colonne per zona, alte quanto le persone stimate dall'agente Folla e colorate per livello.
- **Mare**: barche degli spettatori e due AC75 sul campo di regata (percorso ipotizzato).
- **Riquadri**:
  - veicoli fermi e ore perse in coda nella finestra, oggi contro agenti;
  - dialogo tra gli agenti;
  - evento in corso e piano dei semafori.
- Il pilota del drone è simulato.

```bash
strumenti/video3d/fai_video.sh 13:35 14:50 media/regata_3d.mp4
```

Servono Node con Playwright e Chromium. Lo script scarica da solo l'estratto OSM e deck.gl. Senza GPU va a circa un fotogramma al secondo, cioè 40 minuti per la regata.

## La demo (4 minuti)

1. **Il gancio** (30 s): *"Napoli 2027, America's Cup. Un sabato con due navi, la regata e la partita. Oggi ogni servizio fa da sé: noi li facciamo parlare."*
2. **La sala** (60 s): `avvia.py --inizio 13:40 --velocita 15`.
   - Eventi annuncia la regata, Traffico dà priorità al lungomare e i semafori del plastico cambiano.
   - Folla vede Castel dell'Ovo che si riempie e l'orchestratore chiede il drone.
3. **Il drone** (45 s): il pilota fa un volo sul plastico e manda il frame. Il modello conta, la stima si aggiorna e l'orchestratore sposta la folla con un'offerta della friggitoria o del bar al Vomero.
4. **La giuria gioca** (60 s): il QR apre WhatsApp. *"Siamo 4 croceristi, vogliamo una pizza vicino al Castel dell'Ovo alle 13:30."*
   - L'assistente negozia con la pizzeria: "pieni, alle 14:00 sì".
   - Il giurato risponde "ok" e la prenotazione è confermata.
5. **I numeri** (30 s): il pannello KPI con e senza agenti, poi la scoperta sui consigli non coordinati.
6. **Il riflesso** (15 s): si stacca il portatile. I semafori del plastico passano al ciclo locale coordinato in ESP-NOW: *"se cade la rete la città non si ferma"*.

## Stato

- [x] Brief, scenario e architettura
- [x] Rete stradale SUMO del lungomare da OSM
- [x] Bus (memoria e MQTT), agenti, orchestratore con ripiego a regole
- [x] Gemello SUMO con KPI con e senza agenti
- [x] Assistenti personali con negoziazione con le imprese, API HTTP, skill OpenClaw
- [x] Sala operativa in console
- [x] Strumento drone (stima manuale o conteggio da foto con Claude)
- [x] Firmware ESP32 (semaforo con riflessi ESP-NOW, sensore di passaggio): compila, da provare su hardware

Da fare:
- [x] Taratura dei pesi dei corridoi (verificata su 4 semi).
- [ ] Controllo semaforico più evoluto (oggi semplice: estende il verde dove c'è coda).
- [ ] Provare con un LLM vero: Claude (chiave del team) e Codex (verificare i flag di `codex exec`).
- [ ] Provare il firmware su hardware e la skill su OpenClaw.
- [ ] Costruire il plastico.
- [ ] Integrare i dati del Comune.
- [ ] Preparare il video di riserva del drone.
- [x] Video della simulazione (`media/demo_gemello.mp4`) e immagine Docker con compose.
