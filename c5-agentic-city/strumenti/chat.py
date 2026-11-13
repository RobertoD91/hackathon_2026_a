#!/usr/bin/env python3
"""Chat da terminale con il proprio assistente personale (alternativa a WhatsApp/OpenClaw).

  python strumenti/chat.py --utente Marta
Gli avvisi proattivi della città compaiono con 📣 tra un messaggio e l'altro.
"""

from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from drone_osserva import chiama  # noqa: E402


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--utente", default="ospite")
    p.add_argument("--api", default=os.environ.get("C5_API", "http://localhost:8080"))
    a = p.parse_args()
    print(f"Assistente personale di {a.utente}. Scrivi un messaggio (vuoto per uscire).")
    while True:
        for n in chiama(a.api, f"/notifiche?utente={a.utente}").get("notifiche", []):
            print(f"📣 {n['testo']}")
        try:
            testo = input("> ").strip()
        except EOFError:
            break
        if not testo:
            break
        print(chiama(a.api, "/chiedi", {"utente": a.utente, "testo": testo})["risposta"])


if __name__ == "__main__":
    main()
