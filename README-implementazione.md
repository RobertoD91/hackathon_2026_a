# TwinCIRO: cosa funziona oggi e cosa verrà

Questo documento dice in modo onesto a che punto è **TwinCIRO** al momento della consegna (The Big Hack 2026, challenge 05 Fastweb + Vodafone, 15 novembre 2026). Spiega cosa è davvero implementato e cosa è simulato, e indica gli sviluppi previsti.

## Cos'è TwinCIRO

TwinCIRO è una piattaforma di Urban Intelligence che unisce un **Digital Twin** della città di Napoli a un'architettura **multi-agente**. Agenti AI specializzati collaborano sotto il coordinamento di un agente orchestratore. Mettono in relazione dati di trasporti, meteo, ambiente, eventi e sensori IoT, e danno risposte contestualizzate a chi vive, visita e governa la città.

Gli utenti hanno due livelli di interazione:

- **TwinCIRO su WhatsApp**, per cittadini e turisti: un chatbot che orchestra gli agenti e le API della città;
- **TwinCIRO 3D**, per gli operatori (per esempio la Polizia Locale): un'applicazione web con il gemello digitale 3D della città, la previsione dei flussi e l'analisi what-if.

Domande tipo:

- *«Sono appena sbarcato al porto di Napoli: come posso raggiungere Fuorigrotta?»*
- *«Domani sono previsti due grandi eventi in città: come evolveranno i flussi di persone e quali saranno le aree più critiche?»*

## Cosa è realmente implementato e cosa al momento è simulato

Regola del progetto: **nessun dato inventato senza dichiararlo.** Ogni risposta e ogni pagina indicano se un dato è reale (con fonte e ora) oppure simulato.

### In sintesi

| Componente | Stato | Dettagli |
|---|---|---|
| Catalogo delle fonti open data | ✅ reale | 56 fonti pubbliche di Napoli censite e verificate una per una, con licenza, limiti ed esito delle prove ([`docs/fonti-dati-napoli.md`](docs/fonti-dati-napoli.md)) |
| API dati città | ✅ reale, attiva sul server | [`citta-api/`](citta-api/README.md) su `twinciro.robertodisanto.it`: una sola API sopra le fonti, con cache, riserve dichiarate, fonte e ora di ogni dato; 59 test |
| TwinCIRO su WhatsApp | ✅ funziona | Agente OpenClaw nel gruppo WhatsApp della demo, con tre skill ([`c5-agentic-city/openclaw/skills/`](c5-agentic-city/openclaw/skills/README.md)); risponde con dati veri citando la fonte |
| Agenti della città e orchestratore | ✅ funzionano | Agenti Python su bus MQTT ([`c5-agentic-city/`](c5-agentic-city/README.md)), con LLM oppure a regole |
| Broker MQTT | ✅ attivo sul server | [`cloud/mqtt/`](cloud/mqtt/README.md), formato unico `napoli/...` |
| Sensori IoT | 🟡 parziale | Scheda ESP32 con Tasmota che pubblica misure vere; firmware del badge WHY2025 scritto e compilato, da provare sul dispositivo |
| TwinCIRO 3D (web app per l'operatore) | ✅ funziona | [`c5-presentazione/gemello-3d/`](c5-presentazione/gemello-3d/README.md): mappa 3D, previsione a 48 ore, what-if; le **presenze sono simulate** |
| Presenze e flussi di persone | 🟣 simulati | Non esistono dati aperti di presenza: arriveranno dalle reti mobili |
| Imprese, offerte, scenario della regata, semafori | 🟣 simulati | Servono a mostrare la negoziazione tra agenti e il gemello del traffico |
| Modelli predittivi addestrati | ⚪ non ancora | Oggi la previsione è un modello a regole dichiarato, non un modello addestrato |

### Dati

**Reali**, letti dalle fonti pubbliche (dal vivo, dall'ultimo dato salvato o da snapshot, sempre dichiarati):

- meteo attuale e previsione oraria (Open-Meteo, con MET Norway come riserva);
- qualità dell'aria (modello Copernicus CAMS e centraline ARPAC tramite EEA);
- allerte meteo (Protezione Civile Campania, Meteoalarm) e terremoti dei Campi Flegrei (INGV);
- metro, funicolari e treni: linee, stazioni e corse programmate (GTFS di ANM ed EAV); prossimi passaggi e percorsi, anche in bus, da Transitous, con tempo reale dove disponibile;
- traffico su tangenziale e autostrade (Autostrade per l'Italia);
- eventi: calendario del Comune di Napoli, partite del Napoli, scali delle navi da crociera, calendario dell'America's Cup;
- riferimenti: stagionalità turistica ISTAT, visitatori di musei e monumenti, affitti brevi, acque di balneazione;
- mappa, edifici 3D e rete stradale da OpenStreetMap, rilievo del terreno da Terrain Tiles.

**Simulati, con le ipotesi scritte nel codice e dichiarate nelle risposte:**

- **quante persone ci sono in ogni zona** (adesso e nelle prossime ore): è il dato che manca negli open data. In TwinCIRO 3D la stima combina una giornata tipo per luogo, la stagionalità ISTAT, il meteo dell'ora e gli eventi in calendario (tutti dati reali), più uno scostamento "rete mobile del giorno prima" **simulato** nel formato dei dati aggregati degli operatori;
- la composizione delle presenze (residenti, pendolari, turisti italiani e stranieri);
- l'affluenza degli eventi e l'effetto della pioggia sulle presenze (ipotesi numeriche);
- i flussi pedonali tra stazioni e luoghi (uno schema, non un modello di spostamento);
- le imprese (pizzeria, bar, gozzi, museo) e le loro offerte e controproposte, che sono di fantasia;
- lo scenario della giornata della regata dell'America's Cup 2027: navi, passeggeri, flussi della regata e della partita, traffico di fondo;
- i semafori: esistono solo nel gemello del traffico, nessun semaforo fisico.

### Agenti e orchestrazione

**Implementato:**

- agenti della città in Python ([`c5-agentic-city/`](c5-agentic-city/README.md)): Meteo&Mare, Eventi, Folla, Traffico, Turismo, Imprese e un **orchestratore** che decide e motiva ogni decisione; agenti personali per cittadini e turisti che chiedono percorsi e trattano con le imprese;
- comunicazione tra agenti su bus MQTT `napoli/...`;
- console della sala operativa, in cui l'operatore **approva o blocca** le decisioni degli agenti;
- LLM intercambiabili: Claude, Codex oppure qualsiasi API compatibile con OpenAI; senza LLM, o se l'LLM non risponde, decidono le regole e la demo non si blocca;
- in TwinCIRO 3D un orchestratore nel browser passa le domande agli agenti Mobilità, Folla, Eventi, Meteo, Turismo e Simulatore e mostra chi ha detto cosa.

**Limiti attuali:**

- gli agenti di TwinCIRO 3D ragionano **a regole**, senza LLM, e non sono collegati all'assistente WhatsApp: la pagina può fargli da schermo tramite link diretti;
- **MIIA** (l'LLM italiano di Fastweb) è integrabile tramite il provider compatibile con OpenAI, provato con altri server compatibili ma **non ancora con MIIA**;
- il drone è previsto come strumento dell'orchestratore con un pilota umano: c'è lo strumento che conta le persone in un fotogramma, non un servizio in volo.

### Interfacce

| Interfaccia | Cosa fa davvero | Cosa no |
|---|---|---|
| **TwinCIRO su WhatsApp** | Risponde nel gruppo della demo con dati veri e cita fonte e ora; usa gli agenti della città per percorsi, folla (simulata) e trattative con le imprese | La folla che riporta è simulata e lo dice |
| **TwinCIRO 3D** | Mappa 3D navigabile con 26 luoghi e 2.512 celle; linea del tempo da ieri a +48 ore; percorsi dal vivo (Porto → Fuorigrotta: a piedi fino a Municipio, poi Linea 6); aree critiche degli eventi del giorno dopo; what-if su eventi, linee chiuse, pioggia, navi e misure, con confronto prima/dopo | Presenze simulate; non legge MQTT né i sensori; chat a regole |
| **Sala operativa (console)** | Dialogo tra agenti, folla per zona, misure vere dei sensori, approvazione delle decisioni | È una console da terminale, non una web app |

### IoT

- **Scheda ESP32 con Tasmota**: misura temperatura e umidità e pubblica sul broker nel formato `napoli/...`. Sul banco, durante l'evento: 21,1 °C, 91%.
- **Badge Cyber Saiyan WHY2025**: firmware scritto da noi (contapersone a mano, sensori I2C, comandi dalla città), compilato e provato sul PC, **da provare sul badge**.
- La città legge le misure vere: l'agente Folla usa il contapersone, Meteo&Mare la temperatura, e la sala le mostra.
- Telecamere con Computer Vision e sensori acustici: **non ancora**.

### Gemello digitale del traffico

- **Reale:** rete stradale del lungomare da OpenStreetMap (494 strade, 8 incroci con semaforo) nel simulatore SUMO.
- **Simulato:** domanda di traffico e semafori. La stessa giornata gira con i semafori fissi e con quelli guidati dagli agenti: in media su 4 simulazioni −9% di ore perse in coda, con forte variabilità (da −1% a −18%). Il risultato è indicativo: per confermarlo serve una prova su strada.

## Sviluppi futuri

1. **Presenze misurate, non stimate.** Collegare i dati aggregati e anonimizzati delle reti mobili di Fastweb + Vodafone (presenze per cella e per ora, con la distinzione tra residenti, pendolari e turisti). Il modello di TwinCIRO 3D ha già la riga dedicata: il dato vero prende il posto di quello simulato.
2. **Modelli predittivi addestrati.** Sostituire le regole della previsione con modelli addestrati sullo storico delle presenze, del meteo e degli eventi, con incertezza stimata dai dati.
3. **Sensor fusion.** Unire alle presenze da rete mobile i dati dei dispositivi IoT (anche con SIM IoT dove non c'è Wi-Fi), delle telecamere con Computer Vision e Multimodal AI e dei sensori acustici. Sempre con privacy by design: ai server arrivano solo conteggi, mai immagini.
4. **MIIA come LLM degli agenti.** Provare davvero l'integrazione con MIIA di Fastweb, già predisposta.
5. **Un solo sistema.** Collegare TwinCIRO 3D al broker MQTT e agli agenti Python, perché operatore e WhatsApp vedano gli stessi dati e le stesse decisioni; dare un LLM alla chat della web app.
6. **What-if più realistico.** Modelli di spostamento delle persone al posto dello schema dei flussi; tarare effetti di eventi e misure su casi reali.
7. **Avvisi proattivi su WhatsApp.** Messaggi ai cittadini quando una zona si riempie, dopo l'approvazione dell'operatore.
8. **Imprese vere.** Disponibilità e prenotazioni reali di ristoranti, musei e trasporti al posto delle imprese di fantasia.
9. **Dalla demo al servizio.** Fonti con licenze per uso commerciale, monitoraggio dei servizi, prova sul campo con la Polizia Locale, estensione a nuovi domini (servizi pubblici, ambiente, rifiuti, acqua).
