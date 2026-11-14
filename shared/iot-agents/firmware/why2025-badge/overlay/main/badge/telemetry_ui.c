// telemetry_ui: schermata "SENSORI" (vedi telemetry_ui.h). Display 320×240, LVGL v7.
// I font Montserrat del badge hanno solo ASCII: niente "°" né lettere accentate nei testi.
// Le etichette si aggiornano da un lv_task (contesto del task della UI), leggendo una copia
// dello stato della telemetria: nessuna chiamata LVGL da altri task.

#include "telemetry_ui.h"

#include <math.h>
#include <stdio.h>
#include <string.h>

#include "esp_timer.h"
#include "telemetry.h"

static lv_obj_t *scr;
static lv_obj_t *lbl_title, *lbl_zone, *lbl_lux, *lbl_clima, *lbl_extra, *lbl_net, *lbl_net2, *lbl_msg, *lbl_help;
static lv_task_t *refresh_task;
static int64_t feedback_until_us;
static char feedback[48];

static lv_obj_t *label(lv_coord_t y, const lv_font_t *font, lv_color_t color) {
    lv_obj_t *l = lv_label_create(scr, NULL);
    lv_label_set_long_mode(l, LV_LABEL_LONG_BREAK);
    lv_obj_set_width(l, 304);
    lv_obj_set_pos(l, 8, y);
    lv_obj_set_style_local_text_font(l, LV_LABEL_PART_MAIN, LV_STATE_DEFAULT, font);
    lv_obj_set_style_local_text_color(l, LV_LABEL_PART_MAIN, LV_STATE_DEFAULT, color);
    lv_label_set_text(l, "");
    return l;
}

static const char *state_text(telemetry_state_t s) {
    switch (s) {
        case TELEMETRY_OFF: return "telemetria spenta (manca la config Wi-Fi)";
        case TELEMETRY_WIFI_WAIT: return "Wi-Fi: connessione...";
        case TELEMETRY_PAUSED_AP: return "in pausa: AP del badge acceso";
        case TELEMETRY_MQTT_WAIT: return "Wi-Fi ok, broker MQTT: connessione...";
        case TELEMETRY_ONLINE: return "MQTT ONLINE";
        default: return "?";
    }
}

static void refresh(lv_task_t *t) {
    (void)t;
    telemetry_snapshot_t s;
    telemetry_get_snapshot(&s);
    const sensors_data_t *d = &s.data;

    lv_label_set_text_fmt(lbl_title, "SENSORI  %s", s.device_id);
    lv_label_set_text_fmt(lbl_zone, "zona %s", s.zone[0] ? s.zone : "-");

    if (!s.has_data) {
        lv_label_set_text(lbl_lux, "lettura in corso...");
    } else if (!isnan(d->light_lux)) {
        lv_label_set_text_fmt(lbl_lux, "LUCE  %.0f lx  (%s)", d->light_lux, d->light_name ? d->light_name : "");
    } else {
        lv_label_set_text(lbl_lux, "LUCE  nessun sensore: BH1750 o VEML7700 sul connettore I2C");
    }

    char clima[96] = "";
    if (s.has_data && !isnan(d->temperature_c)) {
        int n = snprintf(clima, sizeof(clima), "%.1f C", d->temperature_c);
        if (!isnan(d->humidity_pct)) n += snprintf(clima + n, sizeof(clima) - n, "  %.0f %%", d->humidity_pct);
        if (!isnan(d->pressure_hpa)) snprintf(clima + n, sizeof(clima) - n, "  %.0f hPa", d->pressure_hpa);
    } else if (s.has_data) {
        snprintf(clima, sizeof(clima), "clima: nessun sensore (SHT4x, AHT20, BME280)");
    }
    lv_label_set_text(lbl_clima, clima);

    char extra[96] = "";
    int n = 0;
    if (s.has_data && !isnan(d->supply_v)) n += snprintf(extra + n, sizeof(extra) - n, "alim. %.2f V   ", d->supply_v);
    if (s.badges_nearby >= 0) n += snprintf(extra + n, sizeof(extra) - n, "badge vicini %d   ", s.badges_nearby);
    if (s.has_data && !isnan(d->board_temp_c)) snprintf(extra + n, sizeof(extra) - n, "scheda %.0f C", d->board_temp_c);
    lv_label_set_text(lbl_extra, extra);

    lv_obj_set_style_local_text_color(lbl_net, LV_LABEL_PART_MAIN, LV_STATE_DEFAULT,
                                      s.state == TELEMETRY_ONLINE ? LV_COLOR_MAKE(0x00, 0x80, 0x20)
                                                                  : LV_COLOR_MAKE(0xC0, 0x40, 0x00));
    lv_label_set_text(lbl_net, state_text(s.state));

    char net2[120];
    int64_t now = esp_timer_get_time();
    int ago = s.last_sent_us ? (int)((now - s.last_sent_us) / 1000000) : -1;
    n = snprintf(net2, sizeof(net2), "inviate %u", (unsigned)s.sent);
    if (s.failed) n += snprintf(net2 + n, sizeof(net2) - n, " (perse %u)", (unsigned)s.failed);
    if (ago >= 0) n += snprintf(net2 + n, sizeof(net2) - n, ", ultima %d s fa", ago);
    n += snprintf(net2 + n, sizeof(net2) - n, ", ogni %d s", s.interval_s);
    if (s.ip[0]) n += snprintf(net2 + n, sizeof(net2) - n, "\nIP %s", s.ip);
    if (s.rssi) n += snprintf(net2 + n, sizeof(net2) - n, "  RSSI %d dBm", s.rssi);
    if (s.last_error[0] && s.state != TELEMETRY_ONLINE) snprintf(net2 + n, sizeof(net2) - n, "\n%s", s.last_error);
    lv_label_set_text(lbl_net2, net2);

    if (feedback_until_us > now) {
        lv_label_set_text(lbl_msg, feedback);
    } else if (s.message[0]) {
        lv_label_set_text_fmt(lbl_msg, "> %s", s.message);
    } else {
        lv_label_set_text_fmt(lbl_msg, "sensori: %s", s.sensors[0] ? s.sensors : "-");
    }
}

lv_obj_t *telemetry_ui_create(void) {
    scr = lv_obj_create(NULL, NULL);
    lv_obj_set_style_local_bg_color(scr, LV_OBJ_PART_MAIN, LV_STATE_DEFAULT, LV_COLOR_WHITE);
    lv_obj_set_style_local_bg_opa(scr, LV_OBJ_PART_MAIN, LV_STATE_DEFAULT, LV_OPA_COVER);

    lv_color_t ink = LV_COLOR_MAKE(0x20, 0x20, 0x20);
    lbl_title = label(6, &lv_font_montserrat_16, LV_COLOR_MAKE(0xE8, 0x0B, 0x60));  // magenta Cyber Saiyan
    lbl_zone = label(28, &lv_font_montserrat_12, ink);
    lbl_lux = label(48, &lv_font_montserrat_18, ink);
    lbl_clima = label(92, &lv_font_montserrat_16, ink);
    lbl_extra = label(114, &lv_font_montserrat_12, ink);
    lbl_net = label(134, &lv_font_montserrat_14, ink);
    lbl_net2 = label(152, &lv_font_montserrat_10, ink);
    lbl_msg = label(188, &lv_font_montserrat_12, LV_COLOR_MAKE(0x00, 0x40, 0xA0));
    lbl_help = label(224, &lv_font_montserrat_10, LV_COLOR_MAKE(0x70, 0x70, 0x70));
    lv_label_set_text(lbl_help, "SU: segnala   GIU: invia ora   tieni premuto: cambia schermata");

    refresh_task = lv_task_create(refresh, 1000, LV_TASK_PRIO_OFF, NULL);
    refresh(NULL);
    return scr;
}

void telemetry_ui_set_active(bool active) {
    if (!refresh_task) return;
    lv_task_set_prio(refresh_task, active ? LV_TASK_PRIO_LOW : LV_TASK_PRIO_OFF);
    if (active) lv_task_ready(refresh_task);
}

static void show_feedback(const char *text) {
    strlcpy(feedback, text, sizeof(feedback));
    feedback_until_us = esp_timer_get_time() + 3000000;
    if (refresh_task) lv_task_ready(refresh_task);
}

void telemetry_ui_button_up(void) {
    telemetry_button();
    show_feedback(telemetry_enabled() ? "segnalazione inviata (button: true)" : "telemetria spenta");
}

void telemetry_ui_button_down(void) {
    telemetry_send_now();
    show_feedback(telemetry_enabled() ? "invio lettura..." : "telemetria spenta");
}
