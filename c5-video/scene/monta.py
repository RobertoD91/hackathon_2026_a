#!/usr/bin/env python3
"""Monta il video di consegna di TwinCiro (bozza.mp4) a partire da scene/scaletta.json.

Per ogni scena:
- sorgente generata (cartelli, architettura, chat di CiroGPT) con scene/rendi_html.mjs,
  registrazione della mappa con scene/registra_mappa.mjs, oppure spezzone di un video esistente;
- se in girato/ c'è la ripresa vera indicata in "girato" (es. girato/badge.mp4), usa quella;
- testata (etichetta + testo) e velo sopra i video, dissolvenze brevi.
Poi unisce le scene, imprime i sottotitoli della voce fuori campo (ASS), aggiunge la voce
(girato/voce.*) ed eventuale musica libera da diritti (girato/musica.*), e codifica in due passate
per restare sotto i 40 MB.

  python3 scene/monta.py                      # usa le sorgenti già generate (cache) e rifà il montaggio
  python3 scene/monta.py --rigenera           # rigenera tutte le scene HTML (non la mappa)
  python3 scene/monta.py --rigenera-mappa     # registra di nuovo la mappa (dati live)
  python3 scene/monta.py --senza-sottotitoli  # niente sottotitoli impressi
  python3 scene/monta.py --controllo          # alla fine estrae un fotogramma ogni 5 s
  python3 scene/monta.py --segnaposto         # dove manca una ripresa vera mostra il cartello "Qui va una ripresa reale"
                                              # (senza: usa la scena di riserva indicata in "sorgente")

Nella scaletta una scena con "salta": true resta descritta ma non entra nel video.

Variabili: C5_VIDEO_LAVORO (cartella dei file intermedi, predefinita /tmp/c5-video-lavoro),
C5_VIDEO_GIRATO (cartella delle riprese, predefinita c5-video/girato),
C5_URL_MAPPA (URL della mappa; se manca la serve in locale dalla root della repo).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path

QUI = Path(__file__).resolve().parent          # c5-video/scene
VIDEO = QUI.parent                             # c5-video
REPO = VIDEO.parent
GIRATO = Path(os.environ.get("C5_VIDEO_GIRATO", VIDEO / "girato"))   # riprese vere, voce, musica
LAVORO = Path(os.environ.get("C5_VIDEO_LAVORO", "/tmp/c5-video-lavoro"))
ESTENSIONI_VIDEO = (".mp4", ".mov", ".m4v", ".webm", ".mkv")
ESTENSIONI_AUDIO = (".m4a", ".wav", ".mp3", ".aac", ".ogg", ".flac")
W, H, FPS = 1920, 1080, 30
SCHERMO_TEL = (170, 79, 430, 850)               # riquadro dentro lo schermo del telefono di chat.html
LIMITE_MB = 40
OBIETTIVO_MB = 36
CARTELLI: dict = {}   # testi dei cartelli da scaletta.json (per la chiave della cache)
OPZIONI = {"segnaposto": False}


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
            url = f"http://127.0.0.1:{porta}/shared/iot-agents/example/"
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
    a = p.parse_args()
    OPZIONI["segnaposto"] = a.segnaposto

    for prog in ("ffmpeg", "ffprobe", "node"):
        if not shutil.which(prog):
            sys.exit(f"Manca {prog}")
    scaletta = json.loads((QUI / "scaletta.json").read_text(encoding="utf-8"))
    CARTELLI.update(scaletta.get("cartelli", {}))
    saltate = [s["id"] for s in scaletta["scene"] if s.get("salta")]
    scaletta["scene"] = [s for s in scaletta["scene"] if not s.get("salta")]
    if saltate:
        print(f"Scene saltate (\"salta\": true): {', '.join(saltate)}")
    totale = sum(float(s["durata"]) for s in scaletta["scene"])
    print(f"Scaletta: {len(scaletta['scene'])} scene, {totale:.0f} s ({int(totale // 60)}:{int(totale % 60):02d})")
    if totale > 180:
        sys.exit("La scaletta supera i 3 minuti: accorcia qualche scena")
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

    # Audio: voce e musica facoltative
    voce = trova("voce", ESTENSIONI_AUDIO)
    musica = trova("musica", ESTENSIONI_AUDIO)
    ingressi_audio: list[str] = []
    fa: list[str] = []
    k = 1
    if voce:
        ingressi_audio += ["-ss", str(a.voce_da), "-i", str(voce)]
        fa.append(f"[{k}:a]aresample=48000,loudnorm=I=-16:TP=-1.5:LRA=11,apad,atrim=0:{totale:.3f}[voce]")
        k += 1
    if musica:
        ingressi_audio += ["-stream_loop", "-1", "-i", str(musica)]
        vol = 0.12 if voce else 0.35
        fa.append(f"[{k}:a]aresample=48000,volume={vol},atrim=0:{totale:.3f},afade=t=in:d=2,"
                  f"afade=t=out:st={totale - 3:.3f}:d=3[mus]")
        k += 1
    if voce and musica:
        fa.append("[voce]asplit[v1][v2];[mus][v2]sidechaincompress=threshold=0.02:ratio=6:attack=30:release=500[md];"
                  "[v1][md]amix=inputs=2:duration=first:normalize=0[a]")
    elif voce:
        fa.append("[voce]anull[a]")
    elif musica:
        fa.append("[mus]anull[a]")
    else:
        fa.append(f"anullsrc=r=48000:cl=stereo,atrim=0:{totale:.3f}[a]")
    print(f"Audio: voce {'= ' + voce.name if voce else 'assente'}, musica {'= ' + musica.name if musica else 'assente'}")

    # Due passate a bitrate fisso per stare sotto il limite di dimensione
    audio_k = 128 if (voce or musica) else 64
    video_k = int((OBIETTIVO_MB * 8 * 1024 * 1024 / totale) / 1000 * 0.985 - audio_k)
    video_k = max(800, min(video_k, 6000))
    print(f"Codifica in due passate: video {video_k} kbit/s, audio {audio_k} kbit/s")
    uscita = Path(a.uscita).resolve()
    comune = ["-c:v", "libx264", "-preset", "slow", "-b:v", f"{video_k}k", "-maxrate", f"{int(video_k * 1.8)}k",
              "-bufsize", f"{video_k * 3}k", "-pix_fmt", "yuv420p", "-r", str(FPS), "-passlogfile", "x264"]
    esegui(["ffmpeg", "-y", "-loglevel", "error", "-i", str(unito), "-vf", filtro_v, *comune, "-pass", "1", "-an",
            "-f", "null", os.devnull], cwd=LAVORO)
    esegui(["ffmpeg", "-y", "-loglevel", "error", "-i", str(unito), *ingressi_audio,
            "-filter_complex", f"[0:v]{filtro_v}[v];" + ";".join(fa), "-map", "[v]", "-map", "[a]", *comune, "-pass", "2",
            "-c:a", "aac", "-b:a", f"{audio_k}k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", "-t", f"{totale:.3f}", str(uscita)], cwd=LAVORO)

    dur = durata_di(uscita)
    mb = uscita.stat().st_size / 1024 / 1024
    print(f"\nFatto: {uscita}\n  durata {int(dur // 60)}:{dur % 60:05.2f} · {mb:.1f} MB · {W}×{H} · {FPS} fps")
    if dur > 180 or mb > LIMITE_MB:
        print("  ATTENZIONE: supera i limiti (3:00, 40 MB)")
    if a.controllo:
        cart = LAVORO / "controllo"
        shutil.rmtree(cart, ignore_errors=True)
        cart.mkdir(parents=True)
        # Un fotogramma ogni 5 s, a metà dell'intervallo (lontano dalle dissolvenze): nome = secondo del video
        for t in range(0, int(dur), 5):
            esegui(["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{t + 2.5:.1f}", "-i", str(uscita), "-frames:v", "1",
                    "-q:v", "3", str(cart / f"t_{t + 2.5:05.1f}.jpg")])
        print(f"  fotogrammi di controllo (uno ogni 5 s) in {cart}")


if __name__ == "__main__":
    main()
