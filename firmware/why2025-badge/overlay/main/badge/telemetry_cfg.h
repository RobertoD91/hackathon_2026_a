// telemetry_cfg: carica telemetry_config.h (non versionato) e completa i valori predefiniti.
// Non modificare questo file: copia ../../../telemetry_config.example.h in telemetry_config.h.
//
// Predefiniti = la demo di TwinCIRO: hotspot del team (rete di prova, SSID e password possono stare
// nella repo), broker twinciro.robertodisanto.it:1883 in chiaro, zona rotonda_diaz. Resta da mettere
// in telemetry_config.h solo utente e password MQTT (cloud/mqtt/scripts/aggiungi-utente.sh <id>).

#pragma once

#if __has_include("telemetry_config.h")
#include "telemetry_config.h"
#else
#error "Manca telemetry_config.h: copia telemetry_config.example.h in telemetry_config.h (build.sh lo mette in main/badge/)"
#endif

#ifndef TELEMETRY_ENABLED
#define TELEMETRY_ENABLED 1
#endif
// ---------------------------------------------------------------- Wi-Fi (hotspot del team, 2,4 GHz)
#ifndef TELEMETRY_WIFI_SSID
#define TELEMETRY_WIFI_SSID "iBob12"
#endif
#ifndef TELEMETRY_WIFI_PASSWORD
#define TELEMETRY_WIFI_PASSWORD "IguanaCheDaUnaCapata"
#endif
#ifndef TELEMETRY_WIFI_ENTERPRISE
#define TELEMETRY_WIFI_ENTERPRISE 0
#endif
#ifndef TELEMETRY_WIFI_EAP_IDENTITY
#define TELEMETRY_WIFI_EAP_IDENTITY ""
#endif
#ifndef TELEMETRY_WIFI_EAP_USERNAME
#define TELEMETRY_WIFI_EAP_USERNAME ""
#endif
// ---------------------------------------------------------------- MQTT
#ifndef TELEMETRY_MQTT_HOST
#define TELEMETRY_MQTT_HOST "twinciro.robertodisanto.it"
#endif
#ifndef TELEMETRY_MQTT_TRANSPORT
#define TELEMETRY_MQTT_TRANSPORT "mqtt"
#endif
#ifndef TELEMETRY_MQTT_PORT
#define TELEMETRY_MQTT_PORT 1883
#endif
#ifndef TELEMETRY_MQTT_WS_PATH
#define TELEMETRY_MQTT_WS_PATH "/mqtt"
#endif
#ifndef TELEMETRY_MQTT_USER
#define TELEMETRY_MQTT_USER ""
#endif
#ifndef TELEMETRY_MQTT_PASSWORD
#define TELEMETRY_MQTT_PASSWORD ""
#endif
#ifndef TELEMETRY_MQTT_TLS_INSECURE
#define TELEMETRY_MQTT_TLS_INSECURE 0
#endif
#ifndef TELEMETRY_MQTT_CA_PEM
#define TELEMETRY_MQTT_CA_PEM ""
#endif
#ifndef TELEMETRY_MQTT_KEEPALIVE_S
#define TELEMETRY_MQTT_KEEPALIVE_S 30
#endif
#ifndef TELEMETRY_MQTT_QOS
#define TELEMETRY_MQTT_QOS 0
#endif
// ---------------------------------------------------------------- identità, zona, conteggio
#ifndef TELEMETRY_DEVICE_ID
#define TELEMETRY_DEVICE_ID ""
#endif
#ifndef TELEMETRY_ZONE
#define TELEMETRY_ZONE "rotonda_diaz"
#endif
#ifndef TELEMETRY_PERSONE_MOLTIPLICATORE
#define TELEMETRY_PERSONE_MOLTIPLICATORE 500
#endif
#ifndef TELEMETRY_PERSONE_FINESTRA_S
#define TELEMETRY_PERSONE_FINESTRA_S 600
#endif
// ---------------------------------------------------------------- tempi
#ifndef TELEMETRY_INTERVAL_S
#define TELEMETRY_INTERVAL_S 15
#endif
// ---------------------------------------------------------------- badge
#ifndef TELEMETRY_DISABLE_BLE
#define TELEMETRY_DISABLE_BLE 0
#endif
#ifndef TELEMETRY_KEEP_SCHEDULE
#define TELEMETRY_KEEP_SCHEDULE 0
#endif
#ifndef TELEMETRY_START_SCREEN
#define TELEMETRY_START_SCREEN 1
#endif
#ifndef TELEMETRY_SCREEN_AWAKE
#define TELEMETRY_SCREEN_AWAKE 1
#endif

#define TELEMETRY_FW_VERSION "badge-napoli-0.2.0"
