# C5 · presentazione di TwinCIRO: video di consegna, mappa e grafo

Qui sta la **parte di vetrina** di TwinCIRO (Challenge 05, Fastweb + Vodafone): il video da consegnare, la mappa «Napoli in tempo reale» e il grafo della città. Quello che è simulato sta qui e lo dichiara. La città agentica vera è in [`c5-agentic-city/`](../c5-agentic-city/). Il cervello dati di TwinCIRO è l'API [`citta-api/`](../citta-api/README.md).

| Cosa | Dove | Reale o simulato |
|---|---|---|
| Video di consegna (massimo 3 minuti, consegna domenica 15/11 alle 12:00) | [`bozza.mp4`](bozza.mp4), [`copione.md`](copione.md), [`scene/`](scene/), [`monta.sh`](monta.sh) | tabella completa in fondo a [`copione.md`](copione.md#cosa-è-reale-e-cosa-è-simulato-lo-diciamo-anche-nel-video) |
| Clip per scena, sottotitoli SRT, video senza sottotitoli | [`clip/`](clip/LEGGIMI.md) (le scrive `monta.sh`) | come il video |
| Testi della voce per Roberto e Mario | [`voce/`](voce/COPIONE-VOCE.md) (li scrive `monta.sh`) | – |
| Riprese vere, voce, musica | [`girato/`](girato/LEGGIMI.md) (fuori dal repository) | vere |
| Musica CC0 e voce sintetica di prova (ElevenLabs), usate solo dove `girato/` non ha di meglio | [`audio/`](audio/LEGGIMI.md) | musica vera (CC0), voce sintetica dichiarata nei crediti |
| Mappa «Napoli in tempo reale»: hub, agenti e simulatore Node | [`mappa/`](mappa/README.md) | **folla e sensori simulati**; meteo, aria, trasporti, eventi e allerte **veri** |
| Grafo della città il giorno della regata (pagina navigabile) | [`grafo/`](grafo/) | relazioni ricavate dai file della repository; eventi e flussi dello scenario 2027 |
| Gemello 3D «TwinCIRO 3D»: presenze adesso e previste per 48 ore, chat con agenti a regole, sala operativa con what-if ([online](https://robertodisanto.it/hackathon_2026_a/c5-presentazione/gemello-3d/)) | [`gemello-3d/`](gemello-3d/README.md) | **presenze simulate**; meteo, allerte, aria, trasporti ed eventi **veri**; non legge MQTT |

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

## Il grafo della città

[`grafo/`](grafo/) è la pagina navigabile del knowledge graph della giornata della regata: 83 nodi (luoghi, eventi, stazioni, imprese, agenti, sensori, fonti) e 196 relazioni (vicino a, si svolge a, flusso verso, servito da, offerta a, monitora, parla con, alimenta), con legenda, ricerca, zoom e il dettaglio di ogni nodo. Online: https://robertodisanto.it/hackathon_2026_a/c5-presentazione/grafo/

- `grafo/genera.mjs` costruisce `grafo/grafo.json` solo dai file della repository (luoghi e stazioni dell'API dati città, topic MQTT letti dal codice degli agenti, zone e grandezze dal firmware): nessuna relazione è scritta a mano. Calcola anche la disposizione, sempre la stessa, e la incorpora nella scena `scene/grafo.html`.
- È una rappresentazione delle relazioni, non un database interrogato dagli agenti; cosa è simulato è scritto in pagina.

```bash
node c5-presentazione/grafo/genera.mjs              # rigenera grafo.json e i dati della scena 09
node c5-presentazione/grafo/genera.mjs --controlla  # esce con 1 se non sono aggiornati
```

## Il video di consegna (v3)

- [`bozza.mp4`](bozza.mp4): la bozza montata. Dura **2:59** (15 scene), è 1920×1080 a 30 fps, H.264, ha i sottotitoli impressi e pesa meno di 40 MB. Mancano le voci di Roberto e Mario e le riprese vere. Al loro posto ci sono la chat ricostruita (con le risposte vere dell'API) e, per l'IoT, il cartello «Sensori fatti da noi» (i due dispositivi reali e il formato unico dei messaggi, senza valori inventati).
- [`clip/`](clip/LEGGIMI.md): ogni scena come clip a sé senza sottotitoli, con il suo SRT, più `sottotitoli.srt`, `sottotitoli.ass` e `00-finale-senza-sottotitoli.mp4`, per rimontare a mano. Sono nel repository.
- [`voce/`](voce/COPIONE-VOCE.md): le battute scena per scena con chi le legge (Roberto o Mario), i tempi e il nome del file da registrare.
- [`copione.md`](copione.md): scene con i tempi, testi a schermo, voce da leggere, **riprese da girare** e tabella di cosa è reale e cosa è simulato.

### Brief

Il feedback dei partner del 14/11 chiede di mettere **l'assistente su WhatsApp al centro** (TwinCIRO) e di ridimensionare traffico e semafori; la regata 3D e l'IoT sono piaciuti. La challenge chiede anche benefici misurabili e perché Napoli dovrebbe adottarla. Il racconto della v3:

1. il gancio (Napoli 2027, la regata) e il problema: i dati ci sono ma sono sparsi, e manca il dato delle persone;
2. TwinCIRO e le sue fonti (oltre 50 fonti pubbliche, verificate una per una), i due utenti;
3. **il turista**: Marta scrive a TwinCIRO su WhatsApp; TwinCIRO negozia con la pizzeria, prenota con un «ok», la porta alla regata, usa i dati veri e **avvisa per primo** quando la Rotonda Diaz si riempie;
4. **chi governa**, subito dopo: l'operatore della Polizia Locale approva proprio quell'avviso (gli agenti propongono, l'operatore approva o blocca);
5. dietro: un **sistema multi-agente** (agenti specializzati e orchestratore sul bus MQTT `napoli/#`; i dati veri dall'API dati città), il grafo della città, Napoli adesso con i dati veri;
6. i **sensori fatti da noi** (badge WHY2025 e scheda Tasmota, prove sui dispositivi veri in corso), il gemello digitale con l'avviso di TwinCIRO;
7. tre passi con Fastweb + Vodafone, i benefici con i numeri e le loro ipotesi, il perché Napoli, la chiusura.

### Scene e cartelle

| # | Scena | Durata | File | Dati che legge |
|---|---|---|---|---|
| 01 | regata (il gancio) | 8 s | `c5-agentic-city/media/regata_3d.mp4` con velo e testata | – |
| 02 | motivazione | 11 s | `scene/motivazione.html` | `scene/fonti/`: `catalogo.json` (da `costruisci.py`, righe di `docs/fonti-dati-napoli.md`), `isole.js`, `loghi/` (icone ufficiali dei siti) |
| 03 | titolo | 7 s | `scene/titolo.html` | durata da `scaletta.json` |
| 04 | fonti | 8 s | `scene/fonti.html` | `scene/fonti/`, come la 02 |
| 05 | utenti | 6 s | `scene/utenti.html` | – |
| 06 | chat del turista | 38 s | `scene/chat.html` (oppure `girato/chat.mp4` nel telefono) | `scene/chat.json` (da `chat_da_api.py`) |
| 07 | operatore della Polizia Locale | 14 s | `scene/operatore.html` | `scene/operatore/` (da `cattura_mappa.mjs` e `cattura_citta.py`) |
| 08 | architettura multi-agente | 11 s | `scene/architettura.html` | – |
| 09 | grafo | 9 s | `scene/grafo.html` | dati incorporati da `grafo/genera.mjs`, loghi da `scene/fonti/loghi/` |
| 10 | Napoli adesso | 14 s | `scene/adesso.html` | `scene/oggi/*.json` (da `oggi/cattura.mjs`) |
| 11 | sensori fatti da noi | 8 s | `girato/badge.mp4` e `girato/tasmota.mp4`, altrimenti il cartello `sensori` di `scene/cartelli.html` | testi in `scaletta.json` |
| 12 | gemello digitale | 9 s | `regata_3d.mp4` da 0:58 (14:33–14:42 simulate), con la notifica di TwinCIRO quando parte l'avviso vero della simulazione | avviso di `scene/chat.json` |
| 13 | Fastweb + Vodafone | 16 s | `scene/fastweb.html` | durata da `scaletta.json` |
| 14 | benefici e perché Napoli | 12 s | cartello `benefici` di `scene/cartelli.html` | testi in `scaletta.json` |
| 15 | chiusura | 8 s | cartello `chiusura` | testi in `scaletta.json` |

Le scene di tipo `"pagina"` elencano in `"dipende"` i file che leggono: se una cattura li cambia, al montaggio dopo la scena si rigenera da sola (non serve `--rigenera`).

### Come rimontarlo

```bash
cd c5-presentazione
./monta.sh                  # rimonta con le scene già generate (cache in $C5_VIDEO_LAVORO, predefinita /tmp/c5-video-lavoro)
./monta.sh --rigenera       # rigenera tutte le scene HTML (di solito non serve: la cache sa cosa è cambiato)
./monta.sh --solo-clip      # rifà clip, SRT e testi della voce, non bozza.mp4 (salta la codifica in due passate)
./monta.sh --solo-testi     # rifà solo voce/ e controlla tempi, sovrapposizioni e ritmo delle battute (un secondo)
./monta.sh --controllo      # estrae un fotogramma ogni 5 s per rivedere impaginazione e refusi
./monta.sh --segnaposto     # dove manca una ripresa vera mostra il cartello «Qui va una ripresa reale»
```

Servono ffmpeg, Node con Playwright e Chromium, e python3 (solo libreria standard). La prima volta ci vogliono circa 10 minuti, perché si genera ogni fotogramma delle scene HTML; dopo, con la cache, 3-4 minuti (si rigenerano solo le scene cambiate; la codifica finale è in due passate). La registrazione della mappa (`--rigenera-mappa`, tipo di scena `"mappa"`) resta disponibile, ma la v3 non la usa: la dashboard compare come foto nella scena 07.

### Rifare le catture

Dalla radice della repo. Dopo ogni cattura basta `./monta.sh`: la scena che legge quei file si rigenera da sola.

```bash
# Scene 02 e 04: catalogo delle fonti da docs/fonti-dati-napoli.md (--loghi riscarica le icone ufficiali)
(cd c5-presentazione/scene/fonti && PYTHONDONTWRITEBYTECODE=1 python3 costruisci.py)
# Scena 06: la chat dall'API vera di c5-agentic-city (circa 6 minuti, porta 8805)
PYTHONDONTWRITEBYTECODE=1 python3 c5-presentazione/scene/chat_da_api.py
# Scena 09: il grafo
node c5-presentazione/grafo/genera.mjs
# Scena 10: Napoli adesso, dati veri dell'API dati città (rinfresca eventi, aria e meteo, poi 15 domande)
node c5-presentazione/scene/oggi/cattura.mjs                 # oppure --api https://twinciro.robertodisanto.it/citta-api con CITTA_API_TOKEN
# Scena 07: la dashboard (mappa in modalità demo) e la città con --approvazione (circa 5 minuti, venv di c5-agentic-city)
NODE_PATH=$(npm root -g) node c5-presentazione/scene/operatore/cattura_mappa.mjs
PYTHONDONTWRITEBYTECODE=1 <venv>/bin/python c5-presentazione/scene/operatore/cattura_citta.py
```

- La voce di Napoli adesso (scena 10) vale con qualsiasi cattura. Con l'API di adesso (dal 14/11 sera) il pannello dell'allerta mostra anche l'avviso della Protezione Civile per domani, che la cattura delle 19:30 non ha: conviene rifarla domenica mattina, quando passano i treni.
- Se si rigenera la chat, va rifatta anche `cattura_citta.py`: controlla che l'avviso della proposta D4 sia identico a quello della chat.

#### Riprese vere, voce, musica

Metti i file in [`girato/`](girato/LEGGIMI.md):
- `chat.mp4` (la chat WhatsApp vera con il contatto TwinCIRO), `badge.mp4`, `tasmota.mp4`: le riprese;
- le voci di Roberto e Mario: una battuta per file in `girato/voce/NN-<scena>-K.m4a` (nomi in [`voce/COPIONE-VOCE.md`](voce/COPIONE-VOCE.md)), oppure una scena per file, oppure tutto in `voce.m4a`;
- `musica.mp3`: la musica, facoltativa e solo se libera da diritti.

Finché mancano, `monta.sh` usa quello che c'è in [`audio/`](audio/LEGGIMI.md): la musica CC0 «Funshine» di Kevin MacLeod e la voce sintetica di prova (ElevenLabs: George per Roberto, Eric per Mario), una battuta per file. Ogni battuta registrata prende il posto di quella sintetica; la voce sintetica non si usa con `girato/voce.m4a`, nelle scene registrate intere né per una battuta il cui testo è cambiato (si rigenera con `scene/voce_sintetica.py`, che rifà solo le battute cambiate). Quando si usano, la chiusura ne riporta i crediti. Per farne a meno: `--senza-voce-sintetica`, `--senza-musica`.

Se un file c'è, `monta.sh` lo usa al posto della scena generata. Nella scena 11 le riprese del badge e di Tasmota che ci sono si dividono gli 8 s, con la testata «Sensori fatti da noi»; se mancano tutte e due resta il cartello, senza valori inventati. Con `--segnaposto` si vedono invece i cartelli che dicono cosa girare. Per provare le riprese da un'altra cartella: `C5_VIDEO_GIRATO=/percorso ./monta.sh`. Le indicazioni per girare sono in [`copione.md`](copione.md#riprese-da-girare). I file di `girato/` non vanno nel repository.

#### Cambiare testi e tempi

- **Scene, durate, testate, voce (con `"chi"`), sottotitoli, cartelli:** [`scene/scaletta.json`](scene/scaletta.json). Dopo una modifica: `./monta.sh --solo-testi` per controllare la voce, poi `./monta.sh`, e aggiorna `copione.md`.
- **Chat di TwinCIRO:**
  - i messaggi dell'utente sono in [`scene/chat_domande.json`](scene/chat_domande.json);
  - `python3 scene/chat_da_api.py` avvia la città di `c5-agentic-city` (agenti a regole, senza SUMO, porta 8805), manda i messaggi a `/chiedi`, aspetta l'avviso proattivo (circa 5 minuti) e scrive [`scene/chat.json`](scene/chat.json) con le risposte vere e i messaggi tra agenti;
  - i **ritocchi di forma** sono regole in `chat_domande.json`, applicate da `chat_da_api.py`; in `chat.json` il testo originale dell'API resta in `testo_api`. Dalla chat del 14/11 pomeriggio i testi sono quelli dell'API: le regole restano come rete di sicurezza ma oggi non cambiano nulla;
  - con `--api http://host:porta` usa un'API già accesa; con `--senza-rete` prende il meteo dallo snapshot (`citta-api/dati/meteo.json`);
  - la chat si adatta alla durata della scena: se è più corta del naturale (circa 58 s) si accorciano le pause di lettura, ma l'ultimo messaggio tiene tutto il suo tempo.

### Come è fatto

| File | Cosa fa |
|---|---|
| `monta.sh` | controlla gli strumenti e lancia `scene/monta.py` |
| `scene/monta.py` | genera o riprende le sorgenti (cache per scena, con i file di `"dipende"`), compone ogni scena (testata, velo, sovrapposti, dissolvenze, riprese vere anche più d'una), scrive clip, SRT e testi della voce, unisce, imprime i sottotitoli (ASS), aggiunge voce e musica, codifica in due passate sotto i 40 MB |
| `scene/rendi_html.mjs` | rende una pagina HTML in video fotogramma per fotogramma, con tempo deterministico: testo nitido e sincronia esatta con la voce |
| `scene/chat.html` | telefono generico (nessun marchio WhatsApp) con la chat, più il pannello «dietro le quinte» a destra; `?telefono=vuoto` lascia lo schermo nero per la ripresa vera |
| `scene/motivazione.html`, `scene/fonti.html`, `scene/fonti/` | le fonti come isole sparse e poi come muro intorno a TwinCIRO; catalogo, icone ufficiali e codice comune |
| `scene/titolo.html`, `scene/utenti.html`, `scene/architettura.html`, `scene/grafo.html`, `scene/adesso.html`, `scene/operatore.html`, `scene/fastweb.html` | le scene a pagina intera della v3 (ognuna con `window.pronta` e `window.imposta(t)`, 1920×1080, i 130 px in basso liberi per i sottotitoli) |
| `scene/oggi/`, `scene/operatore/` | le catture con i dati veri (scene 10 e 07) e gli script che le rifanno |
| `scene/cartelli.html`, `scene/stile.css` | cartelli (sensori, benefici, chiusura, segnaposto), testate, veli, notifica di TwinCIRO e stile comune |
| `scene/chat_da_api.py` | genera `chat.json` dall'API vera della città |
| `scene/registra_mappa.mjs` | registra la mappa reale (`mappa/`) con lo screencast di Chromium (non usata dalla v3) |

Ogni pagina si apre anche nel browser, per un'anteprima: per esempio `python3 -m http.server -d c5-presentazione/scene 8000` e poi http://localhost:8000/chat.html?durata=38 o http://localhost:8000/cartelli.html?id=sensori.

**Perché non `recordVideo` di Playwright:** registra in VP8 a circa 1 Mbit/s. A 1080p il testo della chat si sgrana e i tempi dipendono dal carico della macchina. Il rendering fotogramma per fotogramma è nitido e cade sempre negli stessi secondi dei sottotitoli.

### Fonti nel video

`c5-agentic-city` è usata in sola lettura: media (`regata_3d.mp4`), API `/chiedi`, `/notifiche` e `/operatore`, sala nel terminale, dati. Ci sono anche l'API dati città (`citta-api/`, cattura del 14/11 alle 19:30), la mappa `mappa/` (dashboard della scena 07), il catalogo `docs/fonti-dati-napoli.md` e Open-Meteo dal vivo nella chat. Il formato MQTT del cartello dei sensori è quello unico della città, descritto in [`firmware/`](../firmware/).

Cosa è reale e cosa è simulato: tabella in fondo a [`copione.md`](copione.md#cosa-è-reale-e-cosa-è-simulato-lo-diciamo-anche-nel-video).

### Stato

- [x] Copione con tempi, voce e riprese da girare
- [x] Montaggio riproducibile con sottotitoli, riserve o segnaposto, voce e musica facoltative; clip, SRT e testi della voce nel repository
- [x] Revisione del 14/11 pomeriggio: l'assistente su WhatsApp al centro, scena SUMO esclusa, «fonti pubbliche» invece di «aperte», voce a circa 150 parole al minuto
- [x] Hardware del 14/11 sera: i due dispositivi reali (badge WHY2025 e scheda Tasmota sull'hotspot) e il formato unico `napoli/...`
- [x] v3 del 14/11 sera (2:58, 15 scene): motivazione, fonti, titolo, due utenti, chat del turista, architettura multi-agente, grafo, Napoli adesso con i dati veri, operatore della Polizia Locale, sensori fatti da noi, gemello, Fastweb + Vodafone, benefici e perché Napoli; voce divisa tra Roberto e Mario
- [x] Revisione della notte del 15/11 (fatti e forma): operatore subito dopo la chat, gemello sull'avviso vero della simulazione, allerta senza livelli in contrasto con la Protezione Civile, architettura con l'API dati città, quinte coerenti, stime con le loro ipotesi, testi di Fastweb + Vodafone verificati, sottotitoli su due righe (2:59)
- [ ] Riprese vere: chat di TwinCIRO su WhatsApp (R1), badge WHY2025 (R2), scheda Tasmota (R3)
- [ ] Voci di Roberto e Mario (R4)
- [ ] Controllo finale dei fotogrammi con le riprese vere

### Problemi noti (risolti in `c5-agentic-city`)

Su WhatsApp vero la skill `twinciro-citta` inoltra la risposta dell'API senza riscriverla, quindi la ripresa R1 mostra i testi originali. Questi tre punti li ha corretti `c5-agentic-city` nel commit b32bcf6 (con `citta/testi.py`):
- la controproposta cominciava con «Alle 13:00 siamo pieni. Alle 14:00 c'è posto per 4. Confermo?»: sembrava parlare la pizzeria, non l'assistente (`citta/agenti/assistente.py`);
- l'avviso diceva «A Rotonda Diaz (village) c'è il pienone: in questo momento Piazza del Plebiscito e Palazzo Reale è molto più tranquillo» (preposizione, nome interno della zona, accordo: `citta/agenti/turismo.py` e i nomi in `dati/`);
- il percorso diceva «oppure Linea 6 della metro se attiva» (`dati/luoghi.json`), mentre la Linea 6 c'è nel GTFS di ANM.

Fino alla chat precedente il video li correggeva con i ritocchi dichiarati in `scene/chat_domande.json`. La chat attuale (14/11 pomeriggio) è generata dall'API corretta: i testi sono quelli dell'API, senza ritocchi (ora la controproposta comincia con «Pizzeria 'O Scoglio alle 13:00 non ha posto, ma vi propone le 14:00 per 4. Prenoto?» e il percorso con «Linea 6 da Municipio a San Pasquale»).
