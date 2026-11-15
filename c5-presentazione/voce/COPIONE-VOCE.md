# Voce fuori campo di TwinCIRO

> Generato da `scene/monta.py` a partire da `scene/scaletta.json`: **non modificarlo a mano**. Per cambiare una battuta cambiala nella scaletta e rilancia `./monta.sh --solo-testi` (un secondo, niente video). Anche i file `NN-<scena>.txt` di questa cartella si rigenerano da soli: una scena per file, con battute, tempi e chi legge.

**2:59 di video · 37 battute · Roberto 19 (1:14 di parlato) · Mario 18 (1:19 di parlato)** · ritmo medio di circa 148 parole al minuto (obiettivo circa 150; il ritmo si conta in sillabe, circa 2 per parola, con sigle e numeri letti per esteso).

## Come registrare

Tre modi, che si possono mescolare. Formati: `.m4a` (Memo Vocali), `.wav`, `.mp3`, `.aac`, `.ogg`, `.flac`. Il montaggio toglie il silenzio all'inizio e alla fine di ogni file e porta tutti i file allo stesso volume.

1. **Una battuta per file** (il più comodo: ognuno registra da solo, quando vuole). Leggi solo le tue battute, una per file, e chiama il file come scritto accanto alla battuta (per esempio `girato/voce/06-chat-2.m4a`). Non serve guardare il video: `monta.sh` mette ogni battuta nel momento in cui compare il suo sottotitolo. Resta nella durata indicata: se una battuta è troppo lunga, `monta.sh` lo dice.
2. **Una clip per file**: `girato/voce/06-chat.m4a`. Guarda la clip senza audio (`clip/06-chat.mp4`, con il suo `.srt` i sottotitoli fanno da gobbo) e leggi quando compaiono. La prima parola va al tempo della prima battuta. Se nella scena parlate tutti e due, registrate insieme.
3. **Tutto in un file**, come prima: `girato/voce.m4a`, guardando `bozza.mp4` senza audio. Se all'inizio c'è silenzio: `./monta.sh --voce-da 1.5` (secondi da saltare).

I file di `girato/voce/` prendono il posto di `girato/voce.m4a` nelle loro scene: per rifare una scena sola basta registrare quella. In una scena i file per battuta vincono sul file della clip. Il numero davanti al nome non conta (vale il nome della scena), e `girato/` resta fuori dal repository. Poi `./monta.sh`: la voce entra in `bozza.mp4`, nelle clip e in `clip/00-finale-senza-sottotitoli.mp4`.

Finché una battuta non è registrata, al suo posto c'è la **voce sintetica di prova** di `audio/voce-sintetica/` (la rigenera `scene/voce_sintetica.py`): il vostro file la sostituisce da solo, battuta per battuta. Non si usa se c'è `girato/voce.m4a` o il file della clip intera. Per sentire solo le voci vere: `./monta.sh --senza-voce-sintetica`.

Consigli: stanza silenziosa e con tende o divani, telefono a 20 cm dalla bocca e un po' di lato, sempre lo stesso telefono per la stessa persona. Tono caldo e sicuro, senza fretta.

## Pronuncia

- *TwinCIRO* = «tuìn cìro»
- *WHY2025* = «uài duemilaventicinque»
- *Wi-Fi* = «uài fai»
- *MQTT* = «emme cu ti ti»
- *IoT* = «ai o ti»
- *API* = «a pi i»
- *Tasmota* = «tasmòta»
- *MIIA* = «emme i i a»
- *AI* = «a i»
- *America's Cup* = «amèrica's cap»
- *Diaz* = «dìaz»
- *Flegrei* = «flegrèi»
- *City Intelligence and Responsive Orchestration* = «sìti intèlligens end rispònsiv orchestrèiscion»
- *13* = «tredici»
- *14* = «quattordici»
- *50* = «cinquanta»
- *1.900* = «millenovecento»

## Il copione, in ordine

### 01 · regata · 0:00,0–0:08,0 (8,0 s)

**ROBERTO** · 0:00,6 → 0:03,0 · 2,4 s · `girato/voce/01-regata-1.m4a`

> Napoli, 2027.

**MARIO** · 0:03,2 → 0:07,7 · 4,5 s · `girato/voce/01-regata-2.m4a`

> Un sabato: America's Cup, navi da crociera e partita al Maradona.

### 02 · motivazione · 0:08,0–0:19,0 (11,0 s)

**ROBERTO** · 0:08,3 → 0:12,3 · 4,0 s · `girato/voce/02-motivazione-1.m4a`

> I dati ci sono. Ma sono sparsi, e non si parlano.

**MARIO** · 0:13,0 → 0:18,7 · 5,7 s · `girato/voce/02-motivazione-2.m4a`

> E manca il dato più importante: quante persone ci sono, adesso, in ogni zona.

### 03 · titolo · 0:19,0–0:26,0 (7,0 s)

**ROBERTO** · 0:19,3 → 0:22,8 · 3,5 s · `girato/voce/03-titolo-1.m4a`

> TwinCIRO: City Intelligence and Responsive Orchestration.

**MARIO** · 0:23,0 → 0:25,7 · 2,7 s · `girato/voce/03-titolo-2.m4a`

> Il gemello di Napoli, che ci pensa.

### 04 · fonti · 0:26,0–0:34,0 (8,0 s)

**ROBERTO** · 0:26,3 → 0:30,1 · 3,8 s · `girato/voce/04-fonti-1.m4a`

> Oltre 50 fonti pubbliche, verificate una per una.

**MARIO** · 0:30,3 → 0:33,8 · 3,5 s · `girato/voce/04-fonti-2.m4a`

> Un catalogo unico, diviso per temi.

### 05 · utenti · 0:34,0–0:40,0 (6,0 s)

**ROBERTO** · 0:34,4 → 0:38,4 · 4,0 s · `girato/voce/05-utenti-1.m4a`

> Due utenti: chi visita Napoli, e chi la governa.

### 06 · chat · 0:40,0–1:18,0 (38,0 s)

**MARIO** · 0:40,5 → 0:44,1 · 3,6 s · `girato/voce/06-chat-1.m4a`

> Marta, in crociera, scrive a TwinCIRO come a un amico.

**ROBERTO** · 0:44,3 → 0:49,0 · 4,7 s · `girato/voce/06-chat-2.m4a`

> TwinCIRO chiede alla pizzeria: alle 13 è piena, propone le 14.

**MARIO** · 0:49,2 → 0:53,3 · 4,1 s · `girato/voce/06-chat-3.m4a`

> Marta dice «ok»: tavolo prenotato, nessuna telefonata.

**ROBERTO** · 0:54,9 → 0:59,7 · 4,8 s · `girato/voce/06-chat-4.m4a`

> Poi TwinCIRO le dice come arrivare alla regata, e quanta gente c'è.

**MARIO** · 1:01,3 → 1:05,1 · 3,8 s · `girato/voce/06-chat-5.m4a`

> Per il meteo usa dati veri, e cita sempre la fonte.

**ROBERTO** · 1:06,5 → 1:10,6 · 4,1 s · `girato/voce/06-chat-6.m4a`

> E quando la Rotonda Diaz si riempie, è TwinCIRO a scrivere per primo:

**ROBERTO** · 1:10,8 → 1:14,0 · 3,2 s · `girato/voce/06-chat-7.m4a`

> c'è un posto più tranquillo, con un'offerta.

### 07 · operatore · 1:18,0–1:32,0 (14,0 s)

**ROBERTO** · 1:18,3 → 1:22,5 · 4,2 s · `girato/voce/07-operatore-1.m4a`

> Quell'avviso passa dalla Polizia Locale, in sala operativa.

**MARIO** · 1:22,8 → 1:27,0 · 4,2 s · `girato/voce/07-operatore-2.m4a`

> Gli agenti propongono: l'operatore approva, o blocca.

**ROBERTO** · 1:27,3 → 1:31,7 · 4,4 s · `girato/voce/07-operatore-3.m4a`

> Nel terminale della sala, la stessa decisione: l'avviso è partito.

### 08 · architettura · 1:32,0–1:43,0 (11,0 s)

**MARIO** · 1:32,3 → 1:37,7 · 5,4 s · `girato/voce/08-architettura-1.m4a`

> Dietro TwinCIRO c'è un sistema multi-agente: agenti specializzati e un orchestratore.

**ROBERTO** · 1:37,9 → 1:42,8 · 4,9 s · `girato/voce/08-architettura-2.m4a`

> Si parlano su MQTT; le fonti pubbliche arrivano dall'API dati città.

### 09 · grafo · 1:43,0–1:52,0 (9,0 s)

**MARIO** · 1:43,3 → 1:47,4 · 4,1 s · `girato/voce/09-grafo-1.m4a`

> Ecco la città come rete: luoghi, eventi, flussi, stazioni.

**ROBERTO** · 1:47,7 → 1:51,7 · 4,0 s · `girato/voce/09-grafo-2.m4a`

> Poi agenti, sensori e fonti, e come sono collegati.

### 10 · adesso · 1:52,0–2:06,0 (14,0 s)

**MARIO** · 1:52,3 → 1:56,2 · 3,9 s · `girato/voce/10-adesso-1.m4a`

> Questa è Napoli adesso: dati veri, ognuno con la sua fonte.

**ROBERTO** · 1:56,4 → 2:00,0 · 3,6 s · `girato/voce/10-adesso-2.m4a`

> Allerte, treni, aria e Campi Flegrei, con l'ora del dato.

**MARIO** · 2:00,3 → 2:05,6 · 5,2 s · `girato/voce/10-adesso-3.m4a`

> Chiedi come arrivare a Città della Scienza: TwinCIRO ti dà stazioni e orari.

### 11 · sensori · 2:06,0–2:14,0 (8,0 s)

**MARIO** · 2:06,3 → 2:10,4 · 4,1 s · `girato/voce/11-sensori-1.m4a`

> Sensori fatti da noi: badge WHY2025 e Tasmota.

**ROBERTO** · 2:10,7 → 2:13,8 · 3,1 s · `girato/voce/11-sensori-2.m4a`

> Oggi in Wi-Fi, domani con una SIM IoT.

### 12 · gemello · 2:14,0–2:23,0 (9,0 s)

**MARIO** · 2:14,3 → 2:18,3 · 4,0 s · `girato/voce/12-gemello-1.m4a`

> Il gemello digitale prova la giornata sulle strade vere.

**ROBERTO** · 2:18,6 → 2:22,6 · 4,0 s · `girato/voce/12-gemello-2.m4a`

> E l'avviso di TwinCIRO arriva quando la Rotonda Diaz si riempie.

### 13 · fastweb · 2:23,0–2:39,0 (16,0 s)

**MARIO** · 2:23,3 → 2:28,0 · 4,7 s · `girato/voce/13-fastweb-1.m4a`

> Con Fastweb e Vodafone la folla non si simula più: si può misurare.

**ROBERTO** · 2:28,3 → 2:32,4 · 4,1 s · `girato/voce/13-fastweb-2.m4a`

> Con le loro SIM IoT, i sensori si mettono dove servono.

**MARIO** · 2:32,7 → 2:38,9 · 6,2 s · `girato/voce/13-fastweb-3.m4a`

> E TwinCIRO può integrare MIIA, l'AI italiana di Fastweb: sovranità digitale.

### 14 · benefici · 2:39,0–2:51,0 (12,0 s)

**ROBERTO** · 2:39,3 → 2:44,4 · 5,1 s · `girato/voce/14-benefici-1.m4a`

> Con un'adesione ipotizzata, un avviso sposta circa 1.900 persone.

**MARIO** · 2:44,7 → 2:50,6 · 5,9 s · `girato/voce/14-benefici-2.m4a`

> Perché Napoli? Nessuna app nuova, i dati ci sono già, e si parte da un quartiere.

### 15 · chiusura · 2:51,0–2:59,0 (8,0 s)

**ROBERTO** · 2:51,4 → 2:54,0 · 2,6 s · `girato/voce/15-chiusura-1.m4a`

> TwinCIRO. Napoli che ci pensa.

**MARIO** · 2:54,3 → 2:57,3 · 3,0 s · `girato/voce/15-chiusura-2.m4a`

> Provalo nel gruppo WhatsApp della demo.

## Solo Roberto (19 battute, 1:14 di parlato)

1. **01-regata-1** · 0:00,6 · 2,4 s — Napoli, 2027.
2. **02-motivazione-1** · 0:08,3 · 4,0 s — I dati ci sono. Ma sono sparsi, e non si parlano.
3. **03-titolo-1** · 0:19,3 · 3,5 s — TwinCIRO: City Intelligence and Responsive Orchestration.
4. **04-fonti-1** · 0:26,3 · 3,8 s — Oltre 50 fonti pubbliche, verificate una per una.
5. **05-utenti-1** · 0:34,4 · 4,0 s — Due utenti: chi visita Napoli, e chi la governa.
6. **06-chat-2** · 0:44,3 · 4,7 s — TwinCIRO chiede alla pizzeria: alle 13 è piena, propone le 14.
7. **06-chat-4** · 0:54,9 · 4,8 s — Poi TwinCIRO le dice come arrivare alla regata, e quanta gente c'è.
8. **06-chat-6** · 1:06,5 · 4,1 s — E quando la Rotonda Diaz si riempie, è TwinCIRO a scrivere per primo:
9. **06-chat-7** · 1:10,8 · 3,2 s — c'è un posto più tranquillo, con un'offerta.
10. **07-operatore-1** · 1:18,3 · 4,2 s — Quell'avviso passa dalla Polizia Locale, in sala operativa.
11. **07-operatore-3** · 1:27,3 · 4,4 s — Nel terminale della sala, la stessa decisione: l'avviso è partito.
12. **08-architettura-2** · 1:37,9 · 4,9 s — Si parlano su MQTT; le fonti pubbliche arrivano dall'API dati città.
13. **09-grafo-2** · 1:47,7 · 4,0 s — Poi agenti, sensori e fonti, e come sono collegati.
14. **10-adesso-2** · 1:56,4 · 3,6 s — Allerte, treni, aria e Campi Flegrei, con l'ora del dato.
15. **11-sensori-2** · 2:10,7 · 3,1 s — Oggi in Wi-Fi, domani con una SIM IoT.
16. **12-gemello-2** · 2:18,6 · 4,0 s — E l'avviso di TwinCIRO arriva quando la Rotonda Diaz si riempie.
17. **13-fastweb-2** · 2:28,3 · 4,1 s — Con le loro SIM IoT, i sensori si mettono dove servono.
18. **14-benefici-1** · 2:39,3 · 5,1 s — Con un'adesione ipotizzata, un avviso sposta circa 1.900 persone.
19. **15-chiusura-1** · 2:51,4 · 2,6 s — TwinCIRO. Napoli che ci pensa.

## Solo Mario (18 battute, 1:19 di parlato)

1. **01-regata-2** · 0:03,2 · 4,5 s — Un sabato: America's Cup, navi da crociera e partita al Maradona.
2. **02-motivazione-2** · 0:13,0 · 5,7 s — E manca il dato più importante: quante persone ci sono, adesso, in ogni zona.
3. **03-titolo-2** · 0:23,0 · 2,7 s — Il gemello di Napoli, che ci pensa.
4. **04-fonti-2** · 0:30,3 · 3,5 s — Un catalogo unico, diviso per temi.
5. **06-chat-1** · 0:40,5 · 3,6 s — Marta, in crociera, scrive a TwinCIRO come a un amico.
6. **06-chat-3** · 0:49,2 · 4,1 s — Marta dice «ok»: tavolo prenotato, nessuna telefonata.
7. **06-chat-5** · 1:01,3 · 3,8 s — Per il meteo usa dati veri, e cita sempre la fonte.
8. **07-operatore-2** · 1:22,8 · 4,2 s — Gli agenti propongono: l'operatore approva, o blocca.
9. **08-architettura-1** · 1:32,3 · 5,4 s — Dietro TwinCIRO c'è un sistema multi-agente: agenti specializzati e un orchestratore.
10. **09-grafo-1** · 1:43,3 · 4,1 s — Ecco la città come rete: luoghi, eventi, flussi, stazioni.
11. **10-adesso-1** · 1:52,3 · 3,9 s — Questa è Napoli adesso: dati veri, ognuno con la sua fonte.
12. **10-adesso-3** · 2:00,3 · 5,2 s — Chiedi come arrivare a Città della Scienza: TwinCIRO ti dà stazioni e orari.
13. **11-sensori-1** · 2:06,3 · 4,1 s — Sensori fatti da noi: badge WHY2025 e Tasmota.
14. **12-gemello-1** · 2:14,3 · 4,0 s — Il gemello digitale prova la giornata sulle strade vere.
15. **13-fastweb-1** · 2:23,3 · 4,7 s — Con Fastweb e Vodafone la folla non si simula più: si può misurare.
16. **13-fastweb-3** · 2:32,7 · 6,2 s — E TwinCIRO può integrare MIIA, l'AI italiana di Fastweb: sovranità digitale.
17. **14-benefici-2** · 2:44,7 · 5,9 s — Perché Napoli? Nessuna app nuova, i dati ci sono già, e si parte da un quartiere.
18. **15-chiusura-2** · 2:54,3 · 3,0 s — Provalo nel gruppo WhatsApp della demo.

## Da controllare

Niente da segnalare: nessuna sovrapposizione, tutte le battute dentro la loro scena e sotto le 180 parole al minuto.
