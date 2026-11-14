// payload: costruisce JSON e topic MQTT della telemetria del badge.
//
// Modulo PORTABILE (solo C standard, nessun header ESP-IDF): si compila anche sul PC
// per i test (vedi ../../../test/payload_host_test.c). I numeri sono scritti con
// aritmetica intera (niente printf "%f"), così il risultato è identico su PC e badge.
//
// Formato delle letture: shared/iot-agents/CONTRATTO.md, sezione 1 (e sezione MQTT).

#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define PAYLOAD_MAX_READINGS 24

typedef struct {
    const char *name;  // nome della grandezza (es. "light_lux"), [A-Za-z][A-Za-z0-9_]*
    double value;      // valore; se non è finito (NAN) la grandezza non viene scritta
    int decimals;      // cifre decimali (0-6)
    bool is_bool;      // true: scrive true/false (value != 0)
} payload_reading_t;

typedef struct {
    const char *device_id;  // obbligatorio
    int64_t ts_ms;          // ms epoch; <= 0 = assente (lo mette il hub)
    const char *zone;       // NULL o "" = senza zona
    double lat, lon;        // NAN = assenti
    payload_reading_t readings[PAYLOAD_MAX_READINGS];
    int n_readings;
    // meta (tutto facoltativo: NULL / valori negativi / NAN = assente)
    const char *fw;
    const char *net;        // "wifi" | "5g" | "sim"
    const char *hw;
    const char *trigger;    // "interval" | "button" | "command" | "boot"
    const char *light_sensor;
    const char *climate_sensor;
    int rssi;               // dBm; 0 = assente
    long heap;              // byte liberi; < 0 = assente
    long uptime_s;          // < 0 = assente
    double chip_temp_c;     // temperatura interna del SoC; NAN = assente
    double board_temp_c;    // temperatura della scheda (TSC2007); NAN = assente
} payload_msg_t;

/** Azzera il messaggio (tutti i campi facoltativi assenti). */
void payload_msg_init(payload_msg_t *m);

/** Aggiunge una grandezza numerica; ignora i valori non finiti. false se non c'è posto. */
bool payload_add(payload_msg_t *m, const char *name, double value, int decimals);

/** Aggiunge una grandezza booleana. */
bool payload_add_bool(payload_msg_t *m, const char *name, bool value);

/**
 * JSON della lettura (CONTRATTO.md, sezione 1). Se nessuna grandezza è valida aggiunge
 * "uptime_s" (il contratto vuole "readings" non vuoto).
 * @return lunghezza scritta (senza terminatore) oppure -1 se il buffer non basta.
 */
int payload_reading_json(const payload_msg_t *m, char *out, size_t cap);

/** Stato del dispositivo per il topic .../status (retained). ip e zone facoltativi. */
int payload_status_json(char *out, size_t cap, const char *device_id, bool online,
                        const char *fw, const char *ip, const char *zone, int interval_s);

/** Formato di c5-agentic-city: {"valore": n, "zona": "...", "deviceId": "..."} (+ moltiplicatore se > 0). */
int payload_c5_json(char *out, size_t cap, double value, int decimals, const char *zona,
                    const char *device_id, int moltiplicatore);

/**
 * Nome della grandezza nel formato di c5-agentic-city (napoli/sensori/<nodo>/<grandezza>):
 * light_lux → luce, temperature_c → temperatura, humidity_pct → umidita, pressure_hpa → pressione,
 * supply_v → tensione, people_count → persone, badges_nearby → badge_vicini, button → pulsante.
 * Gli altri nomi restano uguali.
 */
const char *payload_c5_name(const char *name);

/** Evento manuale di c5-agentic-city: {"evento": "...", "zona": "...", "da": "<deviceId>"}. */
int payload_c5_event_json(char *out, size_t cap, const char *evento, const char *zona,
                          const char *device_id);

/** Topic "<prefix>/<zone>/<device_id>/<leaf>" con zone e id ripuliti per MQTT. */
int payload_topic(char *out, size_t cap, const char *prefix, const char *zone,
                  const char *device_id, const char *leaf);

/** true se l'id rispetta il contratto: 1-64 caratteri tra lettere, cifre e . _ : - */
bool payload_valid_id(const char *s);

/** Sostituisce con '-' i caratteri non ammessi dal contratto e tronca a 64 caratteri. */
void payload_sanitize_id(char *s);

/** Scrive un numero con `decimals` cifre (arrotondamento a metà lontano da zero). -1 se non finito. */
int payload_format_number(char *out, size_t cap, double v, int decimals);

#ifdef __cplusplus
}
#endif
