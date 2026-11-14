# Scheda Tasmota per TwinCIRO

La seconda scheda vera di TwinCIRO: un ESP32 o ESP8266 con **Tasmota** e un sensore. Non serve compilare nulla: si configura dalla **console web** di Tasmota con alcune **Rules** e **un comando `Backlog`**, e pubblica nel formato unico della città ([`../README.md`](../README.md#formato-mqtt-unico)):

- letture su `napoli/sensori/<topic>/<grandezza>` con `{"zona":"...","valore":...}`, scritte dalle Rules;
- stato `{"online":true,"ruolo":"tasmota",...}` trattenuto su `napoli/nodi/<topic>/stato`, scritto da una regola a ogni connessione;
- i topic interni di Tasmota (comandi, risposte, `SENSOR`, `STATE`, `LWT`) restano sotto `napoli/nodi/<topic>/` grazie al `FullTopic napoli/nodi/%topic%/%prefix%/`.

Sintassi di Rules, `Publish2`, `Tele-`, `FullTopic` e codici dei GPIO verificata sulla documentazione ufficiale (tasmota.github.io, novembre 2026). **Non ancora provata sulla scheda vera**: i punti da guardare sono in [Verifica](#5-verifica).

Negli esempi la scheda si chiama **`tasmota-1`** e sta alla **Rotonda Diaz** (`rotonda_diaz`). Per cambiarli, sostituisci `tasmota-1` e `rotonda_diaz` ovunque: nome utente MQTT, `Topic` e regole devono avere **lo stesso nome**, e la zona dev'essere una di quelle dello scenario ([elenco](../README.md#zone)).

## 1. Utente MQTT

Sul server, nella repo (vedi [`../README.md`](../README.md#utenti-sul-broker)):

```bash
cd cloud/mqtt && ./scripts/aggiungi-utente.sh tasmota-1     # stampa la password
```

La password va solo nella console della scheda (comando `MqttPassword`), **mai nella repo**.

## 2. Sensore e nome nel JSON

Se il sensore non è ancora configurato, assegna i GPIO (Configurazione → Modulo, oppure dalla console). Codici dei componenti dalla documentazione di Tasmota, uguali per ESP32 ed ESP8266:

| Sensore | Collegamento | Comando (esempio con un ESP32 DevKit) |
|---|---|---|
| BH1750, SHT3x, AHT2x, BME280 (I2C, 3,3 V) | SDA e SCL | `Backlog GPIO22 608; GPIO21 640` (608 = I2C SCL, 640 = I2C SDA) |
| DHT22 / AM2302 | un pin dati (pull-up 10 kΩ) | `GPIO4 1216` (AM2301) |

I sensori I2C si riconoscono da soli dopo il riavvio. Poi, dalla console:

```
Status 10
```

La risposta dice **come si chiama il sensore nel JSON** e quali campi ha, per esempio:

```json
{"StatusSNS":{"Time":"2026-11-14T18:00:00","BH1750":{"Illuminance":79}}}
{"StatusSNS":{"Time":"2026-11-14T18:00:00","SHT3X":{"Temperature":21.7,"Humidity":58.2,"DewPoint":13.1},"TempUnit":"C"}}
{"StatusSNS":{"Time":"2026-11-14T18:00:00","AHT2X-0x38":{"Temperature":24.7,"Humidity":61.9,"DewPoint":16.8},"TempUnit":"C"}}
{"StatusSNS":{"Time":"2026-11-14T18:00:00","BME280":{"Temperature":21.7,"Humidity":66.6,"DewPoint":15.1,"Pressure":988.6},"PressureUnit":"hPa","TempUnit":"C"}}
{"StatusSNS":{"Time":"2026-11-14T18:00:00","AM2301":{"Temperature":24.6,"Humidity":58.2,"DewPoint":15.9},"TempUnit":"C"}}
```

Il trigger di una regola è `Tele-<nome>#<campo>` con il nome **esattamente** come in `Status 10` (`BH1750`, `SHT3X`, `AHT2X-0x38`, `BME280`, `AM2301`...; con due sensori uguali Tasmota aggiunge un suffisso). Il prefisso `Tele-` fa scattare la regola solo all'invio periodico (`TelePeriod`), non a ogni lettura interna. Le unità devono restare quelle predefinite: gradi Celsius (`SetOption8 0`) e hPa (`SetOption24 0`).

## 3. Regole

Si scrivono **prima** del `Backlog`: il `Backlog` cambia rete e riavvia la scheda, e dopo bisogna ritrovarla sull'hotspot. Ogni regola è un comando da solo (non dentro un `Backlog`, che spezzerebbe le regole sui `;`). Il topic va scritto in chiaro (`tasmota-1`): niente `%topic%`, così la regola si legge da sola e funziona su ogni versione.

**Rule1: stato** (uguale per tutti i sensori). A ogni connessione MQTT pubblica lo stato trattenuto (`Publish2` = con retain); a ogni `TelePeriod` lo ripubblica con il segnale Wi-Fi in dBm:

```
Rule1 ON Mqtt#Connected DO Publish2 napoli/nodi/tasmota-1/stato {"online":true,"ruolo":"tasmota","zona":"rotonda_diaz","versione":"tasmota"} ENDON ON Tele-Wifi#Signal DO Publish2 napoli/nodi/tasmota-1/stato {"online":true,"ruolo":"tasmota","zona":"rotonda_diaz","versione":"tasmota","rssi":%value%} ENDON
```

**Rule2: letture.** Scegli il blocco del tuo sensore (il nome dopo `Tele-` va adattato a `Status 10`). Con due sensori diversi metti il secondo in `Rule3`.

BH1750 (luce):

```
Rule2 ON Tele-BH1750#Illuminance DO Publish napoli/sensori/tasmota-1/luce {"zona":"rotonda_diaz","valore":%value%} ENDON
```

SHT3x (temperatura e umidità):

```
Rule2 ON Tele-SHT3X#Temperature DO Publish napoli/sensori/tasmota-1/temperatura {"zona":"rotonda_diaz","valore":%value%} ENDON ON Tele-SHT3X#Humidity DO Publish napoli/sensori/tasmota-1/umidita {"zona":"rotonda_diaz","valore":%value%} ENDON
```

AHT20/AHT21/AHT25 (nome con l'indirizzo, di solito `AHT2X-0x38`):

```
Rule2 ON Tele-AHT2X-0x38#Temperature DO Publish napoli/sensori/tasmota-1/temperatura {"zona":"rotonda_diaz","valore":%value%} ENDON ON Tele-AHT2X-0x38#Humidity DO Publish napoli/sensori/tasmota-1/umidita {"zona":"rotonda_diaz","valore":%value%} ENDON
```

BME280 (temperatura, umidità, pressione; con un BMP280 togli la parte dell'umidità):

```
Rule2 ON Tele-BME280#Temperature DO Publish napoli/sensori/tasmota-1/temperatura {"zona":"rotonda_diaz","valore":%value%} ENDON ON Tele-BME280#Humidity DO Publish napoli/sensori/tasmota-1/umidita {"zona":"rotonda_diaz","valore":%value%} ENDON ON Tele-BME280#Pressure DO Publish napoli/sensori/tasmota-1/pressione {"zona":"rotonda_diaz","valore":%value%} ENDON
```

DHT22 / AM2302 (in Tasmota si chiama `AM2301`):

```
Rule2 ON Tele-AM2301#Temperature DO Publish napoli/sensori/tasmota-1/temperatura {"zona":"rotonda_diaz","valore":%value%} ENDON ON Tele-AM2301#Humidity DO Publish napoli/sensori/tasmota-1/umidita {"zona":"rotonda_diaz","valore":%value%} ENDON
```

Per rileggere una regola: `Rule1` (o `Rule2`) senza altro. Per riscriverla basta mandarla di nuovo. Le regole si accendono nel `Backlog` qui sotto (`Rule1 1; Rule2 1`).

## 4. Un comando per tutto il resto

Sostituisci `<password>` con quella di `aggiungi-utente.sh` e mandalo dalla console:

```
Backlog MqttHost twinciro.robertodisanto.it; MqttPort 1883; MqttUser tasmota-1; MqttPassword <password>; Topic tasmota-1; FullTopic napoli/nodi/%topic%/%prefix%/; TelePeriod 30; Rule1 1; Rule2 1; SSId1 iBob12; Password1 IguanaCheDaUnaCapata
```

| Comando | Perché |
|---|---|
| `MqttHost`, `MqttPort 1883` | broker del team, MQTT in chiaro (TLS spento) |
| `MqttUser tasmota-1`, `MqttPassword` | l'utente creato al punto 1 |
| `Topic tasmota-1` | **uguale all'utente**: l'ACL fa scrivere ogni utente solo sotto il proprio nome |
| `FullTopic napoli/nodi/%topic%/%prefix%/` | i topic di Tasmota diventano `napoli/nodi/tasmota-1/cmnd/...`, `.../stat/...`, `.../tele/...`: niente più `tele/...` fuori da `napoli/` |
| `TelePeriod 30` | ogni 30 s `SENSOR`, `STATE` e quindi le regole `Tele-` (10-3600 s; predefinito 300) |
| `Rule1 1; Rule2 1` | accende le regole |
| `SSId1 iBob12; Password1 IguanaCheDaUnaCapata` | hotspot del team (solo 2,4 GHz); in fondo, perché fanno ripartire la scheda |

Il `Backlog` esegue tutti i comandi e riavvia **una volta sola** alla fine. `MqttClient` resta quello predefinito (`DVES_XXXXXX`): Tasmota vuole che sia diverso da `Topic`.

**Scheda nuova, ancora senza Wi-Fi:** Tasmota apre una sua rete `tasmota-XXXXXX`; collegati col telefono, apri `http://192.168.4.1`, metti `iBob12` e la password, salva. (Il [Web Installer](https://tasmota.github.io/install/) chiede il Wi-Fi subito dopo il caricamento.) Poi trova la scheda sull'hotspot (sull'iPhone gli indirizzi sono `172.20.10.2`-`172.20.10.14`: dal portatile collegato all'hotspot `nmap -sn 172.20.10.0/28`, oppure prova gli indirizzi nel browser), apri la sua pagina → **Console** e fai i punti 2-4.

## 5. Verifica

Nella console di Tasmota, dopo il riavvio:

```
MQT: Attempting connection...
MQT: Connected
MQT: napoli/nodi/tasmota-1/tele/LWT = Online (retained)
RUL: MQTT#CONNECTED performs "Publish2 napoli/nodi/tasmota-1/stato {...}"
```

`TelePeriod` senza argomento forza subito l'invio di `STATE` e `SENSOR`, e quindi le regole: devono comparire righe `RUL: TELE-...` con il `Publish`. Sul server:

```bash
cd cloud/mqtt
MONITOR_TOPIC='napoli/#' docker compose --profile monitor run --rm monitor
```

devono arrivare `napoli/sensori/tasmota-1/<grandezza>`, `napoli/nodi/tasmota-1/stato` e i topic interni `napoli/nodi/tasmota-1/tele/SENSOR`, `.../tele/STATE`. Il formato si controlla con [`../valida-messaggi.mjs`](../valida-messaggi.mjs) (i topic interni di Tasmota vengono saltati, le letture e lo stato controllati).

Da verificare sulla scheda, perché non provato: che `Tele-Wifi#Signal` scatti e che il nome del sensore sia quello degli esempi. Sul primo punto il codice di Tasmota (ramo `development`, novembre 2026) è d'accordo: `MqttPublishTeleState()` in `support_tasmota.ino` passa `STATE` alle regole in modalità teleperiodo (`XdrvRulesProcess(1)`), e in quella modalità scattano solo i trigger con `Tele-` (`xdrv_10_rules.ino`). Con una versione vecchia di Tasmota, se non scatta, lo stato resta quello della connessione, senza `rssi`: aggiorna Tasmota dal Web Installer.

## Comandi dalla città

Con l'utente `c5` (o `admin`) si comanda la scheda sui suoi topic: `napoli/nodi/tasmota-1/cmnd/<Comando>`, risposta su `napoli/nodi/tasmota-1/stat/RESULT` (o `STATUSxx`).

```bash
mosquitto_pub -h twinciro.robertodisanto.it -u c5 -P '<password c5>' -t napoli/nodi/tasmota-1/cmnd/TelePeriod -m 10
mosquitto_pub -h twinciro.robertodisanto.it -u c5 -P '<password c5>' -t napoli/nodi/tasmota-1/cmnd/Status -m 10
```

Il topic di gruppo (`napoli/nodi/tasmotas/cmnd/...`) non è concesso dall'ACL: Tasmota prova a iscriversi e il broker lo rifiuta, senza conseguenze.

## Problemi comuni

| Sintomo | Causa probabile |
|---|---|
| `MQT: Connect failed ... rc 5` | utente o password sbagliati, oppure utente creato sul server ma con un altro nome |
| connessa, ma sul monitor non arriva nulla | `Topic` diverso da `MqttUser`: l'ACL scarta in silenzio (MQTT 3.1.1) i messaggi fuori da `napoli/.../<utente>/` |
| arrivano `tele/SENSOR` ma non `napoli/sensori/...` | regola spenta (`Rule2` risponde `"State":"OFF"`), nome del sensore diverso da `Status 10`, oppure `TelePeriod 0` |
| la scheda non vede l'hotspot | hotspot a 5 GHz: sull'iPhone "Massimizza compatibilità" |
| la zona non conta nella città | zona fuori dall'elenco dello scenario: l'agente Folla la scarta |

## Limiti

- Il **last will** di Tasmota non si può spostare su `napoli/nodi/<topic>/stato`: resta su `napoli/nodi/<topic>/tele/LWT` (`Online`/`Offline`, trattenuto). Quando la scheda sparisce, `stato` resta `online:true` e l'offline si legge da `tele/LWT` (vedi [`../README.md`](../README.md#stato)).
- Tasmota non manda `persone` (il contapersone è il badge) e nello stato non c'è l'`ip` (le regole non hanno una variabile per l'indirizzo; si legge in `napoli/nodi/<topic>/tele/STATE` o con `Status 5`).
