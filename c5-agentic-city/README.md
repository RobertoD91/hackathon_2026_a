# C5 — Napoli Agentic City

Challenge 05 di The Big Hack 2026, promossa da **Fastweb + Vodafone**: *"Napoli Agentic City: la città che Ci pensa"*.

## Il brief (in sintesi)

- Un **sistema di agenti AI che collaborano**: ognuno segue un servizio o un problema (mobilità, turismo, servizi pubblici, ambiente) e un **agente orchestratore** li coordina, mette insieme le informazioni e propone risposte anche quando la situazione cambia.
- **Problema e target li scegliamo noi.** Esempi di problema: una giornata con regata dell'America's Cup, partita e navi da crociera insieme, oppure un guasto alla metro. Esempi di target: turista, cittadino che deve raggiungere un ufficio pubblico, operatore della sala operativa comunale.
- Bonus: agenti come **assistenti personali** che suggeriscono, anticipano esigenze e facilitano prenotazioni e acquisti, con nuove opportunità per le imprese del territorio.
- **Dati**: open data di Comune e Regione, trasporto pubblico, ISTAT, mappe, meteo. Dove mancano si usano **simulazioni realistiche spiegando le ipotesi**.
- **Consegna**: prototipo, demo o simulazione di uno scenario concreto in cui **si vede come gli agenti si coordinano e reagiscono ai cambiamenti**. Bastano pochi servizi.
- **Per vincere**: visione, originalità e concretezza, con **benefici tangibili e possibilmente misurabili** (meno attese, meno congestione, informazioni più tempestive, decisioni più rapide, nuovi servizi). Spiegare perché Napoli dovrebbe adottarla.
- Premio: 2.500 € in buoni Amazon al primo team.

## Direzione

- **Niente webapp**: un sistema agentico nel mondo fisico, con sensori IoT (ESP32) e droni.
- Per l'eventuale proxy o worker serve un Cloudflare Worker **nuovo** (non `mbl-privato`).

## Decisioni aperte

- Scenario e target
- Runtime degli agenti (OpenClaw o simili, oppure un orchestratore nostro) e canale verso gli utenti
- Hardware disponibile: modelli di ESP32, sensori, display, droni
