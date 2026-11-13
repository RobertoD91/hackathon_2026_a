"""Agente Meteo & Mare: vento, onda e temperatura, e se la regata si può fare.

Fonte reale: Open-Meteo (meteo e mare, senza chiave). Con --meteo scenario usa i valori
dello scenario (demo stabile); con --meteo reale usa i dati di oggi e ripiega sullo
scenario se la rete non risponde.
"""

from __future__ import annotations

import json
import urllib.request

from .base import Agente

NAPOLI = (40.83, 14.24)
URL_METEO = ("https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}"
             "&hourly=wind_speed_10m,wind_gusts_10m,temperature_2m,precipitation"
             "&wind_speed_unit=kn&timezone=Europe%2FRome&forecast_days=1")
URL_MARE = ("https://marine-api.open-meteo.com/v1/marine?latitude={lat}&longitude={lon}"
            "&hourly=wave_height&timezone=Europe%2FRome&forecast_days=1")


def _scarica(url: str) -> dict | None:
    try:
        with urllib.request.urlopen(url.format(lat=NAPOLI[0], lon=NAPOLI[1]), timeout=8) as r:
            return json.load(r)
    except Exception as e:
        print(f"[meteo] Open-Meteo non raggiungibile: {e}")
        return None


def regata_possibile(m: dict) -> tuple[bool, str]:
    if m["vento_nodi"] < 6:
        return False, f"vento troppo debole ({m['vento_nodi']} nodi, servono almeno 6)"
    if m["vento_nodi"] > 22 or m["raffiche_nodi"] > 30:
        return False, f"vento troppo forte ({m['vento_nodi']} nodi, raffiche {m['raffiche_nodi']})"
    if m["onda_m"] > 1.8:
        return False, f"onda troppo alta ({m['onda_m']} m)"
    return True, f"vento {m['vento_nodi']} nodi, onda {m['onda_m']} m: condizioni buone"


class AgenteMeteo(Agente):
    nome = "meteo"
    etichetta = "Meteo&Mare"

    def __init__(self, *a, modalita: str = "scenario", **k) -> None:
        super().__init__(*a, **k)
        self.modalita = modalita
        self.orari: dict | None = None
        self.ultimo_esito: bool | None = None

    def avvio(self) -> None:
        if self.modalita == "reale":
            meteo, mare = _scarica(URL_METEO), _scarica(URL_MARE)
            if meteo and mare:
                h = meteo["hourly"]
                self.orari = {
                    "vento": h["wind_speed_10m"], "raffiche": h["wind_gusts_10m"],
                    "temperatura": h["temperature_2m"], "pioggia": h["precipitation"],
                    "onda": mare["hourly"]["wave_height"],
                }
        self.ogni(30, self.aggiorna)

    def _valori(self) -> tuple[dict, str]:
        if self.orari:
            ora = min(23, self.t // 3600)
            o = self.orari
            return ({"vento_nodi": round(o["vento"][ora] or 0), "raffiche_nodi": round(o["raffiche"][ora] or 0),
                     "onda_m": round(o["onda"][ora] or 0, 1), "temperatura_c": round(o["temperatura"][ora] or 0),
                     "pioggia_mm": o["pioggia"][ora] or 0}, "Open-Meteo (dati di oggi)")
        return dict(self.scenario["meteo_scenario"]), "scenario"

    def aggiorna(self) -> None:
        valori, fonte = self._valori()
        ok, motivo = regata_possibile(valori)
        self.bus.pubblica("napoli/meteo", {**valori, "regata_ok": ok, "motivo": motivo, "fonte": fonte,
                                           "ora": self.ora}, trattieni=True)
        if ok != self.ultimo_esito:
            self.ultimo_esito = ok
            testo = ("Regata confermata: " if ok else "Regata a rischio: ") + motivo
            self.di("Orchestratore", testo)
