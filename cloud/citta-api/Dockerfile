# API dati città di Napoli (citta-api/) per twinciro.robertodisanto.it.
# Contesto di build: la RADICE della repo (compose.yaml: context ../..). Il file
# Dockerfile.dockerignore accanto a questo limita il contesto alla sola cartella citta-api/
# (test esclusi). L'API è autonoma: fonti, luoghi, simulatore della folla, snapshot e script di
# rigenerazione stanno tutti in citta-api/. Nessuna dipendenza npm: solo Node e il codice.
#
#   docker compose build          (da cloud/citta-api/)
#   docker build -f cloud/citta-api/Dockerfile -t bighack/citta-api .   (dalla radice della repo)

FROM node:22.23.5-alpine

ENV NODE_ENV=production \
    TZ=Europe/Rome
WORKDIR /app

# Stesso percorso che nella repo (/app/citta-api/...): i comandi sono uguali dentro e fuori dal
# container, per esempio `node citta-api/aggiorna.js --solo eventi`.
COPY citta-api/ citta-api/

# /dati: snapshot di lavoro (volume). Un volume nuovo si riempie con questi file e diventa
# dell'utente node; all'avvio l'API rimette quelli della repo se sono più recenti.
RUN mkdir -p /dati && cp citta-api/dati/*.json /dati/ && chown -R node:node /dati

USER node
ENV PORT=8791 \
    CITTA_DATI=/dati \
    CITTA_DATI_INIZIALI=/app/citta-api/dati
EXPOSE 8791
VOLUME ["/dati"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/salute" || exit 1

CMD ["node", "citta-api/server.js"]
