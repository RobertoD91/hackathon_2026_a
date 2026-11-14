"""Provider "compatibile": un LLM qualsiasi dietro un'API Chat Completions compatibile con OpenAI.

È il formato che espongono molte piattaforme LLM, anche aziendali e on-premise (vLLM, SGLang, Ollama,
LM Studio, LiteLLM). Esempio: secondo la sua scheda su Hugging Face, FastwebMIIA-7B (l'LLM italiano di
Fastweb + Vodafone, scaricabile con licenza non commerciale) servito con `vllm serve Fastweb/FastwebMIIA-7B`
risponde su http://<host>:8000/v1/chat/completions, quindi:
  C5_LLM=miia C5_LLM_URL=http://<host>:8000/v1 C5_LLM_MODELLO=Fastweb/FastwebMIIA-7B python avvia.py

Variabili d'ambiente (la chiave arriva solo da qui: mai nei file né nei log):
- C5_LLM=compatibile (alias miia);
- C5_LLM_URL: indirizzo base dell'API, es. https://<host>/v1 (obbligatorio);
- C5_LLM_MODELLO: nome del modello (senza: il primo che il server elenca in GET <url>/models);
- C5_LLM_CHIAVE: chiave, mandata come "Authorization: Bearer ..." (facoltativa);
- C5_LLM_TIMEOUT: secondi per richiesta (default 60);
- C5_LLM_PARALLELE: richieste contemporanee (default 4);
- C5_LLM_MAX_TOKEN: tetto della risposta (default 2000; 0 = non mandarlo, per i server che lo rifiutano);
- C5_LLM_PAUSA: secondi senza LLM dopo un errore di rete o del server (default 60): intanto le regole.

Risposte JSON: prima con lo schema in "response_format" (risposta vincolata dove il server lo supporta),
poi "json_object", poi solo l'istruzione nel prompt; se il server rifiuta il ruolo "system", il prompt di
sistema va nel messaggio dell'utente. La prima forma accettata resta per le chiamate successive.
Il JSON si legge in modo tollerante (```json, frasi intorno, <think>…</think>, "4" al posto di 4, enum
senza badare a maiuscole e spazi, chiavi in più tolte), ma i campi obbligatori devono esserci: se qualcosa
non torna il provider restituisce None e l'agente usa le sue regole. Solo libreria standard.
"""

from __future__ import annotations

import http.client
import json
import math
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

# Forme della richiesta, dalla più precisa alla più semplice: (response_format, ruolo "system" a parte).
_FORME_JSON = (("schema", True), ("oggetto", True), (None, True), (None, False))
_FORME_TESTO = ((None, True), (None, False))
_RIPROVA = (429, 500, 502, 503, 504)  # un secondo tentativo, poi pausa
# Modelli che ragionano ad alta voce: il blocco <think> (anche mai chiuso) non fa parte della risposta.
_RAGIONAMENTO = re.compile(r"<think>.*?(?:</think>|$)", re.DOTALL | re.IGNORECASE)
_NO = object()  # valore non conforme allo schema


def _log(testo: str) -> None:
    print(f"[llm compatibile] {testo}", file=sys.stderr, flush=True)


def _ambiente(nome: str, predefinito: float) -> float:
    valore = os.environ.get(nome, "").strip()
    try:
        return float(valore) if valore else predefinito
    except ValueError:
        raise ValueError(f"{nome} deve essere un numero, non {valore!r}") from None


class Compatibile:
    nome = "compatibile"

    def __init__(self) -> None:
        parti = urllib.parse.urlsplit(os.environ.get("C5_LLM_URL", "").strip())
        if parti.scheme not in ("http", "https") or not parti.hostname:
            raise ValueError("C5_LLM_URL mancante o non valida (es. https://<host>/v1)")
        percorso = parti.path.rstrip("/").removesuffix("/chat/completions")  # va bene anche l'indirizzo completo
        self._base = urllib.parse.urlunsplit((parti.scheme, parti.netloc, percorso, "", ""))
        self._query = f"?{parti.query}" if parti.query else ""
        # Nei log solo host e porta: niente utente, password o parametri dell'indirizzo.
        self.host = f"{parti.hostname}:{parti.port}" if parti.port else parti.hostname
        self.modello = os.environ.get("C5_LLM_MODELLO", "").strip()
        self._chiave = os.environ.get("C5_LLM_CHIAVE", "").strip()
        self.timeout = _ambiente("C5_LLM_TIMEOUT", 60)
        self.max_token = int(_ambiente("C5_LLM_MAX_TOKEN", 2000))
        self.pausa = _ambiente("C5_LLM_PAUSA", 60)
        # Più agenti chiamano in parallelo: limitiamo le richieste contemporanee.
        self._semaforo = threading.Semaphore(max(1, int(_ambiente("C5_LLM_PARALLELE", 4))))
        self._lock = threading.Lock()
        self._forma = {"json": 0, "testo": 0}  # la prima forma di richiesta accettata dal server
        self._pausa_fino = 0.0
        _log(f"{parti.scheme}://{self.host} · modello {self.modello or 'dal server'} · "
             f"chiave {'impostata' if self._chiave else 'assente'}")

    # --- interfaccia comune dei provider ---------------------------------------------
    def json(self, sistema: str, richiesta: str, schema: dict) -> dict | None:
        testo = self._chiama(sistema, richiesta, schema)
        if not testo:
            return None
        risposta = conforme(estrai_json(testo), schema)
        if risposta is None:
            _log("JSON assente o diverso dallo schema: uso le regole")
        return risposta

    def testo(self, sistema: str, richiesta: str) -> str | None:
        return self._chiama(sistema, richiesta, None)

    # --- richieste -------------------------------------------------------------------
    def _chiama(self, sistema: str, richiesta: str, schema: dict | None) -> str | None:
        if self._in_pausa():
            return None  # errore recente: per ora decidono le regole
        modello = self._nome_modello()
        if not modello:
            return None
        tipo, forme = ("json", _FORME_JSON) if schema is not None else ("testo", _FORME_TESTO)
        if schema is not None:
            sistema = f"{sistema}\n\n{_istruzione_json(schema)}"
        with self._semaforo:
            if self._in_pausa():
                return None
            i = self._forma[tipo]
            while True:
                formato, con_sistema = forme[i]
                codice, dati = self._post(self._corpo(modello, sistema, richiesta, schema, formato, con_sistema))
                if codice in (400, 422) and i + 1 < len(forme):
                    i += 1  # il server non accetta questa forma: si prova la successiva, più semplice
                    continue
                break
        if codice != 200:
            self._errore(codice, dati)
            return None
        with self._lock:
            self._forma[tipo] = max(self._forma[tipo], i)
        return self._contenuto(dati, per_json=schema is not None)

    def _corpo(self, modello: str, sistema: str, richiesta: str, schema: dict | None,
               formato: str | None, con_sistema: bool) -> dict:
        if con_sistema:
            messaggi = [{"role": "system", "content": sistema}, {"role": "user", "content": richiesta}]
        else:  # modelli il cui template non conosce il ruolo "system"
            messaggi = [{"role": "user", "content": f"{sistema}\n\n{richiesta}"}]
        corpo = {"model": modello, "messages": messaggi, "stream": False}
        if self.max_token > 0:
            corpo["max_tokens"] = self.max_token
        if formato == "schema":
            corpo["response_format"] = {"type": "json_schema",
                                        "json_schema": {"name": "risposta", "schema": schema, "strict": True}}
        elif formato == "oggetto":
            corpo["response_format"] = {"type": "json_object"}
        return corpo

    def _nome_modello(self) -> str | None:
        """C5_LLM_MODELLO oppure il primo modello del server (vLLM e SGLang ne servono uno solo)."""
        if not self.modello:
            codice, dati, _ = self._richiesta("GET", "/models")
            try:
                self.modello = str(dati["data"][0]["id"])
            except (TypeError, KeyError, IndexError):
                causa = "elenco vuoto o inatteso" if codice == 200 else self._spiega(codice, dati)
                self._metti_in_pausa(f"manca C5_LLM_MODELLO e GET /models non lo dice ({causa})")
                return None
            _log(f"modello dal server: {self.modello}")
        return self.modello

    def _post(self, corpo: dict) -> tuple[int, object]:
        codice, dati, attesa = self._richiesta("POST", "/chat/completions", corpo)
        if codice in _RIPROVA:  # troppe richieste o server occupato: si riprova una volta
            time.sleep(attesa)
            codice, dati, attesa = self._richiesta("POST", "/chat/completions", corpo)
        return codice, dati

    def _richiesta(self, metodo: str, percorso: str, corpo: dict | None = None) -> tuple[int, object, float]:
        """(codice HTTP, JSON della risposta o messaggio d'errore, attesa consigliata).
        Codice 0: rete o timeout; -1: risposta che non è JSON."""
        intestazioni = {"Accept": "application/json", "User-Agent": "TwinCIRO-citta/1.0"}
        if self._chiave:
            intestazioni["Authorization"] = f"Bearer {self._chiave}"
        dati = None
        if corpo is not None:
            dati = json.dumps(corpo, ensure_ascii=False).encode("utf-8")
            intestazioni["Content-Type"] = "application/json"
        richiesta = urllib.request.Request(f"{self._base}{percorso}{self._query}", data=dati,
                                           headers=intestazioni, method=metodo)
        try:
            with urllib.request.urlopen(richiesta, timeout=self.timeout) as r:
                codice, testo = r.status, r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            try:
                testo = e.read().decode("utf-8", "replace")
            except (OSError, http.client.HTTPException):
                testo = ""
            try:
                attesa = float((e.headers or {}).get("Retry-After") or 1)
            except ValueError:
                attesa = 1.0
            return e.code, _messaggio_errore(testo), min(max(attesa, 0.5), 5.0)
        except (OSError, http.client.HTTPException) as e:  # rete assente, DNS, connessione rifiutata, timeout
            return 0, getattr(e, "reason", None) or e, 0.0
        try:
            return codice, json.loads(testo), 0.0
        except ValueError:
            return -1, "risposta che non è JSON (portale Wi-Fi o proxy?)", 0.0

    def _contenuto(self, dati, per_json: bool) -> str | None:
        try:
            scelta = dati["choices"][0]
            testo = scelta["message"].get("content")
        except (TypeError, KeyError, IndexError, AttributeError):
            _log("risposta in un formato inatteso: uso le regole")
            return None
        if isinstance(testo, list):  # alcuni server: [{"type": "text", "text": "..."}]
            testo = "".join(p.get("text") or "" for p in testo if isinstance(p, dict))
        testo = _RAGIONAMENTO.sub("", testo).strip() if isinstance(testo, str) else ""
        if not testo:
            _log("risposta vuota o rifiutata dal modello: uso le regole")
            return None
        if not per_json and scelta.get("finish_reason") == "length":
            _log("risposta troncata (vedi C5_LLM_MAX_TOKEN): uso le regole")
            return None
        return testo

    # --- errori ----------------------------------------------------------------------
    def _in_pausa(self) -> bool:
        return time.monotonic() < self._pausa_fino

    def _metti_in_pausa(self, motivo: str) -> None:
        with self._lock:
            gia_in_pausa = self._in_pausa()
            self._pausa_fino = time.monotonic() + self.pausa
        if not gia_in_pausa:
            _log(f"{motivo}: uso le regole" + (f" per {self.pausa:g} s" if self.pausa > 0 else ""))

    def _errore(self, codice: int, dati) -> None:
        if codice in (400, 422):  # riguarda solo questa richiesta: niente pausa
            _log(f"richiesta rifiutata ({codice}): {self._pulito(dati)}; uso le regole")
        else:
            self._metti_in_pausa(self._spiega(codice, dati))

    def _spiega(self, codice: int, dati) -> str:
        if codice == 0:
            return f"{self.host} non raggiungibile ({self._pulito(dati)})"
        if codice in (401, 403):  # il corpo può ripetere la chiave: non si stampa
            return f"chiave mancante o rifiutata ({codice})"
        if codice == 404:
            return f"indirizzo o modello non trovato (404; C5_LLM_URL finisce con /v1?): {self._pulito(dati)}"
        if codice == -1:
            return self._pulito(dati)
        return f"errore {codice}: {self._pulito(dati)}"

    def _pulito(self, testo) -> str:
        """Una riga corta per i log, senza la chiave."""
        testo = " ".join(str(testo).split())
        if self._chiave:
            testo = testo.replace(self._chiave, "***")
        return testo[:200]


def _istruzione_json(schema: dict) -> str:
    return ("Rispondi SOLO con un oggetto JSON valido, senza testo prima o dopo e senza blocchi di codice, "
            "con tutti i campi obbligatori (\"required\") di questo JSON Schema:\n"
            + json.dumps(schema, ensure_ascii=False))


def _messaggio_errore(testo: str) -> str:
    """Il messaggio d'errore nei formati più comuni (OpenAI, vLLM, Ollama, FastAPI)."""
    try:
        dati = json.loads(testo)
    except ValueError:
        return testo
    if isinstance(dati, dict):
        errore = dati.get("error", dati)
        if isinstance(errore, dict):
            return str(errore.get("message") or errore.get("detail") or errore)
        return str(errore)
    return str(dati)


# --- lettura tollerante del JSON ---------------------------------------------------------
def estrai_json(testo: str | None) -> dict | None:
    """Il primo oggetto JSON nel testo: tollera ```json, frasi prima e dopo e i blocchi <think>."""
    testo = _RAGIONAMENTO.sub("", testo or "")
    lettore = json.JSONDecoder()
    inizio = testo.find("{")
    while inizio != -1:
        try:
            valore, _ = lettore.raw_decode(testo, inizio)
            if isinstance(valore, dict):
                return valore
        except ValueError:
            pass
        inizio = testo.find("{", inizio + 1)
    return None


def conforme(valore, schema: dict) -> dict | None:
    """Il valore adattato allo schema JSON (il sottoinsieme che usano gli agenti), None se non torna.

    Tollerante sulla forma: "4" → 4, 4.0 → 4, "1,5" → 1.5, "true" → True, enum senza badare a maiuscole,
    spazi e trattini, null/""/0 come valore vuoto del tipo giusto (nei prompt degli agenti "" e 0 vogliono
    dire "non usato"), chiavi in più tolte, elementi non validi di una lista scartati. Severo sulla
    sostanza: i campi obbligatori devono esserci, perché le regole valgono più di un campo inventato."""
    if not isinstance(valore, dict):
        return None
    adattato = _adatta(valore, schema)
    return None if adattato is _NO else adattato


def _adatta(valore, schema: dict):
    tipo = schema.get("type")
    if tipo == "object":
        if not isinstance(valore, dict):
            return _NO
        proprieta = schema.get("properties", {})
        richiesti = set(schema.get("required", ()))
        uscita = {}
        for chiave, sotto in proprieta.items():
            if chiave in valore:
                adattato = _adatta(valore[chiave], sotto)
                if adattato is not _NO:
                    uscita[chiave] = adattato
                    continue
            if chiave in richiesti:
                return _NO
        if schema.get("additionalProperties", True) is not False:
            uscita.update((k, v) for k, v in valore.items() if k not in proprieta)
        return uscita
    if tipo == "array":
        if not isinstance(valore, list):
            return _NO
        validi = [v for v in (_adatta(e, schema.get("items", {})) for e in valore) if v is not _NO]
        return validi if validi or not valore else _NO  # tutti da scartare: meglio le regole
    if tipo in ("string", "integer", "number") and _vuoto(valore):
        vuoto = "" if tipo == "string" else 0  # un valore vuoto resta vuoto, se lo schema lo ammette
        return vuoto if vuoto in schema.get("enum", [vuoto]) else _NO
    if "enum" in schema:
        return _in_enum(valore, schema["enum"])
    if tipo == "string":
        return valore.strip() if isinstance(valore, str) else _NO
    if tipo in ("integer", "number"):
        numero = _numero(valore)
        if numero is _NO or tipo == "number" or isinstance(numero, int):
            return numero
        return int(numero) if numero.is_integer() else _NO
    if tipo == "boolean":
        if isinstance(valore, bool):
            return valore
        return {"true": True, "false": False}.get(str(valore).strip().lower(), _NO)
    return valore


def _in_enum(valore, ammessi: list):
    if valore in ammessi:
        return valore
    if isinstance(valore, str):
        chiave = _normale(valore)
        for a in ammessi:
            if isinstance(a, str) and _normale(a) == chiave:
                return a
    return _NO


def _normale(testo: str) -> str:
    return re.sub(r"[\s\-]+", "_", testo.strip().lower())


def _vuoto(valore) -> bool:
    return valore is None or valore == "" or (isinstance(valore, (int, float)) and valore == 0)


def _numero(valore):
    if isinstance(valore, str):
        try:
            valore = float(valore.strip().replace(",", "."))
        except ValueError:
            return _NO
    if isinstance(valore, bool) or not isinstance(valore, (int, float)):
        return _NO
    return valore if isinstance(valore, int) or math.isfinite(valore) else _NO  # niente NaN né infiniti
