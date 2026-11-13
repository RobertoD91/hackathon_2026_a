# Napoli Agentic City: agenti + gemello SUMO + API, in un'unica immagine.
# Il broker MQTT (Mosquitto) è un servizio a parte in compose.yaml.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app

# Librerie di sistema che servono ai binari di SUMO del pacchetto pip (anche senza interfaccia grafica)
RUN apt-get update && apt-get install -y --no-install-recommends \
        libx11-6 libxext6 libxrender1 libgl1 libatomic1 libexpat1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY avvia.py ./
COPY citta ./citta
COPY dati ./dati
COPY strumenti ./strumenti

EXPOSE 8080
# Default: tutto in un processo, bus in memoria, senza console (per la console: compose, servizio "sala").
CMD ["python", "avvia.py", "--senza-sala"]
