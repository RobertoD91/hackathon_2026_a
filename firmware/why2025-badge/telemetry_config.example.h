// Configurazione della telemetria MQTT del badge WHY2025/EMF2026 (formato napoli/ di TwinCIRO).
// COPIA questo file in `telemetry_config.h` (stessa cartella, NON versionato) e metti utente e
// password MQTT del badge:
//   cp telemetry_config.example.h telemetry_config.h
// build.sh lo copia in upstream/main/badge/ prima di compilare.
// Le voci mancanti prendono i valori predefiniti di overlay/main/badge/telemetry_cfg.h.

#pragma once

// ---------------------------------------------------------------- Wi-Fi
// Hotspot del team (rete di prova: SSID e password possono stare nella repo). Solo 2,4 GHz:
// sull'iPhone attiva "Massimizza compatibilità", su Android scegli la banda 2,4 GHz.
#define TELEMETRY_WIFI_SSID        "iBob12"          // max 32 caratteri
#define TELEMETRY_WIFI_PASSWORD    "IguanaCheDaUnaCapata"   // "" = rete aperta
// 1 = WPA2/WPA3-Enterprise (PEAP/TTLS, certificato del server non verificato): la password
// sopra è quella EAP, con identità e utente qui sotto.
#define TELEMETRY_WIFI_ENTERPRISE  0
#define TELEMETRY_WIFI_EAP_IDENTITY ""
#define TELEMETRY_WIFI_EAP_USERNAME ""

// ---------------------------------------------------------------- MQTT
// Broker del team (cloud/mqtt): MQTT in chiaro sulla 1883, con utente e password.
#define TELEMETRY_MQTT_HOST        "twinciro.robertodisanto.it"
// Trasporto e porta: "mqtt" 1883 (quello del team) | "mqtts" 8883 e "wss" 8884 solo se sul
// broker è acceso TLS | "ws".
#define TELEMETRY_MQTT_TRANSPORT   "mqtt"
#define TELEMETRY_MQTT_PORT        1883
#define TELEMETRY_MQTT_WS_PATH     "/mqtt"           // solo per ws/wss
// L'utente MQTT del badge È il suo id: l'ACL lo fa scrivere solo su napoli/sensori/<utente>/# e
// napoli/nodi/<utente>/#. Si crea sul server con
//   cd cloud/mqtt && ./scripts/aggiungi-utente.sh badge-1      (stampa la password)
// Con l'utente vuoto e la password piena si usa come utente l'id (TELEMETRY_DEVICE_ID o badge-<MAC>).
#define TELEMETRY_MQTT_USER        ""                // es. "badge-1"
#define TELEMETRY_MQTT_PASSWORD    ""                // la password stampata da aggiungi-utente.sh
// TLS (solo "mqtts"/"wss"): con 0 il certificato del broker è verificato con il bundle di CA di
// ESP-IDF (va bene per Let's Encrypt). Per un certificato autofirmato metti la CA in
// TELEMETRY_MQTT_CA_PEM, oppure (solo per prova) TELEMETRY_MQTT_TLS_INSECURE 1 = nessuna verifica.
#define TELEMETRY_MQTT_TLS_INSECURE 0
#define TELEMETRY_MQTT_CA_PEM      ""
#define TELEMETRY_MQTT_KEEPALIVE_S 30                // il broker dichiara offline dopo ~1,5 × keepalive
#define TELEMETRY_MQTT_QOS         0                 // QoS delle letture (lo stato usa sempre QoS 1 trattenuto)

// ---------------------------------------------------------------- identità, zona, contapersone
// "" = l'utente MQTT, oppure (senza utente) "badge-<ultime 4 cifre esadecimali del MAC>";
// lo mostra la schermata SENSORI.
#define TELEMETRY_DEVICE_ID        ""
// Zona della città dove sta il badge: una di quelle dello scenario di c5-agentic-city
// (mergellina, rotonda_diaz, piazza_vittoria, castel_ovo, municipio, beverello, vomero).
// L'agente Folla scarta le zone che non conosce. Si cambia anche dal cloud: {"zona":"mergellina"}
// su napoli/nodi/<id>/cmd (vale fino al riavvio).
#define TELEMETRY_ZONE             "rotonda_diaz"
// Rotella SU = un gruppo di persone visto: il badge pubblica su napoli/sensori/<id>/persone le
// pressioni degli ultimi TELEMETRY_PERSONE_FINESTRA_S secondi e l'agente Folla aggiunge alla
// zona valore × moltiplicatore persone (10 pressioni = +5000). Rotella GIU = azzera.
#define TELEMETRY_PERSONE_MOLTIPLICATORE 500
#define TELEMETRY_PERSONE_FINESTRA_S     600

// ---------------------------------------------------------------- tempi
#define TELEMETRY_INTERVAL_S       15                // stato e letture periodiche (2-3600 s)

// ---------------------------------------------------------------- badge
// 1 = non avvia il Bluetooth (radar dei badge): libera memoria se la connessione fallisce.
#define TELEMETRY_DISABLE_BLE      0
// 0 = non carica il programma di EMF Camp nella schermata "event" (~50 KB di heap).
#define TELEMETRY_KEEP_SCHEDULE    0
// 1 = all'accensione mostra subito la schermata SENSORI invece del logo.
#define TELEMETRY_START_SCREEN     1
// 1 = sulla schermata SENSORI lo schermo non si spegne (resta a luminosità media): comodo in demo,
// consuma più batteria. 0 = come le altre schermate (si spegne dopo 15 s).
#define TELEMETRY_SCREEN_AWAKE     1
