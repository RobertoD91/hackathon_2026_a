#!/usr/bin/env python3
"""Prepara i dati del visore 3D (scena.json e regata.json) accanto a index.html.

Usa così come sono gli strumenti del video (strumenti/video3d/scena.py ed esporta.py), senza modificarli:
  python visore3d/prepara_dati.py --osm lungomare.osm            # dalla cartella c5-agentic-city
L'estratto OSM si scarica con:
  curl -o lungomare.osm "https://api.openstreetmap.org/api/0.6/map?bbox=14.222,40.828,14.258,40.842"

regata.json contiene un fotogramma ogni --passo secondi simulati (default 30) tra --da e --a:
veicoli (posizione e stato), folla per zona, ultime righe del dialogo tra agenti, evento e piano dei semafori.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

QUI = Path(__file__).resolve().parent
C5 = QUI.parent


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--osm", help="estratto OpenStreetMap del lungomare (serve solo per rigenerare scena.json)")
    p.add_argument("--da", default="13:35")
    p.add_argument("--a", default="14:50")
    p.add_argument("--passo", type=int, default=30)
    a = p.parse_args()

    if a.osm:
        subprocess.run([sys.executable, str(C5 / "strumenti/video3d/scena.py"), "--osm", a.osm,
                        "--uscita", str(QUI / "scena.json")], check=True)

    with tempfile.TemporaryDirectory() as cartella:
        grezzo = Path(cartella) / "regata.ndjson"
        subprocess.run([sys.executable, str(C5 / "strumenti/video3d/esporta.py"), "--da", a.da, "--a", a.a,
                        "--passo", str(a.passo), "--uscita", str(grezzo)], check=True)
        fotogrammi = []
        for riga in grezzo.read_text(encoding="utf-8").splitlines():
            f = json.loads(riga)
            fotogrammi.append({
                "t": f["t"], "ora": f["ora"],
                "v": [[round(x, 5), round(y, 5), c] for x, y, c in f["v"]],
                "folla": f["folla"],
                "dialogo": f["dialogo"][-3:],
                "evento": f["evento"], "piano": f["piano"],
            })
        meta = json.loads((Path(str(grezzo) + ".meta.json")).read_text(encoding="utf-8"))
    uscita = {"da": a.da, "a": a.a, "passo_s": a.passo, "riepilogo": meta.get("finale", ""),
              "nota": "Simulazione TwinCiro: folla e traffico sono simulati (agenti con regole, gemello SUMO su strade OSM); "
                      "percorso delle barche ipotizzato.",
              "fotogrammi": fotogrammi}
    (QUI / "regata.json").write_text(json.dumps(uscita, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{len(fotogrammi)} fotogrammi → {QUI / 'regata.json'}")


if __name__ == "__main__":
    main()
