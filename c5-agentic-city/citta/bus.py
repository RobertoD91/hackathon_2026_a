"""Bus dei messaggi tra agenti, gemello, firmware e strumenti.

Due implementazioni con la stessa interfaccia:
- BusMemoria: tutto in un processo, per sviluppo e demo senza broker;
- BusMQTT: broker MQTT (Mosquitto sul portatile o Raspberry), per collegare gli ESP32.

Ogni messaggio è un dizionario serializzato in JSON. I topic iniziano con "napoli/".
I callback vengono chiamati nel thread del bus: chi deve fare lavoro lento (LLM)
mette il messaggio nella propria coda (vedi agenti/base.py).
"""

from __future__ import annotations

import json
import threading
import time
from typing import Callable

Callback = Callable[[str, dict], None]


def corrisponde(filtro: str, topic: str) -> bool:
    """Confronto topic MQTT con i caratteri jolly + e #."""
    f = filtro.split("/")
    t = topic.split("/")
    for i, parte in enumerate(f):
        if parte == "#":
            return True
        if i >= len(t):
            return False
        if parte != "+" and parte != t[i]:
            return False
    return len(f) == len(t)


class Bus:
    def __init__(self) -> None:
        self._iscrizioni: list[tuple[str, Callback]] = []
        self._trattenuti: dict[str, dict] = {}
        self._lock = threading.RLock()

    def pubblica(self, topic: str, messaggio: dict, trattieni: bool = False) -> None:
        raise NotImplementedError

    def iscriviti(self, filtro: str, callback: Callback) -> None:
        raise NotImplementedError

    def ultimo(self, topic: str) -> dict | None:
        """Ultimo messaggio trattenuto (retained) su un topic esatto."""
        with self._lock:
            return self._trattenuti.get(topic)

    def trattenuti(self, filtro: str) -> dict[str, dict]:
        with self._lock:
            return {t: m for t, m in self._trattenuti.items() if corrisponde(filtro, t)}

    def chiudi(self) -> None:
        pass


class BusMemoria(Bus):
    def pubblica(self, topic: str, messaggio: dict, trattieni: bool = False) -> None:
        with self._lock:
            if trattieni:
                self._trattenuti[topic] = messaggio
            destinatari = [cb for f, cb in self._iscrizioni if corrisponde(f, topic)]
        for cb in destinatari:
            try:
                cb(topic, messaggio)
            except Exception as e:  # un agente che sbaglia non deve fermare gli altri
                print(f"[bus] errore nel callback per {topic}: {e!r}")

    def iscriviti(self, filtro: str, callback: Callback) -> None:
        with self._lock:
            self._iscrizioni.append((filtro, callback))
            vecchi = [(t, m) for t, m in self._trattenuti.items() if corrisponde(filtro, t)]
        for t, m in vecchi:
            callback(t, m)


class BusMQTT(Bus):
    def __init__(self, host: str = "localhost", porta: int = 1883, client_id: str | None = None) -> None:
        super().__init__()
        import paho.mqtt.client as mqtt

        self._mqtt = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=client_id or f"citta-{time.time_ns()}")
        self._mqtt.on_message = self._ricevuto
        self._mqtt.on_connect = self._connesso
        # Il broker può non essere ancora pronto (es. avvio con docker compose): riproviamo per 60 s.
        for tentativo in range(30):
            try:
                self._mqtt.connect(host, porta, keepalive=30)
                break
            except OSError as e:
                if tentativo == 29:
                    raise
                print(f"[bus] broker {host}:{porta} non raggiungibile ({e}), riprovo…")
                time.sleep(2)
        self._mqtt.loop_start()

    def _connesso(self, client, userdata, flags, reason_code, properties=None):
        with self._lock:
            filtri = {f for f, _ in self._iscrizioni}
        for f in filtri:
            client.subscribe(f)

    def _ricevuto(self, client, userdata, msg):
        try:
            messaggio = json.loads(msg.payload.decode("utf-8") or "{}")
        except (UnicodeDecodeError, json.JSONDecodeError):
            messaggio = {"testo": msg.payload.decode("utf-8", "replace")}
        if not isinstance(messaggio, dict):
            messaggio = {"valore": messaggio}
        with self._lock:
            if msg.retain:
                self._trattenuti[msg.topic] = messaggio
            destinatari = [cb for f, cb in self._iscrizioni if corrisponde(f, msg.topic)]
        for cb in destinatari:
            try:
                cb(msg.topic, messaggio)
            except Exception as e:
                print(f"[bus] errore nel callback per {msg.topic}: {e!r}")

    def pubblica(self, topic: str, messaggio: dict, trattieni: bool = False) -> None:
        with self._lock:
            if trattieni:
                self._trattenuti[topic] = messaggio
        self._mqtt.publish(topic, json.dumps(messaggio, ensure_ascii=False), qos=0, retain=trattieni)

    def iscriviti(self, filtro: str, callback: Callback) -> None:
        with self._lock:
            self._iscrizioni.append((filtro, callback))
        self._mqtt.subscribe(filtro)

    def chiudi(self) -> None:
        self._mqtt.loop_stop()
        self._mqtt.disconnect()


def crea_bus(indirizzo: str | None) -> Bus:
    """None o "memoria" → BusMemoria; "host[:porta]" → BusMQTT."""
    if not indirizzo or indirizzo == "memoria":
        return BusMemoria()
    host, _, porta = indirizzo.partition(":")
    return BusMQTT(host, int(porta or 1883))


def ora_da_secondi(t: float) -> str:
    t = int(t) % 86400
    return f"{t // 3600:02d}:{(t % 3600) // 60:02d}"


def secondi_da_ora(ora: str) -> int:
    h, m = ora.split(":")
    return int(h) * 3600 + int(m) * 60
