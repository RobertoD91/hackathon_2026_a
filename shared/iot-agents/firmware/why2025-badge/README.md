# Firmware `why2025-badge`: il badge Cyber Saiyan come sensore MQTT

Firmware per il badge **WHY2025/EMF2026 di Cyber Saiyan** ([CyberSaiyanIT/why2025-badge](https://github.com/CyberSaiyanIT/why2025-badge)) costruito **sopra il firmware originale** (ESP-IDF 4.4 via PlatformIO): il badge resta com'era (logo, radar dei badge, giochi, LED, web in modalità AP) e in più:

- legge i sensori I2C collegati (luce, temperatura, umidità, pressione) e quelli che ha già sulla scheda (tensione di alimentazione, temperature interne, badge vicini via Bluetooth);
- pubblica le letture via MQTT verso `twinciro.robertodisanto.it` nel formato del contratto ([`../../CONTRATTO.md`](../../CONTRATTO.md), sezioni 1 e 9) su `bighack/<zona>/<deviceId>/readings`, con stato online/offline (last will) e, a richiesta, anche nel formato di `c5-agentic-city`;
- ha una schermata **SENSORI** con i valori dal vivo, lo stato della connessione e i messaggi che arrivano dal cloud; le rotelle mandano una **segnalazione** (`button: true`) o una lettura immediata.

Il ponte [`../../tools/mqtt-bridge.js`](../../tools/mqtt-bridge.js) porta le letture dal broker al hub (`POST /api/readings`).

> **Stato:** compila davvero (PlatformIO, `espressif32@5.4.0`, ESP-IDF 4.4.5, nessun avviso anche con `-Wall -Wextra`, anche da un clone pulito con `./build.sh`); le conversioni dei sensori e il JSON passano i test sul PC (`test/run.sh`, con il validatore del hub); il percorso broker → ponte → hub è provato con Mosquitto 2.1.2. **Non è ancora stato provato su un badge vero**: alla prima accensione guarda il monitor seriale (`./build.sh monitor`).

## L'hardware del badge

Verificato su schema, PCB e BOM del repo (`hardware/dragon_4L_R02/`, `hardware/production/BOM-dragon_4L_R02.csv`) e sul codice (`main/badge/led.h`, `ui.h`, `sdkconfig.emf2026-badge`).

| Parte | Dettaglio |
|---|---|
| SoC | **ESP32-C3FH4**: RISC-V single core 160 MHz, 400 KB di RAM, 4 MB di flash integrata, Wi-Fi 2,4 GHz + Bluetooth 5 LE, antenna su PCB o u.FL. **Non** è un ESP32-P4/C6: Wi-Fi e Bluetooth sono nel chip stesso |
| Display | TFT 2,8" 320×240, controller ST7789V su SPI; touch resistivo collegato al **TSC2007** (non usato dal firmware originale) |
| Retroilluminazione | 4 uscite dell'**AW9523B** (espansore I2C, 0x5A); le altre 12 sono sui connettori RGB0-RGB3 |
| LED | 7 × WS2812B-2020 (le "sfere del drago") su GPIO5 |
| Ingressi | 2 rotelle (su/giù/centro): GPIO8 e GPIO9 (GPIO9 = strapping di boot), pull-up 5,1 kΩ |
| Alimentazione | LiPo + TP4054 + DW01A; step-down MT3410LB a 3,3 V; boost MT3608 a ~4,75 V per i LED |
| Firmware originale | ESP-IDF 4.4.5 via PlatformIO, LVGL 7, BLE a HCI grezzo, web su SPIFFS |

Piedinatura (GPIO dell'ESP32-C3):

| GPIO | Uso | GPIO | Uso |
|---|---|---|---|
| 0 | I2C SCL (400 kHz) | 6 | SPI CLK display |
| 1 | I2C SDA | 7 | SPI MOSI display |
| 2 | SPI MISO display | 8 | rotella "giù" (BUTTON-A) |
| 3 | reset display | 9 | rotella "su" (BUTTON-B, boot) |
| 4 | D/C display | 10 | CS display |
| 5 | dati WS2812 (DOUT dell'ultimo LED sul pin 1W) | 18/19, 20/21 | USB, UART0 (connettore RS232) |

Bus I2C: AW9523B **0x5A**, TSC2007 **0x48** (A0 e A1 a massa). Connettori utili: **I2C** = GND, SCL, SDA, 1W; **POW** = GND, +3,3 V, +4,75 V; **RS232** = GND, TX, RX, rotella B, rotella A.

## Il sensore di luce

**Sul badge non c'è un sensore di luce.** Non è nella BOM né sul PCB, e non si può aggiungere una fotoresistenza diretta: i soli pin con ADC dell'ESP32-C3 (GPIO0-4 su ADC1, GPIO5 su ADC2) sono già usati da I2C, display e LED. L'unico ingresso analogico libero, l'AUX del TSC2007, è già collegato a VIN con un partitore 100k/100k (R3, R16).

La soluzione è un **modulo I2C** sul connettore **I2C**, alimentato a **3,3 V** dal connettore **POW** (il connettore I2C non porta l'alimentazione). Le resistenze di pull-up da 5,1 kΩ sono già sulla scheda. Il firmware li trova da solo all'avvio, senza configurazione:

| Modulo | Indirizzo | Note |
|---|---|---|
| **BH1750** (GY-302) | 0x23 (ADDR a GND) o 0x5C | consigliato: lux veri 1-54 612, modo continuo ad alta risoluzione (lux = conteggi / 1,2) |
| **VEML7700** | 0x10 | riconosciuto dall'ID 0x81; guadagno 1/8, 100 ms (fino a ~30 000 lx lineari) con la correzione di Vishay |
| SHT4x / SHT3x | 0x44 / 0x44-0x45 | temperatura e umidità, CRC controllato |
| AHT20 / AHT10 | 0x38 | temperatura e umidità |
| BME280 / BMP280 | 0x76 / 0x77 | temperatura, (umidità), **pressione** |

Cablaggio: modulo `VCC` → POW pin 2 (+3,3 V), `GND` → I2C pin 1, `SCL` → I2C pin 2, `SDA` → I2C pin 3. Connettori JST da 1,25 mm (HCZZ0015): servono cavetti adatti o saldare sui pad. I sensori trovati compaiono nel log seriale e in fondo alla schermata SENSORI (es. `BH1750@23 TSC2007@48`). Senza sensore di luce `light_lux` non viene inviato e lo schermo lo dice.

Sensori già presenti, usati senza aggiungere nulla:

| Grandezza | Da dove | Dove finisce |
|---|---|---|
| `supply_v` | TSC2007, ingresso AUX = VIN/2 (batteria, o USB meno il diodo) | `readings` |
| `badges_nearby` | scansione BLE del firmware originale: badge Cyber Saiyan vicini | `readings` (se il Bluetooth è acceso) |
| `button` | rotelle sulla schermata SENSORI | `readings` (`true` sulla segnalazione) |
| `board_temp_c` | TSC2007, metodo differenziale (±2 °C, passo ~2 °C): temperatura della scheda, non dell'ambiente | `meta` |
| `chip_temp_c` | sensore interno dell'ESP32-C3 | `meta` |

## Cosa fa il firmware

Il repo originale non è copiato qui: `build.sh` lo clona al commit `861cebc` del branch `EMF2026` e ci applica:

- `overlay/main/badge/`: file nuovi
  - `telemetry.c/.h`: Wi-Fi STA, SNTP, ESP-MQTT, invio periodico, comandi;
  - `sensors.c/.h`: rilevamento e lettura via I2C;
  - `sensor_math.c/.h`: conversioni (C puro, testate sul PC);
  - `payload.c/.h`: JSON e topic (C puro, testati sul PC);
  - `telemetry_ui.c/.h`: schermata SENSORI;
  - `telemetry_cfg.h`: valori predefiniti della configurazione.
- `patches/0001-telemetria-mqtt.patch`: poche righe in 3 file originali:
  - `main.c`: avvio della telemetria, Bluetooth facoltativo;
  - `ui.c`: schermata in più, rotelle, programma di EMF non caricato, schermo acceso;
  - `wifi.c`: non tocca la connessione della telemetria.
- `sdkconfig.telemetry`: buffer TLS dinamici (meno RAM), niente coda MQTT da disconnessi.

Comportamento:

- **Schermate**: SENSORI è la seconda (dopo il logo) ed è quella iniziale (`TELEMETRY_START_SCREEN`). Pressione lunga di una rotella = schermata successiva/precedente, come sempre. Su SENSORI: **SU = segnalazione** (lettura subito con `button: true`, e l'evento c5 se attivo), **GIÙ = invia ora**. Lo schermo resta acceso a luminosità media (`TELEMETRY_SCREEN_AWAKE`).
- **Wi-Fi**: la telemetria si collega alla rete di `telemetry_config.h` quando nessun altro usa il Wi-Fi. Si ricollega da sola con attese da 2 a 30 s. Se dalla schermata admin accendi l'**AP** (web del badge), la telemetria va in pausa; riparte quando l'AP si spegne (60 s senza client). Il "SYNC SCHEDULE" del firmware originale funziona ancora (usa la sua rete, poi la telemetria riprende).
- **MQTT** (ESP-MQTT di ESP-IDF):
  - riconnessione automatica ogni 5 s e keepalive di 30 s;
  - last will `{"deviceId":...,"online":false}` retained su `.../status`; a ogni connessione `{"online":true,...}` retained e una lettura subito;
  - letture ogni `TELEMETRY_INTERVAL_S` (15 s); da disconnesso la lettura si salta (niente coda che riempie la RAM); `ts` solo quando l'ora NTP è sincronizzata.
- **Comandi** su `bighack/<zona>/<deviceId>/cmd`:
  - `{"text":"..."}` → testo sulla schermata SENSORI (es. un avviso degli agenti);
  - `{"read":true}` → lettura subito;
  - `{"interval":30}` → nuovo intervallo (2-3600 s).
- **Memoria**: con BLE + Wi-Fi + LVGL l'heap è poco (vedi `SKILL.md` del repo originale). Per questo:
  - il programma di EMF Camp (~50 KB) non viene caricato (`TELEMETRY_KEEP_SCHEDULE 0`);
  - i buffer TLS sono dinamici;
  - se il TLS non si connette per mancanza di memoria, `TELEMETRY_DISABLE_BLE 1` spegne il Bluetooth;
  - l'heap libero è in `meta.heap` a ogni lettura.

## Compilare e caricare

Servono `git`, `bash` e **PlatformIO** (`pip install platformio`, oppure l'estensione di VS Code). Su Windows usa WSL o Git Bash. La prima compilazione scarica ESP-IDF 4.4.5 e la toolchain RISC-V (~1,5 GB) e dura qualche minuto; le successive ~15 s.

```bash
cd shared/iot-agents/firmware/why2025-badge
cp telemetry_config.example.h telemetry_config.h   # poi metti Wi-Fi, utente/password MQTT, zona
./build.sh                 # clona il repo originale in ./upstream, applica overlay e patch, compila
./build.sh upload          # carica via USB-C (PORT=/dev/ttyACM0 se non la trova da sola)
./build.sh monitor         # log seriale a 115200: sensori trovati, Wi-Fi, MQTT, ogni pubblicazione
```

- **Modalità download** se il caricamento non parte: tieni premuto il centro della rotella sinistra (GPIO9), collega l'USB, premi e rilascia **RST**, tieni ancora ~2 s, rilascia.
- `./build.sh uploadfs` serve solo su un badge nuovo o dopo un reset di fabbrica: un caricamento del solo firmware conserva le impostazioni (`settings.json`).
- `EXAMPLE_CONFIG=1 ./build.sh` compila con la configurazione d'esempio: serve solo per controllare che compili.
- Il binario è in `upstream/.pio/build/emf2026-badge/firmware.bin`. La flash dell'app è all'89% (1,87 MB su 2 MB; l'originale è all'84%).

## Configurazione

`telemetry_config.h` (non versionato; `.gitignore`), copiato da [`telemetry_config.example.h`](telemetry_config.example.h):

| Opzione | Predefinito | Note |
|---|---|---|
| `TELEMETRY_WIFI_SSID`, `_PASSWORD` | — | SSID vuoto = telemetria spenta (il badge torna quello originale) |
| `TELEMETRY_WIFI_ENTERPRISE`, `_EAP_IDENTITY`, `_EAP_USERNAME` | 0 | reti 802.1X (PEAP/TTLS) |
| `TELEMETRY_NET_LABEL` | `"wifi"` | `meta.net`: `"5g"` se il Wi-Fi è l'hotspot 5G |
| `TELEMETRY_MQTT_HOST` | `twinciro.robertodisanto.it` | |
| `TELEMETRY_MQTT_TRANSPORT`, `_PORT` | `"mqtt"`, 1883 | `"mqtts"` 8883 (TLS), `"wss"` 8884 (o 443 con nginx), `"ws"` |
| `TELEMETRY_MQTT_USER`, `_PASSWORD` | `""` | con il broker di `cloud/mqtt` l'utente **è il deviceId** (l'ACL gli fa scrivere solo `bighack/+/<utente>/#`); utente vuoto + password = si usa il deviceId |
| `TELEMETRY_MQTT_TLS_INSECURE`, `_CA_PEM` | 0, `""` | TLS verificato con il bundle di CA di ESP-IDF (Let's Encrypt va bene); CA propria per i certificati autofirmati |
| `TELEMETRY_MQTT_KEEPALIVE_S`, `_QOS` | 30, 0 | lo stato usa sempre QoS 1 retained |
| `TELEMETRY_TOPIC_PREFIX` | `"bighack"` | |
| `TELEMETRY_C5_COMPAT` | 0 | 1 = anche `napoli/sensori/<deviceId>/<grandezza>` `{"valore": n, "zona": "..."}` e il pulsante su `napoli/eventi/manuale` |
| `TELEMETRY_DEVICE_ID` | `""` | vuoto = utente MQTT, oppure `badge-<MAC>` (lo mostra la schermata SENSORI) |
| `TELEMETRY_ZONE`, `_LAT`, `_LON` | `citta-della-scienza`, 40.8069, 14.1764 | `NAN` per non inviare le coordinate; il ponte può riassegnare la zona con `MQTT_MAP` |
| `TELEMETRY_INTERVAL_S` | 15 | |
| `TELEMETRY_DISABLE_BLE`, `_KEEP_SCHEDULE`, `_START_SCREEN`, `_SCREEN_AWAKE` | 0, 0, 1, 1 | vedi "Comportamento" |

Più badge con lo stesso firmware: lascia `TELEMETRY_DEVICE_ID` e `TELEMETRY_MQTT_USER` vuoti. Ogni badge si chiama `badge-<MAC>`: crea l'utente omonimo sul broker (`cloud/mqtt/scripts/aggiungi-utente.sh badge-1a2b`). Con l'utente vuoto e la password piena, la password dev'essere la stessa per tutti. Altrimenti compila una volta per badge.

## Topic e payload

| Topic | Direzione | Contenuto |
|---|---|---|
| `bighack/<zona>/<deviceId>/readings` | badge → broker | lettura del contratto (sotto), QoS `TELEMETRY_MQTT_QOS` |
| `bighack/<zona>/<deviceId>/status` | badge → broker, **retained** | `{"deviceId","online":true,"fw","ip","zone","interval_s"}`; last will `{"deviceId","online":false,"zone"}` |
| `bighack/<zona>/<deviceId>/cmd` | cloud → badge | `{"text":"..."}`, `{"read":true}`, `{"interval":30}` |
| `napoli/sensori/<deviceId>/<grandezza>` | badge → broker (c5) | `{"valore":532,"zona":"...","deviceId":"..."}`; grandezze `luce`, `temperatura`, `umidita`, `pressione`, `tensione`, `badge_vicini` |
| `napoli/eventi/manuale` | badge → broker (c5) | `{"evento":"segnalazione_badge","zona":"...","da":"<deviceId>"}` alla segnalazione |

Lettura tipica (491 byte; ESP-MQTT ha buffer da 1024 byte, quindi niente limite da 256 byte come PubSubClient):

```json
{"deviceId":"badge-1a2b","ts":1763100000123,
 "location":{"lat":40.8069,"lon":14.1764,"zone":"citta-della-scienza"},
 "readings":{"light_lux":532,"temperature_c":23.5,"humidity_pct":49,"pressure_hpa":1013.3,"supply_v":4.14,"badges_nearby":3,"button":false},
 "meta":{"fw":"badge-mqtt-0.1.0","net":"wifi","simulated":false,"hw":"why2025-badge","trigger":"interval","rssi":-67,"heap":41234,
         "uptime_s":3600,"chip_temp_c":41.3,"board_temp_c":31.0,"light_sensor":"bh1750","climate_sensor":"sht4x"}}
```

`trigger`: `boot` (prima lettura), `reconnect`, `interval`, `button`, `command`. Le grandezze dei sensori assenti non vengono inviate. Senza nessun sensore, `readings` contiene almeno `supply_v` o `button`.

## Provare senza badge

```bash
docker run -d --rm --name mqtt-prova -p 1883:1883 eclipse-mosquitto:2 mosquitto -c /mosquitto-no-auth.conf
PORT=8701 node shared/iot-agents/example/server.js --no-sim &
MQTT_URL=mqtt://localhost:1883 HUB_URL=http://localhost:8701 node shared/iot-agents/tools/mqtt-bridge.js &
node shared/iot-agents/tools/mqtt-pub.js --url mqtt://localhost:1883 --badge --count 5 --every 2 --button
node shared/iot-agents/tools/mqtt-pub.js --url mqtt://localhost:1883 --tasmota tasmota_ABC123
```

`mqtt-pub.js --badge` pubblica come il firmware: stato retained e letture. In dashboard compaiono `badge-prova` e `tasmota_ABC123`; la segnalazione fa partire la notifica dell'esempio. Per mandare un testo allo schermo del badge:

```bash
node shared/iot-agents/tools/mqtt-pub.js bighack/citta-della-scienza/badge-1a2b/cmd '{"text":"Zona affollata: prova il Plebiscito"}'
```

## Tasmota: "non possiamo riciclare Tasmota?"

**Sì, per i sensori generici; no per il badge.** Verificato sulla documentazione di Tasmota (tasmota.github.io, novembre 2026).

**Sul badge:** Tasmota supporta l'ESP32-C3 (binari `tasmota32c3`, si caricano anche dal browser con il Web Installer). Supporta anche i sensori che collegheremmo: BH1750, VEML7700, SHT3x/SHT4x, AHT1x/AHT2x, BME280, tutti su I2C con rilevamento automatico. Ma sul badge si perde quasi tutto ciò che lo rende speciale:

- **display**: l'ST7789 è supportato solo dai build "display" con il driver universale, e la retroilluminazione passa dall'AW9523B: servirebbe uno script Berry per accenderla. Senza, lo schermo resta nero;
- **firmware del badge**: radar BLE dei badge, giochi, logo, schermata SENSORI con i messaggi del cloud, web del badge;
- **tensione di alimentazione**: il TSC2007 non ha un driver Tasmota;
- **logica su misura**: deviceId da MAC, zona, coesistenza con l'AP, comandi `.../cmd`.

Si guadagnano MQTT e telemetria già pronti, configurazione da web, aggiornamenti OTA e Rules/Berry. Il firmware di questa cartella però fa già MQTT: per il badge non conviene.

**Piano B se il firmware custom non va sull'hardware:** Tasmota sul badge in 10 minuti, solo come sensore. Carica `tasmota32c3` dal [Web Installer](https://tasmota.github.io/install/), poi dalla console:

```
Backlog GPIO0 608; GPIO1 640; GPIO5 1376; GPIO9 64; GPIO8 65; Restart 1
```

(I2C SCL1/SDA1, WS2812, Button_n1/n2; non provato su hardware). La luce arriva come `"BH1750":{"Illuminance":..}`; lo schermo resta spento.

**Raccomandazione:**

| Dispositivo | Firmware | Perché |
|---|---|---|
| badge WHY2025/EMF2026 | **questo firmware** | display, segnalazione con le rotelle, messaggi dal cloud, tensione e badge vicini, formato del contratto nativo |
| ESP32/ESP8266 generici con BH1750, DHT22 (AM2301), DS18B20, BME280, SHT3x, LDR | **Tasmota** | nessun codice da scrivere: config da web o con un Backlog, TLS su ESP32, il ponte converte `tele/<topic>/SENSOR` |
| prese smart (Sonoff POW, Shelly, Nous A1T) per C2 | **Tasmota** | `ENERGY.Power` → `power_w` (grandezza standard del contratto) |
| ESP32 con logica propria (semafori di c5, conteggio passaggi) | sketch Arduino | come in `c5-agentic-city/firmware/` e `../esp32-sensor/` |

### Configurare Tasmota per twinciro.robertodisanto.it

Con il broker di `cloud/mqtt` il nome utente MQTT di un Tasmota **è il suo Topic**. L'ACL gli fa scrivere `tele/<utente>/#` e `stat/<utente>/#`, leggere `cmnd/<utente>/#`, e anche `bighack/+/<utente>/#`. L'utente si crea con `cloud/mqtt/scripts/aggiungi-utente.sh tasmota-serra`. Dalla console web di Tasmota:

```
Backlog MqttHost twinciro.robertodisanto.it; MqttPort 1883; MqttUser tasmota-serra; MqttPassword <password>; Topic tasmota-serra; TelePeriod 30
```

- **TLS** (solo build ESP32; CA Let's Encrypt inclusa da Tasmota 13.4.1.2): `Backlog SetOption103 1; MqttPort 8883`.
- **Sensori** su un ESP32 DevKit, codici dei componenti dalla documentazione:
  - BH1750 o BME280 su I2C (SDA 21, SCL 22) e DHT22 su GPIO4: `Backlog GPIO22 608; GPIO21 640; GPIO4 1216; Restart 1`;
  - DS18B20 su GPIO4: `GPIO4 1312`;
  - fotoresistenza su GPIO34 (ADC1): `GPIO34 4768` ("ADC Light", arriva come `ANALOG.Illuminance`).
  - I sensori I2C si riconoscono da soli dopo il riavvio.
- `TelePeriod` va da 10 a 3600 s (predefinito 300): per la demo 10-30.
- **Zona**: due modi.
  - Nel ponte con `MQTT_MAP` (`{"tasmota-serra":{"zone":"plebiscito","lat":40.8359,"lon":14.2488}}`, vedi `../../tools/mqtt-map.example.json`).
  - Oppure in Tasmota con `FullTopic bighack/plebiscito/%topic%/%prefix%/`. La telemetria arriva allora su `bighack/plebiscito/tasmota-serra/tele/SENSOR`, il ponte legge la zona dal topic, e anche i comandi si spostano su `bighack/plebiscito/tasmota-serra/cmnd/...`.
- **Pulsante come segnalazione**, regola che pubblica direttamente nel formato del contratto (il ponte accetta la forma corta):
  ```
  Rule1 ON Button1#State DO Publish bighack/plebiscito/%topic%/readings {"button":true} ENDON
  Rule1 1
  ```

Cosa converte il ponte (dettagli in `../../CONTRATTO.md`, sezione 9):

| Tasmota | Contratto |
|---|---|
| `Illuminance` (BH1750, VEML7700, TSL2561, ANALOG) | `light_lux` |
| `Temperature`, `Humidity` | `temperature_c` (°F convertiti), `humidity_pct` |
| `Pressure` | `pressure_hpa` (mmHg e inHg convertiti) |
| `CarbonDioxide` | `co2_ppm` |
| `ENERGY.Power` | `power_w` |
| `ENERGY.Today` | `energy_today_kwh` |
| `tele/<topic>/LWT` `Online`/`Offline` | `online` |
| `POWER` in `tele/<topic>/STATE` | `relay` |
| `Wifi.Signal` | `meta.rssi` |

Più sensori uguali: il primo prende il nome standard, gli altri il nome del sensore, es. `temperature_c_ds18b20_2`.

## Test

```bash
shared/iot-agents/firmware/why2025-badge/test/run.sh       # C sul PC: conversioni + JSON validato con validate.js del hub
node --test shared/iot-agents/test/mqtt.test.js            # ponte, client MQTT, conversioni Tasmota/c5
MQTT_TEST_URL=mqtt://localhost:1883 node --test shared/iot-agents/test/mqtt.test.js   # anche contro un broker vero
```

`test/sensor_math_host_test.c` usa i vettori dei datasheet: CRC Sensirion `0xBEEF → 0x92` e l'esempio di compensazione del BMP280 (25,08 °C, 100 653,27 Pa). Controlla anche i casi limite: CRC sbagliato, sensore occupato, umidità oltre 100 %, segno dei coefficienti H4/H5.

## Raggiungibilità del broker

Prove da questa sessione (sandbox con proxy HTTPS), 14/11/2026:

- Dal 14/11 pomeriggio il server del team è `twinciro.robertodisanto.it`, che risolve in 34.154.255.49. Il vecchio `cloud.robertodisanto.it` (34.154.157.249) non si usa più.
- **1883 e 8883: bloccati dalla sandbox**, il che è diverso da "non funziona": il proxy accetta il tunnel `CONNECT` ma non inoltra MQTT. Con `test.mosquitto.org` (che funziona) succede lo stesso: 1883 non risponde, 8883 viene resettato.
- **443**: dalla sandbox nessuna risposta HTTPS da `twinciro.robertodisanto.it`. Non si può dire da qui se sul server c'è qualcosa in ascolto.

Da provare sul posto, da un PC in rete:

```bash
node shared/iot-agents/tools/mqtt-pub.js --url mqtt://twinciro.robertodisanto.it:1883 --user <u> --password <p> --sub 'bighack/#'
```

Valori predefiniti del broker del team (`cloud/mqtt`): 1883 con utente/password, 8883 TLS, 8884 WebSocket TLS (443 con nginx).

## Limiti noti

- Non provato su un badge vero: Wi-Fi/BLE/LVGL e TLS insieme sono la parte più a rischio per la memoria. Il primo test va fatto in `mqtt` sulla 1883; se il TLS fallisce, guarda `meta.heap` e prova `TELEMETRY_DISABLE_BLE 1`.
- La temperatura del TSC2007 è grossolana (passo ~2 °C, scaldata dalla scheda): per questo sta in `meta`, non in `readings`.
- Con il badge in modalità AP la telemetria è in pausa; durante il "SYNC SCHEDULE" usa la rete di EMF.
- Le letture fatte da disconnesso non vengono rimandate (scelta voluta: niente RAM che cresce); lo stato retained e il last will dicono quando il badge è offline.
- `version.c` del firmware originale riporta `GIT_REV` con il `+` (albero modificato dalle patch): è normale.
