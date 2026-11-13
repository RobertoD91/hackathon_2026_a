"""API HTTP della città, per la skill OpenClaw (WhatsApp) e per altri client.

POST /chiedi       {"utente": "+39...", "testo": "..."}  → {"risposta": "..."}
GET  /notifiche?utente=+39...                            → {"notifiche": [...]}  (avvisi proattivi)
GET  /stato                                              → stato della città (folla, meteo, KPI, semafori)
POST /evento       {"evento": "...", "veicoli": 20}       → come un pulsante del plastico
GET  /drone/richieste                                    → ultima richiesta di volo dell'orchestratore
POST /drone        {"zona": "...", "persone_stimate": N, "note": "..."} → osservazione del drone
POST /operatore    {"decisione": "D3", "esito": "approva"|"blocca"}   → risposta dell'operatore

Se è impostata la variabile C5_API_TOKEN serve l'header "Authorization: Bearer <token>".
"""

from __future__ import annotations

import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse


def avvia_api(assistenti, bus, porta: int = 8080, host: str = "0.0.0.0") -> ThreadingHTTPServer:
    token = os.environ.get("C5_API_TOKEN")

    class Gestore(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def _rispondi(self, codice: int, dati: dict) -> None:
            corpo = json.dumps(dati, ensure_ascii=False, default=list).encode("utf-8")
            self.send_response(codice)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(corpo)))
            self.end_headers()
            self.wfile.write(corpo)

        def _autorizzato(self) -> bool:
            if token and self.headers.get("Authorization") != f"Bearer {token}":
                self._rispondi(401, {"errore": "token mancante o errato"})
                return False
            return True

        def _corpo(self) -> dict:
            n = int(self.headers.get("Content-Length") or 0)
            try:
                return json.loads(self.rfile.read(n) or b"{}")
            except json.JSONDecodeError:
                return {}

        def do_GET(self):
            if not self._autorizzato():
                return
            url = urlparse(self.path)
            if url.path == "/stato":
                stato = assistenti.stato_citta()
                stato["semafori"] = {t.split("/")[2]: m for t, m in bus.trattenuti("napoli/semafori/+/stato").items()}
                stato["piano_semafori"] = bus.ultimo("napoli/semafori/piano")
                self._rispondi(200, stato)
            elif url.path == "/drone/richieste":
                self._rispondi(200, {"richiesta": bus.ultimo("napoli/drone/richieste")})
            elif url.path == "/notifiche":
                utente = parse_qs(url.query).get("utente", [""])[0]
                self._rispondi(200, {"notifiche": assistenti.notifiche(utente)})
            else:
                self._rispondi(404, {"errore": "percorso sconosciuto"})

        def do_POST(self):
            if not self._autorizzato():
                return
            dati = self._corpo()
            if self.path == "/chiedi":
                utente, testo = str(dati.get("utente") or "anonimo")[:60], str(dati.get("testo") or "")[:1000]
                if not testo:
                    self._rispondi(400, {"errore": "testo mancante"})
                    return
                self._rispondi(200, {"risposta": assistenti.chiedi(utente, testo)})
            elif self.path == "/evento":
                bus.pubblica("napoli/eventi/manuale", dati)
                self._rispondi(200, {"ok": True})
            elif self.path == "/drone":
                if not dati.get("zona") or dati.get("persone_stimate") is None:
                    self._rispondi(400, {"errore": "servono zona e persone_stimate"})
                    return
                bus.pubblica("napoli/drone/osservazioni", dati)
                self._rispondi(200, {"ok": True})
            elif self.path == "/operatore":
                bus.pubblica("napoli/operatore/comandi", dati)
                self._rispondi(200, {"ok": True})
            else:
                self._rispondi(404, {"errore": "percorso sconosciuto"})

    server = ThreadingHTTPServer((host, porta), Gestore)
    threading.Thread(target=server.serve_forever, name="api", daemon=True).start()
    return server
