# cloud/

Servizi da installare sul server di Roberto, **twinciro.robertodisanto.it**, con Docker e **senza root** (basta un utente che possa usare Docker). Non fanno parte del sito su GitHub Pages: qui c'è solo la loro configurazione, senza segreti (password, chiavi e `.env` restano sul server e sono nel `.gitignore`).

| Cartella | Servizio | Porte |
|---|---|---|
| [`mqtt/`](mqtt/README.md) | broker MQTT Eclipse Mosquitto 2.1.2: badge, ESP32, Tasmota, ponte MQTT → hub, c5-agentic-city | 1883 (password, in chiaro); 8883 e 8884 solo con TLS acceso |
| [`citta-api/`](citta-api/README.md) | API dati città di Napoli per CiroGPT (Node, cache, riserve dichiarate, pause dopo i 429), con nginx HTTPS in un container (profilo `https`) | 443 (HTTPS), 8791 (HTTP con token) |
| [`certificati/`](certificati/README.md) | non è un servizio: hook di certbot che l'**amministratore** installa una volta per rendere i certificati leggibili senza root | — |

Installazione rapida del broker (dettagli, utenti e TLS in [`mqtt/README.md`](mqtt/README.md)):

```bash
git clone https://github.com/RobertoD91/hackathon_2026_a.git
cd hackathon_2026_a/cloud/mqtt
./scripts/inizializza.sh           # .env (MQTT in chiaro, TLS spento), utenti di servizio
docker compose up -d
./scripts/prova.sh                 # anonimo rifiutato, ACL, MQTT
```

Ogni servizio nuovo va in una sottocartella con il suo `compose.yaml` e il suo README, e una riga nella tabella qui sopra.
