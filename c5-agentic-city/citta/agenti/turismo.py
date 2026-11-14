"""Agente Turismo: sposta la folla con suggerimenti utili invece che con divieti.

Quando una zona diventa troppo piena (o l'orchestratore lo chiede) sceglie una zona
alternativa meno piena con qualcosa di interessante e un'offerta di un'impresa,
e la propone come avviso ai turisti (via assistenti personali, cioè CiroGPT su WhatsApp).
Stima quante persone accettano (ipotesi: 6-12% di chi è in zona e riceve l'avviso)
e lo comunica all'agente Folla, che aggiorna le stime: il cerchio si chiude.
"""

from __future__ import annotations

import json

from .. import DATI
from ..testi import dove
from .base import Agente, numero

ADESIONE = {"medio": 0.06, "alto": 0.09, "critico": 0.12}

SCHEMA = {
    "type": "object",
    "properties": {"testo": {"type": "string"}},
    "required": ["testo"],
    "additionalProperties": False,
}

SISTEMA = """Sei l'agente Turismo di Napoli. Scrivi un avviso breve (massimo 2 frasi, tono caldo e
napoletano ma chiaro) per i turisti in una zona affollata, proponendo un'alternativa concreta
con come arrivarci e l'offerta dell'impresa se c'è. Niente allarmismi: è una giornata di festa."""


class AgenteTurismo(Agente):
    nome = "turismo"
    etichetta = "Turismo"

    def __init__(self, *a, **k) -> None:
        super().__init__(*a, **k)
        dati = json.loads((DATI / "luoghi.json").read_text(encoding="utf-8"))
        self.luoghi = dati["luoghi"]
        self.collegamenti = dati["collegamenti"]
        self.folla: dict[str, dict] = {}
        self.offerte: list[dict] = []
        self.ultimo_avviso: dict[str, int] = {}
        self.in_arrivo: dict[str, int] = {}  # persone già indirizzate, non ancora contate dall'agente Folla

    def avvio(self) -> None:
        self.ascolta("napoli/folla/+")
        self.ascolta("napoli/imprese/offerte")
        self.ascolta("napoli/agenti/turismo/comandi")

    def gestisci(self, topic: str, m: dict) -> None:
        if topic.startswith("napoli/folla/"):
            self.folla[m["zona"]] = m
            self.in_arrivo.pop(m["zona"], None)  # la nuova stima le include già
        elif topic == "napoli/imprese/offerte":
            self.offerte = m.get("offerte", [])
        elif topic == "napoli/agenti/turismo/comandi" and m.get("azione") == "ridistribuisci":
            self.ridistribuisci(m.get("zona"), m.get("motivo", ""))

    def alternativa(self, da_zona: str) -> tuple[str, dict | None] | None:
        candidate = []
        for zona, f in self.folla.items():
            if zona == da_zona or f["livello"] in ("alto", "critico") or \
                    (f["persone"] + self.in_arrivo.get(zona, 0)) > 0.7 * f["capienza"]:
                continue
            if not any(l["zona"] == zona for l in self.luoghi):
                continue
            offerta = next((o for o in self.offerte if o["zona"] == zona and o["ora"] >= self.ora), None)
            riempimento = f["persone"] / f["capienza"]
            candidate.append((riempimento - (0.15 if offerta else 0), zona, offerta))
        if not candidate:
            return None
        _, zona, offerta = min(candidate)
        return zona, offerta

    def ridistribuisci(self, da_zona: str | None, motivo: str = "") -> None:
        if da_zona not in self.folla:
            return
        if self.t - self.ultimo_avviso.get(da_zona, -10**9) < 25 * 60:
            return
        scelta = self.alternativa(da_zona)
        if not scelta:
            return
        verso, offerta = scelta
        self.ultimo_avviso[da_zona] = self.t
        f_da, f_verso = self.folla[da_zona], self.folla[verso]
        come = self.collegamenti.get(f"{da_zona}->{verso}", "")
        luogo = next(l for l in self.luoghi if l["zona"] == verso)

        def regole() -> dict:
            testo = f"C'è il pienone {dove(da_zona)}: adesso si sta molto più tranquilli {luogo.get('dove', 'a ' + luogo['nome'])}"
            if come:
                testo += f" ({come})"
            if offerta:
                testo += f". {offerta['nome']} vi aspetta alle {offerta['ora']} con il {offerta['sconto_pct']}% di sconto"
            return {"testo": testo + "."}

        dati = {"zona_piena": f_da, "alternativa": f_verso, "luogo": luogo, "come_arrivare": come,
                "offerta": offerta, "motivo": motivo}
        avviso, fonte = self.ragiona(SISTEMA, json.dumps(dati, ensure_ascii=False), SCHEMA, regole)
        persone = int(f_da["persone"] * ADESIONE.get(f_da["livello"], 0.05))
        # Non riempiamo la zona di arrivo: al massimo fino al 70% della sua capienza.
        spazio = int(0.7 * f_verso["capienza"] - f_verso["persone"] - self.in_arrivo.get(verso, 0))
        persone = max(0, min(persone, spazio))
        if persone < 100:
            return
        self.in_arrivo[verso] = self.in_arrivo.get(verso, 0) + persone
        self.bus.pubblica("napoli/avvisi", {"ora": self.ora, "per": "turisti", "zona": da_zona, "verso": verso,
                                            "testo": avviso["testo"], "offerta": offerta, "fonte": fonte})
        self.bus.pubblica("napoli/turismo/spostamenti", {"da": da_zona, "verso": verso, "persone": persone, "ora": self.ora})
        self.di("Assistenti", f"Avviso per chi è {dove(da_zona)}: {avviso['testo']} "
                f"(stimo ~{numero(persone)} persone spostate {dove(verso)})", fonte=fonte)
