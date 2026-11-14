# API dati città su twinciro.robertodisanto.it

L'API di [`shared/citta-api/`](../../shared/citta-api/README.md) (il "cervello dati" di CiroGPT) in **Docker**: immagine `node:22.23.5-alpine` (la stessa del ponte MQTT), nessuna dipendenza npm, porta **8791**, token Bearer facoltativo, healthcheck su `/salute`, snapshot in un volume e rinfresco automatico degli snapshot dentro il processo.

| Porta | Protocollo | Per chi |
|---|---|---|
| **443** | HTTPS (profilo `https`: nginx in un container) | CiroGPT (OpenClaw): `https://twinciro.robertodisanto.it/citta-api` |
| 8791 | HTTP (JSON) | prove e rete interna; con il profilo `https` può restare su 127.0.0.1 |

Sul server **non abbiamo root**: niente nginx di sistema né `sudo`. HTTPS lo fa un nginx in Docker con i certificati che l'amministratore rende leggibili ([`../certificati/`](../certificati/README.md)).

## Contenuto

```
cloud/citta-api/
  Dockerfile                immagine: shared/citta-api + i moduli condivisi di shared/iot-agents
  Dockerfile.dockerignore   contesto di build ridotto ai soli file che servono (pochi KB)
  compose.yaml              servizio citta-api (porta, token, CORS, volume, healthcheck, limiti) e https (profilo)
  nginx/https.conf          nginx del profilo "https": /citta-api/ → citta-api:8791, certificati da CITTA_CERTIFICATI_DIR
  .env.example              configurazione (token, porta, CORS, User-Agent, rinfresco)
  prova.sh                  prova: /salute, token, riassunto, luogo, passaggi, fonti
  esempi/nginx-citta-api.conf   alternativa: l'nginx di sistema (solo per chi ha root sul server)
```

`.env` è nel `.gitignore`: **il token non va mai nella repo**.

## Requisiti

- Docker Engine con Compose v2 (`docker compose version`), come per [`../mqtt/`](../mqtt/README.md).
- La repo clonata sul server: l'immagine si costruisce dalla radice della repo (`context: ../..`).
- Uscita verso Internet in HTTPS (le fonti: Open-Meteo, MET Norway, Centro Funzionale, INGV, Transitous, EAV, ASPI, EEA, Comune, GitHub per openfootball…).

## Installazione sul server

```bash
git clone https://github.com/RobertoD91/hackathon_2026_a.git     # se non c'è già (è la stessa del broker MQTT)
cd hackathon_2026_a/cloud/citta-api
cp .env.example .env && chmod 600 .env
sed -i "s/^CITTA_API_TOKEN=.*/CITTA_API_TOKEN=$(openssl rand -hex 24)/" .env   # token per CiroGPT
docker compose up -d --build
./prova.sh                                   # /salute, 401 senza token, riassunto, luogo, passaggi, fonti
```

Apri nel firewall del provider la porta **TCP 443** per il profilo `https` (qui sotto) e, solo se vuoi l'accesso diretto in HTTP, la **8791**. Come per il broker: le porte pubblicate da Docker scavalcano ufw; per non esporre la 8791 metti `CITTA_API_INDIRIZZO=127.0.0.1` in `.env`.

Da fuori:

```bash
curl -s http://twinciro.robertodisanto.it:8791/salute            # HTTP: per HTTPS vedi nginx qui sotto
curl -s -H "Authorization: Bearer <token>" 'http://twinciro.robertodisanto.it:8791/citta/riassunto?formato=testo'
```

### HTTPS senza root (consigliato: il token passa da Internet)

Il token viaggia in un header: su HTTP in chiaro si può leggere. Il profilo `https` di `compose.yaml` mette davanti all'API un **nginx in un container**, sulla 443, con i certificati di `twinciro.robertodisanto.it`. Prima, una volta, l'amministratore del server deve rendere i certificati leggibili: comandi in [`../certificati/README.md`](../certificati/README.md). Poi, da utente normale:

```bash
ls -l /srv/certificati/twinciro.robertodisanto.it/       # fullchain.pem e privkey.pem
# in .env: CITTA_API_INDIRIZZO=127.0.0.1 (la 8791 resta interna) e, se serve, CITTA_HTTPS_PORTA
docker compose --profile https up -d --build
./prova.sh https://twinciro.robertodisanto.it/citta-api
```

nginx rilegge i certificati da solo ogni 12 ore, quindi dopo un rinnovo non serve fare nulla (per farlo subito: `docker compose exec https nginx -s reload`). Se la 443 è già occupata sul server, oppure se Docker è rootless e non può pubblicare porte sotto la 1024, usa `CITTA_HTTPS_PORTA=8443` e l'indirizzo `https://twinciro.robertodisanto.it:8443/citta-api`. `https://twinciro.robertodisanto.it/salute` risponde `ok` da nginx stesso.

Provato il 14/11 con un certificato autofirmato, con la chiave 0640 di un altro utente come la lascia `copia-certificati.sh`: container `healthy`, `prova.sh` 6 su 6 attraverso nginx e ricaricamento a caldo.

Per CiroGPT: `CITTA_API=https://twinciro.robertodisanto.it/citta-api` e `CITTA_API_TOKEN=<token>` (skill d'esempio nel [README dell'API](../../shared/citta-api/README.md#usarla-da-cirogpt)).

## Configurazione (`.env`)

| Variabile | Predefinito | Note |
|---|---|---|
| `CITTA_API_PORTA` | `8791` | porta sul server |
| `CITTA_API_INDIRIZZO` | `0.0.0.0` | `127.0.0.1` dietro il profilo `https` |
| `CITTA_CERTIFICATI_DIR` | `/srv/certificati/twinciro.robertodisanto.it` | profilo `https`: cartella con `fullchain.pem` e `privkey.pem` |
| `CITTA_HTTPS_PORTA` | `443` | profilo `https`: porta sul server (`8443` se la 443 non si può usare) |
| `CITTA_API_TOKEN` | vuoto | Bearer per tutto tranne `/salute`. Vuoto = API aperta |
| `CITTA_API_CORS` | `https://robertodisanto.it` | origini del browser ammesse (la mappa su GitHub Pages); `*` per tutte |
| `NAPOLI_UA` | vuoto | User-Agent verso le fonti; generico, senza dati personali |
| `CITTA_AGGIORNA` | `eventi=6h,aria=1h,meteo=3h,riferimenti=24h,trasporti=72h` | età massima degli snapshot; `0` = mai |
| `CITTA_TIENI_CALDO` | `1` | fonti del riassunto rilette in anticipo (solo se scadute) |
| `CITTA_PAUSA_429` | `15m` | pausa di un dominio dopo un 429 |

La mappa nel browser e CiroGPT possono usare la stessa API solo se il token è vuoto (una pagina pubblica non può tenere un segreto). Se serve il token per CiroGPT e l'accesso libero per la mappa, aggiungi in `nginx/https.conf` un percorso che inserisce l'header `Authorization` solo per la mappa, oppure avvia una seconda istanza senza token con `CITTA_TIENI_CALDO=0`.

Dopo una modifica a `.env`: `docker compose up -d` (ricrea il container, il volume resta).

## Dati e rinfresco

- Gli **snapshot** (trasporti, centraline, eventi, riferimenti, meteo di riserva) stanno nel volume `dati` (`/dati` nel container). Al primo avvio arrivano dall'immagine (cioè dalla repo); a ogni avvio un file della repo più recente di quello del volume lo sostituisce.
- Il **rinfresco interno** (`CITTA_AGGIORNA`) controlla ogni minuto l'età di ogni snapshot e rigenera la sezione più vecchia scaduta con `shared/iot-agents/tools/aggiorna-dati-napoli.js`, una alla volta, con la stessa rete dell'API (stesse pause dopo un 429). Dopo un errore riprova la stessa sezione solo dopo un'ora. Provato nella sandbox: aria in 5 s (50 file Parquet dell'EEA), meteo in 19 s, trasporti in 5 s con un picco di 155 MB di memoria.
- **A mano** (l'API li ricarica da sola entro un minuto):

```bash
docker compose exec citta-api node shared/citta-api/aggiorna.js --solo eventi
docker compose exec citta-api node shared/citta-api/aggiorna.js            # tutte le sezioni (1-6 minuti)
```

  L'opzione `--curl` di `aggiorna.js` nel container non funziona: l'immagine Alpine non ha `curl`, solo `wget`. Se una fonte rifiuta il client di Node, rigenera quella sezione fuori dal container con `node shared/citta-api/aggiorna.js --curl --solo <sezione>` e `CITTA_DATI` impostata su una cartella del server. Poi copia i file nel volume con `docker compose cp`.

- Stato del rinfresco e delle fonti: `curl -s localhost:8791/salute` (età degli snapshot, fonti in pausa) e `/citta/fonti` (dettaglio per fonte e per dominio, errori dell'ultima generazione).
- Un cron non serve. Se preferisci il cron al rinfresco interno: `CITTA_AGGIORNA=0` e, per esempio, `0 * * * * cd …/cloud/citta-api && docker compose exec -T citta-api node shared/citta-api/aggiorna.js --solo aria,meteo`.

Il volume si può cancellare senza perdere niente (`docker compose down -v` qui è innocuo: i dati si rigenerano), al contrario del broker MQTT.

## Aggiornamento

```bash
cd hackathon_2026_a && git pull
cd cloud/citta-api && docker compose up -d --build
./prova.sh
```

## Log e controllo

```bash
docker compose ps                         # "healthy" se /salute risponde
docker compose logs -f citta-api          # una riga per richiesta; fonti degradate; pause dopo 429; rinfresco
```

Righe utili nei log:
- `fonte meteo: riserva (… 429 …)`: Open-Meteo ha esaurito la quota dell'IP, si usa MET Norway;
- `rete: open-meteo.com in pausa fino alle 15:20 (HTTP 429: limite di richieste)`: per 15 minuti nessuna richiesta a quel dominio;
- `aggiornamento: eventi: scritto eventi.json in 12.3 s`: snapshot rigenerato.

## Sicurezza

- Solo `GET`; nessun dato personale salvato; i log contengono percorso, codice e durata (non gli header né il token).
- Token confrontato in tempo costante; `/salute` è pubblica ma non dice niente di riservato.
- Container in sola lettura (scrive solo nel volume `/dati` e in `/tmp`), utente `node`, nessuna capability, `no-new-privileges`, 512 MB e 1 CPU al massimo, log ruotati.

## Problemi comuni

| Sintomo | Causa e rimedio |
|---|---|
| `/citta/meteo` dice `riserva` o `salvato` | Open-Meteo ha risposto 429 o non risponde: è previsto, l'API lo dichiara. `/citta/fonti` mostra la pausa e quando finisce |
| `401` da CiroGPT | token diverso tra `.env` e la variabile `CITTA_API_TOKEN` di OpenClaw |
| la mappa nel browser non legge l'API | origine non in `CITTA_API_CORS`, oppure token impostato (il browser non lo ha) |
| `stato: degradato` in `/salute` | nessuno snapshot caricato: controlla il volume (`docker compose exec citta-api ls -l /dati`) |
| rinfresco sempre in errore | l'uscita verso una fonte è bloccata dal firewall del server; `/citta/fonti` → `snapshot.<sezione>.fonti[].errore` |

## Cosa è stato verificato

Nella sandbox di sviluppo (14/11/2026), con Docker 29.9 e Compose v5: costruzione dell'immagine (contesto di build di 2 KB), avvio, healthcheck `healthy`, `/salute` senza token, `401` senza token, `/citta/riassunto` con token; senza rete le fonti passano allo snapshot dichiarato (`salvato`); con la rete (proxy della sandbox) meteo e aria dal vivo, rinfresco interno di aria e meteo e rigenerazione manuale dei trasporti nel container. Non ancora provato sul server vero.

Revisione dello stesso giorno (container sulla 8794 con `CITTA_AGGIORNA=0`): `healthy` al terzo controllo, `prova.sh` 6 prove su 6, circa 20 MB di memoria a riposo. Verificati la radice in sola lettura, `/dati` scrivibile, l'utente `node`, `cap_drop: ALL` e `no-new-privileges`. Immagine di 240 MB su disco (61,5 MB compressi): quasi tutta è l'immagine base di Node, l'app pesa circa 0,5 MB e i test restano fuori.
