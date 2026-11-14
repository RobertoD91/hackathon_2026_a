# Skill OpenClaw di TwinCiro

Skill per **CiroGPT**, l'agente OpenClaw di TwinCiro, su WhatsApp. Ogni cartella è una skill: un file `SKILL.md` con nome e descrizione nell'intestazione e, sotto, le istruzioni.

| Skill | Quando la usa CiroGPT | Fonti |
|---|---|---|
| [`napoli-citta-dati`](napoli-citta-dati/SKILL.md) | **per prima**, per qualunque dato reale sulla città: meteo, allerta, aria, eventi, trasporti, prossime partenze, terremoti | API dati città (`shared/citta-api`): una sola chiamata, con cache, fonte e ora di ogni dato |
| [`twinciro-citta`](twinciro-citta/SKILL.md) | domande su come muoversi, dove mangiare o prenotare, folla e avvisi della città | API della città simulata (agenti di `c5-agentic-city`) |
| [`napoli-meteo-allerte`](napoli-meteo-allerte/SKILL.md) | meteo, vento, pioggia, allerta | Open-Meteo (ICON-2I), MET Norway, Protezione Civile Campania, Meteoalarm, meteo@uniparthenope |
| [`napoli-aria-mare-terremoti`](napoli-aria-mare-terremoti/SKILL.md) | qualità dell'aria, mare, balneazione, terremoti dei Campi Flegrei | Open-Meteo Air Quality e Marine, EEA, INGV |
| [`napoli-trasporti`](napoli-trasporti/SKILL.md) | metro, funicolari, treni, prossime partenze, scioperi, tangenziale, parcheggi | Transitous, GTFS ANM ed EAV, avvisi EAV, ViaggiaTreno, ASPI, parcheggi ANM |
| [`napoli-eventi`](napoli-eventi/SKILL.md) | cosa succede oggi, partite, navi da crociera, America's Cup, festività | agenda del Comune, openfootball, TheSportsDB, Cruise Timetables, America's Cup, Nager.Date |
| [`napoli-turismo-statistiche`](napoli-turismo-statistiche/SKILL.md) | quanta gente va in un luogo, turisti per mese, numeri per il pitch | visitatori dei siti comunali, ISTAT, Eurostat, porto, aeroporto, Inside Airbnb, Wikidata |
| [`napoli-luoghi-mappe`](napoli-luoghi-mappe/SKILL.md) | dov'è, come ci arrivo in auto, quartieri, farmacie | Nominatim, OSRM, OpenStreetMap, ISTAT, Ministero della Salute |

Tutte le fonti sono state provate tra il 13 e il 14 novembre 2026. Il catalogo completo, con licenze ed esiti delle verifiche, è in [`docs/fonti-dati-napoli.md`](../../../docs/fonti-dati-napoli.md).

## Ordine d'uso

1. **`napoli-citta-dati`**: l'API dati città dell'altra sessione (`shared/citta-api/`, Docker in `cloud/citta-api/`). Fa una sola chiamata per domanda, con cache, riserve e quote già gestite. Ogni risposta ha un `testo` da citare e `fonte.stato` (reale, riserva, salvato, snapshot, programmato, simulato, assente).
2. **`twinciro-citta`**: per prenotazioni, negoziazione con le imprese e avvisi della città simulata.
3. Le **skill delle fonti dirette** (`napoli-meteo-allerte`, `napoli-trasporti`, ecc.) sono la **riserva**: si usano solo se l'API non risponde, o per un dato che l'API non ha (per esempio onde, balneazione, statistiche turistiche, farmacie).

## Installazione

Copia le cartelle che ti servono nella cartella delle skill di OpenClaw, di solito `skills/` del workspace dell'agente oppure `~/.openclaw/skills/`. Riavvia o ricarica l'agente.

Da verificare sulla nostra installazione: posizione esatta delle skill, variabili d'ambiente, heartbeat per gli avvisi proattivi.

Variabili usate:
- `CITTA_API`: indirizzo dell'API dati città, senza barra finale (es. `https://twinciro.robertodisanto.it/citta-api`);
- `CITTA_API_TOKEN`: token dell'API dati città;
- `C5_API`: indirizzo dell'API della città simulata di `c5-agentic-city` (solo per `twinciro-citta`);
- `C5_API_TOKEN`: token di quell'API, se è impostato.

## Regole comuni a tutte le skill

1. **Cita la fonte e l'ora del dato**, per esempio *"Open-Meteo, aggiornato alle 15:00"*.
2. **Reale e simulato vanno distinti.** I numeri dell'API della città (folla, traffico, offerte delle imprese) sono **simulati**: dillo.
3. **Mai inventare** orari, numeri o luoghi. Se una fonte non risponde, dillo e prova la riserva indicata nella skill.
4. **Cache.** Meteo e aria: almeno 10–15 minuti. Eventi: 30 minuti. Dati statici (GTFS, visitatori, ISTAT): tutta la giornata.
5. **Limiti.** Al massimo una richiesta al secondo per fonte. Open-Meteo e Wikimedia rispondono 429 se l'IP condiviso esaurisce la quota: aspetta e usa la riserva.
6. **Nessun dato personale** negli URL o negli header. Come User-Agent usa `TwinCiro/1.0`. Se una fonte chiede un contatto (MET Norway, Transitous), il team decide quale indirizzo del progetto aggiungere.
7. **Risposte WhatsApp**: brevi, concrete, nella lingua dell'utente, al massimo una emoji.

## Luoghi di riferimento (coordinate a 4 decimali)

| Luogo | lat | lon |
|---|---|---|
| Piazza del Plebiscito | 40.8359 | 14.2488 |
| Spaccanapoli, centro storico | 40.8484 | 14.2558 |
| Lungomare Caracciolo (Rotonda Diaz) | 40.8329 | 14.2349 |
| Mergellina | 40.8288 | 14.2183 |
| Molo Beverello, Stazione Marittima | 40.8383 | 14.2537 |
| Castel dell'Ovo | 40.8280 | 14.2476 |
| Napoli Centrale, Garibaldi | 40.8530 | 14.2725 |
| Vomero, Piazza Vanvitelli | 40.8440 | 14.2290 |
| Rione Sanità | 40.8606 | 14.2497 |
| Stadio Diego Armando Maradona | 40.8280 | 14.1930 |
