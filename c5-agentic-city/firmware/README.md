# Firmware ESP32 del plastico

> Gli sketch **non sono ancora stati compilati né provati su hardware**: vanno verificati in sede.

## `semaforo/`

Un ESP32 per incrocio, con due teste: **A** è la via principale, **B** la traversa. Gli incroci sono i 4 del gemello, definiti in `../dati/incroci.json`:

| `INCROCIO` | Incrocio vero | Testa A |
|---|---|---|
| `mergellina` | Viale Gramsci / via Campanella | Viale Gramsci |
| `chiaia_sanpasquale` | Riviera di Chiaia / via San Pasquale | Riviera di Chiaia |
| `chiaia_portico` | Riviera di Chiaia / via S. Maria in Portico | Riviera di Chiaia |
| `vittoria_acton` | Galleria della Vittoria / via Acton | Galleria della Vittoria |

- **Cervello**: segue `napoli/semafori/<INCROCIO>/stato`, che il gemello pubblica a ogni cambio di fase e comunque ogni 2 secondi.
- **Riflessi**: se per 5 secondi non arriva nulla passa al ciclo locale e lo segnala su `napoli/semafori/<INCROCIO>/riflesso`.
  - Il nodo con `CAPOFILA = true` trasmette in ESP-NOW la sua posizione nel ciclo.
  - Gli altri si allineano con `OFFSET_ONDA_MS` e formano un'onda verde, anche senza Wi-Fi verso il broker.
  - In demo si stacca il portatile: i semafori continuano a funzionare in modo coordinato.
- **Pulsante** (BOOT o esterno su GND): pubblica *"arriva un pullman turistico"*. Il gemello aggiunge 25 veicoli e gli agenti reagiscono.

Cablaggio di default:
- testa A: rosso 16, giallo 17, verde 18;
- testa B: rosso 19, giallo 21, verde 22.

Usare resistenze da 220–330 Ω, oppure moduli semaforo a 5 V.

## `sensore/`

Un sensore IR di passaggio (tipo FC-51) per zona. Pubblica i passaggi dell'ultimo minuto su `napoli/sensori/<NODO>/persone`. L'agente Folla moltiplica per `MOLTIPLICATORE`: sul plastico una mano o una statuina vale 200 persone.

Con il **modulo 5G/4G** si può usare TinyGSM al posto del Wi-Fi, con lo stesso MQTT. È il racconto giusto per Fastweb + Vodafone.

## Rete in sede

- **Router dedicato** (SSID `napoli-agentic`), senza dipendere dal Wi-Fi dell'evento.
- Sul portatile:
  - Mosquitto (`mosquitto -v`, porta 1883, senza password solo sulla rete dedicata);
  - `python avvia.py --broker localhost`.
- `MQTT_HOST` negli sketch = IP del portatile su quel router.

## Librerie Arduino

- Core ESP32 3.x
- PubSubClient (Nick O'Leary)
- ArduinoJson 7.x (Benoit Blanchon)

Con arduino-cli:

```bash
arduino-cli core install esp32:esp32
```

```bash
arduino-cli lib install PubSubClient ArduinoJson
```

```bash
arduino-cli compile --fqbn esp32:esp32:esp32 firmware/semaforo
```
