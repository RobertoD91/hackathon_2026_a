"""Agente Folla: stima quante persone ci sono in ogni zona e quanto è piena.

Fonti, in ordine di fiducia crescente:
1. modello: presenza di base del sabato + flussi degli eventi (navi, regata);
2. presenze da rete mobile, anonime e aggregate (SIMULATE: modello + rumore, ipotesi dichiarata);
3. sensori ESP32 sul plastico (napoli/sensori/<nodo>/persone);
4. osservazione del drone (napoli/drone/osservazioni), che vale per 30 minuti.

Tiene conto anche delle persone che l'agente Turismo riesce a spostare (napoli/turismo/spostamenti).
"""

from __future__ import annotations

import random

from ..bus import secondi_da_ora
from .base import Agente, numero

BASE_SABATO = {"mergellina": 2000, "rotonda_diaz": 3000, "piazza_vittoria": 1500, "castel_ovo": 1500,
               "municipio": 3000, "beverello": 2500, "vomero": 4000}
LIVELLI = [(0.5, "basso"), (0.8, "medio"), (1.0, "alto"), (9e9, "critico")]


ORDINE = [n for _, n in LIVELLI]
ISTERESI = 0.07
DURATA_SPOSTAMENTO = 90 * 60  # le persone spostate tornano gradualmente in 90 minuti


def livello(persone: float, capienza: float, precedente: str | None = None) -> str:
    """Livello di affollamento, con isteresi: per scendere bisogna stare un po' sotto la soglia."""
    r = persone / capienza
    nuovo = next(nome for soglia, nome in LIVELLI if r < soglia)
    if precedente in ORDINE and ORDINE.index(nuovo) < ORDINE.index(precedente):
        soglia_prec = LIVELLI[ORDINE.index(precedente) - 1][0]
        if r >= soglia_prec - ISTERESI:
            return precedente
    return nuovo


def profilo(t: int, e: dict) -> float:
    """Quota delle persone di un evento presenti in zona all'istante t (trapezio)."""
    inizio, fine = secondi_da_ora(e["inizio"]), secondi_da_ora(e["fine"])
    permanenza = 3 * 3600 if e["tipo"] == "nave" else 0  # i croceristi restano in giro qualche ora
    salita_da, salita_a = inizio - 30 * 60, inizio + 45 * 60
    discesa_da, discesa_a = fine + permanenza, fine + permanenza + 60 * 60
    if t <= salita_da or t >= discesa_a:
        return 0.0
    if t < salita_a:
        return (t - salita_da) / (salita_a - salita_da)
    if t <= discesa_da:
        return 1.0
    return 1 - (t - discesa_da) / (discesa_a - discesa_da)


class AgenteFolla(Agente):
    nome = "folla"
    etichetta = "Folla"

    def __init__(self, *a, **k) -> None:
        super().__init__(*a, **k)
        self.rnd = random.Random(7)
        self.sensori: dict[str, dict] = {}
        self.drone: dict[str, tuple[int, int]] = {}  # zona → (persone, t)
        self.spostati: list[tuple[int, str, float]] = []  # (t, zona, persone ±)
        self.livelli: dict[str, str] = {}
        self.regata_ok = True

    def avvio(self) -> None:
        self.ascolta("napoli/sensori/+/persone")
        self.ascolta("napoli/drone/osservazioni")
        self.ascolta("napoli/turismo/spostamenti")
        self.ascolta("napoli/meteo")
        self.ogni(5, self.stima)

    def gestisci(self, topic: str, m: dict) -> None:
        if topic.startswith("napoli/sensori/"):
            if m.get("zona") in self.scenario["zone"]:
                self.sensori[topic] = m
        elif topic == "napoli/drone/osservazioni":
            z = m.get("zona")
            if z in self.scenario["zone"] and m.get("persone_stimate") is not None:
                self.drone[z] = (int(m["persone_stimate"]), self.t)
                self.di("Orchestratore", f"Ricevuto dal drone: a {self.scenario['zone'][z]['nome']} "
                        f"circa {numero(m['persone_stimate'])} persone. Aggiorno la stima.")
                self.stima()
        elif topic == "napoli/turismo/spostamenti":
            for z, segno in (("da", -1), ("verso", 1)):
                zona = m.get(z)
                if zona in self.scenario["zone"]:
                    self.spostati.append((self.t, zona, segno * float(m.get("persone", 0))))
        elif topic == "napoli/meteo":
            self.regata_ok = bool(m.get("regata_ok", True))

    def _modello(self, zona: str) -> float:
        persone = BASE_SABATO.get(zona, 1000)
        for e in self.scenario["eventi"]:
            if e["tipo"] == "regata" and not self.regata_ok:
                continue
            for f in e["flussi"]:
                if f["verso"] == zona:
                    persone += e["persone"] * f["quota"] * profilo(self.t, e)
        for quando, z, delta in self.spostati:
            trascorso = self.t - quando
            if z == zona and 0 <= trascorso < DURATA_SPOSTAMENTO:
                persone += delta * (1 - trascorso / DURATA_SPOSTAMENTO)
        return persone

    def stima(self) -> None:
        for zona, info in self.scenario["zone"].items():
            modello = self._modello(zona)
            celle = modello * self.rnd.uniform(0.9, 1.1)
            fonti = ["modello", "celle (simulato)"]
            stima = 0.4 * modello + 0.6 * celle
            for s in self.sensori.values():
                if s.get("zona") == zona:
                    stima += float(s.get("valore", 0)) * float(s.get("moltiplicatore", 200))
                    fonti.append("sensori ESP32")
            if zona in self.drone:
                persone, quando = self.drone[zona]
                if self.t - quando <= 30 * 60:
                    stima = 0.2 * stima + 0.8 * persone
                    fonti.append("drone")
            stima = max(0, stima)
            liv = livello(stima, info["capienza"], self.livelli.get(zona))
            self.bus.pubblica(f"napoli/folla/{zona}", {"zona": zona, "nome": info["nome"], "persone": round(stima),
                                                       "capienza": info["capienza"], "livello": liv,
                                                       "fonti": fonti, "ora": self.ora}, trattieni=True)
            precedente = self.livelli.get(zona)
            self.livelli[zona] = liv
            if precedente and liv != precedente and (liv in ("alto", "critico") or precedente in ("alto", "critico")):
                self.di("Orchestratore", f"{info['nome']}: affollamento {precedente} → {liv} "
                        f"({numero(stima)} persone su {numero(info['capienza'])})")
