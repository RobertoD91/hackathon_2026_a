# firmware/: i due dispositivi reali di TwinCIRO

TwinCIRO usa **due dispositivi veri**, nient'altro. Si collegano entrambi all'**hotspot del team**, poi al broker MQTT del team, e parlano lo **stesso formato** della città agentica (`c5-agentic-city`): topic `napoli/...`, un messaggio per grandezza.

| Dispositivo | Cartella | Cosa manda alla città | Stato |
|---|---|---|---|
| **Badge Cyber Saiyan WHY2025** (ESP32-C3, display) | [`why2025-badge/`](why2025-badge/README.md) | contapersone a mano (rotelle), stato, sensori I2C se collegati; riceve testi e comandi | compila, test sul PC passati; non ancora provato sul badge |
| **Scheda con Tasmota** (ESP32 o ESP8266 con un sensore) | [`tasmota/`](tasmota/README.md) | letture del sensore con le Rules, stato | si configura dalla console web; regole da provare sulla scheda |

## Hotspot

| | |
|---|---|
| SSID | `iBob12` |
| Password | `IguanaCheDaUnaCapata` |

È una rete di prova: SSID e password stanno nella repo su richiesta di Roberto (sono già nei predefiniti del badge e nel comando Backlog di Tasmota). **Solo 2,4 GHz**: ESP32-C3 ed ESP8266 non vedono il 5 GHz. Sull'iPhone attiva **Massimizza compatibilità** (Impostazioni → Hotspot personale), su Android scegli la banda 2,4 GHz.

## Broker

`twinciro.robertodisanto.it`, porta **1883**, MQTT **in chiaro con utente e password** (TLS spento: scelta del 14/11). Configurazione e gestione: [`../cloud/mqtt/`](../cloud/mqtt/README.md). Ogni dispositivo ha **un suo utente, con nome uguale al suo id** (`badge-1`, `tasmota-1`): l'ACL lo fa scrivere solo sotto il proprio nome.

## Formato MQTT unico

Un solo formato per tutti, quello della città Python. Niente `bighack/...` e niente `tele/...` fuori da `napoli/`: il broker non li accetta più.

| Topic | Chi scrive | Messaggio | QoS, trattenuto |
|---|---|---|---|
| `napoli/sensori/<id>/<grandezza>` | dispositivo | `{"zona":"rotonda_diaz","valore":23.5}` | 0, no |
| `napoli/sensori/<id>/persone` | dispositivo | `{"zona":"rotonda_diaz","valore":3,"moltiplicatore":500}` | 0, no |
| `napoli/nodi/<id>/stato` | dispositivo | `{"online":true,"ruolo":"badge","zona":"rotonda_diaz","versione":"badge-napoli-0.2.0","ip":"172.20.10.3","rssi":-60}` | 1, **sì** |
| `napoli/nodi/<id>/stato` (last will) | broker, se il dispositivo sparisce | `{"online":false}` | 1, **sì** |
| `napoli/nodi/<id>/cmd` | città (`c5`) | comandi al badge, JSON (vedi [badge](why2025-badge/README.md#topic-e-messaggi)) | — |
| `napoli/nodi/<topic>/cmnd\|stat\|tele/...` | Tasmota e città | topic interni di Tasmota con `FullTopic napoli/nodi/%topic%/%prefix%/` (comandi, risposte, `SENSOR`, `STATE`, `LWT`) | come Tasmota |

### Letture

- Topic `napoli/sensori/<id>/<grandezza>`, **un messaggio per grandezza**.
- JSON con **solo** `zona` (testo) e `valore` (numero, non testo); per `persone` anche `moltiplicatore` (intero positivo). Nessun altro campo: id e grandezza sono già nel topic.
- Una grandezza che il dispositivo non misura non si manda (niente zeri o valori inventati).

| Grandezza | Unità | Chi la manda oggi |
|---|---|---|
| `temperatura` | °C | badge con SHT4x/SHT3x/AHT20/BME280; Tasmota con SHT3x, AHT2x, BME280, DHT22 |
| `umidita` | % | come sopra (non il BMP280) |
| `luce` | lux | badge con BH1750/VEML7700; Tasmota con BH1750 |
| `pressione` | hPa | BME280/BMP280 |
| `persone` | conteggio | badge (rotella SU); `moltiplicatore` = persone vere per ogni unità contata |

**Chi le usa:** la città di `c5-agentic-city`, collegata a questo broker con l'utente `c5` (variabili `C5_MQTT_UTENTE` e `C5_MQTT_PASSWORD`). Legge tutte le letture `napoli/sensori/+/+` e lo stato dei nodi (`napoli/nodi/+/stato` e, per Tasmota, `napoli/nodi/+/tele/LWT`), e li mostra nella sala operativa (pannello "Sensori reali") e in `GET /stato` della sua API (chiavi `sensori`, con i secondi passati dall'ultima lettura, e `nodi`, con `online`). L'agente Meteo&Mare dice in dialogo la temperatura vera. L'agente Folla (`citta/agenti/folla.py`) aggiunge `valore × moltiplicatore` (200 se manca) alla stima della zona, ma ignora le letture più vecchie di 180 s (il badge le ripete ogni 15 s) e quelle di un nodo offline. Un `valore` non numerico (testo, `null`, NaN) viene scartato; per la Folla anche un `moltiplicatore` non numerico. Lettura dei dispositivi: `c5-agentic-city/citta/sensori.py`.

### Zone

`zona` deve essere una delle zone dello scenario della città ([`c5-agentic-city/dati/scenario_regata.json`](../c5-agentic-city/dati/scenario_regata.json), chiave `"zone"`): **l'agente Folla scarta le letture con una zona che non conosce**.

| `zona` | Luogo | Capienza nello scenario |
|---|---|---|
| `mergellina` | Mergellina | 18 000 |
| `rotonda_diaz` | Rotonda Diaz (predefinita del badge) | 26 000 |
| `piazza_vittoria` | Piazza Vittoria | 7 000 |
| `castel_ovo` | Castel dell'Ovo | 6 500 |
| `municipio` | Piazza Municipio | 9 000 |
| `beverello` | Molo Beverello / Stazione Marittima | 7 000 |
| `vomero` | Vomero | 14 000 |

### Stato

- Topic `napoli/nodi/<id>/stato`, **trattenuto**, QoS 1: chi si collega dopo sa subito chi c'è.
- `online` (obbligatorio), `ruolo` (`badge` o `tasmota`) e `zona`; `versione`, `ip` e `rssi` (dBm) quando ci sono. Il badge aggiunge `intervallo_s`, `sensori`, `tensione`, `badge_vicini`, `heap`: chi legge può ignorarli.
- **Last will** `{"online":false}`, trattenuto, sullo stesso topic: lo pubblica il broker se il dispositivo sparisce.
- **Tasmota:** lo stato `online:true` lo pubblica una regola a ogni connessione, ma il last will di Tasmota non si può spostare: resta su `napoli/nodi/<topic>/tele/LWT` (testo `Online`/`Offline`, trattenuto). Per Tasmota un nodo è offline se `tele/LWT` vale `Offline`.

### Id

1-64 caratteri tra lettere, cifre, `.`, `_` e `-`. È insieme l'id nel topic, l'**utente MQTT** e, per Tasmota, il **Topic** del dispositivo. Esempi: `badge-1`, `tasmota-1`.

### Controllare i messaggi

[`valida-messaggi.mjs`](valida-messaggi.mjs) (Node, nessuna dipendenza) controlla righe `<topic> <messaggio>` come le stampa `mosquitto_sub -v`, con le zone dello scenario: lo usano i test del badge, e si può usare sui messaggi veri.

```bash
mosquitto_sub -h twinciro.robertodisanto.it -u c5 -P '<password c5>' -t 'napoli/sensori/#' -t 'napoli/nodi/+/stato' -v \
  | node firmware/valida-messaggi.mjs
```

## Utenti sul broker

Sul server (`twinciro.robertodisanto.it`, senza root), nella repo:

```bash
cd cloud/mqtt
./scripts/aggiungi-utente.sh badge-1       # stampa la password: va in telemetry_config.h del badge
./scripts/aggiungi-utente.sh tasmota-1     # stampa la password: va in MqttPassword di Tasmota
./scripts/elenca-utenti.sh
./scripts/rimuovi-utente.sh tasmota-1      # a fine evento
```

L'ACL non va toccata: i permessi arrivano dal nome utente. Un dispositivo scrive solo `napoli/sensori/<utente>/#` e `napoli/nodi/<utente>/#` e legge solo i propri comandi (`napoli/nodi/<utente>/cmd` e `.../cmnd/#`). Le password dei dispositivi **non vanno nella repo** (le uniche credenziali versionate sono quelle dell'hotspot).

## Guardare i messaggi

Sul server, con l'utente `monitor` (la sua password è già in `cloud/mqtt/.env`):

```bash
cd cloud/mqtt
docker compose --profile monitor run --rm monitor                                   # tutto, Ctrl+C per uscire
MONITOR_TOPIC='napoli/sensori/#' docker compose --profile monitor run --rm monitor  # solo le letture
MONITOR_TOPIC='napoli/nodi/#' docker compose --profile monitor run --rm monitor     # stato e topic di Tasmota
```

Da un PC, senza installare nulla (utente `c5` o `admin`, mai la password di un dispositivo):

```bash
docker run --rm -it --entrypoint mosquitto_sub eclipse-mosquitto:2.1.2-alpine \
  -h twinciro.robertodisanto.it -p 1883 -u c5 -P '<password c5>' -t 'napoli/#' -v
```

## Cosa non c'è più (14/11)

- il formato `bighack/<zona>/<id>/readings|status|cmd` e i topic Tasmota `tele/...`, `stat/...`, `cmnd/...` fuori da `napoli/`;
- il ponte MQTT → hub e la mappa che lo usava come ingresso (la mappa ora è in `c5-presentazione/` ed è simulata);
- il firmware generico `esp32-sensor` e gli utenti `ponte` e `c5-plastico` del broker;
- il firmware `twinciro-nodo` e il flasher di `c5-agentic-city`, con la loro action `firmware-twinciro.yml` (tolti nel riordino del 14/11 sera).
