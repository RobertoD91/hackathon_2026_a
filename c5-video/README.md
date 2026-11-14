# C5 · video di consegna di TwinCiro

Il video da consegnare per la Challenge 05 (Fastweb + Vodafone): **massimo 3 minuti**, consegna domenica 15/11 alle 12:00.

- [`bozza.mp4`](bozza.mp4): la bozza montata. Dura **2:54**, è 1920×1080 a 30 fps, H.264, ha i sottotitoli impressi e pesa meno di 40 MB. Mancano la voce e le riprese vere: al loro posto ci sono la chat ricostruita (risposte vere dell'API) e, per l'IoT, due riquadri di riserva.
- [`copione.md`](copione.md): scene con i tempi, testi a schermo, voce fuori campo da leggere, **riprese da girare** e tabella di cosa è reale e cosa è simulato.

## Brief

Il feedback dei partner del 14/11 chiede di mettere **CiroGPT al centro** (circa due terzi del video: titolo, chat, architettura vista da CiroGPT, mappa come sue fonti, il suo avviso sul gemello) e di ridimensionare traffico e semafori. Il racconto quindi è questo:

1. una crocerista scrive a CiroGPT su WhatsApp;
2. CiroGPT chiede agli agenti della città e **negozia con la pizzeria**: alle 13:00 è piena, propone le 14:00;
3. prenota con un «ok»;
4. usa i dati veri e cita la fonte;
5. **avvisa per primo** quando la Rotonda Diaz si riempie.

Dopo vengono:
- l'architettura, a partire da CiroGPT;
- i dati reali (mappa), presentati come le fonti di CiroGPT;
- l'IoT (riprese vere, oppure i riquadri di riserva);
- il gemello digitale (regata 3D, piaciuta ai partner), con la notifica di CiroGPT;
- i benefici con i numeri e il perché Napoli dovrebbe adottarla.

Il traffico resta solo in un riquadro dei benefici (−9% medio, con l'intervallo). La scena SUMO affiancata è pronta ma esclusa con `"salta": true` in `scene/scaletta.json`.

## Come rimontarlo

```bash
cd c5-video
./monta.sh                  # rimonta con le scene già generate (cache in $C5_VIDEO_LAVORO, predefinita /tmp/c5-video-lavoro)
./monta.sh --rigenera       # dopo aver cambiato testi, scaletta o chat.json
./monta.sh --rigenera-mappa # registra di nuovo la mappa con i dati di adesso
./monta.sh --controllo      # estrae un fotogramma ogni 5 s per rivedere impaginazione e refusi
./monta.sh --segnaposto     # al posto delle riserve IoT mostra i cartelli «Qui va una ripresa reale»
```

Servono ffmpeg, Node con Playwright e Chromium, e python3 (solo libreria standard). La prima volta ci vogliono circa 10 minuti, perché si genera ogni fotogramma delle scene HTML e si registra la mappa per 24 s. Dopo ci vogliono 2–3 minuti (la codifica finale è in due passate).

### Riprese vere, voce, musica

Metti i file in [`girato/`](girato/LEGGIMI.md):
- `cirogpt.mp4`, `badge.mp4`, `plastico.mp4`: le riprese;
- `voce.m4a`: la voce;
- `musica.mp3`: la musica, facoltativa e solo se libera da diritti.

Se un file c'è, `monta.sh` lo usa al posto della scena generata. Se manca, per l'IoT usa una scena di riserva (scena 06: il formato reale dei messaggi MQTT del firmware; scena 07: come si installa dal browser), che non contiene valori inventati; con `--segnaposto` mostra invece i cartelli che dicono cosa girare. Per provare le riprese da un'altra cartella: `C5_VIDEO_GIRATO=/percorso ./monta.sh`. Le indicazioni per girare sono in [`copione.md`](copione.md#riprese-da-girare). I file di `girato/` non vanno nel repository.

### Cambiare testi e tempi

- **Scene, durate, testate, voce e sottotitoli, cartelli:** [`scene/scaletta.json`](scene/scaletta.json). Dopo una modifica usa `./monta.sh --rigenera` e aggiorna `copione.md`.
- **Chat di CiroGPT:**
  - i messaggi dell'utente sono in [`scene/chat_domande.json`](scene/chat_domande.json);
  - `python3 scene/chat_da_api.py` avvia la città di `c5-agentic-city` (agenti a regole, senza SUMO, porta 8805), manda i messaggi a `/chiedi`, aspetta l'avviso proattivo (circa 5 minuti) e scrive [`scene/chat.json`](scene/chat.json) con le risposte vere e i messaggi tra agenti;
  - i **ritocchi di forma** (chi parla nella controproposta, preposizioni, accordi) sono regole in `chat_domande.json`, applicate da `chat_da_api.py`; in `chat.json` il testo originale dell'API resta in `testo_api`. Dopo aver cambiato le regole basta `python3 scene/chat_da_api.py --solo-ritocchi`, senza riavviare la città;
  - `chat.json` si può anche ritoccare a mano.
  - Con `--api http://host:porta` usa un'API già accesa. Con `--senza-rete` prende il meteo dallo snapshot.

## Come è fatto

| File | Cosa fa |
|---|---|
| `monta.sh` | controlla gli strumenti e lancia `scene/monta.py` |
| `scene/monta.py` | genera o riprende le sorgenti, compone ogni scena (testata, velo, dissolvenze, riprese vere), unisce, imprime i sottotitoli (ASS), aggiunge voce e musica, codifica in due passate sotto i 40 MB |
| `scene/rendi_html.mjs` | rende una pagina HTML in video fotogramma per fotogramma, con tempo deterministico: testo nitido e sincronia esatta con la voce |
| `scene/registra_mappa.mjs` | registra la mappa reale (`shared/iot-agents/example/`) con lo screencast di Chromium e una sequenza di azioni: ricerca, scheda, Meteo, Aria, «Oggi a Napoli» |
| `scene/chat.html` | telefono generico (nessun marchio WhatsApp) con la chat, più il pannello «dietro le quinte» a destra; `?telefono=vuoto` lascia lo schermo nero per la ripresa vera |
| `scene/cartelli.html`, `scene/architettura.html`, `scene/stile.css` | cartelli, testate, veli, notifica di CiroGPT, riquadri di riserva dell'IoT e schema dell'architettura |
| `scene/chat_da_api.py` | genera `chat.json` dall'API vera della città |

Ogni pagina si apre anche nel browser, per un'anteprima: per esempio `python3 -m http.server -d scene 8000` e poi http://localhost:8000/chat.html?durata=50.

**Perché non `recordVideo` di Playwright:** registra in VP8 a circa 1 Mbit/s. A 1080p il testo della chat si sgrana e i tempi dipendono dal carico della macchina. Il rendering fotogramma per fotogramma è nitido e cade sempre negli stessi secondi dei sottotitoli. Per la mappa, che è dal vivo, si usa lo screencast di Chromium in JPEG di qualità 92, rimontato a 30 fps costanti.

## Fonti nel video

`c5-agentic-city` è usata in sola lettura: media (`regata_3d.mp4`, `demo_gemello.mp4`), API `/chiedi` e `/notifiche`, dati. Ci sono anche la mappa `shared/iot-agents/example/` (dati reali e snapshot del 14/11) e Open-Meteo dal vivo.

Cosa è reale e cosa è simulato: tabella in fondo a [`copione.md`](copione.md#cosa-è-reale-e-cosa-è-simulato-lo-diciamo-anche-nel-video).

## Stato

- [x] Copione con tempi, voce e riprese da girare
- [x] Scene generate: titolo, chat di CiroGPT con risposte vere, architettura, mappa reale, riserve IoT, benefici, perché Napoli, chiusura
- [x] Montaggio riproducibile con sottotitoli, riserve o segnaposto, voce e musica facoltative
- [x] Revisione del 14/11 pomeriggio: CiroGPT a circa due terzi del video, scena SUMO esclusa, ritocchi di forma dichiarati, «59 fonti pubbliche» invece di «aperte», voce a circa 150 parole al minuto
- [ ] Riprese vere: chat di CiroGPT su WhatsApp (R1), badge/ESP32 (R2), plastico o MQTT (R3)
- [ ] Voce fuori campo (R4)
- [ ] Controllo finale dei fotogrammi con le riprese vere

## Problemi noti (da correggere in `c5-agentic-city`, non qui)

Su WhatsApp vero la skill `twinciro-citta` inoltra la risposta dell'API senza riscriverla, quindi la ripresa R1 mostrerebbe i testi originali:
- la controproposta comincia con «Alle 13:00 siamo pieni. Alle 14:00 c'è posto per 4. Confermo?»: sembra parlare la pizzeria, non CiroGPT (`citta/agenti/assistente.py`);
- l'avviso dice «A Rotonda Diaz (village) c'è il pienone: in questo momento Piazza del Plebiscito e Palazzo Reale è molto più tranquillo» (preposizione, nome interno della zona, accordo: `citta/agenti/turismo.py` e i nomi in `dati/`);
- il percorso dice «oppure Linea 6 della metro se attiva» (`dati/luoghi.json`), mentre la Linea 6 c'è nel GTFS di ANM.

Nella chat ricostruita del video questi punti sono corretti con i ritocchi dichiarati in `scene/chat_domande.json`.
