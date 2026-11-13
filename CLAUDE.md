# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Regole di lavoro (obbligatorie)

- **Lingua:** parla sempre in italiano con il team (risposte, commit message, commenti, documentazione).
- **Branch:** lavora solo su `master`. Niente feature branch, niente PR: commit e push direttamente su `master` (`git push origin master`). Prima di iniziare fai `git pull --rebase origin master`: siamo in 5 a pushare sullo stesso branch.

## Contesto

Repo del team per **The Big Hack 2026** (Codemotion, 40ª edizione di Futuro Remoto), Città della Scienza, Napoli, 14–15 novembre 2026. Dettagli: https://go.codemotion.com/big-hack-hackathon-2026/

Team: Roberto D'Isanto, Francesca Morra, Giovanni Di Stazio, Pasquale Criscuolo, Mario Varlese.

Vincoli che contano per le scelte tecniche:
- **Consegna: domenica 15/11 ore 12:00.** Sabato si lavora 11:00–20:30, domenica dalle 8:30. Privilegia soluzioni che arrivano a una demo funzionante, non architetture complete.
- **Criteri della giuria:** utilità/valore, aderenza alla challenge, chiarezza e completezza del progetto, design/UX, creatività/innovazione. La UX della demo pesa quanto il backend.
- Almeno 2 checkpoint con i mentor durante l'evento.

## Challenge

**Consorzio Clara (Cisco Networking Academy):** serious game educativo su networking e cybersecurity (web, mobile o chatbot). L'uso di strumenti Cisco (Packet Tracer, CML, Umbrella, Secure Endpoint, Meraki, Webex) è incoraggiato "dove possibile", non obbligatorio.

Prototipi previsti, ognuno in una sottocartella:
1. `jrpg/`: JRPG a turni red team vs blue team (in corso).
2. Tower defense (dopo il JRPG, non ancora iniziato).

## Hosting

GitHub Pages pubblica la root di `master`: https://robertod91.github.io/hackathon_2026_a/ (ogni prototipo in `/<sottocartella>/`). `index.html` in root è la pagina con i link ai prototipi: aggiornala quando ne aggiungi uno. `.nojekyll` disattiva Jekyll. Nei prototipi usa **solo percorsi relativi** (il sito non è servito dalla root del dominio) e attenzione a maiuscole/minuscole nei nomi dei file.

## `jrpg/`

Fork di [Monster Tamer](https://github.com/devshareacademy/monster-tamer) (Phaser 3.60 da CDN, JavaScript ES modules, nessuna build, nessun test).

- Avvio: dalla root della repo `python3 -m http.server 8000` e apri http://localhost:8000/jrpg/
- I contenuti sono dati, non codice: `jrpg/assets/data/*.json` (mostri, mosse, NPC/dialoghi, incontri, oggetti, mappe Tiled). Prima di toccare il codice controlla se basta cambiare i JSON.
- Le mosse in `attacks.json` riusano le animazioni esistenti (`ICE_SHARD`, `SLASH` in `src/battle/attacks/`); una nuova animazione richiede codice in `src/battle/attacks/` e caricamento in `src/scenes/preload-scene.js`.
- Flusso: `PreloadScene` carica tutti gli asset e i JSON nella cache Phaser → `TitleScene` → `WorldScene` (mappa, NPC, eventi da `events.json`/`npcs.json`) → `BattleScene` (macchina a stati in `src/utils/state-machine.js`). Lo stato di gioco persistente è in `src/utils/data-manager.js` (salvato in `localStorage` con chiave `CYBER_JRPG_DATA`).
- Tema attuale: `monsterId` 1 (`firewall`) è il blue team; gli altri sono minacce red team. Il danno è generico: non esistono ancora "tipi" né contromosse efficaci contro attacchi specifici.
- Gli asset di terze parti non sono ridistribuibili (vedi `jrpg/README.md`): da sostituire con asset CC0 o nostri prima della consegna.
