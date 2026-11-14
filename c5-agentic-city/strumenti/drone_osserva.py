#!/usr/bin/env python3
"""Strumento del pilota del drone (umano nel loop).

  # aspetta le richieste di volo dell'orchestratore
  python strumenti/drone_osserva.py ascolta

  # invia una stima a occhio
  python strumenti/drone_osserva.py invia --zona rotonda_diaz --persone 18000

  # invia un frame del video (screenshot da DJI Fly o dal visore FPV): il modello di visione conta le persone
  python strumenti/drone_osserva.py foto --zona castel_ovo --file frame.jpg --scala 100

--scala: quante persone vere rappresenta ogni persona/statuina contata (su un modellino, per esempio 100).
Parla con la città tramite l'API HTTP (default http://localhost:8080), quindi funziona
sia con il bus in memoria sia con MQTT.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.request

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


def chiama(api: str, percorso: str, dati: dict | None = None) -> dict:
    richiesta = urllib.request.Request(api.rstrip("/") + percorso, method="POST" if dati is not None else "GET",
                                       data=json.dumps(dati).encode() if dati is not None else None,
                                       headers={"Content-Type": "application/json"})
    if os.environ.get("C5_API_TOKEN"):
        richiesta.add_header("Authorization", f"Bearer {os.environ['C5_API_TOKEN']}")
    with urllib.request.urlopen(richiesta, timeout=15) as r:
        return json.load(r)


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--api", default=os.environ.get("C5_API", "http://localhost:8080"))
    sotto = p.add_subparsers(dest="comando", required=True)
    sotto.add_parser("ascolta")
    inv = sotto.add_parser("invia")
    inv.add_argument("--zona", required=True)
    inv.add_argument("--persone", type=int, required=True)
    foto = sotto.add_parser("foto")
    foto.add_argument("--zona", required=True)
    foto.add_argument("--file", required=True)
    foto.add_argument("--scala", type=float, default=1.0)
    a = p.parse_args()

    if a.comando == "ascolta":
        ultima = None
        print("In ascolto delle richieste di volo (Ctrl+C per uscire)…")
        while True:
            r = chiama(a.api, "/drone/richieste").get("richiesta")
            if r and r != ultima:
                ultima = r
                print(f"\a\n🚁 {r.get('ora')} richiesta {r.get('decisione')}: vola su {r['zona']} — {r.get('motivo', '')}")
                print(f"   poi: python strumenti/drone_osserva.py foto --zona {r['zona']} --file frame.jpg --scala 1")
            time.sleep(2)
    elif a.comando == "invia":
        chiama(a.api, "/drone", {"zona": a.zona, "persone_stimate": a.persone, "note": "stima del pilota"})
        print("Osservazione inviata.")
    else:
        from citta.llm.claude import Claude

        esito = Claude().conta_persone(a.file, "Se è un modellino, conta le statuine." if a.scala > 1 else "")
        if not esito:
            sys.exit("Conteggio non riuscito: invia una stima con il comando 'invia'.")
        persone = int(esito["persone"] * a.scala)
        chiama(a.api, "/drone", {"zona": a.zona, "persone_stimate": persone, "densita": esito["densita"],
                                 "note": esito["note"], "foto": os.path.basename(a.file)})
        print(f"Contate {esito['persone']} (× {a.scala:g} = {persone}). {esito['note']}")


if __name__ == "__main__":
    main()
