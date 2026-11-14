"""Frasi in italiano corretto per zone e luoghi: i testi degli agenti finiscono su WhatsApp così come sono."""

from __future__ import annotations

# "a Mergellina", "al Castel dell'Ovo"...: preposizione giusta per ogni zona.
ZONA_DOVE = {
    "mergellina": "a Mergellina",
    "rotonda_diaz": "a Rotonda Diaz",
    "piazza_vittoria": "a Piazza Vittoria",
    "castel_ovo": "al Castel dell'Ovo",
    "municipio": "in Piazza Municipio",
    "beverello": "al Molo Beverello",
    "vomero": "al Vomero",
    "fuorigrotta": "a Fuorigrotta",
}

ZONA_NOME = {
    "mergellina": "Mergellina",
    "rotonda_diaz": "Rotonda Diaz",
    "piazza_vittoria": "Piazza Vittoria",
    "castel_ovo": "Castel dell'Ovo",
    "municipio": "Piazza Municipio",
    "beverello": "Molo Beverello",
    "vomero": "Vomero",
    "fuorigrotta": "Fuorigrotta",
}

# Come dirlo a una persona (la folla è una stima simulata della demo).
LIVELLO_FRASE = {
    "basso": "poca gente",
    "medio": "un po' di gente",
    "alto": "tanta gente",
    "critico": "il pienone",
}


def dove(zona: str) -> str:
    return ZONA_DOVE.get(zona, f"a {ZONA_NOME.get(zona, zona.replace('_', ' ').title())}")


def nome_zona(zona: str) -> str:
    return ZONA_NOME.get(zona, zona.replace("_", " ").title())


def frase_folla(zona: str, livello: str) -> str:
    """Es. "A Rotonda Diaz c'è tanta gente" (con la maiuscola iniziale)."""
    testo = f"{dove(zona)} c'è {LIVELLO_FRASE.get(livello, livello)}"
    return testo[:1].upper() + testo[1:]


def frase_prenotazione(esito: dict, persone: int) -> str:
    """Esito di una negoziazione raccontato da CiroGPT, non dall'impresa."""
    nome = esito.get("nome", "il locale")
    sconto = esito.get("sconto_pct") or 0
    con_sconto = f", con il {sconto}% di sconto" if sconto else ""
    if esito.get("esito") == "accettata":
        return f"Fatto: {nome} vi aspetta alle {esito['ora']}, tavolo per {persone}{con_sconto}."
    if esito.get("esito") == "controproposta":
        richiesta = esito.get("ora_richiesta")
        prima = f"alle {richiesta} non ha posto" if richiesta else "a quell'ora non ha posto"
        return f"{nome} {prima}, ma vi propone le {esito['ora']} per {persone}{con_sconto}. Prenoto?"
    return f"{nome} è piena per le prossime due ore. Cerco un altro posto?"
