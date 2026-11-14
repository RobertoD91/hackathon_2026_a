// telemetry_ui: schermata "SENSORI" del badge (LVGL v7), aggiunta alla rotazione di ui.c.
//
//   SU (rotella in su / centro sinistro)  → contapersone +1 (napoli/sensori/<id>/persone, subito)
//   GIU (rotella in giu / centro destro)  → azzera il contapersone (e pubblica 0)
//   pressione lunga                       → schermata successiva/precedente (come le altre)

#pragma once

#include <stdbool.h>

#include "lvgl.h"

/** Crea la schermata (chiamata da ui_init nel task della UI). */
lv_obj_t *telemetry_ui_create(void);

/** Attiva/disattiva l'aggiornamento periodico (solo quando la schermata è visibile). */
void telemetry_ui_set_active(bool active);

void telemetry_ui_button_up(void);
void telemetry_ui_button_down(void);
