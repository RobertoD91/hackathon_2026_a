"""Provider LLM intercambiabili.

Ogni provider espone due metodi:
- json(sistema, richiesta, schema) -> dict | None   (risposta strutturata)
- testo(sistema, richiesta) -> str | None

Se un provider restituisce None (nessun LLM, errore, timeout) l'agente usa le sue regole:
la demo deve funzionare anche senza rete.
"""

from __future__ import annotations

import os
import shutil
import sys


class Regole:
    """Nessun LLM: gli agenti decidono con le regole scritte nel codice."""

    nome = "regole"

    def json(self, sistema: str, richiesta: str, schema: dict) -> dict | None:
        return None

    def testo(self, sistema: str, richiesta: str) -> str | None:
        return None


def crea_llm(nome: str | None = None):
    """nome: "claude", "codex", "compatibile" (alias "miia"), "regole" oppure "auto" (default).

    auto: l'API compatibile con OpenAI se c'è C5_LLM_URL, poi Claude se c'è ANTHROPIC_API_KEY,
    poi Codex se c'è la CLI, altrimenti le regole."""
    nome = (nome or os.environ.get("C5_LLM") or "auto").strip().lower()
    if nome == "auto":
        if os.environ.get("C5_LLM_URL", "").strip():
            nome = "compatibile"
        elif os.environ.get("ANTHROPIC_API_KEY"):
            nome = "claude"
        elif shutil.which("codex"):
            nome = "codex"
        else:
            nome = "regole"
    if nome == "claude":
        from .claude import Claude

        return Claude()
    if nome == "codex":
        from .codex import Codex

        return Codex()
    if nome in ("compatibile", "miia"):
        from .compatibile import Compatibile

        try:
            return Compatibile()
        except ValueError as e:  # C5_LLM_URL mancante o non valida: la demo va avanti con le regole
            print(f"[llm compatibile] {e}: uso le regole", file=sys.stderr)
    return Regole()
