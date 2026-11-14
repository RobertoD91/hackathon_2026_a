# API dati città di Napoli (`citta-api`)

Il **cervello dati di CiroGPT**. Una sola API, sempre accesa su `cloud.robertodisanto.it`, che legge le fonti reali di Napoli già verificate (catalogo: [`docs/fonti-dati-napoli.md`](../../docs/fonti-dati-napoli.md)) e le restituisce **già "masticate" per un LLM**: JSON compatto, campi in italiano con l'unità nel nome, orari locali, la fonte con licenza e **stato del dato** (reale, riserva, salvato, snapshot, programmato, simulato) e un campo `testo` pronto da citare in WhatsApp.

Perché esiste:
- **quote**: CiroGPT, la mappa e il video chiedono le stesse cose decine di volte. L'API le legge una volta sola, le tiene in cache e, dopo un **429**, non richiama la fonte per 15 minuti (passa alla riserva e lo dice);
- **niente dati inventati**: ogni risposta dice da dove viene il dato e di quando è; se una fonte è giù si usa la riserva dichiarata (altra fonte o ultimo dato salvato), mai un numero a caso;
- **reale e simulato separati**: la folla per luogo è una stima del simulatore e l'API lo scrive sempre.

Riusa senza duplicarli i moduli della mappa "Napoli in tempo reale": `shared/iot-agents/example/fonti/normalizza.js` (funzioni pure), `fonti/dati.js` (cache per URL, timeout, riserve), `luoghi.js`, il simulatore `sim/sim-core.js` con `example/sim-config.json` e lo script degli snapshot `tools/aggiorna-dati-napoli.js`. Node ≥ 20, nessuna dipendenza npm.

## Avvio

```bash
node shared/citta-api/server.js                    # http://localhost:8791, snapshot della repo
curl -s 'localhost:8791/citta/riassunto?formato=testo'
cd shared/citta-api && npm test                    # 43 test (node:test, fetch finto)
node --test shared/citta-api/test/                 # gli stessi dalla radice della repo
```

Sul server, in Docker: [`cloud/citta-api/`](../../cloud/citta-api/README.md) (`docker compose up -d --build`).

| Variabile | Predefinito | A cosa serve |
|---|---|---|
| `PORT` | `8791` | porta HTTP |
| `HOST` | `0.0.0.0` | indirizzo di ascolto |
| `CITTA_API_TOKEN` | vuoto | se impostato, ogni richiesta (tranne `/salute`) vuole `Authorization: Bearer <token>` |
| `CITTA_API_CORS` | `https://robertodisanto.it` | origini ammesse dal browser, separate da virgole; `*` per tutte |
| `NAPOLI_UA` | `napoli-citta-api/1.0 (demo hackathon; dati aperti)` | User-Agent verso le fonti; se impostato vale per tutte (tranne quelle a cui serve un UA da browser). Mai dati personali |
| `CITTA_DATI` | `shared/iot-agents/example/dati/` | cartella degli snapshot di lavoro (nel container il volume `/dati`) |
| `CITTA_DATI_INIZIALI` | come sopra | snapshot della repo con cui riempire `CITTA_DATI` alla prima partenza (e sostituire i file più vecchi) |
| `CITTA_AGGIORNA` | vuoto (mai) | rinfresco degli snapshot nel processo: `si` = `eventi=6h,aria=1h,meteo=3h,riferimenti=24h,trasporti=24h`, oppure un piano proprio |
| `CITTA_TIENI_CALDO` | `1` | ogni 5 minuti rilegge le fonti del riassunto **scadute**: la prima domanda non aspetta |
| `CITTA_PAUSA_429` | `15m` | pausa di un dominio dopo un 429 (o il `Retry-After`, se più lungo; massimo 1 h) |
| `CITTA_LOG` | `1` | una riga di log per richiesta, più fonti degradate e pause |

Rigenerare gli snapshot a mano (l'API in esecuzione li ricarica da sola entro un minuto):

```bash
node shared/citta-api/aggiorna.js --solo eventi,aria     # sezioni: trasporti, aria, eventi, riferimenti, meteo
node shared/citta-api/aggiorna.js --curl                 # con curl, se un WAF rifiuta il client di Node
```

## Contratto dell'API

Solo `GET`, risposte `application/json; charset=utf-8`.

- **Orari**: locali di Napoli, formato `AAAA-MM-GG HH:MM` (`ora_dato` = istante della misura o della previsione, non della richiesta).
- **Unità nel nome del campo**: `temperatura_c`, `vento_kmh`, `vento_nodi`, `pioggia_mm`, `umidita_pct`, `distanza_m`, `minuti_a_piedi`, `pm10_ugm3`...
- **`fonte`** (o `fonti`): `{ nome, stato, ora_dato, licenza, nota? }`. Con `aggiornamento_in_corso: true` il dato è quello della lettura precedente e il nuovo sta arrivando.
- **`testo`**: la stessa informazione in una o due frasi italiane, con fonte e ora. CiroGPT può citarlo così com'è.
- **`?formato=testo`**: restituisce solo `testo` (`text/plain`), comodo per il contesto dell'LLM. **`?leggibile=1`**: JSON indentato.
- **Alias**: gli stessi percorsi funzionano senza `/citta` (`/meteo?luogo=vomero`), più `/citta/eventi/oggi`, `/citta/eventi/domani`, `/citta/eventi/2026-11-21`. Maiuscole, barre doppie e barra finale non contano (`//citta//meteo/` = `/citta/meteo`).
- **Errori**: `{ "errore": "…", ... }` con 400 (parametro mancante o non valido), 401 (token), 404 (luogo, stazione o percorso sconosciuto: con `suggerimenti` o `endpoint`), 405 (non GET), 500.

### Stato del dato

| `stato` | Significato | Come dirlo all'utente |
|---|---|---|
| `reale` | letto dal vivo dalla fonte ufficiale (cache di pochi minuti) | "Open-Meteo, dato delle 15:00" |
| `riserva` | la fonte principale non risponde: dato dal vivo di un'altra fonte (es. MET Norway al posto di Open-Meteo) | citare la fonte di riserva |
| `salvato` | nessuna fonte dal vivo: ultimo dato salvato nello snapshot, con la sua ora | "ultimo dato disponibile delle 9:45" |
| `snapshot` | dato statico o lento (eventi, centraline, visitatori), rigenerato periodicamente | citare la fonte e la data |
| `programmato` | orario GTFS, non in tempo reale | "secondo l'orario programmato" |
| `simulato` | stima del simulatore della demo, **non una misura** (folla) | dirlo sempre |
| `assente` | nessuna fonte disponibile | non dare numeri |

### Endpoint

| Endpoint | Parametri | Cosa restituisce |
|---|---|---|
| `/citta/riassunto` | — | il quadro della città adesso: `testo` (circa 1.500 caratteri), `allerta`, `meteo` (città e luoghi), `aria`, `eventi_oggi`, `prossimi_eventi`, `trasporti.avvisi` (EAV), `terremoti`, `stagione` (ISTAT), `folla_stimata` (simulata), `fonti` con stato e ora |
| `/citta/luoghi` | — | i 10 luoghi monitorati con categoria, coordinate, parole con cui si trovano e stazione più vicina |
| `/citta/luogo` | `nome` (tollerante) **oppure** `lat` e `lon` | tutto su un luogo: `meteo`, `aria`, `allerta` (se attiva), `trasporti` (stazioni con minuti a piedi e avvisi; se entro 1,2 km non ce n'è nessuna, le 2 più vicine entro 2,5 km), `eventi_oggi`, `prossimi_eventi`, `riferimenti` (visitatori, mare, porto, affitti brevi), `folla` (simulata), `testo` |
| `/citta/meteo` | `luogo` facoltativo (o `lat`/`lon`) | meteo di un luogo, o `citta` (min/max, cielo prevalente, vento) e tutti i `luoghi` |
| `/citta/aria` | `luogo` facoltativo | livello europeo (buona … pessima) dalla centralina ARPAC entro 1,5 km con misura recente, altrimenti dal modello Copernicus CAMS; senza luogo anche tutte le `centraline`. Per PM10 e PM2.5 `valore_ugm3` è la media delle ultime 24 ore, come vuole l'indice europeo (`valore_tipo`) |
| `/citta/allerta` | — | `regionale` (Protezione Civile Campania, Zona 1: livello, colore, `attiva`, fenomeni, validità, domani) e `meteoalarm` (avvisi per tutta la Campania) |
| `/citta/trasporti/vicino` | `luogo` o `lat`/`lon`; `raggio_m` (200-3000, predefinito 1200); `passaggi=1` | stazioni di metro, funicolari e treni vicine (distanza, minuti a piedi, linee, corse programmate in quest'ora), avvisi EAV pertinenti; con `passaggi=1` le prossime partenze della stazione più vicina. Senza `raggio_m` e senza stazioni entro 1200 m, la ricerca si allarga a 2500 m (dichiarato in `nota` e nel `testo`) |
| `/citta/passaggi` | `stazione` (nome o id, tollerante); `linea` facoltativa (`L1`, `cumana`...) | prossime partenze da Transitous (`tra_min`, linea, direzione, tempo reale e ritardo quando ci sono); se Transitous non risponde, le corse programmate in quest'ora e nella prossima; `altre_stazioni_con_nome_simile` |
| `/citta/eventi` | `giorno` = `oggi` (predefinito), `domani`, `dopodomani`, `lunedì`…`domenica`, `AAAA-MM-GG`, `GG/MM` (un giorno che non esiste, come `2026-02-30`, dà 400); `luogo` facoltativo | eventi del giorno (Comune di Napoli, partite al Maradona, navi da crociera, America's Cup) con orario in parole, `in_corso`, `sposta_folla`, fonte; `prossimi` (30 giorni, più il primo giorno di regate). Il filtro per `luogo` vale per i 10 luoghi monitorati: per un altro posto (es. `bagnoli`) arrivano gli eventi di tutta la città, con `nota_luogo` |
| `/citta/terremoti` | — | ultimi terremoti dei Campi Flegrei (INGV) |
| `/citta/traffico` | — | eventi su Tangenziale e autostrade (ASPI). Il traffico urbano non ha dati aperti |
| `/citta/fonti` | — | stato di ogni fonte (ultimo esito, ora del dato, durata, cache, licenza, catena delle riserve), richieste per dominio con le **pause** in corso, snapshot con le fonti e gli errori dell'ultima generazione |
| `/salute` | — | sempre senza token: `stato`, versione, età degli snapshot, fonti in pausa, rinfresco |
| `/` | — | indice degli endpoint e legenda degli stati |

Ricerca tollerante (`nome`, `luogo`, `stazione`): minuscole, accenti e apostrofi non contano, refusi corti sì (`plebiscitto`), anche nomi di vie, monumenti e stazioni della zona: `castel dell'ovo`, `plebiscito`, `maradona`, `stadio`, `san paolo`, `spacca napoli`, `maschio angioino`, `stazione centrale`, `via toledo`, `capodimonte`. Un nome che non è uno dei 10 luoghi ma è uno degli **altri luoghi noti** di `src/punti.js` (Città della Scienza o Coroglio, aeroporto di Capodichino, Parco Virgiliano, Marechiaro: posti senza sensori, con coordinate indicative) o una stazione (`bagnoli`) restituisce quel punto, con meteo e aria del luogo monitorato più vicino (dichiarato in `nota`). L'ordine di ricerca è: 10 luoghi, altri luoghi noti, stazioni.

Esempio (`/citta/meteo?luogo=lungomare`):

```json
{"luogo":{"id":"lungomare","nome":"Lungomare Caracciolo","tipo":"luogo","categoria":"Lungomare e porto","lat":40.8329,"lon":14.2349,"trovato_con":"lungomare"},
 "meteo":{"temperatura_c":19,"percepita_c":18.9,"cielo":"Quasi sereno","pioggia_mm":0,"umidita_pct":72,"vento_kmh":9,"vento_nodi":5,"raffiche_kmh":20,"condizioni":"bel tempo","ora_dato":"2026-11-14 13:45"},
 "fonte":{"nome":"Open-Meteo (modello ICON-2I di ItaliaMeteo-ARPAE)","stato":"reale","ora_dato":"2026-11-14 13:45","licenza":"CC BY 4.0","nota":"previsione per l'ora corrente, griglia di 2,2 km"},
 "testo":"Lungomare Caracciolo: 19 °C, quasi sereno, vento 9 km/h (5 nodi) con raffiche a 20 km/h, umidità 72 %. Fonte: Open-Meteo (modello ICON-2I di ItaliaMeteo-ARPAE), dato delle 13:45."}
```

Esempio (`/citta/passaggi?stazione=municipio&formato=testo`):

```
Prossime partenze da Municipio (L1, L6): 14:03 L1 per PISCINOLA, 14:06 L6 per MOSTRA, 14:07 L1 per TRIBUNALE, … Fonte: Transitous (orari programmati, senza tempo reale).
```

## Cache, riserve e quote

| Fonte | Cache | Catena delle riserve |
|---|---|---|
| Meteo per luogo | 15 min | Open-Meteo ICON-2I → Open-Meteo predefinito → MET Norway (un punto) → ultimo dato salvato |
| Aria, modello | 60 min | Open-Meteo Air Quality (CAMS) → ultimo dato salvato |
| Aria, centraline ARPAC | snapshot | EEA, dati orari non validati (rinfresco consigliato: ogni ora) |
| Allerta | 20 min | Centro Funzionale Campania → ultimo avviso salvato; Meteoalarm dallo snapshot |
| Terremoti | 30 min | INGV → snapshot |
| Prossimi passaggi | 1 min per stazione | Transitous → corse programmate GTFS |
| Avvisi EAV | 15 min | — |
| Traffico ASPI | 5 min | — |
| Eventi | 6 h + snapshot | snapshot; calendario Serie A dal vivo (openfootball) |
| Trasporti, riferimenti | snapshot | — |

- Un esito **degradato** (riserva, salvato, assente) vale 3 minuti: poi si riprova la fonte principale, mai più spesso.
- **Coalescenza**: richieste uguali in contemporanea fanno una sola lettura (anche dentro `fonti/dati.js`).
- **Stale-while-revalidate**: con un dato scaduto si aspetta il nuovo al massimo 4 s, poi si risponde col vecchio (`aggiornamento_in_corso: true`).
- **429**: tutto il dominio (es. `open-meteo.com`: meteo e aria hanno la stessa quota per IP) va in pausa per `CITTA_PAUSA_429`; in pausa **nessuna richiesta parte** e si passa subito alla riserva. Tre errori di fila (rete, timeout, 5xx) mettono il dominio in pausa per 2 minuti.
- Il Centro Funzionale che risponde "senza avvisi in vigore" è un dato reale ("nessuna allerta"), non un guasto: l'ultimo avviso resta solo come storia.
- Gli snapshot cambiati sul disco (rinfresco interno o `aggiorna.js`) si ricaricano entro 30-60 s, senza riavvio.

Con `CITTA_TIENI_CALDO=1` e nessuno che chiede niente, l'API fa al giorno circa 100 letture del meteo e 24 dell'aria a Open-Meteo (più quelle del rinfresco degli snapshot, se attivo: 8 + 8), 70 al Centro Funzionale (2-3 richieste ciascuna), 50 a INGV e 100 a EAV; con tante domande il numero non cambia, perché tutte usano la stessa cache. Open-Meteo concede 10.000 richieste al giorno per IP.

Con la cartella predefinita (`CITTA_DATI` non impostata) il rinfresco, se attivo, riscrive gli snapshot della repo, come lo script `aggiorna-dati-napoli.js`: in sviluppo lascia `CITTA_AGGIORNA` vuota o usa una cartella a parte.

## Usarla da CiroGPT

Variabili per OpenClaw: `CITTA_API` (es. `https://cloud.robertodisanto.it/citta-api` o `http://cloud.robertodisanto.it:8791`, senza barra finale) e `CITTA_API_TOKEN`. Testo pronto da copiare in un `SKILL.md` (per esempio `skills/napoli-citta-dati/SKILL.md`). I comandi qui sotto sono stati provati così come sono contro l'API in esecuzione:

````markdown
---
name: napoli-citta-dati
description: Dati reali di Napoli adesso (meteo, allerta, aria, eventi, partite, navi da crociera, metro e treni, prossime partenze, terremoti) da una sola API con cache. Usala PRIMA delle fonti dirette per qualunque domanda su com'è la città, cosa succede, come muoversi o se c'è un'allerta.
---

# Dati della città di Napoli

Una sola API con i dati reali già pronti. Ogni risposta ha un campo `testo` da citare e una `fonte` con stato e ora del dato. Usa sempre questa forma di curl:

```bash
curl -sS --max-time 20 -G -H "Authorization: Bearer $CITTA_API_TOKEN" "$CITTA_API/citta/<endpoint>" --data-urlencode "<parametro>=<valore>" --data-urlencode formato=testo
```

- **Ogni parametro va con `--data-urlencode`**, anche se è una parola sola. Non mettere spazi o apostrofi dentro l'indirizzo: curl lo rifiuta ("URL rejected") e non arriva nessuna risposta.
- **`formato=testo`** restituisce solo la frase pronta da citare, con fonte e ora: usalo per rispondere. Senza `formato=testo` arriva il JSON completo, utile se ti serve un campo preciso, per esempio `fonte.stato` o `passaggi[].tra_min`.
- Se qualcosa non va, la risposta è un JSON con `errore`, anche con `formato=testo`.

## Quale endpoint per quale domanda

| Domanda | Endpoint e parametri |
|---|---|
| inizio conversazione o heartbeat (contesto della giornata) | `riassunto` |
| "com'è al Castel dell'Ovo?", "c'è gente al lungomare?", "che tempo fa a Città della Scienza?" | `luogo` con `nome=<luogo>` |
| "che tempo fa a Mergellina?", "c'è vento?" | `meteo` con `luogo=<luogo>` (senza luogo: tutta la città) |
| "com'è l'aria?" | `aria` con `luogo=<luogo>` (facoltativo) |
| "c'è allerta meteo?" | `allerta` |
| "come arrivo allo stadio?", "metro vicino a piazza Plebiscito?" | `trasporti/vicino` con `luogo=<luogo>` e `passaggi=1` |
| "quando passa la metro a Toledo?", "Cumana da Montesanto?" | `passaggi` con `stazione=<stazione>` e, se serve, `linea=<L1, L2, L6, cumana, circumflegrea>` |
| "cosa c'è oggi/domani/sabato?", "quando gioca il Napoli?", "arrivano navi?" | `eventi` con `giorno=<oggi, domani, sabato, 2026-11-21>` e, se serve, `luogo=<luogo>` |
| "terremoti ai Campi Flegrei?" | `terremoti` |
| "traffico in tangenziale?" | `traffico` |

Esempi:

```bash
curl -sS --max-time 20 -G -H "Authorization: Bearer $CITTA_API_TOKEN" "$CITTA_API/citta/riassunto" --data-urlencode formato=testo
curl -sS --max-time 20 -G -H "Authorization: Bearer $CITTA_API_TOKEN" "$CITTA_API/citta/luogo" --data-urlencode "nome=castel dell'ovo" --data-urlencode formato=testo
curl -sS --max-time 20 -G -H "Authorization: Bearer $CITTA_API_TOKEN" "$CITTA_API/citta/passaggi" --data-urlencode "stazione=montesanto" --data-urlencode "linea=cumana" --data-urlencode formato=testo
curl -sS --max-time 20 -G -H "Authorization: Bearer $CITTA_API_TOKEN" "$CITTA_API/citta/eventi" --data-urlencode "giorno=domani" --data-urlencode formato=testo
```

Nomi di luoghi e stazioni: vanno bene come li scrive l'utente ("castel dell'ovo", "plebiscito", "stadio", "stazione centrale", "via toledo", "città della scienza", "aeroporto"). I luoghi con i sensori della demo sono 10 (`luoghi`). Per gli altri posti (una stazione, Città della Scienza, l'aeroporto, un punto con `lat` e `lon`) meteo e aria vengono dal luogo monitorato più vicino, e la risposta lo dice: riportalo.

Se il luogo non si trova, il JSON ha `errore`, `suggerimenti` e `altri_luoghi_noti`: proponi all'utente il nome più vicino a quello che cercava, oppure chiedigli dov'è.

## Come rispondere

1. Parti dal `testo`: è già corretto e cita fonte e ora. Accorcialo per WhatsApp, ma **non cambiare numeri, orari e fonti**.
2. **Cita sempre fonte e ora del dato**, per esempio "Open-Meteo, aggiornato alle 15:00".
3. Guarda lo stato del dato (nel `testo` o in `fonte.stato`):
   - `reale`: dato dal vivo;
   - `riserva` o `salvato`: dillo ("ultimo dato disponibile delle 9:45");
   - `programmato`: "secondo l'orario programmato", non "in tempo reale";
   - `simulato` (la folla): **dillo sempre**, è una stima della demo, non una misura;
   - `assente`: non dare numeri, di' che il dato ora non è disponibile.
4. Se nel `testo` c'è "ALLERTA" (allerta regionale gialla o superiore per Napoli, in corso o prevista), mettila all'inizio della risposta e invita a seguire i canali ufficiali della Protezione Civile. Gli avvisi Meteoalarm valgono per tutta la Campania: citali come tali.
5. Navi da crociera e regate non hanno orari nelle fonti: non inventarli.
6. Metro e funicolari ANM non hanno un'API dello stato del servizio: per guasti rimanda all'app ANM Go.
7. Se l'API non risponde (errore di curl o timeout), usa le skill delle fonti dirette (`napoli-meteo-allerte`, `napoli-trasporti`, …) e dillo.
````

Il contesto della giornata (`riassunto` con `formato=testo`) costa una chiamata e circa 500 token: conviene metterlo nel prompt di CiroGPT a ogni heartbeat, così risponde subito alle domande generiche e usa gli altri endpoint solo per i dettagli.

## File

```
shared/citta-api/
  server.js            avvio (variabili d'ambiente, SIGTERM)
  aggiorna.js          rigenera gli snapshot nella cartella dell'API (riga di comando)
  src/config.js        variabili d'ambiente e valori predefiniti
  src/rete.js          fetch "educato": User-Agent, pause dopo 429 ed errori, conteggi per dominio
  src/archivio.js      snapshot su disco: semina dalla repo, ricarica i file cambiati, impostaSnapshot
  src/sorgenti.js      cache per fonte sopra fonti/dati.js: TTL, coalescenza, esiti degradati, stale-while-revalidate
  src/ricerca.js       ricerca tollerante di luoghi e stazioni
  src/punti.js         altri luoghi noti senza sensori (Città della Scienza, aeroporto...)
  src/folla.js         folla stimata (simulatore + eventi reali + stagione ISTAT), dichiarata simulata
  src/formato.js       orari, numeri, fonte compatta, legenda degli stati
  src/citta.js         le risposte degli endpoint
  src/aggiornamento.js rinfresco degli snapshot nel processo (una sezione alla volta)
  src/servizio.js      server HTTP: rotte, token, CORS, log, /salute, /citta/fonti
  test/                node:test con fetch finto, orologio finto e snapshot sintetici
```

## Limiti noti

- **Folla**: simulata (curva oraria per luogo con capienze indicative × eventi reali × stagionalità ISTAT). Le presenze da rete mobile vanno chieste a Fastweb + Vodafone.
- **Meteo e aria** sono per i 10 luoghi monitorati: per un altro punto si usa il luogo più vicino (dichiarato). Il modello CAMS ha celle di 11 km; le centraline arrivano con qualche ora di ritardo.
- **Eventi del Comune**: solo i 10 dell'agenda corrente; navi da crociera da una fonte non ufficiale (Cruise Timetables), senza orari.
- **Passaggi**: Transitous dà spesso solo l'orario programmato (lo dice `tempo_reale`); per ANM non esiste un dato pubblico sullo stato del servizio.
- **Allerta**: l'API del Centro Funzionale non è documentata e può cambiare.
- Licenze non aperte (Centro Funzionale, ASPI, EAV, Cruise Timetables, AdSP; Transitous solo non commerciale): citate come fonte per una demo non commerciale.
