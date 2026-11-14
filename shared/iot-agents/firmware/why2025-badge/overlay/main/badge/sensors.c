// sensors: rilevamento e lettura dei sensori I2C del badge (vedi sensors.h).
// Usa il driver I2C "legacy" di ESP-IDF 4.4 sul bus già installato da led_init()
// (I2C_NUM_0, SCL=GPIO0, SDA=GPIO1, 400 kHz). Il driver serializza le transazioni,
// quindi convive con le scritture della retroilluminazione fatte dalla UI.
// Le conversioni numeriche sono in sensor_math.c (testate sul PC).

#include "sensors.h"

#include <math.h>
#include <stdio.h>
#include <string.h>

#include "driver/i2c.h"
#include "driver/temp_sensor.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "led.h"  // I2C_MASTER_NUM: stesso bus dell'AW9523B
#include "sensor_math.h"

static const char *TAG = "sensors";

#define BUS I2C_MASTER_NUM
#define I2C_TIMEOUT pdMS_TO_TICKS(60)
#define TSC2007_ADDR 0x48
#define TSC2007_VREF 3.3f  // VDD/REF del TSC2007 = +3,3 V
#define SUPPLY_DIVIDER 2.0f // R3 = R16 = 100 kΩ

typedef enum { LIGHT_NONE, LIGHT_BH1750, LIGHT_VEML7700 } light_kind_t;
typedef enum { CLIMATE_NONE, CLIMATE_SHT4X, CLIMATE_SHT3X, CLIMATE_AHT } climate_kind_t;

static light_kind_t light_kind = LIGHT_NONE;
static uint8_t light_addr;
static climate_kind_t climate_kind = CLIMATE_NONE;
static uint8_t climate_addr;
static bool aht_crc = false;
static bool bme_ok = false;
static uint8_t bme_addr;
static sm_bme280_calib_t bme_cal;
static bool tsc_ok = false;
static bool chip_temp_ok = false;
static char found[96] = "nessun sensore";

// ------------------------------------------------------------------ I2C

static esp_err_t i2c_probe(uint8_t addr) {
    i2c_cmd_handle_t cmd = i2c_cmd_link_create();
    i2c_master_start(cmd);
    i2c_master_write_byte(cmd, (uint8_t)((addr << 1) | I2C_MASTER_WRITE), true);
    i2c_master_stop(cmd);
    esp_err_t err = i2c_master_cmd_begin(BUS, cmd, I2C_TIMEOUT);
    i2c_cmd_link_delete(cmd);
    return err;
}

static esp_err_t wr(uint8_t addr, const uint8_t *d, size_t n) {
    return i2c_master_write_to_device(BUS, addr, d, n, I2C_TIMEOUT);
}

static esp_err_t rd(uint8_t addr, uint8_t *d, size_t n) { return i2c_master_read_from_device(BUS, addr, d, n, I2C_TIMEOUT); }

static esp_err_t wrrd(uint8_t addr, uint8_t reg, uint8_t *d, size_t n) {
    return i2c_master_write_read_device(BUS, addr, &reg, 1, d, n, I2C_TIMEOUT);
}

static esp_err_t wr1(uint8_t addr, uint8_t b) { return wr(addr, &b, 1); }

static esp_err_t wr_reg(uint8_t addr, uint8_t reg, uint8_t val) {
    uint8_t d[2] = {reg, val};
    return wr(addr, d, 2);
}

static void delay_ms(int ms) { vTaskDelay(pdMS_TO_TICKS(ms) > 0 ? pdMS_TO_TICKS(ms) : 1); }

static void found_add(const char *name, uint8_t addr) {
    if (strcmp(found, "nessun sensore") == 0) found[0] = '\0';
    size_t n = strlen(found);
    snprintf(found + n, sizeof(found) - n, "%s%s@%02X", n ? " " : "", name, addr);
}

// ------------------------------------------------------------------ luce

static bool bh1750_init(uint8_t addr) {
    if (i2c_probe(addr) != ESP_OK) return false;
    if (wr1(addr, 0x01) != ESP_OK) return false;  // power on
    if (wr1(addr, 0x10) != ESP_OK) return false;  // misura continua, alta risoluzione (1 lx, 120 ms)
    return true;
}

static bool veml7700_init(void) {
    uint8_t id[2];
    if (i2c_probe(0x10) != ESP_OK || wrrd(0x10, 0x07, id, 2) != ESP_OK || id[0] != 0x81) return false;
    uint8_t conf[3] = {0x00, 0x00, 0x10};  // ALS_CONF: guadagno 1/8, 100 ms, acceso
    uint8_t psm[3] = {0x03, 0x00, 0x00};   // risparmio energetico spento
    return wr(0x10, conf, 3) == ESP_OK && wr(0x10, psm, 3) == ESP_OK;
}

static float light_read(void) {
    uint8_t d[2];
    switch (light_kind) {
        case LIGHT_BH1750:
            if (rd(light_addr, d, 2) != ESP_OK) return NAN;
            return sm_bh1750_lux((uint16_t)((d[0] << 8) | d[1]));
        case LIGHT_VEML7700:
            if (wrrd(0x10, 0x04, d, 2) != ESP_OK) return NAN;
            return sm_veml7700_lux((uint16_t)(d[0] | (d[1] << 8)));
        default:
            return NAN;
    }
}

// ------------------------------------------------------------------ clima

static bool sht4x_measure(uint8_t addr, float *t, float *h) {
    uint8_t d[6];
    if (wr1(addr, 0xFD) != ESP_OK) return false;  // alta precisione, senza riscaldatore
    delay_ms(10);
    return rd(addr, d, 6) == ESP_OK && sm_sht4x_convert(d, t, h);
}

static bool sht3x_measure(uint8_t addr, float *t, float *h) {
    uint8_t cmd[2] = {0x24, 0x00};  // singola misura, ripetibilità alta, senza clock stretching
    uint8_t d[6];
    if (wr(addr, cmd, 2) != ESP_OK) return false;
    delay_ms(20);
    return rd(addr, d, 6) == ESP_OK && sm_sht3x_convert(d, t, h);
}

static bool aht_measure(float *t, float *h) {
    uint8_t cmd[3] = {0xAC, 0x33, 0x00};
    uint8_t d[7];
    if (wr(0x38, cmd, 3) != ESP_OK) return false;
    delay_ms(80);
    for (int i = 0; i < 3; i++) {
        if (rd(0x38, d, 7) != ESP_OK) return false;
        if (!(d[0] & 0x80)) break;  // non più occupato
        delay_ms(20);
    }
    aht_crc = sm_crc8(d, 6) == d[6];  // AHT20/21 hanno il CRC, AHT10 no
    return sm_aht_convert(d, t, h) && *t > -40.5f && *t < 85.5f;
}

static bool aht_init(void) {
    uint8_t st;
    if (i2c_probe(0x38) != ESP_OK || rd(0x38, &st, 1) != ESP_OK) return false;
    if (!(st & 0x08)) {  // non calibrato: inizializza (0xBE per AHT20, 0xE1 per AHT10)
        uint8_t init20[3] = {0xBE, 0x08, 0x00};
        uint8_t init10[3] = {0xE1, 0x08, 0x00};
        if (wr(0x38, init20, 3) != ESP_OK) wr(0x38, init10, 3);
        delay_ms(20);
    }
    float t, h;
    return aht_measure(&t, &h);
}

static bool bme280_init(uint8_t addr) {
    uint8_t id, c1[26], c2[7];
    if (i2c_probe(addr) != ESP_OK || wrrd(addr, 0xD0, &id, 1) != ESP_OK) return false;
    bool bme = id == 0x60;
    if (!bme && id != 0x58 && id != 0x56 && id != 0x57) return false;
    if (wrrd(addr, 0x88, c1, 26) != ESP_OK) return false;
    if (bme && wrrd(addr, 0xE1, c2, 7) != ESP_OK) return false;
    sm_bme280_parse_calib(c1, bme ? c2 : NULL, &bme_cal);
    wr_reg(addr, 0xF5, 0x00);           // filtro spento, standby minimo
    if (bme) wr_reg(addr, 0xF2, 0x01);  // umidità ×1 (va scritto prima di ctrl_meas)
    bme_addr = addr;
    return true;
}

static bool bme280_measure(float *t, float *p, float *h) {
    uint8_t d[8] = {0};
    if (bme_cal.has_humidity) wr_reg(bme_addr, 0xF2, 0x01);
    if (wr_reg(bme_addr, 0xF4, 0x25) != ESP_OK) return false;  // T ×1, P ×1, modo forzato
    delay_ms(12);
    if (wrrd(bme_addr, 0xF7, d, bme_cal.has_humidity ? 8 : 6) != ESP_OK) return false;
    int32_t ap, at, ah;
    sm_bme280_unpack(d, &ap, &at, &ah);
    if (!bme_cal.has_humidity) ah = 0x8000;
    sm_bme280_compensate(&bme_cal, at, ap, ah, t, p, h);
    return !isnan(*t);
}

// ------------------------------------------------------------------ TSC2007 e chip

static bool tsc2007_cmd(uint8_t cmd, uint16_t *code) {
    uint8_t d[2];
    if (wr1(TSC2007_ADDR, cmd) != ESP_OK) return false;  // PD1-PD0 = 00, 12 bit
    delay_ms(2);
    if (rd(TSC2007_ADDR, d, 2) != ESP_OK) return false;
    *code = sm_tsc2007_code(d);
    return true;
}

// ------------------------------------------------------------------ API

void sensors_init(void) {
    if (bh1750_init(0x23)) {
        light_kind = LIGHT_BH1750;
        light_addr = 0x23;
    } else if (bh1750_init(0x5C)) {
        light_kind = LIGHT_BH1750;
        light_addr = 0x5C;
    } else if (veml7700_init()) {
        light_kind = LIGHT_VEML7700;
        light_addr = 0x10;
    }
    if (light_kind != LIGHT_NONE) found_add(light_kind == LIGHT_BH1750 ? "BH1750" : "VEML7700", light_addr);

    float t, h;
    if (i2c_probe(0x44) == ESP_OK && sht4x_measure(0x44, &t, &h)) {
        climate_kind = CLIMATE_SHT4X;
        climate_addr = 0x44;
    } else if (i2c_probe(0x44) == ESP_OK && sht3x_measure(0x44, &t, &h)) {
        climate_kind = CLIMATE_SHT3X;
        climate_addr = 0x44;
    } else if (i2c_probe(0x45) == ESP_OK && sht3x_measure(0x45, &t, &h)) {
        climate_kind = CLIMATE_SHT3X;
        climate_addr = 0x45;
    } else if (aht_init()) {
        climate_kind = CLIMATE_AHT;
        climate_addr = 0x38;
    }
    if (climate_kind == CLIMATE_SHT4X) found_add("SHT4x", climate_addr);
    if (climate_kind == CLIMATE_SHT3X) found_add("SHT3x", climate_addr);
    if (climate_kind == CLIMATE_AHT) found_add(aht_crc ? "AHT20" : "AHT1x", climate_addr);

    bme_ok = bme280_init(0x76) || bme280_init(0x77);
    if (bme_ok) found_add(bme_cal.has_humidity ? "BME280" : "BMP280", bme_addr);

    uint16_t code;
    tsc_ok = i2c_probe(TSC2007_ADDR) == ESP_OK && tsc2007_cmd(0x20, &code);
    if (tsc_ok) found_add("TSC2007", TSC2007_ADDR);

    temp_sensor_config_t tcfg = TSENS_CONFIG_DEFAULT();
    chip_temp_ok = temp_sensor_set_config(tcfg) == ESP_OK && temp_sensor_start() == ESP_OK;

    ESP_LOGI(TAG, "sensori trovati: %s", found);
    if (light_kind == LIGHT_NONE)
        ESP_LOGW(TAG, "nessun sensore di luce: collega un BH1750 o un VEML7700 al connettore I2C (3,3 V dal connettore POW)");
}

void sensors_read(sensors_data_t *out) {
    out->light_lux = light_read();
    out->light_name = light_kind == LIGHT_BH1750 ? "bh1750" : (light_kind == LIGHT_VEML7700 ? "veml7700" : NULL);

    float t = NAN, h = NAN, p = NAN;
    bool ok = false;
    switch (climate_kind) {
        case CLIMATE_SHT4X: ok = sht4x_measure(climate_addr, &t, &h); break;
        case CLIMATE_SHT3X: ok = sht3x_measure(climate_addr, &t, &h); break;
        case CLIMATE_AHT: ok = aht_measure(&t, &h); break;
        default: break;
    }
    if (!ok) t = h = NAN;
    out->climate_name = NULL;
    if (ok) out->climate_name = climate_kind == CLIMATE_SHT4X ? "sht4x"
                              : climate_kind == CLIMATE_SHT3X ? "sht3x"
                              : (aht_crc ? "aht20" : "aht1x");

    float bt = NAN, bh = NAN;
    if (bme_ok && bme280_measure(&bt, &p, &bh)) {
        if (isnan(t)) {  // nessun SHT/AHT: temperatura (e umidità) dal BME280
            t = bt;
            h = bh;
            out->climate_name = bme_cal.has_humidity ? "bme280" : "bmp280";
        }
    }
    out->temperature_c = t;
    out->humidity_pct = h;
    out->pressure_hpa = p;

    out->supply_v = out->board_temp_c = NAN;
    if (tsc_ok) {
        uint16_t aux, t0, t1;
        if (tsc2007_cmd(0x20, &aux)) out->supply_v = sm_tsc2007_volts(aux, TSC2007_VREF) * SUPPLY_DIVIDER;
        if (tsc2007_cmd(0x00, &t0) && tsc2007_cmd(0x40, &t1)) {
            float bt2 = sm_tsc2007_temp_c(t0, t1, TSC2007_VREF);
            if (bt2 > -40 && bt2 < 125) out->board_temp_c = bt2;
        }
    }

    out->chip_temp_c = NAN;
    float ct;
    if (chip_temp_ok && temp_sensor_read_celsius(&ct) == ESP_OK) out->chip_temp_c = ct;
}

const char *sensors_found(void) { return found; }
