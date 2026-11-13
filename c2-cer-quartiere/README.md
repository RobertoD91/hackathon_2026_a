# `c2-cer-quartiere`: CER Rione Sole

**Challenge 02** (Meditech / Federico II, "Modelli di sostenibilità assistiti da intelligenza artificiale"), ambito energia.

È una comunità energetica rinnovabile (CER) di un isolato di Napoli Est: tre scale, tre impianti fotovoltaici (18 kWp) e dieci famiglie. I dati del quartiere sono di fantasia ma plausibili. Su ogni tetto c'è un ESP32 con un sensore di luce e uno di temperatura. Dodici agenti coordinano le case per consumare il sole dei tetti **nella stessa ora in cui viene prodotto**: è l'energia che il GSE incentiva. Le famiglie ricevono i consigli su WhatsApp, per esempio *"Fai partire la lavastoviglie alle 11:00: tra un'ora c'è sole sul tetto della scala A"*. La dashboard confronta in diretta **con agenti e senza agenti** sulla stessa giornata.

- Dashboard con hub: `node c2-cer-quartiere/server.js`, poi apri http://localhost:8703/
- Demo statica, senza backend: https://robertodisanto.it/hackathon_2026_a/c2-cer-quartiere/

## A chi serve e cosa cambia

Oggi in un condominio con i pannelli il sole arriva a mezzogiorno, ma le famiglie consumano la sera. Il sole va in rete, e la sera l'energia si compra a prezzo pieno. Con le regole CER (DM 414/2023) lo Stato paga una **tariffa premio sull'energia condivisa**, cioè quella prodotta e consumata nella stessa ora dai membri. Per farla crescere bisogna coordinare le persone, ed è quello che fanno gli agenti.

| Chi | Cosa ottiene |
|---|---|
| **Famiglie del condominio** | Al mattino un messaggio WhatsApp con il programma, poi un promemoria un'ora prima. Possono dire di no e l'agente rispetta la scelta. In cambio hanno una quota dell'incentivo e, con un'offerta a prezzo orario, una bolletta più bassa. Possono chiedere in chat *"quando conviene caricare l'auto?"*. |
| **Referente o amministratore della CER** | Un cruscotto con l'energia condivisa, l'incentivo maturato e la sua distribuzione tra le famiglie (indice di equità). Sono gli stessi numeri che servono per il GSE e per l'assemblea. |
| **Comune e associazioni** | Un modello replicabile per ogni isolato: basta un sensore da pochi euro per tetto. Misura CO₂ ed equità, quindi è utile contro la povertà energetica (le famiglie fragili hanno priorità negli avvisi). |

**Cosa cambia:** la CER smette di essere un contratto passivo e diventa una comunità che si coordina, a turno e in modo equo, senza chiedere sacrifici. Si cambia solo l'orario degli elettrodomestici.

## Come si misurano i benefici

L'agente comunità tiene **due conti in parallelo sulla stessa giornata**. Luce e temperatura sono le stesse (arrivano dagli ESP32), le famiglie e i consumi fissi anche.

- **Senza agenti:** ogni elettrodomestico parte all'ora abituale della famiglia.
- **Con agenti:** parte all'ora proposta, se la famiglia l'ha accettata; altrimenti all'ora abituale.

Gli indicatori:

| KPI | Come si calcola |
|---|---|
| Energia condivisa (kWh autoconsumati nella CER) | per ogni **ora** (regola GSE): min(energia prodotta dai tetti, energia consumata dalle famiglie), sommato sulle ore |
| Quota condivisa | energia condivisa ÷ energia prodotta |
| Euro | kWh condivisi × (tariffa premio + restituzione ARERA), più il risparmio in bolletta per chi ha un'offerta a prezzo orario. Il risparmio conta solo per i carichi già finiti: a metà giornata non si confronta la lavatrice di mezzogiorno con quella che si farebbe stasera. |
| CO₂ evitata | kWh condivisi × fattore ISPRA dei consumi elettrici: i consumi coperti dal sole nella stessa ora valgono zero emissioni, il resto ha il mix di rete. È un indicatore di contemporaneità, non una riduzione garantita delle emissioni nazionali. |
| Equità | indice di Jain sulla quota dei consumi di ogni famiglia coperta dal sole del quartiere (1 = uguale per tutti) |

Risultato di una giornata simulata (novembre, cielo sereno con una nuvola a mezzogiorno, un'auto elettrica attaccata alle 7:30; `npm run giornata`):

| | senza agenti | con agenti | differenza |
|---|---|---|---|
| quota di energia condivisa | 51% | 86% | **+35 punti** |
| energia condivisa | 30,5 kWh | 51,2 kWh | **+20,7 kWh** |
| incentivo + bolletta | | | **+3,63 €/giorno** (2,67 incentivo + 0,96 bolletta) |
| CO₂ evitata | 7,2 kg | 12,0 kg | **+4,9 kg** |
| equità (Jain) | 0,71 | 0,88 | |

Su un anno, "se ogni giorno fosse come oggi", fanno circa 7.500 kWh, 1.300 € e 1,8 t di CO₂ per la CER. È solo un ordine di grandezza: la dashboard lo mostra dopo il tramonto e lo dichiara come stima grezza.

## Ipotesi e fonti dei parametri

Tutti i numeri sono in [`model/parametri.js`](model/parametri.js), ognuno con `fonte` e `stato`. La dashboard li mostra nella sezione "Parametri e fonti".

| Parametro | Valore | Fonte | Stato |
|---|---|---|---|
| Tariffa premio | 0,12 €/kWh | DM MASE 414/2023 e regole GSE: impianti ≤ 200 kW, 80 €/MWh + max(0; 180 − Pz), tetto 120 €/MWh; FV al Sud senza maggiorazione | indicativo, dipende dal prezzo zonale Pz |
| Restituzione ARERA | 0,009 €/kWh | ARERA TIAD (del. 727/2022), ordine di 8-10 €/MWh in BT | indicativo |
| Fattore di emissione | 0,2347 kg CO₂/kWh | ISPRA, Rapporto 413/2025, Tab. 1.3, consumi elettrici 2023 (prelim. 2024: 198,9 g) | dato pubblicato |
| PUN orario | profilo 95-165 €/MWh | forma tipica GME di un giorno feriale d'autunno, arrotondata | indicativo |
| Perdite, spread | 10,2%, 0,015 €/kWh | ARERA; offerte PUN-indicizzate | indicativo |
| Luce → irraggiamento | 60 lux per W/m² | efficacia luminosa del sole 110-120 lm/W, sensore dietro un diffusore che dimezza | da tarare |
| Performance ratio | 0,85 | valore tipico FV residenziale | indicativo |
| Pompa di calore, split | 0,05 kW/°C sotto 19 °C, 0,12 kW/°C sopra 26 °C | stime nostre (COP ≈ 3, EER ≈ 3) | indicativo |

Le altre ipotesi sono in [`model/quartiere.js`](model/quartiere.js) e [`model/energia.js`](model/energia.js):

- **Famiglie.** Profili orari di consumo tarati su 2.000-2.700 kWh/anno, carichi spostabili (lavatrice 1 kWh, lavastoviglie 1,1 kWh, scaldabagno 3 kWh, auto 9 kWh) con abitudini e finestre di accettazione. La propensione `adesione` simula le persone che dicono di no.
- **Sole.** Modello astronomico semplificato (alba e tramonto entro pochi minuti dalle effemeridi di Napoli) e fattore nuvole di Kasten e Czeplak.
- **Configurazione dei pannelli.** Gli impianti sono condominiali e immettono tutto in rete (configurazione CER "virtuale"): non c'è autoconsumo fisico dietro al contatore.

## Come funziona

```
 ESP32 sui tetti (luce, temperatura) ─┐
 simulatore (sim-config.json)        ─┴─ POST /api/readings ─► agente produzione ── previsione ──┐
                                                                                                    ▼
 10 agenti casa ── carichi e preferenze ──────────────────────────────────────────► agente comunità (orchestrator)
       ▲   └── WhatsApp alla famiglia (notify) ◄── accetta / rifiuta ◄── proposta ──────┘   │ bilancio con/senza
       └──────────────────────────────────────────────────────────────────────────────────┘  │ cer.stato ogni secondo
                                                                                                ▼
                                            dashboard (SSE) · OpenClaw (GET /api/notifications, POST /api/chat)
```

| Agente | Cosa fa |
|---|---|
| `produzione` | Converte la luce di ogni tetto in kW. Prevede la produzione del giorno come sole a cielo sereno × fattore nuvole: da **Open-Meteo** (copertura oraria) se raggiungibile, altrimenti simulato (cielo sereno), sempre dichiarato. Corregge la previsione con i sensori (nowcast): se la luce crolla rileva la **nuvola** e avvisa subito la comunità. Un ESP32 vero ha la precedenza sul simulato della stessa zona. |
| `casa-<famiglia>` (10) | Conosce i carichi spostabili, le abitudini e le finestre della famiglia. Manda le richieste del giorno, valuta le proposte (fuori finestra dice no, e a volte la famiglia rifiuta), scrive il programma su WhatsApp e manda il promemoria un'ora prima. Con l'ondata di calore propone il pre-raffrescamento, con l'auto attaccata chiede la ricarica. |
| `orchestrator` (agente comunità) | Ottimizza ([`model/ottimizzatore.js`](model/ottimizzatore.js)) partendo dal sole libero previsto. Le famiglie sono servite **a turno** (prima chi ha avuto meno sole, a parità le famiglie fragili). Propone un cambio solo se vale almeno 0,3 kWh di sole o 0,15 € di bolletta. Ripianifica per meteo, nuovi carichi e ogni ora. Tiene il bilancio ([`model/bilancio.js`](model/bilancio.js)), avvisa il gruppo (nuvola, caldo, riepilogo serale) e risponde in chat. |

Gli agenti funzionano **senza LLM**: regole e un ottimizzatore goloso spiegabile. Con un LLM vero (`LLM_PROVIDER`) vengono riformulati i testi WhatsApp e le risposte della chat, sempre con il testo deterministico come `fallback`.

Scenari dalla dashboard (e nella timeline della giornata simulata):

| Scenario | Cosa succede | Reazione degli agenti |
|---|---|---|
| **Passa una nuvola** | La luce sui tetti cala del 70-80% per circa un'ora e mezza simulata | La produzione la vede dai dati e non dal pulsante. Gli agenti abbassano la previsione, ripianificano i carichi non ancora partiti, avvisano il gruppo e mandano alle famiglie il "cambio di programma". |
| **Ondata di calore** | +13 °C sui sensori | Partono i climatizzatori. Le case con lo split propongono il pre-raffrescamento nelle ore di sole; il gruppo e le famiglie fragili ricevono un avviso. |
| **Auto elettrica in carica** | La famiglia Sorrentino attacca un'auto: 10 kWh entro le 18-19 | Senza agenti caricherebbe subito a piena potenza. Con gli agenti la wallbox aspetta il piano e segue il sole libero. |

## Avvio

### Con il hub (porta 8703)

```bash
node c2-cer-quartiere/server.js                 # hub + 12 agenti + simulatore dei tre tetti
# apri http://localhost:8703/   (reindirizza a /c2-cer-quartiere/)
```

La giornata simulata va dalle 6 alle 24 a velocità ×216: un'ora ogni 17 secondi, la giornata intera in 5 minuti, poi ricomincia. Alle 7:30 un'auto elettrica viene attaccata, a mezzogiorno passa una nuvola.

Variabili d'ambiente:

| Variabile | Effetto |
|---|---|
| `PORT` | porta (predefinita 8703) |
| `PREVISIONE` | `auto` (predefinita: Open-Meteo se raggiungibile), `open-meteo`, `simulata` |
| `LUX_GAIN` | `esp32-tetto-b=40,...`: moltiplica la luce di un ESP32 vero, per una demo al chiuso |
| `LLM_PROVIDER`, `ANTHROPIC_API_KEY`, ... | come in [`shared/iot-agents`](../shared/iot-agents/README.md#collegare-un-llm-vero); predefinito `mock` |
| `HUB_TOKEN` | token per le POST (facoltativo) |

Con `--no-sim` il hub parte senza simulatore e i dati arrivano solo dagli ESP32 o da `shared/iot-agents/sim/simulate.js --config c2-cer-quartiere/sim-config.json --target http://localhost:8703`.

### Demo statica (GitHub Pages)

```bash
python3 -m http.server 8713      # dalla root della repo
# apri http://localhost:8713/c2-cer-quartiere/
```

Senza backend, simulatore e agenti (lo stesso codice) girano nel browser. Parametri dell'URL:

| Parametro | Effetto |
|---|---|
| `?demo=1` | forza la demo |
| `?previsione=simulata` | non chiama Open-Meteo |
| `?famiglia=russo` | apre la chat di quella famiglia |
| `?tema=scuro` | tema scuro (di norma segue il sistema) |
| `?api=http://host:8703` | usa un hub su un altro indirizzo |

### Copione della demo (5 minuti)

1. **All'alba** gli agenti casa mandano i carichi e l'agente comunità fa il piano del mattino. Nella colonna "Agenti al lavoro" si vedono proposte, sì e no; nel telefono il messaggio del mattino alla famiglia.
2. **Alle 7:30** la famiglia Sorrentino attacca l'auto. Con l'interruttore "senza agenti" sulla mappa si vede che caricherebbe subito dalla rete.
3. **A mezzogiorno** passa la nuvola: c'è l'avviso al gruppo e la ripianificazione. Si può rilanciare a mano dai pulsanti.
4. **Nel telefono** si chiede *"Quando conviene caricare l'auto?"*.
5. **Al tramonto** compaiono la proiezione annua e, alle 21, il riepilogo nel gruppo WhatsApp.
6. **In ogni momento** i KPI in alto mostrano con e senza agenti, e il pannello famiglie chi ci guadagna e chi ha detto no.

## Test

```bash
cd c2-cer-quartiere && npm test           # oppure: node --test "c2-cer-quartiere/test/*.test.js"
npm run giornata                          # stampa i KPI di una giornata intera accelerata (30 s)
```

29 test `node:test`:

- **Modello:** conversione luce → kW, effemeridi, fattore nuvole, consumi realistici, energia dei carichi conservata.
- **Ottimizzatore:** sposta verso il sole, rispetta le finestre, non pianifica nel passato, divisibili entro la potenza, round robin equo, il sole non si conta due volte, soglia per cambiare un piano già accettato, spostamento per prezzo.
- **Bilancio:** minimo orario secondo la regola GSE, ripartizione per famiglia che somma al totale, KPI ed euro.
- **Agenti:** una giornata intera accelerata con nucleo e simulatore veri; con gli agenti l'energia condivisa cresce di oltre 8 kWh e la quota di oltre 10 punti. Si verificano anche nuvola rilevata e sereno, rifiuti, WhatsApp con orari e promemoria, riepilogo serale, chat, Open-Meteo (con `fetch` finto: riuscito e fallito), ESP32 vero con precedenza e `LUX_GAIN`.

## ESP32 (firmware di `shared/iot-agents`)

Il firmware è quello di [`shared/iot-agents/firmware/esp32-sensor/`](../shared/iot-agents/firmware/esp32-sensor/README.md), invariato. Per C2, in `config.h`, un ESP32 per tetto:

```c
#define HUB_URL         "http://<ip-del-pc>:8703"
#define DEVICE_ID       "esp32-tetto-b"        // esp32-tetto-a / -b / -c
#define LOCATION_LAT    40.8444
#define LOCATION_LON    14.2959
#define LOCATION_ZONE   "scala-b"              // scala-a / scala-b / scala-c: lega il sensore al tetto
#define TEMP_SENSOR     TEMP_DS18B20           // o TEMP_DHT22
#define LIGHT_SENSOR    LIGHT_BH1750
#define SEND_INTERVAL_MS 5000
```

La zona decide il tetto, non il nome: un ESP32 vero in `scala-b` sostituisce il simulato di quella zona finché scrive (fino a 30 s dall'ultima lettura).

**Dove si mette fisicamente:**

- **Sensore di luce (BH1750).** Sul tetto, accanto ai pannelli, con la **stessa inclinazione e orientamento** (per esempio fissato al telaio di un modulo), rivolto verso il cielo. Non deve avere ombre diverse da quelle dei pannelli. Va in una scatola IP65 con il coperchio trasparente. Il BH1750 in alta risoluzione satura intorno a 55.000 lux e il sole pieno ne dà 100.000: mettilo dietro un **diffusore** (plastica opalina) che dimezza la lettura. È la conversione predefinita di 60 lux per W/m². Tara `luxPerWm2` del tetto in `model/quartiere.js` confrontando una giornata serena con i kW dell'inverter.
- **Sensore di temperatura.** All'ombra e all'aria, per esempio sotto i pannelli o in uno schermo antiradiazione. Serve la temperatura dell'aria, che guida riscaldamento e climatizzatori, non quella del pannello.
- **Alimentazione e rete.** Un alimentatore 5 V dal vano tecnico del tetto, Wi-Fi del condominio o un router 5G (`NET_LABEL "5g"`).

**Demo al chiuso:** con la luce della sala (300-1.000 lux) il tetto produrrebbe quasi zero. Avvia il server con `LUX_GAIN=esp32-tetto-b=40`: coprire il sensore con la mano diventa una nuvola, la torcia del telefono diventa il sole. La dashboard mostra "ESP32 vero" sul tetto.

Prova senza scheda:

```bash
curl -X POST http://localhost:8703/api/readings -H 'content-type: application/json' \
  -d '{"deviceId":"esp32-tetto-b","location":{"lat":40.8444,"lon":14.2959,"zone":"scala-b"},"readings":{"temperature_c":21.5,"light_lux":800},"meta":{"fw":"0.1.0","net":"5g","simulated":false}}'
```

## LLM e OpenClaw (WhatsApp)

- **LLM.** Con `LLM_PROVIDER=anthropic ANTHROPIC_API_KEY=... node c2-cer-quartiere/server.js` vengono riformulati i messaggi WhatsApp delle case e le risposte della chat. Il prompt vieta di cambiare orari e numeri, e il testo a regole resta come `fallback`. In demo statica c'è solo `mock`.
- **OpenClaw**, come da [contratto](../shared/iot-agents/CONTRATTO.md), sezione 5:
  - **In uscita** fa polling di `GET /api/notifications?since=<next>&channel=whatsapp`. I destinatari sono `famiglia-<id>` (es. `famiglia-russo`) e il gruppo `cer-rione-sole`: OpenClaw li associa ai numeri veri.
  - **In entrata** inoltra i messaggi a `POST /api/chat` con `from`. Se `from` è `famiglia-<id>`, la risposta è personalizzata per quella famiglia; altrimenti è generica.
  - Prova senza OpenClaw:

    ```bash
    node shared/iot-agents/tools/openclaw-bridge-sim.js --target http://localhost:8703 --from famiglia-russo --say "quando faccio la lavatrice?"
    node shared/iot-agents/tools/openclaw-bridge-sim.js --target http://localhost:8703 --listen 60
    ```

## File

| File | Contenuto |
|---|---|
| `server.js` | hub su 8703, agenti, simulatore, variabili d'ambiente |
| `sim-config.json` | tre tetti (luce + temperatura), giornata accelerata, timeline, scenari |
| `agents/` | `produzione.js`, `casa.js`, `comunita.js` (orchestratore), `index.js` |
| `model/` | `parametri.js` (con fonti), `quartiere.js` (tetti, famiglie, carichi), `energia.js`, `tetti.js`, `ottimizzatore.js`, `bilancio.js`: logica pura e isomorfa |
| `index.html`, `app.js`, `style.css` | dashboard (live e demo) |
| `test/` | test `node:test` e `giornata.js` (giornata accelerata riusabile) |

## Limiti

- **Quartiere e consumi simulati.** Le famiglie, le abitudini e i consumi sono modelli: non ci sono contatori veri. Il passo successivo è leggere i consumi dai contatori 2G (Chain 2) o da prese smart.
- **Sensori.** Solo luce e temperatura: la produzione è stimata dalla luce con una conversione da tarare, non letta dall'inverter.
- **Parametri economici indicativi.** Il PUN è un profilo tipico, la tariffa premio è al tetto, e il risparmio in bolletta vale solo con un'offerta a prezzo orario: con la monoraria il beneficio è solo l'incentivo. La ripartizione dell'incentivo tra le famiglie (proporzionale ai consumi nelle ore condivise) è un'ipotesi: nella realtà la decide lo statuto della CER.
- **Previsione semplice.** Open-Meteo dà la copertura oraria di oggi a Napoli. La giornata simulata è serena con una nuvola, quindi previsione reale e sensori possono non coincidere: il nowcast dei sensori corregge le ore successive. Con `PREVISIONE=simulata` la demo è del tutto deterministica. Dal sandbox, Open-Meteo ha risposto anche con `429` (troppe richieste): in quel caso si passa alla previsione simulata e lo si dichiara.
- **Ottimizzatore goloso.** È spiegabile e veloce, non ottimo in senso stretto. La giornata va dalle 6 alle 24: i carichi notturni non sono modellati.
- **Firmware non compilato su scheda** (vedi il suo README). Lo stato del hub è in memoria.
- **Asset.** Nessun asset di terze parti: icone e disegni sono SVG scritti a mano.
