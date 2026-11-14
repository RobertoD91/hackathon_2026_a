# Firmware `why2025-badge`: il badge Cyber Saiyan come nodo di TwinCiro

Firmware per il badge **WHY2025/EMF2026 di Cyber Saiyan** ([CyberSaiyanIT/why2025-badge](https://github.com/CyberSaiyanIT/why2025-badge)) costruito **sopra il firmware originale** (ESP-IDF 4.4 via PlatformIO): il badge resta com'era (logo, radar dei badge, giochi, LED, web in modalità AP) e in più parla con la città nel **formato MQTT unico di TwinCiro** (specifica completa in [`../README.md`](../README.md)):

- si collega all'**hotspot del team** (`iBob12`) e al broker `twinciro.robertodisanto.it:1883` (già nei valori predefiniti: resta da mettere solo utente e password MQTT);
- fa da **contapersone a mano**: rotella SU = un gruppo di persone visto nella sua zona, pubblicato subito su `napoli/sensori/<id>/persone`, che l'agente Folla della città aggiunge alla stima della zona; rotella GIÙ = azzera;
- pubblica le letture dei sensori I2C collegati (temperatura, umidità, luce, pressione) su `napoli/sensori/<id>/<grandezza>`, una per grandezza;
- tiene aggiornato il suo **stato** trattenuto su `napoli/nodi/<id>/stato` (con last will `{"online":false}`) e riceve **comandi** su `napoli/nodi/<id>/cmd` (testo sullo schermo, cambio di zona, azzera);
- ha una schermata **SENSORI** con contapersone, valori dal vivo, stato della connessione e i messaggi che arrivano dalla città.

> **Stato:** compila davvero (PlatformIO, `espressif32@5.4.0`, ESP-IDF 4.4.5, nessun avviso anche con `-Wall -Wextra`; ricompilato il 14/11 sera con `./build.sh` da un clone pulito, flash all'89,0%); topic, JSON e contapersone passano i test sul PC (`test/run.sh`, con il validatore del formato `../valida-messaggi.mjs`); il broker con l'ACL nuova è provato in Docker con Mosquitto 2.1.2. **Non è ancora stato provato su un badge vero**: alla prima accensione guarda il monitor seriale (`./build.sh monitor`).

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

## Sensori

**Sul badge non c'è un sensore di luce.** Non è nella BOM né sul PCB, e non si può aggiungere una fotoresistenza diretta: i soli pin con ADC dell'ESP32-C3 (GPIO0-4 su ADC1, GPIO5 su ADC2) sono già usati da I2C, display e LED. L'unico ingresso analogico libero, l'AUX del TSC2007, è già collegato a VIN con un partitore 100k/100k (R3, R16).

La soluzione è un **modulo I2C** sul connettore **I2C**, alimentato a **3,3 V** dal connettore **POW** (il connettore I2C non porta l'alimentazione). Le resistenze di pull-up da 5,1 kΩ sono già sulla scheda. Il firmware li trova da solo all'avvio, senza configurazione:

| Modulo | Indirizzo | Note |
|---|---|---|
| **BH1750** (GY-302) | 0x23 (ADDR a GND) o 0x5C | consigliato: lux veri 1-54 612, modo continuo ad alta risoluzione (lux = conteggi / 1,2) |
| **VEML7700** | 0x10 | riconosciuto dall'ID 0x81; guadagno 1/8, 100 ms (fino a ~30 000 lx lineari) con la correzione di Vishay |
| SHT4x / SHT3x | 0x44 / 0x44-0x45 | temperatura e umidità, CRC controllato |
| AHT20 / AHT10 | 0x38 | temperatura e umidità |
| BME280 / BMP280 | 0x76 / 0x77 | temperatura, (umidità), **pressione** |

Cablaggio: modulo `VCC` → POW pin 2 (+3,3 V), `GND` → I2C pin 1, `SCL` → I2C pin 2, `SDA` → I2C pin 3. Connettori JST da 1,25 mm (HCZZ0015): servono cavetti adatti o saldare sui pad. I sensori trovati compaiono nel log seriale, nella schermata SENSORI e nel campo `sensori` dello stato (es. `BH1750@23 TSC2007@48`). **Senza moduli I2C il badge non pubblica temperatura, umidità, luce né pressione** (niente valori inventati): pubblica comunque lo stato e il contapersone.

Cosa c'è già sulla scheda, usato senza aggiungere nulla:

| Dato | Da dove | Dove finisce |
|---|---|---|
| `persone` | rotelle sulla schermata SENSORI (contapersone a mano) | `napoli/sensori/<id>/persone` |
| `tensione` | TSC2007, ingresso AUX = VIN/2 (batteria, o USB meno il diodo) | campo dello stato |
| `badge_vicini` | scansione BLE del firmware originale: badge Cyber Saiyan vicini | campo dello stato (se il Bluetooth è acceso) |
| `rssi`, `ip`, `heap` | Wi-Fi e memoria dell'ESP32-C3 | campi dello stato |
| temperatura della scheda e del chip | TSC2007 (±2 °C, scaldata dalla scheda) e sensore interno dell'ESP32-C3 | solo sullo schermo: non sono la temperatura dell'ambiente |

## Cosa fa il firmware

Il repo originale non è copiato qui: `build.sh` lo clona al commit `861cebc` del branch `EMF2026` e ci applica:

- `overlay/main/badge/`: file nuovi
  - `telemetry.c/.h`: Wi-Fi STA, ESP-MQTT, pubblicazioni periodiche, contapersone, comandi;
  - `sensors.c/.h`: rilevamento e lettura via I2C;
  - `sensor_math.c/.h`: conversioni (C puro, testate sul PC);
  - `payload.c/.h`: topic e JSON nel formato `napoli/` (C puro, testati sul PC);
  - `contapersone.c/.h`: finestra scorrevole delle pressioni della rotella SU (C puro, testato sul PC);
  - `telemetry_ui.c/.h`: schermata SENSORI;
  - `telemetry_cfg.h`: valori predefiniti della configurazione (hotspot, broker, zona).
- `patches/0001-telemetria-mqtt.patch`: poche righe in 3 file originali:
  - `main.c`: avvio della telemetria, Bluetooth facoltativo;
  - `ui.c`: schermata in più, rotelle, programma di EMF non caricato, schermo acceso;
  - `wifi.c`: non tocca la connessione della telemetria.
- `sdkconfig.telemetry`: buffer TLS dinamici (meno RAM), niente coda MQTT da disconnessi.

Comportamento:

- **Schermate**: SENSORI è la seconda (dopo il logo) ed è quella iniziale (`TELEMETRY_START_SCREEN`). Pressione lunga di una rotella = schermata successiva/precedente, come sempre. Lo schermo resta acceso a luminosità media (`TELEMETRY_SCREEN_AWAKE`).
- **Rotelle sulla schermata SENSORI** (contapersone a mano):
  - **SU** = un gruppo di persone visto: +1 e pubblicazione **subito** di `napoli/sensori/<id>/persone` con `valore` = pressioni negli ultimi `TELEMETRY_PERSONE_FINESTRA_S` (10 minuti) e `moltiplicatore` = `TELEMETRY_PERSONE_MOLTIPLICATORE` (500);
  - **GIÙ** = azzera il conteggio e pubblica subito `valore` 0 (per ripetere la demo);
  - le pressioni escono dalla finestra da sole; lo schermo mostra il conteggio e quante persone aggiunge alla zona.
- **Perché il pulsante fa questo**: l'agente Folla della città (`c5-agentic-city/citta/agenti/folla.py`) ascolta `napoli/sensori/+/persone` e somma `valore × moltiplicatore` alla stima della zona, se la zona è una di quelle dello scenario, se la lettura non è più vecchia di 180 s (per questo il badge la ripete a ogni ciclo) e se il badge non è offline. Così il badge cambia davvero quello che vedono gli agenti: 10 pressioni a `rotonda_diaz` = +5000 persone nella stima della zona (capienza 26 000); mentre la regata riempie la Rotonda Diaz basta a far salire prima il livello di affollamento, e la città reagisce (orchestratore, avviso di CiroGPT). Le altre letture e lo stato del badge la città li mostra nella sala (pannello "Sensori reali") e in `GET /stato` (chiavi `sensori` e `nodi`); la temperatura la dice anche l'agente Meteo&Mare. Il vecchio `napoli/eventi/manuale` non si usa più: è un topic condiviso della città, e l'ACL del broker non lo concede ai dispositivi.
- **Wi-Fi**: la telemetria si collega all'hotspot quando nessun altro usa il Wi-Fi. Si ricollega da sola con attese da 2 a 30 s. Se dalla schermata admin accendi l'**AP** (web del badge), la telemetria va in pausa; riparte quando l'AP si spegne (60 s senza client). Il "SYNC SCHEDULE" del firmware originale funziona ancora (usa la sua rete, poi la telemetria riprende).
- **MQTT** (ESP-MQTT di ESP-IDF):
  - riconnessione automatica ogni 5 s e keepalive di 30 s;
  - last will `{"online":false}` trattenuto su `napoli/nodi/<id>/stato`; a ogni connessione stato e letture subito;
  - ogni `TELEMETRY_INTERVAL_S` (15 s): stato trattenuto (rinfresca `rssi`, `tensione`, `heap`), una lettura per ogni sensore presente e il contapersone; da disconnesso si salta (niente coda che riempie la RAM), le pressioni restano contate e partono alla riconnessione.
- **Comandi** su `napoli/nodi/<id>/cmd` (JSON, li manda la città con l'utente `c5` o l'amministratore):
  - `{"text":"Rotonda Diaz piena: prova Castel dell'Ovo"}` → testo sulla schermata SENSORI (un testo non JSON viene mostrato così com'è);
  - `{"zona":"mergellina"}` → nuova zona (minuscole, cifre e `_`; vale fino al riavvio), con stato e letture subito;
  - `{"azzera":true}` → come la rotella GIÙ;
  - `{"read":true}` → stato e letture subito;
  - `{"interval":30}` → nuovo intervallo (2-3600 s).
- **Memoria**: con BLE + Wi-Fi + LVGL l'heap è poco (vedi `SKILL.md` del repo originale). Per questo:
  - il programma di EMF Camp (~50 KB) non viene caricato (`TELEMETRY_KEEP_SCHEDULE 0`);
  - i buffer TLS sono dinamici (servono solo con `mqtts`/`wss`; il broker del team è in chiaro);
  - se la connessione fallisce per mancanza di memoria, `TELEMETRY_DISABLE_BLE 1` spegne il Bluetooth;
  - l'heap libero è nel campo `heap` dello stato a ogni ciclo.

## Compilare e caricare

Servono `git`, `bash` e **PlatformIO** (`pip install platformio`, oppure l'estensione di VS Code; con Python 3.12 o più recente serve anche `pip install "setuptools<70"`, perché la piattaforma usa `pkg_resources`). Su Windows usa WSL o Git Bash. La prima compilazione scarica ESP-IDF 4.4.5 e la toolchain RISC-V (~1,5 GB, circa un minuto con una buona rete); le successive ~15 s.

Prima crea l'utente MQTT del badge sul server (vedi [`../README.md`](../README.md#utenti-sul-broker)):

```bash
cd cloud/mqtt && ./scripts/aggiungi-utente.sh badge-1     # stampa la password
```

Poi, sul PC collegato al badge:

```bash
cd firmware/why2025-badge
cp telemetry_config.example.h telemetry_config.h   # metti TELEMETRY_MQTT_USER "badge-1" e la password
./build.sh                 # clona il repo originale in ./upstream, applica overlay e patch, compila
./build.sh upload          # carica via USB-C (PORT=/dev/ttyACM0 se non la trova da sola)
./build.sh monitor         # log seriale a 115200: sensori trovati, Wi-Fi, MQTT, ogni pubblicazione
```

Hotspot, broker, porta e zona sono già nei valori predefiniti: in `telemetry_config.h` servono solo utente e password MQTT (e la zona, se il badge non sta alla Rotonda Diaz).

- **Modalità download** se il caricamento non parte: tieni premuto il centro della rotella sinistra (GPIO9), collega l'USB, premi e rilascia **RST**, tieni ancora ~2 s, rilascia.
- `./build.sh uploadfs` serve solo su un badge nuovo o dopo un reset di fabbrica: un caricamento del solo firmware conserva le impostazioni (`settings.json`).
- `EXAMPLE_CONFIG=1 ./build.sh` compila con la configurazione d'esempio (senza utente e password MQTT): serve solo per controllare che compili.
- `BADGE_DIR=/altra/cartella` sposta la copia di lavoro del repo originale fuori da questa cartella.
- Il binario è in `upstream/.pio/build/emf2026-badge/firmware.bin`. La flash dell'app è all'89% (1,87 MB su 2 MB; l'originale è all'84%).

## Configurazione

`telemetry_config.h` (non versionato; `.gitignore`), copiato da [`telemetry_config.example.h`](telemetry_config.example.h). Le voci che mancano prendono i predefiniti di `overlay/main/badge/telemetry_cfg.h`:

| Opzione | Predefinito | Note |
|---|---|---|
| `TELEMETRY_WIFI_SSID`, `_PASSWORD` | `iBob12`, `IguanaCheDaUnaCapata` | hotspot del team, solo 2,4 GHz; SSID vuoto = telemetria spenta (il badge torna quello originale) |
| `TELEMETRY_WIFI_ENTERPRISE`, `_EAP_IDENTITY`, `_EAP_USERNAME` | 0 | reti 802.1X (PEAP/TTLS) |
| `TELEMETRY_MQTT_HOST` | `twinciro.robertodisanto.it` | |
| `TELEMETRY_MQTT_TRANSPORT`, `_PORT` | `"mqtt"`, 1883 | il broker del team è in chiaro; `"mqtts"` 8883 e `"wss"` 8884 solo se sul broker si accende TLS |
| `TELEMETRY_MQTT_USER`, `_PASSWORD` | `""` | **da mettere**: l'utente **è l'id** del badge (l'ACL lo fa scrivere solo su `napoli/sensori/<utente>/#` e `napoli/nodi/<utente>/#`); utente vuoto + password = si usa l'id |
| `TELEMETRY_MQTT_TLS_INSECURE`, `_CA_PEM` | 0, `""` | solo con TLS: bundle di CA di ESP-IDF, oppure CA propria per i certificati autofirmati |
| `TELEMETRY_MQTT_KEEPALIVE_S`, `_QOS` | 30, 0 | lo stato usa sempre QoS 1 trattenuto |
| `TELEMETRY_DEVICE_ID` | `""` | vuoto = utente MQTT, oppure `badge-<MAC>` (lo mostra la schermata SENSORI) |
| `TELEMETRY_ZONE` | `rotonda_diaz` | una delle zone dello scenario (vedi [`../README.md`](../README.md#zone)); si cambia anche dal cloud con `{"zona":...}` |
| `TELEMETRY_PERSONE_MOLTIPLICATORE` | 500 | persone per ogni pressione della rotella SU |
| `TELEMETRY_PERSONE_FINESTRA_S` | 600 | per quanto conta una pressione (secondi) |
| `TELEMETRY_INTERVAL_S` | 15 | stato e letture periodiche |
| `TELEMETRY_DISABLE_BLE`, `_KEEP_SCHEDULE`, `_START_SCREEN`, `_SCREEN_AWAKE` | 0, 0, 1, 1 | vedi "Comportamento" |

Le vecchie opzioni `TELEMETRY_TOPIC_PREFIX`, `TELEMETRY_C5_COMPAT`, `TELEMETRY_C5_PREFIX`, `TELEMETRY_C5_EVENT`, `TELEMETRY_NET_LABEL`, `TELEMETRY_LAT`/`_LON` e `TELEMETRY_NTP_SERVER` non esistono più: se sono rimaste in un vecchio `telemetry_config.h` vengono ignorate.

Più badge con lo stesso firmware: lascia `TELEMETRY_DEVICE_ID` e `TELEMETRY_MQTT_USER` vuoti. Ogni badge si chiama `badge-<MAC>`: crea l'utente omonimo sul broker (`./scripts/aggiungi-utente.sh badge-1a2b`). Con l'utente vuoto e la password piena, la password dev'essere la stessa per tutti (`aggiungi-utente.sh <id> -` per sceglierla). Altrimenti compila una volta per badge.

## Topic e messaggi

Il formato è quello unico di TwinCiro, descritto per intero in [`../README.md`](../README.md#formato-mqtt-unico). Quello che manda e riceve il badge `badge-1` alla Rotonda Diaz:

| Topic | Direzione | Contenuto |
|---|---|---|
| `napoli/sensori/badge-1/persone` | badge → città | `{"zona":"rotonda_diaz","valore":3,"moltiplicatore":500}` subito a ogni rotella e a ogni ciclo |
| `napoli/sensori/badge-1/temperatura` | badge → città | `{"zona":"rotonda_diaz","valore":23.5}` (°C, solo con SHT4x/SHT3x/AHT/BME280) |
| `napoli/sensori/badge-1/umidita` | badge → città | `{"zona":"rotonda_diaz","valore":49}` (%) |
| `napoli/sensori/badge-1/luce` | badge → città | `{"zona":"rotonda_diaz","valore":532}` (lux, solo con BH1750/VEML7700) |
| `napoli/sensori/badge-1/pressione` | badge → città | `{"zona":"rotonda_diaz","valore":1013.3}` (hPa, solo con BME280/BMP280) |
| `napoli/nodi/badge-1/stato` | badge → città, **trattenuto** | `{"online":true,"ruolo":"badge","zona":"rotonda_diaz","versione":"badge-napoli-0.2.0","ip":"172.20.10.3","rssi":-61,"intervallo_s":15,"sensori":"BH1750@23 TSC2007@48","tensione":4.14,"badge_vicini":3,"heap":41234}`; last will `{"online":false}` |
| `napoli/nodi/badge-1/cmd` | città → badge | `{"text":...}`, `{"zona":...}`, `{"azzera":true}`, `{"read":true}`, `{"interval":30}` |

Nello stato `online`, `ruolo` e `zona` sono quelli del formato comune; `versione`, `ip` e `rssi` ci sono quando il badge è in rete; `intervallo_s`, `sensori`, `tensione`, `badge_vicini` e `heap` sono campi in più del badge, che chi legge può ignorare. Lo stato completo sta sotto i 230 byte (buffer del firmware 320, di ESP-MQTT 1024).

## Provare senza badge

Con un Mosquitto locale in Docker e i client nello stesso container, si può vedere il formato e mandare comandi senza hardware:

```bash
docker run -d --rm --name mqtt-prova -p 1883:1883 eclipse-mosquitto:2.1.2-alpine mosquitto -c /mosquitto-no-auth.conf
# un terminale ascolta tutto napoli/ ...
docker exec -it mqtt-prova mosquitto_sub -t 'napoli/#' -v
# ... l'altro pubblica come il badge (stato trattenuto, contapersone, temperatura)
docker exec mqtt-prova mosquitto_pub -r -t napoli/nodi/badge-1/stato -m '{"online":true,"ruolo":"badge","zona":"rotonda_diaz","versione":"prova"}'
docker exec mqtt-prova mosquitto_pub -t napoli/sensori/badge-1/persone -m '{"zona":"rotonda_diaz","valore":3,"moltiplicatore":500}'
docker exec mqtt-prova mosquitto_pub -t napoli/sensori/badge-1/temperatura -m '{"zona":"rotonda_diaz","valore":23.5}'
docker stop mqtt-prova
```

Con la città collegata a quel broker (`cd c5-agentic-city && python avvia.py --broker localhost`), il contapersone finisce nella stima della Folla di `rotonda_diaz` e le letture nel pannello "Sensori reali" della sala. Per controllare il formato dei messaggi veri: `mosquitto_sub ... -t 'napoli/#' -v | node firmware/valida-messaggi.mjs`.

Con il broker del team e il badge vero (utente `c5` o `admin`, mai la password di un dispositivo):

```bash
docker run --rm -it --entrypoint mosquitto_sub eclipse-mosquitto:2.1.2-alpine \
  -h twinciro.robertodisanto.it -p 1883 -u c5 -P '<password c5>' -t 'napoli/sensori/#' -t 'napoli/nodi/#' -v
# testo sullo schermo del badge
docker run --rm --entrypoint mosquitto_pub eclipse-mosquitto:2.1.2-alpine \
  -h twinciro.robertodisanto.it -p 1883 -u c5 -P '<password c5>' -t napoli/nodi/badge-1/cmd \
  -m '{"text":"Rotonda Diaz piena: prova Castel dell Ovo"}'
```

Sul server basta `cd cloud/mqtt && docker compose --profile monitor run --rm monitor`. La città si collega allo stesso broker con l'utente `c5`: `cd c5-agentic-city && C5_MQTT_UTENTE=c5 C5_MQTT_PASSWORD='<password c5>' python avvia.py --broker twinciro.robertodisanto.it:1883`.

## Piano B: Tasmota sul badge

Se il firmware di questa cartella non va sull'hardware, il badge può diventare un semplice sensore Tasmota (ESP32-C3, binario `tasmota32c3` dal [Web Installer](https://tasmota.github.io/install/)). Si perdono display (l'ST7789 e la retroilluminazione sull'AW9523B non partono senza uno script Berry), radar BLE, giochi, tensione (il TSC2007 non ha un driver Tasmota) e il contapersone; restano i sensori I2C. Dalla console di Tasmota:

```
Backlog GPIO0 608; GPIO1 640; GPIO5 1376; GPIO9 64; GPIO8 65; Restart 1
```

(I2C SCL1/SDA1, WS2812, Button_n1/n2; non provato su hardware). Poi hotspot, broker, FullTopic e regole come per la scheda Tasmota: [`../tasmota/README.md`](../tasmota/README.md).

## Test

```bash
firmware/why2025-badge/test/run.sh       # C sul PC: conversioni, contapersone, topic e JSON nel formato napoli/
```

- `test/sensor_math_host_test.c` usa i vettori dei datasheet: CRC Sensirion `0xBEEF → 0x92` e l'esempio di compensazione del BMP280 (25,08 °C, 100 653,27 Pa); controlla anche i casi limite (CRC sbagliato, sensore occupato, umidità oltre 100 %, segno dei coefficienti H4/H5).
- `test/contapersone_host_test.c`: finestra scorrevole, azzeramento, più di 128 pressioni.
- `test/payload_host_test.c`: topic, letture, stato e last will, escape JSON, id e zone; ogni messaggio prodotto passa da [`../valida-messaggi.mjs`](../valida-messaggi.mjs), che controlla il formato unico con le zone dello scenario di `c5-agentic-city`.

## Raggiungibilità del broker

- Il server del team è `twinciro.robertodisanto.it` (34.154.255.49), broker sulla **1883 in chiaro con password**.
- Dalla sandbox delle sessioni Claude la 1883 non passa (il proxy accetta il tunnel ma non inoltra MQTT): non vuol dire che il broker non funzioni. Le prove del broker sono fatte in Docker (vedi `cloud/mqtt/README.md`).
- Da provare sul posto, da un PC sull'hotspot: il comando `mosquitto_sub` qui sopra con l'utente `c5`.

## Limiti noti

- Non provato su un badge vero: Wi-Fi, BLE e LVGL insieme sono la parte più a rischio per la memoria. Se la connessione non parte, guarda `heap` nello stato o nel log seriale e prova `TELEMETRY_DISABLE_BLE 1`.
- L'hotspot deve essere a 2,4 GHz (l'ESP32-C3 non vede il 5 GHz): sull'iPhone "Massimizza compatibilità".
- Senza moduli I2C il badge manda solo stato e contapersone: la temperatura della scheda (TSC2007, passo ~2 °C, scaldata dalla scheda) non è la temperatura dell'ambiente e non viene pubblicata.
- La zona cambiata con `{"zona":...}` vale fino al riavvio; quella stabile è `TELEMETRY_ZONE`.
- Con il badge in modalità AP la telemetria è in pausa; durante il "SYNC SCHEDULE" usa la rete di EMF.
- `version.c` del firmware originale riporta `GIT_REV` con il `+` (albero modificato dalle patch): è normale.
