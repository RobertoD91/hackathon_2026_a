// payload: topic MQTT e JSON della telemetria del badge, nel formato unico di TwinCiro
// (specifica completa: firmware/README.md della repo).
//
//   napoli/sensori/<id>/<grandezza>   {"zona":"rotonda_diaz","valore":23.5}
//                                     persone: {"zona":"...","valore":3,"moltiplicatore":500}
//   napoli/nodi/<id>/stato            {"online":true,"ruolo":"badge","zona":"...","versione":"...",
//                                      "ip":"...","rssi":-60,...} trattenuto; last will {"online":false}
//   napoli/nodi/<id>/cmd              comandi per il badge
//
// Modulo PORTABILE (solo C standard, nessun header ESP-IDF): si compila anche sul PC per i
// test (../../../test/payload_host_test.c). I numeri sono scritti con aritmetica intera
// (niente printf "%f"), così il risultato è identico su PC e badge.

#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/** Radice di tutti i topic di TwinCiro. */
#define PAYLOAD_RADICE "napoli"

/** Last will e stato "offline": sempre questo testo, trattenuto, su napoli/nodi/<id>/stato. */
#define PAYLOAD_STATO_OFFLINE "{\"online\":false}"

/** Stato del nodo (napoli/nodi/<id>/stato). Campi facoltativi: NULL / "" / valori negativi / NAN = assenti. */
typedef struct {
    bool online;
    const char *ruolo;      // "badge" | "tasmota"
    const char *zona;
    const char *versione;
    const char *ip;
    int rssi;               // dBm; 0 = assente
    // campi in più del badge (facoltativi, chi legge può ignorarli)
    int intervallo_s;       // <= 0 = assente
    const char *sensori;    // es. "BH1750@23 TSC2007@48"
    double tensione;        // V di alimentazione (TSC2007); NAN = assente
    int badge_vicini;       // badge Cyber Saiyan vicini via BLE; < 0 = assente
    long heap;              // byte liberi; < 0 = assente
} payload_stato_t;

/** Azzera lo stato (tutti i campi facoltativi assenti, online false). */
void payload_stato_init(payload_stato_t *s);

/**
 * JSON dello stato. Con online false scrive esattamente PAYLOAD_STATO_OFFLINE.
 * @return lunghezza scritta (senza terminatore) oppure -1 se il buffer non basta.
 */
int payload_stato_json(const payload_stato_t *s, char *out, size_t cap);

/**
 * JSON di una lettura: {"zona":"...","valore":n} con `decimali` cifre, più
 * "moltiplicatore" se > 0 (solo per la grandezza "persone").
 * @return lunghezza oppure -1 (valore non finito, zona vuota o buffer piccolo).
 */
int payload_lettura_json(char *out, size_t cap, const char *zona, double valore, int decimali,
                         int moltiplicatore);

/** Topic "napoli/sensori/<id>/<grandezza>". -1 se id o grandezza non sono validi o il buffer non basta. */
int payload_topic_sensore(char *out, size_t cap, const char *id, const char *grandezza);

/** Topic "napoli/nodi/<id>/<foglia>" (foglia: "stato", "cmd"). -1 se non valido. */
int payload_topic_nodo(char *out, size_t cap, const char *id, const char *foglia);

/**
 * true se l'id è valido come utente MQTT del broker (cloud/mqtt) e come livello di topic:
 * 1-64 caratteri tra lettere, cifre, '.', '_' e '-'.
 */
bool payload_id_valido(const char *s);

/** Sostituisce con '-' i caratteri non ammessi negli id e tronca a 64 caratteri. */
void payload_ripulisci_id(char *s);

/** true se la zona è un nome ammesso: 1-31 caratteri tra minuscole, cifre e '_' (es. "rotonda_diaz"). */
bool payload_zona_valida(const char *s);

/** Scrive un numero con `decimali` cifre (arrotondamento a metà lontano da zero). -1 se non finito. */
int payload_numero(char *out, size_t cap, double v, int decimali);

#ifdef __cplusplus
}
#endif
