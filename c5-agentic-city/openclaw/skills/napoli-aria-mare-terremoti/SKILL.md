---
name: napoli-aria-mare-terremoti
description: Qualità dell'aria (AQI, PM10, PM2.5, NO2, pollini), condizioni del mare (onde, temperatura dell'acqua), qualità delle acque di balneazione e terremoti dei Campi Flegrei. Usala per domande su aria, smog, allergie, mare, se si può fare il bagno, bradisismo.
---

# Aria, mare e terremoti a Napoli

## 1. Qualità dell'aria: Open-Meteo Air Quality (Copernicus CAMS, CC BY 4.0)

```bash
curl -s 'https://air-quality-api.open-meteo.com/v1/air-quality?latitude=40.8359&longitude=14.2488&current=european_aqi,pm10,pm2_5,nitrogen_dioxide,ozone,olive_pollen,grass_pollen,uv_index&timezone=Europe/Rome'
```

- `european_aqi`: 0-20 buona, 20-40 discreta, 40-60 moderata, 60-80 scadente, 80-100 molto scadente, oltre 100 pessima.
- La griglia è di 11 km, quindi tutta Napoli ha lo stesso valore: è il **fondo regionale**, non la singola strada. Dillo.
- Con `domains=cams_europe` l'UV è null: chiedilo senza `domains`.

**Centraline ARPAC** (misure vere, con 3-4 ore di ritardo): arrivano dall'European Environment Agency in file Parquet, senza CORS. Le legge solo un job sul server: se il team pubblica un JSON derivato, usa quello. Stazioni principali:
- IT0898A centro (Spaccanapoli);
- IT1491A Garibaldi;
- IT1496A Vomero;
- IT1497A Sanità;
- IT2221A Fuorigrotta (Maradona).

## 2. Mare: Open-Meteo Marine (CC BY 4.0)

```bash
curl -s 'https://marine-api.open-meteo.com/v1/marine?latitude=40.83&longitude=14.24&current=wave_height,wave_direction,wave_period,sea_surface_temperature&hourly=wave_height&timezone=Europe/Rome&forecast_days=1'
```

- `wave_height` in metri, `sea_surface_temperature` in °C.
- Tutta la costa cittadina finisce in una sola cella, al largo di Posillipo.
- Per la regata: onda sotto 1,8 m (ipotesi nostra).

Onde più dettagliate vicino alla costa: meteo@uniparthenope, `https://api.meteo.uniparthenope.it/products/ww33/forecast/ca004`.

## 3. Balneazione: EEA Bathing Water 2025

```bash
curl -s "https://water.discomap.eea.europa.eu/arcgis/rest/services/BathingWater/BathingWater_Dyna_WM_2025/MapServer/3/query?where=bathingWaterIdentifier%20LIKE%20'IT015063049%25'&outFields=*&outSR=4326&f=json"
```

Sono 11 siti di Napoli con la classe 2025: 9 eccellenti, Via Partenope buona, Pietrarsa scarsa. È una **classificazione annuale**, non il prelievo di oggi.

## 4. Terremoti: INGV (CC BY 4.0, tempo reale)

Eventi nell'area di Napoli e dei Campi Flegrei. Metti una data di inizio recente:

```bash
curl -s 'https://webservices.ingv.it/fdsnws/event/1/query?starttime=2026-11-01T00:00:00&minlat=40.75&maxlat=40.90&minlon=14.00&maxlon=14.25&minmag=0&format=geojson&orderby=time&limit=50'
```

Campi in `features[].properties`: `mag`, `magType`, `place`, `time`. La profondità è in `geometry.coordinates[2]`.

**Tono:** informa senza allarmare. Le piccole scosse ai Campi Flegrei sono frequenti (bradisismo). Per la sicurezza rimanda sempre alla Protezione Civile.

## Altre fonti, usate poco

- **Sensor.Community** (sensori dei cittadini): `https://data.sensor.community/airrohr/v1/filter/area=40.85,14.25,20`. Dentro il Comune non ci sono sensori, solo nell'area vesuviana.
- **WAQI** (serve una chiave; vietato tenere i dati in cache) e **OpenAQ** (serve una chiave): non usarle senza chiave.

## Come rispondere

*"Aria discreta oggi (AQI europeo 32, Copernicus via Open-Meteo: è il valore medio dell'area). Mare calmo, onda 0,4 m. Ieri due microscosse ai Campi Flegrei, la più forte Md 1.8 (INGV)."*
