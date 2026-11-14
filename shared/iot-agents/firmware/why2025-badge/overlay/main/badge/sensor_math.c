// sensor_math: conversioni dei sensori (vedi sensor_math.h). C standard, testabile sul PC.

#include "sensor_math.h"

#include <math.h>

float sm_bh1750_lux(uint16_t raw) { return (float)raw / 1.2f; }

float sm_veml7700_lux(uint16_t raw) {
    // Risoluzione 0,0036 lx a guadagno 2 e 800 ms → ×2 (guadagno 1) ×8 (1/8) ×8 (100 ms).
    double lux = (double)raw * 0.4608;
    // Correzione di non linearità (Vishay, "Designing the VEML7700 Into an Application").
    lux = (((6.0135e-13 * lux - 9.3924e-9) * lux + 8.1488e-5) * lux + 1.0023) * lux;
    return (float)lux;
}

uint8_t sm_crc8(const uint8_t *data, size_t len) {
    uint8_t crc = 0xFF;
    for (size_t i = 0; i < len; i++) {
        crc ^= data[i];
        for (int b = 0; b < 8; b++) crc = (crc & 0x80) ? (uint8_t)((crc << 1) ^ 0x31) : (uint8_t)(crc << 1);
    }
    return crc;
}

static bool sht_words(const uint8_t d[6], uint16_t *t, uint16_t *h) {
    if (sm_crc8(d, 2) != d[2] || sm_crc8(d + 3, 2) != d[5]) return false;
    *t = (uint16_t)((d[0] << 8) | d[1]);
    *h = (uint16_t)((d[3] << 8) | d[4]);
    return true;
}

static float clamp_pct(float v) { return v < 0 ? 0 : (v > 100 ? 100 : v); }

bool sm_sht4x_convert(const uint8_t d[6], float *temp_c, float *rh_pct) {
    uint16_t t, h;
    if (!sht_words(d, &t, &h)) return false;
    *temp_c = -45.0f + 175.0f * (float)t / 65535.0f;
    *rh_pct = clamp_pct(-6.0f + 125.0f * (float)h / 65535.0f);
    return true;
}

bool sm_sht3x_convert(const uint8_t d[6], float *temp_c, float *rh_pct) {
    uint16_t t, h;
    if (!sht_words(d, &t, &h)) return false;
    *temp_c = -45.0f + 175.0f * (float)t / 65535.0f;
    *rh_pct = clamp_pct(100.0f * (float)h / 65535.0f);
    return true;
}

bool sm_aht_convert(const uint8_t d[6], float *temp_c, float *rh_pct) {
    if (d[0] & 0x80) return false;     // misura in corso
    if (!(d[0] & 0x08)) return false;  // non calibrato
    uint32_t rh = ((uint32_t)d[1] << 12) | ((uint32_t)d[2] << 4) | (d[3] >> 4);
    uint32_t t = (((uint32_t)d[3] & 0x0F) << 16) | ((uint32_t)d[4] << 8) | d[5];
    *rh_pct = clamp_pct((float)rh * 100.0f / 1048576.0f);
    *temp_c = (float)t * 200.0f / 1048576.0f - 50.0f;
    return true;
}

static uint16_t u16le(const uint8_t *p) { return (uint16_t)(p[0] | (p[1] << 8)); }
static int16_t s16le(const uint8_t *p) { return (int16_t)u16le(p); }

void sm_bme280_parse_calib(const uint8_t c1[26], const uint8_t *c2, sm_bme280_calib_t *cal) {
    cal->T1 = u16le(c1 + 0);
    cal->T2 = s16le(c1 + 2);
    cal->T3 = s16le(c1 + 4);
    cal->P1 = u16le(c1 + 6);
    cal->P2 = s16le(c1 + 8);
    cal->P3 = s16le(c1 + 10);
    cal->P4 = s16le(c1 + 12);
    cal->P5 = s16le(c1 + 14);
    cal->P6 = s16le(c1 + 16);
    cal->P7 = s16le(c1 + 18);
    cal->P8 = s16le(c1 + 20);
    cal->P9 = s16le(c1 + 22);
    cal->H1 = c1[25];  // 0xA1 (0xA0 non è usato)
    cal->has_humidity = c2 != NULL;
    if (c2) {
        cal->H2 = s16le(c2 + 0);                                              // 0xE1-0xE2
        cal->H3 = c2[2];                                                      // 0xE3
        cal->H4 = (int16_t)(((int16_t)(int8_t)c2[3] * 16) | (c2[4] & 0x0F));  // 0xE4, 0xE5[3:0]
        cal->H5 = (int16_t)(((int16_t)(int8_t)c2[5] * 16) | (c2[4] >> 4));   // 0xE6, 0xE5[7:4]
        cal->H6 = (int8_t)c2[6];                                              // 0xE7
    } else {
        cal->H2 = cal->H3 = cal->H4 = cal->H5 = 0;
        cal->H6 = 0;
    }
}

void sm_bme280_unpack(const uint8_t d[8], int32_t *adc_p, int32_t *adc_t, int32_t *adc_h) {
    *adc_p = (int32_t)(((uint32_t)d[0] << 12) | ((uint32_t)d[1] << 4) | (d[2] >> 4));
    *adc_t = (int32_t)(((uint32_t)d[3] << 12) | ((uint32_t)d[4] << 4) | (d[5] >> 4));
    *adc_h = (int32_t)(((uint32_t)d[6] << 8) | d[7]);
}

void sm_bme280_compensate(const sm_bme280_calib_t *c, int32_t adc_t, int32_t adc_p, int32_t adc_h, float *temp_c,
                          float *press_hpa, float *rh_pct) {
    *temp_c = *press_hpa = *rh_pct = NAN;
    if (adc_t == 0x80000) return;  // misura di temperatura saltata: niente t_fine

    double v1 = ((double)adc_t / 16384.0 - (double)c->T1 / 1024.0) * (double)c->T2;
    double v2 = (double)adc_t / 131072.0 - (double)c->T1 / 8192.0;
    v2 = v2 * v2 * (double)c->T3;
    double t_fine = v1 + v2;
    *temp_c = (float)(t_fine / 5120.0);

    if (adc_p != 0x80000) {
        v1 = t_fine / 2.0 - 64000.0;
        v2 = v1 * v1 * (double)c->P6 / 32768.0;
        v2 = v2 + v1 * (double)c->P5 * 2.0;
        v2 = v2 / 4.0 + (double)c->P4 * 65536.0;
        v1 = ((double)c->P3 * v1 * v1 / 524288.0 + (double)c->P2 * v1) / 524288.0;
        v1 = (1.0 + v1 / 32768.0) * (double)c->P1;
        if (v1 != 0.0) {
            double p = 1048576.0 - (double)adc_p;
            p = (p - v2 / 4096.0) * 6250.0 / v1;
            v1 = (double)c->P9 * p * p / 2147483648.0;
            v2 = p * (double)c->P8 / 32768.0;
            p = p + (v1 + v2 + (double)c->P7) / 16.0;  // Pa
            *press_hpa = (float)(p / 100.0);
        }
    }

    if (c->has_humidity && adc_h != 0x8000) {
        double h = t_fine - 76800.0;
        h = ((double)adc_h - ((double)c->H4 * 64.0 + (double)c->H5 / 16384.0 * h)) *
            ((double)c->H2 / 65536.0 *
             (1.0 + (double)c->H6 / 67108864.0 * h * (1.0 + (double)c->H3 / 67108864.0 * h)));
        h = h * (1.0 - (double)c->H1 * h / 524288.0);
        *rh_pct = clamp_pct((float)h);
    }
}

uint16_t sm_tsc2007_code(const uint8_t d[2]) { return (uint16_t)(((uint16_t)d[0] << 4) | (d[1] >> 4)); }

float sm_tsc2007_volts(uint16_t code, float vref) { return (float)code * vref / 4096.0f; }

float sm_tsc2007_temp_c(uint16_t code_temp0, uint16_t code_temp1, float vref) {
    // Il diodo con densità di corrente 91 volte minore ha la VBE più bassa: in valore assoluto
    // ΔV ≈ 116 mV a 25 °C. Si usa |ΔV| per non dipendere dall'ordine dei due comandi.
    float dv_mv = fabsf((float)code_temp1 - (float)code_temp0) * vref * 1000.0f / 4096.0f;
    return 2.573f * dv_mv - 273.0f;
}
