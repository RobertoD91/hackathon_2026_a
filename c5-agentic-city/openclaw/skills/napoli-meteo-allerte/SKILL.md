---
name: napoli-meteo-allerte
description: Meteo reale a Napoli (temperatura, pioggia, vento, previsioni orarie) e allerte ufficiali della Protezione Civile Campania e di Meteoalarm. Usala per domande su che tempo fa o farà, se piove, se c'è vento per la regata, se c'è un'allerta meteo.
---

# Meteo e allerte a Napoli

> **Riserva.** Prima prova la skill `napoli-citta-dati` (API dati città): ha gli stessi dati con cache e fonte già pronta. Usa questa skill solo se l'API non risponde, o per i dati che l'API non ha.

## 1. Meteo: Open-Meteo (senza chiave, CC BY 4.0, uso non commerciale)

Più luoghi in una sola chiamata, separando le coordinate con la virgola. La risposta è un array, un elemento per luogo. Con `models=italia_meteo_arpae_icon_2i` (modello italiano a 2,2 km) i luoghi hanno valori diversi; senza, finiscono tutti nella stessa cella.

```bash
curl -s 'https://api.open-meteo.com/v1/forecast?latitude=40.8359,40.8329,40.8280&longitude=14.2488,14.2349,14.1930&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,uv_index&hourly=precipitation_probability,temperature_2m&wind_speed_unit=kn&timezone=Europe/Rome&forecast_days=2&models=italia_meteo_arpae_icon_2i'
```

Campi:
- `current.temperature_2m` (°C), `apparent_temperature`;
- `precipitation` (mm), `precipitation_probability` (%);
- `weather_code` (codici WMO: 0 sereno, 1-3 nuvoloso, 45/48 nebbia, 51-67 pioggia, 80-82 rovesci, 95-99 temporale);
- `wind_speed_10m` e `wind_gusts_10m` (nodi, con `wind_speed_unit=kn`).

Se manca un campo con ICON-2I (es. `uv_index`), richiedilo senza `models`.

**Regata:** per l'America's Cup consideriamo buone le condizioni con vento 6–22 nodi e raffiche sotto 30. È un'ipotesi nostra: dillo.

**Limiti:** ogni coordinata costa una chiamata. Massimo 10.000 al giorno; tieni la risposta in cache 15 minuti. Se risponde **429**, usa la riserva.

**Riserva: MET Norway** (CC BY 4.0). User-Agent obbligatorio, coordinate con al massimo 4 decimali, rispetta l'header Expires:

```bash
curl -s -A 'TwinCiro/1.0' 'https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=40.8359&lon=14.2488'
```

Il valore attuale è in `properties.timeseries[0].data.instant.details` (`air_temperature`, `wind_speed` in m/s). La pioggia della prossima ora è in `next_1_hours.details.precipitation_amount`.

**Previsioni "fatte a Napoli": meteo@uniparthenope** (WRF; orari in UTC; dati "as is", citare la fonte):

```bash
curl -s 'https://api.meteo.uniparthenope.it/products/wrf5/forecast/com63049'
curl -s 'https://api.meteo.uniparthenope.it/products/wrf5/timeseries/com63049?hours=24&step=1'
```

## 2. Allerta ufficiale: Protezione Civile Regione Campania (Centro Funzionale)

È la fonte ufficiale: usala prima di Meteoalarm. Napoli è la **Zona 1**.

```bash
BASE=https://centrofunzionale.regione.campania.it/CentroFunzionalePortaleRest/rest
curl -s $BASE/bollettinometeo/findLastAllertaNew          # ultimo avviso: idBollettino, livello, urlPdf
curl -s $BASE/bollettinometeo/findByIdZona/1/<idBollettino> # dettaglio per Napoli
curl -s $BASE/bollettinometeo/findAllertaDomaniNew        # avviso per domani
```

- `livello`: 1 verde, 2 giallo, 3 arancione, 4 rosso. Testi in `livelloDesc` e `tipoDesc`; validità in `dataDa` e `dataA`.
- Il livello di Napoli va letto da `findByIdZona/1/...`, perché `findLastAllertaNew` non dice la zona. Il dettaglio ha anche `piogge`, `mare`, `fenomeni` e `scenari` in italiano.
- L'API non è documentata e può cambiare. Licenza: "Copyright Protezione Civile Regione Campania", va citata.
- Gli avvisi escono di solito in tarda mattinata (10:30–11:30).

**Seconda fonte: Meteoalarm** (EUMETNET, su dati dell'Aeronautica Militare). Ha i testi anche in inglese, utili per i turisti:

```bash
curl -s 'https://feeds.meteoalarm.org/api/v1/warnings/feeds-italy'
```

Filtra la Campania e gli avvisi validi adesso (`onset` ≤ ora < `expires`).

## Come rispondere

- *"Adesso a Mergellina 18 °C, vento 14 nodi da ovest (Open-Meteo, ore 15:00). Nessuna allerta per Napoli (Protezione Civile Campania)."*
- Con allerta **gialla o superiore**: mettila all'inizio della risposta, con fenomeni e orari, e invita a seguire i canali ufficiali.
