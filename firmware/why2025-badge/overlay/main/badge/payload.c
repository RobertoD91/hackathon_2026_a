// payload: topic e JSON della telemetria nel formato napoli/ (vedi payload.h). C standard, testabile sul PC.

#include "payload.h"

#include <inttypes.h>
#include <math.h>
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

static void jb_num(jb_t *b, double v, int decimali) {
    char tmp[40];
    if (payload_numero(tmp, sizeof(tmp), v, decimali) < 0) {
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

int payload_numero(char *out, size_t cap, double v, int decimali) {
    if (!out || cap == 0 || !isfinite(v)) return -1;
    if (decimali < 0) decimali = 0;
    if (decimali > 6) decimali = 6;
    uint64_t scala = 1;
    for (int i = 0; i < decimali; i++) scala *= 10;
    double r = fabs(v) * (double)scala + 0.5;
    if (r >= 9.0e15) return -1;  // fuori dalla precisione intera di un double
    uint64_t a = (uint64_t)r;
    bool neg = v < 0 && a != 0;  // niente "-0"
    int n;
    if (decimali == 0) {
        n = snprintf(out, cap, "%s%" PRIu64, neg ? "-" : "", a);
    } else {
        n = snprintf(out, cap, "%s%" PRIu64 ".%0*" PRIu64, neg ? "-" : "", a / scala, decimali, a % scala);
    }
    return (n < 0 || (size_t)n >= cap) ? -1 : n;
}

// ------------------------------------------------------------------ identificativi e topic

// Stessi caratteri che cloud/mqtt/scripts/aggiungi-utente.sh accetta per un utente:
// l'id del dispositivo È il suo utente MQTT, e l'ACL lo fa scrivere solo sotto il proprio nome.
static bool id_char_ok(char c) {
    return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '.' ||
           c == '_' || c == '-';
}

bool payload_id_valido(const char *s) {
    if (!s) return false;
    size_t n = strlen(s);
    if (n < 1 || n > 64) return false;
    for (size_t i = 0; i < n; i++)
        if (!id_char_ok(s[i])) return false;
    return true;
}

void payload_ripulisci_id(char *s) {
    if (!s) return;
    size_t i = 0;
    for (; s[i] && i < 64; i++)
        if (!id_char_ok(s[i])) s[i] = '-';
    s[i] = '\0';
}

bool payload_zona_valida(const char *s) {
    if (!s) return false;
    size_t n = strlen(s);
    if (n < 1 || n > 31) return false;
    for (size_t i = 0; i < n; i++) {
        char c = s[i];
        if (!((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_')) return false;
    }
    return true;
}

// Grandezza o foglia: minuscole, cifre e '_' (temperatura, umidita, luce, pressione, persone, stato, cmd).
static bool livello_valido(const char *s) { return payload_zona_valida(s); }

static int topic3(char *out, size_t cap, const char *ramo, const char *id, const char *foglia) {
    if (!payload_id_valido(id) || !livello_valido(foglia)) {
        if (out && cap) out[0] = '\0';
        return -1;
    }
    jb_t b;
    jb_init(&b, out, cap);
    jb_raw(&b, PAYLOAD_RADICE "/");
    jb_raw(&b, ramo);
    jb_char(&b, '/');
    jb_raw(&b, id);
    jb_char(&b, '/');
    jb_raw(&b, foglia);
    return jb_done(&b);
}

int payload_topic_sensore(char *out, size_t cap, const char *id, const char *grandezza) {
    return topic3(out, cap, "sensori", id, grandezza);
}

int payload_topic_nodo(char *out, size_t cap, const char *id, const char *foglia) {
    return topic3(out, cap, "nodi", id, foglia);
}

// ------------------------------------------------------------------ messaggi

int payload_lettura_json(char *out, size_t cap, const char *zona, double valore, int decimali, int moltiplicatore) {
    if (!isfinite(valore) || !zona || !*zona) {
        if (out && cap) out[0] = '\0';
        return -1;
    }
    jb_t b;
    jb_init(&b, out, cap);
    bool first = true;
    jb_char(&b, '{');
    jb_key(&b, "zona", &first);
    jb_str(&b, zona);
    jb_key(&b, "valore", &first);
    jb_num(&b, valore, decimali);
    if (moltiplicatore > 0) {
        jb_key(&b, "moltiplicatore", &first);
        jb_long(&b, moltiplicatore);
    }
    jb_char(&b, '}');
    return jb_done(&b);
}

void payload_stato_init(payload_stato_t *s) {
    memset(s, 0, sizeof(*s));
    s->tensione = NAN;
    s->badge_vicini = -1;
    s->heap = -1;
}

int payload_stato_json(const payload_stato_t *s, char *out, size_t cap) {
    jb_t b;
    jb_init(&b, out, cap);
    if (!s->online) {
        jb_raw(&b, PAYLOAD_STATO_OFFLINE);
        return jb_done(&b);
    }
    bool first = true;
    jb_char(&b, '{');
    jb_key(&b, "online", &first);
    jb_raw(&b, "true");
    if (s->ruolo && *s->ruolo) {
        jb_key(&b, "ruolo", &first);
        jb_str(&b, s->ruolo);
    }
    if (s->zona && *s->zona) {
        jb_key(&b, "zona", &first);
        jb_str(&b, s->zona);
    }
    if (s->versione && *s->versione) {
        jb_key(&b, "versione", &first);
        jb_str(&b, s->versione);
    }
    if (s->ip && *s->ip) {
        jb_key(&b, "ip", &first);
        jb_str(&b, s->ip);
    }
    if (s->rssi != 0) {
        jb_key(&b, "rssi", &first);
        jb_long(&b, s->rssi);
    }
    if (s->intervallo_s > 0) {
        jb_key(&b, "intervallo_s", &first);
        jb_long(&b, s->intervallo_s);
    }
    if (s->sensori && *s->sensori) {
        jb_key(&b, "sensori", &first);
        jb_str(&b, s->sensori);
    }
    if (isfinite(s->tensione)) {
        jb_key(&b, "tensione", &first);
        jb_num(&b, s->tensione, 2);
    }
    if (s->badge_vicini >= 0) {
        jb_key(&b, "badge_vicini", &first);
        jb_long(&b, s->badge_vicini);
    }
    if (s->heap >= 0) {
        jb_key(&b, "heap", &first);
        jb_long(&b, s->heap);
    }
    jb_char(&b, '}');
    return jb_done(&b);
}
