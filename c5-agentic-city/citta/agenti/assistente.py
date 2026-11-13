"""Assistenti personali di cittadini e turisti.

Ogni utente (numero WhatsApp via OpenClaw, oppure nome in chat da terminale) ha il suo assistente.
L'assistente:
1. capisce cosa vuole l'utente (LLM con risposta strutturata, o parole chiave senza LLM);
2. chiede alla città lo stato attuale (folla, eventi, meteo, avvisi, offerte) dal bus;
3. se serve NEGOZIA con un'impresa (prenotazione → accettata / controproposta / rifiutata);
4. risponde nella lingua dell'utente, breve, stile WhatsApp.
Raccoglie anche gli avvisi proattivi della città per le zone che interessano all'utente.
"""

from __future__ import annotations

import itertools
import json
import threading
import time

from .. import DATI
from ..bus import Bus

ZONE = ["mergellina", "rotonda_diaz", "piazza_vittoria", "castel_ovo", "municipio", "beverello", "vomero"]
INTENTI = ["percorso", "mangiare", "prenota", "cosa_fare", "evento", "conferma", "altro"]

SCHEMA_INTENTO = {
    "type": "object",
    "properties": {
        "intento": {"type": "string", "enum": INTENTI},
        "da_zona": {"type": "string", "enum": ZONE + [""]},
        "verso_zona": {"type": "string", "enum": ZONE + ["fuorigrotta", ""]},
        "ora": {"type": "string", "description": "HH:MM oppure vuoto"},
        "persone": {"type": "integer"},
        "impresa": {"type": "string", "description": "id impresa oppure vuoto"},
        "lingua": {"type": "string", "description": "codice lingua dell'utente, es. it, en, es, de, fr"},
    },
    "required": ["intento", "da_zona", "verso_zona", "ora", "persone", "impresa", "lingua"],
    "additionalProperties": False,
}

SISTEMA_INTENTO = """Estrai l'intenzione di un messaggio inviato all'assistente personale di Napoli Agentic City.
Zone: mergellina (lungomare ovest, Via Caracciolo, gozzi), rotonda_diaz (village dell'America's Cup, Riviera di Chiaia),
piazza_vittoria (Chiaia, Plebiscito, Palazzo Reale, PAN), castel_ovo (Castel dell'Ovo, Borgo Marinari, via Partenope),
municipio (Piazza Municipio, Maschio Angioino, metro Linea 1), beverello (Molo Beverello, Stazione Marittima, navi da crociera),
vomero (Castel Sant'Elmo, San Martino, funicolari). fuorigrotta = stadio Maradona.
Imprese: {imprese}.
"conferma" = l'utente accetta una proposta precedente (sì, ok, va bene, perfetto, yes...).
Se l'utente è crocerista e non dice dove si trova, da_zona = beverello. persone = 0 se non detto."""

SISTEMA_RISPOSTA = """Sei l'assistente personale di Napoli Agentic City per {utente}.
Rispondi nella lingua dell'utente ({lingua}), stile WhatsApp: massimo 70 parole, al massimo 1 emoji.
Usa SOLO i dati forniti (orari, offerte, livelli di folla, collegamenti): non inventare.
Se c'è una negoziazione con un'impresa, riferisci l'esito e, se è una controproposta, chiedi conferma.
Tono caldo, concreto, napoletano quanto basta."""


def _parole_chiave(testo: str, imprese: dict) -> dict:
    t = testo.lower()
    intento = "altro"
    if any(p in t for p in ("sì", "si ", "ok", "va bene", "perfetto", "yes", "confermo")) and len(t) < 25:
        intento = "conferma"
    elif any(p in t for p in ("prenot", "tavolo", "book", "reserve", "posto per")):
        intento = "prenota"
    elif any(p in t for p in ("mangi", "pizza", "fame", "pranzo", "cena", "eat", "food", "lunch", "frit")):
        intento = "mangiare"
    elif any(p in t for p in ("come arrivo", "come vado", "come si arriva", "how do i get", "how to get", "andare a", "arrivare", "stadio", "maradona")):
        intento = "percorso"
    elif any(p in t for p in ("regata", "partita", "evento", "race", "match")):
        intento = "evento"
    elif any(p in t for p in ("cosa", "fare", "vedere", "visit", "what", "consigli")):
        intento = "cosa_fare"
    sinonimi = {"mergellina": "mergellina", "caracciolo": "mergellina", "rotonda": "rotonda_diaz", "village": "rotonda_diaz",
                "plebiscito": "piazza_vittoria", "vittoria": "piazza_vittoria", "chiaia": "piazza_vittoria",
                "castel dell": "castel_ovo", "borgo marinari": "castel_ovo", "partenope": "castel_ovo",
                "municipio": "municipio", "maschio": "municipio", "beverello": "beverello", "nave": "beverello",
                "crocier": "beverello", "cruise": "beverello", "vomero": "vomero", "sant'elmo": "vomero",
                "maradona": "fuorigrotta", "stadio": "fuorigrotta"}
    trovate = [z for k, z in sinonimi.items() if k in t]
    impresa = next((i for i, imp in imprese.items() if any(w in t for w in imp["nome"].lower().split() if len(w) > 4)), "")
    if not impresa and intento == "prenota":
        impresa = next((i for i, imp in imprese.items() if imp["tipo"] in t), "")
    persone = next((int(w) for w in t.replace(",", " ").split() if w.isdigit() and 0 < int(w) < 30), 0)
    ora = next((w for w in t.split() if len(w) in (4, 5) and ":" in w), "")
    inglese = any(w in t.split() for w in ("the", "how", "where", "what", "we", "i", "want"))
    return {"intento": intento, "da_zona": "beverello" if ("nave" in t or "crocier" in t or "cruise" in t) else "",
            "verso_zona": next((z for z in trovate if z != "beverello"), trovate[0] if trovate else ""),
            "ora": ora, "persone": persone, "impresa": impresa, "lingua": "en" if inglese else "it"}


class Assistenti:
    def __init__(self, bus: Bus, llm, scenario: dict) -> None:
        self.bus, self.llm, self.scenario = bus, llm, scenario
        self.imprese = {i["id"]: i for i in json.loads((DATI / "imprese.json").read_text(encoding="utf-8"))["imprese"]}
        luoghi = json.loads((DATI / "luoghi.json").read_text(encoding="utf-8"))
        self.luoghi, self.collegamenti = luoghi["luoghi"], luoghi["collegamenti"]
        self.sessioni: dict[str, dict] = {}
        self.avvisi: list[dict] = []
        self.risposte: dict[str, dict] = {}
        self.attese: dict[str, threading.Event] = {}
        self.contatore = itertools.count(1)
        self.lock = threading.Lock()
        bus.iscriviti("napoli/avvisi", self._avviso)
        bus.iscriviti("napoli/imprese/+/risposte", self._risposta_impresa)

    # --- bus -----------------------------------------------------------------
    def _avviso(self, topic: str, m: dict) -> None:
        with self.lock:
            self.avvisi.append(m)
            for s in self.sessioni.values():
                if m.get("per") == "tutti" or not m.get("zona") or m.get("zona") in s["zone"]:
                    s["notifiche"].append(m)

    def _risposta_impresa(self, topic: str, m: dict) -> None:
        rid = m.get("id_richiesta")
        if rid in self.attese:
            self.risposte[rid] = m
            self.attese[rid].set()

    def _dialogo(self, da: str, a: str, testo: str) -> None:
        ora = (self.bus.ultimo("napoli/orologio") or {}).get("ora", "")
        self.bus.pubblica("napoli/agenti/dialogo", {"ora": ora, "da": da, "a": a, "testo": testo})

    def stato_citta(self) -> dict:
        folla = {m["zona"]: {"nome": m["nome"], "livello": m["livello"], "persone": m["persone"]}
                 for m in self.bus.trattenuti("napoli/folla/+").values()}
        return {
            "ora": (self.bus.ultimo("napoli/orologio") or {}).get("ora"),
            "meteo": self.bus.ultimo("napoli/meteo"),
            "folla": folla,
            "eventi": [{k: e[k] for k in ("nome", "inizio", "fine", "zona")} for e in self.scenario["eventi"]],
            "offerte": (self.bus.ultimo("napoli/imprese/offerte") or {}).get("offerte", []),
            "avvisi_recenti": [a["testo"] for a in self.avvisi[-3:]],
            "kpi": (self.bus.ultimo("napoli/kpi") or {}).get("risparmio_pct"),
        }

    # --- negoziazione con le imprese -------------------------------------------
    def negozia(self, utente: str, impresa: str, ora: str, persone: int) -> dict | None:
        rid = f"R{next(self.contatore)}"
        evento = threading.Event()
        self.attese[rid] = evento
        nome_assistente = f"Assistente di {utente}"
        imp = self.imprese[impresa]
        self._dialogo(nome_assistente, imp["nome"], f"Avete posto per {persone} alle {ora or 'prossima fascia'}?")
        self.bus.pubblica(f"napoli/imprese/{impresa}/richieste",
                          {"id_richiesta": rid, "da": nome_assistente, "ora": ora, "persone": persone})
        evento.wait(timeout=5)
        self.attese.pop(rid, None)
        return self.risposte.pop(rid, None)

    # --- conversazione -----------------------------------------------------------
    def chiedi(self, utente: str, testo: str) -> str:
        with self.lock:
            s = self.sessioni.setdefault(utente, {"storia": [], "zone": set(), "notifiche": [], "proposta": None,
                                                  "lingua": "it"})
        nomi_imprese = ", ".join(f"{i} ({v['nome']}, {v['tipo']}, zona {v['zona']})" for i, v in self.imprese.items())
        intento = self.llm.json(SISTEMA_INTENTO.format(imprese=nomi_imprese),
                                f"Messaggi precedenti: {s['storia'][-4:]}\nNuovo messaggio: {testo}", SCHEMA_INTENTO)
        if not isinstance(intento, dict):
            intento = _parole_chiave(testo, self.imprese)
        s["lingua"] = intento.get("lingua") or s["lingua"]
        for z in (intento.get("da_zona"), intento.get("verso_zona")):
            if z in ZONE:
                s["zone"].add(z)

        stato = self.stato_citta()
        dati: dict = {"messaggio": testo, "intento": intento, "citta": stato}
        persone = intento.get("persone") or 2
        da, verso = intento.get("da_zona") or "", intento.get("verso_zona") or ""
        if da and verso:
            dati["come_arrivare"] = self.collegamenti.get(f"{da}->{verso}")
        elif verso:
            dati["come_arrivare"] = {k: v for k, v in self.collegamenti.items() if k.endswith(f"->{verso}")}

        if intento["intento"] == "conferma" and s["proposta"]:
            p = s["proposta"]
            s["proposta"] = None
            self.bus.pubblica(f"napoli/imprese/{p['impresa']}/richieste",
                              {"id_richiesta": f"C{next(self.contatore)}", "da": f"Assistente di {utente}",
                               "ora": p["ora"], "persone": p["persone"]})
            dati["conferma"] = p
        elif intento["intento"] in ("prenota", "mangiare"):
            impresa = intento.get("impresa") if intento.get("impresa") in self.imprese else None
            if not impresa:
                zona = verso or da
                candidate = [o for o in stato["offerte"] if o["tipo"] in ("pizzeria", "street food", "bar")]
                vicine = [o for o in candidate if o["zona"] == zona]
                scelta = (vicine or candidate or [None])[0]
                impresa = scelta["impresa"] if scelta else ("pizzeria_borgo" if intento["intento"] == "prenota" else None)
            if impresa and intento["intento"] == "prenota" or (impresa and intento.get("ora")):
                esito = self.negozia(utente, impresa, intento.get("ora", ""), persone)
                dati["negoziazione"] = esito
                if esito and esito.get("esito") == "controproposta":
                    s["proposta"] = {"impresa": impresa, "ora": esito["ora"], "persone": persone}
            elif impresa:
                dati["suggerimento_impresa"] = self.imprese[impresa]

        with self.lock:
            notifiche, s["notifiche"] = s["notifiche"], []
        if notifiche:
            dati["avvisi_per_te"] = [n["testo"] for n in notifiche[-2:]]

        risposta = self.llm.testo(SISTEMA_RISPOSTA.format(utente=utente, lingua=s["lingua"]),
                                  json.dumps(dati, ensure_ascii=False, default=list))
        if not risposta:
            risposta = self._risposta_regole(intento, dati)
        s["storia"] += [f"utente: {testo}", f"assistente: {risposta}"]
        self._dialogo(f"Assistente di {utente}", utente, risposta)
        return risposta

    def notifiche(self, utente: str) -> list[dict]:
        with self.lock:
            s = self.sessioni.get(utente)
            if not s:
                return []
            n, s["notifiche"] = s["notifiche"], []
            return n

    def _risposta_regole(self, intento: dict, dati: dict) -> str:
        c = dati["citta"]
        parti = []
        if dati.get("negoziazione"):
            parti.append(dati["negoziazione"]["testo"] + (". Confermo?" if dati["negoziazione"]["esito"] == "controproposta" else "."))
        elif dati.get("conferma"):
            p = dati["conferma"]
            parti.append(f"Fatto! Prenotato da {self.imprese[p['impresa']]['nome']} alle {p['ora']} per {p['persone']}.")
        elif dati.get("suggerimento_impresa"):
            i = dati["suggerimento_impresa"]
            parti.append(f"Ti consiglio {i['nome']}: {i['descrizione']}. Vuoi che prenoti?")
        if isinstance(dati.get("come_arrivare"), str):
            parti.append(f"Per arrivare: {dati['come_arrivare']}.")
        elif isinstance(dati.get("come_arrivare"), dict) and dati["come_arrivare"]:
            parti.append("Per arrivare: " + next(iter(dati["come_arrivare"].values())) + ".")
        verso = intento.get("verso_zona")
        if verso in c["folla"]:
            f = c["folla"][verso]
            parti.append(f"Adesso a {f['nome']} l'affollamento è {f['livello']}.")
        if intento["intento"] in ("cosa_fare", "altro") and not parti:
            tranquille = sorted((z for z, f in c["folla"].items() if f["livello"] in ("basso", "medio")),
                                key=lambda z: c["folla"][z]["persone"])
            luoghi = [l for l in self.luoghi if l["zona"] in tranquille[:2]]
            if luoghi:
                parti.append("Ora è tranquillo: " + ", ".join(l["nome"] for l in luoghi[:2]) + ".")
            if c["offerte"]:
                o = c["offerte"][0]
                parti.append(f"Offerta: {o['nome']} alle {o['ora']}, -{o['sconto_pct']}%.")
        if intento["intento"] == "evento":
            parti.append("Oggi: " + "; ".join(f"{e['nome']} {e['inizio']}-{e['fine']}" for e in c["eventi"]) + ".")
        for a in dati.get("avvisi_per_te", []):
            parti.append(f"📣 {a}")
        return " ".join(parti) or "Ciao! Sono il tuo assistente per la giornata di festa a Napoli: chiedimi come arrivare, dove mangiare o cosa vedere."


if __name__ == "__main__":
    print(_parole_chiave("Siamo 4 croceristi, vogliamo mangiare una pizza vicino al Castel dell'Ovo alle 13:00", {}))
    time.sleep(0)
