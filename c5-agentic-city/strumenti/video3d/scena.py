#!/usr/bin/env python3
"""Costruisce la scena 3D statica per il video della regata (edifici, terraferma, strade, zone, percorso di regata).

Fonte: estratto OpenStreetMap del lungomare (lo stesso da cui è stata generata la rete SUMO).
  python strumenti/video3d/scena.py --osm lungomare.osm --uscita scena.json

Altezze degli edifici: da height o building:levels quando ci sono (pochi in OSM),
altrimenti stimate tra 4 e 8 piani (palazzi napoletani), in modo deterministico dall'id.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

import sumolib  # noqa: E402

from citta import DATI  # noqa: E402

# Percorso di regata stimato (ipotesi): campo davanti a via Caracciolo, lato a lato tra Mergellina e Castel dell'Ovo.
BOE = [(14.2275, 40.8268), (14.2440, 40.8248)]


def r5(v: float) -> float:
    return round(v, 6)


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--osm", required=True)
    p.add_argument("--uscita", required=True)
    a = p.parse_args()

    radice = ET.parse(a.osm).getroot()
    nodi = {n.get("id"): (float(n.get("lon")), float(n.get("lat"))) for n in radice.iter("node")}
    edifici, costa = [], []
    for w in radice.iter("way"):
        tag = {t.get("k"): t.get("v") for t in w.iter("tag")}
        rif = [x.get("ref") for x in w.iter("nd")]
        if "building" in tag and len(rif) >= 4:
            punti = [[r5(nodi[r][0]), r5(nodi[r][1])] for r in rif if r in nodi]
            if len(punti) < 4:
                continue
            try:
                h = float(tag.get("height", "").replace("m", "").strip())
            except ValueError:
                h = None
            if h is None and tag.get("building:levels", "").isdigit():
                h = 3.3 * int(tag["building:levels"])
            if h is None:
                h = 3.3 * (4 + int(w.get("id")) % 5)
            edifici.append({"p": punti, "h": round(min(h, 120), 1),
                            "chiesa": tag.get("building") in ("church", "cathedral") or tag.get("amenity") == "place_of_worship"})
        if tag.get("natural") == "coastline":
            costa.append(rif)

    # Terraferma: la costa (terra a sinistra del verso del tratto) chiusa verso nord.
    inizio = {c[0]: c for c in costa}
    fine = {c[-1] for c in costa}
    primo = next(c for c in costa if c[0] not in fine)
    catena, cur = list(primo), primo
    while catena[-1] in inizio and inizio[catena[-1]] is not cur:
        cur = inizio[catena[-1]]
        catena += cur[1:]
    linea = [[r5(nodi[n][0]), r5(nodi[n][1])] for n in catena if n in nodi]
    nord = max(p[1] for p in linea) + 0.03
    terra = linea + [[linea[-1][0], nord], [linea[0][0], nord]]

    # Strade dalla rete SUMO (solo quelle percorribili dalle auto), in lon/lat.
    net = sumolib.net.readNet(str(DATI / "lungomare.net.xml"))
    strade = []
    for e in net.getEdges():
        if not e.allows("passenger"):
            continue
        forma = [list(map(r5, net.convertXY2LonLat(x, y))) for x, y in e.getShape()]
        strade.append({"p": forma, "w": round(e.getLaneNumber() * 3.3, 1)})

    scenario = json.loads((DATI / "scenario_regata.json").read_text(encoding="utf-8"))
    zone = {z: {"nome": v["nome"], "pos": [v["lon"], v["lat"]], "capienza": v["capienza"]} for z, v in scenario["zone"].items()}
    json.dump({"edifici": edifici, "terra": terra, "strade": strade, "zone": zone, "boe": BOE},
              open(a.uscita, "w"), separators=(",", ":"))
    print(f"{len(edifici)} edifici, {len(strade)} strade, costa {len(linea)} punti → {a.uscita}")


if __name__ == "__main__":
    main()
