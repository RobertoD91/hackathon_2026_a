"""Agenti delle imprese: pizzeria, friggitoria, gozzi, bar, museo (di fantasia).

Ogni impresa:
- pubblica offerte per le fasce poco piene (ore morte), con uno sconto;
- risponde alle prenotazioni degli assistenti personali: accetta, oppure fa una controproposta
  (altra fascia, con sconto se è un'ora morta), oppure rifiuta.
È la parte "nuovi servizi e business" del brief: la città sposta la folla, l'impresa riempie le ore vuote.
"""

from __future__ import annotations

import json

from .. import DATI
from ..bus import ora_da_secondi, secondi_da_ora
from .base import Agente

FASCIA = 30 * 60


class AgenteImprese(Agente):
    nome = "imprese"
    etichetta = "Imprese"

    def __init__(self, *a, **k) -> None:
        super().__init__(*a, **k)
        self.imprese = {i["id"]: i for i in json.loads((DATI / "imprese.json").read_text(encoding="utf-8"))["imprese"]}
        self.prenotati: dict[tuple[str, int], int] = {}

    def avvio(self) -> None:
        self.ascolta("napoli/imprese/+/richieste")
        self.ogni(30, self.pubblica_offerte)

    def _occupati(self, imp: dict, fascia: int) -> float:
        ora = str(fascia // 3600)
        base = imp["occupazione"].get(ora, 0.5) * imp["posti"]
        return base + self.prenotati.get((imp["id"], fascia), 0)

    def _liberi(self, imp: dict, fascia: int) -> int:
        return max(0, int(imp["posti"] - self._occupati(imp, fascia)))

    def _ora_morta(self, imp: dict, fascia: int) -> bool:
        return self._occupati(imp, fascia) < 0.5 * imp["posti"]

    def pubblica_offerte(self) -> None:
        offerte = []
        primo = (self.t // FASCIA + 1) * FASCIA
        for imp in self.imprese.values():
            for fascia in range(primo, primo + 4 * FASCIA, FASCIA):
                if self._ora_morta(imp, fascia) and self._liberi(imp, fascia) > 0:
                    offerte.append({"impresa": imp["id"], "nome": imp["nome"], "zona": imp["zona"], "tipo": imp["tipo"],
                                    "descrizione": imp["descrizione"], "ora": ora_da_secondi(fascia),
                                    "posti_liberi": self._liberi(imp, fascia), "sconto_pct": imp["sconto_ore_morte"]})
                    break
        self.bus.pubblica("napoli/imprese/offerte", {"ora": self.ora, "offerte": offerte}, trattieni=True)

    def gestisci(self, topic: str, m: dict) -> None:
        id_impresa = topic.split("/")[2]
        imp = self.imprese.get(id_impresa)
        if not imp:
            return
        persone = max(1, int(m.get("persone", 2)))
        try:
            richiesta = secondi_da_ora(m.get("ora") or ora_da_secondi(self.t + FASCIA))
        except ValueError:
            richiesta = self.t + FASCIA
        fascia = max(richiesta // FASCIA * FASCIA, (self.t // FASCIA + 1) * FASCIA)
        risposta = {"id_richiesta": m.get("id_richiesta"), "impresa": imp["id"], "nome": imp["nome"]}
        chi = m.get("da", "un assistente")
        if self._liberi(imp, fascia) >= persone:
            self.prenotati[(imp["id"], fascia)] = self.prenotati.get((imp["id"], fascia), 0) + persone
            sconto = imp["sconto_ore_morte"] if self._ora_morta(imp, fascia) else 0
            risposta.update(esito="accettata", ora=ora_da_secondi(fascia), sconto_pct=sconto,
                            testo=f"Confermato per {persone} alle {ora_da_secondi(fascia)}" + (f", con {sconto}% di sconto" if sconto else ""))
        else:
            alternativa = next((f for f in range(fascia + FASCIA, fascia + 5 * FASCIA, FASCIA)
                                if self._liberi(imp, f) >= persone), None)
            if alternativa is None:
                risposta.update(esito="rifiutata", testo="Siamo pieni per le prossime due ore, mi dispiace")
            else:
                sconto = imp["sconto_ore_morte"] if self._ora_morta(imp, alternativa) else 0
                risposta.update(esito="controproposta", ora=ora_da_secondi(alternativa), sconto_pct=sconto,
                                testo=f"Alle {ora_da_secondi(fascia)} siamo pieni. Alle {ora_da_secondi(alternativa)} c'è posto per {persone}"
                                      + (f", e vi facciamo il {sconto}% di sconto" if sconto else ""))
        self.bus.pubblica(f"napoli/imprese/{imp['id']}/risposte", risposta)
        self.di(chi, risposta["testo"], da=imp["nome"])

    def conferma(self, id_impresa: str, ora: str, persone: int) -> None:
        """Usata dall'assistente quando l'utente accetta una controproposta."""
        fascia = secondi_da_ora(ora) // FASCIA * FASCIA
        self.prenotati[(id_impresa, fascia)] = self.prenotati.get((id_impresa, fascia), 0) + persone
