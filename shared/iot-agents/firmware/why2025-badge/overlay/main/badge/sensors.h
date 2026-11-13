// sensors: letture dei sensori del badge WHY2025/EMF2026 (ESP32-C3).
//
// Sul badge NON c'è un sensore di luce: c'è un connettore "I2C" (GND, SCL, SDA, 1W) sullo
// stesso bus dell'AW9523B (0x5A) e del TSC2007 (0x48), e il connettore "POW" dà i 3,3 V.
// All'avvio sensors_init() cerca sul bus i moduli collegati (nessuna configurazione):
//
//   luce:               BH1750 (0x23 o 0x5C), VEML7700 (0x10)
//   temperatura/umidità: SHT4x (0x44), SHT3x (0x44 o 0x45), AHT20/AHT10 (0x38)
//
// e usa sempre quello che c'è già sulla scheda:
//   TSC2007 (0x48, controller del touch resistivo non usato dal firmware originale):
//     - temperatura interna con il metodo differenziale TEMP0/TEMP1 (circa ±2 °C);
//     - ingresso AUX collegato a VIN tramite partitore 100k/100k → tensione di alimentazione;
//   sensore di temperatura interno dell'ESP32-C3 (temperatura del chip, non ambiente).

#pragma once

#include <stdbool.h>

typedef struct {
    float light_lux;        // NAN se non c'è un sensore di luce
    float temperature_c;    // sensore esterno (SHT/AHT); NAN se assente
    float humidity_pct;     // sensore esterno; NAN se assente
    float board_temp_c;     // TSC2007; NAN se non risponde
    float supply_v;         // VIN (batteria o USB meno il diodo); NAN se non risponde
    float chip_temp_c;      // ESP32-C3; NAN se non disponibile
    const char *light_name;    // "bh1750" | "veml7700" | NULL
    const char *climate_name;  // "sht4x" | "sht3x" | "aht20" | NULL
} sensors_data_t;

/** Cerca i sensori sul bus I2C (già inizializzato da led_init) e li configura. */
void sensors_init(void);

/** Legge tutti i sensori trovati (bloccante per qualche decina di ms). */
void sensors_read(sensors_data_t *out);

/** Riga di testo con i sensori trovati, per log e display (es. "BH1750 0x23, TSC2007"). */
const char *sensors_found(void);
