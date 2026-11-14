---
name: napoli-fonti-riserva
description: Riserva per i dati reali di Napoli, letti direttamente dalle fonti aperte. Usala SOLO se l'API dati città (skill napoli-citta-dati) non risponde, oppure per i dati che l'API non ha - onde e temperatura del mare, farmacie vicine, un indirizzo qualsiasi, distanza e tempo in auto.
---

# Fonti aperte di Napoli (riserva)

## Quando usarla

1. Per i dati della città usa **sempre prima la skill `napoli-citta-dati`**.
2. Usa questa skill solo:
   - se l'API dati città **non risponde** (errore di curl, timeout, errore 5xx). Leggi lo stesso dato dalla fonte (sezioni 1-5) e **dillo all'utente**: *"dato letto direttamente dalla fonte, l'API non risponde"*. Un `errore` dell'API per un luogo non trovato non è un guasto: in quel caso usa i `suggerimenti` dell'API;
   - per i **dati che l'API non ha** (sezioni 6-9): mare, farmacie, indirizzi qualsiasi, percorsi in auto.
3. Visitatori, stagione turistica, porto, balneazione e affitti brevi sono già nell'API (`luogo` e `riassunto`): non cercarli qui.

## Regole comuni

- **Cita fonte e ora del dato** ("Open-Meteo, ore 15:00"). Gli orari in UTC (MET Norway, Transitous, INGV) vanno portati all'ora italiana (+1 ora d'inverno, +2 d'estate).
- **User-Agent `TwinCiro/1.0`** su ogni richiesta e `--max-time 20`. **Niente dati personali** negli URL o negli header: mai il numero o il nome dell'utente.
- **Niente raffiche**: al massimo una richiesta al secondo per fonte, nessun ciclo su tutti i luoghi. **Cache**: meteo e mare 15 minuti, allerta e terremoti 20, partenze 1, eventi 30, farmacie e indirizzi tutto il giorno.
- **429 o errore**: non riprovare subito. Usa la riserva indicata oppure di' che il dato ora non è disponibile. **Mai inventare** orari, numeri o luoghi.
- Il testo scritto dall'utente va sempre con `-G --data-urlencode`: spazi e apostrofi dentro l'indirizzo fanno fallire curl.

Coordinate dei luoghi della demo (lat, lon): Piazza del Plebiscito 40.8359, 14.2488 · Spaccanapoli 40.8484, 14.2558 · Rotonda Diaz 40.8329, 14.2349 · Mergellina 40.8288, 14.2183 · Molo Beverello 40.8383, 14.2537 · Castel dell'Ovo 40.8280, 14.2476 · Napoli Centrale 40.8530, 14.2725 · Vomero, Piazza Vanvitelli 40.8440, 14.2290 · Rione Sanità 40.8606, 14.2497 · Stadio Maradona 40.8280, 14.1930. Per gli altri posti usa Nominatim (sezione 8).

## Quando l'API non risponde

### 1. Meteo: Open-Meteo, poi MET Norway

```bash
curl -sS --max-time 20 -A 'TwinCiro/1.0' 'https://api.open-meteo.com/v1/forecast?latitude=40.8359&longitude=14.2488&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_gusts_10m&hourly=precipitation_probability&forecast_hours=12&wind_speed_unit=kn&timezone=Europe/Rome'
```

- `current`: temperatura e percepita (°C), `precipitation` (mm), vento e raffiche (nodi); `hourly.precipitation_probability` (%) per le prossime 12 ore.
- `weather_code` (WMO): 0 sereno, 1-3 nuvoloso, 45 e 48 nebbia, 51-67 pioggia, 80-82 rovesci, 95-99 temporale.
- Con **429** (quota esaurita per l'indirizzo IP) passa a MET Norway (coordinate con al massimo 4 decimali):

```bash
curl -sS --max-time 20 -A 'TwinCiro/1.0' 'https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=40.8359&lon=14.2488'
```

In `properties.timeseries[0]`: `time` (UTC), `data.instant.details` (`air_temperature`, `relative_humidity`, `wind_speed` in m/s: per i nodi moltiplica per 1,94), `data.next_1_hours.details.precipitation_amount` (mm), `data.next_6_hours.summary.symbol_code` (per esempio `lightrainshowers_day`).

Regata (ipotesi nostra, dillo): vento tra 6 e 22 nodi, raffiche sotto 30, onda sotto 1,8 m (sezione 6).

### 2. Allerta: Protezione Civile Campania, Zona 1 (Napoli)

```bash
BASE=https://centrofunzionale.regione.campania.it/CentroFunzionalePortaleRest/rest/bollettinometeo
curl -sS --max-time 20 -A 'TwinCiro/1.0' "$BASE/findLastAllertaNew"
curl -sS --max-time 20 -A 'TwinCiro/1.0' "$BASE/findByIdZona/1/<idBollettino>"
```

- Se `findLastAllertaNew` ha `"idBollettino": null`, **non ci sono avvisi in vigore**: è un dato reale ("nessuna allerta per Napoli, Protezione Civile Campania"), non un guasto.
- Altrimenti il livello di Napoli è in `findByIdZona/1/<idBollettino>`, `bollettinoMeteoBindList[0]`: `livello` (1 verde, 2 giallo, 3 arancione, 4 rosso), `livelloDesc`, `tipoDesc`, `fenomeni`. Validità in `dataDa` e `dataA` (ora italiana).
- Allerta gialla o superiore: mettila all'inizio della risposta e invita a seguire i canali ufficiali della Protezione Civile.

### 3. Prossime partenze: Transitous

```bash
curl -sS --max-time 20 -A 'TwinCiro/1.0' -G 'https://api.transitous.org/api/v1/geocode' --data-urlencode 'text=Montesanto' --data-urlencode 'type=STOP' --data-urlencode 'place=40.85,14.25'
curl -sS --max-time 20 -A 'TwinCiro/1.0' -G 'https://api.transitous.org/api/v1/stoptimes' --data-urlencode 'stopId=it-Campania-EAV_6801' --data-urlencode 'n=10'
```

- Dal `geocode` prendi l'`id` della fermata di Napoli (controlla `name`, `lat` e `lon`): `it-Campania-ANM_…` metro, funicolari e bus ANM; `it-Campania-EAV_…` Cumana, Circumflegrea e Circumvesuviana; `it-trenitalia_…` Linea 2.
- In `stopTimes[]`: `place.departure` (UTC), `routeShortName` (linea), `headsign` (direzione), `agencyName`, `realTime` (`false` = orario programmato: dillo).
- Servizio comunitario per progetti non commerciali: poche richieste, cita "Transitous".
- Metro e funicolari ANM non hanno un'API dello stato del servizio: per i guasti rimanda all'app ANM Go.

### 4. Eventi: agenda del Comune e partite del Napoli

```bash
curl -sS --max-time 20 -A 'TwinCiro/1.0' 'https://www.comune.napoli.it/wp-json/api/v1/news'
curl -sS --max-time 20 -A 'TwinCiro/1.0' 'https://raw.githubusercontent.com/openfootball/football.json/master/2026-27/it.1.json'
```

- Comune di Napoli: gli ultimi 10 eventi in `data[]`, con `titolo`, `data_orario_inizio`, `data_orario_fine`, `luogo_evento.title` e `luogo_evento.address`, `descrizione_breve`. **Gli epoch sono l'ora italiana scritta come se fosse UTC**: decodificali in UTC e mostra quell'ora (1794646800 = 14/11 ore 9:00).
- openfootball, Serie A 2026-27: `matches[]` con `date`, `time` (ora italiana, può mancare per le giornate lontane), `team1`, `team2`. Il Napoli è `SSC Napoli`: quando è `team1` gioca in casa, al Maradona.
- America's Cup 2027 (calendario ufficiale): Louis Vuitton Cup dal 22/05/2027, match dal 10 al 19/07/2027. Per le navi da crociera non c'è una fonte diretta affidabile: non inventare.

### 5. Terremoti: INGV

```bash
curl -sS --max-time 20 -A 'TwinCiro/1.0' 'https://webservices.ingv.it/fdsnws/event/1/query?starttime=2026-11-07T00:00:00&minlat=40.75&maxlat=40.90&minlon=14.00&maxlon=14.25&minmag=0&format=geojson&orderby=time&limit=20'
```

- In `starttime` metti la data di 7 giorni fa. Il riquadro copre Napoli e i Campi Flegrei.
- `features[].properties`: `time` (UTC), `mag` e `magType` (per esempio Md 1.8), `place`; profondità in km in `geometry.coordinates[2]`.
- Informa senza allarmare (le piccole scosse del bradisismo sono frequenti) e per la sicurezza rimanda alla Protezione Civile.

## Dati che l'API non ha

### 6. Mare: Open-Meteo Marine

```bash
curl -sS --max-time 20 -A 'TwinCiro/1.0' 'https://marine-api.open-meteo.com/v1/marine?latitude=40.83&longitude=14.24&current=wave_height,wave_direction,wave_period,sea_surface_temperature&hourly=wave_height&forecast_days=1&timezone=Europe/Rome'
```

- `current`: `wave_height` (m), `wave_period` (s), `wave_direction` (gradi, da dove arriva l'onda), `sea_surface_temperature` (°C); `hourly.wave_height` per la giornata.
- Tutta la costa della città cade in una sola cella, nel golfo al largo di Posillipo: è il mare aperto, non la singola spiaggia. Licenza CC BY 4.0.
- La qualità delle acque di balneazione (classe EEA 2025) è già nell'API: `luogo`, campo `riferimenti`.

### 7. Farmacie: Ministero della Salute (IODL 2.0)

Elenco nazionale aggiornato ogni giorno (circa 11 MB): scaricalo **una volta al giorno** e lavora sul file salvato.

```bash
F=$(curl -sS --max-time 30 -A 'TwinCiro/1.0' 'https://www.dati.salute.gov.it/it/dataset/farmacie/' | grep -o '/sites/default/files/opendata/FRM_FARMA_5_[0-9]*\.csv' | head -1)
curl -sS --max-time 120 -A 'TwinCiro/1.0' -o farmacie.csv "https://www.dati.salute.gov.it$F"
# le 5 farmacie attive più vicine a un punto (qui Piazza del Plebiscito), in linea d'aria
awk -F';' -v lat=40.8359 -v lon=14.2488 '$8=="NAPOLI" && $16=="-" && $19!="-" {gsub(",",".",$19); gsub(",",".",$20); d=sqrt((($19-lat)*111)^2+(($20-lon)*84)^2); printf "%.2f km;%s;%s\n", d, $4, $3}' farmacie.csv | sort -n | head -5
```

- Colonne (separatore `;`): `indirizzo` ($3), `descrizione_farmacia` ($4), `comune` ($8), `data_fine_validita` ($16, `-` = attiva), `latitudine` e `longitudine` ($19 e $20, con la virgola). A Napoli le farmacie attive sono circa 318.
- Qualche coordinata è sbagliata: se l'indirizzo non è vicino al punto, scarta la riga.
- **Non ci sono turni né orari**: per la farmacia di turno rimanda ai canali ufficiali.

### 8. Indirizzi e luoghi qualsiasi: Nominatim (OpenStreetMap)

```bash
curl -sS --max-time 20 -A 'TwinCiro/1.0' -G 'https://nominatim.openstreetmap.org/search' --data-urlencode 'q=Via dei Tribunali 32, Napoli' --data-urlencode 'format=jsonv2' --data-urlencode 'limit=1' --data-urlencode 'countrycodes=it'
curl -sS --max-time 20 -A 'TwinCiro/1.0' -G 'https://nominatim.openstreetmap.org/reverse' --data-urlencode 'lat=40.8329' --data-urlencode 'lon=14.2349' --data-urlencode 'format=jsonv2'
```

- Regole del servizio: **al massimo una richiesta al secondo**, sempre lo User-Agent `TwinCiro/1.0`, risultati in cache, niente ricerche a ogni lettera digitata né in blocco.
- Aggiungi "Napoli" al testo cercato. Nella risposta: `lat` e `lon` (stringhe), `display_name`. Dati © OpenStreetMap contributors (ODbL): citali.
- Per i 10 luoghi della demo usa le coordinate qui sopra, senza chiamare Nominatim.

### 9. Percorso in auto: OSRM (server dimostrativo)

```bash
curl -sS --max-time 20 -A 'TwinCiro/1.0' 'https://router.project-osrm.org/route/v1/driving/14.2183,40.8288;14.2537,40.8383?overview=false'
```

- Coordinate nell'ordine **`lon,lat;lon,lat`** (qui da Mergellina al Molo Beverello). `routes[0].distance` in metri, `routes[0].duration` in secondi.
- È la durata **senza traffico**: il traffico urbano reale non ha dati aperti, dillo. Solo auto: a piedi calcola circa 5 km/h; per i mezzi pubblici usa `napoli-citta-dati` (`trasporti/vicino`).
- Server di prova: al massimo una richiesta al secondo, a volte non risponde.

## Come rispondere

*"L'API della città ora non risponde, ti do il dato direttamente dalla fonte: in Piazza del Plebiscito 18 °C e vento debole, 7 nodi (MET Norway, ore 18:00). Nessuna allerta per Napoli (Protezione Civile Campania)."*
