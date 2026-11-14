# C5 · presentazione di TwinCIRO: video di consegna e mappa

Qui sta la **parte di vetrina** di TwinCIRO (Challenge 05, Fastweb + Vodafone): il video da consegnare e la mappa «Napoli in tempo reale» che compare nel video. Quello che è simulato sta qui e lo dichiara. La città agentica vera è in [`c5-agentic-city/`](../c5-agentic-city/). Il cervello dati di TwinCIRO è l'API [`citta-api/`](../citta-api/README.md).

| Cosa | Dove | Reale o simulato |
|---|---|---|
| Video di consegna (massimo 3 minuti, consegna domenica 15/11 alle 12:00) | [`bozza.mp4`](bozza.mp4), [`copione.md`](copione.md), [`scene/`](scene/), [`monta.sh`](monta.sh) | tabella completa in fondo a [`copione.md`](copione.md#cosa-è-reale-e-cosa-è-simulato-lo-diciamo-anche-nel-video) |
| Riprese vere, voce, musica | [`girato/`](girato/LEGGIMI.md) (fuori dal repository) | vere |
| Mappa «Napoli in tempo reale»: hub, agenti e simulatore Node | [`mappa/`](mappa/README.md) | **folla e sensori simulati**; meteo, aria, trasporti, eventi e allerte **veri** |

## La mappa «Napoli in tempo reale»

La mappa è il **simulatore della presentazione**. Mostra i luoghi di Napoli con affollamento, temperatura, meteo, aria, metro e funicolari, eventi del giorno e allerte, più una dashboard con agenti, decisioni e notifiche.

- **Simulati:** la folla e i sensori. Li genera il simulatore (`citta-api/simulatore/sim-config.json`), con la scala presa dai dati veri e gli scenari accesi dagli eventi reali. In produzione la folla sarebbe il dato anonimo e aggregato della rete mobile di Fastweb + Vodafone. La mappa non legge MQTT e non riceve dati dai dispositivi reali.
- **Veri:** meteo, aria, trasporti, eventi e allerte. Arrivano dagli stessi moduli dell'API dati città (`citta-api/fonti/`, snapshot in `citta-api/dati/`): ne esiste una sola copia, quindi mappa e TwinCIRO vedono gli stessi dati. Ogni valore in pagina ha il suo cartellino (*dal vivo*, *fonte di riserva*, *snapshot*, *simulato*...). Il catalogo delle fonti (oltre 50 fonti pubbliche, verificate una per una) è in [`docs/fonti-dati-napoli.md`](../docs/fonti-dati-napoli.md).
- **Notifiche WhatsApp:** simulate, restano nella dashboard. TwinCIRO vero risponde su WhatsApp con la skill `napoli-citta-dati`, che legge da `citta-api`.

### Aprirla

- **Online** (GitHub Pages, modalità demo: simulatore e agenti girano nel browser): https://robertodisanto.it/hackathon_2026_a/c5-presentazione/mappa/
- **In locale, statica** come su Pages, dalla radice della repo:
  ```bash
  python3 -m http.server 8000      # poi apri http://localhost:8000/c5-presentazione/mappa/
  ```
- **In locale, con il hub** (agenti e simulatore in Node, API `/api/...`):
  ```bash
  node c5-presentazione/mappa/server.js      # poi apri http://localhost:8701/
  node --test c5-presentazione/mappa/test/   # 52 test
  ```

In modalità demo la console mostra un 404 su `/api/state`: è normale, perché la pagina prova prima il hub e, se non risponde, passa alla demo. Dalla sandbox Open-Meteo risponde spesso 429 (IP condiviso): la pagina passa da sola alla fonte di riserva (MET Norway) e lo dichiara. Struttura, API del hub e contratto: [`mappa/README.md`](mappa/README.md) e [`mappa/CONTRATTO.md`](mappa/CONTRATTO.md).

## Il video di consegna

- [`bozza.mp4`](bozza.mp4): la bozza montata. Dura **2:54**, è 1920×1080 a 30 fps, H.264, ha i sottotitoli impressi e pesa meno di 40 MB. Mancano la voce e le riprese vere. Al loro posto ci sono:
  - la chat ricostruita, con le risposte vere dell'API;
  - per l'IoT, due riquadri di riserva: i due dispositivi reali (badge WHY2025 e scheda Tasmota) e il formato unico dei messaggi MQTT.

  **Da rimontare:** nella risposta sul meteo il pannello «dietro le quinte» della bozza mostra ancora «skill napoli-meteo-allerte», una skill che non esiste più. Ora il meteo per TwinCIRO arriva dall'API dati città con la skill `napoli-citta-dati`: `scene/chat.json` e `scene/chat_da_api.py` sono già corretti, e il nome giusto compare al prossimo rimontaggio (basta `./monta.sh`: `chat.json` è nella chiave di cache della scena della chat, che quindi si rigenera da sola). Il video sarà rifatto a breve.
- [`copione.md`](copione.md): scene con i tempi, testi a schermo, voce fuori campo da leggere, **riprese da girare** e tabella di cosa è reale e cosa è simulato.

### Brief

Il feedback dei partner del 14/11 chiede di mettere **l'assistente su WhatsApp al centro** (oggi TwinCIRO): circa due terzi del video, cioè titolo, chat, architettura vista dall'assistente, mappa come sue fonti e il suo avviso sul gemello. Chiede anche di ridimensionare traffico e semafori. Il racconto quindi è questo:

1. una crocerista scrive a TwinCIRO su WhatsApp;
2. TwinCIRO chiede agli agenti della città e **negozia con la pizzeria**: alle 13:00 è piena, propone le 14:00;
3. prenota con un «ok»;
4. usa i dati veri e cita la fonte;
5. **avvisa per primo** quando la Rotonda Diaz si riempie.

Dopo vengono:
- l'architettura, a partire da TwinCIRO;
- i dati reali (mappa), presentati come le fonti di TwinCIRO;
- l'IoT: il badge WHY2025 e la scheda Tasmota sull'hotspot Wi-Fi, che parlano MQTT nel formato degli agenti (`napoli/sensori/<id>/<grandezza>`, `napoli/nodi/<id>/stato`). Si mostrano le riprese vere, oppure i riquadri di riserva;
- il gemello digitale (regata 3D, piaciuta ai partner), con la notifica di TwinCIRO;
- i benefici con i numeri e il perché Napoli dovrebbe adottarla.

Il traffico resta solo in un riquadro dei benefici (−9% medio, con l'intervallo). La scena SUMO affiancata è pronta ma esclusa con `"salta": true` in `scene/scaletta.json`.

### Come rimontarlo

```bash
cd c5-presentazione
./monta.sh                  # rimonta con le scene già generate (cache in $C5_VIDEO_LAVORO, predefinita /tmp/c5-video-lavoro)
./monta.sh --rigenera       # dopo aver cambiato testi, scaletta o chat.json
./monta.sh --rigenera-mappa # registra di nuovo la mappa con i dati di adesso
./monta.sh --controllo      # estrae un fotogramma ogni 5 s per rivedere impaginazione e refusi
./monta.sh --segnaposto     # al posto delle riserve IoT mostra i cartelli «Qui va una ripresa reale»
```

Servono ffmpeg, Node con Playwright e Chromium, e python3 (solo libreria standard). La prima volta ci vogliono circa 10 minuti, perché si genera ogni fotogramma delle scene HTML e si registra la mappa per 24 s. Dopo ci vogliono 2–3 minuti (la codifica finale è in due passate). La registrazione della mappa resta in cache (`mappa.mp4`) finché non usi `--rigenera-mappa`: se la rigeneri, controlla che il meteo della scheda non contraddica la chat (vedi «Controlli prima di consegnare» in `copione.md`).

#### Riprese vere, voce, musica

Metti i file in [`girato/`](girato/LEGGIMI.md):
- `cirogpt.mp4`, `badge.mp4`, `tasmota.mp4`: le riprese;
- `voce.m4a`: la voce;
- `musica.mp3`: la musica, facoltativa e solo se libera da diritti.

Se un file c'è, `monta.sh` lo usa al posto della scena generata. Se manca, per l'IoT usa una scena di riserva, senza valori inventati:
- scena 06: i due dispositivi reali e il percorso hotspot → broker → agenti;
- scena 07: il formato unico dei messaggi, con i soli segnaposto tra `< >`.

Con `--segnaposto` mostra invece i cartelli che dicono cosa girare. Per provare le riprese da un'altra cartella: `C5_VIDEO_GIRATO=/percorso ./monta.sh`. Le indicazioni per girare sono in [`copione.md`](copione.md#riprese-da-girare). I file di `girato/` non vanno nel repository.

#### Cambiare testi e tempi

- **Scene, durate, testate, voce e sottotitoli, cartelli:** [`scene/scaletta.json`](scene/scaletta.json). Dopo una modifica usa `./monta.sh --rigenera` e aggiorna `copione.md`.
- **Chat di TwinCIRO:**
  - i messaggi dell'utente sono in [`scene/chat_domande.json`](scene/chat_domande.json);
  - `python3 scene/chat_da_api.py` avvia la città di `c5-agentic-city` (agenti a regole, senza SUMO, porta 8805), manda i messaggi a `/chiedi`, aspetta l'avviso proattivo (circa 5 minuti) e scrive [`scene/chat.json`](scene/chat.json) con le risposte vere e i messaggi tra agenti;
  - i **ritocchi di forma** (chi parla nella controproposta, preposizioni, accordi) sono regole in `chat_domande.json`, applicate da `chat_da_api.py`; in `chat.json` il testo originale dell'API resta in `testo_api`. Dopo aver cambiato le regole basta `python3 scene/chat_da_api.py --solo-ritocchi`, senza riavviare la città. Dalla chat del 14/11 pomeriggio, generata dopo le correzioni di `c5-agentic-city` (commit b32bcf6), i testi sono quelli dell'API: le regole restano come rete di sicurezza ma oggi non cambiano nulla, e `testo_api` non compare;
  - `chat.json` si può anche ritoccare a mano.
  - Con `--api http://host:porta` usa un'API già accesa. Con `--senza-rete` prende il meteo dallo snapshot (`citta-api/dati/meteo.json`).

### Come è fatto

| File | Cosa fa |
|---|---|
| `monta.sh` | controlla gli strumenti e lancia `scene/monta.py` |
| `scene/monta.py` | genera o riprende le sorgenti, compone ogni scena (testata, velo, dissolvenze, riprese vere), unisce, imprime i sottotitoli (ASS), aggiunge voce e musica, codifica in due passate sotto i 40 MB |
| `scene/rendi_html.mjs` | rende una pagina HTML in video fotogramma per fotogramma, con tempo deterministico: testo nitido e sincronia esatta con la voce |
| `scene/registra_mappa.mjs` | registra la mappa reale (`mappa/`) con lo screencast di Chromium e una sequenza di azioni: ricerca, scheda, Meteo, Aria, «Oggi a Napoli» |
| `scene/chat.html` | telefono generico (nessun marchio WhatsApp) con la chat, più il pannello «dietro le quinte» a destra; `?telefono=vuoto` lascia lo schermo nero per la ripresa vera |
| `scene/cartelli.html`, `scene/architettura.html`, `scene/stile.css` | cartelli, testate, veli, notifica di TwinCIRO, riquadri di riserva dell'IoT (dispositivi e formato MQTT) e schema dell'architettura |
| `scene/chat_da_api.py` | genera `chat.json` dall'API vera della città |

Ogni pagina si apre anche nel browser, per un'anteprima: per esempio `python3 -m http.server -d scene 8000` e poi http://localhost:8000/chat.html?durata=50 o http://localhost:8000/cartelli.html?id=riserva-formato.

**Perché non `recordVideo` di Playwright:** registra in VP8 a circa 1 Mbit/s. A 1080p il testo della chat si sgrana e i tempi dipendono dal carico della macchina. Il rendering fotogramma per fotogramma è nitido e cade sempre negli stessi secondi dei sottotitoli. Per la mappa, che è dal vivo, si usa lo screencast di Chromium in JPEG di qualità 92, rimontato a 30 fps costanti.

### Fonti nel video

`c5-agentic-city` è usata in sola lettura: media (`regata_3d.mp4`, `demo_gemello.mp4`), API `/chiedi` e `/notifiche`, dati. Ci sono anche la mappa `mappa/` (dati reali; snapshot del 14/11 in `citta-api/dati/`) e Open-Meteo dal vivo. Il formato MQTT dei riquadri IoT è quello unico della città, descritto in [`firmware/`](../firmware/).

Cosa è reale e cosa è simulato: tabella in fondo a [`copione.md`](copione.md#cosa-è-reale-e-cosa-è-simulato-lo-diciamo-anche-nel-video).

### Stato

- [x] Copione con tempi, voce e riprese da girare
- [x] Scene generate: titolo, chat di TwinCIRO con risposte vere, architettura, mappa reale, riserve IoT, benefici, perché Napoli, chiusura
- [x] Montaggio riproducibile con sottotitoli, riserve o segnaposto, voce e musica facoltative
- [x] Revisione del 14/11 pomeriggio: l'assistente su WhatsApp a circa due terzi del video, scena SUMO esclusa, ritocchi di forma dichiarati, «fonti pubbliche» invece di «aperte», voce a circa 150 parole al minuto
- [x] Hardware del 14/11 sera: scene IoT con i due dispositivi reali (badge WHY2025 e scheda Tasmota sull'hotspot) e il formato unico `napoli/...`; niente più flasher né nodi ESP32 generici
- [ ] Riprese vere: chat di TwinCIRO su WhatsApp (R1), badge WHY2025 (R2), scheda Tasmota (R3)
- [ ] Voce fuori campo (R4)
- [ ] Controllo finale dei fotogrammi con le riprese vere

### Problemi noti (risolti in `c5-agentic-city`)

Su WhatsApp vero la skill `twinciro-citta` inoltra la risposta dell'API senza riscriverla, quindi la ripresa R1 mostra i testi originali. Questi tre punti li ha corretti `c5-agentic-city` nel commit b32bcf6 (con `citta/testi.py`):
- la controproposta cominciava con «Alle 13:00 siamo pieni. Alle 14:00 c'è posto per 4. Confermo?»: sembrava parlare la pizzeria, non l'assistente (`citta/agenti/assistente.py`);
- l'avviso diceva «A Rotonda Diaz (village) c'è il pienone: in questo momento Piazza del Plebiscito e Palazzo Reale è molto più tranquillo» (preposizione, nome interno della zona, accordo: `citta/agenti/turismo.py` e i nomi in `dati/`);
- il percorso diceva «oppure Linea 6 della metro se attiva» (`dati/luoghi.json`), mentre la Linea 6 c'è nel GTFS di ANM.

Fino alla chat precedente il video li correggeva con i ritocchi dichiarati in `scene/chat_domande.json`. La chat attuale (14/11 pomeriggio) è generata dall'API corretta: i testi sono quelli dell'API, senza ritocchi (ora la controproposta comincia con «Pizzeria 'O Scoglio alle 13:00 non ha posto, ma vi propone le 14:00 per 4. Prenoto?» e il percorso con «Linea 6 da Municipio a San Pasquale»).
