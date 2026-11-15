"""Bus dei messaggi tra agenti, gemello, dispositivi veri e strumenti.

Due implementazioni con la stessa interfaccia:
- BusMemoria: tutto in un processo, per sviluppo e demo senza broker;
- BusMQTT: broker MQTT (Mosquitto in locale o sul server), per ricevere le misure vere
  del badge WHY2025 e della scheda Tasmota (napoli/sensori/..., napoli/nodi/...).
  Il broker del team vuole utente e password: si danno con le variabili d'ambiente
  C5_MQTT_UTENTE e C5_MQTT_PASSWORD (per la città l'utente è c5). Senza, il collegamento
  è anonimo, come al Mosquitto locale di compose.yaml.

Ogni messaggio è un dizionario serializzato in JSON. I topic iniziano con "napoli/".
I callback vengono chiamati nel thread del bus: chi deve fare lavoro lento (LLM)
mette il messaggio nella propria coda (vedi agenti/base.py).
"""

from __future__ import annotations

import json
import os
import sys
import threading
import time
from typing import Callable

Callback = Callable[[str, dict], None]


class ErroreBroker(RuntimeError):
    """Il broker MQTT non accetta la città (utente o password sbagliati) oppure non è raggiungibile."""


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
    descrizione = "memoria"  # per il messaggio di avvio

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
    def __init__(self, host: str = "localhost", porta: int = 1883, client_id: str | None = None,
                 utente: str | None = None, password: str | None = None) -> None:
        super().__init__()
        import paho.mqtt.client as mqtt

        # Utente e password: dagli argomenti oppure dall'ambiente, mai scritti nei file né stampati.
        if utente is None:
            utente = os.environ.get("C5_MQTT_UTENTE", "")
        if password is None:
            password = os.environ.get("C5_MQTT_PASSWORD", "")
        self.utente = utente.strip() or None
        self._dove = f"{host}:{porta}"
        self.descrizione = f"{self._dove} " + (f"con utente {self.utente}" if self.utente else "senza password")
        self._rifiuto = None  # motivo del rifiuto (CONNACK con errore)
        self._risposto = False  # il broker ha risposto alla connessione
        self._collegato = False
        self._pronto = False  # True dopo il primo collegamento riuscito
        self._chiuso = False

        self._mqtt = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=client_id or f"citta-{time.time_ns()}")
        if self.utente:
            self._mqtt.username_pw_set(self.utente, password or None)
        elif password:
            print("[bus] C5_MQTT_PASSWORD senza C5_MQTT_UTENTE: la ignoro", file=sys.stderr)
        self._mqtt.on_message = self._ricevuto
        self._mqtt.on_connect = self._connesso
        self._mqtt.on_disconnect = self._disconnesso
        # Il broker può non essere ancora pronto (es. avvio con docker compose): riproviamo per circa 60 s.
        # Un rifiuto esplicito (utente o password sbagliati) invece ferma subito: riprovare non serve.
        for tentativo in range(30):
            try:
                self._mqtt.connect(host, porta, keepalive=30)
                self._aspetta_risposta(mqtt)
                break
            except OSError as e:
                if tentativo == 29:
                    raise ErroreBroker(f"broker {self._dove} non raggiungibile ({e})") from e
                print(f"[bus] broker {self._dove} non raggiungibile ({e}), riprovo…", file=sys.stderr)
                time.sleep(2)
        if self._rifiuto is not None:
            raise ErroreBroker(self._spiega(self._rifiuto))
        self._pronto = True
        print(f"[bus] collegato al broker {self.descrizione}", file=sys.stderr)
        self._mqtt.loop_start()

    def _aspetta_risposta(self, mqtt, secondi: float = 10) -> None:
        """Fa girare la rete a mano finché il broker risponde (CONNACK), prima di loop_start: così un rifiuto
        si vede subito, invece di lasciare che paho riprovi da solo in silenzio."""
        self._risposto = False
        fine = time.monotonic() + secondi
        while not self._risposto:
            rc = self._mqtt.loop(timeout=0.5)
            if self._risposto:
                break
            if rc != mqtt.MQTT_ERR_SUCCESS:
                raise ConnectionError(f"connessione chiusa prima della risposta del broker: {mqtt.error_string(rc)}")
            if time.monotonic() > fine:
                raise TimeoutError(f"nessuna risposta MQTT in {secondi:g} s")

    def _spiega(self, motivo) -> str:
        """Messaggio chiaro per un rifiuto del broker (con il nome utente, mai la password)."""
        codice = int(getattr(motivo, "value", motivo))
        if codice in (0x86, 0x87):  # "Bad user name or password", "Not authorized" (rc 4 e 5 in MQTT 3.1.1)
            if self.utente:
                return (f"il broker {self._dove} rifiuta utente o password (utente {self.utente}: {motivo}). "
                        "Controlla C5_MQTT_UTENTE e C5_MQTT_PASSWORD: la password di c5 è quella stampata da "
                        "cloud/mqtt/scripts/inizializza.sh (segreti/credenziali-iniziali.txt sul server)")
            return (f"il broker {self._dove} vuole utente e password ({motivo}): "
                    "imposta C5_MQTT_UTENTE=c5 e C5_MQTT_PASSWORD")
        return f"il broker {self._dove} rifiuta la connessione ({motivo}, codice {codice})"

    def _connesso(self, client, userdata, flags, reason_code, properties=None):
        if int(getattr(reason_code, "value", reason_code)) >= 0x80:  # rifiuto
            if self._pronto:  # riconnessione rifiutata: paho riprova da solo, ma non in silenzio
                print(f"[bus] {self._spiega(reason_code)}; riprovo più tardi", file=sys.stderr)
            self._rifiuto, self._risposto = reason_code, True
            return
        self._rifiuto, self._risposto, self._collegato = None, True, True
        if self._pronto:
            print(f"[bus] di nuovo collegato al broker {self._dove}", file=sys.stderr)
        with self._lock:
            filtri = {f for f, _ in self._iscrizioni}
        for f in filtri:
            client.subscribe(f)

    def _disconnesso(self, client, userdata, flags, reason_code, properties=None):
        if self._collegato and not self._chiuso:
            print(f"[bus] collegamento con il broker {self._dove} perso, riprovo…", file=sys.stderr)
        self._collegato = False

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
        self._chiuso = True
        self._mqtt.loop_stop()
        self._mqtt.disconnect()


def crea_bus(indirizzo: str | None) -> Bus:
    """None o "memoria" → BusMemoria; "host[:porta]" → BusMQTT, con utente e password da C5_MQTT_UTENTE e
    C5_MQTT_PASSWORD se ci sono. Se il broker rifiuta la città o non risponde solleva ErroreBroker."""
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
