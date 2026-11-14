// contapersone: pressioni del pulsante in una finestra scorrevole (vedi contapersone.h).

#include "contapersone.h"

#include <string.h>

void contapersone_init(contapersone_t *c, int finestra_s) {
    memset(c, 0, sizeof(*c));
    c->finestra_us = (int64_t)(finestra_s < 1 ? 1 : finestra_s) * 1000000;
}

void contapersone_aggiungi(contapersone_t *c, int64_t ora_us) {
    c->quando[c->prossima] = ora_us;
    c->prossima = (c->prossima + 1) % CONTAPERSONE_MAX;
    if (c->n < CONTAPERSONE_MAX) c->n++;
}

int contapersone_conta(contapersone_t *c, int64_t ora_us) {
    // Le pressioni sono in ordine di tempo: la più vecchia è n posizioni prima di "prossima".
    while (c->n > 0) {
        int piu_vecchia = (c->prossima - c->n + CONTAPERSONE_MAX) % CONTAPERSONE_MAX;
        if (ora_us - c->quando[piu_vecchia] < c->finestra_us) break;
        c->n--;
    }
    return c->n;
}

void contapersone_azzera(contapersone_t *c) {
    c->n = 0;
    c->prossima = 0;
}
