# TwinCIRO

**Napoli che ci pensa**: un gemello digitale della città e un assistente su WhatsApp, **TwinCIRO**, che fa parlare tra loro gli agenti della città, i cittadini, i turisti e le imprese. *Twin* è il gemello digitale; *CIRO* sta per City Intelligence & Responsive Orchestration.

Progetto per [The Big Hack 2026](https://go.codemotion.com/big-hack-hackathon-2026/) (Codemotion × Futuro Remoto), Città della Scienza, Napoli, 14–15 novembre 2026. Challenge 05 **Fastweb + Vodafone**, *"Napoli Agentic City: la città che Ci pensa"*.

> **Oltre 50 fonti pubbliche, verificate una per una**: i dati di Napoli (meteo, aria, allerte, trasporti, eventi, turismo, territorio), con licenza, limiti ed esito delle prove: **[`docs/fonti-dati-napoli.md`](docs/fonti-dati-napoli.md)**

## Team

- Roberto D'Isanto
- Mario Varlese

## TwinCIRO in breve

- **TwinCIRO su WhatsApp** (agente OpenClaw) è il centro: risponde a cittadini e turisti con dati veri, chiede agli agenti della città, negozia con le imprese (una pizzeria piena propone un altro orario) e avvisa per primo quando una zona si riempie.
- **Gli agenti della città** (Python, bus MQTT) si coordinano con un orchestratore; il **gemello digitale** mostra la giornata della regata in 3D.
- **I dati veri** (meteo, aria, allerte, trasporti, eventi) arrivano da fonti pubbliche di Napoli, scelte nel catalogo di oltre 50 fonti verificate una per una, e TwinCIRO li riceve da una sola API con cache, fonte e ora di ogni dato.
- **Due dispositivi veri**, il badge Cyber Saiyan WHY2025 e una scheda Tasmota, mandano alla città conteggi e misure sul campo.
- **LLM a scelta, anche italiano:** gli agenti ragionano con Claude, con Codex o con qualsiasi LLM che ha un'API compatibile con OpenAI, come MIIA di Fastweb + Vodafone ([FastwebMIIA-7B su Hugging Face](https://huggingface.co/Fastweb/FastwebMIIA-7B), [come si collega](c5-agentic-city/README.md#llm)); senza LLM decidono le regole. L'integrazione è pronta e provata con server compatibili, non ancora con MIIA.

**Percorso della demo:** badge WHY2025 e scheda Tasmota → MQTT `napoli/...` sul server `twinciro.robertodisanto.it` → città Python ([`c5-agentic-city/`](c5-agentic-city/README.md)) → TwinCIRO su WhatsApp, che prende i dati veri da [`citta-api/`](citta-api/README.md).

## Cartelle

| Cartella | Cosa c'è | Reale o vetrina |
|---|---|---|
| [`c5-agentic-city/`](c5-agentic-city/README.md) | la città agentica: agenti, assistenti personali, API per TwinCIRO su WhatsApp, gemello digitale, [visore](https://robertodisanto.it/hackathon_2026_a/c5-agentic-city/visore3d/) e video 3D della regata, [skill di TwinCIRO](c5-agentic-city/openclaw/skills/README.md) | reale; folla, traffico e offerte delle imprese sono simulati e dichiarati |
| [`citta-api/`](citta-api/README.md) | API dati città, il cervello dati di TwinCIRO: fonti, snapshot, rigenerazione, test | reale (solo la folla stimata è simulata, e lo dice) |
| [`firmware/`](firmware/README.md) | badge WHY2025 e scheda Tasmota, hotspot del team, formato MQTT unico `napoli/...` | reale (hardware ancora da provare sul posto) |
| [`cloud/`](cloud/README.md) | broker MQTT e API dati città in Docker sul server, senza root | reale, attivi su `twinciro.robertodisanto.it` |
| [`c5-presentazione/`](c5-presentazione/README.md) | video di consegna, copione, scene e la [mappa "Napoli in tempo reale"](https://robertodisanto.it/hackathon_2026_a/c5-presentazione/mappa/) | vetrina: nella mappa folla e sensori sono simulati, meteo, aria, trasporti, eventi e allerte sono veri |
| [`docs/`](docs/) | [challenge e regole](docs/hackathon.md), [diario e richieste tra le sessioni](docs/stato-e-strumenti.md), [le fonti, oltre 50 pubbliche e verificate](docs/fonti-dati-napoli.md), [brainstorming](docs/brainstorming.md) (storico) | documentazione |
| [`tools/`](tools/) | `flux-gen.sh`: immagini con FLUX | strumento |

Pagina con i link online: https://robertodisanto.it/hackathon_2026_a/

## Avvio rapido

La città, dalla cartella `c5-agentic-city/`:

```bash
docker compose up -d                           # broker MQTT locale, agenti, gemello, API per TwinCIRO su :8080
docker compose run --rm sala                   # sala operativa nel terminale
```

API dati città e mappa, dalla radice della repo:

```bash
node citta-api/server.js                       # API dati città su :8791 (test: node --test citta-api/test/)
python3 -m http.server 8000                    # mappa su http://localhost:8000/c5-presentazione/mappa/
```

Senza Docker, e le altre opzioni della città, nel [README della città](c5-agentic-city/README.md#come-si-avvia). Server, broker e utenti dei dispositivi: [`cloud/`](cloud/README.md) e [`firmware/`](firmware/README.md).

## Scadenze

- Sabato 14/11: lavori dalle 11:00 alle 20:30.
- Domenica 15/11: ripresa alle 8:30, **consegna alle 12:00** (video di massimo 3 minuti), giuria dalle 14:00 alle 15:30, premiazione alle 16:00.
