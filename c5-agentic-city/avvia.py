#!/usr/bin/env python3
"""Avvia Napoli Agentic City: agenti, gemello digitale, API per OpenClaw e sala operativa.

Esempi:
  python avvia.py                               # tutto in un processo, LLM automatico, sala a schermo
  python avvia.py --llm regole --velocita 60    # senza LLM, giornata accelerata 60x
  python avvia.py --broker localhost            # bus MQTT (misure vere del badge e di Tasmota)
  python avvia.py --senza-sala                  # stampa il dialogo tra agenti nel terminale
  python avvia.py --velocita 0 --senza-sala     # giornata intera il più veloce possibile (KPI finali)

Broker del team (utente c5; utente e password dall'ambiente, mai nei file; la password di c5 la
stampa cloud/mqtt/scripts/inizializza.sh). Senza le due variabili il collegamento è anonimo.
  C5_MQTT_UTENTE=c5 C5_MQTT_PASSWORD=... python avvia.py --broker twinciro.robertodisanto.it:1883
  C5_MQTT_UTENTE=c5 C5_MQTT_PASSWORD=... python avvia.py --broker localhost:1883   # sul server stesso
"""

from __future__ import annotations

import argparse
import json
import os
import signal
import sys
import threading
import time

from citta import DATI
from citta.agenti.assistente import Assistenti
from citta.agenti.base import Orologio
from citta.agenti.eventi import AgenteEventi
from citta.agenti.folla import AgenteFolla
from citta.agenti.imprese import AgenteImprese
from citta.agenti.meteo import AgenteMeteo
from citta.agenti.orchestratore import Orchestratore
from citta.agenti.traffico import AgenteTraffico
from citta.agenti.turismo import AgenteTurismo
from citta.api import avvia_api
from citta.bus import ErroreBroker, crea_bus, secondi_da_ora
from citta.llm import crea_llm


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--broker", default="memoria",
                   help="memoria (default) oppure host[:porta] del broker MQTT; utente e password dalle variabili "
                        "C5_MQTT_UTENTE e C5_MQTT_PASSWORD (senza: anonimo)")
    p.add_argument("--llm", help="auto | claude | codex | compatibile (alias miia: API compatibile OpenAI, "
                                 "variabili C5_LLM_URL, C5_LLM_MODELLO, C5_LLM_CHIAVE) | regole "
                                 "(default: la variabile C5_LLM, altrimenti auto)")
    p.add_argument("--velocita", type=float, default=20, help="secondi simulati per secondo reale (0 = massimo)")
    p.add_argument("--inizio", help="ora di inizio (default dallo scenario, es. 13:00)")
    p.add_argument("--fine", help="ora di fine (default dallo scenario)")
    p.add_argument("--meteo", default="scenario", choices=["scenario", "reale"])
    p.add_argument("--gui", action="store_true", help="apre sumo-gui sulla simulazione con agenti")
    p.add_argument("--quota-assistiti", type=float, default=0.0,
                   help="quota di guidatori che segue i consigli di percorso (0-1)")
    p.add_argument("--approvazione", action="store_true", help="le decisioni aspettano l'operatore")
    p.add_argument("--senza-gemello", action="store_true", help="niente SUMO, solo orologio")
    p.add_argument("--senza-sala", action="store_true", help="niente console, dialogo stampato a righe")
    p.add_argument("--api-porta", type=int, default=8080, help="porta dell'API per OpenClaw (0 = spenta)")
    a = p.parse_args()

    scenario = json.loads((DATI / "scenario_regata.json").read_text(encoding="utf-8"))
    if a.inizio:
        scenario["inizio"] = a.inizio
    try:
        bus = crea_bus(a.broker)
    except ErroreBroker as e:  # utente o password sbagliati, broker spento: errore chiaro, niente traceback
        sys.exit(f"[bus] ERRORE: {e}")
    llm = crea_llm(a.llm)

    agenti = [
        AgenteMeteo(bus, llm, scenario, modalita=a.meteo),
        AgenteEventi(bus, llm, scenario),
        AgenteFolla(bus, llm, scenario),
        AgenteTraffico(bus, llm, scenario),
        AgenteTurismo(bus, llm, scenario),
        AgenteImprese(bus, llm, scenario),
        Orchestratore(bus, llm, scenario, approvazione=a.approvazione),
    ]
    assistenti = Assistenti(bus, llm, scenario)
    for ag in agenti:
        ag.start()
    if a.api_porta:
        avvia_api(assistenti, bus, a.api_porta)

    fermo = threading.Event()
    if a.senza_gemello:
        motore = Orologio(bus, secondi_da_ora(scenario["inizio"]), secondi_da_ora(a.fine or scenario["fine"]), a.velocita)
    else:
        from citta.gemello.gemello import Gemello

        motore = Gemello(bus, scenario, velocita=a.velocita, gui=a.gui, quota_assistiti=a.quota_assistiti, fine=a.fine)
    motore.start()
    signal.signal(signal.SIGINT, lambda *_: fermo.set())

    print(f"Napoli Agentic City · LLM: {llm.nome} · bus: {bus.descrizione} · API: "
          f"{'http://localhost:%d' % a.api_porta if a.api_porta else 'spenta'}", file=sys.stderr)

    if a.senza_sala:
        def stampa(topic, m):
            fonte = f" [{m['fonte']}]" if m.get("fonte") and m["fonte"] != "regole" else ""
            print(f"{m.get('ora', '')} {m.get('da')} → {m.get('a')}: {m.get('testo')}{fonte}", flush=True)

        bus.iscriviti("napoli/agenti/dialogo", stampa)
        while motore.is_alive() and not fermo.is_set():
            time.sleep(0.5)
    else:
        from citta.sala import Sala

        sala = Sala(bus, llm.nome)
        threading.Thread(target=lambda: (motore.join(), None), daemon=True).start()
        try:
            sala.mostra(fermo)
        except KeyboardInterrupt:
            pass

    if hasattr(motore, "ferma"):
        motore.ferma()
    kpi = bus.ultimo("napoli/kpi")
    if kpi:
        r = kpi["risparmio_pct"]
        print(f"\nKPI alle {kpi['ora']}: ore perse in coda -{r['ore_perse_in_coda']}%, durata media -{r['durata_media']}%, "
              f"CO₂ -{r['co2']}%", file=sys.stderr)
    time.sleep(1)
    os._exit(0)


if __name__ == "__main__":
    main()
