"""Base comune degli agenti.

Ogni agente è un thread con la sua coda di messaggi (modello ad attori): il bus consegna,
l'agente elabora uno alla volta. Così una chiamata LLM lenta blocca solo quell'agente.

- ascolta(filtro)          → i messaggi su quel topic arrivano a gestisci()
- ogni(minuti, funzione)   → funzione periodica sul tempo simulato
- di(a, testo)             → messaggio leggibile sul topic napoli/agenti/dialogo (per la sala)
- ragiona(...)             → chiede all'LLM un JSON; se non c'è o fallisce usa le regole
"""

from __future__ import annotations

import queue
import threading
import time
from typing import Callable

from ..bus import Bus, ora_da_secondi


def numero(n: float) -> str:
    """12345 → "12.345" (separatore delle migliaia all'italiana)."""
    return f"{round(n):,}".replace(",", ".")


class Agente(threading.Thread):
    nome = "agente"
    etichetta = "Agente"

    def __init__(self, bus: Bus, llm, scenario: dict) -> None:
        super().__init__(name=self.nome, daemon=True)
        self.bus = bus
        self.llm = llm
        self.scenario = scenario
        self.coda: queue.Queue = queue.Queue()
        self.t = 0  # secondi simulati dall'inizio del giorno
        self._periodici: list[list] = []  # [intervallo_s, ultima_esecuzione, funzione]
        self._fermo = threading.Event()
        bus.iscriviti("napoli/orologio", self._in_coda)

    # --- infrastruttura -----------------------------------------------------
    def _in_coda(self, topic: str, messaggio: dict) -> None:
        self.coda.put((topic, messaggio))

    def ascolta(self, filtro: str) -> None:
        self.bus.iscriviti(filtro, self._in_coda)

    def ogni(self, minuti: float, funzione: Callable[[], None]) -> None:
        self._periodici.append([minuti * 60, None, funzione])

    @property
    def ora(self) -> str:
        return ora_da_secondi(self.t)

    def di(self, a: str, testo: str, **extra) -> None:
        self.bus.pubblica("napoli/agenti/dialogo",
                          {"ora": self.ora, "da": self.etichetta, "a": a, "testo": testo, **extra})

    def ragiona(self, sistema: str, richiesta: str, schema: dict, regole: Callable[[], dict]) -> tuple[dict, str]:
        """Restituisce (decisione, fonte) dove fonte è il nome del provider LLM o "regole"."""
        risposta = self.llm.json(sistema, richiesta, schema)
        if isinstance(risposta, dict):
            return risposta, self.llm.nome
        return regole(), "regole"

    def run(self) -> None:
        self.avvio()
        while not self._fermo.is_set():
            try:
                topic, messaggio = self.coda.get(timeout=0.5)
            except queue.Empty:
                continue
            try:
                if topic == "napoli/orologio":
                    self.t = int(messaggio.get("t", self.t))
                    for p in self._periodici:
                        if p[1] is None or self.t - p[1] >= p[0]:
                            p[1] = self.t
                            p[2]()
                else:
                    self.gestisci(topic, messaggio)
            except Exception as e:
                print(f"[{self.nome}] errore: {e!r}")

    def ferma(self) -> None:
        self._fermo.set()

    # --- da ridefinire ------------------------------------------------------
    def avvio(self) -> None:
        pass

    def gestisci(self, topic: str, messaggio: dict) -> None:
        pass


class Orologio(threading.Thread):
    """Orologio simulato quando non gira il gemello (per provare gli agenti da soli)."""

    def __init__(self, bus: Bus, inizio: int, fine: int, velocita: float) -> None:
        super().__init__(name="orologio", daemon=True)
        self.bus, self.inizio, self.fine, self.velocita = bus, inizio, fine, velocita

    def run(self) -> None:
        t = self.inizio
        while t <= self.fine:
            self.bus.pubblica("napoli/orologio", {"ora": ora_da_secondi(t), "t": t}, trattieni=True)
            time.sleep(60 / self.velocita if self.velocita > 0 else 0.01)
            t += 60
