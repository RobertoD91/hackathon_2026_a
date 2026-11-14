#!/usr/bin/env python3
"""Cattura la decisione vera degli agenti e la sala operativa per la scena operatore.html.

Avvia la città di c5-agentic-city in questo processo, come avvia.py con
  --llm regole --senza-gemello --approvazione --inizio 12:10 --velocita 30
(la stessa partenza della chat di Marta, chat_domande.json), più l'API su una porta libera di 127.0.0.1.
- Rifà le domande di Marta all'API /chiedi (i turni "api" di chat_domande.json), come chat_da_api.py.
- Con --approvazione ogni decisione dell'orchestratore aspetta l'operatore. Lo script fa l'operatore con
  l'API vera della città (POST /operatore, come strumenti/operatore.py): approva subito le decisioni
  precedenti, così la giornata va come nella chat, e si ferma sulla prima proposta che sposta la folla
  dalla Rotonda Diaz (circa le 14:41 simulate).
- Su quella proposta rende la sala operativa (citta/sala.py, layout vero, con rich) in SVG: prima
  (proposta in attesa) e dopo l'approvazione (decisione eseguita, avviso dell'agente Turismo).
- Scrive operatore/decisione.json con i testi veri (decisione, dialogo tra agenti, avviso, notifica di
  Marta) e operatore/sala-prima.svg, operatore/sala-dopo.svg.

Serve il venv della città (rich, paho-mqtt): c5-agentic-city/requirements.txt. Niente rete: LLM a regole.
c5-agentic-city è usata in sola lettura (niente __pycache__).

  PYTHONDONTWRITEBYTECODE=1 <venv>/bin/python c5-presentazione/scene/operatore/cattura_citta.py
  ... cattura_citta.py --uscita /tmp/prova      # scrive altrove (per le prove)
"""

from __future__ import annotations

import sys

sys.dont_write_bytecode = True  # prima di importare la città: niente __pycache__ in c5-agentic-city

import argparse  # noqa: E402
import datetime as dt  # noqa: E402
import io  # noqa: E402
import json  # noqa: E402
import os  # noqa: E402
import queue  # noqa: E402
import re  # noqa: E402
import socket  # noqa: E402
import time  # noqa: E402
import urllib.request  # noqa: E402
from pathlib import Path  # noqa: E402

QUI = Path(__file__).resolve().parent            # c5-presentazione/scene/operatore
SCENE = QUI.parent
REPO = SCENE.parent.parent
C5 = REPO / "c5-agentic-city"
sys.path.insert(0, str(C5))

from citta import DATI  # noqa: E402
from citta.agenti.assistente import Assistenti  # noqa: E402
from citta.agenti.base import Orologio  # noqa: E402
from citta.agenti.eventi import AgenteEventi  # noqa: E402
from citta.agenti.folla import AgenteFolla  # noqa: E402
from citta.agenti.imprese import AgenteImprese  # noqa: E402
from citta.agenti.meteo import AgenteMeteo  # noqa: E402
from citta.agenti.orchestratore import Orchestratore  # noqa: E402
from citta.agenti.traffico import AgenteTraffico  # noqa: E402
from citta.agenti.turismo import AgenteTurismo  # noqa: E402
from citta.api import avvia_api  # noqa: E402
from citta.bus import crea_bus, secondi_da_ora  # noqa: E402
from citta.llm import crea_llm  # noqa: E402
from citta.sala import Sala  # noqa: E402
from rich.console import CONSOLE_SVG_FORMAT, Console  # noqa: E402
from rich.terminal_theme import TerminalTheme  # noqa: E402

ZONA = "rotonda_diaz"             # la proposta da mostrare: sposta la folla dalla Rotonda Diaz (la stessa della chat)
COLONNE, RIGHE = 118, 38          # terminale della sala: ci sta il layout e nel video si legge ancora

# Colori del terminale: fondo blu notte come le scene, colori ANSI leggibili. Solo l'aspetto: il contenuto è quello di rich.
TEMA = TerminalTheme(
    (12, 19, 36), (226, 232, 240),
    [(23, 32, 54), (239, 83, 80), (74, 222, 128), (250, 204, 21),
     (96, 165, 250), (217, 70, 239), (56, 214, 240), (203, 213, 225)],
    [(100, 116, 139), (255, 122, 122), (134, 239, 172), (253, 224, 71),
     (147, 197, 253), (240, 171, 252), (125, 232, 248), (248, 250, 252)],
)
# Modello SVG di rich senza i font scaricati da internet: DejaVu Sans Mono è sulla macchina che rende il video.
FORMATO_SVG = re.sub(r"\s*@font-face \{\{.*?\}\}", "", CONSOLE_SVG_FORMAT, flags=re.DOTALL)
FORMATO_SVG = FORMATO_SVG.replace("font-family: Fira Code, monospace;", "font-family: 'DejaVu Sans Mono', monospace;")
FORMATO_SVG = FORMATO_SVG.replace("font-family: arial;", "font-family: 'Inter', 'DejaVu Sans', sans-serif;")
ASPETTO_FONT = 0.602              # larghezza/altezza di DejaVu Sans Mono


def porta_libera() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def http_json(url: str, dati: dict | None = None, timeout: float = 30) -> dict:
    corpo = json.dumps(dati).encode() if dati is not None else None
    req = urllib.request.Request(url, data=corpo, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def rendi_sala(sala: Sala, titolo: str, uid: str) -> tuple[str, str]:
    """La sala vera (Sala.layout) in una console registrata: SVG per la scena e testo per controllo.
    `uid` prefissa classi e id dell'SVG: due SVG nella stessa pagina non si pestano i piedi."""
    con = Console(record=True, width=COLONNE, height=RIGHE, file=io.StringIO(), force_terminal=True,
                  color_system="truecolor", legacy_windows=False)
    con.print(sala.layout(RIGHE))
    testo = con.export_text(clear=False)
    svg = con.export_svg(title=titolo, theme=TEMA, code_format=FORMATO_SVG, font_aspect_ratio=ASPETTO_FONT,
                         unique_id=uid)
    return svg, testo


def geometria(svg: str, uid: str) -> dict:
    """Dove sta la griglia dei caratteri nell'SVG di rich (letta dall'SVG stesso, non dalle costanti interne di rich)."""
    vb = [float(x) for x in re.search(r'viewBox="([^"]+)"', svg).group(1).split()]
    tx, ty = (float(x) for x in re.search(r'<g transform="translate\(([\d.]+), ([\d.]+)\)" clip-path', svg).groups())
    righe = [float(y) for y in re.findall(rf'<clipPath id="{uid}-line-\d+">\s*<rect x="0" y="([\d.]+)"', svg)]
    # larghezza di una cella: textLength / numero di caratteri del primo testo senza entità
    cella = next(float(m.group(1)) / len(m.group(2))
                 for m in re.finditer(r'textLength="([\d.]+)"[^>]*>([^<&]+)</text>', svg) if len(m.group(2)) >= 4)
    return {"larghezza": vb[2], "altezza": vb[3], "x0": tx, "y0": ty + righe[0], "cella": round(cella, 4),
            "riga": round(righe[1] - righe[0], 4)}


def evidenze(testo: str) -> dict:
    """Righe e colonne (nel testo della sala dopo l'approvazione) da evidenziare nella scena:
    la riga della regia con lo stato della decisione e il messaggio di Turismo per la Rotonda Diaz nel dialogo."""
    righe = testo.split("\n")

    def trova(s: str, da: int = 0) -> tuple[int, int]:
        for i in range(da, len(righe)):
            j = righe[i].find(s)
            if j >= 0:
                return i, j
        raise ValueError(f"non trovo «{s}» nella sala")

    # colonna dei pannelli di destra: il secondo angolo "╭" della riga col titolo del dialogo
    r_dial, _ = trova("Cosa si dicono gli agenti")
    sx = righe[r_dial].find("╭", righe[r_dial].find("╮"))
    dx = righe[r_dial].rfind("╮")
    r_regia, _ = trova("approvata dall'operatore")
    r_avv, _ = trova("Avviso per chi è a Rotonda Diaz")
    r_fine, _ = trova("persone spostate", r_avv)
    return {"regia": {"riga": r_regia, "righe": 1, "col": sx + 2, "col_fine": dx - 1},
            "avviso": {"riga": r_avv, "righe": r_fine - r_avv + 1, "col": sx + 2, "col_fine": dx - 1}}


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--uscita", default=str(QUI), help="cartella dove scrivere decisione.json e gli SVG")
    p.add_argument("--velocita", type=float, help="secondi simulati per secondo reale (default: quella della chat, 30)")
    p.add_argument("--fino", default="16:30", help="ora simulata oltre la quale si rinuncia (default 16:30)")
    a = p.parse_args()
    uscita = Path(a.uscita)
    uscita.mkdir(parents=True, exist_ok=True)

    domande = json.loads((SCENE / "chat_domande.json").read_text(encoding="utf-8"))
    utente = domande.get("utente", "Marta")
    inizio, velocita = domande["citta"]["inizio"], a.velocita or domande["citta"]["velocita"]
    os.environ.pop("C5_API_TOKEN", None)  # API solo su 127.0.0.1, per questo processo

    # --- la città, come avvia.py (stessi costruttori), con l'approvazione dell'operatore ---------------------
    scenario = json.loads((DATI / "scenario_regata.json").read_text(encoding="utf-8"))
    scenario["inizio"] = inizio
    bus = crea_bus("memoria")
    llm = crea_llm("regole")
    agenti = [
        AgenteMeteo(bus, llm, scenario, modalita="scenario"),
        AgenteEventi(bus, llm, scenario),
        AgenteFolla(bus, llm, scenario),
        AgenteTraffico(bus, llm, scenario),
        AgenteTurismo(bus, llm, scenario),
        AgenteImprese(bus, llm, scenario),
        Orchestratore(bus, llm, scenario, approvazione=True),
    ]
    assistenti = Assistenti(bus, llm, scenario)
    sala = Sala(bus, llm.nome)

    dialogo: list[dict] = []
    decisioni: list[dict] = []
    avvisi: list[dict] = []
    in_attesa: queue.Queue = queue.Queue()
    bus.iscriviti("napoli/agenti/dialogo", lambda t, m: dialogo.append(dict(m)))
    bus.iscriviti("napoli/avvisi", lambda t, m: avvisi.append(dict(m)))

    def su_decisione(t: str, m: dict) -> None:
        decisioni.append(dict(m))
        if m.get("stato") == "in_attesa":
            in_attesa.put(dict(m))

    bus.iscriviti("napoli/orchestratore/decisioni", su_decisione)

    for ag in agenti:
        ag.start()
    porta = porta_libera()
    avvia_api(assistenti, bus, porta, host="127.0.0.1")
    api = f"http://127.0.0.1:{porta}"
    motore = Orologio(bus, secondi_da_ora(scenario["inizio"]), secondi_da_ora(scenario["fine"]), velocita)
    motore.start()
    print(f"Città in memoria (LLM: {llm.nome}, approvazione dell'operatore) da {inizio}, ×{velocita:g}, API {api}",
          file=sys.stderr)
    for _ in range(60):
        try:
            if http_json(f"{api}/stato").get("ora"):
                break
        except OSError:
            pass
        time.sleep(0.25)

    def ora() -> str:
        return (bus.ultimo("napoli/orologio") or {}).get("ora", "")

    # --- le domande di Marta, come chat_da_api.py (solo i turni che passano dall'API) -----------------------
    risposte = []
    for turno in domande["turni"]:
        if turno["tipo"] != "api":
            continue
        quando = ora()
        r = http_json(f"{api}/chiedi", {"utente": utente, "testo": turno["testo"]})["risposta"]
        risposte.append({"ora": quando, "domanda": turno["testo"], "risposta": r})
        print(f"[{quando}] {utente}: {turno['testo']}\n        → {r}", file=sys.stderr)
        time.sleep(1.0)

    # --- l'operatore: approva tutto subito, tranne la proposta da mostrare -----------------------------------
    def approva(d: dict) -> dict:
        corpo = {"decisione": d["id"], "esito": "approva"}
        http_json(f"{api}/operatore", corpo)
        return {"richiesta": "POST /operatore", "corpo": corpo, "ora_simulata": ora(),
                "come_da_terminale": f"python strumenti/operatore.py approva {d['id']}"}

    approvate: list[dict] = []
    obiettivo = None
    fino = secondi_da_ora(a.fino)
    while obiettivo is None:
        try:
            d = in_attesa.get(timeout=0.5)
        except queue.Empty:
            if secondi_da_ora(ora() or "00:00") >= fino:
                sys.exit(f"Nessuna proposta per {ZONA} entro le {a.fino}: niente da catturare")
            continue
        if any(x.get("agente") == "turismo" and x.get("zona") == ZONA for x in d.get("azioni", [])):
            obiettivo = d
        else:
            approvate.append({"id": d["id"], "ora": d["ora"], "motivazione": d.get("motivazione", ""),
                              **approva(d)})
            print(f"[{d['ora']}] approvo {d['id']}: {d.get('motivazione', '')[:90]}…", file=sys.stderr)

    # --- la proposta: sala prima, approvazione, sala dopo ------------------------------------------------------
    time.sleep(0.4)  # il messaggio "approvi?" al dialogo segue la pubblicazione della proposta
    print(f"[{obiettivo['ora']}] proposta {obiettivo['id']}: {obiettivo.get('motivazione')}", file=sys.stderr)
    titolo = f"Sala operativa · città agentica, ore {obiettivo['ora']} (simulazione)"
    svg_prima, testo_prima = rendi_sala(sala, titolo, "salaprima")
    proposta_dialogo = next((m for m in reversed(dialogo) if m.get("a") == "Sala operativa"
                             and f"[{obiettivo['id']}]" in m.get("testo", "")), None)
    folla = {z: {k: m[k] for k in ("nome", "persone", "capienza", "livello", "fonti")}
             for z, m in ((t.split("/")[-1], m) for t, m in bus.trattenuti("napoli/folla/+").items())}
    n_dialogo = len(dialogo)
    approvazione = approva(obiettivo)
    print(f"[{approvazione['ora_simulata']}] l'operatore approva {obiettivo['id']} (POST /operatore)", file=sys.stderr)

    limite = time.monotonic() + 15
    eseguita = avviso = None
    while time.monotonic() < limite and not (eseguita and avviso):
        eseguita = next((x for x in decisioni if x.get("id") == obiettivo["id"] and x.get("stato") != "in_attesa"), None)
        avviso = next((x for x in avvisi if x.get("zona") == ZONA and x.get("per") == "turisti"), None)
        time.sleep(0.1)
    if not eseguita:
        sys.exit("La decisione approvata non è stata eseguita entro 15 s")
    time.sleep(0.6)  # il dialogo di Turismo e del pilota del drone segue l'esecuzione
    svg_dopo, testo_dopo = rendi_sala(sala, titolo, "saladopo")
    notifiche = http_json(f"{api}/notifiche?utente={utente}").get("notifiche", [])
    notifica = next((n for n in notifiche if n.get("zona") == ZONA and n.get("per") == "turisti"), None)

    # --- cosa ha ricevuto Marta nella chat (stesso testo?) ----------------------------------------------------
    chat = json.loads((SCENE / "chat.json").read_text(encoding="utf-8"))
    avviso_chat = next((m for m in chat["messaggi"] if m.get("tipo") == "avviso"), None)
    testo_chat = (avviso_chat or {}).get("testo_api") or (avviso_chat or {}).get("testo", "")
    testo_chat = testo_chat.removeprefix("📣 ").strip()

    def righe_dialogo(da: int, a_: int | None = None) -> list[dict]:
        return [{k: m.get(k) for k in ("ora", "da", "a", "testo", "fonte") if m.get(k)} for m in dialogo[da:a_]]

    prima_ora = secondi_da_ora(obiettivo["ora"]) - 20 * 60
    contesto = [i for i, m in enumerate(dialogo[:n_dialogo]) if secondi_da_ora(m.get("ora") or "00:00") >= prima_ora]
    risultato = {
        "generato": {
            "quando": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
            "come": "scene/operatore/cattura_citta.py: la città di c5-agentic-city in memoria, come avvia.py con "
                    f"--llm regole --senza-gemello --approvazione --inizio {inizio} --velocita {velocita:g} e l'API su "
                    "127.0.0.1. Lo script rifà le domande di Marta (chat_domande.json) e fa l'operatore con l'API vera "
                    "(POST /operatore): approva subito le decisioni precedenti, poi si ferma sulla proposta che sposta "
                    f"la folla da {ZONA} e la approva dopo aver reso la sala.",
            "nota": "Folla, imprese e offerte sono SIMULATE (stima della città e imprese di fantasia); niente LLM "
                    "(regole). La sala è resa con il layout vero di citta/sala.py; il gemello SUMO è spento, quindi i "
                    "pannelli dei semafori e dei KPI restano in attesa, e nessun dispositivo è collegato (Sensori reali "
                    "vuoto).",
            "terminale": {"colonne": COLONNE, "righe": RIGHE},
        },
        "proposta": {
            "id": obiettivo["id"], "ora": obiettivo["ora"], "stato": obiettivo.get("stato"), "fonte": obiettivo.get("fonte"),
            "sintesi": obiettivo.get("sintesi"), "motivazione": obiettivo.get("motivazione"),
            "azioni": obiettivo.get("azioni"),
            "messaggio_alla_sala": proposta_dialogo,
        },
        "approvazione": approvazione,
        "eseguita": {k: eseguita.get(k) for k in ("id", "ora", "stato", "fonte")},
        "avviso": avviso,
        "notifica_a_marta": notifica,
        "uguale_alla_chat": bool(avviso and testo_chat and avviso.get("testo") == testo_chat),
        "avviso_nella_chat": testo_chat,
        "folla_alla_proposta": folla,
        "dialogo_prima": righe_dialogo(contesto[0] if contesto else n_dialogo, n_dialogo),
        "dialogo_dopo": righe_dialogo(n_dialogo),
        "decisioni_approvate_prima": approvate,
        "domande_di_marta": risposte,
        "sala": {"prima": "sala-prima.svg", "dopo": "sala-dopo.svg", "colonne": COLONNE, "righe": RIGHE},
    }
    try:  # senza geometria o evidenze la scena mostra la sala senza riquadri
        risultato["sala"]["geometria"] = geometria(svg_dopo, "saladopo")
        risultato["sala"]["evidenze_dopo"] = evidenze(testo_dopo)
    except (ValueError, AttributeError, StopIteration, IndexError) as e:
        print(f"ATTENZIONE: riquadri della sala non calcolati ({e!r})", file=sys.stderr)
    (uscita / "sala-prima.svg").write_text(svg_prima, encoding="utf-8")
    (uscita / "sala-dopo.svg").write_text(svg_dopo, encoding="utf-8")
    (uscita / "decisione.json").write_text(json.dumps(risultato, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if os.environ.get("C5_TESTO_SALA"):  # per controllo a occhio: la sala in testo semplice
        Path(os.environ["C5_TESTO_SALA"]).write_text(f"{testo_prima}\n\n{'=' * COLONNE}\n\n{testo_dopo}", encoding="utf-8")
    print(f"Scritti {uscita / 'decisione.json'}, sala-prima.svg, sala-dopo.svg · avviso "
          f"{'uguale a' if risultato['uguale_alla_chat'] else 'DIVERSO da'} quello della chat", file=sys.stderr)
    sys.stdout.flush()
    sys.stderr.flush()
    os._exit(0)  # come avvia.py: agenti e orologio sono thread demoni senza arresto


if __name__ == "__main__":
    main()
