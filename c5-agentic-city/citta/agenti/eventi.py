"""Agente Eventi: conosce il calendario (navi, regata, partita) e prevede i flussi di persone.

Pubblica in anticipo (fino a 60 minuti prima) cosa sta per succedere e dove,
così gli altri agenti si preparano invece di inseguire.
"""

from __future__ import annotations

from ..bus import secondi_da_ora
from .base import Agente, numero

ANTICIPO = 60 * 60


class AgenteEventi(Agente):
    nome = "eventi"
    etichetta = "Eventi"

    def __init__(self, *a, **k) -> None:
        super().__init__(*a, **k)
        self.annunciati: set[str] = set()
        self.iniziati: set[str] = set()
        self.finiti: set[str] = set()
        self.conclusi: set[str] = set()
        self.regata_ok = True

    def avvio(self) -> None:
        self.ascolta("napoli/eventi/manuale")
        self.ascolta("napoli/meteo")
        self.ogni(1, self.controlla)

    def gestisci(self, topic: str, m: dict) -> None:
        if topic == "napoli/meteo":
            self.regata_ok = bool(m.get("regata_ok", True))
        elif topic == "napoli/eventi/manuale":
            nome = m.get("evento", "evento")
            self.di("Orchestratore", f"Segnalazione dal campo: {nome.replace('_', ' ')}"
                    + (f" ({m['veicoli']} veicoli in arrivo)" if m.get("veicoli") else ""))

    def _previsione(self, e: dict, fase: str) -> dict:
        return {"id": e["id"], "nome": e["nome"], "tipo": e["tipo"], "fase": fase, "zona": e["zona"],
                "inizio": e["inizio"], "fine": e["fine"], "persone": e["persone"], "flussi": e["flussi"],
                "ora": self.ora}

    def controlla(self) -> None:
        for e in self.scenario["eventi"]:
            if e["tipo"] == "regata" and not self.regata_ok:
                continue
            inizio, fine = secondi_da_ora(e["inizio"]), secondi_da_ora(e["fine"])
            anticipo = e.get("anticipo_min", 60) * 60
            if e["id"] not in self.annunciati and inizio - anticipo <= self.t < inizio:
                self.annunciati.add(e["id"])
                self.bus.pubblica("napoli/eventi/previsioni", self._previsione(e, "in_arrivo"))
                minuti = (inizio - self.t) // 60
                self.di("Orchestratore", f"Tra {minuti} minuti: {e['nome']}, circa {numero(e['persone'])} persone")
            if e["id"] not in self.iniziati and inizio <= self.t < fine:
                self.iniziati.add(e["id"])
                self.annunciati.add(e["id"])
                self.bus.pubblica("napoli/eventi/previsioni", self._previsione(e, "in_corso"))
                self.di("Tutti", f"Iniziato: {e['nome']}")
            # Il deflusso conta quanto l'arrivo: avvisiamo 20 minuti prima della fine.
            if e["id"] in self.iniziati and e["id"] not in self.finiti and self.t >= fine - 20 * 60:
                self.finiti.add(e["id"])
                self.bus.pubblica("napoli/eventi/previsioni", self._previsione(e, "deflusso"))
                self.di("Orchestratore", f"Tra 20 minuti finisce: {e['nome']}. Preparare il deflusso.")
            if e["id"] in self.finiti and e["id"] not in self.conclusi and self.t >= fine + 45 * 60:
                self.conclusi.add(e["id"])
                self.bus.pubblica("napoli/eventi/conclusi", {"id": e["id"], "nome": e["nome"], "ora": self.ora})
