"""Provider Claude (SDK Anthropic).

Variabili d'ambiente:
- ANTHROPIC_API_KEY (oppure un profilo `ant auth login`);
- C5_MODELLO: modello (default claude-opus-5-5);
- C5_EFFORT: low | medium | high (default low: in demo conta la velocità).
"""

from __future__ import annotations

import json
import os
import threading

import anthropic


class Claude:
    nome = "claude"

    def __init__(self) -> None:
        self.modello = os.environ.get("C5_MODELLO", "claude-opus-5-5")
        self.effort = os.environ.get("C5_EFFORT", "low")
        self.client = anthropic.Anthropic(timeout=60.0, max_retries=2)
        # Più agenti chiamano in parallelo: limitiamo le richieste contemporanee.
        self._semaforo = threading.Semaphore(int(os.environ.get("C5_LLM_PARALLELE", "4")))

    def _chiama(self, sistema: str, richiesta: str, schema: dict | None) -> str | None:
        parametri = dict(
            model=self.modello,
            max_tokens=4000,
            system=sistema,
            messages=[{"role": "user", "content": richiesta}],
            output_config={"effort": self.effort},
        )
        if schema is not None:
            parametri["output_config"]["format"] = {"type": "json_schema", "schema": schema}
        with self._semaforo:
            try:
                # Fallback lato server: se il modello rifiuta, l'API riprova con un altro modello.
                risposta = self.client.beta.messages.create(
                    betas=["server-side-fallback-2026-07-01"], fallbacks="default", **parametri)
            except anthropic.APIConnectionError as e:
                print(f"[llm claude] rete non raggiungibile: {e}")
                return None
            except anthropic.RateLimitError:
                print("[llm claude] limite di richieste raggiunto, uso le regole")
                return None
            except anthropic.APIStatusError as e:
                print(f"[llm claude] errore {e.status_code}: {e.message}")
                return None
        if risposta.stop_reason == "refusal":
            print("[llm claude] richiesta rifiutata, uso le regole")
            return None
        return "".join(b.text for b in risposta.content if b.type == "text")

    def json(self, sistema: str, richiesta: str, schema: dict) -> dict | None:
        testo = self._chiama(sistema, richiesta, schema)
        if not testo:
            return None
        try:
            return json.loads(testo)
        except json.JSONDecodeError:
            print("[llm claude] JSON non valido, uso le regole")
            return None

    def testo(self, sistema: str, richiesta: str) -> str | None:
        return self._chiama(sistema, richiesta, None)

    def conta_persone(self, percorso_foto: str, contesto: str = "") -> dict | None:
        """Visione: stima quante persone (o statuine sul plastico) ci sono in una foto del drone."""
        import base64
        import mimetypes

        tipo = mimetypes.guess_type(percorso_foto)[0] or "image/jpeg"
        with open(percorso_foto, "rb") as f:
            dati = base64.standard_b64encode(f.read()).decode("utf-8")
        schema = {"type": "object", "properties": {"persone": {"type": "integer"}, "densita": {"type": "string"},
                                                   "note": {"type": "string"}},
                  "required": ["persone", "densita", "note"], "additionalProperties": False}
        with self._semaforo:
            try:
                risposta = self.client.beta.messages.create(
                    betas=["server-side-fallback-2026-07-01"], fallbacks="default",
                    model=self.modello, max_tokens=2000,
                    output_config={"effort": self.effort, "format": {"type": "json_schema", "schema": schema}},
                    messages=[{"role": "user", "content": [
                        {"type": "image", "source": {"type": "base64", "media_type": tipo, "data": dati}},
                        {"type": "text", "text": "Foto dall'alto scattata da un drone per stimare l'affollamento. "
                                                 f"{contesto} Conta (o stima) le persone visibili. densita: bassa, media, alta. "
                                                 "note: una frase in italiano su cosa vedi."}]}],
                )
            except anthropic.APIError as e:
                print(f"[llm claude] visione non riuscita: {e}")
                return None
        if risposta.stop_reason == "refusal":
            return None
        testo = "".join(b.text for b in risposta.content if b.type == "text")
        try:
            return json.loads(testo)
        except json.JSONDecodeError:
            return None
