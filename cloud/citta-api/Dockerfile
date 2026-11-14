# API dati città di Napoli (shared/citta-api) per twinciro.robertodisanto.it.
# Contesto di build: la RADICE della repo (compose.yaml: context ../..). Il file
# Dockerfile.dockerignore accanto a questo limita il contesto ai soli file che servono.
# Nessuna dipendenza npm: solo Node e il codice della repo, copiato così com'è.
#
#   docker compose build          (da cloud/citta-api/)
#   docker build -f cloud/citta-api/Dockerfile -t bighack/citta-api .   (dalla radice della repo)

# Stessa immagine del ponte MQTT in cloud/mqtt/ (versione fissata).
FROM node:22.23.5-alpine

ENV NODE_ENV=production \
    TZ=Europe/Rome
WORKDIR /app

# Codice condiviso con la mappa "Napoli in tempo reale" (fonti, luoghi, simulatore, script degli
# snapshot): stessi file della repo, stessi percorsi relativi.
COPY shared/iot-agents/package.json shared/iot-agents/
COPY shared/iot-agents/example/fonti/ shared/iot-agents/example/fonti/
COPY shared/iot-agents/example/luoghi.js shared/iot-agents/example/sim-config.json shared/iot-agents/example/
COPY shared/iot-agents/example/dati/ shared/iot-agents/example/dati/
COPY shared/iot-agents/sim/sim-core.js shared/iot-agents/sim/
COPY shared/iot-agents/tools/aggiorna-dati-napoli.js shared/iot-agents/tools/zip-mini.js shared/iot-agents/tools/parquet-mini.js shared/iot-agents/tools/
COPY shared/citta-api/ shared/citta-api/

# /dati: snapshot di lavoro (volume). Un volume nuovo si riempie con questi file e diventa
# dell'utente node; all'avvio l'API rimette quelli della repo se sono più recenti.
RUN mkdir -p /dati && cp shared/iot-agents/example/dati/*.json /dati/ && chown -R node:node /dati

USER node
ENV PORT=8791 \
    CITTA_DATI=/dati \
    CITTA_DATI_INIZIALI=/app/shared/iot-agents/example/dati
EXPOSE 8791
VOLUME ["/dati"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/salute" || exit 1

CMD ["node", "shared/citta-api/server.js"]
