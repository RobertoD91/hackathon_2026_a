"""Orchestratore: la regia comune.

Ascolta tutto (eventi, folla, meteo, KPI, drone) e quando succede qualcosa di rilevante
decide azioni coordinate tra gli agenti:
- traffico:  priorità a un corridoio;
- turismo:   ridistribuire la folla da una zona;
- drone:     verificare una zona quando i dati non bastano (pilota umano nel loop);
- avviso:    messaggio a cittadini e turisti.
Ogni decisione ha una motivazione leggibile. Con --approvazione l'operatore della sala
può approvarla o bloccarla; senza risposta entro 10 minuti simulati parte da sola.
"""

from __future__ import annotations

import itertools
import json

from .base import Agente

AZIONI = ["traffico", "turismo", "drone", "avviso"]
SCHEMA = {
    "type": "object",
    "properties": {
        "sintesi": {"type": "string"},
        "azioni": {"type": "array", "items": {
            "type": "object",
            "properties": {
                "agente": {"type": "string", "enum": AZIONI},
                "zona": {"type": "string"},
                "corridoio": {"type": "string"},
                "peso": {"type": "number"},
                "testo": {"type": "string"},
            },
            "required": ["agente", "zona", "corridoio", "peso", "testo"],
            "additionalProperties": False,
        }},
        "motivazione": {"type": "string"},
    },
    "required": ["sintesi", "azioni", "motivazione"],
    "additionalProperties": False,
}

SISTEMA = """Sei l'orchestratore di "Napoli Agentic City": coordini gli agenti della città in una giornata di festa
(regata dell'America's Cup, navi da crociera, partita al Maradona). Obiettivo: meno code, meno folla nei punti
critici, informazioni tempestive, nuovi affari per le imprese locali. Niente allarmismi.
Azioni possibili (campo agente):
- traffico: priorità ai semafori di un corridoio (corridoio: lungomare | porto | uscita_ovest | collina | centro; peso 1-3);
- turismo: spostare persone da una zona affollata verso alternative (zona = zona affollata);
- drone: chiedere al pilota una verifica visiva di una zona quando la stima è incerta e alta (zona);
- avviso: messaggio breve a cittadini e turisti (testo).
Zone: mergellina, rotonda_diaz, piazza_vittoria, castel_ovo, municipio, beverello, vomero.
Per i campi che un'azione non usa metti "" o 0. Massimo 4 azioni, solo quelle utili ora.
sintesi: una frase sulla situazione. motivazione: due frasi per l'operatore della sala operativa."""


def _frase(testo: str) -> str:
    return testo[:1].upper() + testo[1:] if testo else testo


class Orchestratore(Agente):
    nome = "orchestratore"
    etichetta = "Orchestratore"

    def __init__(self, *a, approvazione: bool = False, **k) -> None:
        super().__init__(*a, **k)
        self.approvazione = approvazione
        self.eventi: dict[str, dict] = {}
        self.folla: dict[str, dict] = {}
        self.meteo: dict | None = None
        self.kpi: dict | None = None
        self.motivi: list[str] = []
        self.ultima_decisione = -10**9
        self.drone_chiesto: dict[str, int] = {}
        self.drone_visto: dict[str, int] = {}
        self.gestite: dict[str, int] = {}  # zona → ultima volta che abbiamo spostato folla da lì
        self.in_attesa: dict[str, dict] = {}
        self.contatore = itertools.count(1)
        self.decisioni = 0

    def avvio(self) -> None:
        for filtro in ("napoli/eventi/previsioni", "napoli/folla/+", "napoli/meteo", "napoli/kpi",
                       "napoli/drone/osservazioni", "napoli/operatore/comandi"):
            self.ascolta(filtro)
        self.ogni(1, self._forse_decidi)

    def gestisci(self, topic: str, m: dict) -> None:
        if topic == "napoli/eventi/previsioni":
            self.eventi[m["id"]] = m
            self.motivi.append(f"evento {m['nome']} ({m['fase']})")
        elif topic.startswith("napoli/folla/"):
            prima = self.folla.get(m["zona"], {}).get("livello")
            self.folla[m["zona"]] = m
            if m["livello"] in ("alto", "critico") and prima not in ("alto", "critico"):
                self.motivi.append(f"{m['nome']} affollamento {m['livello']}")
        elif topic == "napoli/meteo":
            if self.meteo and self.meteo.get("regata_ok") != m.get("regata_ok"):
                self.motivi.append("cambiano le condizioni per la regata")
            self.meteo = m
        elif topic == "napoli/kpi":
            self.kpi = m
        elif topic == "napoli/drone/osservazioni":
            self.drone_visto[m.get("zona", "")] = self.t
            self.motivi.append(f"osservazione del drone su {m.get('zona')}")
        elif topic == "napoli/operatore/comandi":
            d = self.in_attesa.pop(m.get("decisione", ""), None)
            if d:
                if m.get("esito") == "approva":
                    self._esegui(d, "approvata dall'operatore")
                else:
                    self.bus.pubblica("napoli/orchestratore/decisioni", {**d, "stato": "bloccata"})
                    self.di("Sala operativa", f"Decisione {d['id']} bloccata dall'operatore")

    def _forse_decidi(self) -> None:
        for id_d, d in list(self.in_attesa.items()):
            if self.t - d["t"] >= 10 * 60:
                self.in_attesa.pop(id_d)
                self._esegui(d, "partita in automatico (nessuna risposta dall'operatore)")
        for zona, chiesto in self.drone_chiesto.items():
            # Scaduta l'attesa del drone senza osservazione: rivalutiamo la zona.
            if self.t - chiesto == 10 * 60 and self.drone_visto.get(zona, -10**9) < chiesto:
                self.motivi.append(f"nessuna risposta dal drone su {zona}")
        if self.motivi and self.t - self.ultima_decisione >= 5 * 60:
            motivi, self.motivi = list(dict.fromkeys(self.motivi)), []
            self.ultima_decisione = self.t
            self.decidi(motivi)

    def _regole(self, motivi: list[str]) -> dict:
        azioni, frasi = [], []
        for e in self.eventi.values():
            if not any(e["nome"] in mo for mo in motivi):
                continue
            if e["tipo"] == "regata" and e["fase"] == "in_arrivo":
                azioni.append({"agente": "traffico", "zona": "", "corridoio": "lungomare", "peso": 1.8, "testo": ""})
                azioni.append({"agente": "avviso", "zona": "rotonda_diaz", "corridoio": "", "peso": 0,
                               "testo": "Oggi regata dell'America's Cup dalle 14:00: per arrivare al lungomare meglio "
                                        "Linea 2 fino a Mergellina o funicolare di Chiaia, i parcheggi della Riviera sono quasi pieni."})
                frasi.append("in arrivo la regata: preparo il lungomare e consiglio i mezzi pubblici")
            elif e["tipo"] == "regata" and e["fase"] == "deflusso":
                azioni.append({"agente": "traffico", "zona": "", "corridoio": "porto", "peso": 2.0, "testo": ""})
                azioni.append({"agente": "avviso", "zona": "rotonda_diaz", "corridoio": "", "peso": 0,
                               "testo": "La regata sta per finire: chi va verso il Maradona prenda la Linea 2 da Mergellina, "
                                        "chi torna alle navi può passeggiare sul lungomare fino al Beverello (25 minuti)."})
                frasi.append("fine regata: svuoto il lungomare in modo ordinato")
            elif e["tipo"] == "nave" and e["fase"] == "in_arrivo":
                azioni.append({"agente": "traffico", "zona": "", "corridoio": "porto", "peso": 2.0, "testo": ""})
                frasi.append("sbarco crocieristi: priorità al porto")
            elif e["tipo"] == "partita" and e["fase"] == "in_arrivo":
                azioni.append({"agente": "traffico", "zona": "", "corridoio": "uscita_ovest", "peso": 2.5, "testo": ""})
                azioni.append({"agente": "avviso", "zona": "mergellina", "corridoio": "", "peso": 0,
                               "testo": "Stasera Napoli al Maradona: da Chiaia e dal centro conviene la Linea 2 fino a Campi Flegrei."})
                frasi.append("partita in arrivo: onda verde verso Fuorigrotta e invito ai mezzi")
        for zona, f in self.folla.items():
            if f["livello"] not in ("alto", "critico") or self.t - self.gestite.get(zona, -10**9) < 25 * 60:
                continue
            visto_di_recente = self.t - self.drone_visto.get(zona, -10**9) <= 30 * 60
            chiesto = self.drone_chiesto.get(zona, -10**9)
            if not visto_di_recente and self.t - chiesto > 45 * 60:
                # Prima verifichiamo con il drone, poi (alla prossima decisione) spostiamo la folla.
                azioni.append({"agente": "drone", "zona": zona, "corridoio": "", "peso": 0,
                               "testo": f"verifica affluenza a {f['nome']}"})
                frasi.append(f"{f['nome']} risulta {f['livello']} secondo celle e sensori: chiedo conferma al drone prima di agire")
                continue
            if not visto_di_recente and self.t - chiesto < 10 * 60:
                continue  # aspettiamo il drone ancora qualche minuto
            fonte = "confermato dal drone" if visto_di_recente else "il drone non ha risposto, mi fido della stima"
            azioni.append({"agente": "turismo", "zona": zona, "corridoio": "", "peso": 0, "testo": ""})
            frasi.append(f"{f['nome']} {f['livello']} ({fonte}): sposto parte della folla con suggerimenti e offerte")
        return {"sintesi": "; ".join(motivi) or "situazione regolare",
                "azioni": azioni[:4], "motivazione": _frase(". ".join(dict.fromkeys(frasi))) or "Nessuna azione necessaria."}

    def decidi(self, motivi: list[str]) -> None:
        situazione = {
            "ora": self.ora,
            "cosa_e_cambiato": motivi,
            "eventi": list(self.eventi.values()),
            "folla": {z: {k: f[k] for k in ("persone", "capienza", "livello", "fonti")} for z, f in self.folla.items()},
            "meteo": self.meteo,
            "kpi_traffico": (self.kpi or {}).get("risparmio_pct"),
            "code_per_corridoio": (self.kpi or {}).get("agenti", {}).get("code_corridoi"),
            "drone_ultime_osservazioni_min_fa": {z: (self.t - t) // 60 for z, t in self.drone_visto.items()},
        }
        decisione, fonte = self.ragiona(SISTEMA, json.dumps(situazione, ensure_ascii=False), SCHEMA,
                                        lambda: self._regole(motivi))
        if not decisione.get("azioni"):
            return
        self.decisioni += 1
        d = {"id": f"D{next(self.contatore)}", "ora": self.ora, "t": self.t, "fonte": fonte, **decisione}
        if self.approvazione:
            self.in_attesa[d["id"]] = d
            self.bus.pubblica("napoli/orchestratore/decisioni", {**d, "stato": "in_attesa"})
            self.di("Sala operativa", f"[{d['id']}] proposta: {d['motivazione']} — approvi?", fonte=fonte)
        else:
            self._esegui(d, "automatica")

    def _esegui(self, d: dict, come: str) -> None:
        self.bus.pubblica("napoli/orchestratore/decisioni", {**d, "stato": come})
        self.di("Tutti", f"[{d['id']}] {d['motivazione']}", fonte=d["fonte"])
        for a in d["azioni"]:
            agente = a.get("agente")
            if agente == "traffico" and a.get("corridoio"):
                self.bus.pubblica("napoli/agenti/traffico/comandi",
                                  {"corridoio": a["corridoio"], "peso": a.get("peso") or 2, "motivo": d["sintesi"]})
                self.di("Traffico", f"Priorità al corridoio {a['corridoio']} (peso {a.get('peso') or 2:g})")
            elif agente == "turismo" and a.get("zona"):
                self.gestite[a["zona"]] = self.t
                self.bus.pubblica("napoli/agenti/turismo/comandi", {"azione": "ridistribuisci", "zona": a["zona"],
                                                                    "motivo": d["sintesi"]})
            elif agente == "drone" and a.get("zona"):
                self.drone_chiesto[a["zona"]] = self.t
                self.bus.pubblica("napoli/drone/richieste", {"zona": a["zona"], "motivo": a.get("testo", ""),
                                                             "ora": self.ora, "decisione": d["id"]})
                self.di("Pilota drone", f"Puoi fare un volo di verifica? {a.get('testo', '')}")
            elif agente == "avviso" and a.get("testo"):
                self.bus.pubblica("napoli/avvisi", {"ora": self.ora, "per": "tutti", "zona": a.get("zona", ""),
                                                    "testo": a["testo"], "fonte": d["fonte"]})
