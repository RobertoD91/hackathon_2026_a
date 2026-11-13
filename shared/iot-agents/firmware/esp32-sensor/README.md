# Firmware `esp32-sensor`

Sketch Arduino per ESP32: legge **temperatura**, **luce** e un **pulsante** e invia al hub `POST /api/readings` con il JSON del contratto ([`../../CONTRATTO.md`](../../CONTRATTO.md), sezione 1).

- Ogni `SEND_INTERVAL_MS` (predefinito 5 s) invia una lettura con `button: false`.
- Alla pressione del pulsante invia subito una lettura con `button: true`.
- `ts` in millisecondi epoch se l'ora NTP è sincronizzata; altrimenti lo omette e lo mette il server.
- Un sensore in errore (valore `NAN`) viene tolto dal JSON: le altre grandezze arrivano comunque.

> **Stato:** non compilato su hardware (in sessione non c'era `arduino-cli`). Lo sketch è stato controllato con `g++ -fsyntax-only` su intestazioni finte nelle tre combinazioni di sensori, e il JSON prodotto da `buildReading()` passa la validazione del hub. Prima della demo va compilato e provato su una scheda vera.

## File

| File | Cosa fa |
|---|---|
| `esp32-sensor.ino` | lo sketch |
| `config.example.h` | configurazione d'esempio, **versionata** |
| `config.h` | la tua configurazione (Wi-Fi, hub, id), **non versionata** (`.gitignore`) |

```bash
cd shared/iot-agents/firmware/esp32-sensor
cp config.example.h config.h     # poi modifica config.h
```

## Scelta dei sensori

In `config.h`:

| Opzione | Valori | Note |
|---|---|---|
| `TEMP_SENSOR` | `TEMP_DHT22`, `TEMP_DS18B20`, `TEMP_NONE` | il DHT22 dà anche `humidity_pct` |
| `LIGHT_SENSOR` | `LIGHT_BH1750`, `LIGHT_LDR`, `LIGHT_NONE` | BH1750 = lux veri; fotoresistenza = stima da tarare con `LDR_LUX_AT_MAX` |
| `BUTTON_PIN` | numero GPIO o `-1` | `0` = tasto **BOOT** della scheda: si prova senza cablare nulla |
| `LED_PIN` | numero GPIO o `-1` | lampeggia a ogni invio riuscito (202) |

## Cablaggio (ESP32 DevKit)

Alimenta i sensori a **3,3 V** (non 5 V: i GPIO dell'ESP32 non sono tolleranti a 5 V).

| Sensore | Pin sensore → ESP32 | Note |
|---|---|---|
| DHT22 | VCC → 3V3 · GND → GND · DATA → **GPIO4** | resistenza di pull-up 10 kΩ tra DATA e 3V3 (spesso già sul modulo) |
| DS18B20 | VDD → 3V3 · GND → GND · DQ → **GPIO4** | pull-up **4,7 kΩ** tra DQ e 3V3 |
| BH1750 | VCC → 3V3 · GND → GND · SDA → **GPIO21** · SCL → **GPIO22** · ADDR → GND | indirizzo I2C 0x23 |
| Fotoresistenza | 3V3 → LDR → **GPIO34** → 10 kΩ → GND | partitore di tensione; usa solo pin **ADC1** (32-39): ADC2 non funziona con il Wi-Fi acceso |
| Pulsante | un capo → **GPIO** scelto (es. 27) · altro capo → GND | pull-up interno, nessuna resistenza; con `BUTTON_PIN 0` si usa il tasto BOOT |

## Librerie Arduino

Il supporto ESP32 include già `WiFi`, `HTTPClient`, `WiFiClientSecure`, `Wire`. Servono solo quelle dei sensori scelti:

| Sensore | Libreria (Gestore librerie) |
|---|---|
| DHT22 | **DHT sensor library** (Adafruit) + **Adafruit Unified Sensor** |
| DS18B20 | **OneWire** + **DallasTemperature** |
| BH1750 | **BH1750** (Christopher Laws) |

Niente ArduinoJson: il JSON è costruito a mano.

## Caricare lo sketch

### Arduino IDE 2

1. *File → Preferenze → URL aggiuntivi*: `https://espressif.github.io/arduino-esp32/package_esp32_index.json`
2. *Strumenti → Scheda → Gestore schede*: installa **esp32** (Espressif).
3. Installa le librerie dei sensori (tabella sopra).
4. Apri `esp32-sensor.ino`, scheda **ESP32 Dev Module**, scegli la porta e carica.
5. *Monitor seriale* a **115200** baud: vedi la connessione e ogni `POST`.

### arduino-cli

```bash
arduino-cli core update-index --additional-urls https://espressif.github.io/arduino-esp32/package_esp32_index.json
arduino-cli core install esp32:esp32 --additional-urls https://espressif.github.io/arduino-esp32/package_esp32_index.json
arduino-cli lib install "DHT sensor library" "Adafruit Unified Sensor" OneWire DallasTemperature BH1750
arduino-cli compile --fqbn esp32:esp32:esp32 shared/iot-agents/firmware/esp32-sensor
arduino-cli upload  --fqbn esp32:esp32:esp32 -p /dev/ttyUSB0 shared/iot-agents/firmware/esp32-sensor
arduino-cli monitor -p /dev/ttyUSB0 -c baudrate=115200
```

## Provare con il hub

1. Sul PC: `node shared/iot-agents/example/server.js --no-sim` (ascolta su `0.0.0.0:8701`).
2. Trova l'IP del PC nella stessa rete (`ip addr`, `ipconfig`) e mettilo in `HUB_URL`, es. `http://192.168.1.50:8701`.
3. Se il PC ha un firewall, apri la porta 8701.
4. Apri `http://localhost:8701/`: il dispositivo compare con l'etichetta **reale · 5g**; premi il pulsante e arriva la notifica.

Per controllare il formato senza scheda:

```bash
curl -X POST http://localhost:8701/api/readings -H 'content-type: application/json' \
  -d '{"deviceId":"esp32-plebiscito-01","location":{"lat":40.8359,"lon":14.2488,"zone":"plebiscito"},"readings":{"temperature_c":24.1,"light_lux":5300,"button":true},"meta":{"fw":"0.1.0","net":"5g","simulated":false}}'
```

Hub su HTTPS (server cloud): `HUB_URL "https://..."`; con `HUB_INSECURE_TLS true` il certificato non viene verificato (va bene per la demo). Se il hub ha `HUB_TOKEN`, mettilo in `HUB_TOKEN`.

## 5G

Il modulo 5G non è ancora noto. **Per ora l'ESP32 si collega in Wi-Fi a un router o hotspot 5G** e dichiara la rete con `NET_LABEL "5g"` (finisce in `meta.net`). In demo va detto chiaramente: "i sensori escono su rete 5G tramite router".

Punto di estensione: nello sketch la rete passa da tre funzioni, `netBegin()`, `netConnected()`, `netSignal()`, nel blocco `#if NET_MODE == NET_WIFI`. Per un modem 5G collegato via seriale:

1. aggiungi in `config.h` `#define NET_MODE NET_CELLULAR` e i parametri del modem (APN, pin UART, PIN della SIM);
2. implementa le tre funzioni nel blocco `NET_CELLULAR` (es. con **TinyGSM**: `modem.gprsConnect(APN)`, `modem.isGprsConnected()`, `modem.getSignalQuality()`);
3. in `postJson()` usa `TinyGsmClient` + **ArduinoHttpClient** al posto di `HTTPClient`.

Il formato del JSON e il resto del firmware non cambiano.
