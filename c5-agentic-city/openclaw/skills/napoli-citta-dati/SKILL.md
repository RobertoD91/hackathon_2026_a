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
