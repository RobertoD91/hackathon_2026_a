# C5 — Napoli Agentic City

Challenge 05 di The Big Hack 2026, promossa da **Fastweb + Vodafone**: *"Napoli Agentic City: la città che Ci pensa"*.

> **In una frase:** un ecosistema di agenti AI che **negoziano tra loro**. Ci sono gli agenti della città, gli agenti personali di cittadini e turisti, e gli agenti delle imprese. Hanno un sistema nervoso fisico (semafori ESP32 su un plastico, sensori, droni) e un **gemello digitale sulle strade vere di Napoli** che misura quanto si guadagna rispetto a una città senza agenti.

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

**Reali:**
- **Open-Meteo** (meteo, mare, qualità dell'aria) per l'agente Meteo&Mare.
- **OpenStreetMap** per la rete stradale del gemello.
- **Comune di Napoli open data**:
  - visitatori di Castel dell'Ovo, Maschio Angioino, PAN e altri, usati per la domanda turistica di base;
  - parcheggi ANM.
- **EAV** (Cumana, Circumflegrea) da dati.gov.it.

**Simulati, con le ipotesi dichiarate in `dati/scenario_regata.json`:**
- orari e passeggeri delle navi;
- presenze da rete mobile (il tipo di dato degli sponsor);
- flussi della regata e della partita;
- disponibilità delle imprese.

## Come si avvia

Da completare man mano che arrivano i pezzi.

```bash
cd c5-agentic-city
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
python avvia.py --llm regole            # tutto in un processo, senza chiavi
```

## Stato

- [x] Brief, scenario e architettura
- [x] Rete stradale SUMO del lungomare da OSM
- [ ] Bus, agenti, orchestratore
- [ ] Gemello SUMO con KPI con e senza agenti
- [ ] Assistente personale + API per OpenClaw
- [ ] Sala operativa
- [ ] Firmware ESP32 (semaforo, sensore)
- [ ] Strumento drone
