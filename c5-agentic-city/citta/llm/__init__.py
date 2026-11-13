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


class Regole:
    """Nessun LLM: gli agenti decidono con le regole scritte nel codice."""

    nome = "regole"

    def json(self, sistema: str, richiesta: str, schema: dict) -> dict | None:
        return None

    def testo(self, sistema: str, richiesta: str) -> str | None:
        return None


def crea_llm(nome: str | None = None):
    """nome: "claude", "codex", "regole" oppure "auto" (default)."""
    nome = (nome or os.environ.get("C5_LLM") or "auto").lower()
    if nome == "auto":
        if os.environ.get("ANTHROPIC_API_KEY"):
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
    return Regole()
