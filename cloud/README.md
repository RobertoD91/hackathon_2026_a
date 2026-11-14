# cloud/

Servizi da installare sul server di Roberto, **twinciro.robertodisanto.it**, con Docker. Non fanno parte del sito su GitHub Pages: qui c'è solo la loro configurazione, senza segreti (password, chiavi e `.env` restano sul server e sono nel `.gitignore`).

| Cartella | Servizio | Porte |
|---|---|---|
| [`mqtt/`](mqtt/README.md) | broker MQTT Eclipse Mosquitto 2.1.2: badge, ESP32, Tasmota, ponte MQTT → hub, c5-agentic-city, dashboard nel browser | 1883 (password), 8883 (TLS), 8884 (WebSocket TLS) |
| [`citta-api/`](citta-api/README.md) | API dati città di Napoli per CiroGPT (Node, cache, riserve dichiarate, pause dopo i 429) | 8791 (HTTP con token; HTTPS consigliato via nginx) |

Installazione rapida del broker (dettagli, utenti e TLS in [`mqtt/README.md`](mqtt/README.md)):

```bash
git clone https://github.com/RobertoD91/hackathon_2026_a.git
cd hackathon_2026_a/cloud/mqtt
sudo ./scripts/inizializza.sh      # .env, controllo dei certificati Let's Encrypt, utenti di servizio
docker compose up -d
./scripts/prova.sh                 # anonimo rifiutato, ACL, MQTT, TLS, WebSocket
```

Ogni servizio nuovo va in una sottocartella con il suo `compose.yaml` e il suo README, e una riga nella tabella qui sopra.
