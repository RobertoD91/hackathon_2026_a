// Test sul PC del contapersone (overlay/main/badge/contapersone.c): finestra scorrevole delle
// pressioni della rotella SU.
//   cc -std=c11 -Wall -Wextra -I../overlay/main/badge contapersone_host_test.c ../overlay/main/badge/contapersone.c

#include <stdio.h>

#include "contapersone.h"

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

#define S(x) ((int64_t)(x) * 1000000)  // secondi → microsecondi

int main(void) {
    contapersone_t c;
    contapersone_init(&c, 600);
    CHECK(contapersone_conta(&c, S(0)) == 0, "vuoto");

    // tre pressioni ravvicinate (l'orologio di esp_timer parte da 0 all'accensione)
    contapersone_aggiungi(&c, S(10));
    contapersone_aggiungi(&c, S(11));
    contapersone_aggiungi(&c, S(12));
    CHECK(contapersone_conta(&c, S(12)) == 3, "tre pressioni");
    contapersone_aggiungi(&c, S(300));
    CHECK(contapersone_conta(&c, S(609)) == 4, "tutte nella finestra di 600 s");
    // la prima esce dopo 600 s esatti, le altre una alla volta
    CHECK(contapersone_conta(&c, S(610)) == 3, "la prima esce a 610 s: %d", contapersone_conta(&c, S(610)));
    CHECK(contapersone_conta(&c, S(612)) == 1, "restano solo quelle recenti");
    CHECK(contapersone_conta(&c, S(900)) == 0, "dopo la finestra non resta nulla");

    // azzera
    contapersone_aggiungi(&c, S(1000));
    contapersone_aggiungi(&c, S(1001));
    contapersone_azzera(&c);
    CHECK(contapersone_conta(&c, S(1002)) == 0, "azzerato");
    contapersone_aggiungi(&c, S(1003));
    CHECK(contapersone_conta(&c, S(1003)) == 1, "riparte dopo l'azzeramento");

    // più pressioni di quante ne ricordi: il conteggio si ferma a CONTAPERSONE_MAX e l'anello resta coerente
    contapersone_init(&c, 600);
    for (int i = 0; i < CONTAPERSONE_MAX + 40; i++) contapersone_aggiungi(&c, S(2000) + i * 1000);
    CHECK(contapersone_conta(&c, S(2001)) == CONTAPERSONE_MAX, "saturazione: %d", contapersone_conta(&c, S(2001)));
    CHECK(contapersone_conta(&c, S(2600) + 39999) == CONTAPERSONE_MAX, "le 40 più vecchie sono già dimenticate");
    CHECK(contapersone_conta(&c, S(2700)) == 0, "poi la finestra si svuota");

    // finestra minima 1 s
    contapersone_init(&c, 0);
    contapersone_aggiungi(&c, S(5));
    CHECK(contapersone_conta(&c, S(5) + 999999) == 1 && contapersone_conta(&c, S(6)) == 0, "finestra di 1 s");

    if (failures) {
        fprintf(stderr, "contapersone: %d controlli falliti\n", failures);
        return 1;
    }
    fprintf(stderr, "contapersone: tutti i controlli superati\n");
    return 0;
}
