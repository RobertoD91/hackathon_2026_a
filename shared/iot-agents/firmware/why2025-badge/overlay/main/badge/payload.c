// payload: JSON e topic della telemetria (vedi payload.h). C standard, testabile sul PC.

#include "payload.h"

#include <inttypes.h>
#include <math.h>
#include <stdarg.h>
#include <stdio.h>
#include <string.h>

// ------------------------------------------------------------------ buffer con controllo

typedef struct {
    char *buf;
    size_t cap;
    size_t len;
    bool overflow;
} jb_t;

static void jb_init(jb_t *b, char *out, size_t cap) {
    b->buf = out;
    b->cap = cap;
    b->len = 0;
    b->overflow = (out == NULL || cap == 0);
    if (!b->overflow) out[0] = '\0';
}

static void jb_raw(jb_t *b, const char *s) {
    if (b->overflow) return;
    size_t n = strlen(s);
    if (b->len + n + 1 > b->cap) {
        b->overflow = true;
        return;
    }
    memcpy(b->buf + b->len, s, n + 1);
    b->len += n;
}

static void jb_char(jb_t *b, char c) {
    char s[2] = {c, '\0'};
    jb_raw(b, s);
}

// Stringa JSON con escape di " \ e dei caratteri di controllo.
static void jb_str(jb_t *b, const char *s) {
    jb_char(b, '"');
    for (const unsigned char *p = (const unsigned char *)(s ? s : ""); *p; p++) {
        if (*p == '"' || *p == '\\') {
            char e[3] = {'\\', (char)*p, '\0'};
            jb_raw(b, e);
        } else if (*p < 0x20) {
            char e[8];
            snprintf(e, sizeof(e), "\\u%04x", *p);
            jb_raw(b, e);
        } else {
            jb_char(b, (char)*p);
        }
    }
    jb_char(b, '"');
}

static void jb_key(jb_t *b, const char *key, bool *first) {
    if (!*first) jb_char(b, ',');
    *first = false;
    jb_str(b, key);
    jb_char(b, ':');
}

static void jb_num(jb_t *b, double v, int decimals) {
    char tmp[40];
    if (payload_format_number(tmp, sizeof(tmp), v, decimals) < 0) {
        b->overflow = true;  // non dovrebbe succedere: chi chiama controlla isfinite
        return;
    }
    jb_raw(b, tmp);
}

static void jb_long(jb_t *b, long v) {
    char tmp[24];
    snprintf(tmp, sizeof(tmp), "%ld", v);
    jb_raw(b, tmp);
}

static int jb_done(jb_t *b) { return b->overflow ? -1 : (int)b->len; }

// ------------------------------------------------------------------ numeri

int payload_format_number(char *out, size_t cap, double v, int decimals) {
    if (!out || cap == 0 || !isfinite(v)) return -1;
    if (decimals < 0) decimals = 0;
    if (decimals > 6) decimals = 6;
    uint64_t scale = 1;
    for (int i = 0; i < decimals; i++) scale *= 10;
    double r = fabs(v) * (double)scale + 0.5;
    if (r >= 9.0e15) return -1;  // fuori dalla precisione intera di un double
    uint64_t a = (uint64_t)r;
    bool neg = v < 0 && a != 0;  // niente "-0"
    int n;
    if (decimals == 0) {
        n = snprintf(out, cap, "%s%" PRIu64, neg ? "-" : "", a);
    } else {
        n = snprintf(out, cap, "%s%" PRIu64 ".%0*" PRIu64, neg ? "-" : "", a / scale, decimals, a % scale);
    }
    return (n < 0 || (size_t)n >= cap) ? -1 : n;
}

// ------------------------------------------------------------------ identificativi e topic

static bool id_char_ok(char c) {
    return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '.' ||
           c == '_' || c == ':' || c == '-';
}

bool payload_valid_id(const char *s) {
    if (!s) return false;
    size_t n = strlen(s);
    if (n < 1 || n > 64) return false;
    for (size_t i = 0; i < n; i++)
        if (!id_char_ok(s[i])) return false;
    return true;
}

void payload_sanitize_id(char *s) {
    if (!s) return;
    size_t i = 0;
    for (; s[i] && i < 64; i++)
        if (!id_char_ok(s[i])) s[i] = '-';
    s[i] = '\0';
}

// Un livello di topic: niente '/', '+', '#', spazi o caratteri di controllo.
static void jb_topic_level(jb_t *b, const char *s, const char *fallback) {
    if (!s || !*s) s = fallback;
    for (const unsigned char *p = (const unsigned char *)s; *p; p++) {
        char c = (char)*p;
        if (c == '/' || c == '+' || c == '#' || *p <= 0x20 || *p == 0x7f) c = '_';
        jb_char(b, c);
    }
}

int payload_topic(char *out, size_t cap, const char *prefix, const char *zone, const char *device_id,
                  const char *leaf) {
    jb_t b;
    jb_init(&b, out, cap);
    if (prefix && *prefix) {
        jb_raw(&b, prefix);  // il prefisso può contenere '/', es. "bighack" o "test/bighack"
        jb_char(&b, '/');
    }
    jb_topic_level(&b, zone, "senza-zona");
    jb_char(&b, '/');
    jb_topic_level(&b, device_id, "senza-id");
    if (leaf && *leaf) {
        jb_char(&b, '/');
        jb_raw(&b, leaf);
    }
    return jb_done(&b);
}

// ------------------------------------------------------------------ messaggi

void payload_msg_init(payload_msg_t *m) {
    memset(m, 0, sizeof(*m));
    m->lat = NAN;
    m->lon = NAN;
    m->heap = -1;
    m->uptime_s = -1;
    m->chip_temp_c = NAN;
    m->board_temp_c = NAN;
}

bool payload_add(payload_msg_t *m, const char *name, double value, int decimals) {
    if (!isfinite(value)) return true;  // sensore assente o in errore: si salta
    if (m->n_readings >= PAYLOAD_MAX_READINGS) return false;
    payload_reading_t *r = &m->readings[m->n_readings++];
    r->name = name;
    r->value = value;
    r->decimals = decimals;
    r->is_bool = false;
    return true;
}

bool payload_add_bool(payload_msg_t *m, const char *name, bool value) {
    if (m->n_readings >= PAYLOAD_MAX_READINGS) return false;
    payload_reading_t *r = &m->readings[m->n_readings++];
    r->name = name;
    r->value = value ? 1 : 0;
    r->decimals = 0;
    r->is_bool = true;
    return true;
}

int payload_reading_json(const payload_msg_t *m, char *out, size_t cap) {
    jb_t b;
    jb_init(&b, out, cap);
    bool first = true;
    jb_char(&b, '{');
    jb_key(&b, "deviceId", &first);
    jb_str(&b, m->device_id);
    if (m->ts_ms > 0) {
        char ts[24];
        snprintf(ts, sizeof(ts), "%" PRId64, m->ts_ms);
        jb_key(&b, "ts", &first);
        jb_raw(&b, ts);
    }

    bool has_lat = isfinite(m->lat) && isfinite(m->lon);
    bool has_zone = m->zone && *m->zone;
    if (has_lat || has_zone) {
        bool f2 = true;
        jb_key(&b, "location", &first);
        jb_char(&b, '{');
        if (has_lat) {
            jb_key(&b, "lat", &f2);
            jb_num(&b, m->lat, 6);
            jb_key(&b, "lon", &f2);
            jb_num(&b, m->lon, 6);
        }
        if (has_zone) {
            jb_key(&b, "zone", &f2);
            jb_str(&b, m->zone);
        }
        jb_char(&b, '}');
    }

    jb_key(&b, "readings", &first);
    jb_char(&b, '{');
    bool f3 = true;
    for (int i = 0; i < m->n_readings; i++) {
        const payload_reading_t *r = &m->readings[i];
        if (!r->name || !*r->name) continue;
        if (r->is_bool) {
            jb_key(&b, r->name, &f3);
            jb_raw(&b, r->value != 0 ? "true" : "false");
        } else if (isfinite(r->value)) {
            jb_key(&b, r->name, &f3);
            jb_num(&b, r->value, r->decimals);
        }
    }
    if (f3) {  // nessuna grandezza: il contratto vuole readings non vuoto
        jb_key(&b, "uptime_s", &f3);
        jb_long(&b, m->uptime_s >= 0 ? m->uptime_s : 0);
    }
    jb_char(&b, '}');

    bool f4 = true;
    jb_key(&b, "meta", &first);
    jb_char(&b, '{');
    if (m->fw) {
        jb_key(&b, "fw", &f4);
        jb_str(&b, m->fw);
    }
    if (m->net) {
        jb_key(&b, "net", &f4);
        jb_str(&b, m->net);
    }
    jb_key(&b, "simulated", &f4);
    jb_raw(&b, "false");
    if (m->hw) {
        jb_key(&b, "hw", &f4);
        jb_str(&b, m->hw);
    }
    if (m->trigger) {
        jb_key(&b, "trigger", &f4);
        jb_str(&b, m->trigger);
    }
    if (m->rssi != 0) {
        jb_key(&b, "rssi", &f4);
        jb_long(&b, m->rssi);
    }
    if (m->heap >= 0) {
        jb_key(&b, "heap", &f4);
        jb_long(&b, m->heap);
    }
    if (m->uptime_s >= 0) {
        jb_key(&b, "uptime_s", &f4);
        jb_long(&b, m->uptime_s);
    }
    if (isfinite(m->chip_temp_c)) {
        jb_key(&b, "chip_temp_c", &f4);
        jb_num(&b, m->chip_temp_c, 1);
    }
    if (isfinite(m->board_temp_c)) {
        jb_key(&b, "board_temp_c", &f4);
        jb_num(&b, m->board_temp_c, 1);
    }
    if (m->light_sensor) {
        jb_key(&b, "light_sensor", &f4);
        jb_str(&b, m->light_sensor);
    }
    if (m->climate_sensor) {
        jb_key(&b, "climate_sensor", &f4);
        jb_str(&b, m->climate_sensor);
    }
    jb_char(&b, '}');
    jb_char(&b, '}');
    return jb_done(&b);
}

int payload_status_json(char *out, size_t cap, const char *device_id, bool online, const char *fw,
                        const char *ip, const char *zone, int interval_s) {
    jb_t b;
    jb_init(&b, out, cap);
    bool first = true;
    jb_char(&b, '{');
    jb_key(&b, "deviceId", &first);
    jb_str(&b, device_id);
    jb_key(&b, "online", &first);
    jb_raw(&b, online ? "true" : "false");
    if (fw) {
        jb_key(&b, "fw", &first);
        jb_str(&b, fw);
    }
    if (ip && *ip) {
        jb_key(&b, "ip", &first);
        jb_str(&b, ip);
    }
    if (zone && *zone) {
        jb_key(&b, "zone", &first);
        jb_str(&b, zone);
    }
    if (interval_s > 0) {
        jb_key(&b, "interval_s", &first);
        jb_long(&b, interval_s);
    }
    jb_char(&b, '}');
    return jb_done(&b);
}

int payload_c5_json(char *out, size_t cap, double value, int decimals, const char *zona, const char *device_id,
                    int moltiplicatore) {
    if (!isfinite(value)) return -1;
    jb_t b;
    jb_init(&b, out, cap);
    bool first = true;
    jb_char(&b, '{');
    jb_key(&b, "valore", &first);
    jb_num(&b, value, decimals);
    if (zona && *zona) {
        jb_key(&b, "zona", &first);
        jb_str(&b, zona);
    }
    if (moltiplicatore > 0) {
        jb_key(&b, "moltiplicatore", &first);
        jb_long(&b, moltiplicatore);
    }
    if (device_id && *device_id) {
        jb_key(&b, "deviceId", &first);
        jb_str(&b, device_id);
    }
    jb_char(&b, '}');
    return jb_done(&b);
}

const char *payload_c5_name(const char *name) {
    static const char *const map[][2] = {
        {"light_lux", "luce"},         {"temperature_c", "temperatura"}, {"humidity_pct", "umidita"},
        {"pressure_hpa", "pressione"}, {"supply_v", "tensione"},         {"people_count", "persone"},
        {"badges_nearby", "badge_vicini"}, {"button", "pulsante"},
    };
    if (!name) return "";
    for (size_t i = 0; i < sizeof(map) / sizeof(map[0]); i++)
        if (strcmp(name, map[i][0]) == 0) return map[i][1];
    return name;
}

int payload_c5_event_json(char *out, size_t cap, const char *evento, const char *zona, const char *device_id) {
    jb_t b;
    jb_init(&b, out, cap);
    bool first = true;
    jb_char(&b, '{');
    jb_key(&b, "evento", &first);
    jb_str(&b, evento && *evento ? evento : "segnalazione_badge");
    if (zona && *zona) {
        jb_key(&b, "zona", &first);
        jb_str(&b, zona);
    }
    if (device_id && *device_id) {
        jb_key(&b, "da", &first);
        jb_str(&b, device_id);
    }
    jb_char(&b, '}');
    return jb_done(&b);
}
