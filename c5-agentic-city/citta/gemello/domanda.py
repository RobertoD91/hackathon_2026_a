"""Domanda di traffico del gemello digitale, generata dallo scenario.

- Traffico di fondo tra le "porte" dell'area (ovest, est, nord), costante.
- Flussi degli eventi (navi, regata, deflusso, partita) nelle loro finestre orarie.

Le partenze sono casuali ma con seme fisso: le due simulazioni (con e senza agenti)
ricevono esattamente gli stessi veicoli.
"""

from __future__ import annotations

import json
import random
from pathlib import Path

from ..bus import secondi_da_ora

TIPI = """  <vType id="auto" vClass="passenger" speedFactor="normc(1,0.1,0.8,1.2)"/>
  <vType id="taxi" vClass="taxi" color="1,1,0"/>
"""


def _bordi(traffico: dict, nome: str) -> list[str]:
    if nome.startswith("zona:"):
        return traffico["destinazioni_zona"][nome[5:]]
    if nome in traffico["porte"]:
        return traffico["porte"][nome]
    return traffico["destinazioni_zona"][nome]


def genera(scenario: dict, file_uscita: Path) -> int:
    traffico = scenario["traffico"]
    rnd = random.Random(traffico["seme"])
    inizio = secondi_da_ora(scenario["inizio"])
    fine = secondi_da_ora(scenario["fine"])
    viaggi: list[tuple[float, str, str, str, str]] = []

    # Traffico di fondo: coppie porta d'ingresso → porta d'uscita (senza inversioni sul posto).
    porte = traffico["porte"]
    coppie = [("ovest_in", "est_out", 3), ("ovest_in", "nord_out", 1), ("est_in", "ovest_out", 3),
              ("est_in", "nord_out", 1), ("nord_in", "ovest_out", 1), ("nord_in", "est_out", 1)]
    peso_totale = sum(p for _, _, p in coppie)
    t = float(inizio)
    scala = traffico.get("scala", 1.0)
    periodo = 3600 / (traffico["fondo_veicoli_ora"] * scala)
    while t < fine:
        t += rnd.expovariate(1 / periodo)
        x = rnd.uniform(0, peso_totale)
        for da, a, p in coppie:
            x -= p
            if x <= 0:
                break
        viaggi.append((t, rnd.choice(porte[da]), rnd.choice(porte[a]), "auto", "fondo"))

    # Flussi degli eventi.
    for i, flusso in enumerate(traffico["flussi_evento"]):
        t = float(secondi_da_ora(flusso["da"]))
        t_fine = secondi_da_ora(flusso["a"])
        periodo = 3600 / (flusso["veicoli_ora"] * scala)
        while True:
            t += rnd.expovariate(1 / periodo)
            if t >= t_fine:
                break
            origine = rnd.choice(_bordi(traffico, rnd.choice(flusso["origini"])))
            destinazione = rnd.choice(_bordi(traffico, rnd.choice(flusso["destinazioni"])))
            if origine == destinazione:
                continue
            tipo = "taxi" if "nave" in flusso["nome"].lower() or "croceristi" in flusso["nome"].lower() else "auto"
            viaggi.append((t, origine, destinazione, tipo, f"evento{i}"))

    viaggi.sort()
    righe = ['<?xml version="1.0" encoding="UTF-8"?>', "<routes>", TIPI.rstrip()]
    for n, (t, da, a, tipo, gruppo) in enumerate(viaggi):
        righe.append(f'  <trip id="{gruppo}_{n}" type="{tipo}" depart="{t:.1f}" from="{da}" to="{a}" '
                     f'departLane="best" departSpeed="max"/>')
    righe.append("</routes>")
    file_uscita.write_text("\n".join(righe), encoding="utf-8")
    return len(viaggi)


if __name__ == "__main__":
    import sys

    from .. import DATI

    scenario = json.loads((DATI / "scenario_regata.json").read_text(encoding="utf-8"))
    uscita = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/domanda.rou.xml")
    print(genera(scenario, uscita), "viaggi in", uscita)
