---
name: napoli-luoghi-mappe
description: Trovare luoghi e indirizzi a Napoli, coordinate, distanze e percorsi in auto, quartieri e municipalità, farmacie, parcheggi e punti di interesse da OpenStreetMap. Usala per "dov'è…", "quanto dista…", "in che quartiere è…", "farmacia vicino a…".
---

# Luoghi e mappe di Napoli

## 1. Da nome o indirizzo a coordinate: Nominatim (OpenStreetMap, ODbL)

Al massimo 1 richiesta al secondo, con User-Agent. Tieni i risultati in cache.

```bash
curl -s -A 'TwinCiro/1.0' 'https://nominatim.openstreetmap.org/search?q=Molo+Beverello+Napoli&format=json&limit=1'
curl -s -A 'TwinCiro/1.0' 'https://nominatim.openstreetmap.org/reverse?lat=40.8329&lon=14.2349&format=json'
```

Per i 10 luoghi della demo usa direttamente le coordinate del [README delle skill](../README.md).

## 2. Percorso in auto: OSRM (server dimostrativo, a volte non risponde)

```bash
curl -s 'https://router.project-osrm.org/route/v1/driving/14.2183,40.8288;14.2537,40.8383?overview=false'
```

- Ordine delle coordinate `lon,lat;lon,lat`. Distanza in `routes[0].distance` (metri), durata in `routes[0].duration` (secondi).
- **È la durata senza traffico.** Il traffico urbano reale non è disponibile: dillo.
- A piedi: `/route/v1/foot/...` (dove disponibile). Altrimenti stima 5 km/h.
- Per i mezzi pubblici usa la skill `napoli-trasporti`.

## 3. Punti di interesse e dati grezzi OSM

Overpass è instabile (server principale e mirror):

```bash
curl -s --data-urlencode 'data=[out:json][timeout:25];node(around:500,40.8359,14.2488)[amenity=pharmacy];out;' https://maps.mail.ru/osm/tools/overpass/api/interpreter
```

Se non risponde, usa l'API OSM per un'area piccola (massimo qualche km²):

```bash
curl -s 'https://api.openstreetmap.org/api/0.6/map?bbox=14.240,40.832,14.256,40.840'
```

## 4. Farmacie: Ministero della Salute (IODL 2.0)

Elenco nazionale con coordinate, aggiornato ogni giorno: a Napoli 318 farmacie attive, 314 con coordinate. Il nome del file del giorno va letto dalla pagina: `https://www.dati.salute.gov.it/it/dataset/farmacie/`. È un CSV con separatore `;`, da filtrare sul comune di Napoli.

**Non ci sono turni né orari**: per la farmacia di turno rimanda ai canali ufficiali.

## 5. Quartieri e municipalità: ISTAT (CC BY 4.0)

- 30 quartieri e 10 municipalità, con popolazione 2021: `https://www.istat.it/wp-content/uploads/2025/04/ASC_21.zip` (shapefile, da convertire una volta in GeoJSON).
- Popolazione di alcuni quartieri: Chiaia 40.730, San Ferdinando 26.163, Vomero 46.437, Fuorigrotta 67.608.
- Residenti del Comune al 1° gennaio 2026: 905.050 (ISTAT).
- Sedi delle municipalità (IndicePA, senza coordinate): `https://indicepa.gov.it/ipa-dati/api/3/action/datastore_search?resource_id=b0aa1f6c-f135-4c8a-b416-396fed4e1a5d&filters={"Codice_IPA":"c_f839"}&limit=1000`.

## 6. Cataloghi da cui cercare altri dati

- Comune di Napoli (CKAN, 40 dataset): `https://dati.comune.napoli.it/api/3/action/package_list`. È intermittente.
- dati.gov.it: `https://www.dati.gov.it/opendata/api/3/action/package_search?fq=organization:comune-di-napoli&rows=1000`.

## Come rispondere

*"Il Molo Beverello è a 1,2 km da Piazza del Plebiscito: circa 15 minuti a piedi lungo via Acton. In auto 4 minuti senza traffico (OSRM), ma oggi meglio a piedi."*
