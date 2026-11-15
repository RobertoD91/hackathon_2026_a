"""Misure vere dei dispositivi di TwinCIRO (badge WHY2025 e scheda Tasmota), lette dal bus.

Formato unico (vedi firmware/README.md nella radice della repo):
- letture  napoli/sensori/<id>/<grandezza>   {"zona": "rotonda_diaz", "valore": 21.5}
           (grandezze: temperatura, umidita, luce, pressione, persone; persone anche con "moltiplicatore")
- stato    napoli/nodi/<id>/stato, trattenuto  {"online": true, "ruolo": "badge|tasmota", "zona", "versione", "ip", "rssi"}
           con last will {"online": false}; per Tasmota l'offline arriva su napoli/nodi/<id>/tele/LWT ("Offline").

Tiene l'ultimo valore per dispositivo e grandezza, con l'ora (reale) in cui la città l'ha ricevuto:
lo usano la sala (pannello "Sensori reali") e GET /stato dell'API. Le persone le conta l'agente Folla.
"""

from __future__ import annotations

import math
import threading
import time

from .bus import Bus

UNITA = {"temperatura": "°C", "umidita": "%", "luce": "lux", "pressione": "hPa", "persone": ""}


def numero_valido(v) -> bool:
    """Un numero vero: niente testo, booleani, null, NaN o infinito (i messaggi dei dispositivi possono essere rotti)."""
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def fa(secondi: float) -> str:
    """Da quanto tempo, in breve: "adesso", "40 s fa", "3 min fa", "2 h fa"."""
    s = int(secondi)
    if s < 5:
        return "adesso"
    if s < 60:
        return f"{s} s fa"
    if s < 3600:
        return f"{s // 60} min fa"
    return f"{s // 3600} h fa"


class SensoriReali:
    def __init__(self, bus: Bus) -> None:
        self.letture: dict[str, dict[str, dict]] = {}  # id → grandezza → ultima lettura
        self.nodi: dict[str, dict] = {}  # id → ultimo stato
        self.lwt: dict[str, bool] = {}  # id → online secondo tele/LWT di Tasmota
        self.lock = threading.Lock()
        bus.iscriviti("napoli/sensori/+/+", self._lettura)
        bus.iscriviti("napoli/nodi/+/stato", self._stato)
        bus.iscriviti("napoli/nodi/+/tele/LWT", self._lwt)

    def _lettura(self, topic: str, m: dict) -> None:
        _, _, nodo, grandezza = topic.split("/")
        if not numero_valido(m.get("valore")):
            return
        with self.lock:
            self.letture.setdefault(nodo, {})[grandezza] = {**m, "ricevuto": time.time()}

    def _stato(self, topic: str, m: dict) -> None:
        # Il last will porta solo {"online": false}: ruolo e zona restano quelli dell'ultimo stato.
        nodo = topic.split("/")[2]
        with self.lock:
            self.nodi[nodo] = {**self.nodi.get(nodo, {}), **m, "ricevuto": time.time()}

    def _lwt(self, topic: str, m: dict) -> None:
        with self.lock:
            self.lwt[topic.split("/")[2]] = str(m.get("testo", "")).strip().lower() != "offline"

    def online(self, nodo: str) -> bool | None:
        """True/False dallo stato del nodo (e da tele/LWT per Tasmota); None se non si è mai annunciato."""
        with self.lock:
            stato, lwt = self.nodi.get(nodo), self.lwt.get(nodo)
        if stato is None and lwt is None:
            return None
        return bool((stato or {}).get("online", True)) and lwt is not False

    def stato(self) -> dict:
        """{"sensori": {id: {grandezza: {...}}}, "nodi": {id: {...}}} con secondi_fa al posto dell'ora di arrivo."""
        adesso = time.time()

        def con_eta(m: dict) -> dict:
            d = {k: v for k, v in m.items() if k != "ricevuto"}
            d["secondi_fa"] = round(adesso - m["ricevuto"])
            return d

        with self.lock:
            sensori = {n: {g: con_eta(m) for g, m in sorted(gr.items())} for n, gr in sorted(self.letture.items())}
            nodi = {n: con_eta(m) for n, m in sorted(self.nodi.items())}
            for n in self.lwt:
                nodi.setdefault(n, {"ruolo": "tasmota"})
        for n in nodi:
            nodi[n]["online"] = self.online(n)
        return {"sensori": sensori, "nodi": nodi}
