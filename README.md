# TwinCiro

**Napoli che ci pensa**: un gemello digitale della città e un assistente su WhatsApp, **CiroGPT**, che fa parlare tra loro gli agenti della città, i cittadini, i turisti e le imprese.

Progetto per [The Big Hack 2026](https://go.codemotion.com/big-hack-hackathon-2026/) (Codemotion × Futuro Remoto), Città della Scienza, Napoli, 14–15 novembre 2026. Challenge 05 **Fastweb + Vodafone**, *"Napoli Agentic City: la città che Ci pensa"*.

## Team

- Roberto D'Isanto
- Mario Varlese

## Cosa c'è

| | Dove |
|---|---|
| **TwinCiro**: agenti della città, assistenti personali, gemello SUMO, API per CiroGPT, video | [`c5-agentic-city/`](c5-agentic-city/README.md) |
| **Skill di CiroGPT** (OpenClaw): città e fonti aperte di Napoli | [`c5-agentic-city/openclaw/skills/`](c5-agentic-city/openclaw/skills/README.md) |
| **Flasher web** dei nodi ESP32 (semaforo o sensore) | [robertodisanto.it/hackathon_2026_a/c5-agentic-city/flasher/](https://robertodisanto.it/hackathon_2026_a/c5-agentic-city/flasher/) |
| Mappa "Napoli in tempo reale" con dati veri (meteo, aria, trasporti, eventi, allerta) | [`shared/iot-agents/example/`](https://robertodisanto.it/hackathon_2026_a/shared/iot-agents/example/) |
| **API dati città** per CiroGPT (meteo, aria, allerta, trasporti, eventi, con fonte e ora di ogni dato) | [`shared/citta-api/`](shared/citta-api/README.md), Docker in [`cloud/citta-api/`](cloud/citta-api/README.md) |
| **Video di consegna** (bozza di 2:54, copione e riprese da girare) | [`c5-video/`](c5-video/README.md) |
| Catalogo verificato delle fonti dati di Napoli | [`docs/fonti-dati-napoli.md`](docs/fonti-dati-napoli.md) |
| Broker MQTT del team (Docker) | [`cloud/mqtt/`](cloud/mqtt/README.md) |

Altri prototipi nati durante l'hackathon, fuori dalla consegna: [`c2-cer-quartiere/`](c2-cer-quartiere/) (comunità energetica, riserva), [`c1-feed-simulato/`](c1-feed-simulato/), [`c4-jrpg/`](c4-jrpg/) (ora seguito da un altro gruppo).

Pagina con tutti i prototipi online: https://robertodisanto.it/hackathon_2026_a/

## Avvio rapido di TwinCiro

```bash
cd c5-agentic-city && docker compose up -d        # broker MQTT + città + API su :8080
```

```bash
docker compose run --rm sala                      # sala operativa nel terminale
```

Senza Docker, e le altre opzioni, nel [README di TwinCiro](c5-agentic-city/README.md#come-si-avvia).

## Scadenze

- Sabato 14/11: lavori dalle 11:00 alle 20:30.
- Domenica 15/11: ripresa alle 8:30, **consegna alle 12:00** (video di massimo 3 minuti), giuria dalle 14:00 alle 15:30, premiazione alle 16:00.
