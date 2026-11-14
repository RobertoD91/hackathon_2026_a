---
name: napoli-eventi
description: Eventi reali a Napoli: agenda del Comune, partite del Napoli al Maradona, navi da crociera in porto, calendario dell'America's Cup 2027, festività. Usala per "cosa c'è oggi/stasera/questo weekend", "quando gioca il Napoli", "quante navi arrivano", "quando è la regata".
---

# Eventi a Napoli

> **Riserva.** Prima prova la skill `napoli-citta-dati` (API dati città): ha gli stessi dati con cache e fonte già pronta. Usa questa skill solo se l'API non risponde, o per i dati che l'API non ha.

## 1. Agenda del Comune (CC BY 4.0, senza CORS: leggila dal server, cache 30 minuti)

```bash
curl -s 'https://www.comune.napoli.it/wp-json/api/v1/news'
```

- Gli ultimi 10 eventi. Campi: `titolo`, `data_orario_inizio` e `data_orario_fine`, `luogo_evento.title`/`luogo_evento.address`, `tipo_evento`, `costi`, `descrizione_breve`.
- **Attenzione agli orari:** gli epoch sono l'ora locale scritta come se fosse UTC. Decodificali in UTC e mostrali così: 1794735000 = "15/11 ore 9:30".
- Non c'è paginazione né coordinate. Spesso c'è solo un indirizzo testuale da abbinare al luogo (Lungomare, Rotonda Diaz, Piazza Municipio…).

## 2. Calcio: Napoli al Maradona

```bash
curl -s 'https://raw.githubusercontent.com/openfootball/football.json/master/2026-27/it.1.json'
curl -s 'https://www.thesportsdb.com/api/v1/json/123/eventsnext.php?id=133670'
curl -s 'https://www.thesportsdb.com/api/v1/json/123/eventslast.php?id=133670'
```

- openfootball (CC0): `matches[]` con `round`, `date`, `time` (ora italiana), `team1`, `team2`, `score`. Gli orari delle giornate lontane possono essere null.
- TheSportsDB (chiave pubblica di prova "123", 30 richieste al minuto, citare la fonte): `strEvent`, `dateEvent`, `strTime` **in UTC** (19:45 UTC = 20:45 in Italia).
- Partita in casa: la folla al Maradona e sulla Linea 2 cresce da 3 ore prima a 3 ore dopo il calcio d'inizio.

## 3. Navi da crociera (Cruise Timetables: sito privato, non ufficiale)

```bash
curl -s -A 'Mozilla/5.0' 'https://www.cruisetimetables.com/cruises-to-naples-italy.xml'
```

- RSS in ISO-8859-1: un elemento per ogni giorno con navi in porto. `title` contiene la data ("Cruises To Naples, Italy on 16 Nov 2026"), `description` le compagnie e le navi.
- Senza User-Agent da browser risponde 403.
- **Dichiara che la fonte non è ufficiale**: è l'unico calendario degli scali che abbiamo trovato.

## 4. America's Cup 2027 (calendario ufficiale)

```bash
curl -s --compressed -A 'Mozilla/5.0' 'https://www.americascup.com/json/schedule-ac38.json'
```

- 52 voci con `time`, `date_to`, `title` (Fleet race, Match race, Reserve day), `short_text`.
- Date principali:
  - Louis Vuitton Cup dal 22/05/2027, finale dal 26/06 al 04/07;
  - Youth America's Cup dal 02 al 07/06;
  - Women's America's Cup dal 05 al 12/07;
  - Match il 10, 11, 14, 16, 17, 18 e 19/07, con riserva il 13, il 15 e il 20/07.
- Gli orari 12:00–14:00 del file sembrano segnaposto: usa solo i giorni.
- Nel 2026 a Napoli non si è corsa nessuna regata preliminare. La giornata di festa della demo è uno **scenario simulato** del 2027.

## 5. Festività

```bash
curl -s 'https://date.nager.at/api/v3/PublicHolidays/2027/IT'
```

Manca San Gennaro (19 settembre): aggiungilo a mano.

## Come rispondere

*"Oggi sul Lungomare c'è Tri Gold Caracciolo (Comune di Napoli): zona Rotonda Diaz più affollata del solito. Il Napoli gioca in casa sabato 21 alle 20:45 contro il Torino (TheSportsDB): per lo stadio meglio la Linea 2."*
