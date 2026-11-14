// telemetry: il badge pubblica via MQTT (ESP-MQTT di ESP-IDF 4.4) nel formato unico di TwinCiro
// (specifica: firmware/README.md della repo).
//
//   napoli/sensori/<id>/<grandezza>  {"zona","valore"}: temperatura, umidita, luce, pressione (se c'è
//                                    il sensore I2C) e persone (contapersone del pulsante, con "moltiplicatore")
//   napoli/nodi/<id>/stato           {"online":true,"ruolo":"badge",...} trattenuto; last will {"online":false}
//   napoli/nodi/<id>/cmd             in ingresso: {"text":"..."}, {"read":true}, {"interval":30},
//                                    {"azzera":true}, {"zona":"mergellina"}
//
// Il Wi-Fi STA è condiviso con il firmware originale (wifi.c): la telemetria si collega solo
// quando nessun altro usa il Wi-Fi, si mette in pausa se l'utente accende l'AP dalla schermata
// admin e riparte da sola quando l'AP si spegne. Configurazione: telemetry_config.h.

#pragma once

#include <stdbool.h>
#include <stdint.h>

#include "sensors.h"
#include "telemetry_cfg.h"

typedef enum {
    TELEMETRY_OFF = 0,        // disattivata (TELEMETRY_ENABLED 0 o SSID vuoto)
    TELEMETRY_WIFI_WAIT,      // in attesa che il Wi-Fi sia libero / connessione in corso
    TELEMETRY_PAUSED_AP,      // l'utente ha acceso l'AP del badge: pausa
    TELEMETRY_MQTT_WAIT,      // Wi-Fi connesso, broker MQTT non ancora connesso
    TELEMETRY_ONLINE,         // connesso al broker
} telemetry_state_t;

typedef struct {
    telemetry_state_t state;
    char device_id[65];
    char zone[32];
    char ip[16];
    int rssi;                 // dBm, 0 = sconosciuto
    bool has_data;
    sensors_data_t data;
    int badges_nearby;        // -1 = Bluetooth spento
    int persone;              // pressioni nella finestra del contapersone
    uint32_t sent;            // cicli di pubblicazione riusciti
    uint32_t failed;
    int64_t last_sent_us;     // esp_timer_get_time() dell'ultimo invio riuscito, 0 = mai
    int interval_s;
    char sensors[96];         // sensors_found()
    char last_error[48];
    char message[120];        // ultimo testo ricevuto su napoli/nodi/<id>/cmd
} telemetry_snapshot_t;

/** Avvia il task della telemetria. Va chiamata dopo badge_init(), led_init() e wifi_init(). */
void telemetry_start(void);

/** Copia lo stato corrente (per la UI). */
void telemetry_get_snapshot(telemetry_snapshot_t *out);

/** Rotella SU: +1 al contapersone e pubblicazione immediata di napoli/sensori/<id>/persone. */
void telemetry_persone_piu(void);

/** Rotella GIU: azzera il contapersone e pubblica subito persone = 0. */
void telemetry_persone_azzera(void);

/** Invia subito tutte le letture (come il comando {"read":true}). */
void telemetry_send_now(void);

/** true se la telemetria è compilata e configurata. */
bool telemetry_enabled(void);

/** true se la connessione STA in corso l'ha aperta la telemetria (wifi.c e ui.c la lasciano stare). */
bool telemetry_owns_sta(void);

/** true se il programma di EMF Camp non va caricato (heap riservato al TLS). */
bool telemetry_wants_heap(void);

/** true se il Bluetooth non va avviato (TELEMETRY_DISABLE_BLE). */
bool telemetry_ble_disabled(void);
