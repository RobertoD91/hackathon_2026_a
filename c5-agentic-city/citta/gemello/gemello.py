"""Gemello digitale: due simulazioni SUMO della stessa giornata, in parallelo.

- "oggi":   semafori a tempi fissi, come sono adesso;
- "agenti": semafori guidati dagli agenti (piano dell'agente Traffico + controllo adattivo
            locale), più una quota di guidatori che segue i consigli di percorso dell'assistente.

Le due simulazioni ricevono gli stessi veicoli con gli stessi orari. A ogni minuto simulato
il gemello pubblica l'orologio e i KPI; a ogni cambio di fase pubblica lo stato dei 4 incroci
del plastico, che gli ESP32 rispecchiano.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import threading
import time
from pathlib import Path

import sumolib
import traci
import traci.constants as tc

from .. import DATI
from ..bus import Bus, ora_da_secondi, secondi_da_ora
from .domanda import genera

VERDE_MIN = 8
VERDE_MAX = 60
CAMPIONE = 5  # ogni quanti secondi simulati si leggono i KPI di rete


def _binario(nome: str) -> str:
    try:
        import sumo  # pacchetto pip eclipse-sumo

        candidato = Path(sumo.SUMO_HOME) / "bin" / nome
        if candidato.exists():
            return str(candidato)
    except ImportError:
        pass
    trovato = shutil.which(nome)
    if not trovato:
        raise RuntimeError(f"{nome} non trovato: installa eclipse-sumo (pip install eclipse-sumo)")
    return trovato


def prepara_domanda(scenario: dict, cartella: Path) -> Path:
    """Genera i viaggi e li instrada con duarouter (scarta quelli impossibili)."""
    viaggi = cartella / "viaggi.rou.xml"
    percorsi = cartella / "percorsi.rou.xml"
    genera(scenario, viaggi)
    subprocess.run([_binario("duarouter"), "-n", str(DATI / "lungomare.net.xml"), "-r", str(viaggi),
                    "-o", str(percorsi), "--ignore-errors", "--no-warnings", "--no-step-log"],
                   check=True, capture_output=True)
    return percorsi


class Simulazione:
    """Una istanza SUMO controllata via TraCI."""

    def __init__(self, etichetta: str, percorsi: Path, inizio: int, adattiva: bool,
                 quota_assistiti: float, gui: bool, net: sumolib.net.Net, incroci: dict) -> None:
        self.etichetta = etichetta
        self.adattiva = adattiva
        cmd = [_binario("sumo-gui" if gui else "sumo"), "-n", str(DATI / "lungomare.net.xml"),
               "-r", str(percorsi), "-b", str(inizio), "--seed", "42",
               "--time-to-teleport", "300", "--collision.action", "warn",
               "--no-step-log", "--no-warnings", "--duration-log.disable"]
        if gui:
            cmd += ["--start", "--delay", "0"]
        if quota_assistiti > 0:
            cmd += ["--device.rerouting.probability", str(quota_assistiti),
                    "--device.rerouting.period", "60", "--device.rerouting.adaptation-steps", "60"]
        traci.start(cmd, label=etichetta)
        self.c = traci.getConnection(etichetta)

        # KPI di rete: iscrizione a tutti gli archi (una sola chiamata per leggerli).
        self.archi = [e for e in self.c.edge.getIDList() if not e.startswith(":")]
        for e in self.archi:
            self.c.edge.subscribe(e, [tc.LAST_STEP_VEHICLE_HALTING_NUMBER, tc.VAR_CO2EMISSION])
        self.nome_arco = {e.getID(): e.getName() for e in net.getEdges()}
        self.corridoio_di = {}
        for corr, nomi in incroci["corridoi"].items():
            for e in net.getEdges():
                if e.getName() in nomi:
                    self.corridoio_di[e.getID()] = corr

        # Semafori: fasi verdi e corsie servite da ciascuna.
        self.semafori = {}
        for tls in self.c.trafficlight.getIDList():
            logica = self.c.trafficlight.getAllProgramLogics(tls)[0]
            collegamenti = self.c.trafficlight.getControlledLinks(tls)
            fasi_verdi = {}
            for i, fase in enumerate(logica.phases):
                if "y" in fase.state or not any(ch in "Gg" for ch in fase.state):
                    continue
                corsie = {collegamenti[k][0][0] for k, ch in enumerate(fase.state)
                          if ch in "Gg" and k < len(collegamenti) and collegamenti[k]}
                fasi_verdi[i] = corsie
            corsie_tutte = set().union(*fasi_verdi.values()) if fasi_verdi else set()
            for corsia in corsie_tutte:
                self.c.lane.subscribe(corsia, [tc.LAST_STEP_VEHICLE_HALTING_NUMBER, tc.LAST_STEP_VEHICLE_NUMBER])
            self.semafori[tls] = {"verdi": fasi_verdi, "fase": self.c.trafficlight.getPhase(tls),
                                  "inizio_fase": float(inizio), "collegamenti": collegamenti}

        self.pesi = {}
        self.verde_max = VERDE_MAX
        self.partenze: dict[str, float] = {}
        self.durate: list[float] = []
        self.fermi_veicolo_s = 0.0
        self.co2_g = 0.0
        self.fermi_ora = 0
        self.code_corridoi: dict[str, int] = {}

    # --- controllo adattivo -------------------------------------------------
    def _domanda(self, corsie: set[str], dati_corsie: dict) -> float:
        totale = 0.0
        for corsia in corsie:
            d = dati_corsie.get(corsia)
            if not d:
                continue
            arco = corsia.rsplit("_", 1)[0]
            peso = self.pesi.get(self.corridoio_di.get(arco, ""), 1.0)
            totale += peso * (d[tc.LAST_STEP_VEHICLE_HALTING_NUMBER] + 0.3 * d[tc.LAST_STEP_VEHICLE_NUMBER])
        return totale

    def _controlla(self, t: float) -> None:
        dati_corsie = self.c.lane.getAllSubscriptionResults()
        for tls, s in self.semafori.items():
            fase = self.c.trafficlight.getPhase(tls)
            if fase != s["fase"]:
                s["fase"], s["inizio_fase"] = fase, t
            if not self.adattiva or fase not in s["verdi"] or len(s["verdi"]) < 2:
                continue
            trascorso = t - s["inizio_fase"]
            if trascorso < VERDE_MIN:
                continue
            attuale = self._domanda(s["verdi"][fase], dati_corsie)
            altre = max(self._domanda(c, dati_corsie) for f, c in s["verdi"].items() if f != fase)
            if trascorso >= self.verde_max or altre > attuale * 1.3 + 1:
                self.c.trafficlight.setPhaseDuration(tls, 0)  # passa al giallo
            else:
                self.c.trafficlight.setPhaseDuration(tls, 2)  # resta verde

    # --- passo ---------------------------------------------------------------
    def passo(self) -> float:
        self.c.simulationStep()
        t = self.c.simulation.getTime()
        for v in self.c.simulation.getDepartedIDList():
            self.partenze[v] = t
        for v in self.c.simulation.getArrivedIDList():
            if v in self.partenze:
                self.durate.append(t - self.partenze.pop(v))
        self._controlla(t)
        if int(t) % CAMPIONE == 0:
            dati = self.c.edge.getAllSubscriptionResults()
            fermi = 0
            code: dict[str, int] = {}
            for e, d in dati.items():
                h = d[tc.LAST_STEP_VEHICLE_HALTING_NUMBER]
                fermi += h
                self.co2_g += d[tc.VAR_CO2EMISSION] * CAMPIONE / 1000.0  # mg/s → g
                corr = self.corridoio_di.get(e)
                if corr:
                    code[corr] = code.get(corr, 0) + h
            self.fermi_veicolo_s += fermi * CAMPIONE
            self.fermi_ora = fermi
            self.code_corridoi = code
        return t

    def stato_testa(self, tls: str, principali: set[str]) -> dict:
        """Colore delle due teste del semaforo fisico: A = vie principali, B = le altre."""
        stato = self.c.trafficlight.getRedYellowGreenState(tls)
        collegamenti = self.semafori[tls]["collegamenti"]
        teste = {"a": set(), "b": set()}
        for k, ch in enumerate(stato):
            if k >= len(collegamenti) or not collegamenti[k]:
                continue
            arco = collegamenti[k][0][0].rsplit("_", 1)[0]
            teste["a" if self.nome_arco.get(arco) in principali else "b"].add(ch)

        def colore(segnali: set[str]) -> str:
            if segnali & {"G", "g"}:
                return "verde"
            if segnali & {"y", "Y"}:
                return "giallo"
            return "rosso"

        return {"a": colore(teste["a"]), "b": colore(teste["b"])}

    def kpi(self) -> dict:
        n = len(self.durate)
        return {
            "arrivati": n,
            "durata_media_s": round(sum(self.durate) / n, 1) if n else None,
            "fermi_ora": self.fermi_ora,
            "ore_perse_in_coda": round(self.fermi_veicolo_s / 3600, 1),
            "co2_kg": round(self.co2_g / 1000, 1),
            "code_corridoi": self.code_corridoi,
        }

    def chiudi(self) -> None:
        try:
            self.c.close()
        except Exception:
            pass


class Gemello(threading.Thread):
    def __init__(self, bus: Bus, scenario: dict, velocita: float = 20.0, gui: bool = False,
                 quota_assistiti: float = 0.0, fine: str | None = None) -> None:
        super().__init__(name="gemello", daemon=True)
        self.bus = bus
        self.scenario = scenario
        self.velocita = velocita
        self.gui = gui
        self.quota_assistiti = quota_assistiti
        self.inizio = secondi_da_ora(scenario["inizio"])
        self.fine = secondi_da_ora(fine or scenario["fine"])
        self.incroci = json.loads((DATI / "incroci.json").read_text(encoding="utf-8"))
        self.fermato = threading.Event()
        self.pronto = threading.Event()
        self.risultato: dict | None = None
        self._piano: dict | None = None
        bus.iscriviti("napoli/semafori/piano", lambda t, m: setattr(self, "_piano", m))
        bus.iscriviti("napoli/eventi/manuale", self._evento_manuale)
        self._extra: list[dict] = []

    def _evento_manuale(self, topic: str, m: dict) -> None:
        # Un pulsante sul plastico (es. "arriva un pullman") aggiunge veicoli a entrambe le simulazioni.
        if m.get("veicoli"):
            self._extra.append(m)

    def _applica_piano(self, sim: Simulazione) -> None:
        if self._piano:
            sim.pesi = dict(self._piano.get("pesi", {}))
            sim.verde_max = int(self._piano.get("verde_max", VERDE_MAX))

    def _aggiungi_extra(self, sims: list[Simulazione], t: float) -> None:
        porte = self.scenario["traffico"]["porte"]
        while self._extra:
            m = self._extra.pop()
            da = porte.get(m.get("da", "est_in"), porte["est_in"])[0]
            a = porte.get(m.get("a", "ovest_out"), porte["ovest_out"])[0]
            for sim in sims:
                for i in range(int(m["veicoli"])):
                    vid = f"extra_{int(t)}_{i}"
                    rid = f"r_{vid}"
                    percorso = sim.c.simulation.findRoute(da, a).edges
                    if percorso:
                        sim.c.route.add(rid, percorso)
                        sim.c.vehicle.add(vid, rid, depart=str(t + i * 2))

    def run(self) -> None:
        with tempfile.TemporaryDirectory() as cartella:
            percorsi = prepara_domanda(self.scenario, Path(cartella))
            net = sumolib.net.readNet(str(DATI / "lungomare.net.xml"))
            oggi = Simulazione("oggi", percorsi, self.inizio, adattiva=False, quota_assistiti=0,
                               gui=False, net=net, incroci=self.incroci)
            agenti = Simulazione("agenti", percorsi, self.inizio, adattiva=True,
                                 quota_assistiti=self.quota_assistiti, gui=self.gui, net=net, incroci=self.incroci)
            plastico = {p["tls"]: (p["id"], set(p["principale"]), p["nome"]) for p in self.incroci["plastico"]}
            ultimo_stato: dict[str, dict] = {}
            self.pronto.set()
            t0_reale = time.monotonic()
            try:
                t = float(self.inizio)
                while t < self.fine and not self.fermato.is_set():
                    self._applica_piano(agenti)
                    self._aggiungi_extra([oggi, agenti], t)
                    oggi.passo()
                    t = agenti.passo()
                    for tls, (pid, principali, nome) in plastico.items():
                        if tls not in agenti.semafori:
                            continue
                        stato = agenti.stato_testa(tls, principali)
                        if stato != ultimo_stato.get(pid):
                            ultimo_stato[pid] = stato
                            self.bus.pubblica(f"napoli/semafori/{pid}/stato", {**stato, "nome": nome}, trattieni=True)
                    if int(t) % 60 == 0:
                        self.bus.pubblica("napoli/orologio", {"ora": ora_da_secondi(t), "t": int(t)}, trattieni=True)
                        self.bus.pubblica("napoli/kpi", self._kpi(oggi, agenti, t), trattieni=True)
                    if self.velocita > 0:
                        atteso = (t - self.inizio) / self.velocita
                        ritardo = atteso - (time.monotonic() - t0_reale)
                        if ritardo > 0:
                            time.sleep(ritardo)
                self.risultato = self._kpi(oggi, agenti, t)
                self.bus.pubblica("napoli/kpi", self.risultato, trattieni=True)
            finally:
                oggi.chiudi()
                agenti.chiudi()

    def _kpi(self, oggi: Simulazione, agenti: Simulazione, t: float) -> dict:
        a, b = oggi.kpi(), agenti.kpi()

        def risparmio(x, y):
            if not x or y is None:
                return None
            return round(100 * (x - y) / x, 1)

        return {
            "ora": ora_da_secondi(t),
            "oggi": a,
            "agenti": b,
            "quota_assistiti": self.quota_assistiti,
            "risparmio_pct": {
                "ore_perse_in_coda": risparmio(a["ore_perse_in_coda"], b["ore_perse_in_coda"]),
                "durata_media": risparmio(a["durata_media_s"], b["durata_media_s"]),
                "co2": risparmio(a["co2_kg"], b["co2_kg"]),
            },
        }

    def ferma(self) -> None:
        self.fermato.set()


if __name__ == "__main__":
    # Prova rapida: tutta la giornata senza attese, stampa i KPI finali.
    import sys

    from ..bus import BusMemoria

    scenario = json.loads((DATI / "scenario_regata.json").read_text(encoding="utf-8"))
    quota = float(sys.argv[1]) if len(sys.argv) > 1 else 0.0
    g = Gemello(BusMemoria(), scenario, velocita=0, quota_assistiti=quota)
    inizio = time.time()
    g.run()
    print(json.dumps(g.risultato, ensure_ascii=False, indent=2))
    print(f"durata {time.time() - inizio:.0f}s", file=sys.stderr)
    os._exit(0)
