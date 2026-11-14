#!/usr/bin/env python3
"""Genera scene/chat.json, la conversazione con CiroGPT della scena simulata, con risposte VERE.

- Avvia la città di c5-agentic-city in locale (agenti con LLM a regole, senza SUMO, API su --porta),
  oppure usa un'API già accesa (--api http://host:porta).
- Manda i messaggi di chat_domande.json all'API /chiedi, come fa la skill OpenClaw twinciro-citta,
  e registra la risposta e i messaggi tra agenti scambiati nel frattempo ("dietro le quinte").
- Per il turno "meteo_reale" legge il meteo vero da Open-Meteo (riserva: lo snapshot della mappa
  in citta-api/dati/meteo.json) e l'allerta Meteoalarm dallo snapshot.
- Per il turno "avviso" aspetta un avviso proattivo della città per l'utente (/notifiche).
- Applica ai testi di CiroGPT i "ritocchi" di forma di chat_domande.json (es. chi parla nella
  controproposta della pizzeria, accordi grammaticali). Ogni messaggio ritoccato conserva in
  chat.json il testo originale dell'API in "testo_api", così il ritocco resta dichiarato.

Solo libreria standard. c5-agentic-city è usata in sola lettura.

  python3 scene/chat_da_api.py                       # avvia la città sulla porta 8805
  python3 scene/chat_da_api.py --api http://localhost:8080   # usa un'API già accesa (es. docker compose)
  python3 scene/chat_da_api.py --senza-rete          # meteo dallo snapshot, niente Open-Meteo
  python3 scene/chat_da_api.py --solo-ritocchi       # riapplica i ritocchi a chat.json senza avviare la città
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
from zoneinfo import ZoneInfo

QUI = Path(__file__).resolve().parent
ROMA = ZoneInfo("Europe/Rome")   # orari di Meteoalarm e del meteo in ora italiana, qualunque sia il fuso della macchina
REPO = QUI.parent.parent
C5 = REPO / "c5-agentic-city"
SNAPSHOT_METEO = REPO / "citta-api" / "dati" / "meteo.json"
PLEBISCITO = (40.8359, 14.2488)
UA = "TwinCiro/1.0"

CIELO = {0: "sereno", 1: "quasi sereno", 2: "poco nuvoloso", 3: "coperto", 45: "nebbia", 48: "nebbia",
         51: "pioviggine", 53: "pioviggine", 55: "pioviggine", 61: "pioggia debole", 63: "pioggia", 65: "pioggia forte",
         80: "rovesci", 81: "rovesci", 82: "rovesci forti", 95: "temporale", 96: "temporale", 99: "temporale"}
RIGA = re.compile(r"^(\d\d:\d\d) (.+?) → (.+?): (.*)$")
INIZIO_RIGA = re.compile(r"(?<=\S)(?=\d\d:\d\d [^→]{1,60} → [^:]{1,60}: )")


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
        env = {**os.environ, "PYTHONUNBUFFERED": "1", "PYTHONDONTWRITEBYTECODE": "1"}  # niente __pycache__ in c5-agentic-city
        self.proc = subprocess.Popen(cmd, cwd=C5, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                                     encoding="utf-8", env=env)
        threading.Thread(target=self._leggi, daemon=True).start()

    def _leggi(self) -> None:
        for riga in self.proc.stdout:
            # Due agenti che stampano insieme possono finire sulla stessa riga: la divido prima dell'ora
            for pezzo in INIZIO_RIGA.split(riga.rstrip("\n")):
                m = RIGA.match(pezzo)
                if m:
                    testo = re.sub(r" \[[^\]]+\]$", "", m.group(4))
                    self.righe.append({"ora": m.group(1), "da": m.group(2), "a": m.group(3), "testo": testo})

    def ferma(self) -> None:
        self.proc.terminate()
        try:
            self.proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.proc.kill()


def numero(n: float) -> str:
    return f"{round(n):,}".replace(",", ".")


def decimale(x: float) -> str:
    """19.2 → "19,2" (virgola decimale italiana)."""
    return f"{x:.1f}".replace(".", ",")


def ritocca(testo: str, ritocchi: list[dict]) -> str:
    """Ritocchi di forma dichiarati in chat_domande.json: [{"regex", "con", "perche"}]."""
    for r in ritocchi:
        testo = re.sub(r["regex"], r["con"], testo)
    return testo


def applica_ritocchi(m: dict, ritocchi: list[dict]) -> dict:
    """Ritocca il testo di un messaggio (o di una riga "dietro le quinte") partendo sempre dall'originale
    dell'API: se cambia, l'originale resta in "testo_api"."""
    base = m.get("testo_api", m["testo"])
    nuovo = ritocca(base, ritocchi)
    m = {k: v for k, v in m.items() if k != "testo_api"}
    m["testo"] = nuovo
    if nuovo != base:
        m["testo_api"] = base
    return m


def solo_ritocchi(file_chat: Path, ritocchi: list[dict]) -> None:
    c = json.loads(file_chat.read_text(encoding="utf-8"))
    for i, m in enumerate(c["messaggi"]):
        if m.get("da") == "ciro":
            m = applica_ritocchi(m, ritocchi)
            m["dietro_le_quinte"] = [applica_ritocchi(q, ritocchi) for q in m.get("dietro_le_quinte") or []]
            c["messaggi"][i] = m
    file_chat.write_text(json.dumps(c, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Ritocchi riapplicati a {file_chat}", file=sys.stderr)


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
        for tentativo in range(4):  # dall'IP condiviso Open-Meteo risponde spesso 429: riprovo con calma
            try:
                d = http_json(url)
                c = d["current"]
                return {"temperatura": c["temperature_2m"], "codice": c["weather_code"], "vento": c["wind_speed_10m"],
                        "pioggia_mm": c["precipitation"],
                        "prob_pioggia": max(d.get("hourly", {}).get("precipitation_probability") or [0]),
                        "fonte": "Open-Meteo", "letto": c["time"], "stato": "live"}
            except Exception as e:  # noqa: BLE001 — riserva dichiarata
                print(f"Open-Meteo non risponde ({e})", file=sys.stderr)
                time.sleep(8 * (tentativo + 1))
        print("Uso lo snapshot del meteo della mappa", file=sys.stderr)
    s = json.loads(SNAPSHOT_METEO.read_text(encoding="utf-8"))
    p = s["meteo"]["plebiscito"]
    letto = dt.datetime.fromtimestamp(p["ts"] / 1000, ROMA).strftime("%Y-%m-%dT%H:%M")
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
        quando = dt.datetime.fromtimestamp(allerta["inizio"] / 1000, ROMA)
        giorno = "domani" if quando.date() > dt.datetime.now(ROMA).date() else "oggi"
        testo += f" {giorno.capitalize()} però allerta {allerta['colore']} per {allerta['fenomeno'].lower()} in Campania (Meteoalarm)."
    return testo


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--domande", default=str(QUI / "chat_domande.json"))
    p.add_argument("--uscita", default=str(QUI / "chat.json"))
    p.add_argument("--api", help="usa un'API già accesa invece di avviare la città (es. http://localhost:8080)")
    p.add_argument("--porta", type=int, default=8805, help="porta dell'API della città avviata da qui")
    p.add_argument("--senza-rete", action="store_true", help="meteo dallo snapshot invece che da Open-Meteo")
    p.add_argument("--solo-ritocchi", action="store_true", help="riapplica i ritocchi a chat.json, senza la città")
    a = p.parse_args()

    d = json.loads(Path(a.domande).read_text(encoding="utf-8"))
    if a.solo_ritocchi:
        solo_ritocchi(Path(a.uscita), d.get("ritocchi") or [])
        return
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

        etichetta: dict | None = None
        ritocchi = d.get("ritocchi") or []

        def nuovo(**m) -> dict:
            if m.get("da") == "ciro" and ritocchi:
                m = applica_ritocchi(m, ritocchi)
                m["dietro_le_quinte"] = [applica_ritocchi(q, ritocchi) for q in m.get("dietro_le_quinte") or []]
            m = {"id": len(messaggi) + 1, **m, **({"etichetta": etichetta} if etichetta else {})}
            messaggi.append(m)
            return m

        for turno in d["turni"]:
            etichetta = turno.get("etichetta")  # titolo del passo nel pannello a destra della scena

            if turno["tipo"] == "api":
                ora = ora_api(api)
                segno = len(righe)
                nuovo(da="utente", ora=ora, testo=turno["testo"])
                risposta = http_json(f"{api}/chiedi", {"utente": utente, "testo": turno["testo"]})["risposta"]
                time.sleep(1.0)  # il dialogo tra agenti arriva sullo stdout subito dopo
                quinte = [r for r in righe[segno:] if r["a"] != utente and r["da"] != utente
                          and "Assistente di" in (r["da"] + r["a"])]
                quinte = [{**r, "da": r["da"].replace(f"Assistente di {utente}", "CiroGPT"),
                           "a": r["a"].replace(f"Assistente di {utente}", "CiroGPT")} for r in quinte]
                # Cosa ha letto l'assistente dal bus: la stima della folla delle zone citate nella risposta
                stato = http_json(f"{api}/stato")
                for f in (stato.get("folla") or {}).values():
                    if f["nome"] in risposta:
                        quinte.append({"ora": stato.get("ora", ora), "da": "Folla", "a": "CiroGPT",
                                       "testo": f"{f['nome']}: {numero(f['persone'])} persone, livello {f['livello']} "
                                                "(stima simulata, letta dal bus)"})
                nuovo(da="ciro", ora=ora_api(api), testo=risposta, fonte="API della città /chiedi (agenti, LLM a regole)",
                      dietro_le_quinte=quinte)
                print(f"[{ora}] {utente}: {turno['testo']}\n        Ciro: {risposta}", file=sys.stderr)
            elif turno["tipo"] == "meteo_reale":
                ora = ora_api(api)
                nuovo(da="utente", ora=ora, testo=turno["testo"])
                m = meteo_reale(a.senza_rete)
                al = allerta_domani()
                testo = testo_meteo(m, al)
                # Righe leggibili a schermo: virgola decimale, niente ora ISO (il telefono mostra l'ora simulata);
                # l'ora vera della lettura resta nel campo "fonte" del messaggio.
                quinte = [{"ora": ora, "da": "CiroGPT", "a": "skill napoli-citta-dati",
                           "testo": "meteo attuale e pioggia nelle prossime 6 ore a Napoli"},
                          {"ora": ora, "da": m["fonte"], "a": "CiroGPT",
                           "testo": f"{decimale(m['temperatura'])} °C, {CIELO.get(int(m['codice']), 'variabile')}, "
                                    f"vento {decimale(m['vento'])} km/h"
                                    + (f", pioggia al massimo {m['prob_pioggia']}% nelle prossime 6 ore"
                                       if m["prob_pioggia"] is not None else "")
                                    + (" (dato reale)" if m["stato"] == "live" else " (ultimo dato salvato)")}]
                if al:
                    da_ = dt.datetime.fromtimestamp(al["inizio"] / 1000, ROMA)
                    a_ = dt.datetime.fromtimestamp(al["fine"] / 1000, ROMA)
                    giorno = "domani" if da_.date() > dt.datetime.now(ROMA).date() else "oggi"
                    quinte.append({"ora": ora, "da": "Meteoalarm", "a": "CiroGPT",
                                   "testo": f"Campania, {giorno} {da_:%H:%M}–{a_:%H:%M}: allerta {al['colore']} "
                                            f"per {al['fenomeno'].lower()}"})
                nuovo(da="ciro", ora=ora, testo=testo, fonte=f"{m['fonte']} ({m['stato']}, {m['letto']})"
                      + (" + Meteoalarm (snapshot della mappa)" if al else "") + "; testo composto dallo script",
                      dietro_le_quinte=quinte)
                print(f"[{ora}] {utente}: {turno['testo']}\n        Ciro: {testo}", file=sys.stderr)
            elif turno["tipo"] == "avviso":
                fino = minuti(turno.get("attendi_fino", "16:00"))
                preferite = turno.get("zone_preferite") or []
                per = turno.get("per")  # "turisti" = avvisi dell'agente Turismo (folla spostata con un'offerta)
                scelto = None
                print("Aspetto un avviso proattivo per", utente, "…", file=sys.stderr)
                while scelto is None:
                    ora = ora_api(api)
                    for n in http_json(f"{api}/notifiche?utente={utente}")["notifiche"]:
                        if (not preferite or n.get("zona") in preferite) and (not per or n.get("per") == per):
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
                # Messaggi tra agenti dei 20 minuti prima che parlano della zona dell'avviso
                zona_nome = ((http_json(f"{api}/stato").get("folla") or {}).get(scelto.get("zona") or "", {})
                             .get("nome", "")).split(" (")[0]
                vicine = [r for r in righe if 0 <= minuti(ora_avv) - minuti(r["ora"]) <= 20
                          and r["da"] in ("Folla", "Orchestratore", "Turismo", "Eventi", "Pilota drone")
                          and r["a"] != "Semafori" and "Traffico" not in (r["da"], r["a"])
                          and (not zona_nome or zona_nome in r["testo"])]
                nuovo(da="ciro", tipo="avviso", ora=ora_avv, testo="📣 " + scelto["testo"],
                      fonte=f"API della città /notifiche (agente {'Turismo' if scelto.get('per') == 'turisti' else 'Orchestratore'}, regole)",
                      dietro_le_quinte=vicine[-4:])
                print(f"[{ora_avv}] Ciro (avviso): {scelto['testo']}", file=sys.stderr)

        uscita = {
            "generato": {
                "quando": dt.datetime.now().isoformat(timespec="seconds"),
                "come": "scene/chat_da_api.py: messaggi veri all'API /chiedi di c5-agentic-city (LLM a regole, "
                        "senza SUMO) e meteo da Open-Meteo. Ritocchi di forma da chat_domande.json: il testo originale "
                        "dell'API resta in 'testo_api'. Puoi ritoccare i testi a mano: il renderer legge solo questo file.",
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
