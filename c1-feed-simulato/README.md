# Clienti che non esistono: feed simulato (Challenge 01, Bhblasted)

> *Testare la pubblicità su un pubblico simulato dall'AI, prima di spendere un euro.*

Bhblasted consegnerà in sede annunci reali di cui conosce i risultati. Il sistema deve dire **quale annuncio vince**, **che CTR aspettarsi per ogni segmento**, **in che fascia starà il CPM** e **perché**. Questo prototipo fa proprio questo:

- genera un **pubblico sintetico** italiano (età, genere, area, città, interessi, abitudini);
- mostra ogni annuncio **dentro un feed** stile Instagram/Facebook, con like e commenti delle persone virtuali, filtrabile per segmento;
- produce una **scheda di previsione**: vincitore con probabilità, CTR per segmento con fascia di incertezza, fascia di CPM con i fattori, motivi per segmento;
- ha una **pagina di verifica**: inserisci i risultati veri e vedi quanto ci abbiamo preso. Con gli stessi dati **tara il modello**.

Online (solo browser, modalità euristica): https://robertodisanto.it/hackathon_2026_a/c1-feed-simulato/

## Avvio

Due modalità, stessa interfaccia, stesso motore (`src/core/`, moduli ES condivisi tra Node e browser).

| Modalità | Comando | Cosa fa |
|---|---|---|
| Server | `node c1-feed-simulato/server.js` → http://localhost:8702/ | Node ≥ 20, nessuna dipendenza npm. Serve anche i file statici. Se è configurato un LLM, lo usa. |
| Statica | dalla root della repo `python3 -m http.server 8712` → http://localhost:8712/c1-feed-simulato/ | Come su GitHub Pages: nessun backend, la simulazione euristica gira nel browser. |

Altri comandi:

```bash
node c1-feed-simulato/cli.js c1-feed-simulato/esempi/annunci-esempio.json                 # previsione in terminale
node c1-feed-simulato/cli.js annunci.csv --risultati risultati.json                       # con verifica
node c1-feed-simulato/cli.js annunci.csv --llm --json > previsione.json                   # con LLM, output JSON
node c1-feed-simulato/test/smoke.mjs                                                      # test del motore
```

API del server:

- `GET /api/health`: provider LLM attivo.
- `POST /api/simulate`, corpo `{ "annunci": [ ... ], "config": { "perSegmento": 200, "dividiPerGenere": true, "seme": 42, "usaLlm": true } }`. Con l'header `Accept: application/x-ndjson` manda righe `{"type":"progress",...}` e alla fine `{"type":"result","result":{...}}`.
- `POST /api/import`, corpo `{ "testo": "<contenuto JSON o CSV>", "nome": "file.csv" }`: annunci normalizzati.

## Collegare un LLM vero

Stesse convenzioni di `shared/iot-agents/CONTRATTO.md` §4. Nessuna chiave nel codice: tutto da variabili d'ambiente.

```bash
# Anthropic (chiamata HTTP diretta a https://api.anthropic.com/v1/messages, niente SDK, immagini in base64)
LLM_PROVIDER=anthropic ANTHROPIC_API_KEY=... node c1-feed-simulato/server.js
# modello facoltativo (predefinito claude-opus-5-5); per costi più bassi: LLM_MODEL=claude-haiku-5-5

# qualsiasi endpoint compatibile con /chat/completions (OpenAI, OpenRouter, vLLM, proxy di OpenClaw...)
LLM_PROVIDER=openai-compatible LLM_BASE_URL=https://.../v1 LLM_API_KEY=... LLM_MODEL=... node c1-feed-simulato/server.js
```

Variabili facoltative: `LLM_SAMPLE` (persone giudicate dall'LLM per segmento, predefinito 4), `LLM_CONCURRENCY` (chiamate in parallelo, predefinito 6), `LLM_EFFORT` (Anthropic, predefinito `low`), `LLM_TIMEOUT_MS` (90000), `ANTHROPIC_BASE_URL` (proxy), `PORT` (8702).

Costo: una chiamata per annuncio e segmento. Con 3 annunci e 10 segmenti sono 30 chiamate da circa 4 persone ciascuna. Le risposte restano in cache nel server: rilanciare la stessa simulazione è istantaneo. Se una chiamata fallisce, quel segmento resta sulla stima euristica e la UI lo segnala.

## Come funziona

1. **Annunci** (`src/core/ads.js`): immagine, titolo, testo, call to action, piattaforma, obiettivo, posizionamento, settore, target (età, genere, area), data di inizio. Import da **JSON o CSV** con nomi di colonna in italiano o inglese (`testo`/`primary_text`/`copy`, `cta`/`call_to_action`, `target` anche scritto a mano come "Donne 25-44 Sud"...), separatore `,` `;` o tab. Se il file contiene già `ctr`/`cpm` reali, finiscono nella pagina di verifica.
2. **Pubblico sintetico** (`src/core/audience.js`, dati in `data/popolazione.json`): da 100 a 500 persone per segmento (fascia d'età × genere), con peso pari alla quota di popolazione rappresentata. Ognuna ha area e città, interessi e tratti (testo tollerato, sensibilità al prezzo, scetticismo, peso della riprova sociale).
3. **Caratteristiche dell'annuncio** (`src/core/features.js`): lunghezza e chiarezza del testo, offerta/prezzo/sconto e se compare nelle prime parole, urgenza, riprova sociale, emoji, maiuscole e "!", forza della CTA e coerenza con l'obiettivo, luminosità, contrasto e saturazione dell'immagine (calcolati nel browser su un canvas 64×64). La diagnosi compare subito sotto ogni scheda.
4. **Simulazione** (`src/core/heuristic.js`, `simulate.js`): per ogni persona `p_stop` (si ferma nel feed) e `p_click` (clicca), da due modelli logistici con termini espliciti: coerenza con gli interessi, offerta × sensibilità al prezzo, testo oltre la soglia della sua età, formato vs piattaforma, immagine, CTA, fuori target, stagione... Ogni termine è un **motivo** con un codice. Il risultato è deterministico: stesso annuncio e stesso seme danno gli stessi numeri. Reazione e commento (`comments.js`) nascono dal motivo che pesa di più per quella persona, con tono diverso per età.
5. **LLM facoltativo** (`src/llm/`): per ogni annuncio e segmento un campione di persone "guarda" il post (con l'immagine) dentro un feed e risponde in JSON con `p_stop`, `p_click`, reazione, commento e motivo. Il rapporto tra giudizio LLM e euristica corregge il livello del segmento, attenuato in base al numero di giudizi. I commenti LLM sono marcati in viola nel feed.
6. **Calibrazione** (`src/core/calibration.js`): il tasso di click simulato **non è un CTR**. `CTR = CTR_rif(piattaforma, obiettivo) × settore × scala × (tasso_simulato / 0,03)^esponente`. 0,03 è il tasso simulato di un annuncio "medio". L'esponente 0,8 attenua le differenze, che il simulatore tende a esagerare.
7. **CPM** (`src/core/cpm.js`): fascia da regole esplicite, tutte mostrate in UI con il motivo: base della piattaforma × posizionamento × obiettivo × età del target × ampiezza del target (milioni di utenti raggiungibili) × periodo (novembre ×1,2, settimana del Black Friday ×1,45, dicembre, gennaio, agosto) × piccola correzione per rilevanza (0,9–1,1).
8. **Previsione** (`src/core/predict.js`): CTR per segmento e totale pesato sulle impression del target; probabilità di vittoria con un Monte Carlo deterministico su un'incertezza log-normale; sintesi del perché (motivi in cui il vincitore batte il secondo, segmenti che preferiscono un'altra variante).
9. **Verifica** (`src/core/backtest.js`): vincitore giusto/sbagliato, errore sul CTR (punti percentuali e relativo), CPM dentro o fuori la fascia, errore e correlazione dell'ordine per segmento. **Tara il modello** stima `scala` ed `esponente` con una regressione sui logaritmi (1–2 annunci: solo la scala), ricalcola l'incertezza e un fattore di scala per il CPM. La taratura resta salvata nel browser (localStorage) e si può esportare in JSON.

### Procedura consigliata in sede

1. Se Bhblasted dà annunci d'esempio con risultati: importali, simula, apri **Verifica**, inserisci i risultati e premi **Tara il modello**.
2. Importa gli annunci della gara (JSON o CSV) e simula: la taratura si applica da sola. Esporta la previsione (JSON) prima che vengano rivelati i risultati.
3. Quando arrivano i risultati veri, inseriscili in **Verifica** e mostra il punteggio.

## Cosa è misurato, cosa è stimato

| | |
|---|---|
| **Misurato** | Le caratteristiche dell'annuncio: testo, offerta, CTA, statistiche dell'immagine, coerenza con piattaforma e target. |
| **Stimato** | Le reazioni delle persone virtuali, la conversione in CTR, la fascia di CPM, la probabilità di vittoria. |
| **Indicativo, da verificare** | Tutte le tabelle in `data/`: CTR e CPM di riferimento, moltiplicatori, uso dei social per età, interessi, tratti. Le quote di popolazione sono arrotondate da ISTAT (1° gennaio 2024) e vanno ricontrollate su demo.istat.it. Le note sulle fonti sono nei campi `_nota`/`_fonti` dei JSON e nella pagina "Come funziona". |
| **Più affidabile** | Il confronto tra varianti (chi vince) è più solido del CTR assoluto: per questo mostriamo una fascia di incertezza e la probabilità di vittoria. |

## File

```
c1-feed-simulato/
  index.html, style.css, app.js   interfaccia (4 viste: Annunci, Feed e previsione, Verifica, Come funziona)
  server.js                       server Node senza dipendenze (porta 8702)
  cli.js                          previsione da terminale
  data/popolazione.json           distribuzioni del pubblico, con fonti e note
  data/benchmark.json             CTR e CPM di riferimento, regole CPM, calibrazione di default
  src/core/                       motore condiviso Node + browser
  src/llm/adapter.js              adattatore LLM (mock | anthropic | openai-compatible)
  src/llm/persona-llm.js          prompt e integrazione delle persone giudicate dall'LLM
  esempi/                         3 annunci di prova (JSON), 2 in CSV, risultati demo INVENTATI, immagini FLUX
  test/smoke.mjs                  test del motore
```

## Limiti

- Senza taratura i CTR assoluti sono ordini di grandezza: le tabelle di riferimento sono indicative.
- L'euristica non "vede" l'immagine: usa luminosità, contrasto, saturazione e la descrizione testuale. Per giudicare il contenuto dell'immagine serve l'LLM.
- Le immagini caricate da URL esterni non vengono passate all'LLM (solo file caricati o file locali della cartella).
- La taratura con pochi annunci è fragile: con 1–2 punti si stima solo un fattore di scala. L'errore mostrato dopo la taratura è misurato sugli stessi annunci usati per tarare.
- Il CPM dipende dall'asta reale (budget, concorrenti, offerta): le regole danno una fascia ragionevole, non un valore esatto.
- I segmenti sono età × genere; l'area entra nel target ma non è un segmento separato.
- Il modello LLM rischia i suoi bias (clicca più delle persone vere, è troppo gentile): il prompt lo dice esplicitamente e i numeri restano ancorati all'euristica.
