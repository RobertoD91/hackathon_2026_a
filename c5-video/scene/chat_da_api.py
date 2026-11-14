#!/usr/bin/env python3
"""Genera scene/chat.json, la conversazione con CiroGPT della scena simulata, con risposte VERE.

- Avvia la città di c5-agentic-city in locale (agenti con LLM a regole, senza SUMO, API su --porta),
  oppure usa un'API già accesa (--api http://host:porta).
- Manda i messaggi di chat_domande.json all'API /chiedi, come fa la skill OpenClaw twinciro-citta,
  e registra la risposta e i messaggi tra agenti scambiati nel frattempo ("dietro le quinte").
- Per il turno "meteo_reale" legge il meteo vero da Open-Meteo (riserva: lo snapshot della mappa
  in shared/iot-agents/example/dati/meteo.json) e l'allerta Meteoalarm dallo snapshot.
- Per il turno "avviso" aspetta un avviso proattivo della città per l'utente (/notifiche).

Solo libreria standard. c5-agentic-city è usata in sola lettura.

  python3 scene/chat_da_api.py                       # avvia la città sulla porta 8805
  python3 scene/chat_da_api.py --api http://localhost:8080   # usa un'API già accesa (es. docker compose)
  python3 scene/chat_da_api.py --senza-rete          # meteo dallo snapshot, niente Open-Meteo
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import subprocess
import sys
import threading
import time
import urllib.request
from pathlib import Path

QUI = Path(__file__).resolve().parent
REPO = QUI.parent.parent
C5 = REPO / "c5-agentic-city"
SNAPSHOT_METEO = REPO / "shared" / "iot-agents" / "example" / "dati" / "meteo.json"
PLEBISCITO = (40.8359, 14.2488)
UA = "TwinCiro/1.0"

CIELO = {0: "sereno", 1: "quasi sereno", 2: "poco nuvoloso", 3: "coperto", 45: "nebbia", 48: "nebbia",
         51: "pioviggine", 53: "pioviggine", 55: "pioviggine", 61: "pioggia debole", 63: "pioggia", 65: "pioggia forte",
         80: "rovesci", 81: "rovesci", 82: "rovesci forti", 95: "temporale", 96: "temporale", 99: "temporale"}
RIGA = re.compile(r"^(\d\d:\d\d) (.+?) → (.+?): (.*)$")


def http_json(url: str, dati: dict | None = None, timeout: float = 15) -> dict:
    corpo = json.dumps(dati).encode() if dati is not None else None
    req = urllib.request.Request(url, data=corpo, headers={"Content-Type": "application/json", "User-Agent": UA})
    token = os.environ.get("C5_API_TOKEN")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


class Citta:
    """La città di c5-agentic-city in un processo figlio, con il dialogo tra agenti letto dallo stdout."""

    def __init__(self, porta: int, inizio: str, velocita: float) -> None:
        self.righe: list[dict] = []
        cmd = [sys.executable, "avvia.py", "--llm", "regole", "--api-porta", str(porta), "--senza-sala",
               "--senza-gemello", "--inizio", inizio, "--velocita", str(velocita)]
        env = {**os.environ, "PYTHONUNBUFFERED": "1"}
        self.proc = subprocess.Popen(cmd, cwd=C5, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                                     encoding="utf-8", env=env)
        threading.Thread(target=self._leggi, daemon=True).start()

    def _leggi(self) -> None:
        for riga in self.proc.stdout:
            m = RIGA.match(riga.rstrip("\n"))
            if m:
                testo = re.sub(r" \[[^\]]+\]$", "", m.group(4))
                self.righe.append({"ora": m.group(1), "da": m.group(2), "a": m.group(3), "testo": testo})

    def ferma(self) -> None:
        self.proc.terminate()
        try:
            self.proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.proc.kill()


def ora_api(api: str) -> str:
    return http_json(f"{api}/stato").get("ora") or ""


def minuti(ora: str) -> int:
    h, m = ora.split(":")
    return int(h) * 60 + int(m)


def meteo_reale(senza_rete: bool) -> dict:
    """Meteo attuale a Napoli e probabilità di pioggia delle prossime 6 ore (Open-Meteo), con riserva."""
    if not senza_rete:
        url = (f"https://api.open-meteo.com/v1/forecast?latitude={PLEBISCITO[0]}&longitude={PLEBISCITO[1]}"
               "&current=temperature_2m,weather_code,wind_speed_10m,precipitation"
               "&hourly=precipitation_probability&forecast_hours=6&timezone=Europe%2FRome")
        try:
            d = http_json(url)
            c = d["current"]
            return {"temperatura": c["temperature_2m"], "codice": c["weather_code"], "vento": c["wind_speed_10m"],
                    "pioggia_mm": c["precipitation"],
                    "prob_pioggia": max(d.get("hourly", {}).get("precipitation_probability") or [0]),
                    "fonte": "Open-Meteo", "letto": c["time"], "stato": "live"}
        except Exception as e:  # noqa: BLE001 — riserva dichiarata
            print(f"Open-Meteo non risponde ({e}): uso lo snapshot", file=sys.stderr)
    s = json.loads(SNAPSHOT_METEO.read_text(encoding="utf-8"))
    p = s["meteo"]["plebiscito"]
    letto = dt.datetime.fromtimestamp(p["ts"] / 1000).strftime("%Y-%m-%dT%H:%M")
    return {"temperatura": p["temperatura"], "codice": p["codice"], "vento": p["vento"], "pioggia_mm": p["pioggia"],
            "prob_pioggia": None, "fonte": "Open-Meteo (snapshot)", "letto": letto, "stato": "snapshot"}


def allerta_domani() -> dict | None:
    """Prima allerta Meteoalarm (snapshot della mappa) che inizia nelle prossime 36 ore."""
    try:
        s = json.loads(SNAPSHOT_METEO.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    adesso = time.time() * 1000
    future = [a for a in s.get("meteoalarm") or [] if adesso < a["inizio"] < adesso + 36 * 3600 * 1000]
    return max(future, key=lambda a: a["livello"]) if future else None


def testo_meteo(m: dict, allerta: dict | None) -> str:
    cielo = CIELO.get(int(m["codice"]), "variabile")
    gradi = f"{round(m['temperatura'])} °C"
    vento = f"{round(m['vento'])} km/h"
    p = m["prob_pioggia"]
    if (p is not None and p >= 40) or m["pioggia_mm"] > 0:
        apertura = "Meglio portarlo" + (f": pioggia probabile al {p}% nelle prossime ore." if p is not None else ".")
    else:
        apertura = "No, niente pioggia nelle prossime ore" + (f" (probabilità massima {p}%)." if p is not None else ".")
    testo = f"{apertura} Adesso {gradi}, {cielo}, vento {vento}. Fonte: {m['fonte']}, dato reale di oggi."
    if allerta:
        quando = dt.datetime.fromtimestamp(allerta["inizio"] / 1000)
        giorno = "domani" if quando.date() > dt.date.today() else "oggi"
        testo += f" {giorno.capitalize()} però allerta {allerta['colore']} per {allerta['fenomeno'].lower()} in Campania (Meteoalarm)."
    return testo


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--domande", default=str(QUI / "chat_domande.json"))
    p.add_argument("--uscita", default=str(QUI / "chat.json"))
    p.add_argument("--api", help="usa un'API già accesa invece di avviare la città (es. http://localhost:8080)")
    p.add_argument("--porta", type=int, default=8805, help="porta dell'API della città avviata da qui")
    p.add_argument("--senza-rete", action="store_true", help="meteo dallo snapshot invece che da Open-Meteo")
    a = p.parse_args()

    d = json.loads(Path(a.domande).read_text(encoding="utf-8"))
    utente = d.get("utente", "Marta")
    citta = None
    api = a.api
    if not api:
        citta = Citta(a.porta, d["citta"]["inizio"], d["citta"]["velocita"])
        api = f"http://127.0.0.1:{a.porta}"
    try:
        for _ in range(60):
            try:
                if ora_api(api):
                    break
            except OSError:
                pass
            time.sleep(0.5)
        else:
            sys.exit(f"L'API della città non risponde su {api}")
        print(f"Città pronta su {api}, ora simulata {ora_api(api)}", file=sys.stderr)

        messaggi: list[dict] = []
        righe = citta.righe if citta else []

        def nuovo(**m) -> dict:
            m = {"id": len(messaggi) + 1, **m}
            messaggi.append(m)
            return m

        for turno in d["turni"]:
            if turno["tipo"] == "api":
                ora = ora_api(api)
                segno = len(righe)
                nuovo(da="utente", ora=ora, testo=turno["testo"])
                risposta = http_json(f"{api}/chiedi", {"utente": utente, "testo": turno["testo"]})["risposta"]
                time.sleep(1.0)  # il dialogo tra agenti arriva sullo stdout subito dopo
                quinte = [r for r in righe[segno:] if r["a"] != utente and r["da"] != utente
                          and "Assistente di" in (r["da"] + r["a"])]
                nuovo(da="ciro", ora=ora_api(api), testo=risposta, fonte="API della città /chiedi (agenti, LLM a regole)",
                      dietro_le_quinte=[{**r, "da": r["da"].replace(f"Assistente di {utente}", "CiroGPT"),
                                          "a": r["a"].replace(f"Assistente di {utente}", "CiroGPT")} for r in quinte])
                print(f"[{ora}] {utente}: {turno['testo']}\n        Ciro: {risposta}", file=sys.stderr)
            elif turno["tipo"] == "meteo_reale":
                ora = ora_api(api)
                nuovo(da="utente", ora=ora, testo=turno["testo"])
                m = meteo_reale(a.senza_rete)
                al = allerta_domani()
                testo = testo_meteo(m, al)
                quinte = [{"ora": ora, "da": "CiroGPT", "a": "skill napoli-meteo-allerte",
                           "testo": "meteo attuale e pioggia nelle prossime 6 ore a Napoli"},
                          {"ora": ora, "da": m["fonte"], "a": "CiroGPT",
                           "testo": f"{m['temperatura']} °C, codice WMO {m['codice']}, vento {m['vento']} km/h, "
                                    f"pioggia max {m['prob_pioggia']}% (letto {m['letto']})"}]
                if al:
                    quinte.append({"ora": ora, "da": "Meteoalarm", "a": "CiroGPT", "testo": al["titolo"]})
                nuovo(da="ciro", ora=ora_api(api), testo=testo, fonte=f"{m['fonte']} ({m['stato']}, {m['letto']})"
                      + (" + Meteoalarm (snapshot della mappa)" if al else "") + "; testo composto dallo script",
                      dietro_le_quinte=quinte)
                print(f"[{ora}] {utente}: {turno['testo']}\n        Ciro: {testo}", file=sys.stderr)
            elif turno["tipo"] == "avviso":
                fino = minuti(turno.get("attendi_fino", "16:00"))
                preferite = turno.get("zone_preferite") or []
                scelto = None
                print("Aspetto un avviso proattivo per", utente, "…", file=sys.stderr)
                while scelto is None:
                    ora = ora_api(api)
                    for n in http_json(f"{api}/notifiche?utente={utente}")["notifiche"]:
                        if not preferite or n.get("zona") in preferite:
                            scelto = n
                            break
                    if scelto is None and minuti(ora) >= fino:
                        break
                    time.sleep(1)
                if scelto is None:
                    print("Nessun avviso entro l'ora indicata", file=sys.stderr)
                    continue
                time.sleep(0.5)
                ora_avv = scelto.get("ora") or ora_api(api)
                vicine = [r for r in righe if 0 <= minuti(ora_avv) - minuti(r["ora"]) <= 20
                          and r["da"] in ("Folla", "Orchestratore", "Turismo", "Eventi", "Pilota drone")
                          and r["a"] != "Semafori" and "Traffico" not in (r["da"], r["a"])]
                nuovo(da="ciro", tipo="avviso", ora=ora_avv, testo="📣 " + scelto["testo"],
                      fonte=f"API della città /notifiche (agente {'Turismo' if scelto.get('per') == 'turisti' else 'Orchestratore'}, regole)",
                      dietro_le_quinte=vicine[-4:])
                print(f"[{ora_avv}] Ciro (avviso): {scelto['testo']}", file=sys.stderr)

        uscita = {
            "generato": {
                "quando": dt.datetime.now().isoformat(timespec="seconds"),
                "come": "scene/chat_da_api.py: messaggi veri all'API /chiedi di c5-agentic-city (LLM a regole, "
                        "senza SUMO) e meteo da Open-Meteo. Puoi ritoccare i testi a mano: il renderer legge solo questo file.",
                "api": api if a.api else f"c5-agentic-city/avvia.py --llm regole --senza-gemello --inizio "
                                         f"{d['citta']['inizio']} --velocita {d['citta']['velocita']}",
                "nota": "Folla, offerte e imprese sono SIMULATE (imprese di fantasia); il meteo è reale.",
            },
            "contatto": d.get("contatto", "CiroGPT"),
            "utente": utente,
            "presentazione_utente": d.get("presentazione_utente", ""),
            "messaggi": messaggi,
        }
        Path(a.uscita).write_text(json.dumps(uscita, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"Scritto {a.uscita} ({len(messaggi)} messaggi)", file=sys.stderr)
    finally:
        if citta:
            citta.ferma()


if __name__ == "__main__":
    main()
