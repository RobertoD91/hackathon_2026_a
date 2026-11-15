"""Sala operativa: console a schermo intero (niente webapp).

Mostra in diretta cosa si dicono gli agenti, la folla per zona, le misure vere del badge WHY2025
e della scheda Tasmota (pannello "Sensori reali"), i semafori simulati del gemello con il piano
dell'agente Traffico e i KPI del gemello con e senza agenti.

Da sola, collegata al broker:  python -m citta.sala --broker localhost
Al broker del team (utente e password dall'ambiente, come per avvia.py):
  C5_MQTT_UTENTE=c5 C5_MQTT_PASSWORD=... python -m citta.sala --broker twinciro.robertodisanto.it:1883
"""

from __future__ import annotations

import argparse
import collections
import threading
import time

from rich.console import Group
from rich.layout import Layout
from rich.markup import escape
from rich.live import Live
from rich.panel import Panel
from rich.table import Table
from rich.text import Text

from .bus import Bus, ErroreBroker, crea_bus
from .sensori import UNITA, SensoriReali, fa, numero_valido
from .testi import nome_zona

COLORI_AGENTE = {"Orchestratore": "bold magenta", "Traffico": "cyan", "Folla": "yellow", "Eventi": "green",
                 "Meteo&Mare": "blue", "Turismo": "bright_green", "Imprese": "bright_yellow"}
COLORI_LIVELLO = {"basso": "green", "medio": "yellow", "alto": "dark_orange", "critico": "bold red"}
LUCE = {"verde": "[bold green]●[/]", "giallo": "[bold yellow]●[/]", "rosso": "[bold red]●[/]"}


class Sala:
    def __init__(self, bus: Bus, llm_nome: str = "") -> None:
        self.bus = bus
        self.llm_nome = llm_nome
        self.dialogo: collections.deque = collections.deque(maxlen=60)
        self.decisione: dict | None = None
        self.drone: dict | None = None
        self.lock = threading.Lock()
        self.sensori = SensoriReali(bus)
        bus.iscriviti("napoli/agenti/dialogo", self._dialogo)
        bus.iscriviti("napoli/orchestratore/decisioni", lambda t, m: setattr(self, "decisione", m))
        bus.iscriviti("napoli/drone/richieste", lambda t, m: setattr(self, "drone", m))
        bus.iscriviti("napoli/drone/osservazioni", lambda t, m: setattr(self, "drone", {**m, "fatto": True}))
        # Iscrizioni per riempire la cache dei messaggi trattenuti anche con il bus MQTT.
        for filtro in ("napoli/folla/+", "napoli/semafori/+/stato", "napoli/semafori/piano", "napoli/kpi",
                       "napoli/orologio", "napoli/meteo"):
            bus.iscriviti(filtro, lambda t, m: None)

    def _dialogo(self, topic: str, m: dict) -> None:
        with self.lock:
            self.dialogo.append(m)

    # --- pannelli -------------------------------------------------------------
    def _testata(self) -> Panel:
        ora = (self.bus.ultimo("napoli/orologio") or {}).get("ora", "--:--")
        meteo = self.bus.ultimo("napoli/meteo") or {}
        riga = Text.from_markup(
            f"[bold]NAPOLI AGENTIC CITY[/] · sala operativa   [bold white on blue] {ora} [/]   "
            f"vento {meteo.get('vento_nodi', '?')} nodi · onda {meteo.get('onda_m', '?')} m · "
            f"{meteo.get('temperatura_c', '?')}°C · regata "
            + ("[green]sì[/]" if meteo.get("regata_ok") else "[red]a rischio[/]" if meteo else "?")
            + f"   [dim]LLM: {self.llm_nome}[/]")
        return Panel(riga, style="white")

    def _folla(self) -> Panel:
        t = Table(expand=True, box=None, pad_edge=False)
        t.add_column("Zona")
        t.add_column("Persone", justify="right")
        t.add_column("", ratio=1)
        t.add_column("Livello")
        for _, m in sorted(self.bus.trattenuti("napoli/folla/+").items()):
            r = min(1.2, m["persone"] / m["capienza"])
            col = COLORI_LIVELLO.get(m["livello"], "white")
            barra = f"[{col}]" + "█" * int(r * 12) + "[/]" + "·" * max(0, 12 - int(r * 12))
            fonti = " [dim]📡[/]" if "drone" in m.get("fonti", []) else ""
            t.add_row(m["nome"][:26], f"{m['persone']:,}".replace(",", "."), barra, f"[{col}]{m['livello']}[/]{fonti}")
        return Panel(t, title="Folla per zona", border_style="yellow")

    def _sensori(self, righe: int) -> Panel:
        """Ultimo valore per dispositivo e grandezza, con zona e da quanto tempo; pallino = online/offline."""
        stato = self.sensori.stato()
        elenco = []
        for nodo in sorted(set(stato["sensori"]) | set(stato["nodi"])):
            info = stato["nodi"].get(nodo, {})
            pallino = {True: "[bold green]●[/]", False: "[bold red]●[/]"}.get(info.get("online"), "[dim]○[/]")
            letture = stato["sensori"].get(nodo) or {"": {}}
            for i, (grandezza, m) in enumerate(letture.items()):
                if "valore" in m:
                    valore = f"{m['valore']:g} {UNITA.get(grandezza, '')}".strip()
                    if numero_valido(m.get("moltiplicatore")):  # un testo qui farebbe cadere la sala (e la città)
                        valore += f" ×{m['moltiplicatore']:g}"
                    quando = fa(m["secondi_fa"])
                else:
                    stato_nodo = "online" if info.get("online") else "offline"
                    valore, quando = f"[dim]{stato_nodo}[/]", fa(info.get("secondi_fa", 0))
                zona = m.get("zona") or info.get("zona") or ""
                # Id, grandezza e zona arrivano dai dispositivi: niente markup di rich (Text semplice o escape).
                misura = Text(grandezza.replace("umidita", "umidità") or "–", style="" if grandezza else "dim",
                              no_wrap=True, overflow="ellipsis")
                elenco.append((f"{pallino} {escape(nodo)}" if i == 0 else "", misura, valore,
                               Text(nome_zona(str(zona)) if zona else "", no_wrap=True, overflow="ellipsis"),
                               f"[dim]{quando}[/]"))
        if not elenco:
            return Panel(Text("in attesa del badge e della scheda Tasmota (napoli/sensori/#, napoli/nodi/+/stato)",
                              style="dim"), title="Sensori reali", border_style="bright_cyan")
        t = Table(expand=True, box=None, pad_edge=False)
        # Su un terminale stretto si accorciano prima misura e zona (colonne "comprimibili", testo con i puntini):
        # dispositivo, valore e "quando" restano interi.
        for colonna, allinea, comprimibile in (("Dispositivo", "left", False), ("Misura", "left", True),
                                               ("Valore", "right", False), ("Zona", "left", True),
                                               ("Quando", "right", False)):
            t.add_column(colonna, justify=allinea, no_wrap=not comprimibile, overflow="ellipsis")
        for riga in elenco[:righe]:
            t.add_row(*riga)
        return Panel(t, title="Sensori reali (badge WHY2025, Tasmota)", border_style="bright_cyan")

    def _semafori(self) -> Panel:
        t = Table(expand=True, box=None, pad_edge=False)
        t.add_column("Incrocio (gemello)")
        t.add_column("A", justify="center")
        t.add_column("B", justify="center")
        for topic, m in sorted(self.bus.trattenuti("napoli/semafori/+/stato").items()):
            t.add_row(m.get("nome", topic.split("/")[2])[:34], LUCE.get(m.get("a"), "?"), LUCE.get(m.get("b"), "?"))
        piano = self.bus.ultimo("napoli/semafori/piano") or {}
        pesi = " · ".join(f"{c} ×{p:g}" for c, p in piano.get("pesi", {}).items() if p != 1) or "tutti normali"
        sotto = Text.from_markup(f"[dim]Piano:[/] {pesi} · verde max {piano.get('verde_max', '?')}s")
        return Panel(Group(t, sotto), title="Semafori (simulati nel gemello)", border_style="cyan")

    def _kpi(self) -> Panel:
        k = self.bus.ultimo("napoli/kpi")
        if not k:
            return Panel("in attesa del gemello…", title="Gemello digitale: oggi vs con agenti", border_style="green")
        a, b, r = k["oggi"], k["agenti"], k["risparmio_pct"]

        def pct(x):
            if x is None:
                return "–"
            return f"[bold green]-{x:g}%[/]" if x > 0 else f"[red]+{-x:g}%[/]"

        t = Table(expand=True, box=None)
        t.add_column("")
        t.add_column("Oggi", justify="right")
        t.add_column("Con agenti", justify="right")
        t.add_column("Δ", justify="right")
        t.add_row("Ore perse in coda", f"{a['ore_perse_in_coda']:g}", f"{b['ore_perse_in_coda']:g}", pct(r["ore_perse_in_coda"]))
        t.add_row("Durata media viaggio", f"{a['durata_media_s'] or 0:.0f}s", f"{b['durata_media_s'] or 0:.0f}s", pct(r["durata_media"]))
        t.add_row("CO₂ (kg)", f"{a['co2_kg']:g}", f"{b['co2_kg']:g}", pct(r["co2"]))
        t.add_row("Veicoli fermi ora", str(a["fermi_ora"]), str(b["fermi_ora"]), "")
        return Panel(t, title="Gemello digitale (SUMO, strade vere): oggi vs con agenti", border_style="green")

    def _dialogo_pannello(self, righe: int) -> Panel:
        with self.lock:
            ultimi = list(self.dialogo)[-righe:][::-1]  # i più recenti in alto
        testo = Text()
        for m in ultimi:
            da = m.get("da", "?")
            col = COLORI_AGENTE.get(da, "bright_white" if da.startswith("Assistente") else "white")
            testo.append(f"{m.get('ora', '')} ", style="dim")
            testo.append(da, style=col)
            testo.append(f" → {m.get('a', '')}: ", style="dim")
            testo.append(m.get("testo", ""))
            if m.get("fonte") and m["fonte"] != "regole":
                testo.append(f"  [{m['fonte']}]", style="dim italic")
            testo.append("\n")
        return Panel(testo, title="Cosa si dicono gli agenti (i più recenti in alto)", border_style="magenta")

    def _regia(self) -> Panel:
        parti = []
        d = self.decisione
        if d:
            parti.append(Text.from_markup(f"[bold magenta]{d['id']}[/] {d['ora']} · [dim]{d.get('stato', '')} · {d.get('fonte', '')}[/]"))
            parti.append(Text(d.get("motivazione", "")))
            for a in d.get("azioni", []):
                dettaglio = a.get("corridoio") or a.get("zona") or a.get("testo", "")[:60]
                parti.append(Text.from_markup(f"  [cyan]→ {a['agente']}[/] {dettaglio}"))
        if self.drone:
            dr = self.drone
            if dr.get("fatto"):
                parti.append(Text.from_markup(f"[blue]Drone:[/] {dr.get('zona')} ~{dr.get('persone_stimate')} persone"))
            else:
                parti.append(Text.from_markup(f"[bold blue]Drone richiesto:[/] {dr.get('zona')} — {dr.get('motivo', '')}"))
        return Panel(Group(*parti) if parti else Text("nessuna decisione ancora"), title="Regia (orchestratore)",
                     border_style="bright_magenta")

    def layout(self, altezza: int) -> Layout:
        radice = Layout()
        radice.split_column(Layout(self._testata(), size=3), Layout(name="corpo"))
        radice["corpo"].split_row(Layout(name="sx", ratio=5), Layout(name="dx", ratio=6))
        radice["sx"].split_column(Layout(self._folla(), size=11), Layout(self._sensori(5), size=8),
                                  Layout(self._semafori(), size=8), Layout(self._kpi()))
        radice["dx"].split_column(Layout(self._dialogo_pannello(max(5, altezza - 18))), Layout(self._regia(), size=10))
        return radice

    def mostra(self, fermo: threading.Event | None = None) -> None:
        with Live(self.layout(40), refresh_per_second=4, screen=True) as live:
            while not (fermo and fermo.is_set()):
                live.update(self.layout(live.console.size.height))
                time.sleep(0.25)


if __name__ == "__main__":
    p = argparse.ArgumentParser(
        description="Sala operativa collegata al broker MQTT",
        epilog="Broker del team: C5_MQTT_UTENTE=c5 C5_MQTT_PASSWORD=... "
               "python -m citta.sala --broker twinciro.robertodisanto.it:1883")
    p.add_argument("--broker", default="localhost",
                   help="host[:porta] del broker MQTT; utente e password dalle variabili C5_MQTT_UTENTE e "
                        "C5_MQTT_PASSWORD (senza: anonimo)")
    a = p.parse_args()
    try:
        bus = crea_bus(a.broker)
    except ErroreBroker as e:
        raise SystemExit(f"[bus] ERRORE: {e}")
    Sala(bus, "remoto").mostra()
