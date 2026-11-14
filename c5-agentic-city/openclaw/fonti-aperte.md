# Fonti dati aperte per TwinCiro (versione in un solo file)

> Versione divisa in skill OpenClaw, una per dominio e più completa: [`skills/`](skills/README.md). Catalogo verificato: [`docs/fonti-dati-napoli.md`](../../docs/fonti-dati-napoli.md).

Contesto: sei un agente di **TwinCiro** (Napoli Agentic City) (challenge Fastweb + Vodafone, The Big Hack 2026). Scenario: sabato di festa a Napoli, con l'America's Cup davanti a via Caracciolo, navi da crociera alla Stazione Marittima e la partita al Maradona. Queste sono le fonti aperte che abbiamo trovato e provato (13–14 novembre 2026). Usale per rispondere con dati veri.

## Regole d'uso

- **Cita sempre la fonte** quando dai un numero ("secondo Open-Meteo…").
- **Distingui reale da simulato.** Se un dato non è in queste fonti, dillo e usa la simulazione della città (API `/stato`, vedi sotto) dichiarandola come stima.
- **Niente chiavi**: tutte le fonti qui sotto sono senza autenticazione.
- **Rispetta i limiti**:
  - massimo 1 richiesta al secondo per fonte;
  - riusa i risultati per almeno 10 minuti (meteo) o per tutta la giornata (dataset statici);
  - imposta uno User-Agent generico, per esempio `NapoliAgenticCity/1.0`. Niente dati personali nell'header o nell'URL.
- Coordinate utili: Napoli centro `40.83, 14.25` · Rotonda Diaz `40.8335, 14.2330` · Mergellina `40.8290, 14.2240` · Castel dell'Ovo `40.8283, 14.2475` · Molo Beverello `40.8380, 14.2560` · Piazza Municipio `40.8395, 14.2525` · Stadio Maradona `40.8280, 14.1930`.

## 1. Meteo e mare: Open-Meteo (senza chiave)

Previsioni orarie: vento in nodi, raffiche, temperatura, pioggia.

```
https://api.open-meteo.com/v1/forecast?latitude=40.83&longitude=14.24&hourly=wind_speed_10m,wind_gusts_10m,temperature_2m,precipitation&wind_speed_unit=kn&timezone=Europe%2FRome&forecast_days=1
```

Mare: altezza d'onda. Serve a dire se la regata si può fare.

```
https://marine-api.open-meteo.com/v1/marine?latitude=40.82&longitude=14.24&hourly=wave_height&timezone=Europe%2FRome&forecast_days=1
```

Qualità dell'aria (PM10, PM2.5):

```
https://air-quality-api.open-meteo.com/v1/air-quality?latitude=40.85&longitude=14.27&current=pm10,pm2_5
```

Regata possibile (ipotesi nostra): vento 6–22 nodi, raffiche sotto 30, onda sotto 1,8 m.

Nota: l'endpoint `forecast` può rispondere **429** (troppe richieste dallo stesso IP). Riprova dopo qualche minuto e tieni i dati in cache.

## 2. Mappe, indirizzi e percorsi: OpenStreetMap

Da indirizzo o luogo a coordinate (Nominatim, massimo 1 richiesta al secondo):

```
https://nominatim.openstreetmap.org/search?q=Molo+Beverello+Napoli&format=json&limit=1
```

Percorso in auto con distanza e durata (OSRM demo, a volte non risponde):

```
https://router.project-osrm.org/route/v1/driving/14.2245,40.8290;14.2560,40.8380?overview=false
```

L'ordine è `lon,lat;lon,lat`.

Estratto dei dati grezzi di un'area piccola (strade, edifici, linea di costa):

```
https://api.openstreetmap.org/api/0.6/map?bbox=14.222,40.828,14.258,40.842
```

Overpass, per query sui punti di interesse: il server principale e i mirror sono instabili. Prova `https://overpass-api.de/api/interpreter` o `https://maps.mail.ru/osm/tools/overpass/api/interpreter` e accetta che possano fallire.

## 3. Open data del Comune di Napoli (CKAN)

Portale: https://dati.comune.napoli.it/. Lista dei dataset:

```
https://dati.comune.napoli.it/api/3/action/package_list
```

Dettaglio e link di download di un dataset:

```
https://dati.comune.napoli.it/api/3/action/package_show?id=<nome>
```

Il portale è **intermittente**: il 13/11 sera rispondeva, il 14/11 notte no.

Dataset utili (`<nome>`):

| Nome | Cosa contiene | Uso |
|---|---|---|
| `parcheggi-azienda-napoletana-di-mobilita` | parcheggi ANM 2025 (CSV) | dove lasciare l'auto |
| `numero-visitori-del-castel-dell-ovo` | visitatori di Castel dell'Ovo | affollamento abituale |
| `numero-visitori-di-castel-nuovo-maschio-angioino` | visitatori del Maschio Angioino | affollamento abituale |
| `numero-visitori-del-palazzo-delle-arti-napoli-pan` | visitatori del PAN | alternative culturali |
| `numero-visitori-al-complesso-archeologico-del-pausilypon` | visitatori del Pausilypon | alternative |
| `numero-visitori-di-san-domenico-maggiore` | visitatori di San Domenico Maggiore | alternative |
| `incidenti-stradali` | incidenti stradali | punti critici del traffico |
| `violazioni-al-codice-della-strada` | violazioni del codice della strada | punti critici |
| `stradario-del-comune-di-napoli` | stradario | nomi delle vie |
| `apertura-e-cessazione-attivita-commerciali` | aperture e chiusure di attività | imprese del territorio |
| `elenco-dei-parchi-cittadini` | parchi | alternative all'aperto |
| `elenco-farmacie` | farmacie | servizi |

CSV dei parcheggi ANM (link diretto trovato il 13/11):

```
https://dati.comune.napoli.it/dataset/b9b21365-c509-4f4d-92a5-981091447ae8/resource/2e1586f6-5cb8-40ac-9047-2e1ff56d8ee8/download/parcheggi_anm_2025.csv
```

## 4. Trasporto pubblico: EAV (Circumvesuviana, Cumana, Circumflegrea)

Da dati.gov.it (CKAN nazionale):

```
https://www.dati.gov.it/opendata/api/3/action/package_search?q=EAV&rows=10
```

Dataset: **Elenco Linee**, **Elenco Stazioni**, **Elenco Corse**, **Calendario corse**, Elenco Rotabili. Sono CSV scaricabili da eavsrl.it; i link esatti sono nel campo `resources[].url` della risposta.

Non abbiamo trovato un GTFS open di ANM (metro Linea 1, funicolari, bus). Per i collegamenti usa conoscenza generale e dillo:
- Linea 1 Municipio–Toledo–Vanvitelli;
- Linea 2 Mergellina–Campi Flegrei per lo stadio;
- funicolari di Chiaia e di Mergellina.

## 5. Turismo e statistiche

Eurostat, presenze turistiche mensili in Campania (regione ITF3):

```
https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/tour_occ_nim?geo=ITF3&format=JSON&lastTimePeriod=12
```

ISTAT (SDMX), elenco dei dataflow, da cui scegliere quello che serve:

```
https://esploradati.istat.it/SDMXWS/rest/dataflow/IT1/ALL/latest
```

## 6. Voli in arrivo a Capodichino: OpenSky (senza chiave, limiti stretti)

Aerei in volo sopra l'area di Napoli in questo momento, utili per stimare i turisti in arrivo:

```
https://opensky-network.org/api/states/all?lamin=40.7&lomin=14.1&lamax=41.0&lomax=14.5
```

Può restituire `"states": null` quando non c'è traffico. Usalo con parsimonia: gli utenti anonimi hanno poche richieste al giorno.

## 7. Eventi

- America's Cup: https://www.americascup.com/ (calendario e notizie; Napoli ospita l'edizione 2027).
- Protezione Civile nazionale: https://www.protezionecivile.gov.it/

## Cosa NON è disponibile come dato aperto (va simulato e dichiarato)

- **Orari e passeggeri delle navi da crociera**: nessuna fonte aperta trovata. Il sito cruisetimetables risponde 403.
- **Presenze da rete mobile** (il tipo di dato di Fastweb e Vodafone): nella demo sono simulate dall'agente Folla.
- **Flussi di traffico misurati**, **disponibilità in tempo reale di locali e imprese**, **flussi della regata e della partita**.
- ARPAC (qualità dell'aria regionale) e allerte meteo della Regione Campania: dalle nostre macchine non rispondevano. Riprova, ma non contarci.
- OpenAQ e Transit.land: richiedono una chiave.

## La città simulata (API della demo)

Quando l'API è accesa (`python avvia.py` o `docker compose up -d` in `c5-agentic-city`), la città espone lo stato degli agenti:

| Endpoint | Cosa fa |
|---|---|
| `GET  $C5_API/stato` | ora simulata, meteo, folla per zona (persone e livello), offerte delle imprese, avvisi, KPI del traffico |
| `POST $C5_API/chiedi {"utente": "...", "testo": "..."}` | risposta dell'assistente personale, con negoziazione con le imprese |
| `GET  $C5_API/notifiche?utente=...` | avvisi proattivi per quell'utente |

I numeri dell'API sono **simulati**: dillo quando li usi.
