#!/usr/bin/env python3
"""Taratura del controllo semaforico degli agenti, senza far girare tutti gli agenti.

Rigioca i piani dell'agente Traffico registrati in una giornata (dati/piani_registrati.json)
su una sola simulazione SUMO, per ogni variante di parametri, in parallelo sui core disponibili.
Il riferimento "oggi" (semafori fissi) si calcola una volta sola.

  python strumenti/taratura.py                       # griglia predefinita
  python strumenti/taratura.py --varianti '[{"forza_pesi":0.5,"verde_max":60}]'
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

GRIGLIA = [
    {"nome": "piano registrato (attuale)", "forza_pesi": 1.0},
    {"nome": "piano neutro", "forza_pesi": 0.0, "verde_max": 60},
    {"nome": "pesi interi, verde max 60", "forza_pesi": 1.0, "verde_max": 60},
    {"nome": "pesi ×0.5", "forza_pesi": 0.5},
    {"nome": "pesi ×0.5, verde max 60", "forza_pesi": 0.5, "verde_max": 60},
    {"nome": "pesi ×0.3, verde max 60", "forza_pesi": 0.3, "verde_max": 60},
    {"nome": "neutro, verde max 45", "forza_pesi": 0.0, "verde_max": 45},
    {"nome": "neutro, soglia 1.15", "forza_pesi": 0.0, "verde_max": 60, "soglia": 1.15},
]


def esegui(variante: dict) -> dict:
    import sumolib

    from citta import DATI
    from citta.bus import secondi_da_ora
    from citta.gemello.gemello import Simulazione, prepara_domanda

    scenario = json.loads((DATI / "scenario_regata.json").read_text(encoding="utf-8"))
    if "seme" in variante:
        scenario["traffico"]["seme"] = variante["seme"]
    incroci = json.loads((DATI / "incroci.json").read_text(encoding="utf-8"))
    piani = json.loads((DATI / "piani_registrati.json").read_text(encoding="utf-8"))["piani"]
    inizio, fine = secondi_da_ora(scenario["inizio"]), secondi_da_ora(scenario["fine"])
    with tempfile.TemporaryDirectory() as cartella:
        percorsi = prepara_domanda(scenario, Path(cartella))
        net = sumolib.net.readNet(str(DATI / "lungomare.net.xml"))
        oggi = variante.get("oggi", False)
        sim = Simulazione(f"tar{os.getpid()}", percorsi, inizio, adattiva=not oggi, quota_assistiti=0,
                          gui=False, net=net, incroci=incroci)
        for k in ("forza_pesi", "soglia", "verde_min"):
            if k in variante:
                setattr(sim, k, variante[k])
        prossimo = 0
        t = float(inizio)
        while t < fine:
            while prossimo < len(piani) and secondi_da_ora(piani[prossimo]["ora"]) <= t:
                sim.pesi = dict(piani[prossimo]["pesi"])
                sim.verde_max = variante.get("verde_max", piani[prossimo]["verde_max"])
                prossimo += 1
            t = sim.passo()
        kpi = sim.kpi()
        sim.chiudi()
    return {**variante, **{k: kpi[k] for k in ("ore_perse_in_coda", "durata_media_s", "co2_kg", "arrivati")}}


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--varianti", help="lista JSON di varianti")
    p.add_argument("--processi", type=int, default=os.cpu_count() or 2)
    p.add_argument("--semi", default="", help="semi della domanda separati da virgola: ripete tutto per ognuno")
    a = p.parse_args()
    base = json.loads(a.varianti) if a.varianti else GRIGLIA
    semi = [int(s) for s in a.semi.split(",")] if a.semi else [None]
    varianti = []
    for s in semi:
        extra = {} if s is None else {"seme": s}
        varianti += [{"nome": "OGGI (semafori fissi)", "oggi": True, **extra}] + [{**v, **extra} for v in base]
    with ProcessPoolExecutor(a.processi) as ex:
        risultati = list(ex.map(esegui, varianti))
    rif_per_seme = {r.get("seme"): r for r in risultati if r.get("oggi")}
    print(f"{'variante':36} {'seme':>5} {'ore coda':>9} {'Δ':>7} {'durata':>7} {'Δ':>6} {'CO2 t':>6} {'Δ':>6}")
    for r in risultati:
        rif = rif_per_seme[r.get("seme")]
        d = lambda k: 100 * (rif[k] - r[k]) / rif[k]
        print(f"{r.get('nome', str(r)):36} {str(r.get('seme', 42)):>5} {r['ore_perse_in_coda']:9.1f} {-d('ore_perse_in_coda'):+6.1f}% "
              f"{r['durata_media_s']:7.1f} {-d('durata_media_s'):+5.1f}% {r['co2_kg']/1000:6.2f} {-d('co2_kg'):+5.1f}%")
    os._exit(0)


if __name__ == "__main__":
    main()
