---
name: napoli-trasporti
description: Trasporti pubblici e mobilità a Napoli: prossime partenze di metro (L1, L2, L6), funicolari, treni EAV (Circumvesuviana, Cumana, Circumflegrea) e Trenitalia, avvisi di guasti e scioperi, ritardi dei treni, code in tangenziale, parcheggi ANM. Usala per "come arrivo a…", "quando passa…", "c'è sciopero?", "dove parcheggio?".
---

# Trasporti a Napoli

## 1. Prossime partenze e itinerari: Transitous (con CORS, senza chiave)

Raccoglie più operatori: ANM, EAV, Trenitalia (con la Linea 2). Servizio comunitario best-effort per progetti non commerciali e leggeri: usalo con parsimonia e **cita transitous.org/sources**.

```bash
# trova la fermata
curl -s -A 'TwinCiro/1.0' 'https://api.transitous.org/api/v1/geocode?text=Napoli%20Piazza%20Garibaldi&type=STOP'
# prossime 10 partenze da una fermata
curl -s -A 'TwinCiro/1.0' 'https://api.transitous.org/api/v1/stoptimes?stopId=it-trenitalia_09109:station&n=10'
```

- Esempi di `stopId`:
  - `it-Campania-ANM_6271`: Piazza Garibaldi ANM;
  - `it-trenitalia_09109:station`: Napoli Piazza Garibaldi, Linea 2;
  - `it-Campania-EAV_6003`: Napoli P. Garibaldi EAV.
- Per un itinerario da A a B c'è `/api/v1/plan`.
- Di notte `realTime=false`: sono gli orari programmati, dillo.

## 2. Linee e stazioni: GTFS ANM ed EAV (statici)

- **ANM** (metro L1 e L6, L2 come agency FS, funicolari F1, F3 e F4, tram, filobus, bus). Copia con CORS: `https://files.mobilitydatabase.org/mdb-893/latest.zip`. Ufficiale: `https://www.anm.it/google/google-transit.zip`.
- **EAV** (Circumvesuviana, Cumana, Circumflegrea, Metrocampania Nord). Copia: `https://files.mobilitydatabase.org/tld-4833/latest.zip`.
- `route_type`: 1 metro, 7 funicolare, 0 tram, 11 filobus, 3 bus.
- Manca la funicolare di **Montesanto (F2)**. È uno zip pesante: leggilo una volta e tieni solo fermate e corse per ora.
- La mappa del team ha già una versione ridotta (11 linee, 92 stazioni) in `shared/iot-agents/example/dati/`.

Collegamenti utili per i luoghi della demo:
- Linea 1: Municipio (Beverello), Toledo, Dante, Museo, Vanvitelli (Vomero), Garibaldi.
- Linea 2: Mergellina, Piazza Amedeo, Montesanto, Cavour, Garibaldi; Campi Flegrei per lo **stadio Maradona**.
- Linea 6: Mergellina, Arco Mirelli, San Pasquale, Chiaia, Municipio.
- Funicolari: Chiaia (Parco Margherita → Vomero), Mergellina, Centrale (Augusteo → Vomero), Montesanto.

## 3. Avvisi, guasti e scioperi EAV (WordPress, con CORS)

```bash
curl -s 'https://www.eavsrl.it/wp-json/wp/v2/posts?categories=41,21,17,65&per_page=20&_fields=date,title,link,categories'
```

Nei titoli ci sono entità HTML da decodificare. Associa l'avviso alla stazione per nome.

Per ANM (metro, funicolari) **non c'è un'API dello stato del servizio**: c'è solo l'app ANM Go. Non inventare: rimanda all'app o al sito ANM.

## 4. Treni in tempo reale: ViaggiaTreno (RFI, non ufficiale)

```bash
curl -s -A 'Mozilla/5.0' 'http://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno/partenze/S09218/Sat%20Nov%2014%202026%2015%3A00%3A00%20GMT%2B0100'
```

- La data va in formato JavaScript con url-encoding; senza User-Agent da browser risponde 403.
- Codici delle stazioni urbane: Napoli Centrale S09218, Piazza Garibaldi S09109, Mergellina S09105, Montesanto S09107, Piazza Amedeo S09106, Cavour S09108, Leopardi S09104, Campi Flegrei S09103.
- Campi: `numeroTreno`, `destinazione`, `compOrarioPartenza`, `ritardo` (minuti), `binarioProgrammatoPartenzaDescrizione`, `provvedimento` (soppressioni).

## 5. Tangenziale e autostrade: ASPI (con CORS, "tutti i diritti riservati", solo contesto)

```bash
curl -s 'https://viabilita.autostrade.it/json/eventi.json'
```

Filtra A56 Tangenziale di Napoli e gli accessi a Napoli: code, chiusure e cantieri, con `lunghezzaCoda`. **Il traffico delle strade cittadine non ha dati aperti**: non dare numeri sul traffico urbano. Il traffico nell'API della città è simulato e va detto.

## 6. Parcheggi ANM (Comune di Napoli, CC BY 4.0)

```bash
curl -s 'https://dati.comune.napoli.it/dataset/b9b21365-c509-4f4d-92a5-981091447ae8/resource/2e1586f6-5cb8-40ac-9047-2e1ff56d8ee8/download/parcheggi_anm_2025.csv'
```

- CSV con separatore `;`, codifica cp1252: 23 parcheggi con posti, orari, tariffe e coordinate.
- **L'occupazione in tempo reale non è pubblica.**

## 7. Aliscafi dal Beverello

Orari Alilauro (NeTEx) sul NAP nazionale: `https://www.cciss.it/nap/mmtis/public/api/v1/download/blob/Asset/572463/resource`. È XML compresso con gzip e l'id cambia a ogni versione. Se non lo leggi, rimanda ai siti delle compagnie.

## Come rispondere

*"Da Mergellina allo stadio: Linea 2 fino a Campi Flegrei, 5 minuti. Prossime partenze 15:12 e 15:24 (Transitous, orario programmato). Nessun avviso EAV per la Cumana."*
