"""Agente Traffico: decide la strategia dei semafori, cioè quali corridoi hanno priorità.

Il controllo secondo per secondo è nel gemello SUMO (solo simulato): verde esteso dove c'è coda,
cambio fase quando l'altra direzione aspetta di più. L'agente decide i PESI dei corridoi
(lungomare, porto, uscita verso Fuorigrotta, collina, centro) e la durata massima del verde,
guardando eventi previsti, code misurate e richieste dell'orchestratore.
"""

from __future__ import annotations

import json

from .base import Agente

CORRIDOI = ["lungomare", "porto", "uscita_ovest", "collina", "centro"]

SCHEMA = {
    "type": "object",
    "properties": {
        "pesi": {"type": "object", "properties": {c: {"type": "number"} for c in CORRIDOI},
                 "required": CORRIDOI, "additionalProperties": False},
        "verde_max": {"type": "integer"},
        "motivazione": {"type": "string"},
    },
    "required": ["pesi", "verde_max", "motivazione"],
    "additionalProperties": False,
}

SISTEMA = """Sei l'agente Traffico della città di Napoli in un sistema multi-agente.
Decidi la strategia dei semafori dell'area lungomare (Mergellina → Piazza Municipio).
Corridoi: lungomare (via Caracciolo, Riviera di Chiaia, via Partenope), porto (via Acton, via Colombo,
Galleria della Vittoria, verso Stazione Marittima e Beverello), uscita_ovest (Viale Gramsci, Piedigrotta,
verso Fuorigrotta e lo stadio Maradona), collina (Corso Vittorio Emanuele), centro (Toledo e traverse).
Peso 1 = normale, fino a 3 = massima priorità. Più peso dai a un corridoio, più verde riceve quando c'è coda.
verde_max: secondi massimi di verde per fase (40-60: oltre i 60 le code peggiorano). La motivazione è letta dall'operatore della sala:
una o due frasi in italiano, concrete."""


class AgenteTraffico(Agente):
    nome = "traffico"
    etichetta = "Traffico"

    def __init__(self, *a, **k) -> None:
        super().__init__(*a, **k)
        self.eventi_attivi: dict[str, dict] = {}
        self.richieste: dict[str, dict] = {}  # dall'orchestratore: corridoio → {peso, motivo}
        self.kpi: dict | None = None
        self.piano: dict | None = None

    def avvio(self) -> None:
        self.ascolta("napoli/eventi/previsioni")
        self.ascolta("napoli/eventi/conclusi")
        self.ascolta("napoli/kpi")
        self.ascolta("napoli/agenti/traffico/comandi")
        self.ogni(15, self.decidi)

    def gestisci(self, topic: str, m: dict) -> None:
        if topic == "napoli/kpi":
            self.kpi = m
        elif topic == "napoli/eventi/previsioni":
            self.eventi_attivi[m["id"]] = m
            self.decidi()
        elif topic == "napoli/eventi/conclusi":
            self.eventi_attivi.pop(m.get("id"), None)
        elif topic == "napoli/agenti/traffico/comandi":
            if m.get("corridoio") in CORRIDOI:
                self.richieste[m["corridoio"]] = {"peso": float(m.get("peso", 2)), "t": self.t}
                self.decidi()

    def _regole(self) -> dict:
        pesi = {c: 1.0 for c in CORRIDOI}
        motivi = []
        for e in self.eventi_attivi.values():
            if e["fase"] == "in_arrivo" and e["tipo"] == "regata":
                pesi["lungomare"] = max(pesi["lungomare"], 1.8)
                motivi.append("arrivi per la regata: priorità al lungomare")
            elif e["fase"] == "in_corso" and e["tipo"] == "regata":
                pesi["lungomare"] = max(pesi["lungomare"], 1.5)
                motivi.append("regata in corso: lungomare un po' favorito")
            elif e["fase"] == "deflusso" and e["tipo"] == "regata":
                pesi.update(lungomare=max(pesi["lungomare"], 2.0), porto=max(pesi["porto"], 1.6),
                            uscita_ovest=max(pesi["uscita_ovest"], 1.6))
                motivi.append("fine regata: svuotiamo il lungomare verso porto e Fuorigrotta")
            elif e["tipo"] == "nave" and e["fase"] in ("in_arrivo", "in_corso"):
                pesi["porto"] = max(pesi["porto"], 2.0)
                motivi.append("sbarco crocieristi: priorità a taxi e bus dal porto")
            elif e["tipo"] == "partita" and e["fase"] == "in_arrivo":
                pesi["uscita_ovest"] = max(pesi["uscita_ovest"], 2.5)
                motivi.append("partita al Maradona: onda verde verso Fuorigrotta")
        if self.kpi:
            code = self.kpi.get("agenti", {}).get("code_corridoi", {})
            for c, n in code.items():
                if c in pesi and n > 15:
                    pesi[c] = min(3.0, pesi[c] + 0.5)
                    motivi.append(f"coda di {n} veicoli sul corridoio {c}")
        for c, r in list(self.richieste.items()):
            if self.t - r["t"] > 60 * 60:  # le richieste dell'orchestratore valgono un'ora
                del self.richieste[c]
                continue
            pesi[c] = max(pesi[c], r["peso"])
            motivi.append(f"richiesta dell'orchestratore sul corridoio {c}")
        return {"pesi": pesi, "verde_max": 60,
                "motivazione": "; ".join(dict.fromkeys(motivi)) or "traffico regolare, piano normale"}

    def decidi(self) -> None:
        situazione = {
            "ora": self.ora,
            "eventi": list(self.eventi_attivi.values()),
            "code_veicoli_per_corridoio": (self.kpi or {}).get("agenti", {}).get("code_corridoi", {}),
            "richieste_orchestratore": self.richieste,
            "piano_attuale": self.piano,
        }
        piano, fonte = self.ragiona(SISTEMA, "Situazione:\n" + json.dumps(situazione, ensure_ascii=False),
                                    SCHEMA, self._regole)
        piano["pesi"] = {c: max(0.5, min(3.0, float(piano["pesi"].get(c, 1)))) for c in CORRIDOI}
        piano["verde_max"] = max(40, min(60, int(piano.get("verde_max", 60))))
        if self.piano and piano["pesi"] == self.piano["pesi"] and piano["verde_max"] == self.piano["verde_max"]:
            return
        self.piano = piano
        self.bus.pubblica("napoli/semafori/piano", {**piano, "fonte": fonte, "ora": self.ora}, trattieni=True)
        forti = [f"{c} ×{p:g}" for c, p in piano["pesi"].items() if p > 1]
        self.di("Semafori", f"Nuovo piano ({', '.join(forti) or 'tutti normali'}, verde max {piano['verde_max']}s): "
                f"{piano['motivazione']}", fonte=fonte)
