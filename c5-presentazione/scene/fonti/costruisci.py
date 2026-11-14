#!/usr/bin/env python3
"""Costruisce scene/fonti/catalogo.json dal catalogo docs/fonti-dati-napoli.md (sezione 2) per le scene
"motivazione" e "fonti" del video di TwinCIRO.

Dal documento prende, riga per riga, nome della fonte, ente, formato, accesso ed esito della verifica; da qui
aggiunge solo ciò che serve a schermo: un nome breve, il sito ufficiale (per l'icona), i formati in breve e se
la fonte è pubblica. Ogni riga del documento deve avere la sua voce qui sotto, e viceversa: se il documento
cambia, lo script si ferma e dice cosa manca.

  python3 -I costruisci.py                 # rigenera catalogo.json (tiene le icone già scaricate)
  python3 -I costruisci.py --loghi         # scarica di nuovo le icone ufficiali dei siti in loghi/
  python3 -I costruisci.py --loghi --solo anm,istat   # solo alcuni siti (chiavi di SITI)

Le icone vengono dai siti stessi (apple-touch-icon, icona più grande dichiarata nella pagina o nel manifest,
favicon; per i siti che reindirizzano in JavaScript o fanno una verifica anti-bot, la pagina aperta in Chromium):
niente disegnato o imitato. Un sito senza un'icona decente (sotto i 32 px, cioè le favicon da 16) o che non
risponde ha "icona": null e la scena mostra solo il nome. Richieste con User-Agent generico "TwinCIRO/1.0"
(se il sito lo rifiuta, uno da browser, sempre senza dati personali). Serve Pillow; per SVG e Chromium, Playwright.
"""

from __future__ import annotations

import argparse
import html.parser
import io
import json
import os
import re
import ssl
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

QUI = Path(__file__).resolve().parent
REPO = QUI.parents[2]                          # radice della repo (questo file sta in c5-presentazione/scene/fonti)
DOC = REPO / "docs" / "fonti-dati-napoli.md"
USCITA = REPO / "c5-presentazione" / "scene" / "fonti"
UA = "TwinCIRO/1.0"
UA_BROWSER = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 TwinCIRO/1.0"
LATO = 128            # PNG quadrati 128×128
MINIMO = 32           # sotto questa misura (le favicon da 16 px) l'icona non è "decente": niente icona, solo il nome
                      # (a schermo le icone sono di 30-40 px, quindi 32 px bastano)
BUONA = 64            # da qui in su non serve aprire la pagina in Chromium

# Icone che non si trovano nella pagina del sito: indirizzo ufficiale scritto a mano
ICONE_DIRETTE = {
    # github.com non risponde dalla sandbox: è l'immagine dell'organizzazione openfootball su GitHub
    "openfootball": "https://avatars.githubusercontent.com/openfootball?s=200",
}
# Se un sito non dà un'icona, si usa quella di un altro sito dello stesso ente (dichiarato in "icona_nota")
RISERVE = {
    "opendata-comune": ("comune-napoli", "il portale open data del Comune non ha risposto: icona del sito del Comune di Napoli, stesso ente"),
}

DOMINI = [
    {"id": "meteo", "sezione": "2.1", "nome": "Meteo e ambiente", "titolo_catalogo": "Meteo, allerte e ambiente", "icona": "🌦️"},
    {"id": "mobilita", "sezione": "2.2", "nome": "Mobilità", "titolo_catalogo": "Mobilità e trasporti", "icona": "🚇"},
    {"id": "eventi", "sezione": "2.3", "nome": "Eventi e turismo", "titolo_catalogo": "Eventi e turismo", "icona": "🎟️"},
    {"id": "territorio", "sezione": "2.4", "nome": "Territorio e servizi", "titolo_catalogo": "Territorio, servizi e cataloghi", "icona": "🏛️"},
]

# Siti ufficiali da cui prendere l'icona (una sola volta per sito, anche se più fonti lo condividono)
SITI = {
    "open-meteo": "https://open-meteo.com/",
    "centro-funzionale": "https://centrofunzionale.regione.campania.it/",
    "eea": "https://www.eea.europa.eu/",
    "arpac": "https://www.arpacampania.it/",
    "uniparthenope": "https://meteo.uniparthenope.it/",
    "meteoalarm": "https://meteoalarm.org/",
    "met-norway": "https://www.met.no/",
    "ingv": "https://www.ingv.it/",
    "sensor-community": "https://sensor.community/",
    "waqi": "https://aqicn.org/",
    "protezione-civile": "https://www.protezionecivile.gov.it/",
    "anm": "https://www.anm.it/",
    "busone": "https://busone.app/",
    "viaggiatreno": "https://www.viaggiatreno.it/",
    "transitous": "https://transitous.org/",
    "eav": "https://www.eavsrl.it/",
    "autostrade": "https://www.autostrade.it/",
    "cciss": "https://www.cciss.it/",
    "openstreetmap": "https://www.openstreetmap.org/",
    "assaeroporti": "https://assaeroporti.com/",
    "opensky": "https://opensky-network.org/",
    "regione-campania": "https://www.regione.campania.it/",
    "aisstream": "https://aisstream.io/",
    "comune-napoli": "https://www.comune.napoli.it/",
    "openfootball": "https://github.com/openfootball",
    "thesportsdb": "https://www.thesportsdb.com/",
    "opendata-comune": "https://dati.comune.napoli.it/",
    "adsp": "https://adsptirrenocentrale.it/",
    "cruisetimetables": "https://www.cruisetimetables.com/",
    "cultura": "https://www.cultura.gov.it/",
    "istat": "https://www.istat.it/",
    "insideairbnb": "https://insideairbnb.com/",
    "wikipedia": "https://www.wikipedia.org/",
    "wikidata": "https://www.wikidata.org/",
    "americascup": "https://www.americascup.com/",
    "nager": "https://date.nager.at/",
    "football-data": "https://www.football-data.org/",
    "salute": "https://www.salute.gov.it/",
    "indicepa": "https://www.indicepa.gov.it/",
    "dati-gov": "https://www.dati.gov.it/",
    "citta-metropolitana": "https://www.cittametropolitana.na.it/",
    "dataverse": "https://dataverse.harvard.edu/",
}

# Una voce per ogni riga della sezione 2, con la chiave uguale alla colonna "Fonte" del documento.
# nome: come appare a schermo (​ = punto in cui può andare a capo); formati: in breve, il primo va sul cartellino;
# sito: chiave di SITI (None = nessun sito da cui prendere l'icona); pubblica: False solo per i dati che non sono pubblici;
# in_uso: True per le fonti già collegate all'API dati città di TwinCIRO (citta-api/), come da sezione 0 del documento
# ("Cosa è davvero integrato", 14/11) e dagli indirizzi che il codice di citta-api/ chiama davvero.
VOCI = {
    # 2.1 Meteo, allerte e ambiente
    "Open-Meteo Forecast": dict(id="open-meteo-previsioni", in_uso=True, nome="Open-Meteo previsioni", sito="open-meteo", formati=["JSON"]),
    "Allerta meteo Campania": dict(id="allerta-campania", in_uso=True, nome="Allerta meteo Campania", sito="centro-funzionale", formati=["JSON"]),
    "Stazioni idro-meteo Campania": dict(id="stazioni-campania", nome="Stazioni meteo Campania", sito="centro-funzionale", formati=["JSON"]),
    "EEA E2a, centraline ARPAC": dict(id="eea-aria", in_uso=True, nome="Centraline aria (EEA)", sito="eea", formati=["Parquet", "CSV"]),
    "Open-Meteo Marine": dict(id="open-meteo-mare", nome="Open-Meteo mare", sito="open-meteo", formati=["JSON"]),
    "Open-Meteo Air Quality (CAMS)": dict(id="open-meteo-aria", in_uso=True, nome="Open-Meteo aria (CAMS)", sito="open-meteo", formati=["JSON"]),
    "ARPAC Open Data": dict(id="arpac", nome="ARPAC open data", sito="arpac", formati=["CSV"]),
    "meteo@uniparthenope": dict(id="uniparthenope", nome="meteo@​uniparthenope", sito="uniparthenope", formati=["JSON", "CSV"]),
    "Meteoalarm Italia": dict(id="meteoalarm", in_uso=True, nome="Meteoalarm", sito="meteoalarm", formati=["CAP"]),
    "EEA Bathing Water 2025 (ArcGIS)": dict(id="eea-balneazione", in_uso=True, nome="Balneazione (EEA)", sito="eea", formati=["ArcGIS"]),
    "Open-Meteo Historical (ERA5)": dict(id="open-meteo-storico", nome="Open-Meteo storico (ERA5)", sito="open-meteo", formati=["JSON", "CSV"]),
    "MET Norway Locationforecast": dict(id="met-norway", in_uso=True, nome="MET Norway", sito="met-norway", formati=["GeoJSON"]),
    "INGV, terremoti": dict(id="ingv", in_uso=True, nome="INGV terremoti", sito="ingv", formati=["GeoJSON"]),
    "Sensor.Community": dict(id="sensor-community", nome="Sensor.​Community", sito="sensor-community", formati=["JSON"]),
    "WAQI / aqicn.org": dict(id="waqi", nome="WAQI aqicn.org", sito="waqi", formati=["JSON"]),
    "DPC, radar e bollettini": dict(id="dpc-radar", nome="Protezione Civile radar", sito="protezione-civile", formati=["GeoTIFF", "JSON"]),
    "EEA END, rumore": dict(id="eea-rumore", nome="Rumore (EEA)", sito="eea", formati=["ArcGIS"]),
    # 2.2 Mobilità e trasporti
    "GTFS ANM": dict(id="anm-gtfs", in_uso=True, nome="ANM orari", sito="anm", formati=["GTFS"]),
    "ANM in tempo reale (BusOne)": dict(id="busone-anm", nome="ANM live (BusOne)", sito="busone", formati=["GTFS-RT"]),
    "ViaggiaTreno": dict(id="viaggiatreno", nome="ViaggiaTreno", sito="viaggiatreno", formati=["JSON"]),
    "Transitous (MOTIS)": dict(id="transitous", in_uso=True, nome="Transitous", sito="transitous", formati=["JSON"]),
    "GTFS EAV": dict(id="eav-gtfs", in_uso=True, nome="EAV orari", sito="eav", formati=["GTFS"]),
    "Infomobilità EAV": dict(id="eav-avvisi", in_uso=True, nome="EAV avvisi", sito="eav", formati=["RSS", "JSON"]),
    "Eventi ASPI e Tangenziale": dict(id="aspi", in_uso=True, nome="Autostrade e Tangenziale", sito="autostrade", formati=["JSON"]),
    "Trenitalia e Italo (BusOne)": dict(id="busone-treni", nome="Trenitalia e Italo (BusOne)", sito="busone", formati=["GTFS", "SIRI"]),
    "NAP Italia, NeTEx Campania": dict(id="nap-netex", nome="NAP Italia (aliscafi)", sito="cciss", formati=["NeTEx"]),
    "OpenStreetMap via Overpass": dict(id="openstreetmap", nome="OpenStreetMap", sito="openstreetmap", formati=["JSON"]),
    "TomTom / HERE Traffic": dict(id="tomtom-here", nome="TomTom / HERE traffico", sito=None, formati=["JSON"],
                                  nota_icona="due aziende nella stessa riga: solo il nome, nessun logo"),
    "Assaeroporti": dict(id="assaeroporti", nome="Assaeroporti", sito="assaeroporti", formati=["XLSX"]),
    "OpenSky Network": dict(id="opensky", nome="OpenSky Network", sito="opensky", formati=["JSON"]),
    "Validazioni TPL Campania": dict(id="validazioni-tpl", nome="Validazioni TPL Campania", sito="regione-campania", formati=["CSV"]),
    "ANM, stato del servizio e parcheggi": dict(id="anm-stato", nome="ANM stato del servizio", sito="anm", formati=[], pubblica=False),
    "AIS Stream": dict(id="aisstream", nome="AIS Stream (navi)", sito="aisstream", formati=["WebSocket"]),
    # 2.3 Eventi e turismo
    "Agenda eventi del Comune": dict(id="comune-agenda", in_uso=True, nome="Agenda del Comune", sito="comune-napoli", formati=["JSON", "RSS"]),
    "Calendario Serie A (openfootball)": dict(id="openfootball", in_uso=True, nome="Serie A (openfootball)", sito="openfootball", formati=["JSON"]),
    "TheSportsDB": dict(id="thesportsdb", in_uso=True, nome="TheSportsDB", sito="thesportsdb", formati=["JSON"]),
    "Visitatori dei siti comunali": dict(id="comune-visitatori", in_uso=True, nome="Visitatori siti comunali", sito="opendata-comune", formati=["CSV"]),
    "Bollettini del Porto di Napoli": dict(id="adsp-porto", in_uso=True, nome="Porto di Napoli (AdSP)", sito="adsp", formati=["PDF"]),
    "Cruise Timetables": dict(id="cruise-timetables", in_uso=True, nome="Cruise Timetables", sito="cruisetimetables", formati=["RSS"]),
    "Musei statali (MiC)": dict(id="mic-musei", nome="Musei statali (MiC)", sito="cultura", formati=["PDF"]),
    "ISTAT, turismo e capacità ricettiva": dict(id="istat-turismo", in_uso=True, nome="ISTAT turismo", sito="istat", formati=["SDMX"]),
    "Inside Airbnb": dict(id="inside-airbnb", in_uso=True, nome="Inside Airbnb", sito="insideairbnb", formati=["CSV", "GeoJSON"]),
    "Wikipedia pageviews": dict(id="wikipedia-visite", nome="Wikipedia visite", sito="wikipedia", formati=["JSON"]),
    "Wikidata SPARQL": dict(id="wikidata", in_uso=True, nome="Wikidata", sito="wikidata", formati=["SPARQL"]),
    "America's Cup 2027": dict(id="americas-cup", in_uso=True, nome="America's Cup 2027", sito="americascup", formati=["JSON", "PDF"]),
    "Nager.Date": dict(id="nager-date", nome="Nager.Date festività", sito="nager", formati=["JSON"]),
    "football-data.org": dict(id="football-data", nome="football-​data.org", sito="football-data", formati=["JSON"]),
    "Presenze da rete mobile": dict(id="presenze-rete-mobile", nome="Persone per zona (rete mobile)", sito=None, formati=[], pubblica=False,
                                    nota_icona="dato non pubblico: nessun sito da cui prendere un'icona"),
    # 2.4 Territorio, servizi e cataloghi
    "Basi territoriali ISTAT (ASC 2021)": dict(id="istat-quartieri", nome="ISTAT quartieri", sito="istat", formati=["Shapefile", "CSV"]),
    "ISTAT, popolazione residente": dict(id="istat-popolazione", nome="ISTAT popolazione", sito="istat", formati=["SDMX"]),
    "Farmacie": dict(id="farmacie", nome="Farmacie (Min.\u00a0Salute)", sito="salute", formati=["CSV", "JSON", "XML"]),
    "Parcheggi ANM": dict(id="parcheggi-anm", nome="Parcheggi ANM", sito="opendata-comune", formati=["CSV"]),
    "IndicePA": dict(id="indicepa", nome="IndicePA", sito="indicepa", formati=["JSON"]),
    "Altri dataset del CKAN comunale": dict(id="comune-ckan", nome="Open data del Comune", sito="opendata-comune", formati=["CSV"]),
    "dati.gov.it": dict(id="dati-gov", nome="dati.gov.it", sito="dati-gov", formati=["JSON"]),
    "Open data Regione Campania": dict(id="regione-opendata", nome="Open data Regione", sito="regione-campania", formati=["GeoJSON", "CSV"]),
    "Città Metropolitana di Napoli": dict(id="citta-metropolitana", nome="Città Metropolitana", sito="citta-metropolitana", formati=["CSV", "JSON"]),
    "TIM Big Data Challenge (Milano 2013)": dict(id="tim-big-data", nome="TIM Big Data (Milano 2013)", sito="dataverse", formati=["TSV"]),
}


def tabelle(testo: str) -> list[dict]:
    """Righe delle tabelle 2.1-2.4, con le colonne del documento."""
    righe, dominio, intestazione = [], None, None
    for linea in testo.splitlines():
        m = re.match(r"^### (2\.[1-5]) ", linea)
        if m:
            dominio = next((d["id"] for d in DOMINI if d["sezione"] == m.group(1)), None)
            intestazione = None
            continue
        if linea.startswith("## ") and not linea.startswith("## 2."):
            dominio = None
        if not dominio or not linea.startswith("|"):
            continue
        celle = [c.strip() for c in linea.strip().strip("|").split("|")]
        if celle[0] == "Fonte":
            intestazione = celle
            continue
        if set(linea.replace("|", "").strip()) <= {"-"}:
            continue
        r = dict(zip(intestazione, celle))
        r["_dominio"] = dominio
        righe.append(r)
    return righe


def pulisci(s: str) -> str:
    """Toglie i link e il markdown da una cella."""
    s = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", s)
    return s.replace("`", "").replace("**", "").strip()


def esito(verifica: str) -> str:
    v = verifica.lower()
    for chiave in ("confermata con correzioni", "confermata", "aggiunta dal verificatore", "non verificabile",
                   "bloccata dalla sandbox", "non funziona"):
        if v.startswith(chiave):
            return chiave
    sys.exit(f"Esito della verifica non riconosciuto: {verifica[:60]}")


# --------------------------------------------------------------------------------------------- icone

class Link(html.parser.HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.icone: list[dict] = []
        self.manifest: str | None = None
        self.base: str | None = None

    def handle_starttag(self, tag, attrs):
        a = {k.lower(): (v or "") for k, v in attrs}
        if tag == "base" and a.get("href"):
            self.base = a["href"]
        if tag != "link" or not a.get("href"):
            return
        rel = a.get("rel", "").lower().split()
        if "manifest" in rel:
            self.manifest = a["href"]
        elif "mask-icon" in rel:
            return   # icona monocromatica di Safari: non è il logo a colori
        elif "icon" in rel or "apple-touch-icon" in rel or "apple-touch-icon-precomposed" in rel:
            self.icone.append({"href": a["href"], "sizes": a.get("sizes", ""), "type": a.get("type", ""),
                               "apple": any(r.startswith("apple-touch-icon") for r in rel)})


def scarica(url: str, limite: int = 3_000_000) -> tuple[bytes, str, str]:
    """GET con User-Agent generico; se il sito rifiuta (403), riprova con un User-Agent da browser senza dati personali."""
    ctx = ssl.create_default_context(cafile="/root/.ccr/ca-bundle.crt") if Path("/root/.ccr/ca-bundle.crt").exists() else None
    ultimo = None
    for ua in (UA, UA_BROWSER):
        req = urllib.request.Request(url, headers={"User-Agent": ua, "Accept": "*/*"})
        try:
            with urllib.request.urlopen(req, timeout=25, context=ctx) as r:
                return r.read(limite), r.headers.get("Content-Type", ""), r.geturl()
        except urllib.error.HTTPError as e:
            ultimo = e
            if e.code not in (403, 406, 429, 503):
                break
        except Exception as e:  # noqa: BLE001 - timeout, DNS, TLS: il sito non risponde
            ultimo = e
            break
    raise RuntimeError(f"{url}: {ultimo}")


def misura(sizes: str) -> int:
    if sizes.strip().lower() == "any":
        return 1024
    m = re.findall(r"(\d+)x(\d+)", sizes)
    return max((int(a) for a, _ in m), default=0)


def candidati(sito: str) -> list[dict]:
    pagina, _, url_finale = scarica(sito)
    p = Link()
    p.feed(pagina.decode("utf-8", "replace"))
    base = urllib.parse.urljoin(url_finale, p.base) if p.base else url_finale
    c = []
    for i in p.icone:
        c.append({"url": urllib.parse.urljoin(base, i["href"]), "dichiarata": misura(i["sizes"]) or (180 if i["apple"] else 0),
                  "svg": "svg" in i["type"] or i["href"].lower().split("?")[0].endswith(".svg"), "da": "pagina"})
    if p.manifest:
        try:
            murl = urllib.parse.urljoin(base, p.manifest)
            m = json.loads(scarica(murl)[0].decode("utf-8", "replace"))
            for i in m.get("icons", []):
                c.append({"url": urllib.parse.urljoin(murl, i["src"]), "dichiarata": misura(i.get("sizes", "")),
                          "svg": "svg" in i.get("type", "") or i["src"].lower().endswith(".svg"), "da": "manifest"})
        except Exception:  # noqa: BLE001
            pass
    radice = urllib.parse.urljoin(url_finale, "/")
    c.append({"url": radice + "apple-touch-icon.png", "dichiarata": 180, "svg": False, "da": "predefinita"})
    c.append({"url": radice + "favicon.ico", "dichiarata": 0, "svg": False, "da": "predefinita"})
    # Prima le raster più grandi, poi le SVG, poi il resto
    c.sort(key=lambda x: (-(min(x["dichiarata"], 512) if not x["svg"] else 150), x["da"] == "predefinita"))
    visti, unici = set(), []
    for x in c:
        if x["url"] not in visti:
            visti.add(x["url"])
            unici.append(x)
    return unici


def apri_immagine(dati: bytes):
    from PIL import Image
    im = Image.open(io.BytesIO(dati))
    if getattr(im, "format", "") == "ICO":
        # la cornice più grande dell'ICO
        misure = sorted(im.info.get("sizes", {im.size}), key=lambda s: s[0] * s[1])
        im.size = misure[-1]
    im.load()
    return im.convert("RGBA")


def node(js: str, *argomenti: str, timeout: int = 120) -> str:
    """Esegue uno script Node con Playwright (preso dai moduli globali) e ne restituisce l'uscita."""
    npm = subprocess.run(["npm", "root", "-g"], capture_output=True, text=True).stdout.strip()
    r = subprocess.run(["node", "-e", js, *argomenti], capture_output=True, text=True, timeout=timeout,
                       env={**os.environ, "NODE_PATH": npm})
    if r.returncode != 0:
        raise RuntimeError(r.stderr.strip().splitlines()[-1] if r.stderr.strip() else f"node: uscita {r.returncode}")
    return r.stdout


def svg_in_png(file_svg: Path, file_png: Path) -> None:
    """Rende un'icona SVG ufficiale in PNG con Chromium (come <img>, quindi senza script)."""
    node(r"""
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const [svg, png, lato] = process.argv.slice(1);
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: +lato, height: +lato } });
  const dati = 'data:image/svg+xml;base64,' + fs.readFileSync(svg).toString('base64');
  await p.setContent(`<html><body style="margin:0;background:transparent"><img src="${dati}" style="width:${lato}px;height:${lato}px;object-fit:contain"></body></html>`);
  await p.waitForTimeout(150);
  await p.screenshot({ path: png, omitBackground: true });
  await b.close();
})();
""", str(file_svg), str(file_png), str(LATO * 2))


def candidati_browser(sito: str, attesa: int = 45) -> list[dict]:
    """Apre il sito in Chromium (per i siti che reindirizzano in JavaScript o fanno una verifica anti-bot) e
    raccoglie le icone dichiarate; quelle dello stesso sito le scarica dalla pagina stessa, con i suoi cookie."""
    out = node(r"""
const { chromium } = require('playwright');
(async () => {
  const [sito, attesa] = process.argv.slice(1);
  const b = await chromium.launch();
  const p = await b.newPage();
  const ris = { candidati: [], errore: null };
  try {
    await p.goto(sito, { waitUntil: 'domcontentloaded', timeout: +attesa * 1000 });
    await p.waitForTimeout(3000);
    try { await p.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}
    const c = await p.evaluate(async () => {
      const lista = [];
      for (const l of document.querySelectorAll('link[rel][href]')) {
        const rel = (l.getAttribute('rel') || '').toLowerCase().split(/\s+/);
        if (rel.includes('mask-icon')) continue;
        if (rel.includes('icon') || rel.some((r) => r.startsWith('apple-touch-icon')))
          lista.push({ url: l.href, sizes: l.getAttribute('sizes') || (rel.some((r) => r.startsWith('apple')) ? '180x180' : ''), type: l.getAttribute('type') || '', da: 'pagina (Chromium)' });
      }
      const man = document.querySelector('link[rel="manifest"]');
      if (man) {
        try {
          const m = await (await fetch(man.href)).json();
          for (const i of m.icons || []) lista.push({ url: new URL(i.src, man.href).href, sizes: i.sizes || '', type: i.type || '', da: 'manifest (Chromium)' });
        } catch {}
      }
      lista.push({ url: new URL('/apple-touch-icon.png', location.href).href, sizes: '180x180', type: '', da: 'predefinita (Chromium)' });
      lista.push({ url: new URL('/favicon.ico', location.href).href, sizes: '', type: '', da: 'predefinita (Chromium)' });
      return lista;
    });
    for (const x of c.slice(0, 12)) {
      const r = await p.evaluate(async (u) => {
        try {
          const r = await fetch(u, { credentials: 'include' });
          if (!r.ok) return { stato: r.status };
          const b = new Uint8Array(await r.arrayBuffer());
          let s = '';
          for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode.apply(null, b.subarray(i, i + 8192));
          return { stato: r.status, tipo: r.headers.get('content-type') || '', b64: btoa(s) };
        } catch (e) { return { errore: String(e) }; }
      }, x.url);
      ris.candidati.push({ ...x, ...r });
    }
  } catch (e) { ris.errore = String(e); }
  console.log(JSON.stringify(ris));
  await b.close();
})();
""", sito, str(attesa), timeout=attesa + 90)
    ris = json.loads(out.strip().splitlines()[-1])
    if ris.get("errore") and not ris["candidati"]:
        raise RuntimeError(ris["errore"][:120])
    return ris["candidati"]


def sfondo_per(im) -> str:
    """'scuro' se l'icona è chiara su fondo trasparente (sparirebbe su un tondo bianco), altrimenti 'chiaro'."""
    b = im.tobytes()
    opachi = [(b[i], b[i + 1], b[i + 2]) for i in range(0, len(b), 4) if b[i + 3] > 128]
    if not opachi:
        return "chiaro"
    copertura = len(opachi) / (len(b) // 4)
    luce = sum(0.2126 * r + 0.7152 * g + 0.0722 * bb for r, g, bb in opachi) / len(opachi)
    return "scuro" if copertura < 0.92 and luce > 205 else "chiaro"


def valuta(dati: bytes, url: str, svg: bool, grezzo: Path) -> dict:
    """Apre un'icona scaricata (raster o SVG) e ne misura il lato utile."""
    from PIL import Image
    grezzo.mkdir(parents=True, exist_ok=True)
    nome = re.sub(r"[^a-zA-Z0-9._-]", "_", urllib.parse.urlparse(url).path.split("/")[-1] or "icona")[:60]
    (grezzo / nome).write_bytes(dati)
    if dati[:200].lstrip().lower().startswith((b"<!doctype html", b"<html")):
        raise ValueError("è una pagina HTML, non un'immagine")
    if svg or b"<svg" in dati[:2000].lower():
        tmp = grezzo / (nome + ".png")
        svg_in_png(grezzo / nome, tmp)
        im, orig, lato = Image.open(tmp).convert("RGBA"), "svg", 10_000
    else:
        im = apri_immagine(dati)
        orig, lato = f"{im.size[0]}x{im.size[1]}", min(im.size)
    if not im.getbbox():
        raise ValueError("immagine vuota")
    return {"im": im, "url": url, "orig": orig, "lato": lato}


def prendi_icona(chiave: str, sito: str, cartella: Path, scarichi: Path) -> dict:
    from PIL import Image
    tentativi, migliore = [], None
    grezzo = scarichi / chiave

    def prova(dati: bytes | None, url: str, svg: bool, da: str) -> None:
        nonlocal migliore
        try:
            if dati is None:
                dati, _, url = scarica(url)
            c = valuta(dati, url, svg, grezzo)
        except Exception as e:  # noqa: BLE001
            tentativi.append(f"{url}: {str(e)[:70]}")
            return
        c["da"] = da
        if migliore is None or c["lato"] > migliore["lato"]:
            migliore = c

    if chiave in ICONE_DIRETTE:
        prova(None, ICONE_DIRETTE[chiave], False, "indirizzo ufficiale scritto a mano")
    else:
        try:
            for c in candidati(sito)[:8]:
                prova(None, c["url"], c["svg"], c["da"])
                if migliore and migliore["lato"] >= LATO:
                    break
        except Exception as e:  # noqa: BLE001
            tentativi.append(f"{sito}: {str(e)[:90]}")
        if not migliore or migliore["lato"] < BUONA:
            # Redirect in JavaScript, verifiche anti-bot, intestazioni scritte dagli script: si apre la pagina in Chromium
            try:
                for c in candidati_browser(sito):
                    svg = "svg" in (c.get("type") or "") or "svg" in (c.get("tipo") or "") or c["url"].split("?")[0].lower().endswith(".svg")
                    if c.get("b64"):
                        import base64
                        prova(base64.b64decode(c["b64"]), c["url"], svg, c["da"])
                    elif c.get("errore"):   # un'icona su un altro dominio: si scarica direttamente
                        prova(None, c["url"], svg, c["da"])
                    if migliore and migliore["lato"] >= LATO:
                        break
            except Exception as e:  # noqa: BLE001
                tentativi.append(f"Chromium: {str(e)[:90]}")
    if migliore is None or migliore["lato"] < MINIMO:
        return {"file": None, "esito": "nessuna icona decente" + (f" (la più grande è {migliore['orig']})" if migliore else
                                                                  " (il sito non risponde o non dichiara icone)"),
                "tentativi": tentativi[:5]}
    im = migliore["im"]
    # Ritaglio dei bordi trasparenti e PNG quadrato 128×128 con l'icona centrata
    bbox = im.getbbox()
    im = im.crop(bbox)
    k = LATO / max(im.size)
    im = im.resize((max(1, round(im.size[0] * k)), max(1, round(im.size[1] * k))), Image.LANCZOS)
    tela = Image.new("RGBA", (LATO, LATO), (0, 0, 0, 0))
    tela.paste(im, ((LATO - im.size[0]) // 2, (LATO - im.size[1]) // 2), im)
    file = cartella / f"{chiave}.png"
    tela.save(file, optimize=True)
    return {"file": f"loghi/{chiave}.png", "da": migliore["url"], "originale": migliore["orig"], "trovata_in": migliore["da"],
            "sfondo": sfondo_per(tela), "esito": "ok"}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--loghi", action="store_true", help="scarica di nuovo le icone dei siti")
    ap.add_argument("--solo", help="con --loghi: solo questi siti (chiavi separate da virgola)")
    ap.add_argument("--scarichi", default="/tmp/twinciro-loghi-grezzi", help="cartella dei file scaricati così come sono")
    ap.add_argument("--uscita", default=str(USCITA))
    a = ap.parse_args()
    uscita = Path(a.uscita)
    file_cat = uscita / "catalogo.json"
    vecchio = json.loads(file_cat.read_text(encoding="utf-8")) if file_cat.exists() else {}
    loghi = dict(vecchio.get("loghi", {}))

    righe = tabelle(DOC.read_text(encoding="utf-8"))
    nomi_doc = [pulisci(r["Fonte"]) for r in righe]
    mancano = [n for n in nomi_doc if n not in VOCI]
    in_piu = [n for n in VOCI if n not in nomi_doc]
    if mancano or in_piu:
        sys.exit(f"Catalogo e voci non coincidono.\n  righe del documento senza voce: {mancano}\n  voci senza riga: {in_piu}")

    if a.loghi:
        cartella = uscita / "loghi"
        cartella.mkdir(parents=True, exist_ok=True)
        scelti = a.solo.split(",") if a.solo else list(SITI)
        for k in scelti:
            print(f"  {k}: {SITI[k]}", flush=True)
            info = prendi_icona(k, SITI[k], cartella, Path(a.scarichi))
            info["sito"] = SITI[k]
            info["scaricata"] = date.today().isoformat()
            loghi[k] = info
            print(f"     → {info.get('file')} {info.get('originale', '')} {info['esito']}", flush=True)

    fonti = []
    for r in righe:
        nome_doc = pulisci(r["Fonte"])
        v = VOCI[nome_doc]
        logo = loghi.get(v["sito"]) if v["sito"] else None
        nota_logo = None
        if v["sito"] in RISERVE and not (logo or {}).get("file"):
            riserva, nota_logo = RISERVE[v["sito"]]
            logo = loghi.get(riserva)
        es = esito(pulisci(r["Verifica"]))
        f = {
            "id": v["id"],
            "nome": v["nome"],
            "fonte_catalogo": nome_doc,
            "ente": pulisci(r["Ente"]),
            "dominio": r["_dominio"],
            "sito": SITI.get(v["sito"]) if v["sito"] else None,
            "formati": v["formati"],
            "formato_catalogo": pulisci(r["Formato"]),
            "accesso": pulisci(r["Accesso"]),
            "pubblica": v.get("pubblica", True),
            "in_uso": v.get("in_uso", False),
            "esito": es,
            "funziona": es in ("confermata", "confermata con correzioni", "aggiunta dal verificatore"),
            "icona": (logo or {}).get("file"),
            "icona_sfondo": (logo or {}).get("sfondo"),
            "icona_da": (logo or {}).get("da"),
        }
        if nota_logo and f["icona"]:
            f["icona_nota"] = nota_logo
        if not f["icona"]:
            f["icona_nota"] = v.get("nota_icona") or (logo or {}).get("esito") or "icona non scaricata"
        fonti.append(f)

    pubbliche = [f for f in fonti if f["pubblica"]]
    cat = {
        "nota": ("Fonti del catalogo docs/fonti-dati-napoli.md (sezione 2, verifica del 14/11/2026), una voce per riga, "
                 "per le scene motivazione.html e fonti.html del video. Generato da costruisci.py: non modificare a mano. "
                 "'pubblica' è false solo per le due righe che non sono fonti pubbliche (presenze da rete mobile, stato "
                 "del servizio ANM): le scene contano e mostrano le fonti pubbliche. 'funziona' è true se la verifica l'ha "
                 "confermata; le altre vanno riprovate dalla rete italiana o con una chiave gratuita. 'in_uso' è true per le "
                 "fonti già collegate all'API dati città (citta-api/, sezione 0 del catalogo). Le icone sono quelle "
                 "dei siti ufficiali (vedi 'loghi': indirizzo esatto e data), ridotte a PNG 128×128; null = solo il nome."),
        "catalogo": "docs/fonti-dati-napoli.md",
        "verifica": "2026-11-14",
        "generato": date.today().isoformat(),
        "conteggi": {
            "righe": len(fonti),
            "pubbliche": len(pubbliche),
            "pubbliche_confermate": sum(f["funziona"] for f in pubbliche),
            "pubbliche_da_riprovare": sum(not f["funziona"] for f in pubbliche),
            "in_uso": sum(f["in_uso"] for f in fonti),
            "con_icona": sum(bool(f["icona"]) for f in fonti),
        },
        "domini": DOMINI,
        "fonti": fonti,
        "loghi": {k: loghi[k] for k in sorted(loghi)},
    }
    uscita.mkdir(parents=True, exist_ok=True)
    file_cat.write_text(json.dumps(cat, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"{file_cat}: {len(fonti)} righe, {len(pubbliche)} pubbliche, {cat['conteggi']['con_icona']} con icona")


if __name__ == "__main__":
    main()
