# cloud/

Servizi da installare sul server di Roberto, **twinciro.robertodisanto.it**, con Docker e **senza root** (basta un utente che possa usare Docker). Non fanno parte del sito su GitHub Pages: qui c'è solo la loro configurazione, senza segreti (password, chiavi e `.env` restano sul server e sono nel `.gitignore`).

**Riavvio completo in un comando** (spegne tutto senza toccare i dati, riavvia broker, API e città, e a ogni problema scrive COSA FARE):

```bash
cd ~/hackathon_2026_a && git pull && bash cloud/riavvia-tutto.sh
```

| Cartella | Servizio | Porte |
|---|---|---|
| [`mqtt/`](mqtt/README.md) | broker MQTT Eclipse Mosquitto 2.1.2, solo topic `napoli/` (formato unico in [`../firmware/`](../firmware/README.md#formato-mqtt-unico)): badge WHY2025 e scheda Tasmota sull'hotspot del team, città `c5-agentic-city` | 1883 (password, in chiaro); 8883 e 8884 solo con TLS acceso |
| [`citta-api/`](citta-api/README.md) | API dati città di Napoli per TwinCIRO (Node, cache, riserve dichiarate, pause dopo i 429), con nginx HTTPS in un container (profilo `https`) | 443 (HTTPS), 8791 (HTTP con token) |
| [`certificati/`](certificati/README.md) | non è un servizio: hook di certbot che l'**amministratore** installa una volta per rendere i certificati leggibili senza root | — |

Installazione rapida del broker (dettagli, utenti e TLS in [`mqtt/README.md`](mqtt/README.md)):

```bash
git clone https://github.com/RobertoD91/hackathon_2026_a.git
cd hackathon_2026_a/cloud/mqtt
./scripts/inizializza.sh           # .env (MQTT in chiaro, TLS spento), utenti di servizio
docker compose up -d
./scripts/prova.sh                 # anonimo rifiutato, formato napoli/, ACL
./scripts/aggiungi-utente.sh badge-1      # un utente per dispositivo (badge-1, tasmota-1)
```

**Sul server già attivo**, dopo `git pull`: per il broker `cd cloud/mqtt && ./scripts/ricarica.sh && docker compose up -d --remove-orphans`, poi `rimuovi-utente.sh` per `ponte` e `c5-plastico` se esistono e `./scripts/prova.sh` (dettagli in [`mqtt/README.md`](mqtt/README.md#aggiornare-il-server-già-attivo)); per l'API vedi [`citta-api/README.md`](citta-api/README.md). Mai `docker compose down -v`.

Ogni servizio nuovo va in una sottocartella con il suo `compose.yaml` e il suo README, e una riga nella tabella qui sopra.
