#!/usr/bin/env python3
"""Screenshot di sumo-gui: "oggi" (semafori fissi) e "con agenti" affiancati alla stessa ora.

I veicoli sono colorati per velocità: rosso = fermo, arancione = lento, bianco = scorre.
Serve un display: sul portatile basta lanciarlo, in un server senza schermo usare Xvfb:

  xvfb-run -s "-screen 0 1920x1080x24" python strumenti/screenshot_sumo.py --ore 14:40,17:50,19:30

Le immagini vanno in media/ (una panoramica e uno zoom per ogni ora).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import sumolib  # noqa: E402
from PIL import Image, ImageDraw, ImageFont  # noqa: E402

from citta import CARTELLA, DATI  # noqa: E402
from citta.bus import secondi_da_ora  # noqa: E402
from citta.gemello.gemello import Simulazione, prepara_domanda  # noqa: E402

VISTA = "View #0"
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT_N = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
# Zone da inquadrare (lon_min, lat_min, lon_max, lat_max)
INQUADRATURE = {
    "panoramica": (14.2215, 40.8270, 14.2585, 40.8430),
    "chiaia": (14.2290, 40.8320, 14.2420, 40.8375),
    "porto": (14.2440, 40.8340, 14.2585, 40.8420),
}


def colora(sim: Simulazione) -> int:
    fermi = 0
    for v in sim.c.vehicle.getIDList():
        s = sim.c.vehicle.getSpeed(v)
        if s < 0.5:
            fermi += 1
            sim.c.vehicle.setColor(v, (230, 30, 30, 255))
        elif s < 5:
            sim.c.vehicle.setColor(v, (255, 150, 0, 255))
        else:
            sim.c.vehicle.setColor(v, (240, 240, 240, 255))
    return fermi


def inquadra(sim: Simulazione, net, nome: str) -> None:
    lo1, la1, lo2, la2 = INQUADRATURE[nome]
    x1, y1 = net.convertLonLat2XY(lo1, la1)
    x2, y2 = net.convertLonLat2XY(lo2, la2)
    sim.c.gui.setBoundary(VISTA, x1, y1, x2, y2)


def etichetta(img: Image.Image, titolo: str, righe: list[str], colore: tuple) -> Image.Image:
    d = ImageDraw.Draw(img)
    f1, f2 = ImageFont.truetype(FONT, 34), ImageFont.truetype(FONT_N, 24)
    d.rectangle([0, 0, img.width, 60 + 32 * len(righe)], fill=(15, 23, 42))
    d.text((20, 12), titolo, font=f1, fill=colore)
    for i, r in enumerate(righe):
        d.text((20, 58 + 32 * i), r, font=f2, fill=(226, 232, 240))
    return img


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--ore", default="14:40,17:50,19:30")
    p.add_argument("--viste", default="panoramica,chiaia,porto")
    p.add_argument("--uscita", default=str(CARTELLA / "media"))
    p.add_argument("--larghezza", type=int, default=1400)
    p.add_argument("--altezza", type=int, default=900)
    a = p.parse_args()
    uscita = Path(a.uscita)
    uscita.mkdir(parents=True, exist_ok=True)
    ore = sorted(secondi_da_ora(o) for o in a.ore.split(","))
    viste = a.viste.split(",")

    scenario = json.loads((DATI / "scenario_regata.json").read_text(encoding="utf-8"))
    incroci = json.loads((DATI / "incroci.json").read_text(encoding="utf-8"))
    piani = json.loads((DATI / "piani_registrati.json").read_text(encoding="utf-8"))["piani"]
    inizio = secondi_da_ora(scenario["inizio"])
    net = sumolib.net.readNet(str(DATI / "lungomare.net.xml"))
    with tempfile.TemporaryDirectory() as cartella:
        percorsi = prepara_domanda(scenario, Path(cartella))
        oggi = Simulazione("gui_oggi", percorsi, inizio, adattiva=False, quota_assistiti=0, gui=True, net=net, incroci=incroci)
        agenti = Simulazione("gui_agenti", percorsi, inizio, adattiva=True, quota_assistiti=0, gui=True, net=net, incroci=incroci)
        for sim in (oggi, agenti):
            sim.c.gui.setSchema(VISTA, "napoli")
        prossimo, t = 0, float(inizio)
        for ora in ore:
            while t < ora:
                while prossimo < len(piani) and secondi_da_ora(piani[prossimo]["ora"]) <= t:
                    agenti.imposta_piano(piani[prossimo]["pesi"], piani[prossimo]["verde_max"])
                    prossimo += 1
                oggi.passo()
                t = agenti.passo()
            fermi = {"oggi": colora(oggi), "agenti": colora(agenti)}
            for vista in viste:
                file = {}
                for sim in (oggi, agenti):
                    inquadra(sim, net, vista)
                # l'inquadratura si applica al ridisegno: un passo, poi di nuovo inquadra e scatta
                oggi.passo()
                t = agenti.passo()
                for nome, sim in (("oggi", oggi), ("agenti", agenti)):
                    inquadra(sim, net, vista)
                    file[nome] = Path(cartella) / f"{nome}.png"
                    sim.c.gui.screenshot(VISTA, str(file[nome]))
                # lo screenshot viene salvato al passo successivo
                oggi.passo()
                t = agenti.passo()
                k_oggi, k_ag = oggi.kpi(), agenti.kpi()
                hh = f"{int(ora) // 3600:02d}:{int(ora) % 3600 // 60:02d}"
                sx = etichetta(Image.open(file["oggi"]).convert("RGB"), f"OGGI · semafori fissi · {hh}",
                               [f"veicoli fermi ora: {fermi['oggi']}",
                                f"ore perse in coda da inizio giornata: {k_oggi['ore_perse_in_coda']:g}"], (248, 113, 113))
                dx = etichetta(Image.open(file["agenti"]).convert("RGB"), f"CON AGENTI · {hh}",
                               [f"veicoli fermi ora: {fermi['agenti']}",
                                f"ore perse in coda da inizio giornata: {k_ag['ore_perse_in_coda']:g}"], (74, 222, 128))
                tela = Image.new("RGB", (sx.width + dx.width + 12, sx.height), (15, 23, 42))
                tela.paste(sx, (0, 0))
                tela.paste(dx, (sx.width + 12, 0))
                nome_file = uscita / f"sumo_{hh.replace(':', '')}_{vista}.png"
                tela.save(nome_file, optimize=True)
                print(nome_file, flush=True)
        oggi.chiudi()
        agenti.chiudi()
    os._exit(0)


if __name__ == "__main__":
    main()
