#!/usr/bin/env python3
"""Comandi dell'operatore della sala operativa e pulsanti virtuali del plastico.

  python strumenti/operatore.py approva D3
  python strumenti/operatore.py blocca D3
  python strumenti/operatore.py evento pullman --veicoli 25 --da est_in --a ovest_out
  python strumenti/operatore.py stato
"""

from __future__ import annotations

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from drone_osserva import chiama  # noqa: E402


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--api", default=os.environ.get("C5_API", "http://localhost:8080"))
    sotto = p.add_subparsers(dest="comando", required=True)
    for c in ("approva", "blocca"):
        sotto.add_parser(c).add_argument("decisione")
    ev = sotto.add_parser("evento")
    ev.add_argument("nome")
    ev.add_argument("--veicoli", type=int, default=0)
    ev.add_argument("--da", default="est_in")
    ev.add_argument("--a", default="ovest_out")
    sotto.add_parser("stato")
    a = p.parse_args()
    if a.comando in ("approva", "blocca"):
        chiama(a.api, "/operatore", {"decisione": a.decisione, "esito": a.comando})
    elif a.comando == "evento":
        chiama(a.api, "/evento", {"evento": a.nome, "veicoli": a.veicoli, "da": a.da, "a": a.a})
    else:
        print(json.dumps(chiama(a.api, "/stato"), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
