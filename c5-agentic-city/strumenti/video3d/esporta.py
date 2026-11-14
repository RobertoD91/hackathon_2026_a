#!/usr/bin/env python3
"""Esporta i fotogrammi del video 3D: la giornata gira con gli agenti veri, si registra solo la finestra scelta.

  python strumenti/video3d/esporta.py --da 13:35 --a 14:50 --passo 2 --uscita fotogrammi.ndjson

Per ogni fotogramma: posizione e stato dei veicoli della simulazione "con agenti" (lon/lat),
veicoli fermi e ore perse in coda dall'inizio della finestra nelle due simulazioni, folla per zona,
ultime righe del dialogo tra agenti, evento in corso e piano dei semafori.
Scrive anche <uscita>.meta.json con il riepilogo per il cartello finale.
"""

from __future__ import annotations

import argparse
import collections
import json
import os
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

import numpy as np  # noqa: E402
import sumolib  # noqa: E402
import traci.constants as tc  # noqa: E402

from citta import DATI  # noqa: E402
from citta.agenti.eventi import AgenteEventi  # noqa: E402
from citta.agenti.folla import AgenteFolla  # noqa: E402
from citta.agenti.imprese import AgenteImprese  # noqa: E402
from citta.agenti.meteo import AgenteMeteo  # noqa: E402
from citta.agenti.orchestratore import Orchestratore  # noqa: E402
from citta.agenti.traffico import AgenteTraffico  # noqa: E402
from citta.agenti.turismo import AgenteTurismo  # noqa: E402
from citta.bus import BusMemoria, ora_da_secondi, secondi_da_ora  # noqa: E402
from citta.gemello.gemello import Simulazione, prepara_domanda  # noqa: E402
from citta.llm import crea_llm  # noqa: E402

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from video_demo import PilotaSimulato, evento_in_corso  # noqa: E402


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--da", default="13:35")
    p.add_argument("--a", default="14:50")
    p.add_argument("--passo", type=int, default=2, help="secondi simulati per fotogramma")
    p.add_argument("--llm", default="regole")
    p.add_argument("--uscita", required=True)
    a = p.parse_args()

    scenario = json.loads((DATI / "scenario_regata.json").read_text(encoding="utf-8"))
    incroci = json.loads((DATI / "incroci.json").read_text(encoding="utf-8"))
    inizio, da, fino = secondi_da_ora(scenario["inizio"]), secondi_da_ora(a.da), secondi_da_ora(a.a)
    net = sumolib.net.readNet(str(DATI / "lungomare.net.xml"))
    proj = net.getGeoProj()
    ox, oy = net.getLocationOffset()

    bus, llm = BusMemoria(), crea_llm(a.llm)
    agenti_citta = [cls(bus, llm, scenario) for cls in (AgenteMeteo, AgenteEventi, AgenteFolla, AgenteTraffico,
                                                         AgenteTurismo, AgenteImprese, Orchestratore)]
    for ag in agenti_citta:
        ag.start()
    pilota = PilotaSimulato(bus)
    dialogo: collections.deque = collections.deque(maxlen=6)
    bus.iscriviti("napoli/agenti/dialogo", lambda t, m: dialogo.append(m))

    with tempfile.TemporaryDirectory() as cartella, open(a.uscita, "w") as out:
        percorsi = prepara_domanda(scenario, Path(cartella))
        oggi = Simulazione("e_oggi", percorsi, inizio, adattiva=False, quota_assistiti=0, gui=False, net=net, incroci=incroci)
        agenti = Simulazione("e_agenti", percorsi, inizio, adattiva=True, quota_assistiti=0, gui=False, net=net, incroci=incroci)
        base = None
        t, n, t0 = float(inizio), 0, time.time()
        while t < fino:
            piano = bus.ultimo("napoli/semafori/piano")
            if piano:
                agenti.imposta_piano(piano.get("pesi", {}), piano.get("verde_max", 60))
            oggi.passo()
            t = agenti.passo()
            for v in agenti.c.simulation.getDepartedIDList():
                agenti.c.vehicle.subscribe(v, [tc.VAR_POSITION, tc.VAR_SPEED])
            if int(t) % 60 == 0:
                bus.pubblica("napoli/orologio", {"ora": ora_da_secondi(t), "t": int(t)}, trattieni=True)
                bus.pubblica("napoli/kpi", {"ora": ora_da_secondi(t), "oggi": oggi.kpi(), "agenti": agenti.kpi(),
                                            "risparmio_pct": {}}, trattieni=True)
                pilota.aggiorna(int(t))
                limite = time.time() + 3
                while time.time() < limite and any(not ag.coda.empty() for ag in agenti_citta):
                    time.sleep(0.005)
            if t < da or int(t - da) % a.passo:
                continue
            if base is None:
                base = (oggi.fermi_veicolo_s, agenti.fermi_veicolo_s)
            dati = agenti.c.vehicle.getAllSubscriptionResults()
            if dati:
                xy = np.array([d[tc.VAR_POSITION] for d in dati.values()], dtype=float)
                vel = np.array([d[tc.VAR_SPEED] for d in dati.values()], dtype=float)
                lon, lat = proj(xy[:, 0] - ox, xy[:, 1] - oy, inverse=True)
                classe = np.where(vel < 0.5, 2, np.where(vel < 5, 1, 0))
                veicoli = [[round(float(x), 6), round(float(y), 6), int(c)] for x, y, c in zip(lon, lat, classe)]
            else:
                veicoli = []
            fermi_oggi = oggi.fermi_ora
            folla = {m["zona"]: [m["persone"], m["livello"]] for m in bus.trattenuti("napoli/folla/+").values()}
            piano = bus.ultimo("napoli/semafori/piano") or {}
            testo_piano = " · ".join(f"{c} ×{p:g}" for c, p in piano.get("pesi", {}).items() if p != 1) or "normale"
            out.write(json.dumps({
                "t": int(t), "ora": ora_da_secondi(t), "v": veicoli,
                "fermi": [fermi_oggi, agenti.fermi_ora],
                "kpi": {"oggi": (oggi.fermi_veicolo_s - base[0]) / 3600, "agenti": (agenti.fermi_veicolo_s - base[1]) / 3600},
                "folla": folla, "dialogo": [{k: m.get(k, "") for k in ("ora", "da", "a", "testo")} for m in dialogo],
                "evento": evento_in_corso(scenario, int(t)), "piano": testo_piano,
            }, separators=(",", ":")) + "\n")
            n += 1
            if n % 300 == 0:
                print(f"{ora_da_secondi(t)} · {n} fotogrammi · {time.time() - t0:.0f}s", flush=True)
        ko = (oggi.fermi_veicolo_s - base[0]) / 3600
        ka = (agenti.fermi_veicolo_s - base[1]) / 3600
        oggi.chiudi()
        agenti.chiudi()
    delta = 100 * (ko - ka) / ko if ko else 0
    meta = {"inizio": a.da, "fine": a.a, "fotogrammi": n,
            "finale": f"ore perse in coda −{delta:.0f}%  ({ko:.0f} h → {ka:.0f} h)"}
    Path(a.uscita + ".meta.json").write_text(json.dumps(meta, ensure_ascii=False))
    print(json.dumps(meta, ensure_ascii=False), flush=True)
    os._exit(0)


if __name__ == "__main__":
    main()
