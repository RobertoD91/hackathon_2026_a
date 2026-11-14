// contapersone: il badge come "contapersone a mano" per l'agente Folla della città.
//
// Ogni pressione della rotella SU sulla schermata SENSORI conta un gruppo di persone visto nella
// zona del badge. Il badge pubblica su napoli/sensori/<id>/persone
//   {"zona":"<zona>","valore":<pressioni negli ultimi TELEMETRY_PERSONE_FINESTRA_S>,"moltiplicatore":M}
// e l'agente Folla di c5-agentic-city (citta/agenti/folla.py) aggiunge valore × moltiplicatore
// persone alla stima della zona. Le pressioni escono dalla finestra da sole; GIU azzera tutto.
//
// Modulo PORTABILE (solo C standard): il tempo arriva da fuori (microsecondi, es. esp_timer_get_time),
// così si prova sul PC (../../../test/contapersone_host_test.c).

#pragma once

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/** Pressioni ricordate al massimo: oltre, si dimentica la più vecchia (il conteggio resta 128). */
#define CONTAPERSONE_MAX 128

typedef struct {
    int64_t quando[CONTAPERSONE_MAX];  // istanti delle pressioni (us), in un anello
    int n;                             // pressioni nell'anello
    int prossima;                      // posizione della prossima scrittura
    int64_t finestra_us;
} contapersone_t;

/** Prepara il contatore; finestra in secondi (minimo 1). */
void contapersone_init(contapersone_t *c, int finestra_s);

/** Una pressione all'istante `ora_us`. */
void contapersone_aggiungi(contapersone_t *c, int64_t ora_us);

/** Pressioni negli ultimi finestra_s secondi rispetto a `ora_us` (dimentica quelle scadute). */
int contapersone_conta(contapersone_t *c, int64_t ora_us);

/** Dimentica tutte le pressioni. */
void contapersone_azzera(contapersone_t *c);

#ifdef __cplusplus
}
#endif
