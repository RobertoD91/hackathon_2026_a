#!/usr/bin/env python3
"""Monta il video di consegna di TwinCIRO (bozza.mp4) a partire da scene/scaletta.json.

Per ogni scena:
- sorgente generata (cartelli, architettura, chat di CiroGPT) con scene/rendi_html.mjs,
  registrazione della mappa con scene/registra_mappa.mjs, oppure spezzone di un video esistente;
- se in girato/ c'è la ripresa vera indicata in "girato" (es. girato/badge.mp4), usa quella;
- testata (etichetta + testo) e velo sopra i video, dissolvenze brevi.
Poi unisce le scene, imprime i sottotitoli della voce fuori campo (ASS), aggiunge la voce ed eventuale
musica libera da diritti (girato/musica.*), e codifica in due passate per restare sotto i 40 MB.

Accanto alla bozza scrive, per rimontare a mano (NN = posizione nella scaletta, <scena> = id senza il numero davanti):
- clip/NN-<scena>.mp4: ogni scena come clip a sé, senza sottotitoli: H.264 (CRF 20) con l'audio del montaggio;
- clip/NN-<scena>.srt (tempi dall'inizio della clip) e clip/sottotitoli.srt (tempi del video intero);
- clip/00-finale-senza-sottotitoli.mp4 (il video intero, le clip unite), clip/elenco.txt, clip/LEGGIMI.md;
- voce/NN-<scena>.txt e voce/COPIONE-VOCE.md: le battute in ordine, chi le legge, tempi e durata disponibile.
  Chi legge: campo "chi" di ogni voce della scaletta ("Roberto" o "Mario"; se manca, "Roberto").

Voce registrata, in tre modi che si possono mescolare:
- girato/voce.m4a: tutto il video in un file (con --voce-da si saltano i primi secondi);
- girato/voce/NN-<scena>.m4a: una clip in un file, la prima parola va al tempo della prima battuta;
- girato/voce/NN-<scena>-K.m4a: la battuta K della scena, messa al tempo del suo sottotitolo.
I file di girato/voce/ prendono il posto di girato/voce.m4a nelle loro scene (in una scena i file per battuta
vincono su quello della clip); il silenzio all'inizio e alla fine si toglie da solo e ogni file va allo stesso volume.
Il numero davanti al nome del file non conta: vale il nome della scena (o l'id intero).

  python3 scene/monta.py                      # usa le sorgenti già generate (cache) e rifà il montaggio
  python3 scene/monta.py --rigenera           # rigenera tutte le scene HTML (non la mappa)
  python3 scene/monta.py --rigenera-mappa     # registra di nuovo la mappa (dati live)
  python3 scene/monta.py --solo-clip          # rifà clip, SRT, testi e 00-finale-senza-sottotitoli, non bozza.mp4
  python3 scene/monta.py --solo-testi         # rifà solo voce/ (battute e copione) e controlla tempi e ritmo, senza video
  python3 scene/monta.py --senza-sottotitoli  # niente sottotitoli impressi
  python3 scene/monta.py --controllo          # alla fine estrae un fotogramma ogni 5 s
  python3 scene/monta.py --segnaposto         # dove manca una ripresa vera mostra il cartello "Qui va una ripresa reale"
                                              # (senza: usa la scena di riserva indicata in "sorgente")

Nella scaletta una scena con "salta": true resta descritta ma non entra nel video.

Variabili: C5_VIDEO_LAVORO (cartella dei file intermedi, predefinita /tmp/c5-video-lavoro),
C5_VIDEO_GIRATO (cartella delle riprese, predefinita c5-presentazione/girato),
C5_VIDEO_CLIP (cartella delle clip, predefinita c5-presentazione/clip),
C5_VIDEO_TESTI_VOCE (cartella dei testi della voce, predefinita c5-presentazione/voce),
C5_URL_MAPPA (URL della mappa; se manca la serve in locale dalla root della repo).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import textwrap
import time
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path

QUI = Path(__file__).resolve().parent          # c5-presentazione/scene
VIDEO = QUI.parent                             # c5-presentazione
REPO = VIDEO.parent
GIRATO = Path(os.environ.get("C5_VIDEO_GIRATO", VIDEO / "girato"))   # riprese vere, voce, musica
LAVORO = Path(os.environ.get("C5_VIDEO_LAVORO", "/tmp/c5-video-lavoro"))
CLIP = Path(os.environ.get("C5_VIDEO_CLIP", VIDEO / "clip"))                 # clip per scena e SRT (nel repository)
TESTI_VOCE = Path(os.environ.get("C5_VIDEO_TESTI_VOCE", VIDEO / "voce"))    # battute da leggere (nel repository)
ESTENSIONI_VIDEO = (".mp4", ".mov", ".m4v", ".webm", ".mkv")
ESTENSIONI_AUDIO = (".m4a", ".wav", ".mp3", ".aac", ".ogg", ".flac")
W, H, FPS = 1920, 1080, 30
SCHERMO_TEL = (170, 79, 430, 850)               # riquadro dentro lo schermo del telefono di chat.html
LIMITE_MB = 40
OBIETTIVO_MB = 36
CARTELLI: dict = {}   # testi dei cartelli da scaletta.json (per la chiave della cache)
OPZIONI = {"segnaposto": False}

# Clip per rimontare: stessa codifica del finale (H.264 High 4:2:0, 1920×1080, 30 fps, AAC 48 kHz stereo) ma a qualità costante
CLIP_CRF = 20
CLIP_VIDEO = ["-c:v", "libx264", "-preset", "slow", "-crf", str(CLIP_CRF), "-pix_fmt", "yuv420p", "-r", str(FPS)]
FINALE_PULITO = "00-finale-senza-sottotitoli.mp4"
VOCI = ("Roberto", "Mario")           # chi legge: campo "chi" delle voci della scaletta (predefinito il primo)
RITMO_MAX = 180                       # parole al minuto (6 sillabe al secondo) oltre le quali una battuta è troppo veloce
VOLUME_VOCE = -16.0                   # LUFS: lo stesso obiettivo di loudnorm sulla voce intera
GUADAGNO_MAX = 25.0                   # dB: oltre, una registrazione troppo bassa porterebbe su soprattutto il rumore
SILENZIO_PRIMA, SILENZIO_DOPO = 0.08, 0.25   # secondi di silenzio lasciati prima della prima parola e dopo l'ultima
# Come si leggono le parole difficili (per il copione e per contare le parole); "pronuncia" nella scaletta le integra
PRONUNCIA = {
    "TwinCIRO": "tuìn cìro",
    "CiroGPT": "cìro gi pi ti",
    "WHY2025": "uài duemilaventicinque",
    "Wi-Fi": "uài fai",
    "MQTT": "emme cu ti ti",
    "OpenClaw": "open clò",
    "5G": "cinque gi",
    "IoT": "ai o ti",
    "API": "a pi i",
    "LLM": "elle elle emme",
    "GPT": "gi pi ti",
    "ESP32": "e esse pi trentadue",
    "Tasmota": "tasmòta",
}


def esegui(cmd: list[str], **kw) -> None:
    r = subprocess.run(cmd, **kw)
    if r.returncode != 0:
        sys.exit(f"Comando fallito ({r.returncode}): {' '.join(map(str, cmd))[:400]}")


def ffprobe(file: Path, voce: str) -> str:
    return subprocess.run(["ffprobe", "-v", "error", "-show_entries", voce, "-of", "default=nw=1:nk=1", str(file)],
                          capture_output=True, text=True).stdout.strip()


def durata_di(file: Path) -> float:
    try:
        return float(ffprobe(file, "format=duration"))
    except ValueError:
        return 0.0


def dimensioni(file: Path) -> tuple[int, int]:
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
                          "-of", "csv=p=0", str(file)], capture_output=True, text=True).stdout.strip().split(",")
    return int(out[0]), int(out[1])


def trova(nome: str, estensioni: tuple[str, ...]) -> Path | None:
    for e in estensioni:
        for f in (GIRATO / f"{nome}{e}", GIRATO / f"{nome}{e.upper()}"):
            if f.exists():
                return f
    return None


def chiave(*parti) -> str:
    h = hashlib.sha1()
    for p in parti:
        h.update(p.read_bytes() if isinstance(p, Path) else str(p).encode())
    return h.hexdigest()[:12]


def rendi_html(pagina: str, uscita: Path, durata: float | None = None, png: bool = False, trasparente: bool = False,
               t: float = 30) -> None:
    cmd = ["node", str(QUI / "rendi_html.mjs"), pagina, str(uscita)]
    if png:
        cmd += ["--png", "--t", str(t)] + (["--trasparente"] if trasparente else [])
    elif durata:
        cmd += ["--durata", str(durata)]
    esegui(cmd, cwd=QUI)


def porta_libera() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Sorgenti:
    """Genera (o riprende dalla cache) le sorgenti delle scene."""

    def __init__(self, rigenera: bool, rigenera_mappa: bool) -> None:
        self.dir = LAVORO / "sorgenti"
        self.dir.mkdir(parents=True, exist_ok=True)
        self.rigenera, self.rigenera_mappa = rigenera, rigenera_mappa
        # La cache dipende solo da ciò che la scena usa davvero: cambiare un'altra scena non la rigenera
        self.comuni = [QUI / "stile.css", QUI / "rendi_html.mjs"]

    def html(self, pagina: str, durata: float, file_pagina: Path, *altri, dati: object = None) -> Path:
        k = chiave(pagina, durata, file_pagina, *self.comuni, *altri, json.dumps(dati, sort_keys=True))
        uscita = self.dir / f"{Path(pagina.split('?')[0]).stem}-{k}.mp4"
        if self.rigenera or not uscita.exists():
            print(f"  genero {pagina} ({durata:g} s)…", flush=True)
            rendi_html(pagina, uscita, durata)
        return uscita

    def png(self, pagina: str, nome: str, dati: object = None) -> Path:
        # chat.json nella chiave: la notifica di CiroGPT ne riprende il testo dell'avviso
        k = chiave(pagina, QUI / "cartelli.html", QUI / "chat.json", *self.comuni, json.dumps(dati, sort_keys=True))
        uscita = self.dir / f"{nome}-{k}.png"
        if self.rigenera or not uscita.exists():
            rendi_html(pagina, uscita, png=True, trasparente=True, t=30)
        return uscita

    def mappa(self) -> Path:
        uscita = self.dir / "mappa.mp4"
        if uscita.exists() and not self.rigenera_mappa:
            return uscita
        url = os.environ.get("C5_URL_MAPPA")
        server = None
        if not url:
            porta = porta_libera()
            server = subprocess.Popen([sys.executable, "-m", "http.server", str(porta), "--bind", "127.0.0.1",
                                       "--directory", str(REPO)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            url = f"http://127.0.0.1:{porta}/c5-presentazione/mappa/"
            time.sleep(1.0)
        try:
            print(f"  registro la mappa da {url} (circa 40 s)…", flush=True)
            esegui(["node", str(QUI / "registra_mappa.mjs"), url, str(uscita), "24"], cwd=QUI)
        finally:
            if server:
                server.terminate()
        return uscita


def filtro_base(entrata: str, durata: float, da: float = 0.0, ritaglio: list | None = None) -> str:
    """Normalizza un video in 1920×1080 a 30 fps, lungo esattamente `durata` (fermo sull'ultimo fotogramma se serve).
    `ritaglio` = [x, y, larghezza, altezza] da ingrandire (per togliere titoli e riquadri dei video già pronti)."""
    crop = f"crop={ritaglio[2]}:{ritaglio[3]}:{ritaglio[0]}:{ritaglio[1]}," if ritaglio else ""
    return (f"{entrata}trim=start={da:.3f},setpts=PTS-STARTPTS,{crop}"
            f"scale={W}:{H}:force_original_aspect_ratio=decrease,pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:color=0x0a1020,"
            f"fps={FPS},setsar=1,tpad=stop_mode=clone:stop_duration={durata:.3f},trim=duration={durata:.3f},setpts=PTS-STARTPTS")


def monta_scena(sc: dict, i: int, n: int, sorg: Sorgenti, dissolvenza: float) -> tuple[Path, str]:
    d = float(sc["durata"])
    s = sc["sorgente"]
    girato_cfg = sc.get("girato") or {}
    girato = trova(girato_cfg["file"], ESTENSIONI_VIDEO) if girato_cfg else None
    ingressi: list[list[str]] = []
    filtri: list[str] = []
    descrizione = ""

    def ingresso(args: list[str]) -> int:
        ingressi.append(args)
        return len(ingressi) - 1

    def ripresa() -> str:
        """Etichetta della ripresa vera: dal secondo "da", oppure i "pezzi" [[inizio, fine], ...] uniti in fila."""
        g = ingresso(["-i", str(girato)])
        pezzi = girato_cfg.get("pezzi")
        if pezzi:
            for k, (p0, p1) in enumerate(pezzi):
                filtri.append(f"[{g}:v]trim=start={p0}:end={p1},setpts=PTS-STARTPTS,fps={FPS},setsar=1[p{k}]")
            filtri.append("".join(f"[p{k}]" for k in range(len(pezzi))) + f"concat=n={len(pezzi)}:v=1:a=0[gr]")
        else:
            filtri.append(f"[{g}:v]trim=start={girato_cfg.get('da', 0)},setpts=PTS-STARTPTS,fps={FPS},setsar=1[gr]")
        return "[gr]"

    if girato and girato_cfg.get("modo") == "telefono":
        sfondo = sorg.html(f"chat.html?durata={d:g}&telefono=vuoto", d, QUI / "chat.html", QUI / "chat.json")
        a = ingresso(["-i", str(sfondo)])
        gr = ripresa()
        x, y, w, h = SCHERMO_TEL
        filtri.append(filtro_base(f"[{a}:v]", d) + "[b]")
        filtri.append(f"{gr}scale={w}:{h}:force_original_aspect_ratio=decrease,"
                      f"tpad=stop_mode=clone:stop_duration={d:.3f},trim=duration={d:.3f},setpts=PTS-STARTPTS[g]")
        filtri.append(f"[b][g]overlay=x={x}+({w}-overlay_w)/2:y={y}+({h}-overlay_h)/2[v0]")
        descrizione = f"ripresa vera {girato.name} nel telefono"
    elif girato:
        gr = ripresa()
        gw, gh = dimensioni(girato)
        if gw / gh >= 1.3:   # orizzontale: riempie lo schermo
            filtri.append(f"{gr}scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},"
                          f"tpad=stop_mode=clone:stop_duration={d:.3f},trim=duration={d:.3f},setpts=PTS-STARTPTS[v0]")
        else:                # verticale: al centro su uno sfondo sfocato dello stesso video
            filtri.append(f"{gr}tpad=stop_mode=clone:stop_duration={d:.3f},trim=duration={d:.3f},"
                          f"setpts=PTS-STARTPTS,split[g1][g2]")
            filtri.append(f"[g1]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},boxblur=30:2,"
                          f"eq=brightness=-0.25[sf]")
            filtri.append(f"[g2]scale=-2:{H}[pp]")
            filtri.append("[sf][pp]overlay=(W-w)/2:0[v0]")
        descrizione = f"ripresa vera {girato.name}"
    else:
        if OPZIONI["segnaposto"] and sc.get("segnaposto"):
            s = {"tipo": "cartello", "id": sc["segnaposto"]}
        tipo = s["tipo"]
        da = 0.0
        if tipo == "cartello":
            file = sorg.html(f"cartelli.html?id={s['id']}", d, QUI / "cartelli.html", dati=CARTELLI.get(s["id"]))
            descrizione = f"cartello {s['id']}" + (" (SEGNAPOSTO: manca la ripresa vera)" if s["id"].startswith("qui-") else "")
        elif tipo == "pagina":
            file = sorg.html(s["pagina"], d, QUI / s["pagina"])
            descrizione = s["pagina"]
        elif tipo == "chat":
            file = sorg.html(f"chat.html?durata={d:g}", d, QUI / "chat.html", QUI / "chat.json")
            descrizione = "chat simulata di CiroGPT (risposte vere dell'API)"
        elif tipo == "mappa":
            file, da = sorg.mappa(), float(s.get("da", 0))
            descrizione = "registrazione della mappa con dati reali"
        elif tipo == "video":
            file, da = (QUI / s["file"]).resolve(), float(s.get("da", 0))
            descrizione = f"spezzone di {file.name} da {da:g} s"
        else:
            sys.exit(f"Tipo di sorgente sconosciuto: {tipo}")
        a = ingresso(["-i", str(file)])
        filtri.append(filtro_base(f"[{a}:v]", d, da, s.get("ritaglio")) + "[v0]")

    if girato_cfg and not girato:
        descrizione += f" · manca girato/{girato_cfg['file']}.mp4" + ("" if OPZIONI["segnaposto"] or s.get("tipo") == "chat" else ": uso la RISERVA")
    ultimo = "v0"
    if s.get("velo") and not girato:
        p = ingresso(["-loop", "1", "-t", str(d), "-i", str(sorg.png(f"cartelli.html?id={s['velo']}", s["velo"], CARTELLI.get(s["velo"])))])
        filtri.append(f"[{ultimo}][{p}:v]overlay=0:0:format=auto[v1]")
        ultimo = "v1"
    for k, sv in enumerate(sc.get("sovrapposti") or []):
        # Riquadro PNG trasparente (da cartelli.html) che entra al secondo "da" ed esce al secondo "a"
        p = ingresso(["-loop", "1", "-t", str(d), "-i", str(sorg.png(f"cartelli.html?id={sv['id']}", sv["id"], CARTELLI.get(sv["id"])))])
        da_, a_ = float(sv.get("da", 0)), float(sv.get("a", d))
        filtri.append(f"[{p}:v]format=rgba,fade=t=in:st={da_:.3f}:d=0.4:alpha=1,"
                      f"fade=t=out:st={max(da_, a_ - 0.4):.3f}:d=0.4:alpha=1[sv{k}]")
        filtri.append(f"[{ultimo}][sv{k}]overlay=0:0:format=auto[w{k}]")
        ultimo = f"w{k}"
    if sc.get("testata"):
        p = ingresso(["-loop", "1", "-t", str(d), "-i", str(sorg.png(f"cartelli.html?id=testata&scena={sc['id']}", f"testata-{sc['id']}", sc["testata"]))])
        # Entra subito (0,3 s, mentre la scena esce dal nero): sotto la testata non si intravede il video
        filtri.append(f"[{p}:v]format=rgba,fade=t=in:st=0:d=0.3:alpha=1[ts]")
        filtri.append(f"[{ultimo}][ts]overlay=0:0:format=auto[v2]")
        ultimo = "v2"
    f_in = 0.6 if i == 0 else dissolvenza
    f_out = 1.0 if i == n - 1 else dissolvenza
    filtri.append(f"[{ultimo}]fade=t=in:st=0:d={f_in},fade=t=out:st={d - f_out:.3f}:d={f_out},format=yuv420p[out]")

    uscita = LAVORO / "scene" / f"{sc['id']}.mp4"
    uscita.parent.mkdir(parents=True, exist_ok=True)
    cmd = ["ffmpeg", "-y", "-loglevel", "error"]
    for a in ingressi:
        cmd += a
    cmd += ["-filter_complex", ";".join(filtri), "-map", "[out]", "-t", f"{d:.3f}", "-r", str(FPS),
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "15", "-pix_fmt", "yuv420p", "-an", str(uscita)]
    esegui(cmd)
    return uscita, descrizione


def tempo_ass(t: float) -> str:
    cs = int(round(t * 100))
    return f"{cs // 360000}:{cs // 6000 % 60:02d}:{cs // 100 % 60:02d}.{cs % 100:02d}"


def sottotitoli(scaletta: dict, file: Path) -> int:
    righe = ["[Script Info]", "ScriptType: v4.00+", f"PlayResX: {W}", f"PlayResY: {H}", "WrapStyle: 0",
             "ScaledBorderAndShadow: yes", "", "[V4+ Styles]",
             "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, "
             "Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, "
             "MarginR, MarginV, Encoding",
             # Riquadro scuro semitrasparente (BorderStyle 3), in basso al centro, nei 130 px lasciati liberi dalle scene
             "Style: Voce,Inter SemiBold,40,&H00FFFFFF,&H000000FF,&H38140A0A,&H00000000,0,0,0,0,100,100,0,0,3,12,0,2,300,300,30,1",
             "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"]
    inizio, n = 0.0, 0
    for sc in scaletta["scene"]:
        for v in sc.get("voce", []):
            testo = v["testo"].replace("{", "(").replace("}", ")").replace("\n", "\\N")
            righe.append(f"Dialogue: 0,{tempo_ass(inizio + v['da'])},{tempo_ass(inizio + v['a'])},Voce,,0,0,0,,{testo}")
            n += 1
        inizio += float(sc["durata"])
    file.write_text("\n".join(righe) + "\n", encoding="utf-8")
    return n


# ---------------------------------------------------------------------------------------------------------------------
# Piano del video: scene in ordine, con posizione, nome dei file, inizio nel video e battute della voce
# ---------------------------------------------------------------------------------------------------------------------

@dataclass
class Battuta:
    k: int            # numero della battuta nella scena (da 1)
    da: float         # secondi dall'inizio della scena, come nella scaletta
    a: float
    testo: str
    chi: str


@dataclass
class Scena:
    pos: int          # posizione nella scaletta (da 1), senza le scene saltate
    id: str
    nome: str         # id senza il numero davanti: nome dei file
    inizio: float     # secondi dall'inizio del video
    durata: float
    battute: list[Battuta] = field(default_factory=list)

    @property
    def base(self) -> str:
        return f"{self.pos:02d}-{self.nome}"

    @property
    def fine(self) -> float:
        return self.inizio + self.durata


def nome_scena(id_scena: str) -> str:
    """'03-cirogpt' → 'cirogpt'; solo minuscole, cifre e trattini (va nei nomi dei file)."""
    def pulito(s: str) -> str:
        s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
        return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
    return pulito(re.sub(r"^\d+[-_.\s]*", "", id_scena)) or pulito(id_scena) or "scena"


def chi_legge(v: dict) -> str:
    c = str(v.get("chi") or VOCI[0]).strip()
    for nome in VOCI:
        if c.lower() == nome.lower():
            return nome
    return c[:1].upper() + c[1:]


def piano_video(scene: list[dict]) -> list[Scena]:
    """Stessi conti di sottotitoli(): l'inizio di ogni scena è la somma delle durate prima (stessi arrotondamenti)."""
    piano, inizio = [], 0.0
    for pos, sc in enumerate(scene, 1):
        s = Scena(pos, sc["id"], nome_scena(sc["id"]), inizio, float(sc["durata"]))
        s.battute = [Battuta(k, v["da"], v["a"], v.get("testo", ""), chi_legge(v)) for k, v in enumerate(sc.get("voce", []), 1)]
        piano.append(s)
        inizio += float(sc["durata"])
    return piano


def num(x: float, cifre: int = 1) -> str:
    return f"{x:.{cifre}f}".replace(".", ",")


def virgola(x: float) -> str:
    """7.25 → '7,25', 7.0 → '7'"""
    return f"{x:g}".replace(".", ",")


def orario(t: float) -> str:
    """81.5 → '1:21,5'"""
    t = round(t, 1)
    m = int(t // 60)
    return f"{m}:{num(t - 60 * m).zfill(4)}"


def minuti(t: float) -> str:
    """174 → '2:54'"""
    t = int(round(t))
    return f"{t // 60}:{t % 60:02d}"


_UNITA = ("zero uno due tre quattro cinque sei sette otto nove dieci undici dodici tredici quattordici quindici sedici "
          "diciassette diciotto diciannove").split()
_DECINE = "_ _ venti trenta quaranta cinquanta sessanta settanta ottanta novanta".split()


def in_lettere(n: int) -> str:
    """Numero in lettere, quanto basta per contarne le sillabe (2027 → duemilaventisette)."""
    if n < 20:
        return _UNITA[n]
    if n < 100:
        d, u = divmod(n, 10)
        return (_DECINE[d][:-1] if u in (1, 8) else _DECINE[d]) + (_UNITA[u] if u else "")
    if n < 1000:
        c, r = divmod(n, 100)
        return ("cento" if c == 1 else _UNITA[c] + "cento") + (in_lettere(r) if r else "")
    if n < 1_000_000:
        m, r = divmod(n, 1000)
        return ("mille" if m == 1 else in_lettere(m) + "mila") + (in_lettere(r) if r else "")
    return "milioni"


def sillabe(testo: str, pron: dict) -> int:
    """Sillabe come si dicono (gruppi di vocali): sigle e numeri per esteso, MQTT = «emme cu ti ti» = 5."""
    def gruppi(s: str) -> int:
        s = unicodedata.normalize("NFKD", s.lower()).encode("ascii", "ignore").decode()
        return len(re.findall(r"[aeiouy]+", s))
    n = 0
    for tok in testo.split():
        t = tok.strip(".,;:!?«»\"“”‘’()…—–")
        if not t:
            continue
        dopo = re.split(r"['’]", t)[-1]            # «l'API»: conta come si dice API
        if dopo in pron or t in pron:
            n += gruppi(pron.get(dopo) or pron[t])
        elif re.fullmatch(r"\d{1,3}(\.\d{3})*%?|\d+%?", t):
            n += gruppi(in_lettere(int(t.rstrip("%").replace(".", "")))) + (3 if t.endswith("%") else 0)
        else:
            n += max(1, gruppi(t))
    return n


def parole(testo: str) -> int:
    return sum(1 for tok in testo.split() if re.search(r"\w", tok))


def ritmo(b: Battuta, pron: dict) -> int:
    """Parole al minuto «equivalenti»: sillabe al secondo × 30 (in italiano circa 2 sillabe per parola), così una sigla
    lunga da dire pesa per quello che è. 150 = 5 sillabe al secondo."""
    return round(sillabe(b.testo, pron) * 30 / (b.a - b.da)) if b.a > b.da else 0


def controlla_voce(piano: list[Scena], pron: dict) -> list[str]:
    """Battute sovrapposte, fuori dalla scena, troppo veloci; durate che non sono un numero intero di fotogrammi."""
    avvisi = []
    for sc in piano:
        if abs(sc.durata * FPS - round(sc.durata * FPS)) > 1e-6:
            avvisi.append(f"{sc.base}: la durata ({virgola(sc.durata)} s) non è un numero intero di fotogrammi a {FPS} fps")
        prec = None
        for b in sc.battute:
            dove = f"{sc.base}, battuta {b.k}"
            if b.a <= b.da:
                avvisi.append(f"{dove}: finisce prima di cominciare ({virgola(b.da)} → {virgola(b.a)} s)")
            if b.da < 0 or b.a > sc.durata + 1e-6:
                avvisi.append(f"{dove}: esce dalla scena ({virgola(b.da)} → {virgola(b.a)} s, la scena dura {virgola(sc.durata)} s)")
            if prec and b.da < prec.a - 1e-6:
                avvisi.append(f"{dove} ({b.chi}): comincia a {num(b.da)} s, prima che finisca la {prec.k} ({prec.chi}, {num(prec.a)} s)")
            r = ritmo(b, pron)
            if r > RITMO_MAX:
                avvisi.append(f"{dove}: ritmo di circa {r} parole al minuto ({num(r / 30)} sillabe al secondo), troppo veloce"
                              " (obiettivo circa 150): accorcia il testo o allunga i tempi")
            if b.chi not in VOCI:
                avvisi.append(f"{dove}: «chi» è {b.chi!r}, le voci previste sono {' e '.join(VOCI)}")
            prec = b
    return avvisi


# ---------------------------------------------------------------------------------------------------------------------
# Sottotitoli SRT e testi per la voce
# ---------------------------------------------------------------------------------------------------------------------

def tempo_srt(t: float) -> str:
    ms = int(round(t * 100)) * 10      # gli stessi centesimi dell'ASS impresso nella bozza
    return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"


def a_capo(riga: str, larghezza: int = 42) -> list[str]:
    """Una riga lunga diventa due righe equilibrate (taglio a uno spazio, meglio dopo la punteggiatura)."""
    if len(riga) <= larghezza:
        return [riga]
    spazi = [i for i, c in enumerate(riga) if c == " "]
    if not spazi:
        return [riga]
    i = min(spazi, key=lambda i: abs(len(riga[:i]) - len(riga[i + 1:])) - (6 if riga[i - 1] in ",.;:!?»" else 0))
    return [riga[:i], riga[i + 1:]]


def testo_srt(testo: str) -> str:
    # Graffe e <...> negli SRT diventano tag (ffmpeg li toglie): come nell'ASS, si cambiano in simboli innocui
    t = testo.replace("{", "(").replace("}", ")").replace("<", "‹").replace(">", "›")
    righe = [r.strip() for r in t.split("\n") if r.strip()]
    return "\n".join(a_capo(righe[0]) if len(righe) == 1 else righe)


def scrivi_srt(file: Path, eventi: list[tuple[float, float, str]]) -> None:
    file.write_text("".join(f"{i}\n{tempo_srt(da)} --> {tempo_srt(a)}\n{testo_srt(t)}\n\n"
                            for i, (da, a, t) in enumerate(eventi, 1)), encoding="utf-8")


def file_voce_battuta(sc: Scena, b: Battuta) -> str:
    return f"girato/voce/{sc.base}-{b.k}.m4a"


def md_testo(t: str) -> str:
    """Testo di una battuta dentro il Markdown: <id> resterebbe nascosto come tag HTML."""
    return t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def scrivi_testi_voce(piano: list[Scena], totale: float, pron: dict, avvisi: list[str]) -> list[Path]:
    """voce/NN-<scena>.txt (una scena per file, da leggere al microfono) e voce/COPIONE-VOCE.md (tutto, in ordine)."""
    TESTI_VOCE.mkdir(parents=True, exist_ok=True)
    scritti = []
    n = len(piano)
    tutte = [(sc, b) for sc in piano for b in sc.battute]
    for sc in piano:
        righe = [f"TwinCIRO · voce fuori campo · scena {sc.pos:02d} di {n:02d}: {sc.nome}",
                 f"Nel video da {orario(sc.inizio)} a {orario(sc.fine)} · clip clip/{sc.base}.mp4 di {num(sc.durata)} s", ""]
        if not sc.battute:
            righe.append("Scena senza voce.")
        for b in sc.battute:
            righe.append(f"{b.k} · {b.chi.upper()} · da {num(b.da)} a {num(b.a)} s della clip · durata disponibile {num(b.a - b.da)} s"
                         f" · nel video {orario(sc.inizio + b.da)} → {orario(sc.inizio + b.a)}")
            for r in b.testo.split("\n"):
                righe += textwrap.wrap(r, 88, initial_indent="    ", subsequent_indent="    ") or [""]
            righe += [f"    {parole(b.testo)} parole, ritmo di circa {ritmo(b, pron)} al minuto · registra in {file_voce_battuta(sc, b)}", ""]
        if sc.battute:
            righe.append(f"Tutta la scena in un file: girato/voce/{sc.base}.m4a (la prima parola va a {num(sc.battute[0].da)} s"
                         " dall'inizio della clip, il silenzio prima si toglie da solo).")
        f = TESTI_VOCE / f"{sc.base}.txt"
        f.write_text("\n".join(righe).rstrip() + "\n", encoding="utf-8")
        scritti.append(f)

    # Copione completo
    per_voce: dict[str, list[tuple[Scena, Battuta]]] = {v: [] for v in VOCI}
    for sc, b in tutte:
        per_voce.setdefault(b.chi, []).append((sc, b))
    parlato = {v: sum(b.a - b.da for _, b in lista) for v, lista in per_voce.items()}
    tot_sillabe = sum(sillabe(b.testo, pron) for _, b in tutte)
    tot_tempo = sum(b.a - b.da for _, b in tutte)
    usate = {k: v for k, v in pron.items() if any(re.search(rf"(?<![\w-]){re.escape(k)}(?![\w-])", b.testo) for _, b in tutte)}
    md = ["# Voce fuori campo di TwinCIRO", "",
          "> Generato da `scene/monta.py` a partire da `scene/scaletta.json`: **non modificarlo a mano**. Per cambiare una battuta"
          " cambiala nella scaletta e rilancia `./monta.sh --solo-testi` (un secondo, niente video). Anche i file `NN-<scena>.txt`"
          " di questa cartella si rigenerano da soli: una scena per file, con battute, tempi e chi legge.", "",
          f"**{minuti(totale)} di video · {len(tutte)} battute · "
          + " · ".join(f"{v} {len(l)} ({minuti(parlato[v])} di parlato)" for v, l in per_voce.items())
          + f"** · ritmo medio di circa {round(tot_sillabe * 30 / tot_tempo) if tot_tempo else 0} parole al minuto (obiettivo"
          " circa 150; il ritmo si conta in sillabe, circa 2 per parola, con sigle e numeri letti per esteso).", "",
          "## Come registrare", "",
          "Tre modi, che si possono mescolare. Formati: `.m4a` (Memo Vocali), `.wav`, `.mp3`, `.aac`, `.ogg`, `.flac`. Il montaggio"
          " toglie il silenzio all'inizio e alla fine di ogni file e porta tutti i file allo stesso volume.", "",
          "1. **Una battuta per file** (il più comodo: ognuno registra da solo, quando vuole). Leggi solo le tue battute, una per"
          " file, e chiama il file come scritto accanto alla battuta (per esempio `girato/voce/03-cirogpt-2.m4a`). Non serve"
          " guardare il video: `monta.sh` mette ogni battuta nel momento in cui compare il suo sottotitolo. Resta nella durata"
          " indicata: se una battuta è troppo lunga, `monta.sh` lo dice.",
          "2. **Una clip per file**: `girato/voce/03-cirogpt.m4a`. Guarda la clip senza audio (`clip/03-cirogpt.mp4`, con il suo"
          " `.srt` i sottotitoli fanno da gobbo) e leggi quando compaiono. La prima parola va al tempo della prima battuta. Se"
          " nella scena parlate tutti e due, registrate insieme.",
          "3. **Tutto in un file**, come prima: `girato/voce.m4a`, guardando `bozza.mp4` senza audio. Se all'inizio c'è silenzio:"
          " `./monta.sh --voce-da 1.5` (secondi da saltare).", "",
          "I file di `girato/voce/` prendono il posto di `girato/voce.m4a` nelle loro scene: per rifare una scena sola basta"
          " registrare quella. In una scena i file per battuta vincono sul file della clip. Il numero davanti al nome non conta"
          " (vale il nome della scena), e `girato/` resta fuori dal repository. Poi `./monta.sh`: la voce entra in `bozza.mp4`,"
          " nelle clip e in `clip/00-finale-senza-sottotitoli.mp4`.", "",
          "Consigli: stanza silenziosa e con tende o divani, telefono a 20 cm dalla bocca e un po' di lato, sempre lo stesso"
          " telefono per la stessa persona. Tono caldo e sicuro, senza fretta.", ""]
    if usate:
        md += ["## Pronuncia", ""] + [f"- *{k}* = «{v}»" for k, v in usate.items()] + [""]
    md += ["## Il copione, in ordine", ""]
    for sc in piano:
        md += [f"### {sc.pos:02d} · {sc.nome} · {orario(sc.inizio)}–{orario(sc.fine)} ({num(sc.durata)} s)", ""]
        if not sc.battute:
            md += ["*Scena senza voce.*", ""]
        for b in sc.battute:
            md += [f"**{b.chi.upper()}** · {orario(sc.inizio + b.da)} → {orario(sc.inizio + b.a)} · {num(b.a - b.da)} s"
                   f" · `{file_voce_battuta(sc, b)}`", ""]
            md += [f"> {md_testo(r)}" if r.strip() else ">" for r in b.testo.split("\n")] + [""]
    for v, lista in per_voce.items():
        md += [f"## Solo {v} ({len(lista)} {'battuta' if len(lista) == 1 else 'battute'}, {minuti(parlato[v])} di parlato)", ""]
        md += [f"{i}. **{sc.base}-{b.k}** · {orario(sc.inizio + b.da)} · {num(b.a - b.da)} s — {md_testo(b.testo.replace(chr(10), ' '))}"
               for i, (sc, b) in enumerate(lista, 1)] or [f"*Nessuna battuta: per dargliene una, metti `\"chi\": \"{v}\"` nella voce della scaletta.*"]
        md.append("")
    md += ["## Da controllare", ""]
    md += [f"- {a}" for a in avvisi] or [f"Niente da segnalare: nessuna sovrapposizione, tutte le battute dentro la loro scena e sotto"
                                         f" le {RITMO_MAX} parole al minuto."]
    f = TESTI_VOCE / "COPIONE-VOCE.md"
    f.write_text("\n".join(md).rstrip() + "\n", encoding="utf-8")
    scritti.append(f)

    # Testi di scene che non sono più in scaletta
    nomi = {p.name for p in scritti}
    for vecchio in TESTI_VOCE.glob("*.txt"):
        if re.fullmatch(r"\d{2,}-[a-z0-9-]+\.txt", vecchio.name) and vecchio.name not in nomi:
            vecchio.unlink()
    return scritti


# ---------------------------------------------------------------------------------------------------------------------
# Audio: voce (intera, per clip, per battuta) e musica in un solo WAV lungo quanto il video
# ---------------------------------------------------------------------------------------------------------------------

@dataclass
class Pezzo:
    file: Path
    scena: Scena
    k: int | None          # numero della battuta; None = tutta la clip
    wav: Path | None = None
    durata: float = 0.0

    @property
    def nome(self) -> str:
        return f"{self.scena.base}" + (f"-{self.k}" if self.k else "")

    @property
    def quando(self) -> float:
        """Secondo del video in cui va la prima parola: quando compare il sottotitolo (della battuta, o il primo della clip)."""
        sc = self.scena
        if self.k:
            return sc.inizio + sc.battute[self.k - 1].da
        return sc.inizio + (sc.battute[0].da if sc.battute else 0.0)

    @property
    def spazio(self) -> float:
        """Secondi a disposizione dalla prima parola: fino alla battuta dopo (per battuta) o alla fine della scena (per clip)."""
        sc = self.scena
        if self.k and self.k < len(sc.battute):
            return sc.battute[self.k].da - sc.battute[self.k - 1].da
        return sc.fine - self.quando

    @property
    def parlato(self) -> float:
        """Dalla prima all'ultima parola (senza il silenzio lasciato prima e dopo)."""
        return max(0.0, self.durata - SILENZIO_PRIMA - SILENZIO_DOPO)


def pezzi_voce(piano: list[Scena]) -> tuple[list[Pezzo], list[str]]:
    """I file di girato/voce/: NN-<scena>.* (tutta la clip) o NN-<scena>-K.* (battuta K). Vale anche l'id intero."""
    cart = GIRATO / "voce"
    if not cart.is_dir():
        return [], []
    # Nomi validi, dal più preciso: NN-<scena> (posizione di adesso), id della scena, <scena> senza numero.
    # Un nome che varrebbe per due scene diverse non vale (si usa quello con il numero davanti).
    nomi: dict[str, tuple[Scena, int | None]] = {}
    for livello in (lambda sc: sc.base, lambda sc: sc.id.lower(), lambda sc: sc.nome):
        candidati: dict[str, list[tuple[Scena, int | None]]] = {}
        for sc in piano:
            nome = livello(sc)
            for ch, val in [(nome, (sc, None))] + [(f"{nome}-{b.k}", (sc, b.k)) for b in sc.battute]:
                candidati.setdefault(ch, []).append(val)
        for ch, vals in candidati.items():
            if ch not in nomi and len({(s.pos, k) for s, k in vals}) == 1:
                nomi[ch] = vals[0]
    avvisi, trovati = [], {}
    for f in sorted(cart.iterdir()):
        if not f.is_file() or f.suffix.lower() not in ESTENSIONI_AUDIO or f.name.startswith("."):
            continue
        val = nomi.get(f.stem.lower()) or nomi.get(re.sub(r"^\d+-", "", f.stem.lower()))
        if not val:
            avvisi.append(f"girato/voce/{f.name}: il nome non corrisponde a nessuna scena o battuta (es. 03-cirogpt.m4a, 03-cirogpt-2.m4a): lo ignoro")
            continue
        chiave_pezzo = (val[0].pos, val[1])
        if chiave_pezzo in trovati:
            avvisi.append(f"girato/voce/{f.name}: c'è già {trovati[chiave_pezzo].file.name} per la stessa"
                          f" {'battuta' if val[1] else 'clip'}: lo ignoro")
            continue
        trovati[chiave_pezzo] = Pezzo(f, *val)
    pezzi = []
    for sc in piano:
        per_battuta = [p for (pos, k), p in trovati.items() if pos == sc.pos and k]
        intera = trovati.get((sc.pos, None))
        if per_battuta:
            if intera:
                avvisi.append(f"girato/voce/{intera.file.name}: ci sono anche i file per battuta di {sc.base}: uso quelli")
            mancano = sorted({b.k for b in sc.battute} - {p.k for p in per_battuta})
            if mancano:
                avvisi.append(f"{sc.base}: manca la voce della battuta {', '.join(map(str, mancano))}"
                              f" (girato/voce/{sc.base}-{mancano[0]}.m4a…): resta muta")
            pezzi += sorted(per_battuta, key=lambda p: p.k)
        elif intera:
            pezzi.append(intera)
    return pezzi, avvisi


def prepara_pezzo(p: Pezzo, cart: Path) -> str | None:
    """Toglie il silenzio prima e dopo e porta il file a -16 LUFS (misurati con ebur128). Ritorna un avviso, se serve."""
    r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(p.file), "-af",
                        "aresample=48000,aformat=channel_layouts=stereo,ebur128=framelog=quiet", "-f", "null", "-"],
                       capture_output=True, text=True)
    misure = re.findall(r"^\s*I:\s+(-?[\d.]+|-inf) LUFS", r.stderr, flags=re.M)
    if r.returncode != 0 or not misure or misure[-1] == "-inf" or float(misure[-1]) < -60:
        return f"girato/voce/{p.file.name}: non riesco a leggerlo o è muto: lo ignoro"
    lufs = float(misure[-1])
    soglia = min(-30.0, max(-60.0, lufs - 18))        # silenzio = 18 dB sotto il volume medio della voce
    guadagno = min(GUADAGNO_MAX, max(-15.0, VOLUME_VOCE - lufs))
    p.wav = cart / f"{p.nome}.wav"
    esegui(["ffmpeg", "-y", "-loglevel", "error", "-i", str(p.file), "-af",
            f"aresample=48000,aformat=sample_fmts=flt:channel_layouts=stereo,"
            f"silenceremove=start_periods=1:start_threshold={soglia:.1f}dB:start_silence={SILENZIO_PRIMA},areverse,"
            f"silenceremove=start_periods=1:start_threshold={soglia:.1f}dB:start_silence={SILENZIO_DOPO},areverse,"
            f"volume={guadagno:.2f}dB", "-c:a", "pcm_f32le", str(p.wav)])
    p.durata = durata_di(p.wav)
    avvisi = []
    if p.durata < 0.2:
        p.wav = None
        return f"girato/voce/{p.file.name}: dopo aver tolto il silenzio non resta niente: lo ignoro"
    if VOLUME_VOCE - lufs > GUADAGNO_MAX:
        avvisi.append(f"è molto bassa ({lufs:.0f} LUFS): l'ho alzata di {GUADAGNO_MAX:.0f} dB ma resta sotto le altre,"
                      " riregistrala con il telefono più vicino")
    if p.parlato > p.spazio + 0.05:
        cosa = "fino alla battuta dopo" if p.k and p.k < len(p.scena.battute) else "fino alla fine della scena"
        taglio = " (la taglio alla fine della scena)" if not p.k else ""
        avvisi.append(f"dura {num(p.parlato)} s, ma ha {num(p.spazio)} s {cosa}{taglio}: rileggila più svelta o allunga i tempi")
    return f"girato/voce/{p.file.name}: " + "; ".join(avvisi) if avvisi else None


def audio_montaggio(piano: list[Scena], totale: float, voce_da: float) -> tuple[Path, int, str]:
    """Scrive $C5_VIDEO_LAVORO/audio.wav (48 kHz stereo, lungo esattamente quanto il video) con voce e musica.
    Con la sola girato/voce.m4a i filtri sono quelli di sempre (loudnorm a -16 LUFS); la musica si abbassa sotto la voce."""
    voce = trova("voce", ESTENSIONI_AUDIO)
    musica = trova("musica", ESTENSIONI_AUDIO)
    pezzi, avvisi = pezzi_voce(piano)
    cart = LAVORO / "voce"
    shutil.rmtree(cart, ignore_errors=True)
    if pezzi:
        cart.mkdir(parents=True)
        avvisi += [a for p in pezzi if (a := prepara_pezzo(p, cart))]
        pezzi = [p for p in pezzi if p.wav]
    for a in avvisi:
        print(f"  ! {a}")
    ingressi: list[str] = []
    fa: list[str] = []
    voce_bus: list[str] = []
    k = 0
    if voce:
        ingressi += ["-ss", str(voce_da), "-i", str(voce)]
        catena = f"[{k}:a]aresample=48000,loudnorm=I=-16:TP=-1.5:LRA=11,apad,atrim=0:{totale:.3f}"
        sostituite = sorted({p.scena.pos: (p.scena.inizio, p.scena.fine) for p in pezzi}.values())
        if sostituite:   # nelle scene con i file di girato/voce/ la voce intera tace (a blocchi di 10 ms: loudnorm ne fa da 100)
            catena += (",asetnsamples=n=480:p=0,volume=0:enable='"
                       + "+".join(f"gte(t,{a:.3f})*lt(t,{b:.3f})" for a, b in sostituite) + "'")
        fa.append(catena + ("[voce]" if not pezzi else "[vint]"))
        voce_bus.append("[vint]")
        k += 1
    for p in pezzi:
        ingressi += ["-i", str(p.wav)]
        taglio = ""
        if not p.k and p.parlato > p.spazio:          # la voce di una clip non entra nella scena dopo
            fine = p.spazio + SILENZIO_PRIMA
            taglio = f"atrim=0:{fine:.3f},afade=t=out:st={max(0.0, fine - 0.05):.3f}:d=0.05,"
        # Il file comincia con SILENZIO_PRIMA di silenzio: lo anticipo, così la prima parola cade sul sottotitolo
        ms = int(round(max(0.0, p.quando - SILENZIO_PRIMA) * 1000))
        fa.append(f"[{k}:a]{taglio}adelay={ms}:all=1,apad,atrim=0:{totale:.3f}[vp{k}]")
        voce_bus.append(f"[vp{k}]")
        k += 1
    if pezzi:
        unisci = f"amix=inputs={len(voce_bus)}:normalize=0:duration=longest," if len(voce_bus) > 1 else ""
        fa.append("".join(voce_bus) + f"{unisci}alimiter=limit=0.891:level=0:latency=1,atrim=0:{totale:.3f}[voce]")
    ha_voce = bool(voce or pezzi)
    if musica:
        ingressi += ["-stream_loop", "-1", "-i", str(musica)]
        vol = 0.12 if ha_voce else 0.35
        fa.append(f"[{k}:a]aresample=48000,volume={vol},atrim=0:{totale:.3f},afade=t=in:d=2,"
                  f"afade=t=out:st={totale - 3:.3f}:d=3[mus]")
        k += 1
    if ha_voce and musica:
        fa.append("[voce]asplit[v1][v2];[mus][v2]sidechaincompress=threshold=0.02:ratio=6:attack=30:release=500[md];"
                  "[v1][md]amix=inputs=2:duration=first:normalize=0[a]")
    elif ha_voce:
        fa.append("[voce]anull[a]")
    elif musica:
        fa.append("[mus]anull[a]")
    else:
        fa.append(f"anullsrc=r=48000:cl=stereo,atrim=0:{totale:.3f}[a]")
    uscita = LAVORO / "audio.wav"
    esegui(["ffmpeg", "-y", "-loglevel", "error", *ingressi, "-filter_complex", ";".join(fa), "-map", "[a]",
            "-c:a", "pcm_f32le", "-ar", "48000", "-ac", "2", "-t", f"{totale:.3f}", str(uscita)])
    parti = []
    if voce:
        parti.append(f"{voce.name} (tutto il video" + (f", tranne {len({p.scena.pos for p in pezzi})} scene)" if pezzi else ")"))
    n_batt = sum(1 for p in pezzi if p.k)
    if n_batt:
        parti.append(f"{n_batt} battute da girato/voce/")
    if len(pezzi) - n_batt:
        parti.append(f"{len(pezzi) - n_batt} clip da girato/voce/")
    descr = f"voce {' + '.join(parti) if parti else 'assente'}, musica {'= ' + musica.name if musica else 'assente'}"
    return uscita, (128 if (ha_voce or musica) else 64), descr


# ---------------------------------------------------------------------------------------------------------------------
# Clip per scena, finale senza sottotitoli, LEGGIMI
# ---------------------------------------------------------------------------------------------------------------------

# audio.wav va sempre letto con apad e tagliato con -t: se l'ingresso finisce proprio alla durata del video,
# l'AAC esce più corto di 87 ms (l'ultimo pacchetto del WAV si perde). Con apad la durata è esatta e, decodificato,
# l'audio è identico campione per campione a quello del montaggio di prima (che aveva la voce dentro il grafo dei filtri).
def aac(audio_k: int) -> list[str]:
    return ["-c:a", "aac", "-b:a", f"{audio_k}k", "-ar", "48000", "-ac", "2"]


def scrivi_clip(piano: list[Scena], file_scene: list[Path], audio: Path, audio_k: int, totale: float) -> tuple[int, int]:
    """clip/NN-<scena>.mp4 (+ .srt), clip/sottotitoli.srt, clip/00-finale-senza-sottotitoli.mp4, clip/elenco.txt.
    Il video di ogni clip resta in cache finché la scena non cambia (x264 è deterministico: stessi byte, git non vede
    differenze); l'audio si rimette ogni volta. Toglie le clip delle scene che non sono più in scaletta."""
    CLIP.mkdir(parents=True, exist_ok=True)
    for f in CLIP.glob(".*.tmp.*"):
        f.unlink()
    cache = LAVORO / "clip-video"
    cache.mkdir(parents=True, exist_ok=True)
    video, nuove = [], 0
    for sc, f in zip(piano, file_scene):
        v = cache / f"{sc.base}-{chiave(f, ' '.join(CLIP_VIDEO), sc.durata)}.mp4"
        if not v.exists():
            tmp = cache / f".{v.name}.tmp.mp4"
            esegui(["ffmpeg", "-y", "-loglevel", "error", "-i", str(f), "-map", "0:v", *CLIP_VIDEO, "-t", f"{sc.durata:.3f}", str(tmp)])
            os.replace(tmp, v)
            nuove += 1
        video.append(v)
        tmp = CLIP / f".{sc.base}.tmp.mp4"
        esegui(["ffmpeg", "-y", "-loglevel", "error", "-i", str(v), "-ss", f"{sc.inizio:.3f}", "-t", f"{sc.durata:.3f}",
                "-i", str(audio), "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-af", "apad", *aac(audio_k),
                "-t", f"{sc.durata:.3f}", "-movflags", "+faststart", str(tmp)])
        os.replace(tmp, CLIP / f"{sc.base}.mp4")
        srt = CLIP / f"{sc.base}.srt"
        if sc.battute:
            scrivi_srt(srt, [(b.da, b.a, b.testo) for b in sc.battute])
        else:
            srt.unlink(missing_ok=True)
    for f in cache.glob("*.mp4"):           # video di versioni vecchie delle scene
        if f not in video:
            f.unlink()
    scrivi_srt(CLIP / "sottotitoli.srt", [(sc.inizio + b.da, sc.inizio + b.a, b.testo) for sc in piano for b in sc.battute])

    # Il video intero senza sottotitoli: le clip unite senza ricodificarle, l'audio rifatto in un pezzo solo
    elenco_v = cache / "elenco.txt"
    elenco_v.write_text("".join(f"file '{v}'\n" for v in video), encoding="utf-8")
    tmp = CLIP / f".{FINALE_PULITO}.tmp.mp4"
    esegui(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(elenco_v), "-i", str(audio),
            "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-af", "apad", *aac(audio_k), "-t", f"{totale:.3f}",
            "-movflags", "+faststart", str(tmp)])
    os.replace(tmp, CLIP / FINALE_PULITO)

    # Clip di scene che non sono più in scaletta (le riconosce dall'elenco della volta prima)
    elenco = CLIP / "elenco.txt"
    basi = {sc.base for sc in piano}
    tolte = 0
    if elenco.exists():
        for b in set(re.findall(r"^file '([^'/]+)\.mp4'$", elenco.read_text(encoding="utf-8"), flags=re.M)) - basi:
            for est in (".mp4", ".srt"):
                if (CLIP / f"{b}{est}").exists():
                    (CLIP / f"{b}{est}").unlink()
                    tolte += est == ".mp4"
    elenco.write_text("# Clip del video di TwinCIRO in ordine (scritto da monta.sh, che lo usa per togliere le clip vecchie).\n"
                      "# Per unirle: ffmpeg -f concat -safe 0 -i elenco.txt -c copy prova.mp4\n"
                      + "".join(f"file '{sc.base}.mp4'\n" for sc in piano), encoding="utf-8")
    return nuove, tolte


def scrivi_leggimi_clip(piano: list[Scena], totale: float) -> None:
    def chi(sc: Scena) -> str:
        if not sc.battute:
            return "senza voce"
        conti = {}
        for b in sc.battute:
            conti[b.chi] = conti.get(b.chi, 0) + 1
        return f"{len(sc.battute)} · " + ", ".join(f"{v} {n}" if len(conti) > 1 else v for v, n in conti.items())
    righe = [
        "# Clip del video di TwinCIRO", "",
        "Cartella scritta da `../monta.sh` a ogni montaggio: **non modificare questi file**, vengono riscritti (le tue versioni"
        " salvale fuori da qui). Sono nel repository apposta, come copia di sicurezza.", "",
        "Ogni scena del video è una clip a sé, **senza sottotitoli**, per rimontare a mano:", "",
        f"- `NN-<scena>.mp4`: 1920×1080, 30 fps, H.264 (qualità costante, CRF {CLIP_CRF}) con l'audio del montaggio (AAC 48 kHz"
        " stereo: voce e musica se ci sono, altrimenti silenzio). Le dissolvenze dal nero e verso il nero (0,2 s) sono già"
        " dentro: messe in fila, senza transizioni, rifanno il video;",
        "- `NN-<scena>.srt`: i sottotitoli della clip, con i tempi dall'inizio della clip (stesso nome della clip: VLC e mpv"
        " li caricano da soli). Le scene senza voce non lo hanno;",
        f"- `sottotitoli.srt`: i sottotitoli del video intero, e `{FINALE_PULITO}`: il video intero (le clip unite) senza"
        " sottotitoli impressi. La bozza con i sottotitoli impressi è [`../bozza.mp4`](../bozza.mp4);",
        "- `sottotitoli.ass`: gli stessi sottotitoli con lo stile della bozza (riquadro scuro, carattere Inter), per imprimerli"
        " con ffmpeg;",
        "- `elenco.txt`: l'ordine delle clip (serve anche a `monta.sh` per togliere quelle vecchie: non cancellarlo).", "",
        "I testi della voce, scena per scena e con chi li legge, sono in [`../voce/`](../voce/COPIONE-VOCE.md).", "",
        "## Ordine e durate", "",
        "| # | Clip | Nel video | Durata | Battute |", "|---|---|---|---|---|"]
    righe += [f"| {sc.pos:02d} | `{sc.base}.mp4` | {orario(sc.inizio)}–{orario(sc.fine)} | {num(sc.durata)} s | {chi(sc)} |"
              for sc in piano]
    righe += [f"| | **Totale** | | **{minuti(totale)}** ({num(totale)} s) | {sum(len(sc.battute) for sc in piano)} |", "",
              "## Rimontare a mano", "",
              "1. Importa le clip nell'editor e mettile in fila nell'ordine dei numeri, una attaccata all'altra.",
              "2. Sottotitoli: importa `sottotitoli.srt` e mettilo all'inizio della timeline (oppure l'SRT di ogni clip"
              " all'inizio della sua clip). Sono UTF-8, formato SRT standard:",
              "   - **DaVinci Resolve**: *File › Import › Subtitle*, poi trascina l'SRT dal Media Pool sulla timeline;",
              "   - **Premiere Pro**: *File › Import* dell'SRT, poi trascinalo sulla sequenza (diventa una traccia di didascalie);",
              "   - **Final Cut Pro**: *File › Import › Captions*;",
              "   - **YouTube**: carica `" + FINALE_PULITO + "`, poi *Sottotitoli › Carica file › Con temporizzazione* e scegli"
              " `sottotitoli.srt`;",
              "   - **VLC**, per guardare il video intero con i sottotitoli: *Sottotitoli › Aggiungi file di sottotitoli*.",
              "3. Con ffmpeg, da questa cartella:",
              "   - unire le clip: `ffmpeg -f concat -safe 0 -i elenco.txt -c copy prova.mp4` (a ogni giunta l'audio può slittare"
              f" di un paio di centesimi: per il video intero usa `{FINALE_PULITO}`);",
              f"   - imprimere i sottotitoli con lo stile della bozza: `ffmpeg -i {FINALE_PULITO} -vf ass=sottotitoli.ass -c:a copy"
              " prova.mp4` (con `-vf subtitles=sottotitoli.srt` lo stile è quello semplice del lettore).", "",
              "Per rifare clip, SRT e testi della voce senza la codifica lunga della bozza: `../monta.sh --solo-clip`."]
    (CLIP / "LEGGIMI.md").write_text("\n".join(righe) + "\n", encoding="utf-8")


def mb(f: Path) -> float:
    return f.stat().st_size / 1024 / 1024


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--rigenera", action="store_true", help="rigenera le scene HTML anche se sono in cache")
    p.add_argument("--rigenera-mappa", action="store_true", help="registra di nuovo la mappa (dati live)")
    p.add_argument("--senza-sottotitoli", action="store_true")
    p.add_argument("--voce-da", type=float, default=0.0, help="secondi da saltare all'inizio di girato/voce.*")
    p.add_argument("--uscita", default=str(VIDEO / "bozza.mp4"))
    p.add_argument("--controllo", action="store_true", help="estrae un fotogramma ogni 5 s in $C5_VIDEO_LAVORO/controllo")
    p.add_argument("--segnaposto", action="store_true",
                   help="dove manca la ripresa vera mostra il cartello segnaposto invece della scena di riserva")
    solo = p.add_mutually_exclusive_group()
    solo.add_argument("--solo-clip", action="store_true",
                      help="rifà clip, SRT, testi della voce e 00-finale-senza-sottotitoli, ma non bozza.mp4")
    solo.add_argument("--solo-testi", action="store_true", help="rifà solo i testi della voce (voce/), senza video")
    a = p.parse_args()
    OPZIONI["segnaposto"] = a.segnaposto

    scaletta = json.loads((QUI / "scaletta.json").read_text(encoding="utf-8"))
    CARTELLI.update(scaletta.get("cartelli", {}))
    saltate = [s["id"] for s in scaletta["scene"] if s.get("salta")]
    scaletta["scene"] = [s for s in scaletta["scene"] if not s.get("salta")]
    if saltate:
        print(f"Scene saltate (\"salta\": true): {', '.join(saltate)}")
    totale = sum(float(s["durata"]) for s in scaletta["scene"])
    print(f"Scaletta: {len(scaletta['scene'])} scene, {totale:.0f} s ({int(totale // 60)}:{int(totale % 60):02d})")

    # Testi per la voce e controlli su tempi e ritmo: sempre, anche senza video
    piano = piano_video(scaletta["scene"])
    pron = {**PRONUNCIA, **scaletta.get("pronuncia", {})}
    avvisi = controlla_voce(piano, pron)
    scritti = scrivi_testi_voce(piano, totale, pron, avvisi)
    print(f"Testi della voce: {len(scritti) - 1} scene + {scritti[-1].name} in {TESTI_VOCE}")
    for av in avvisi:
        print(f"  ! {av}")
    if totale > 180:
        if not a.solo_testi:
            sys.exit("La scaletta supera i 3 minuti: accorcia qualche scena")
        print("  ! La scaletta supera i 3 minuti: accorcia qualche scena")
    if a.solo_testi:
        return

    for prog in ("ffmpeg", "ffprobe", "node"):
        if not shutil.which(prog):
            sys.exit(f"Manca {prog}")
    LAVORO.mkdir(parents=True, exist_ok=True)

    sorg = Sorgenti(a.rigenera, a.rigenera_mappa)
    clip = []
    t = 0.0
    for i, sc in enumerate(scaletta["scene"]):
        print(f"[{int(t // 60)}:{int(t % 60):02d}] {sc['id']} ({sc['durata']} s)", flush=True)
        f, descr = monta_scena(sc, i, len(scaletta["scene"]), sorg, float(scaletta.get("dissolvenza", 0.2)))
        print(f"        {descr}")
        clip.append(f)
        t += float(sc["durata"])

    # Audio (voce e musica facoltative) in un WAV lungo quanto il video: lo usano bozza, clip e finale senza sottotitoli
    audio, audio_k, descr_audio = audio_montaggio(piano, totale, a.voce_da)
    print(f"Audio: {descr_audio}")

    # Clip per rimontare (senza sottotitoli), SRT e video intero senza sottotitoli
    nuove, tolte = scrivi_clip(piano, clip, audio, audio_k, totale)
    sottotitoli(scaletta, CLIP / "sottotitoli.ass")      # lo stesso ASS impresso nella bozza
    scrivi_leggimi_clip(piano, totale)
    pulito = CLIP / FINALE_PULITO
    peso = sum(mb(f) for f in CLIP.glob("[0-9][0-9]*-*.mp4") if f.name != FINALE_PULITO)
    print(f"Clip: {len(piano)} in {CLIP} ({peso:.1f} MB; {nuove} ricodificate, le altre dalla cache"
          + (f"; tolte {tolte} vecchie" if tolte else "") + f"), SRT, {pulito.name} ({mb(pulito):.1f} MB)")
    if mb(pulito) > LIMITE_MB:
        print(f"  ! {pulito.name} supera {LIMITE_MB} MB: per consegnare usa la bozza")
    uscita = pulito
    if not a.solo_clip:
        elenco = LAVORO / "elenco.txt"
        elenco.write_text("".join(f"file '{c}'\n" for c in clip), encoding="utf-8")
        unito = LAVORO / "unito.mp4"
        esegui(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(elenco), "-c", "copy", str(unito)])

        # Sottotitoli della voce fuori campo
        filtro_v = "null"
        if not a.senza_sottotitoli:
            n = sottotitoli(scaletta, LAVORO / "sottotitoli.ass")
            filtro_v = "ass=sottotitoli.ass"
            print(f"Sottotitoli: {n} battute")

        # Due passate a bitrate fisso per stare sotto il limite di dimensione
        video_k = int((OBIETTIVO_MB * 8 * 1024 * 1024 / totale) / 1000 * 0.985 - audio_k)
        video_k = max(800, min(video_k, 6000))
        print(f"Codifica in due passate: video {video_k} kbit/s, audio {audio_k} kbit/s")
        uscita = Path(a.uscita).resolve()
        comune = ["-c:v", "libx264", "-preset", "slow", "-b:v", f"{video_k}k", "-maxrate", f"{int(video_k * 1.8)}k",
                  "-bufsize", f"{video_k * 3}k", "-pix_fmt", "yuv420p", "-r", str(FPS), "-passlogfile", "x264"]
        esegui(["ffmpeg", "-y", "-loglevel", "error", "-i", str(unito), "-vf", filtro_v, *comune, "-pass", "1", "-an",
                "-f", "null", os.devnull], cwd=LAVORO)
        esegui(["ffmpeg", "-y", "-loglevel", "error", "-i", str(unito), "-i", str(audio),
                "-filter_complex", f"[0:v]{filtro_v}[v];[1:a]apad[a]", "-map", "[v]", "-map", "[a]", *comune, "-pass", "2",
                *aac(audio_k), "-movflags", "+faststart", "-t", f"{totale:.3f}", str(uscita)], cwd=LAVORO)

        dur = durata_di(uscita)
        print(f"\nFatto: {uscita}\n  durata {int(dur // 60)}:{dur % 60:05.2f} · {mb(uscita):.1f} MB · {W}×{H} · {FPS} fps")
        if dur > 180 or mb(uscita) > LIMITE_MB:
            print("  ATTENZIONE: supera i limiti (3:00, 40 MB)")
    else:
        print(f"\nFatto (--solo-clip): clip e SRT in {CLIP}; bozza.mp4 non è stata rifatta")
    if a.controllo:
        dur = durata_di(uscita)
        cart = LAVORO / "controllo"
        shutil.rmtree(cart, ignore_errors=True)
        cart.mkdir(parents=True)
        # Un fotogramma ogni 5 s, a metà dell'intervallo (lontano dalle dissolvenze): nome = secondo del video
        for t in range(0, int(dur), 5):
            esegui(["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{t + 2.5:.1f}", "-i", str(uscita), "-frames:v", "1",
                    "-q:v", "3", str(cart / f"t_{t + 2.5:05.1f}.jpg")])
        print(f"  fotogrammi di controllo (uno ogni 5 s, da {uscita.name}) in {cart}")


if __name__ == "__main__":
    main()
