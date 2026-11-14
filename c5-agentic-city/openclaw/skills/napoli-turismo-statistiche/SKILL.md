---
name: napoli-turismo-statistiche
description: Numeri reali su turismo e affluenza a Napoli: visitatori mensili dei siti comunali e dei musei, arrivi e presenze turistiche ISTAT, passeggeri del porto e dell'aeroporto, annunci Airbnb, interesse online. Usala per "quanta gente va a…", "quando c'è meno folla", "quanti turisti ci sono a novembre", e per i numeri del pitch.
---

# Turismo e statistiche di Napoli

> **Riserva.** Prima prova la skill `napoli-citta-dati` (API dati città): ha gli stessi dati con cache e fonte già pronta. Usa questa skill solo se l'API non risponde, o per i dati che l'API non ha.

Sono **dati storici** (mensili o annuali), non presenze in tempo reale. Servono a dire "di solito" e "rispetto alla media". **Le presenze in tempo reale da rete mobile non sono pubbliche**: nella demo sono simulate, e sono il dato che chiediamo a Fastweb + Vodafone.

## 1. Visitatori dei siti comunali (CKAN del Comune, CC BY)

Il server è lento (9–55 secondi): usa la cache per tutta la giornata.

```bash
# elenco dei dataset dei visitatori
curl -s 'https://dati.comune.napoli.it/api/3/action/package_search?q=visitatori&rows=20'
# Maschio Angioino (Castel Nuovo), 2025
curl -s 'https://dati.comune.napoli.it/api/3/action/datastore_search?resource_id=765e5b88-898a-4488-a7ba-337d4ecc2cf0'
```

- Siti: Maschio Angioino, Castel dell'Ovo, PAN, San Domenico Maggiore, San Severo al Pendino, Casina Pompeiana, Pausilypon, Real Casa dell'Annunziata.
- Campi: `MESE`, `ANNO`, `Nro VISITATORI`, `Nota`.
- Esempio: Castel Nuovo nel 2025 ha avuto 196.835 visitatori, con il picco ad aprile (25.712) e 9.634 a novembre.
- **Castel dell'Ovo** è a zero nel 2024-2025 perché chiuso per lavori: per un riferimento usa il 2019 (233.500, valori arrotondati) e dillo.
- Alcuni valori hanno il punto delle migliaia ("1.279").

## 2. Turismo nella provincia: ISTAT (CC BY 4.0, SDMX)

```bash
curl -s -H 'Accept: application/vnd.sdmx.data+csv;version=1.0.0' \
  'https://esploradati.istat.it/SDMXWS/rest/data/122_54_DF_DCSC_TUR_3/M.ITF33.........?startPeriod=2024-06'
```

- `DATA_TYPE`: AR = arrivi, NI = presenze. Valore in `OBS_VALUE`.
- Esempi 2025: agosto 526.896 arrivi e 2.229.023 presenze; gennaio 124.235 arrivi e 399.848 presenze. Novembre vale circa la metà della media annua.
- Il dato arriva con circa 11 mesi di ritardo e c'è solo per la provincia (ITF33).

Eurostat, presenze turistiche della Campania (ITF3):

```bash
curl -s 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/tour_occ_nim?geo=ITF3&format=JSON&lastTimePeriod=12'
```

## 3. Musei statali e luoghi famosi (Wikidata, CC0)

Per MANN, Capodimonte, Palazzo Reale, Sant'Elmo e San Martino. Esempi: MANN 532.985 visitatori nel 2024, Capodimonte 151.559 nel 2024, Cappella Sansevero 558.895 nel 2022.

```bash
curl -s -G https://query.wikidata.org/sparql -H 'Accept: application/sparql-results+json' --data-urlencode \
  'query=SELECT ?item ?itemLabel ?visitors ?time WHERE { ?item wdt:P131 wd:Q2634; p:P1174 ?st. ?st ps:P1174 ?visitors. OPTIONAL{?st pq:P585 ?time} SERVICE wikibase:label { bd:serviceParam wikibase:language "it,en". } }'
```

Togli i duplicati e usa l'anno più recente per ogni luogo.

## 4. Porto e aeroporto

- **Porto (AdSP Mar Tirreno Centrale)**, bollettini in PDF, diritti riservati: cita pochi numeri aggregati.
  - Nel 2025: 6.654.994 passeggeri locali del golfo e 1.829.254 crocieristi.
  - Bollettino: `https://adsptirrenocentrale.it/wp-content/uploads/2026/03/12_Bollettino-statistico-12-mesi-2025.pdf`.
- **Aeroporto di Capodichino (Assaeroporti)**: 1.483.050 passeggeri a settembre 2026. XLSX mensile su `https://data-upload.assaeroporti.com/download-export/2026/9`.

## 5. Dove dormono i turisti: Inside Airbnb (CC BY 4.0)

```bash
curl -s 'https://data.insideairbnb.com/italy/campania/naples/2026-09-19/visualisations/listings.csv'
```

11.737 annunci geolocalizzati, istantanea del 19/09/2026. Usa solo dati aggregati per quartiere, mai i singoli annunci.

## 6. Interesse online: Wikipedia (CC0)

```bash
curl -s -A 'TwinCiro/1.0' 'https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/it.wikipedia/all-access/user/Castel_dell%27Ovo/daily/20261101/20261113'
```

Misura l'interesse, **non** le presenze: dillo.

## Come rispondere

*"Il Maschio Angioino a novembre è tranquillo: circa 9.600 visitatori al mese nel 2025, contro i 25.700 di aprile (Comune di Napoli). La folla che vedi nella mappa di TwinCiro invece è una stima simulata."*
