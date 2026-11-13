"""Provider Codex: usa la CLI `codex exec` con l'abbonamento ChatGPT (non serve una chiave API).

Ogni chiamata è un turno di agente Codex: è più lento di un'API diretta (secondi o decine
di secondi). Va bene per le decisioni dell'orchestratore, meno per la chat dal vivo.

Variabili d'ambiente:
- C5_CODEX_CMD: comando (default "codex");
- C5_CODEX_ARGS: argomenti extra, per esempio "-m gpt-5-codex";
- C5_CODEX_TIMEOUT: secondi (default 90).
Da verificare in sede con la versione di Codex installata: i flag usati sono
`exec`, `--skip-git-repo-check`, `--sandbox read-only` e `--output-last-message`.
"""

from __future__ import annotations

import json
import os
import re
import shlex
import subprocess
import tempfile
import threading


class Codex:
    nome = "codex"

    def __init__(self) -> None:
        self.comando = os.environ.get("C5_CODEX_CMD", "codex")
        self.extra = shlex.split(os.environ.get("C5_CODEX_ARGS", ""))
        self.timeout = int(os.environ.get("C5_CODEX_TIMEOUT", "90"))
        self._semaforo = threading.Semaphore(int(os.environ.get("C5_LLM_PARALLELE", "2")))

    def _chiama(self, prompt: str) -> str | None:
        with tempfile.TemporaryDirectory() as cartella:
            uscita = os.path.join(cartella, "risposta.txt")
            cmd = [self.comando, "exec", "--skip-git-repo-check", "--sandbox", "read-only",
                   "--output-last-message", uscita, *self.extra, prompt]
            with self._semaforo:
                try:
                    subprocess.run(cmd, cwd=cartella, capture_output=True, text=True,
                                   timeout=self.timeout, check=True)
                except (subprocess.SubprocessError, OSError) as e:
                    print(f"[llm codex] errore: {e!r}")
                    return None
            try:
                with open(uscita, encoding="utf-8") as f:
                    return f.read().strip()
            except OSError:
                return None

    def json(self, sistema: str, richiesta: str, schema: dict) -> dict | None:
        prompt = (f"{sistema}\n\n{richiesta}\n\nRispondi SOLO con un oggetto JSON valido che rispetta "
                  f"questo schema, senza testo prima o dopo e senza eseguire comandi:\n{json.dumps(schema, ensure_ascii=False)}")
        testo = self._chiama(prompt)
        if not testo:
            return None
        trovato = re.search(r"\{.*\}", testo, re.S)
        if not trovato:
            return None
        try:
            return json.loads(trovato.group(0))
        except json.JSONDecodeError:
            return None

    def testo(self, sistema: str, richiesta: str) -> str | None:
        return self._chiama(f"{sistema}\n\n{richiesta}\n\nRispondi solo con il testo richiesto, senza eseguire comandi.")
