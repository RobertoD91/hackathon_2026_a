#!/usr/bin/env python3
"""Video della simulazione per la demo: "oggi" e "con agenti" affiancati, con agenti veri al lavoro.

Fa girare tutti gli agenti (con le regole, o con l'LLM se richiesto) e due sumo-gui: semafori fissi
a sinistra, semafori guidati dagli agenti a destra. Ogni --passo secondi simulati salva un
fotogramma 1920×1080 con orologio, evento in corso, piano dei semafori, KPI e dialogo tra agenti,
poi monta tutto in MP4 con ffmpeg.

  xvfb-run -a -s "-screen 0 1920x1080x24" python strumenti/video_demo.py
  xvfb-run -a -s "-screen 0 1920x1080x24" python strumenti/video_demo.py --inizio 13:45 --fine 15:30 --uscita media/regata.mp4

Il pilota del drone è simulato (risponde dopo 3 minuti simulati con la stima della folla ±10%):
nel video è scritto. Sul portatile si può togliere con --senza-drone.
"""

from __future__ import annotations

import argparse
import collections
import json
import os
import random
import subprocess
import sys
import tempfile
import textwrap
import time
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import sumolib  # noqa: E402
from PIL import Image, ImageDraw, ImageFont  # noqa: E402

from citta import CARTELLA, DATI  # noqa: E402
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

VISTA = "View #0"
FONT_B = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT_R = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
INQUADRATURA = (14.2232, 40.8278, 14.2578, 40.8425)  # da Mergellina a Piazza Municipio
FONDO = (15, 23, 42)
TESTO = (226, 232, 240)
GRIGIO = (148, 163, 184)
ROSSO = (248, 113, 113)
VERDE = (74, 222, 128)
COLORI_AGENTE = {"Orchestratore": (232, 121, 249), "Traffico": (103, 232, 249), "Folla": (250, 204, 21),
                 "Eventi": (134, 239, 172), "Meteo&Mare": (147, 197, 253), "Turismo": (74, 222, 128),
                 "Imprese": (253, 224, 71), "Pilota drone": (147, 197, 253)}
W, H = 1920, 1080
PANE_W, PANE_H = 950, 611
PANE_Y = 96


def font(grassetto: bool, dim: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONT_B if grassetto else FONT_R, dim)


def colora(sim: Simulazione) -> int:
    fermi = 0
    for v in sim.c.vehicle.getIDList():
        s = sim.c.vehicle.getSpeed(v)
        if s < 0.5:
            fermi += 1
            sim.c.vehicle.setColor(v, (220, 38, 38, 255))
        elif s < 5:
            sim.c.vehicle.setColor(v, (249, 115, 22, 255))
        else:
            sim.c.vehicle.setColor(v, (30, 41, 59, 255))
    return fermi


def inquadra(sim: Simulazione, net) -> None:
    x1, y1 = net.convertLonLat2XY(INQUADRATURA[0], INQUADRATURA[1])
    x2, y2 = net.convertLonLat2XY(INQUADRATURA[2], INQUADRATURA[3])
    sim.c.gui.setBoundary(VISTA, x1, y1, x2, y2)


def kpi(oggi: Simulazione, agenti: Simulazione, t: float) -> dict:
    a, b = oggi.kpi(), agenti.kpi()

    def risparmio(x, y):
        return None if not x or y is None else round(100 * (x - y) / x, 1)

    return {"ora": ora_da_secondi(t), "oggi": a, "agenti": b, "quota_assistiti": 0,
            "risparmio_pct": {"ore_perse_in_coda": risparmio(a["ore_perse_in_coda"], b["ore_perse_in_coda"]),
                              "durata_media": risparmio(a["durata_media_s"], b["durata_media_s"]),
                              "co2": risparmio(a["co2_kg"], b["co2_kg"])}}


def evento_in_corso(scenario: dict, t: int) -> str:
    in_corso = [e["nome"] for e in scenario["eventi"] if secondi_da_ora(e["inizio"]) <= t < secondi_da_ora(e["fine"])]
    if in_corso:
        return "In corso: " + " · ".join(in_corso)
    prossimi = [(secondi_da_ora(e["inizio"]) - t, e["nome"]) for e in scenario["eventi"]
                if 0 < secondi_da_ora(e["inizio"]) - t <= 3 * 3600]
    if prossimi:
        dt, nome = min(prossimi)
        return f"Tra {dt // 60} min: {nome}"
    return "Giornata di festa a Napoli"


class Fotogramma:
    """Compone i fotogrammi del video."""

    def __init__(self, scenario: dict) -> None:
        self.scenario = scenario
        self.f_titolo, self.f_ora = font(True, 30), font(True, 44)
        self.f_med, self.f_pic, self.f_pic_b = font(False, 22), font(False, 19), font(True, 19)
        self.f_kpi, self.f_kpi_b = font(False, 24), font(True, 30)

    def pannello(self, file: Path, titolo: str, colore: tuple, fermi: int) -> Image.Image:
        img = Image.open(file).convert("RGB").resize((PANE_W, PANE_H), Image.LANCZOS)
        d = ImageDraw.Draw(img, "RGBA")
        d.rectangle([0, 0, PANE_W, 44], fill=(15, 23, 42, 225))
        d.text((14, 8), titolo, font=font(True, 24), fill=colore)
        testo = f"veicoli fermi: {fermi}"
        d.text((PANE_W - 14 - d.textlength(testo, font=self.f_med), 11), testo, font=self.f_med, fill=TESTO)
        return img

    def componi(self, t: int, file_oggi: Path, file_agenti: Path, fermi: dict, k: dict | None,
                piano: dict | None, dialogo: list[dict], nota: str) -> Image.Image:
        tela = Image.new("RGB", (W, H), FONDO)
        d = ImageDraw.Draw(tela)
        # Testata
        d.text((20, 14), "NAPOLI AGENTIC CITY", font=self.f_titolo, fill=TESTO)
        d.text((20, 54), "gemello digitale sulle strade vere del lungomare · stessi veicoli a sinistra e a destra",
               font=self.f_pic, fill=GRIGIO)
        ora = ora_da_secondi(t)
        d.rounded_rectangle([W - 190, 14, W - 20, 80], radius=10, fill=(37, 99, 235))
        d.text((W - 105, 47), ora, font=self.f_ora, fill=(255, 255, 255), anchor="mm")
        ev = evento_in_corso(self.scenario, t)
        d.text((W - 210 - d.textlength(ev, font=self.f_med), 24), ev, font=self.f_med, fill=(250, 204, 21))
        pesi = " · ".join(f"{c} ×{p:g}" for c, p in (piano or {}).get("pesi", {}).items() if p != 1) or "normale"
        testo_piano = f"Piano semafori degli agenti: {pesi}"
        d.text((W - 210 - d.textlength(testo_piano, font=self.f_pic), 56), testo_piano, font=self.f_pic, fill=(103, 232, 249))
        # Le due simulazioni
        tela.paste(self.pannello(file_oggi, "OGGI · semafori fissi", ROSSO, fermi["oggi"]), (6, PANE_Y))
        tela.paste(self.pannello(file_agenti, "CON AGENTI · semafori coordinati", VERDE, fermi["agenti"]), (W - PANE_W - 6, PANE_Y))
        # Legenda
        y0 = PANE_Y + PANE_H + 10
        x = 20
        for colore, nome in (((220, 38, 38), "fermo"), ((249, 115, 22), "lento"), ((30, 41, 59), "scorre")):
            d.rectangle([x, y0 + 6, x + 22, y0 + 20], fill=colore, outline=(255, 255, 255))
            d.text((x + 30, y0 + 2), nome, font=self.f_pic, fill=GRIGIO)
            x += 120
        if nota:
            d.text((W - 20 - d.textlength(nota, font=self.f_pic), y0 + 2), nota, font=self.f_pic, fill=GRIGIO)
        # KPI
        y = y0 + 40
        d.text((20, y), "Da inizio giornata", font=self.f_pic_b, fill=GRIGIO)
        if k:
            righe = [("Ore perse in coda", k["oggi"]["ore_perse_in_coda"], k["agenti"]["ore_perse_in_coda"], "h",
                      k["risparmio_pct"]["ore_perse_in_coda"]),
                     ("Durata media viaggio", k["oggi"]["durata_media_s"] or 0, k["agenti"]["durata_media_s"] or 0, "s",
                      k["risparmio_pct"]["durata_media"]),
                     ("CO₂", k["oggi"]["co2_kg"] / 1000, k["agenti"]["co2_kg"] / 1000, "t", k["risparmio_pct"]["co2"])]
            for i, (nome, a, b, u, r) in enumerate(righe):
                yy = y + 34 + i * 92
                d.text((20, yy), nome, font=self.f_kpi, fill=TESTO)
                massimo = max(a, b, 1e-9)
                for j, (val, col) in enumerate(((a, ROSSO), (b, VERDE))):
                    lung = int(470 * val / massimo)
                    d.rectangle([20, yy + 34 + j * 24, 20 + lung, yy + 52 + j * 24], fill=col)
                    d.text((30 + lung, yy + 31 + j * 24), f"{val:.1f} {u}" if u != "s" else f"{val:.0f} s",
                           font=self.f_pic, fill=TESTO)
                if r is not None:
                    segno = f"−{r:g}%" if r > 0 else f"+{-r:g}%"
                    d.text((700, yy + 30), segno, font=self.f_kpi_b, fill=VERDE if r > 0 else ROSSO)
        # Dialogo tra agenti
        x0, larghezza = 860, W - 880
        d.text((x0, y), "Cosa si dicono gli agenti", font=self.f_pic_b, fill=GRIGIO)
        yy = y + 32
        for m in reversed(dialogo):
            da = m.get("da", "?")
            col = COLORI_AGENTE.get(da, TESTO)
            testa = f"{m.get('ora', '')} {da} → {m.get('a', '')}: "
            corpo = textwrap.wrap(testa + m.get("testo", ""), width=98)
            if yy + 24 * len(corpo) > H - 10:
                break
            for i, riga in enumerate(corpo):
                if i == 0:
                    d.text((x0, yy), testa, font=self.f_pic_b, fill=col)
                    d.text((x0 + d.textlength(testa, font=self.f_pic_b), yy), riga[len(testa):], font=self.f_pic, fill=TESTO)
                else:
                    d.text((x0 + 20, yy), riga, font=self.f_pic, fill=TESTO)
                yy += 24
            yy += 8
        return tela

    def cartello(self, righe: list[tuple[str, int, tuple]]) -> Image.Image:
        tela = Image.new("RGB", (W, H), FONDO)
        d = ImageDraw.Draw(tela)
        y = H // 2 - sum(dim + 24 for _, dim, _ in righe) // 2
        for testo, dim, col in righe:
            f = font(dim >= 40, dim)
            d.text((W // 2, y), testo, font=f, fill=col, anchor="ma")
            y += dim + 24
        return tela


class PilotaSimulato:
    """Risponde alle richieste di volo dopo 3 minuti simulati con la stima della folla ±10%."""

    def __init__(self, bus) -> None:
        self.bus, self.richieste, self.rnd = bus, [], random.Random(3)
        bus.iscriviti("napoli/drone/richieste", lambda t, m: self.richieste.append(m))

    def aggiorna(self, t: int) -> None:
        for r in list(self.richieste):
            if t - secondi_da_ora(r["ora"]) >= 180:
                self.richieste.remove(r)
                f = self.bus.ultimo(f"napoli/folla/{r['zona']}") or {}
                persone = int(f.get("persone", 5000) * self.rnd.uniform(0.9, 1.1))
                self.bus.pubblica("napoli/drone/osservazioni", {"zona": r["zona"], "persone_stimate": persone,
                                                                "note": "volo simulato nel video"})
                self.bus.pubblica("napoli/agenti/dialogo", {"ora": ora_da_secondi(t), "da": "Pilota drone",
                                                            "a": "Folla", "testo": f"Volo fatto su {f.get('nome', r['zona'])}: circa {persone:,} persone".replace(",", ".")})


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--inizio", default=None, help="ora di inizio (default scenario)")
    p.add_argument("--fine", default=None, help="ora di fine (default scenario)")
    p.add_argument("--passo", type=int, default=20, help="secondi simulati tra due fotogrammi")
    p.add_argument("--fps", type=int, default=24)
    p.add_argument("--llm", default="regole")
    p.add_argument("--senza-drone", action="store_true", help="niente pilota simulato")
    p.add_argument("--uscita", default=str(CARTELLA / "media" / "demo_gemello.mp4"))
    a = p.parse_args()

    scenario = json.loads((DATI / "scenario_regata.json").read_text(encoding="utf-8"))
    incroci = json.loads((DATI / "incroci.json").read_text(encoding="utf-8"))
    inizio = secondi_da_ora(a.inizio or scenario["inizio"])
    fine = secondi_da_ora(a.fine or scenario["fine"])
    scenario["inizio"] = ora_da_secondi(inizio)

    bus, llm = BusMemoria(), crea_llm(a.llm)
    agenti_citta = [cls(bus, llm, scenario) for cls in (AgenteMeteo, AgenteEventi, AgenteFolla, AgenteTraffico,
                                                         AgenteTurismo, AgenteImprese, Orchestratore)]
    for ag in agenti_citta:
        ag.start()
    pilota = None if a.senza_drone else PilotaSimulato(bus)
    dialogo: collections.deque = collections.deque(maxlen=12)
    bus.iscriviti("napoli/agenti/dialogo", lambda t, m: dialogo.append(m))

    uscita = Path(a.uscita)
    uscita.parent.mkdir(parents=True, exist_ok=True)
    comp = Fotogramma(scenario)
    nota = "drone: pilota simulato" if pilota else ""
    net = sumolib.net.readNet(str(DATI / "lungomare.net.xml"))
    with tempfile.TemporaryDirectory() as cartella:
        cartella = Path(cartella)
        percorsi = prepara_domanda(scenario, cartella)
        oggi = Simulazione("v_oggi", percorsi, inizio, adattiva=False, quota_assistiti=0, gui=True, net=net, incroci=incroci)
        agenti = Simulazione("v_agenti", percorsi, inizio, adattiva=True, quota_assistiti=0, gui=True, net=net, incroci=incroci)
        for sim in (oggi, agenti):
            sim.c.gui.setSchema(VISTA, "napoli")
            inquadra(sim, net)

        n = 0
        # Cartello iniziale (3 s)
        intro = comp.cartello([("NAPOLI AGENTIC CITY", 64, TESTO),
                               ("Napoli 2027 · America's Cup, navi da crociera, partita al Maradona", 30, GRIGIO),
                               ("Stessa giornata, stessi veicoli: semafori di oggi contro semafori guidati dagli agenti", 28, (103, 232, 249))])
        for _ in range(a.fps * 3):
            intro.save(cartella / f"f_{n:05d}.jpg", quality=92)
            n += 1

        in_sospeso = None
        k = None
        t = float(inizio)
        t0 = time.time()
        while t < fine:
            piano = bus.ultimo("napoli/semafori/piano")
            if piano:
                agenti.imposta_piano(piano.get("pesi", {}), piano.get("verde_max", 60))
            oggi.passo()
            t = agenti.passo()
            if in_sospeso:  # lo screenshot chiesto al passo prima ora è su disco
                tt, fo, fa, fermi = in_sospeso
                comp.componi(tt, fo, fa, fermi, k, bus.ultimo("napoli/semafori/piano"), list(dialogo), nota) \
                    .save(cartella / f"f_{n:05d}.jpg", quality=90)
                n += 1
                in_sospeso = None
            if int(t) % 60 == 0:
                k = kpi(oggi, agenti, t)
                bus.pubblica("napoli/orologio", {"ora": ora_da_secondi(t), "t": int(t)}, trattieni=True)
                bus.pubblica("napoli/kpi", k, trattieni=True)
                if pilota:
                    pilota.aggiorna(int(t))
                limite = time.time() + 3  # aspettiamo che gli agenti abbiano finito di ragionare
                while time.time() < limite and any(not ag.coda.empty() for ag in agenti_citta):
                    time.sleep(0.005)
            if int(t - inizio) % a.passo == 0:
                fermi = {"oggi": colora(oggi), "agenti": colora(agenti)}
                fo, fa = cartella / "oggi.png", cartella / "agenti.png"
                if t - inizio < 2:
                    for sim in (oggi, agenti):
                        inquadra(sim, net)
                oggi.c.gui.screenshot(VISTA, str(fo))
                agenti.c.gui.screenshot(VISTA, str(fa))
                in_sospeso = (int(t), fo, fa, fermi)
                if n % 100 == 0:
                    print(f"{ora_da_secondi(t)} · fotogrammi {n} · {time.time() - t0:.0f}s", flush=True)

        # Cartello finale (5 s) con i KPI della giornata
        k = kpi(oggi, agenti, t)
        r = k["risparmio_pct"]
        finale = comp.cartello([
            (f"Giornata {ora_da_secondi(inizio)}–{ora_da_secondi(t)}: con gli agenti", 34, TESTO),
            (f"ore perse in coda −{r['ore_perse_in_coda']:g}%  ·  durata media −{r['durata_media']:g}%  ·  CO₂ −{r['co2']:g}%", 40, VERDE),
            ("In media su 4 giornate simulate diverse: −9% ore in coda, −4% durata, −3,5% CO₂", 26, GRIGIO),
            ("Gemello SUMO su rete OpenStreetMap · domanda di traffico simulata (ipotesi nel README)", 22, GRIGIO)])
        for _ in range(a.fps * 5):
            finale.save(cartella / f"f_{n:05d}.jpg", quality=92)
            n += 1
        oggi.chiudi()
        agenti.chiudi()
        print(f"{n} fotogrammi, monto il video…", flush=True)
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(a.fps), "-i", str(cartella / "f_%05d.jpg"),
                        "-c:v", "libx264", "-preset", "medium", "-crf", "23", "-pix_fmt", "yuv420p",
                        "-movflags", "+faststart", str(uscita)], check=True)
    print(uscita, flush=True)
    os._exit(0)


if __name__ == "__main__":
    main()
