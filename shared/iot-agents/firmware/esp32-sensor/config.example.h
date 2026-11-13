// Configurazione del firmware esp32-sensor.
// COPIA questo file in `config.h` (non versionato) e metti i tuoi valori:
//   cp config.example.h config.h
// Le costanti TEMP_*, LIGHT_*, NET_* sono definite in esp32-sensor.ino.

#pragma once

// ---------------------------------------------------------------- rete
// Per ora: Wi-Fi verso il router/hotspot 5G (vedi README, sezione "5G").
#define NET_MODE        NET_WIFI
#define WIFI_SSID       "nome-rete"
#define WIFI_PASSWORD   "password-rete"
// Come dichiarare la rete in meta.net: "5g" se il Wi-Fi è l'hotspot/router 5G, altrimenti "wifi".
#define NET_LABEL       "5g"

// ---------------------------------------------------------------- hub
// Indirizzo del hub (il PC con `node .../server.js`, stessa rete), senza barra finale.
// Esempi: "http://192.168.1.50:8701"  oppure  "https://hub.example.org"
#define HUB_URL         "http://192.168.1.50:8701"
// Token del hub (variabile HUB_TOKEN sul server). Lascia "" se non usato.
#define HUB_TOKEN       ""
// Con https: true accetta qualsiasi certificato (comodo per la demo, non per la produzione).
#define HUB_INSECURE_TLS true

// ---------------------------------------------------------------- identità e posizione
#define DEVICE_ID       "esp32-plebiscito-01"
#define LOCATION_LAT    40.8359
#define LOCATION_LON    14.2488
#define LOCATION_ZONE   "plebiscito"

// Ogni quanto inviare una lettura (millisecondi).
#define SEND_INTERVAL_MS 5000

// ---------------------------------------------------------------- sensori
// Temperatura: TEMP_DHT22 (anche umidità), TEMP_DS18B20 oppure TEMP_NONE.
#define TEMP_SENSOR     TEMP_DHT22
#define DHT_PIN         4
#define DS18B20_PIN     4

// Luce: LIGHT_BH1750 (I2C, lux veri), LIGHT_LDR (fotoresistenza su ADC, stima) oppure LIGHT_NONE.
#define LIGHT_SENSOR    LIGHT_BH1750
#define I2C_SDA         21
#define I2C_SCL         22
// Fotoresistenza: usa un pin ADC1 (32-39): ADC2 non funziona con il Wi-Fi acceso.
#define LDR_PIN         34
#define LDR_LUX_AT_MAX  2000.0   // lux stimati quando l'ADC legge 4095 (da tarare)
#define LDR_INVERT      false    // true se il partitore dà valori alti al buio

// Pulsante verso GND (pull-up interno). 0 = tasto BOOT della scheda, nessun cablaggio.
// -1 per disattivarlo.
#define BUTTON_PIN      0

// LED di stato (lampeggia a ogni invio). 2 su molte schede ESP32 DevKit; -1 per disattivarlo.
#define LED_PIN         2
