#!/usr/bin/env python3
"""Voce sintetica di prova del video di TwinCIRO, con ElevenLabs: c5-presentazione/audio/voce-sintetica/.

Per ogni battuta di scene/scaletta.json genera NN-<scena>-K.m4a con la voce di chi la legge (Roberto o Mario) e scrive
indice.json: testo della battuta, testo mandato alla sintesi, voce, modello, impostazioni e durata. monta.py usa questi
file solo per le battute non registrate in girato/voce/, e solo se il testo della battuta è ancora quello di
indice.json: una battuta cambiata nella scaletta resta muta finché non la rigeneri con questo script.

Si rifanno solo le battute nuove o cambiate: stesso testo per la sintesi, voce, modello e impostazioni vuol dire stesso
file (se una scena cambia posizione, il file si rinomina e basta). Dopo una modifica alla scaletta si spendono solo i
caratteri delle battute cambiate. Se una battuta non entra nel suo spazio (lo stesso controllo di monta.py), la si
riprova un po' più svelta, fino a speed 1.1; se ancora non entra, lo dice.

La chiave di ElevenLabs si legge dalla variabile ELEVENLABS_API_KEY, oppure dal file indicato in
ELEVENLABS_API_KEY_FILE (fuori dalla repo, chmod 600): mai nei file della repo, e meglio non scriverla sulla riga di
comando (finirebbe nella cronologia della shell). Basta il permesso di sintesi (text to speech).

  read -rs ELEVENLABS_API_KEY && export ELEVENLABS_API_KEY       # incolla la chiave: non si vede e non resta salvata
  python3 scene/voce_sintetica.py                                # genera le battute nuove o cambiate
  python3 scene/voce_sintetica.py --prova                        # dice cosa farebbe, senza chiamare ElevenLabs
  python3 scene/voce_sintetica.py --solo 06-chat-2,13-fastweb-3  # rifà queste anche se uguali
  python3 scene/voce_sintetica.py --importa CARTELLA --testi testi-tts.json   # prende file già generati (stesse voci)
  python3 scene/voce_sintetica.py --pulisci                      # toglie i file che nessuna battuta usa più

Le parole difficili si scrivono per la sintesi come in SINTESI, provate con le voci scelte il 15/11: per esempio
«TwinCIRO» → «Twin Ciro», «MQTT» → «emme cu ti ti», «1.900» → «millenovecento». Dopo ./monta.sh rifà il video.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

QUI = Path(__file__).resolve().parent
sys.path.insert(0, str(QUI))
import monta as M  # noqa: E402  (stessi nomi dei file, tempi e controlli del montaggio)

CARTELLA = M.AUDIO / "voce-sintetica"
INDICE = CARTELLA / "indice.json"
URL = "https://api.elevenlabs.io/v1/text-to-speech/{voce}?output_format=mp3_44100_128"
MOTORE = "ElevenLabs"
MODELLO = "eleven_multilingual_v2"
# Voci predefinite di ElevenLabs (le uniche usabili con una chiave di sola sintesi), scelte il 15/11 confrontando
# 13 voci maschili in italiano con trascrizione automatica, durata e altezza della voce.
# Riserva provata: Brian (nPczCjzI2devNBz1zQrb) per Roberto e Daniel (onwK4e9ZLuTAKqWW03F9) per Mario.
VOCI = {
    "Roberto": {"nome": "George", "voice_id": "JBFqnCBsd6RMkjVDRZzb"},
    "Mario": {"nome": "Eric", "voice_id": "cjVigY5qzO86Huf0OWal"},
}
IMPOSTAZIONI = {"stability": 0.5, "similarity_boost": 0.75, "style": 0.0, "use_speaker_boost": True}
SEED = 2026                  # stesso seme = stessa lettura, se si rigenera una battuta uguale
SPEED = (1.0, 1.05, 1.1)     # se una battuta non entra nel suo spazio si riprova più svelta, fino a 1.1

# Come scrivere le parole difficili per ElevenLabs (prove del 15/11). Si sostituiscono solo parole intere, con le
# maiuscole esatte («AI» sì, la preposizione «ai» no), anche dopo un apostrofo («dall'API» → «dall'a pi i»).
# La punteggiatura resta: virgole, due punti e punti e virgola danno le pause.
SINTESI = {
    "TwinCIRO": "Twin Ciro",           # con «Tuìn Cìro» alcune voci dicono «tu in ciro»; CIRO maiuscolo si leggerebbe a lettere
    "MQTT": "emme cu ti ti",
    "IoT": "ai o ti",
    "API": "a pi i",
    "AI": "a ì",                       # con «a i» la i si fonde con la parola dopo («l'AI italiana»)
    "MIIA": "emme i i a",
    "WHY2025": "uài duemilaventicinque",
    "1.900": "millenovecento",         # col punto delle migliaia si rischia «uno punto novecento»
    "Diaz": "Dìaz",
    "Tasmota": "Tasmòta",
    "badge": "bèdge",                  # scritto «badge» la b esce sorda, all'inglese, e si sente «page»
}
# Eccezioni per contesto: se la battuta contiene la chiave, la parola si scrive così. Nel titolo TwinCIRO è seguito
# dall'inglese e «Twin Ciro» diventa «Twin Zero»; «Tuìn Cìro» no.
CONTESTO = [("City Intelligence", "TwinCIRO", "Tuìn Cìro")]
# Battute che ElevenLabs sbaglia lette tutte intere: il file in cartella è stato composto da più richieste (15/11).
# Finché il testo resta questo lo script non le rigenera da solo (si perderebbe la correzione); con --solo le rifà
# intere, e allora vanno riascoltate.
COMPOSTE = {
    "TwinCIRO: City Intelligence and Responsive Orchestration.":
        "«Twin Ciro.» tagliato alla pausa dalla richiesta «Twin Ciro. Napoli che ci pensa.», 0,25 s di silenzio, poi"
        " «City Intelligence and Responsive Orchestration.» chiesto a parte: letta tutta insieme, con qualsiasi grafia,"
        " «Ciro» diventava «Zero».",
}


def schema(parola: str) -> re.Pattern:
    """Parola intera, maiuscole esatte, anche dopo un apostrofo; «1.900» non prende «11.900» né «1.9001»."""
    return re.compile(r"(?<![\w.])" + re.escape(parola) + r"(?![\w]|[.,]\d)")


SCHEMI = [(p, schema(p)) for p in sorted(SINTESI, key=len, reverse=True)]


def per_la_sintesi(testo: str) -> str:
    eccezioni = {parola: scritta for chiave, parola, scritta in CONTESTO if chiave in testo}
    for parola, rx in SCHEMI:
        testo = rx.sub(eccezioni.get(parola, SINTESI[parola]), testo)
    return re.sub(r"\s+", " ", testo.replace("’", "'")).strip()


def impronta(testo_sintesi: str, voce_id: str) -> str:
    dati = json.dumps([testo_sintesi, voce_id, MODELLO, IMPOSTAZIONI, SEED], ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(dati.encode("utf-8")).hexdigest()[:16]


def chiave_api() -> str:
    chiave = os.environ.get("ELEVENLABS_API_KEY", "").strip()
    if not chiave and os.environ.get("ELEVENLABS_API_KEY_FILE"):
        chiave = Path(os.environ["ELEVENLABS_API_KEY_FILE"]).read_text(encoding="utf-8").strip()
    if not chiave:
        sys.exit("Manca la chiave di ElevenLabs: read -rs ELEVENLABS_API_KEY && export ELEVENLABS_API_KEY, poi rilancia"
                 " (oppure ELEVENLABS_API_KEY_FILE con un file fuori dalla repo)")
    return chiave


def sintetizza(testo: str, voce_id: str, speed: float, chiave: str) -> bytes:
    corpo = {"text": testo, "model_id": MODELLO, "language_code": "it", "seed": SEED,
             "voice_settings": {**IMPOSTAZIONI, "speed": speed}}
    richiesta = urllib.request.Request(URL.format(voce=voce_id), data=json.dumps(corpo).encode("utf-8"), method="POST",
                                       headers={"xi-api-key": chiave, "Content-Type": "application/json",
                                                "Accept": "audio/mpeg"})
    for tentativo in range(3):
        try:
            with urllib.request.urlopen(richiesta, timeout=90) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            messaggio = e.read()[:300].decode("utf-8", "replace")
            if e.code in (429, 500, 502, 503) and tentativo < 2:
                time.sleep(5 * (tentativo + 1))
                continue
            sys.exit(f"ElevenLabs ha risposto {e.code}: {messaggio}")
        except urllib.error.URLError as e:
            if tentativo < 2:
                time.sleep(5)
                continue
            sys.exit(f"ElevenLabs non risponde: {e.reason}")
    sys.exit("ElevenLabs non risponde")


def in_m4a(sorgente: Path, uscita: Path) -> None:
    M.esegui(["ffmpeg", "-y", "-loglevel", "error", "-i", str(sorgente), "-ac", "1", "-ar", "48000",
              "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", str(uscita)])


def misura(file: Path, sc, k: int, lavoro: Path) -> tuple[float, float, str | None]:
    """Parlato e spazio della battuta, con lo stesso controllo di monta.py (silenzio tolto, volume a -16 LUFS)."""
    p = M.Pezzo(file, sc, k, sintetica=True)
    avviso = M.prepara_pezzo(p, lavoro)
    return (p.parlato if p.wav else 0.0), p.spazio, avviso


def principale() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--prova", action="store_true", help="dice cosa farebbe, senza chiamare ElevenLabs")
    ap.add_argument("--solo", default="", help="battute da rifare comunque, per esempio 06-chat-2,13-fastweb-3")
    ap.add_argument("--importa", type=Path, help="cartella con NN-<scena>-K.wav già generati con le stesse voci")
    ap.add_argument("--testi", type=Path, help="con --importa: il testi-tts.json usato per generarli (controlla i testi)")
    ap.add_argument("--pulisci", action="store_true",
                    help="toglie i file che non corrispondono più a nessuna battuta (senza, li elenca e basta)")
    a = ap.parse_args()
    if a.importa and not a.testi:
        ap.error("--importa vuole anche --testi: il testi-tts.json con cui sono stati generati i file, per controllare i testi")
    for chi, v in VOCI.items():
        if not v["voice_id"]:
            sys.exit(f"Manca la voce di {chi} in VOCI")

    scaletta = json.loads((QUI / "scaletta.json").read_text(encoding="utf-8"))
    piano = M.piano_video([s for s in scaletta["scene"] if not s.get("salta")])
    vecchie: dict = {}
    if INDICE.exists():
        try:
            vecchie = json.loads(INDICE.read_text(encoding="utf-8")).get("battute", {})
            if not isinstance(vecchie, dict):
                raise ValueError("«battute» non è un oggetto")
        except (OSError, ValueError, AttributeError) as e:
            sys.exit(f"{M.relativo(INDICE)} non si legge ({e}): ripristinalo prima di rigenerare, se no si perdono i file"
                     " già fatti (git checkout -- c5-presentazione/audio/voce-sintetica/indice.json)")
        vecchie = {n: v for n, v in vecchie.items() if isinstance(v, dict)}
    per_impronta = {v.get("impronta"): n for n, v in vecchie.items() if (CARTELLA / str(v.get("file", ""))).is_file()}
    nomi_attuali = {f"{sc.base}-{b.k}" for sc in piano for b in sc.battute}
    solo = {s.strip() for s in a.solo.split(",") if s.strip()}
    testi_importati = {}
    if a.importa and a.testi:
        testi_importati = {b["file"]: b["testo_tts"] for b in json.loads(a.testi.read_text(encoding="utf-8"))["battute"]}

    CARTELLA.mkdir(parents=True, exist_ok=True)
    chiave = None
    nuove, fatte, caratteri, avvisi = {}, [], 0, []
    with tempfile.TemporaryDirectory(prefix="voce-sintetica-") as tmp:
        lavoro = Path(tmp)
        # Le rinomine copiano da qui: nello stesso giro un file può essere già stato riscritto da un'altra battuta
        originali = lavoro / "originali"
        originali.mkdir()
        for f in CARTELLA.glob("*.m4a"):
            shutil.copy2(f, originali / f.name)
        for sc in piano:
            for b in sc.battute:
                nome = f"{sc.base}-{b.k}"
                if b.chi not in VOCI:
                    sys.exit(f"{nome}: nessuna voce per «{b.chi}» in VOCI")
                voce = VOCI[b.chi]
                testo_s = per_la_sintesi(b.testo)
                imp = impronta(testo_s, voce["voice_id"])
                file = CARTELLA / f"{nome}.m4a"
                voce_info = {"testo": b.testo, "testo_sintesi": testo_s, "chi": b.chi, "voce": voce["nome"],
                             "file": file.name, "impronta": imp}
                if b.testo in COMPOSTE:
                    voce_info["composta"] = COMPOSTE[b.testo]
                vecchia = vecchie.get(nome)
                if nome not in solo and vecchia and vecchia.get("impronta") == imp and file.is_file():
                    nuove[nome] = {**vecchia, **voce_info}
                    continue
                if nome not in solo and imp in per_impronta:             # stessa battuta, scena spostata: rinomina
                    if not a.prova:
                        shutil.copy2(originali / vecchie[per_impronta[imp]]["file"], file)
                    nuove[nome] = {**vecchie[per_impronta[imp]], **voce_info}
                    fatte.append(f"{nome}: ripresa da {per_impronta[imp]}")
                    continue
                if a.importa:
                    wav = a.importa / f"{nome}.wav"
                    if not wav.is_file():
                        avvisi.append(f"{nome}: non c'è {wav.name} da importare")
                        continue
                    if testi_importati and testi_importati.get(nome) != testo_s:
                        avvisi.append(f"{nome}: generata con un testo diverso («{testi_importati.get(nome)}»): non la importo")
                        continue
                    if not a.prova:
                        in_m4a(wav, file)
                        parlato, spazio, avviso = misura(file, sc, b.k, lavoro)
                        if avviso:
                            avvisi.append(avviso)
                        nuove[nome] = {**voce_info, "speed": None, "parlato_s": round(parlato, 2), "spazio_s": round(spazio, 2),
                                       "importata": True}
                    fatte.append(f"{nome}: importata da {wav}")
                    continue
                if b.testo in COMPOSTE and nome not in solo:
                    avvisi.append(f"{nome}: va composta a mano ({COMPOSTE[b.testo]}); per rifarla intera: --solo {nome}")
                    if vecchia and file.is_file():
                        nuove[nome] = vecchia
                    continue
                caratteri += len(testo_s)
                if a.prova:
                    fatte.append(f"{nome}: da generare ({len(testo_s)} caratteri) «{testo_s}»")
                    continue
                chiave = chiave or chiave_api()
                for speed in SPEED:
                    mp3 = lavoro / f"{nome}.mp3"
                    mp3.write_bytes(sintetizza(testo_s, voce["voice_id"], speed, chiave))
                    in_m4a(mp3, file)
                    parlato, spazio, avviso = misura(file, sc, b.k, lavoro)
                    if parlato <= spazio + 0.05:
                        break
                    if speed != SPEED[-1]:
                        caratteri += len(testo_s)
                if parlato > spazio + 0.05:
                    avvisi.append(f"{nome}: anche a speed {speed} dura {parlato:.2f} s e ha {spazio:.2f} s: accorcia la battuta o allunga i tempi")
                nuove[nome] = {**voce_info, "speed": speed, "parlato_s": round(parlato, 2), "spazio_s": round(spazio, 2)}
                fatte.append(f"{nome}: generata (speed {speed}, {parlato:.2f} s su {spazio:.2f} s)")

    # File che non corrispondono più a nessuna battuta (scene tolte o saltate): si tolgono solo con --pulisci,
    # così una scena saltata e poi rimessa non perde la sua voce; monta.py usa solo i file elencati in indice.json
    orfani = [f.name for f in sorted(CARTELLA.glob("*.m4a")) if f.stem not in nomi_attuali]
    if not a.prova:
        if a.pulisci:
            for nome_file in orfani:
                (CARTELLA / nome_file).unlink()
        if json.dumps(nuove, sort_keys=True) != json.dumps(vecchie, sort_keys=True) or not INDICE.exists():
            INDICE.write_text(json.dumps({
                "nota": "Scritto da scene/voce_sintetica.py: non modificarlo a mano. monta.py usa un file solo se è"
                        " elencato qui e se \"testo\" e \"chi\" sono ancora quelli della battuta nella scaletta.",
                "motore": MOTORE, "modello": MODELLO, "voci": VOCI, "impostazioni": IMPOSTAZIONI, "seed": SEED,
                "aggiornato": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
                "battute": dict(sorted(nuove.items())),
            }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    for riga in fatte:
        print(f"  {riga}")
    for riga in avvisi:
        print(f"  ! {riga}")
    if orfani:
        if a.pulisci and not a.prova:
            print(f"  tolti {len(orfani)} file che nessuna battuta usa più: {', '.join(orfani)}")
        else:
            print(f"  {len(orfani)} file non corrispondono più a nessuna battuta: {', '.join(orfani)}"
                  " (restano, monta.py non li usa; per toglierli --pulisci)")
    tot = sum(len(sc.battute) for sc in piano)
    print(f"{'Prova: ' if a.prova else ''}{len(fatte)} battute {'da fare' if a.prova else 'fatte'} su {tot},"
          f" {caratteri} caratteri {'da mandare' if a.prova else 'mandati'} a ElevenLabs. Cartella: {M.relativo(CARTELLA)}")


if __name__ == "__main__":
    principale()
