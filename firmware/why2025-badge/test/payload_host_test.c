// Test sul PC dei topic e del JSON della telemetria (overlay/main/badge/payload.c), formato napoli/.
//   cc -std=c11 -Wall -Wextra -I../overlay/main/badge payload_host_test.c ../overlay/main/badge/payload.c -lm
// Stampa su stdout una riga "<topic> <payload>" per ogni messaggio che il badge manderebbe (come
// mosquitto_sub -v): run.sh le passa a firmware/valida-messaggi.mjs, che controlla il formato unico.

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

// Messaggio per il validatore: "<topic> <payload>".
static void emetti(const char *topic, const char *json) { printf("%s %s\n", topic, json); }

static void lettura(const char *id, const char *grandezza, const char *zona, double v, int dec, int molt,
                    const char *atteso) {
    char topic[112], json[128];
    CHECK(payload_topic_sensore(topic, sizeof(topic), id, grandezza) > 0, "topic %s", grandezza);
    int n = payload_lettura_json(json, sizeof(json), zona, v, dec, molt);
    CHECK(n > 0, "lettura %s", grandezza);
    if (atteso) CHECK(strcmp(json, atteso) == 0, "%s: %s (atteso %s)", grandezza, json, atteso);
    if (n > 0) emetti(topic, json);
}

int main(void) {
    char buf[320], topic[112];

    // 1) topic
    CHECK(payload_topic_sensore(topic, sizeof(topic), "badge-1", "temperatura") > 0 &&
              strcmp(topic, "napoli/sensori/badge-1/temperatura") == 0,
          "topic sensore: %s", topic);
    CHECK(payload_topic_nodo(topic, sizeof(topic), "badge-1", "stato") > 0 && strcmp(topic, "napoli/nodi/badge-1/stato") == 0,
          "topic stato: %s", topic);
    CHECK(payload_topic_nodo(topic, sizeof(topic), "badge-1", "cmd") > 0 && strcmp(topic, "napoli/nodi/badge-1/cmd") == 0,
          "topic cmd: %s", topic);
    CHECK(payload_topic_sensore(topic, sizeof(topic), "id/con+jolly#", "luce") == -1, "id con / + # rifiutato");
    CHECK(payload_topic_sensore(topic, sizeof(topic), "badge-1", "Luce") == -1, "grandezza maiuscola rifiutata");
    CHECK(payload_topic_sensore(topic, 20, "badge-1", "temperatura") == -1, "buffer piccolo");

    // 2) letture come le manda il badge con BH1750 + SHT4x + BME280 (arrotondamenti come nel firmware)
    lettura("badge-1", "temperatura", "rotonda_diaz", 23.46, 1, 0, "{\"zona\":\"rotonda_diaz\",\"valore\":23.5}");
    lettura("badge-1", "umidita", "rotonda_diaz", 48.6, 0, 0, "{\"zona\":\"rotonda_diaz\",\"valore\":49}");
    lettura("badge-1", "luce", "rotonda_diaz", 532.4, 0, 0, "{\"zona\":\"rotonda_diaz\",\"valore\":532}");
    lettura("badge-1", "pressione", "rotonda_diaz", 1013.27, 1, 0, "{\"zona\":\"rotonda_diaz\",\"valore\":1013.3}");
    lettura("badge-1", "persone", "rotonda_diaz", 3, 0, 500,
            "{\"zona\":\"rotonda_diaz\",\"valore\":3,\"moltiplicatore\":500}");
    lettura("badge-1", "persone", "mergellina", 0, 0, 500, "{\"zona\":\"mergellina\",\"valore\":0,\"moltiplicatore\":500}");
    lettura("badge-1", "temperatura", "castel_ovo", -3.04, 1, 0, "{\"zona\":\"castel_ovo\",\"valore\":-3.0}");
    lettura("badge-1", "temperatura", "castel_ovo", -0.04, 1, 0, "{\"zona\":\"castel_ovo\",\"valore\":0.0}");

    // 3) sensore assente (NAN) o zona vuota: niente messaggio, mai JSON a metà
    CHECK(payload_lettura_json(buf, sizeof(buf), "rotonda_diaz", NAN, 0, 0) == -1 && buf[0] == '\0', "NAN");
    CHECK(payload_lettura_json(buf, sizeof(buf), "", 21, 0, 0) == -1, "zona vuota");
    CHECK(payload_lettura_json(buf, 20, "rotonda_diaz", 21, 0, 0) == -1, "buffer piccolo");

    // 4) stato trattenuto e last will
    payload_stato_t s;
    payload_stato_init(&s);
    s.online = true;
    s.ruolo = "badge";
    s.zona = "rotonda_diaz";
    s.versione = "badge-napoli-0.2.0";
    s.ip = "172.20.10.3";
    s.rssi = -61;
    int n = payload_stato_json(&s, buf, sizeof(buf));
    CHECK(n > 0 && strcmp(buf, "{\"online\":true,\"ruolo\":\"badge\",\"zona\":\"rotonda_diaz\",\"versione\":\"badge-napoli-0.2.0\","
                               "\"ip\":\"172.20.10.3\",\"rssi\":-61}") == 0,
          "stato minimo: %s", buf);
    payload_topic_nodo(topic, sizeof(topic), "badge-1", "stato");
    emetti(topic, buf);

    s.intervallo_s = 15;
    s.sensori = "BH1750@23 SHT4x@44 TSC2007@48";
    s.tensione = 4.137;
    s.badge_vicini = 3;
    s.heap = 41234;
    n = payload_stato_json(&s, buf, sizeof(buf));
    CHECK(n > 0 && strstr(buf, "\"tensione\":4.14") && strstr(buf, "\"badge_vicini\":3") && strstr(buf, "\"heap\":41234") &&
              strstr(buf, "\"intervallo_s\":15"),
          "stato completo: %s", buf);
    fprintf(stderr, "stato completo: %d byte (buffer del firmware 320, ESP-MQTT 1024)\n", n);
    CHECK(n > 0 && n < 280, "lo stato completo sta nel buffer da 320 byte con margine (%d)", n);
    emetti(topic, buf);

    // Badge senza Wi-Fi ancora agganciato: niente ip né rssi
    payload_stato_init(&s);
    s.online = true;
    s.ruolo = "badge";
    s.zona = "rotonda_diaz";
    CHECK(payload_stato_json(&s, buf, sizeof(buf)) > 0 && strcmp(buf, "{\"online\":true,\"ruolo\":\"badge\",\"zona\":\"rotonda_diaz\"}") == 0,
          "stato senza rete: %s", buf);

    payload_stato_init(&s);  // online false
    CHECK(payload_stato_json(&s, buf, sizeof(buf)) > 0 && strcmp(buf, PAYLOAD_STATO_OFFLINE) == 0 &&
              strcmp(buf, "{\"online\":false}") == 0,
          "offline: %s", buf);
    emetti(topic, buf);
    CHECK(payload_stato_json(&s, buf, 5) == -1, "offline in un buffer piccolo");

    // 5) escape JSON nei testi
    payload_stato_init(&s);
    s.online = true;
    s.ruolo = "badge";
    s.zona = "rotonda_diaz";
    s.sensori = "nome \"strano\"\\x";
    CHECK(payload_stato_json(&s, buf, sizeof(buf)) > 0 && strstr(buf, "\"sensori\":\"nome \\\"strano\\\"\\\\x\""), "escape: %s", buf);

    // 6) id e zone
    char id[80] = "badge con spazi/e:simboli!";
    payload_ripulisci_id(id);
    CHECK(strcmp(id, "badge-con-spazi-e-simboli-") == 0 && payload_id_valido(id), "ripulisci: %s", id);
    CHECK(!payload_id_valido("") && !payload_id_valido(NULL) && !payload_id_valido("a:b"), "id non validi");
    char lungo[100];
    memset(lungo, 'x', sizeof(lungo) - 1);
    lungo[sizeof(lungo) - 1] = '\0';
    CHECK(!payload_id_valido(lungo), "id oltre 64 caratteri");
    payload_ripulisci_id(lungo);
    CHECK(strlen(lungo) == 64 && payload_id_valido(lungo), "id troncato a 64");
    CHECK(payload_zona_valida("rotonda_diaz") && payload_zona_valida("castel_ovo"), "zone valide");
    CHECK(!payload_zona_valida("Rotonda") && !payload_zona_valida("citta-della-scienza") && !payload_zona_valida("") &&
              !payload_zona_valida("a/b"),
          "zone non valide");

    // 7) numeri
    CHECK(payload_numero(buf, sizeof(buf), 2.5, 0) > 0 && strcmp(buf, "3") == 0, "arrotondamento 2.5 → %s", buf);
    CHECK(payload_numero(buf, sizeof(buf), NAN, 1) == -1, "NAN");
    CHECK(payload_numero(buf, sizeof(buf), 1e20, 0) == -1, "fuori scala");

    if (failures) {
        fprintf(stderr, "payload: %d controlli falliti\n", failures);
        return 1;
    }
    fprintf(stderr, "payload: tutti i controlli superati\n");
    return 0;
}
