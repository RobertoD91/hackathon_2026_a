// sensor_math: conversioni dei sensori (dati grezzi → unità fisiche).
//
// Modulo PORTABILE (solo C standard, nessun header ESP-IDF): si compila anche sul PC
// per i test (../../../test/sensor_math_host_test.c). La parte che parla con l'I2C
// è in sensors.c. Formule dai datasheet dei costruttori (citati accanto a ogni funzione).

#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/** BH1750 (ROHM), modo H-resolution, MTreg predefinito: lux = conteggi / 1,2. */
float sm_bh1750_lux(uint16_t raw);

/**
 * VEML7700 (Vishay) con guadagno 1/8 e integrazione 100 ms (0,4608 lx/conteggio,
 * fondo scala ~30 000 lx) più la correzione polinomiale della nota applicativa
 * (necessaria con guadagno 1/4 e 1/8).
 */
float sm_veml7700_lux(uint16_t raw);

/** CRC-8 Sensirion/Aosong: polinomio 0x31, valore iniziale 0xFF (0xBE 0xEF → 0x92). */
uint8_t sm_crc8(const uint8_t *data, size_t len);

/** SHT4x: 6 byte (T msb, lsb, crc, RH msb, lsb, crc). false se un CRC non torna. */
bool sm_sht4x_convert(const uint8_t d[6], float *temp_c, float *rh_pct);

/** SHT3x/SHT85: stesso formato di risposta, formula dell'umidità diversa. */
bool sm_sht3x_convert(const uint8_t d[6], float *temp_c, float *rh_pct);

/**
 * AHT10/AHT20/AHT21: 6 byte (stato + 5 di dati). false se il sensore è occupato
 * (bit 7 dello stato) o non calibrato (bit 3).
 */
bool sm_aht_convert(const uint8_t d[6], float *temp_c, float *rh_pct);

/** Coefficienti di calibrazione del BME280/BMP280 (registri 0x88-0xA1 e 0xE1-0xE7). */
typedef struct {
    uint16_t T1;
    int16_t T2, T3;
    uint16_t P1;
    int16_t P2, P3, P4, P5, P6, P7, P8, P9;
    uint8_t H1, H3;
    int16_t H2, H4, H5;
    int8_t H6;
    bool has_humidity;  // true per BME280 (id 0x60), false per BMP280 (0x58)
} sm_bme280_calib_t;

/**
 * Legge la calibrazione: c1 = 26 byte da 0x88 (fino a 0xA1 compreso, H1 è c1[25]);
 * c2 = 7 byte da 0xE1 (solo BME280, NULL per BMP280).
 */
void sm_bme280_parse_calib(const uint8_t c1[26], const uint8_t *c2, sm_bme280_calib_t *cal);

/**
 * Compensazione in virgola mobile (datasheet Bosch BME280, par. 8.1; BMP280 par. 8.1).
 * adc_t/adc_p a 20 bit, adc_h a 16 bit. Scrive NAN nei valori non disponibili.
 */
void sm_bme280_compensate(const sm_bme280_calib_t *cal, int32_t adc_t, int32_t adc_p, int32_t adc_h,
                          float *temp_c, float *press_hpa, float *rh_pct);

/** Dati grezzi del BME280 (8 byte da 0xF7): pressione, temperatura, umidità. */
void sm_bme280_unpack(const uint8_t d[8], int32_t *adc_p, int32_t *adc_t, int32_t *adc_h);

/** TSC2007 (TI): codice a 12 bit dai 2 byte letti (D11-D4, poi D3-D0 nei 4 bit alti). */
uint16_t sm_tsc2007_code(const uint8_t d[2]);

/** Tensione di un ingresso del TSC2007: codice / 4096 × Vref (Vref = VDD = 3,3 V sul badge). */
float sm_tsc2007_volts(uint16_t code, float vref);

/**
 * Temperatura del TSC2007 col metodo differenziale (nessuna taratura, ±2 °C, passo ~2 °C):
 * T = 2,573 × ΔV[mV] − 273, con ΔV = V(TEMP1) − V(TEMP0) (comandi 0x4x e 0x0x).
 */
float sm_tsc2007_temp_c(uint16_t code_temp0, uint16_t code_temp1, float vref);

#ifdef __cplusplus
}
#endif
