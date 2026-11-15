# TwinCIRO 3D

**Il gemello digitale di Napoli in 3D, con gli agenti dentro.** Una mappa 3D navigabile (colline, Vesuvio, edifici) che mostra le presenze stimate nei luoghi della città **adesso** e **previste per le prossime 48 ore**, nello stile di [Seoul Real-Time City Data](https://data.seoul.go.kr/SeoulRtd/map), ma tutto in tre dimensioni. Sopra la mappa lavorano gli **agenti a regole della pagina**: rispondono in una chat a cittadini e turisti e danno alla sala operativa previsioni e scenari what-if. La voce vera di TwinCIRO è l'**assistente su WhatsApp**: questa pagina può fargli da schermo, e i [link diretti](#link-diretti) servono ad aprirla sul punto giusto.

Challenge 05 Fastweb + Vodafone, *"Napoli Agentic City: la città che Ci pensa"* (The Big Hack 2026). Idea di Mario Varlese (14/11).

> Stato: **funziona**, pagina statica senza backend e senza chiavi API. Online su GitHub Pages: https://robertodisanto.it/hackathon_2026_a/c5-presentazione/gemello-3d/
>
> È **vetrina** e per questo sta in [`c5-presentazione/`](../README.md), come la mappa 2D: le presenze sono una simulazione dichiarata e la pagina lo dice; meteo, allerte, aria, trasporti ed eventi sono veri. Come la mappa 2D, **non legge MQTT**: le misure dei due dispositivi veri (badge WHY2025 e scheda Tasmota) arrivano solo alla città Python di [`c5-agentic-city/`](../../c5-agentic-city/README.md).
>
> Sviluppata sul branch `claude/upbeat-wozniak-icckbc` (cartella `c5-twinciro-3d/`, che resta lì come copia) e portata su `master` il 15/11, adattata al riordino: moduli e snapshot da `citta-api/`, nome TwinCIRO, chat dichiarata a regole.

## Cosa si vede

| | |
|---|---|
| **Osservare** | 26 luoghi di Napoli come colonne 3D: altezza = persone stimate, colore = livello (tranquillo, normale, un po' affollato, affollato), anello = soglia del luogo scelto. Oppure la vista **Celle**: 2.512 esagoni con le presenze per cella, come nei dati aggregati delle reti mobili. Metro, funicolari e treni, grandi eventi, flussi pedonali animati. |
| **Chiedere** | **Chat con gli agenti** (a regole, nel browser): *"Sono appena arrivato al Porto: come raggiungo Fuorigrotta?"*. L'orchestratore passa la domanda a Mobilità, Folla, Eventi e Meteo; il percorso compare sulla mappa 3D e si vede chi ha detto cosa. |
| **Prevedere** | Linea del tempo da ieri a +48 ore, con riproduzione. Scheda del luogo con le barre ora per ora, il picco previsto, chi c'è (residenti, pendolari, turisti) e come nasce la stima. |
| **Simulare** | **Sala operativa**: criticità previste per luogo e per ora, indicatori a 48 ore, scenari what-if (nuovo evento, linea chiusa, pioggia forte, navi da crociera) e misure degli agenti (diversione dei flussi, ingressi scaglionati, navette). Gli indicatori dicono quanto pesa lo scenario e quanto aiutano le misure (con e senza). |

Le due domande del brief tornano con i **dati reali** (snapshot di [`citta-api/dati/`](../../citta-api/README.md) del 14/11 e fonti dal vivo), ricontrollati il 15/11:
- **domenica 15/11** il calendario del Comune ha davvero due grandi eventi: Tri Gold Caracciolo sul Lungomare (fino alle 13:00) e Viva la Strada a Parco San Laise (9:30–18:00). Li cita la domanda sugli eventi di domani con "adesso" a sabato 14/11 (`?adesso=2026-11-14T15:30`), oppure quella sugli eventi di oggi il 15/11. Dal 15/11 "domani" è un altro giorno: per lunedì 16/11 in calendario ci sono solo 3 navi da crociera in porto, e la risposta dice questo. Per questo la domanda suggerita in pagina non dice più quanti sono gli eventi;
- il percorso **Porto → Fuorigrotta** arriva dal pianificatore dal vivo, Transitous: a piedi fino a Municipio, poi Linea 6 (provato per domenica 15/11 alle 10:00). Anche il motore di riserva sul GTFS passa da Municipio e dalla Linea 6.

## Come si avvia

```bash
node c5-presentazione/gemello-3d/server.js
```

Poi apri http://localhost:8705/c5-presentazione/gemello-3d/ . Il server è solo un server di file che espone la radice della repo, come GitHub Pages, perché la pagina importa moduli e snapshot da `citta-api/`. Non serve i file e le cartelle nascosti (`.git`, `.env`) né le cartelle `segreti/`. Va bene anche `python3 -m http.server` dalla radice. Serve la rete per mappa, rilievo e fonti dal vivo.

```bash
node --test c5-presentazione/gemello-3d/test/      # dalla radice della repo
cd c5-presentazione/gemello-3d && npm test         # oppure dalla cartella
```

28 test (modello, rete, percorsi, agenti, allerte, celle), senza rete e senza dipendenze.

### Giro guidato (per il video)

Il pulsante **Giro guidato** in alto fa presentare il gemello da solo in circa un minuto e mezzo, con una didascalia per passo: osservare (colonne, scheda, celle), chiedere (percorso Porto → Fuorigrotta), prevedere (eventi di domani, linea del tempo che scorre), simulare (concerto al Plebiscito, poi la diversione dei flussi). Si ferma con Esc. Per registrarlo sempre uguale: `?giro&adesso=2026-11-14T15:30` (il giorno dopo è domenica 15/11, con i due grandi eventi).

### Link diretti

TwinCIRO su WhatsApp può rispondere con un link che apre il gemello sul punto giusto, per esempio https://robertodisanto.it/hackathon_2026_a/c5-presentazione/gemello-3d/?luogo=plebiscito

| Parametro | Esempio | Effetto |
|---|---|---|
| `luogo` | `?luogo=plebiscito` | apre la scheda di un luogo |
| `ora` | `?ora=+3` oppure `?ora=2026-11-15T11:00` | ora mostrata (ore da adesso, o data e ora di Napoli) |
| `domanda` | `?domanda=come arrivo al Maradona?` | fa la domanda alla chat della pagina all'apertura (rispondono gli agenti a regole) |
| `vista`, `scheda`, `camera` | `?vista=celle&scheda=operatore&camera=vesuvio` | celle, sala operativa, vista della camera |
| `adesso` | `?adesso=2026-11-14T15:30` | blocca "adesso": utile per registrare il video |
| `giro` | `?giro` | fa partire da solo il giro guidato |
| `rilievo=0`, `prova` | | senza rilievo (dispositivi lenti); senza animazioni (test automatici) |

## Cosa è reale e cosa è simulato

In pagina ogni dato ha la sua etichetta (`dati reali`, `simulato`, `ipotesi`, `what-if`) e il pulsante **Fonti e ipotesi** mostra lo stato di ogni fonte in quel momento. Le fonti sono lette con i moduli di [`citta-api/fonti/`](../../citta-api/README.md), gli stessi dell'API dati città e della mappa 2D, scelte nel catalogo di [oltre 50 fonti pubbliche, verificate una per una](../../docs/fonti-dati-napoli.md).

| Dato | Stato | Fonte |
|---|---|---|
| Meteo adesso e previsione oraria | reale, dal vivo | Open-Meteo (ICON-2I), riserva MET Norway |
| Allerta meteo | reale: l'avviso in vigore e quello già emesso per domani | Protezione Civile Campania, Meteoalarm |
| Qualità dell'aria | reale | Copernicus CAMS, centraline ARPAC (EEA) |
| Linee, stazioni, corse per ora | reale (orari programmati) | GTFS ANM ed EAV |
| Percorsi e prossimi passaggi | reale, dal vivo | Transitous; riserva: grafo GTFS locale |
| Eventi | reale | Comune di Napoli, Serie A (openfootball), scali delle navi |
| Stagione turistica, quota di stranieri | reale | ISTAT, arrivi mensili |
| Mappa, edifici 3D, volume edificato per cella | reale | OpenStreetMap (OpenFreeMap) |
| Rilievo | reale | Terrain Tiles su AWS |
| **Persone per luogo e per cella** | **simulazione dichiarata** | modello qui sotto |
| **Rete mobile, giorno prima** | **simulata** | nel formato dei dati aggregati degli operatori |
| Affluenza degli eventi, effetto della pioggia | ipotesi scritte | `IPOTESI` in `src/modello.js` |
| Sensori sul campo (badge WHY2025, scheda Tasmota) | non collegati a questa pagina | li legge via MQTT la città Python ([`c5-agentic-city/`](../../c5-agentic-city/README.md), formato in [`firmware/`](../../firmware/README.md)); questa pagina non legge MQTT |
| Risposte della chat | agenti a regole, nel browser | l'assistente vero è TwinCIRO su WhatsApp |

### Il modello delle presenze

```
stima = soglia del luogo × giornata tipo (feriale, sabato, festivo)     ipotesi
      × stagione turistica                                              reale (ISTAT)
      × scostamento "rete mobile, giorno prima"                         simulato (Fastweb + Vodafone)
      × meteo dell'ora                                                  reale (Open-Meteo)
      + eventi in calendario                                            reale
      ± scenario what-if                                                scelto dall'operatore
```

È la **fusione dei dati** del progetto: ogni fonte corregge la precedente, e la scheda di ogni luogo mostra quanto pesa ciascuna ("Come nasce questa stima"). Quando arriveranno i dati veri delle reti mobili e dei sensori prendono il posto delle righe simulate senza cambiare il resto. L'incertezza cresce con la distanza da adesso (±8% ora, fino a ±30%).

**Privacy by design:** solo conteggi aggregati per luogo e per cella; le celle sotto 20 presenze non si mostrano; nessun dato personale.

## Gli agenti

| Agente | Cosa fa |
|---|---|
| **Orchestratore** | capisce la domanda (italiano, anche inglese), sceglie gli agenti, compone la risposta, muove la mappa |
| Mobilità | percorso dal vivo con Transitous (bus compresi), riserva sul grafo locale; stazioni e corse |
| Folla | stima e previsione per luogo, aree critiche, flussi, alternative vicine |
| Eventi | calendario reale e scenari |
| Meteo e ambiente | meteo dell'ora, allerte (anche quella già emessa per domani), aria |
| Turismo | cosa visitare adesso senza folla (al chiuso se piove) |
| Simulatore what-if | confronta lo scenario con la situazione di partenza |

Qui gli agenti ragionano **a regole**: testo deterministico costruito sui dati, che funziona senza rete e senza chiavi. È lo stesso schema della mappa 2D ([`../mappa/`](../mappa/README.md)) e della modalità `regole` della città Python: il testo a regole è il `fallback` da passare a un LLM. Non sono gli agenti di `c5-agentic-city`, e la chat non è TwinCIRO: la voce vera resta **TwinCIRO su WhatsApp** (skill in [`c5-agentic-city/openclaw/skills/`](../../c5-agentic-city/openclaw/skills/README.md)), che può usare questo gemello come schermo. I link diretti servono a questo.

## Com'è fatto

Nessuna dipendenza npm, nessuna build: moduli ES, MapLibre GL JS 5.24.1 da cdnjs.

| File | Contenuto |
|---|---|
| `src/luoghi3d.js` | i 10 luoghi di `citta-api/fonti/luoghi.js` (gli stessi dell'API e della mappa 2D) più 16 nuovi (coordinate da OpenStreetMap) |
| `src/modello.js` | modello delle presenze, eventi, scenari, criticità, flussi (puro, provato dai test) |
| `src/griglia.js` | presenze per cella esagonale |
| `src/rete.js` | grafo della rete su ferro dallo snapshot GTFS, percorso di riserva |
| `src/percorsi.js` | Transitous dal vivo, con scarto degli itinerari non credibili |
| `src/agenti.js` | orchestratore e agenti |
| `src/mappa.js` | scena 3D: stile, rilievo, edifici, colonne, celle, linee, flussi, percorsi |
| `src/ui.js`, `src/grafici.js`, `src/app.js` | pannelli, grafici SVG, stato dell'applicazione |
| `src/dati.js` | riusa `citta-api/fonti/dati.js` (fonti live con cache e riserve, snapshot) e aggiunge la previsione oraria |
| `dati/griglia.json` | 2.512 celle con il volume edificato (da 83.833 edifici di OpenStreetMap) |
| `strumenti/genera-griglia.mjs` | rigenera la griglia (una tantum) |
| `server.js` | server di soli file per provarla in locale (porta 8705) |

I dati reali arrivano dagli snapshot di `citta-api/dati/` (li rigenera `node citta-api/aggiorna.js`) e dalle fonti dal vivo con cache e riserve dichiarate. Questa cartella non modifica niente fuori da sé: se cambiano le firme di `citta-api/fonti/*.js` o la forma degli snapshot, qui vanno rifatti i test.

## Limiti noti

- Le presenze sono simulate: i numeri servono a mostrare il metodo, non a decidere davvero. Soglie e giornate tipo sono indicative.
- La chat è fatta di agenti a regole: capisce le domande più comuni (percorsi, folla, eventi, meteo, what-if), non è un LLM e non è TwinCIRO.
- Non legge MQTT: le misure vere del badge WHY2025 e della scheda Tasmota arrivano solo alla città Python.
- I flussi pedonali sono uno schema (stazione o porto più vicino), non un modello di spostamento.
- Il percorso di riserva conosce solo metro, funicolari, treni e l'Alibus (tracciato e frequenza indicativi).
- Transitous è un servizio comunitario per progetti non commerciali, e a volte restituisce corse impossibili: vengono scartate.
- Dalla sandbox di sviluppo Open-Meteo risponde spesso 429: in quel caso entra la riserva MET Norway, che può dare una pioggia diversa.
- Sul telefono funziona, ma è pensato per uno schermo grande.

## Altri pezzi di TwinCIRO

- [`c5-agentic-city/`](../../c5-agentic-city/README.md): la città agentica (agenti e orchestratore sul bus MQTT, assistenti personali, API per TwinCIRO su WhatsApp, gemello della regata) e le skill di TwinCIRO in `openclaw/skills/`.
- [`c5-agentic-city/visore3d/`](../../c5-agentic-city/visore3d/): la regata dell'America's Cup in 3D, da ruotare nel browser.
- [`../mappa/`](../mappa/README.md): la mappa 2D "Napoli in tempo reale", con gli stessi moduli di `citta-api/`.
- [`../../citta-api/`](../../citta-api/README.md): l'API dati città, il cervello dati di TwinCIRO, da cui arrivano luoghi, fonti e snapshot.
- [`../../firmware/`](../../firmware/README.md): i due dispositivi veri, il badge WHY2025 e la scheda Tasmota, e il formato MQTT `napoli/...`.
- [`../`](../README.md): il video di consegna, la mappa e il grafo della città.
