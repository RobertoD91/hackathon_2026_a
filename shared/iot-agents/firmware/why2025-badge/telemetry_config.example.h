// Configurazione della telemetria MQTT del badge WHY2025/EMF2026.
// COPIA questo file in `telemetry_config.h` (stessa cartella, NON versionato) e metti i tuoi valori:
//   cp telemetry_config.example.h telemetry_config.h
// build.sh lo copia in upstream/main/badge/ prima di compilare.
// Le voci mancanti prendono i valori predefiniti di overlay/main/badge/telemetry_cfg.h.

#pragma once

// ---------------------------------------------------------------- Wi-Fi
#define TELEMETRY_WIFI_SSID        "nome-rete"       // max 32 caratteri
#define TELEMETRY_WIFI_PASSWORD    "password-rete"   // "" = rete aperta
// 1 = WPA2/WPA3-Enterprise (PEAP/TTLS, certificato del server non verificato): la password
// sopra è quella EAP, con identità e utente qui sotto.
#define TELEMETRY_WIFI_ENTERPRISE  0
#define TELEMETRY_WIFI_EAP_IDENTITY ""
#define TELEMETRY_WIFI_EAP_USERNAME ""
// Come dichiarare la rete in meta.net: "wifi", oppure "5g" se il Wi-Fi è l'hotspot/router 5G.
#define TELEMETRY_NET_LABEL        "wifi"

// ---------------------------------------------------------------- MQTT
#define TELEMETRY_MQTT_HOST        "twinciro.robertodisanto.it"
// Trasporto e porta: "mqtt" 1883 (con utente/password) | "mqtts" 8883 (TLS) | "wss" 8884 (WebSocket TLS,
// oppure 443 se c'è il reverse proxy nginx di cloud/mqtt/esempi) | "ws".
#define TELEMETRY_MQTT_TRANSPORT   "mqtt"
#define TELEMETRY_MQTT_PORT        1883
#define TELEMETRY_MQTT_WS_PATH     "/mqtt"           // solo per ws/wss
// Broker del team (cloud/mqtt): l'utente di un badge È il suo deviceId (l'ACL gli fa scrivere solo
// bighack/+/<deviceId>/#). Si crea con ./scripts/aggiungi-utente.sh <deviceId>. Con l'utente vuoto
// e la password piena si usa il deviceId; con TELEMETRY_DEVICE_ID vuoto il deviceId è l'utente.
#define TELEMETRY_MQTT_USER        ""
#define TELEMETRY_MQTT_PASSWORD    ""
// TLS: con 0 il certificato del broker è verificato con il bundle di CA di ESP-IDF (va bene per
// Let's Encrypt). Per un certificato autofirmato metti la CA in TELEMETRY_MQTT_CA_PEM, oppure
// (solo per la demo) TELEMETRY_MQTT_TLS_INSECURE 1 = nessuna verifica.
#define TELEMETRY_MQTT_TLS_INSECURE 0
#define TELEMETRY_MQTT_CA_PEM      ""
#define TELEMETRY_MQTT_KEEPALIVE_S 30                // il broker dichiara offline dopo ~1,5 × keepalive
#define TELEMETRY_MQTT_QOS         0                 // QoS delle letture (lo stato usa sempre QoS 1 retained)
#define TELEMETRY_TOPIC_PREFIX     "bighack"         // bighack/<zona>/<deviceId>/readings|status|cmd

// Copia anche nel formato di c5-agentic-city: napoli/sensori/<deviceId>/<grandezza> {"valore": n}
// e il pulsante su napoli/eventi/manuale. Con l'ACL di cloud/mqtt napoli/sensori/<deviceId>/# è già
// permesso; napoli/eventi/manuale va concesso badge per badge (vedi cloud/mqtt/config/acl).
#define TELEMETRY_C5_COMPAT        0
#define TELEMETRY_C5_PREFIX        "napoli"
#define TELEMETRY_C5_EVENT         "segnalazione_badge"

// ---------------------------------------------------------------- identità e posizione
// "" = l'utente MQTT, oppure (senza utente) "badge-<ultime 4 cifre esadecimali del MAC>": ogni badge
// ha un id diverso con lo stesso firmware; lo mostra la schermata SENSORI.
#define TELEMETRY_DEVICE_ID        ""
#define TELEMETRY_ZONE             "citta-della-scienza"
// Città della Scienza, Napoli (circa). Metti NAN per non inviare le coordinate.
#define TELEMETRY_LAT              40.8069
#define TELEMETRY_LON              14.1764

// ---------------------------------------------------------------- tempi
#define TELEMETRY_INTERVAL_S       15                // invio periodico (2-3600 s)
#define TELEMETRY_NTP_SERVER       "pool.ntp.org"

// ---------------------------------------------------------------- badge
// 1 = non avvia il Bluetooth (radar dei badge): libera memoria per il TLS se la connessione fallisce.
#define TELEMETRY_DISABLE_BLE      0
// 0 = non carica il programma di EMF Camp nella schermata "event" (~50 KB di heap per il TLS).
#define TELEMETRY_KEEP_SCHEDULE    0
// 1 = all'accensione mostra subito la schermata SENSORI invece del logo.
#define TELEMETRY_START_SCREEN     1
// 1 = sulla schermata SENSORI lo schermo non si spegne (resta a luminosità media): comodo in demo,
// consuma più batteria. 0 = come le altre schermate (si spegne dopo 15 s).
#define TELEMETRY_SCREEN_AWAKE     1
