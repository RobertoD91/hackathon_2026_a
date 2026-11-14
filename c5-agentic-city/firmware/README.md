# Firmware ESP32 di TwinCiro

> Un solo firmware, **`twinciro-nodo/`**, per tutti i nodi del plastico. Compila per ESP32, ESP32-S3 ed ESP32-C3 (core esp32 3.3.12, WiFiManager 2.0.17, PubSubClient 2.8, ArduinoJson 7.4.3). **Non è ancora stato provato su hardware.**

## Installarlo senza compilare: flasher web

https://robertodisanto.it/hackathon_2026_a/c5-agentic-city/flasher/

Serve Chrome o Edge su computer, con l'ESP32 collegato via USB. La pagina riconosce il chip e installa il binario giusto.

I binari si compilano **solo a richiesta** con GitHub Actions:
1. **Actions → Firmware TwinCiro → Run workflow** (oppure `gh workflow run firmware-twinciro.yml`).
2. L'action compila per i tre chip e mette i binari in `c5-agentic-city/flasher/firmware/` su `master`.
3. Poi rilancia il deploy di GitHub Pages.

Dopo circa 10 minuti il flasher ha la nuova versione.

## Configurazione dopo il flash

Al primo avvio il nodo apre la rete **`TwinCiro-XXXXXX`** (password `twinciro`). Collegati col telefono: nel portale (`192.168.4.1`) scegli il Wi-Fi e compila i campi:

| Campo | Semaforo | Sensore |
|---|---|---|
| Ruolo | `semaforo` | `sensore` |
| Id | incrocio: `mergellina`, `chiaia_sanpasquale`, `chiaia_portico`, `vittoria_acton` | nome libero, es. `varco_rotonda` |
| Zona | (non serve) | `mergellina`, `rotonda_diaz`, `piazza_vittoria`, `castel_ovo`, `municipio`, `beverello`, `vomero` |
| Broker MQTT | IP del portatile (porta 1883, senza utente) oppure il broker del team con utente e password | uguale |
| Capofila / ritardo onda | `1` su un solo semaforo; ritardi 0, 6000, 12000, 18000 ms | (non serve) |
| Persone per passaggio | (non serve) | 200 |

Per **riconfigurare** ci sono due modi:
- tieni premuto **BOOT per 3 secondi**;
- scrivi `portale` sul monitor seriale (115200 baud).

Sempre dal monitor seriale: `reset` cancella tutto, `stato` mostra la configurazione.

## Cosa fa

- **Semaforo**:
  - segue `napoli/semafori/<id>/stato` (`{"a":"verde","b":"rosso"}`), che il gemello pubblica a ogni cambio e comunque ogni 2 secondi;
  - se per 5 secondi non arriva nulla passa ai **riflessi**: ciclo locale, segnalato su `napoli/semafori/<id>/riflesso`;
  - in riflesso il capofila trasmette in **ESP-NOW** la sua posizione nel ciclo e gli altri si allineano col proprio ritardo: è l'onda verde senza rete;
  - pressione breve del pulsante: pubblica "arriva un pullman turistico" su `napoli/eventi/manuale`.
- **Sensore**: conta i passaggi davanti a un sensore IR (tipo FC-51, uscita LOW al passaggio). Ogni 2 secondi pubblica su `napoli/sensori/<id>/persone` i passaggi dell'ultimo minuto: `{"zona", "valore", "moltiplicatore"}`.
- **Entrambi**: stato su `napoli/nodi/<id>/stato` (retained, con last will `{"online":false}`) con ruolo, IP, RSSI e versione.

Il broker del team su `cloud.robertodisanto.it` (`cloud/mqtt/`) vuole utente e password: il firmware li supporta, ma senza TLS, quindi sulla porta 1883.

## Pin di default

| Scheda | Testa A (R, G, V) | Testa B (R, G, V) | Sensore IR | Pulsante | LED |
|---|---|---|---|---|---|
| ESP32 (DevKit) | 16, 17, 18 | 19, 21, 22 | 34 | 0 (BOOT) | 2 |
| ESP32-S3 | 4, 5, 6 | 7, 15, 16 | 1 | 0 (BOOT) | 2 |
| ESP32-C3 | 2, 3, 4 | 5, 6, 7 | 10 | 9 (BOOT) | 8 |

Usa resistenze da 220–330 Ω verso GND, oppure moduli semaforo da 5 V.

## Compilare in locale

```bash
arduino-cli config add board_manager.additional_urls https://espressif.github.io/arduino-esp32/package_esp32_index.json
```

```bash
arduino-cli core install esp32:esp32@3.3.12
```

```bash
arduino-cli lib install "WiFiManager@2.0.17" "PubSubClient@2.8" "ArduinoJson@7.4.3"
```

```bash
arduino-cli compile --fqbn esp32:esp32:esp32 c5-agentic-city/firmware/twinciro-nodo
```

## Rete in sede

- Router dedicato al plastico.
- Sul portatile `docker compose up -d` (in `c5-agentic-city/`): Mosquitto sulla porta 1883 e città.
- Nel portale dei nodi metti l'IP del portatile come broker.
