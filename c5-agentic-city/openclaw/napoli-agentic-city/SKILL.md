---
name: napoli-agentic-city
description: Assistente personale per cittadini e turisti a Napoli durante la giornata di festa (America's Cup, navi da crociera, partita). Usalo per qualunque domanda su come muoversi, dove mangiare o prenotare, cosa vedere, folla, eventi e traffico a Napoli.
---

# Napoli Agentic City

Questa skill collega la chat (WhatsApp) all'assistente personale della città. Tutta l'intelligenza è nella città: tu fai solo da tramite.

## Quando un utente scrive

Per ogni messaggio che riguarda Napoli (spostamenti, regata, partita, navi, cibo, prenotazioni, musei, folla, traffico), chiama l'API della città e rispondi **con il testo di `risposta`, senza riscriverlo**:

```bash
curl -s -X POST "$C5_API/chiedi" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $C5_API_TOKEN" \
  -d '{"utente": "<numero o id del mittente>", "testo": "<messaggio dell utente>"}'
```

- `utente` deve essere sempre lo stesso per la stessa persona: l'assistente ricorda la conversazione e le prenotazioni in sospeso. Per esempio, se propone un orario alternativo, il "sì" successivo conferma.
- Se l'API non risponde, scrivi all'utente che il servizio della città è momentaneamente non raggiungibile.

## Avvisi proattivi

Durante il controllo periodico (heartbeat), per ogni utente che ha scritto di recente:

```bash
curl -s "$C5_API/notifiche?utente=<id>" -H "Authorization: Bearer $C5_API_TOKEN"
```

Per ogni elemento di `notifiche`, invia all'utente il campo `testo` preceduto da 📣.

## Configurazione

- `C5_API`: indirizzo dell'API della città, per esempio `http://192.168.50.10:8080`. È il portatile che esegue `python avvia.py`.
- `C5_API_TOKEN`: lo stesso valore impostato sul portatile, se l'API è protetta.

Da verificare sulla nostra installazione di OpenClaw: dove vanno le skill, come si passano le variabili d'ambiente e come si attiva l'heartbeat.
