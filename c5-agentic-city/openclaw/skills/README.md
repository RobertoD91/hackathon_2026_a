# Skill OpenClaw di TwinCIRO

Skill per **TwinCIRO**, l'agente OpenClaw su WhatsApp. Ogni cartella è una skill: un file `SKILL.md` con nome e descrizione nell'intestazione e, sotto, le istruzioni.

| Skill | Quando la usa TwinCIRO | Fonte |
|---|---|---|
| [`twinciro-citta`](twinciro-citta/SKILL.md) | prenotazioni e negoziazione con le imprese, come muoversi durante la festa, folla, avvisi proattivi della città | API degli agenti della città (`/chiedi`, `/notifiche` di `c5-agentic-city`) |
| [`napoli-citta-dati`](napoli-citta-dati/SKILL.md) | qualunque **dato reale** sulla città: meteo, allerta, aria, eventi e partite, navi, trasporti e prossime partenze, terremoti, tangenziale | API dati città ([`citta-api/`](../../../citta-api/README.md)): una sola chiamata, con cache, fonte e ora di ogni dato |
| [`napoli-fonti-riserva`](napoli-fonti-riserva/SKILL.md) | **solo** se l'API dati città non risponde, oppure per i dati che l'API non ha: mare (onde e temperatura dell'acqua), farmacie, indirizzi qualsiasi, percorsi in auto | fonti aperte lette direttamente: Open-Meteo, MET Norway, Protezione Civile Campania, Transitous, Comune di Napoli, openfootball, INGV, Ministero della Salute, Nominatim, OSRM |

I comandi di `napoli-fonti-riserva` sono stati provati il 14 novembre 2026, tranne il meteo di Open-Meteo: dalla sandbox risponde 429 (quota giornaliera dell'IP condiviso). Usa gli stessi campi `current` di `citta-api`: da riprovare una volta dalla macchina dell'agente OpenClaw. Il catalogo completo delle fonti, con licenze ed esiti delle verifiche, è in [`docs/fonti-dati-napoli.md`](../../../docs/fonti-dati-napoli.md).

## Ordine d'uso

1. **`twinciro-citta`**: tutto quello che passa dagli agenti della città: prenotazioni e negoziazione con le imprese, folla (simulata), avvisi proattivi con l'heartbeat.
2. **`napoli-citta-dati`**: i dati reali, dall'API dati città ([`citta-api/`](../../../citta-api/README.md), Docker in `cloud/citta-api/`). Una sola chiamata per domanda, con cache, riserve e quote già gestite. Ogni risposta ha un `testo` da citare e `fonte.stato` (reale, riserva, salvato, snapshot, programmato, simulato, assente).
3. **`napoli-fonti-riserva`**: la riserva. Si usa solo se l'API dati città non risponde (e TwinCIRO lo dice: "dato letto direttamente dalla fonte, l'API non risponde") o per i quattro dati che l'API non ha. Visitatori, stagione turistica, porto, balneazione e affitti brevi sono già nell'API (`luogo`, `riassunto`).

## Installazione

Copia le tre cartelle nella cartella delle skill di OpenClaw, di solito `skills/` del workspace dell'agente oppure `~/.openclaw/skills/`. Riavvia o ricarica l'agente.

Da verificare sulla nostra installazione: posizione esatta delle skill, variabili d'ambiente, heartbeat per gli avvisi proattivi.

Variabili usate:
- `CITTA_API`: indirizzo dell'API dati città, senza barra finale (`https://twinciro.robertodisanto.it/citta-api`);
- `CITTA_API_TOKEN`: token dell'API dati città;
- `C5_API`: indirizzo dell'API della città di `c5-agentic-city` (solo per `twinciro-citta`);
- `C5_API_TOKEN`: token di quell'API, se è impostato.

`napoli-fonti-riserva` non usa variabili né chiavi: le sue fonti sono aperte.

## Regole comuni a tutte le skill

1. **Cita la fonte e l'ora del dato**, per esempio *"Open-Meteo, aggiornato alle 15:00"*.
2. **Reale e simulato vanno distinti.** I numeri degli agenti della città (folla, traffico, offerte delle imprese) sono **simulati**: dillo.
3. **Mai inventare** orari, numeri o luoghi. Se un dato non è disponibile, dillo.
4. **Niente raffiche di richieste**: l'API dati città ha già cache e quote; con le fonti dirette al massimo una richiesta al secondo per fonte, risultati in cache.
5. **Nessun dato personale** negli URL o negli header. Come User-Agent usa `TwinCIRO/1.0`.
6. **Risposte WhatsApp**: brevi, concrete, nella lingua dell'utente, al massimo una emoji.
