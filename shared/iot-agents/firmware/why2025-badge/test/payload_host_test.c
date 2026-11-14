// Test sul PC del JSON e dei topic della telemetria (overlay/main/badge/payload.c).
//   cc -std=c11 -Wall -Wextra -I../overlay/main/badge payload_host_test.c ../overlay/main/badge/payload.c -lm
// Stampa su stdout una riga "READING <json>" per ogni lettura: run.sh le passa al validatore
// del hub (shared/iot-agents/src/validate.js) per controllare che rispettino il contratto.

#include <math.h>
#include <stdio.h>
#include <string.h>

#include "payload.h"

static int failures = 0;

#define CHECK(cond, ...)                                       \
    do {                                                       \
        if (!(cond)) {                                         \
            failures++;                                        \
            fprintf(stderr, "FALLITO %s:%d: ", __FILE__, __LINE__); \
            fprintf(stderr, __VA_ARGS__);                      \
            fprintf(stderr, "\n");                             \
        }                                                      \
    } while (0)

static void full_reading(payload_msg_t *m, bool button) {
    payload_msg_init(m);
    m->device_id = "badge-1a2b";
    m->ts_ms = 1763100000123LL;
    m->zone = "citta-della-scienza";
    m->lat = 40.8069;
    m->lon = 14.1764;
    payload_add(m, "light_lux", 532.4, 0);
    payload_add(m, "temperature_c", 23.46, 1);
    payload_add(m, "humidity_pct", 48.6, 0);
    payload_add(m, "pressure_hpa", 1013.27, 1);
    payload_add(m, "supply_v", 4.137, 2);
    payload_add(m, "badges_nearby", 3, 0);
    payload_add_bool(m, "button", button);
    m->fw = "badge-mqtt-0.1.0";
    m->net = "wifi";
    m->hw = "why2025-badge";
    m->trigger = button ? "button" : "interval";
    m->light_sensor = "bh1750";
    m->climate_sensor = "sht4x";
    m->rssi = -67;
    m->heap = 41234;
    m->uptime_s = 3600;
    m->chip_temp_c = 41.25;
    m->board_temp_c = 31.0;
}

int main(void) {
    char out[768], buf[128];
    payload_msg_t m;

    // 1) lettura completa, come la manda il badge con BH1750 + SHT4x
    full_reading(&m, false);
    int n = payload_reading_json(&m, out, sizeof(out));
    CHECK(n > 0, "lettura completa");
    printf("READING %s\n", out);
    CHECK(strstr(out, "\"light_lux\":532") != NULL, "light_lux arrotondato: %s", out);
    CHECK(strstr(out, "\"temperature_c\":23.5") != NULL, "temperature_c: %s", out);
    CHECK(strstr(out, "\"button\":false") != NULL, "button false");
    CHECK(strstr(out, "\"ts\":1763100000123") != NULL, "ts in ms");
    CHECK(strstr(out, "\"zone\":\"citta-della-scienza\"") != NULL, "zona");
    CHECK(strstr(out, "\"simulated\":false") != NULL, "simulated");
    fprintf(stderr, "lettura completa: %d byte (buffer del firmware 768, ESP-MQTT 1024)\n", n);
    CHECK(n < 600, "la lettura completa sta ben sotto i 1024 byte del buffer di ESP-MQTT (%d)", n);

    // 2) pulsante
    full_reading(&m, true);
    CHECK(payload_reading_json(&m, out, sizeof(out)) > 0, "pulsante");
    printf("READING %s\n", out);
    CHECK(strstr(out, "\"button\":true") && strstr(out, "\"trigger\":\"button\""), "pulsante: %s", out);

    // 3) badge senza sensori esterni, senza NTP né coordinate: readings mai vuoto
    payload_msg_init(&m);
    m.device_id = "badge-0001";
    m.zone = "";
    m.uptime_s = 12;
    payload_add(&m, "light_lux", NAN, 0);  // sensore assente: saltato
    CHECK(payload_reading_json(&m, out, sizeof(out)) > 0, "minima");
    printf("READING %s\n", out);
    CHECK(strstr(out, "\"readings\":{\"uptime_s\":12}") != NULL, "readings di riserva: %s", out);
    CHECK(strstr(out, "\"ts\"") == NULL && strstr(out, "\"location\"") == NULL, "senza ts e location: %s", out);

    // 4) escape JSON e numeri negativi / zero negativo
    payload_msg_init(&m);
    m.device_id = "badge-0002";
    m.zone = "zona \"strana\"\\x";
    payload_add(&m, "temperature_c", -3.04, 1);
    payload_add(&m, "power_w", -0.04, 1);
    CHECK(payload_reading_json(&m, out, sizeof(out)) > 0, "escape");
    printf("READING %s\n", out);
    CHECK(strstr(out, "\"zone\":\"zona \\\"strana\\\"\\\\x\"") != NULL, "escape zona: %s", out);
    CHECK(strstr(out, "\"temperature_c\":-3.0") && strstr(out, "\"power_w\":0.0"), "negativi: %s", out);

    // 5) buffer troppo piccolo → -1, mai JSON troncato
    full_reading(&m, false);
    CHECK(payload_reading_json(&m, out, 100) == -1, "overflow deve dare -1");

    // 6) topic
    CHECK(payload_topic(buf, sizeof(buf), "bighack", "citta-della-scienza", "badge-1a2b", "readings") > 0 &&
              strcmp(buf, "bighack/citta-della-scienza/badge-1a2b/readings") == 0,
          "topic: %s", buf);
    payload_topic(buf, sizeof(buf), "bighack", "zona/con+caratteri#vietati", "id 1", "status");
    CHECK(strcmp(buf, "bighack/zona_con_caratteri_vietati/id_1/status") == 0, "topic ripulito: %s", buf);
    payload_topic(buf, sizeof(buf), "bighack", "", "x", "readings");
    CHECK(strcmp(buf, "bighack/senza-zona/x/readings") == 0, "zona vuota: %s", buf);

    // 7) stato retained e last will
    CHECK(payload_status_json(buf, sizeof(buf), "badge-1a2b", true, "fw", "192.168.1.7", "plebiscito", 15) > 0, "stato");
    CHECK(strcmp(buf, "{\"deviceId\":\"badge-1a2b\",\"online\":true,\"fw\":\"fw\",\"ip\":\"192.168.1.7\",\"zone\":\"plebiscito\",\"interval_s\":15}") == 0,
          "stato: %s", buf);
    payload_status_json(buf, sizeof(buf), "badge-1a2b", false, NULL, NULL, "plebiscito", 0);
    CHECK(strcmp(buf, "{\"deviceId\":\"badge-1a2b\",\"online\":false,\"zone\":\"plebiscito\"}") == 0, "lwt: %s", buf);

    // 8) formato c5-agentic-city
    CHECK(payload_c5_json(buf, sizeof(buf), 532.4, 0, "rotonda_diaz", "badge-1a2b", 0) > 0 &&
              strcmp(buf, "{\"valore\":532,\"zona\":\"rotonda_diaz\",\"deviceId\":\"badge-1a2b\"}") == 0,
          "c5: %s", buf);
    CHECK(strcmp(payload_c5_name("light_lux"), "luce") == 0 && strcmp(payload_c5_name("people_count"), "persone") == 0 &&
              strcmp(payload_c5_name("altro_nome"), "altro_nome") == 0,
          "nomi c5");
    payload_c5_event_json(buf, sizeof(buf), "segnalazione_badge", "rotonda_diaz", "badge-1a2b");
    CHECK(strcmp(buf, "{\"evento\":\"segnalazione_badge\",\"zona\":\"rotonda_diaz\",\"da\":\"badge-1a2b\"}") == 0, "evento c5: %s", buf);

    // 9) id
    char id[80] = "badge con spazi/e:simboli!";
    payload_sanitize_id(id);
    CHECK(strcmp(id, "badge-con-spazi-e:simboli-") == 0 && payload_valid_id(id), "sanitize: %s", id);
    CHECK(!payload_valid_id("") && !payload_valid_id(NULL), "id vuoto");

    // 10) numeri
    CHECK(payload_format_number(buf, sizeof(buf), 2.5, 0) > 0 && strcmp(buf, "3") == 0, "arrotondamento 2.5 → %s", buf);
    CHECK(payload_format_number(buf, sizeof(buf), NAN, 1) == -1, "NAN");
    CHECK(payload_format_number(buf, sizeof(buf), 1e20, 0) == -1, "fuori scala");

    if (failures) {
        fprintf(stderr, "payload: %d controlli falliti\n", failures);
        return 1;
    }
    fprintf(stderr, "payload: tutti i controlli superati\n");
    return 0;
}
