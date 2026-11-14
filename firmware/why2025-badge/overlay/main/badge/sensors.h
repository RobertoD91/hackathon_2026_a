// sensors: letture dei sensori del badge WHY2025/EMF2026 (ESP32-C3).
//
// Sul badge NON c'è un sensore di luce (verificato su BOM e PCB, hardware/dragon_4L_R02):
// tutti i pin ADC dell'ESP32-C3 (GPIO0-5) sono già usati da I2C, display e LED, quindi
// niente fotoresistenza diretta. Il sensore di luce si collega al connettore "I2C"
// (GND, SCL=GPIO0, SDA=GPIO1, 1W), alimentato dal connettore "POW" (3,3 V): è lo stesso
// bus dell'AW9523B (0x5A) e del TSC2007 (0x48), con pull-up da 5,1 kΩ già sulla scheda.
//
// sensors_init() cerca da solo i moduli collegati (nessuna configurazione):
//   luce:                BH1750 (0x23 o 0x5C), VEML7700 (0x10, verificato con l'ID 0x81)
//   temperatura/umidità: SHT4x (0x44), SHT3x (0x44 o 0x45), AHT10/AHT20 (0x38),
//                        BME280/BMP280 (0x76 o 0x77, anche pressione)
// e usa quello che c'è già sulla scheda:
//   TSC2007 (0x48, controller del touch resistivo non usato dal firmware originale):
//     - ingresso AUX collegato a VIN con partitore 100k/100k (R3, R16) → tensione di alimentazione;
//     - temperatura interna col metodo differenziale TEMP0/TEMP1 (±2 °C, passo ~2 °C);
//   sensore di temperatura interno dell'ESP32-C3 (temperatura del chip, non dell'ambiente).

#pragma once

#include <stdbool.h>

typedef struct {
    float light_lux;        // NAN se non c'è un sensore di luce
    float temperature_c;    // sensore esterno (SHT/AHT/BME); NAN se assente
    float humidity_pct;     // sensore esterno; NAN se assente
    float pressure_hpa;     // BME280/BMP280; NAN se assente
    float board_temp_c;     // TSC2007 (scheda, non ambiente); NAN se non risponde
    float supply_v;         // VIN: batteria, oppure USB meno il diodo; NAN se non risponde
    float chip_temp_c;      // ESP32-C3; NAN se non disponibile
    const char *light_name;    // "bh1750" | "veml7700" | NULL
    const char *climate_name;  // "sht4x" | "sht3x" | "aht20" | "aht1x" | "bme280" | "bmp280" | NULL
} sensors_data_t;

/** Cerca i sensori sul bus I2C (già inizializzato da led_init) e li configura. */
void sensors_init(void);

/** Legge tutti i sensori trovati (bloccante: circa 100 ms con un AHT o un BME280). */
void sensors_read(sensors_data_t *out);

/** Riga di testo con i sensori trovati, per log e display (es. "BH1750@23 SHT4x@44 TSC2007@48"). */
const char *sensors_found(void);
