// Test sul PC delle conversioni dei sensori (overlay/main/badge/sensor_math.c).
//   cc -std=c11 -Wall -Wextra -I../overlay/main/badge sensor_math_host_test.c ../overlay/main/badge/sensor_math.c -lm
// Vettori di prova dai datasheet dove esistono (CRC Sensirion, esempio di compensazione BMP280).

#include <math.h>
#include <stdio.h>
#include <string.h>

#include "sensor_math.h"

static int failures = 0;

#define CHECK(cond, ...)                          \
    do {                                          \
        if (!(cond)) {                            \
            failures++;                           \
            printf("FALLITO %s:%d: ", __FILE__, __LINE__); \
            printf(__VA_ARGS__);                  \
            printf("\n");                         \
        }                                         \
    } while (0)

static int near(double a, double b, double tol) { return fabs(a - b) <= tol; }

int main(void) {
    // CRC-8 Sensirion: esempio del datasheet SHT3x/SHT4x
    const uint8_t beef[2] = {0xBE, 0xEF};
    CHECK(sm_crc8(beef, 2) == 0x92, "crc8(BEEF) = 0x%02X", sm_crc8(beef, 2));

    // BH1750: 1,2 conteggi per lux
    CHECK(near(sm_bh1750_lux(120), 100.0, 1e-3), "bh1750 120 → %f", sm_bh1750_lux(120));
    CHECK(near(sm_bh1750_lux(65535), 54612.5, 0.1), "bh1750 max → %f", sm_bh1750_lux(65535));

    // VEML7700 (guadagno 1/8, 100 ms): 0,4608 lx/conteggio + correzione (quasi nulla a bassa luce)
    CHECK(near(sm_veml7700_lux(0), 0, 1e-6), "veml 0");
    CHECK(near(sm_veml7700_lux(100), 46.36, 0.02), "veml 100 → %f", sm_veml7700_lux(100));  // 46,08 × 1,006
    // 9216 lx lineari: il polinomio di Vishay li porta a ~13 140 lx (non linearita' ad alta luce)
    CHECK(near(sm_veml7700_lux(20000), 13142, 20), "veml 20000 → %f", sm_veml7700_lux(20000));

    // SHT4x: costruiamo una risposta con CRC giusti
    float t, h;
    uint8_t sht[6] = {0x66, 0x66, 0, 0x80, 0x00, 0};
    sht[2] = sm_crc8(sht, 2);
    sht[5] = sm_crc8(sht + 3, 2);
    CHECK(sm_sht4x_convert(sht, &t, &h), "sht4x crc");
    CHECK(near(t, -45 + 175 * 26214.0 / 65535, 0.01) && near(t, 25.0, 0.01), "sht4x t=%f", t);
    CHECK(near(h, -6 + 125 * 32768.0 / 65535, 0.01), "sht4x h=%f", h);
    CHECK(sm_sht3x_convert(sht, &t, &h) && near(h, 50.0, 0.01), "sht3x h=%f", h);
    sht[5] ^= 1;
    CHECK(!sm_sht4x_convert(sht, &t, &h), "sht4x deve rifiutare un CRC sbagliato");
    uint8_t sht_wet[6] = {0x66, 0x66, 0, 0xFF, 0xFF, 0};  // RH > 100 % → 100
    sht_wet[2] = sm_crc8(sht_wet, 2);
    sht_wet[5] = sm_crc8(sht_wet + 3, 2);
    CHECK(sm_sht4x_convert(sht_wet, &t, &h) && h == 100.0f, "sht4x clamp h=%f", h);

    // AHT20: stato 0x1C (calibrato, libero), RH 50 %, T 25 °C
    // RH = 0x80000 / 2^20 = 50 %; T = 0x60000 / 2^20 * 200 - 50 = 25 °C
    uint8_t aht[6] = {0x1C, 0x80, 0x00, 0x06, 0x00, 0x00};
    CHECK(sm_aht_convert(aht, &t, &h), "aht ok");
    CHECK(near(h, 50.0, 0.01) && near(t, 25.0, 0.01), "aht t=%f h=%f", t, h);
    aht[0] = 0x9C;
    CHECK(!sm_aht_convert(aht, &t, &h), "aht occupato");
    aht[0] = 0x14;
    CHECK(!sm_aht_convert(aht, &t, &h), "aht non calibrato");

    // BMP280: esempio del datasheet Bosch (par. 3.12): T = 25,08 °C, p = 100653,27 Pa
    uint8_t c1[26] = {0};
    const uint16_t cal[12] = {27504, 26435, (uint16_t)-1000, 36477, (uint16_t)-10685, 3024,
                              2855,  140,   (uint16_t)-7,    15500, (uint16_t)-14600, 6000};
    for (int i = 0; i < 12; i++) {
        c1[i * 2] = cal[i] & 0xFF;
        c1[i * 2 + 1] = cal[i] >> 8;
    }
    sm_bme280_calib_t bc;
    sm_bme280_parse_calib(c1, NULL, &bc);
    CHECK(bc.T1 == 27504 && bc.T3 == -1000 && bc.P9 == 6000 && !bc.has_humidity, "calib");
    float p, rh;
    sm_bme280_compensate(&bc, 519888, 415148, 0x8000, &t, &p, &rh);
    CHECK(near(t, 25.08, 0.01), "bmp280 t=%f", t);
    CHECK(near(p, 1006.5327, 0.01), "bmp280 p=%f hPa", p);
    CHECK(isnan(rh), "bmp280 senza umidita'");

    // BME280: umidità con coefficienti tipici (letti da un sensore reale) → valore plausibile
    uint8_t c2[7] = {0x6A, 0x01, 0x00, 0x13, 0x29, 0x03, 0x1E};  // H2=362 H3=0 H4=313 H5=50 H6=30
    c1[25] = 75;                                                 // H1
    sm_bme280_parse_calib(c1, c2, &bc);
    CHECK(bc.has_humidity && bc.H1 == 75 && bc.H2 == 362 && bc.H4 == 313 && bc.H5 == 50 && bc.H6 == 30,
          "calib H: H1=%d H2=%d H4=%d H5=%d H6=%d", bc.H1, bc.H2, bc.H4, bc.H5, bc.H6);
    sm_bme280_compensate(&bc, 519888, 415148, 27000, &t, &p, &rh);
    CHECK(rh >= 0 && rh <= 100 && !isnan(rh), "bme280 rh=%f", rh);
    uint8_t negh[7] = {0x6A, 0x01, 0x00, 0xF0, 0x0F, 0xF0, 0x1E};  // H4 e H5 negativi
    sm_bme280_parse_calib(c1, negh, &bc);
    CHECK(bc.H4 == -241 && bc.H5 == -256, "H4=%d H5=%d (segno)", bc.H4, bc.H5);

    // unpack dei registri 0xF7..0xFE
    const uint8_t raw[8] = {0x65, 0x5A, 0xC0, 0x7E, 0xED, 0x00, 0x69, 0x78};
    int32_t ap, at, ah;
    sm_bme280_unpack(raw, &ap, &at, &ah);
    CHECK(ap == 415148 && at == 519888 && ah == 0x6978, "unpack p=%d t=%d h=%d", (int)ap, (int)at, (int)ah);

    // TSC2007: codice 12 bit, tensione, temperatura
    const uint8_t code_bytes[2] = {0xAB, 0xC0};
    CHECK(sm_tsc2007_code(code_bytes) == 0xABC, "tsc code %X", sm_tsc2007_code(code_bytes));
    CHECK(near(sm_tsc2007_volts(2048, 3.3f), 1.65, 1e-4), "tsc volts");
    // VIN = 2 × AUX: 4,2 V di batteria → AUX 2,1 V → codice 2606
    CHECK(near(2 * sm_tsc2007_volts(2606, 3.3f), 4.199, 0.002), "tsc vin");
    // ΔV = 144 codici × 0,806 mV = 116 mV → 25,5 °C (in qualsiasi ordine)
    CHECK(near(sm_tsc2007_temp_c(700, 844, 3.3f), 25.5, 0.2), "tsc temp %f", sm_tsc2007_temp_c(700, 844, 3.3f));
    CHECK(near(sm_tsc2007_temp_c(844, 700, 3.3f), 25.5, 0.2), "tsc temp ordine inverso");

    if (failures) {
        printf("sensor_math: %d controlli falliti\n", failures);
        return 1;
    }
    printf("sensor_math: tutti i controlli superati\n");
    return 0;
}
