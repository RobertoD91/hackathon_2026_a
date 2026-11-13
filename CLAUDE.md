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

**Non ancora scelta.** Quando il team comunica la challenge, aggiorna questa sezione (e il README) con: descrizione, dataset/risorse fornite, stack scelto.

## Stato del codice

La repo è vuota (solo README e `.gitignore`). Quando viene scelto lo stack, aggiungi qui i comandi reali per installare, avviare, testare (incluso il singolo test) e l'architettura ad alto livello.
