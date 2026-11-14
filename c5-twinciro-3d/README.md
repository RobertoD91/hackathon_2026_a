# TwinCiro 3D

**Il gemello digitale di Napoli in 3D, con gli agenti dentro.** Una mappa 3D navigabile (colline, Vesuvio, edifici) che mostra le presenze stimate nei luoghi della città **adesso** e **previste per le prossime 48 ore**, nello stile di [Seoul Real-Time City Data](https://data.seoul.go.kr/SeoulRtd/map), ma tutto in tre dimensioni. Sopra la mappa lavorano gli agenti di TwinCiro: rispondono a cittadini e turisti (CiroGPT) e danno alla sala operativa previsioni e scenari what-if.

Challenge 05 Fastweb + Vodafone, *"Napoli Agentic City: la città che Ci pensa"* (The Big Hack 2026).

> Stato: **funziona**, pagina statica senza backend e senza chiavi API. Sviluppato sul branch `claude/upbeat-wozniak-icckbc`: sarà online su GitHub Pages (`/c5-twinciro-3d/`) quando il branch entra in `master`.

## Cosa si vede

| | |
|---|---|
| **Osservare** | 26 luoghi di Napoli come colonne 3D: altezza = persone stimate, colore = livello (tranquillo, normale, un po' affollato, affollato), anello = soglia del luogo scelto. Oppure la vista **Celle**: 2.512 esagoni con le presenze per cella, come nei dati aggregati delle reti mobili. Metro, funicolari e treni, grandi eventi, flussi pedonali animati. |
| **Chiedere** | **CiroGPT** in chat: *"Sono appena arrivato al Porto: come raggiungo Fuorigrotta?"*. L'orchestratore passa la domanda a Mobilità, Folla, Eventi e Meteo; il percorso compare sulla mappa 3D e si vede chi ha detto cosa. |
| **Prevedere** | Linea del tempo da ieri a +48 ore, con riproduzione. Scheda del luogo con le barre ora per ora, il picco previsto, chi c'è (residenti, pendolari, turisti) e come nasce la stima. |
| **Simulare** | **Sala operativa**: criticità previste per luogo e per ora, indicatori a 48 ore, scenari what-if (nuovo evento, linea chiusa, pioggia forte, navi da crociera) e misure degli agenti (diversione dei flussi, ingressi scaglionati, navette). Gli indicatori dicono quanto pesa lo scenario e quanto aiutano le misure (con e senza). |

Le due domande del brief funzionano sui **dati reali di questi giorni**: per domenica 15/11 il calendario del Comune ha davvero due grandi eventi (Tri Gold Caracciolo sul Lungomare e Viva la Strada a Parco San Laise), e il percorso Porto → Fuorigrotta arriva dal pianificatore dal vivo (a piedi fino a Municipio, poi Linea 6).

## Come si avvia

```bash
node c5-twinciro-3d/server.js
```

Poi apri http://localhost:8705/c5-twinciro-3d/ . Il server è solo un server di file che espone la root della repo (la pagina importa moduli e dati da `shared/iot-agents/example/`); va bene anche `python3 -m http.server` dalla root. Serve la rete per mappa, rilievo e fonti dal vivo.

```bash
cd c5-twinciro-3d && npm test
```

27 test (modello, rete, percorsi, agenti, celle), senza rete e senza dipendenze.

### Giro guidato (per il video)

Il pulsante **Giro guidato** in alto fa presentare il gemello da solo in circa un minuto e mezzo, con una didascalia per passo: osservare (colonne, scheda, celle), chiedere (percorso Porto → Fuorigrotta), prevedere (eventi di domani, linea del tempo che scorre), simulare (concerto al Plebiscito, poi la diversione dei flussi). Si ferma con Esc. Per registrarlo sempre uguale: `?giro&adesso=2026-11-14T15:30`.

### Link diretti

CiroGPT su WhatsApp può rispondere con un link che apre il gemello sul punto giusto:

| Parametro | Esempio | Effetto |
|---|---|---|
| `luogo` | `?luogo=plebiscito` | apre la scheda di un luogo |
| `ora` | `?ora=+3` oppure `?ora=2026-11-15T11:00` | ora mostrata (ore da adesso, o data e ora di Napoli) |
| `domanda` | `?domanda=come arrivo al Maradona?` | fa la domanda a CiroGPT all'apertura |
| `vista`, `scheda`, `camera` | `?vista=celle&scheda=operatore&camera=vesuvio` | celle, sala operativa, vista della camera |
| `adesso` | `?adesso=2026-11-14T15:30` | blocca "adesso": utile per registrare il video |
| `giro` | `?giro` | fa partire da solo il giro guidato |
| `rilievo=0`, `prova` | | senza rilievo (dispositivi lenti); senza animazioni (test automatici) |

## Cosa è reale e cosa è simulato

In pagina ogni dato ha la sua etichetta (`dati reali`, `simulato`, `ipotesi`, `what-if`) e il pulsante **Fonti e ipotesi** mostra lo stato di ogni fonte in quel momento.

| Dato | Stato | Fonte |
|---|---|---|
| Meteo adesso e previsione oraria | reale, dal vivo | Open-Meteo (ICON-2I), riserva MET Norway |
| Allerta meteo | reale | Protezione Civile Campania, Meteoalarm |
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
| Sensori IoT, telecamere, sensori acustici | predisposti | nodi ESP32 di TwinCiro |

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
| Meteo e ambiente | meteo dell'ora, allerte, aria |
| Turismo | cosa visitare adesso senza folla (al chiuso se piove) |
| Simulatore what-if | confronta lo scenario con la situazione di partenza |

Qui gli agenti ragionano **a regole**: testo deterministico costruito sui dati, che funziona senza rete e senza chiavi. È lo schema del resto della repo (`shared/iot-agents`): il testo a regole è il `fallback` da passare a un LLM. La voce vera resta **CiroGPT** su WhatsApp (`c5-agentic-city/openclaw/`), che può usare questo gemello come schermo: i link diretti servono a questo.

## Com'è fatto

Nessuna dipendenza npm, nessuna build: moduli ES, MapLibre GL JS 5.24.1 da cdnjs.

| File | Contenuto |
|---|---|
| `src/luoghi3d.js` | i 10 luoghi della mappa 2D più 16 nuovi (coordinate da OpenStreetMap) |
| `src/modello.js` | modello delle presenze, eventi, scenari, criticità, flussi (puro, provato dai test) |
| `src/griglia.js` | presenze per cella esagonale |
| `src/rete.js` | grafo della rete su ferro dallo snapshot GTFS, percorso di riserva |
| `src/percorsi.js` | Transitous dal vivo, con scarto degli itinerari non credibili |
| `src/agenti.js` | orchestratore e agenti |
| `src/mappa.js` | scena 3D: stile, rilievo, edifici, colonne, celle, linee, flussi, percorsi |
| `src/ui.js`, `src/grafici.js`, `src/app.js` | pannelli, grafici SVG, stato dell'applicazione |
| `src/dati.js` | riusa `shared/iot-agents/example/fonti/` e aggiunge la previsione oraria |
| `dati/griglia.json` | 2.512 celle con il volume edificato (da 83.833 edifici di OpenStreetMap) |
| `strumenti/genera-griglia.mjs` | rigenera la griglia (una tantum) |

I dati reali arrivano dagli snapshot di `shared/iot-agents/example/dati/` (li rigenera `shared/iot-agents/tools/aggiorna-dati-napoli.js`) e dalle fonti dal vivo con cache e riserve dichiarate. Questa cartella non modifica niente fuori da sé.

## Limiti noti

- Le presenze sono simulate: i numeri servono a mostrare il metodo, non a decidere davvero. Soglie e giornate tipo sono indicative.
- I flussi pedonali sono uno schema (stazione o porto più vicino), non un modello di spostamento.
- Il percorso di riserva conosce solo metro, funicolari, treni e l'Alibus (tracciato e frequenza indicativi).
- Transitous è un servizio comunitario per progetti non commerciali, e a volte restituisce corse impossibili: vengono scartate.
- Dalla sandbox di sviluppo Open-Meteo risponde spesso 429: in quel caso entra la riserva MET Norway, che può dare una pioggia diversa.
- Sul telefono funziona, ma è pensato per uno schermo grande.

## Altri pezzi di TwinCiro

- [`c5-agentic-city/`](../c5-agentic-city/README.md): agenti della città, CiroGPT, nodi ESP32, gemello SUMO del traffico.
- [`c5-agentic-city/visore3d/`](../c5-agentic-city/visore3d/): la regata dell'America's Cup in 3D, da ruotare nel browser.
- [`shared/iot-agents/example/`](../shared/iot-agents/example/): la mappa 2D "Napoli in tempo reale", da cui arrivano luoghi e fonti.
