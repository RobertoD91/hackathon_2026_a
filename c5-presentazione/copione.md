# Copione del video di consegna · TwinCIRO (C5) · v3

**Durata: 2:54,5** (limite di Roberto 2:55) · 16 scene · 1920×1080 · 30 fps · in italiano · sottotitoli impressi · **due voci: Roberto e Mario**.

**Al centro c'è TwinCIRO su WhatsApp**, come hanno chiesto Fastweb e Vodafone il 14/11: la chat del turista è la scena più lunga (38 s) e, subito dopo, l'operatore della Polizia Locale approva proprio l'avviso che Marta ha ricevuto. TwinCIRO torna in quasi tutte le altre scene (titolo, le sue fonti, i due utenti, l'architettura dietro di lui, la sua risposta con i dati di adesso, il suo avviso nel gemello, la chiusura). L'IoT (badge WHY2025 e scheda Tasmota, sensori fatti da noi) e il gemello digitale con la regata 3D servono da prove di concretezza. **Traffico e semafori** (non piaciuti ai partner) restano in una riga dei benefici: la scena SUMO non c'è più.

La challenge chiede anche **benefici misurabili** e **perché Napoli dovrebbe adottarla**: stanno nella scena 14, con i numeri già verificati, le loro ipotesi e la dichiarazione che vengono da simulazione o demo.

Questo file è la versione da leggere di [`scene/scaletta.json`](scene/scaletta.json), che è quella usata dal montaggio: se cambi un tempo o un testo, cambialo lì e qui. I testi della voce scena per scena, con chi li legge e i nomi dei file da registrare, li scrive il montaggio in [`voce/`](voce/COPIONE-VOCE.md).

## Il racconto in una riga

Napoli 2027, un sabato con l'America's Cup: chi guida la folla? I dati della città ci sono ma sono sparsi, e manca il più importante, le persone. TwinCIRO li mette insieme. Una crocerista gli scrive su WhatsApp: TwinCIRO negozia con la pizzeria, la porta alla regata, usa i dati veri e la avvisa quando la Rotonda Diaz si riempie; quell'avviso lo approva la Polizia Locale. Dietro c'è un sistema multi-agente, con i dati veri di oltre 50 fonti pubbliche e i sensori fatti da noi. Con Fastweb + Vodafone la folla si può misurare, i sensori vanno sulla rete mobile e il cervello può essere MIIA. Si chiude con i benefici, il perché Napoli e l'invito a provarlo.

## Scene

| # | Tempo | Durata | Cosa si vede | Voce |
|---|---|---|---|---|
| 1 | 0:00–0:08 | 8 s | **Il gancio.** Regata 3D del gemello digitale (`regata_3d.mp4` da 0:05, ritagliata con Mergellina), con il velo sul vecchio titolo e sui riquadri dei KPI. Testata: *Napoli 2027 · scenario simulato. Tre grandi eventi lo stesso sabato: chi guida la folla?* | Roberto, Mario |
| 2 | 0:08–0:19 | 11 s | `motivazione.html`: «I dati ci sono. Ma sono sparsi.» Le fonti pubbliche del catalogo come isole (logo ufficiale o nome, formato), collegamenti che si interrompono; poi «E manca il dato più importante»: le persone per zona, che in Italia non è un dato pubblico | Roberto, Mario |
| 3 | 0:19–0:26 | 7 s | `titolo.html`: **TwinCIRO**; CIRO si apre in *City Intelligence & Responsive Orchestration*, Twin = *gemello digitale*; motto *Napoli che ci pensa*. Solo la scritta, nessun logo | Roberto, Mario |
| 4 | 0:26–0:34 | 8 s | `fonti.html`: le isole convergono in un muro per tema intorno a TwinCIRO; il contatore arriva a 55 *nel catalogo* e compare *Oltre 50 fonti pubbliche, verificate una per una*. Per scelta di Roberto la pagina **non dice quante sono già collegate** all'API: i punti di dati verso TwinCIRO partono solo da quelle, senza numeri né evidenze. TIM Big Data (Milano 2013) resta nel catalogo ma non in scena | Roberto, Mario |
| 5 | 0:34–0:40 | 6 s | `utenti.html`: due utenti. *Chi visita*: Marta, crocerista, scrive a TwinCIRO su WhatsApp. *Chi governa*: l'operatore della Polizia Locale, in sala operativa | Roberto |
| 6 | 0:40–1:18 | 38 s | **Il turista.** A sinistra il telefono con la chat di Marta: la ripresa vera se c'è `girato/chat.mp4`, altrimenti la chat ricostruita con le risposte vere dell'API. A destra il passo del racconto e «dietro le quinte», i messaggi tra gli agenti (quelli lunghi accorciati alla frase sulla zona dell'avviso). Risposte di TwinCIRO a 6,4 · 11,7 · 18,0 · 24,2 · 29,7 s della scena; l'avviso resta a schermo 8 s | Mario, Roberto (7 battute) |
| 7 | 1:18–1:32 | 14 s | `operatore.html`: **chi governa.** La dashboard (mappa in modalità demo: KPI, avvisi meteo, mappa; *folla e sensori simulati*, *allerte, meteo, eventi veri*), accanto la proposta D4 delle 14:41 degli agenti con *Approva / Blocca*, approvata dall'operatore con `POST /operatore`: parte lo stesso avviso della chat, «anche a Marta». Poi la stessa decisione nella sala nel terminale | Roberto, Mario |
| 8 | 1:32–1:43 | 11 s | `architettura.html`: **Un sistema multi-agente.** Persone → TwinCIRO (agente OpenClaw). Da TwinCIRO due strade: l'API della città → orchestratore e sei agenti specializzati, che si parlano sul bus MQTT `napoli/#` con sensori fatti da noi, drone, gemello e sala operativa; e l'API dati città, che legge le fonti pubbliche (*oltre 50 fonti pubbliche, verificate una per una*) | Mario, Roberto |
| 9 | 1:43–1:48,5 | 5,5 s | `grafo.html` (tempi accorciati con `?durata=5.5`): *Napoli come rete di relazioni* il giorno della regata (83 nodi, 196 relazioni, a strati: luoghi, eventi e flussi, stazioni e imprese, agenti, sensori *in prova* e fonti), ricavata dai dati e dal codice del repository. Pagina navigabile: [`grafo/`](grafo/) | Mario |
| 10 | 1:48,5–1:57,5 | 9 s | `adesso.html`: **Napoli adesso**, sabato 14/11/2026 alle 19:30, con i dati veri dell'API dati città (meteo, allerte, eventi, treni, aria, Campi Flegrei, tangenziale), ognuno con fonte e stato; i pannelli si accendono mentre la voce li nomina (la scena finisce prima della risposta su Città della Scienza) | Mario, Roberto |
| 11 | 1:57,5–2:05,5 | 8 s | **Sensori fatti da noi.** Le riprese vere `girato/badge.mp4` e `girato/tasmota.mp4` (quelle che ci sono si dividono la scena, con la testata). Se mancano tutte e due, il cartello con la **foto vera** dei dispositivi sul tavolo (`scene/foto/dispositivi.jpg`): la pagina di Tasmota sulla scheda ESP32 mostra il DHT11 a 21,1 °C e 91% di umidità, davanti c'è il badge; accanto badge WHY2025 (*firmware nostro*) e scheda Tasmota (*regole nostre*), *Oggi: hotspot Wi-Fi*, *Domani: SIM IoT*. La didascalia dice solo quello che si vede | Mario, Roberto |
| 12 | 2:05,5–2:14,5 | 9 s | **Il gemello digitale.** Regata 3D (`regata_3d.mp4` da 0:58, cioè 14:33–14:42 simulate): la Rotonda Diaz a circa 20.600 persone; alle 14:37 parte l'avviso vero della simulazione e compare la notifica di TwinCIRO con l'avviso della chat; poi Piazza Vittoria sale da circa 1.500 a 3.300. Testata: *Gemello digitale · Regata simulata sulle strade vere: le colonne sono le persone per zona* | Mario, Roberto |
| 13 | 2:14,5–2:30,5 | 16 s | `fastweb.html`: *Tre passi con Fastweb + Vodafone*: le persone (analytics di rete: la folla, oggi simulata, si può misurare), sensori sulla rete (SIM IoT, esempio Walter), AI italiana e sovranità digitale (TwinCIRO *può integrare* MIIA; *FastwebMIIA-7B su Hugging Face*, licenza non commerciale, per le prove). Riga finale *TwinCIRO · Challenge 05 di Fastweb + Vodafone*. Solo testo, nessun logo | Mario, Roberto |
| 14 | 2:30,5–2:41,5 | 11 s | Cartello in due colonne. **Cosa cambia**, con i numeri e le loro ipotesi: ≈ 1.900 persone spostate da un avviso quando la zona si riempie (stima dell'agente Turismo, adesione ipotizzata) · tavolo negoziato e prenotato con un «ok», senza telefonate · offerte solo dove c'è posto · −9% di ore in coda in media su 4 giornate simulate. **Perché Napoli**: nessuna app nuova · i dati ci sono già · America's Cup 2027 · si parte da un quartiere | Roberto, Mario |
| 15 | 2:41,5–2:46,5 | 5 s | **È tutto vero.** Tre riquadri: la schermata vera del gruppo WhatsApp della demo (TwinCIRO saluta la giuria; nel gruppo l'account si chiama «Jarvis»), la foto vera dei dispositivi, *oltre 50 fonti pubbliche, verificate una per una* (`scene/foto/`) | Roberto |
| 16 | 2:46,5–2:54,5 | 8 s | Chiusura con la foto di Roberto e Mario davanti al pannello di The Big Hack (`scene/foto/squadra.jpg`): **TwinCIRO**, *Napoli che ci pensa*, «💬 Il link al gruppo WhatsApp con TwinCIRO è nella pagina dell'hackathon», Roberto D'Isanto · Mario Varlese, The Big Hack 2026 · Challenge 05 Fastweb + Vodafone, robertodisanto.it/hackathon_2026_a | Roberto, Mario |

Le dissolvenze sono brevi (0,2 s attraverso il nero). Il video si apre dal nero in 0,6 s e si chiude nel nero in 1 s. Nessun logo di Fastweb, Vodafone, WhatsApp o Polizia Locale: solo testo (le icone delle fonti nelle scene 2, 4 e 9 sono quelle ufficiali dei loro siti).

## Voce fuori campo (da leggere)

Due voci, **Roberto** e **Mario**, che si alternano: 37 battute, circa 1:14 di parlato per Roberto e 1:19 per Mario. Ritmo: circa **150 parole al minuto** dentro ogni battuta, contando le sigle come si pronunciano; nessuna battuta si sovrappone (controllo: `./monta.sh --solo-testi`). Tono: caldo, sicuro, senza fretta. Tempi, durata disponibile e nome del file di ogni battuta: [`voce/COPIONE-VOCE.md`](voce/COPIONE-VOCE.md) (lo riscrive il montaggio).

Pronuncia (è anche in `voce/COPIONE-VOCE.md`): *TwinCIRO* = «tuìn cìro»; *WHY2025* = «uài duemilaventicinque»; *Wi-Fi* = «uài fai»; *MQTT* = «emme cu ti ti»; *IoT* = «ai o ti»; *API* = «a pi i»; *SIM* = «sim»; *AI* = «a i» (sempre allo stesso modo); *America's Cup* = «amèrica's cap»; *Diaz* = «dìaz»; *Flegrei* = «flegrèi»; il titolo in inglese = «sìti intèlligens end rispònsiv orchestrèiscion»; *alle 13… le 14* = «alle tredici… le quattordici». *MIIA*: nel dubbio «emme i i a»; **da confermare con i mentor di Fastweb prima di registrare** (è il nome del loro modello: se lo dicono come una parola, usate la loro pronuncia).

**1 · Il gancio (0:00)**
> ROBERTO: Napoli, 2027.
> MARIO: Un sabato: America's Cup, navi da crociera e partita al Maradona.

**2 · I dati ci sono, ma sparsi (0:08)**
> ROBERTO: I dati ci sono. Ma sono sparsi, e non si parlano.
> MARIO: E manca il dato più importante: quante persone ci sono, adesso, in ogni zona.

**3 · TwinCIRO (0:19)**
> ROBERTO: TwinCIRO: City Intelligence and Responsive Orchestration.
> MARIO: Il gemello di Napoli, che ci pensa.

**4 · Le fonti (0:26)**
> ROBERTO: Oltre 50 fonti pubbliche, verificate una per una.
> MARIO: Un catalogo unico, diviso per temi.

*Di proposito non dice quante fonti sono già collegate all'API e non dice che TwinCIRO le usa tutte: il catalogo (`docs/fonti-dati-napoli.md`) ha per ogni fonte licenza ed esito della verifica.*

**5 · Due utenti (0:34)**
> ROBERTO: Due utenti: chi visita Napoli, e chi la governa.

**6 · Il turista: la chat di Marta (0:40)**, una battuta per passo, *aspettando che compaia il messaggio*:
> (0:40,5) MARIO: Marta, in crociera, scrive a TwinCIRO come a un amico.
> (0:44,3) ROBERTO: TwinCIRO chiede alla pizzeria: alle 13 è piena, propone le 14.
> (0:49,2) MARIO: Marta dice «ok»: tavolo prenotato, nessuna telefonata.
> (0:54,9) ROBERTO: Poi TwinCIRO le dice come arrivare alla regata, e quanta gente c'è.
> (1:01,3) MARIO: Per il meteo usa dati veri, e cita sempre la fonte.
> (1:06,5) ROBERTO: E quando la Rotonda Diaz si riempie, è TwinCIRO a scrivere per primo:
> (1:10,8) ROBERTO: c'è un posto più tranquillo, con un'offerta.

*Le ultime due sono una frase sola divisa in due sottotitoli: Roberto le registra di seguito, in due file (`06-chat-6` e `06-chat-7`). La battuta del meteo descrive la chat ricostruita: su WhatsApp vero vale quando la skill `napoli-citta-dati` è caricata su TwinCIRO (vedi R1).*

**7 · Chi governa: la Polizia Locale (1:18)**
> ROBERTO: Quell'avviso passa dalla Polizia Locale, in sala operativa.
> MARIO: Gli agenti propongono: l'operatore approva, o blocca.
> ROBERTO: Nel terminale della sala, la stessa decisione: l'avviso è partito.

**8 · Un sistema multi-agente (1:32)**
> MARIO: Dietro TwinCIRO c'è un sistema multi-agente: agenti specializzati e un orchestratore.
> ROBERTO: Si parlano su MQTT; le fonti pubbliche arrivano dall'API dati città.

**9 · La città come rete (1:43)**
> MARIO: Ecco la città come rete: luoghi, eventi, flussi, stazioni.

**10 · Napoli adesso (1:48,5)**
> MARIO: Questa è Napoli adesso: dati veri, ognuno con la sua fonte.
> ROBERTO: Allerte, treni, aria e Campi Flegrei, con l'ora del dato.

*La battuta dei pannelli vale con qualsiasi cattura (`node c5-presentazione/scene/oggi/cattura.mjs`): di proposito non cita livelli di allerta. La cattura delle 19:30 del 14/11 è di prima della correzione dell'API: il pannello mostra Meteoalarm (temporali arancione il 15/11) ma non l'avviso n. 94 della Protezione Civile (gialla dal 15/11 alle 06:00), che la cattura non ha. Con una cattura nuova il pannello lo mostra.*

**11 · Sensori fatti da noi (1:57,5)**
> MARIO: Sensori fatti da noi: badge WHY2025 e Tasmota.
> ROBERTO: Oggi in Wi-Fi, domani con una SIM IoT.

*Frase prudente di proposito: il firmware del badge è compilato e provato sul PC ma non ancora su un badge vero (`firmware/why2025-badge/README.md`), e le regole di Tasmota sono da provare sulla scheda. Finché le riprese R2 e R3 non mostrano un dispositivo che pubblica davvero, il video usa il cartello con la foto vera (Tasmota sulla scheda ESP32 legge un DHT11: è quello che si vede) e la voce non dice «misurano» o «pubblicano»; nemmeno il cartello dice che le letture arrivano via MQTT alla città, perché non è ancora verificato. Con le riprese si può dire, nello stesso tempo: «Il badge e la scheda Tasmota pubblicano sul bus degli agenti.»*

**12 · Il gemello digitale (2:05,5)**
> MARIO: Il gemello digitale prova la giornata sulle strade vere.
> ROBERTO: E l'avviso di TwinCIRO arriva quando la Rotonda Diaz si riempie.

**13 · Con Fastweb + Vodafone (2:14,5)**
> MARIO: Con Fastweb e Vodafone la folla non si simula più: si può misurare.
> ROBERTO: Con le loro SIM IoT, i sensori si mettono dove servono.
> MARIO: E TwinCIRO può integrare MIIA, l'AI italiana di Fastweb: sovranità digitale.

*«Può integrare»: l'adattatore compatibile con OpenAI della città (`C5_LLM=compatibile`, alias `miia`) è provato con un server di prova e con llama.cpp, non ancora con MIIA (licenza non commerciale su Hugging Face; per la produzione l'offerta FastwebAI Suite). Dettagli nel README di `c5-agentic-city`, sezione «LLM».*

**14 · Cosa cambia e perché Napoli (2:30,5)**
> ROBERTO: Con un'adesione ipotizzata, un avviso sposta circa 1.900 persone.
> MARIO: Perché Napoli? Nessuna app nuova, i dati ci sono già, e si parte da un quartiere.

*Gli altri numeri del cartello restano a schermo senza voce, ognuno con la sua fonte (il −9% di ore in coda è l'unico punto del video sul traffico).*

**15 · È tutto vero (2:41,5)**
> ROBERTO: È tutto vero: le fonti, i sensori e il gruppo WhatsApp con TwinCIRO.

*Le prove sono a schermo: la schermata vera del gruppo, la foto vera dei dispositivi, il catalogo delle fonti (`docs/fonti-dati-napoli.md`).*

**16 · Chiusura (2:46,5)**
> ROBERTO: TwinCIRO. Napoli che ci pensa.
> MARIO: Il link al gruppo WhatsApp è nella pagina dell'hackathon.

## Riprese da girare

Metti i file in [`girato/`](girato/LEGGIMI.md) con questi nomi esatti, poi lancia `./monta.sh`. Tutto orizzontale 1920×1080 tranne il telefono. Luce frontale, niente controluce verso le vetrate, telefono e portatile con la luminosità al massimo. Per vedere dove andranno le riprese mancanti: `./monta.sh --segnaposto` (cartelli «Qui va una ripresa reale» al posto delle riserve). **Precedenza: R4 (voci) e R1 (chat vera) prima di R2 e R3.**

### R1 · `girato/chat.mp4`: la chat WhatsApp vera con il contatto TwinCIRO (la più importante)

Sostituisce la chat ricostruita della scena 6. Il telefono vero va al posto di quello disegnato, e a destra resta il pannello «dietro le quinte». È la prova più forte che il video può dare: bastano anche 2-3 passi veri.

- **Cosa:** registrazione dello schermo del telefono (iPhone: Centro di Controllo → Registra schermo; Android: Registra schermo dalle impostazioni rapide), verticale, nella chat o nel gruppo WhatsApp con TwinCIRO.
- **Prima di registrare:** il contatto dell'agente deve chiamarsi **TwinCIRO** (se si chiama ancora con il vecchio nome, rinominalo). Carica su OpenClaw le skill aggiornate (`napoli-citta-dati` compresa) e controlla che l'heartbeat legga `/notifiche` (richieste aperte in `docs/stato-e-strumenti.md`). Modalità Non disturbare (niente notifiche di altre chat sullo schermo), batteria e ora pulite, carattere di WhatsApp a grandezza media, sfondo della chat semplice. Nel gruppo cancella o scorri via i messaggi vecchi. Se nel gruppo ci sono numeri di persone che non vogliono comparire, usa un gruppo nuovo solo con te e TwinCIRO.
- **La città:** perché le risposte siano quelle del racconto, avvia l'API come per la chat ricostruita, partendo alle 12:10 con la giornata accelerata:
  `cd c5-agentic-city && python avvia.py --llm regole --senza-sala --senza-gemello --inizio 12:10 --velocita 30 --api-porta 8080`
  Con `--llm claude` (e la chiave) le risposte sono più naturali, ma vanno ricontrollate: la pizzeria deve dire pieno alle 13:00 e posto alle 14:00. Se la città gira da più di 2 minuti, riavviala: alle 12:30 simulate le 13:00 non sono più «future».
- **Il testo:** la skill `twinciro-citta` inoltra la risposta dell'API **senza riscriverla**, quindi su WhatsApp escono gli stessi testi della chat ricostruita (vedi «Problemi noti» nel README).
- **Cosa scrivere**, uno alla volta, aspettando la risposta (testi in [`scene/chat_domande.json`](scene/chat_domande.json)):
  1. `Ciao Ciro! Siamo 4 croceristi: vogliamo prenotare in una pizzeria vicino al Castel dell'Ovo alle 13:00 🍕`
  2. `Ok, va bene!`
  3. `Poi vogliamo andare a vedere la regata alla Rotonda Diaz: come si arriva?`
  4. `Ci serve l'ombrello?` (risponde la skill `napoli-citta-dati`, che prende meteo e allerta dall'API dati città, se è caricata su TwinCIRO; se non lo è, salta questa domanda e cambia la battuta del meteo, per esempio «TwinCIRO può leggere meteo e treni dall'API dati città, con la fonte»)
  5. Poi **aspetta l'avviso**: arriva da solo dopo le 14:00 simulate, cioè circa 5 minuti reali dopo l'avvio, se l'heartbeat di OpenClaw interroga `/notifiche`. Se l'heartbeat non c'è ancora, scrivi `Com'è la situazione alla Rotonda Diaz?` dopo le 14:30 simulate, e cambia la battuta: «E se la Rotonda Diaz si riempie, TwinCIRO propone un posto più tranquillo, con un'offerta.»
- **Durata:** la registrazione sarà lunga qualche minuto. Non serve tagliarla a mano: annota in `scene/scaletta.json`, nella scena `06-chat`, i pezzi da tenere. Per esempio `"girato": { "file": "chat", "modo": "telefono", "pezzi": [[2, 11], [20, 26], [40, 46], [62, 68], [300, 311]] }` tiene 9 + 6 + 6 + 6 + 11 = 38 s. In totale i pezzi devono fare **38 s**: se sono di meno, l'ultimo fotogramma resta fermo. Il pannello a destra (passi e «dietro le quinte») e la voce seguono i tempi della chat ricostruita, quindi scegli i pezzi in modo che le risposte di TwinCIRO compaiano vicino a questi secondi della scena: pizzeria 6,4 s, conferma 11,7 s, percorso 18,0 s, meteo 24,2 s, avviso 29,7 s (i messaggi di Marta circa 3 s prima). L'avviso deve restare a schermo fino alla fine (8 s). Se non ci riesci, riallinea i tempi della voce della scena 6.
- **Ritmo:** scrivi con calma (si vede la tastiera) e lascia ogni risposta sullo schermo 4–5 secondi prima di scrivere la successiva.

I due dispositivi si collegano all'hotspot del telefono di Roberto (rete e configurazione in [`firmware/README.md`](../firmware/README.md)) e pubblicano sul broker di `twinciro.robertodisanto.it` nel formato unico della città: `napoli/sensori/<id>/<grandezza>` con `{"zona": "<zona>", "valore": <numero>}` e lo stato trattenuto su `napoli/nodi/<id>/stato`. Per vederli arrivare dal portatile: `mosquitto_sub -h twinciro.robertodisanto.it -u <utente> -P <password> -t 'napoli/#' -v` (utente in sola lettura, per esempio `monitor`). **Niente a schermo** di password, token o IP privati: lancia il comando prima di registrare e inquadra solo i messaggi.

### R2 · `girato/badge.mp4`: il badge WHY2025 (4 s, oppure 8 s se manca la ripresa di Tasmota)

- **Inquadratura:** primo piano orizzontale, con la mano che tiene il badge a 30–40 cm; il sensore I2C collegato si deve vedere. Sfondo scuro e pulito, telefono su un appoggio o treppiede.
- **Azione:** la schermata SENSORI del badge con i valori (luce, temperatura, umidità) e lo stato della connessione, poi uno spostamento lento verso il portatile, dove la stessa lettura arriva su `napoli/sensori/<id>/...` nel terminale con `mosquitto_sub`. Se ci sono tutte e due le riprese, della scena 11 se ne usano 4 s ciascuna (i primi 4 s di ogni file, oppure da `"da"`): metti all'inizio la parte migliore.
- **Prima di girare:** controlla che il badge sia davvero online (`napoli/nodi/<id>/stato` con `"online": true`). Se non pubblica, non girare finte letture: resta il cartello.

### R3 · `girato/tasmota.mp4`: la scheda Tasmota (4 s, oppure 8 s se manca la ripresa del badge)

- **Inquadratura:** la scheda accesa con il suo sensore, ferma e ben illuminata (telefono sul treppiede), poi lo schermo del portatile con i suoi messaggi `napoli/sensori/<id>/...` che arrivano. Va bene anche solo lo schermo: carattere del terminale di almeno 20 pt, tema scuro.
- In alternativa, la console web di Tasmota con la riga della regola che pubblica nel formato `napoli/` (senza mostrare la pagina con la password del Wi-Fi o di MQTT).

Con una ripresa vera nella scena 11 compare la testata *Sensori fatti da noi · Badge WHY2025 e scheda Tasmota → MQTT napoli/ → agenti della città* (campo `"testata_girato"`); il cartello di riserva ha già il suo titolo.

### R4 · le voci di Roberto e Mario

- **Testi:** [`voce/COPIONE-VOCE.md`](voce/COPIONE-VOCE.md) ha il copione in ordine, le pronunce, le sezioni «Solo Roberto» (19 battute) e «Solo Mario» (18) e, per ogni battuta, il nome del file. Un file per scena in `voce/NN-<scena>.txt`.
- **Il modo più comodo:** una battuta per file, `girato/voce/NN-<scena>-K.m4a` (per esempio `girato/voce/06-chat-2.m4a` è la seconda battuta della chat, di Roberto). Ognuno registra da solo le sue battute, senza guardare il video: il montaggio toglie il silenzio, porta tutto allo stesso volume (−16 LUFS) e mette ogni battuta quando compare il suo sottotitolo. Se una battuta è più lunga del suo spazio, `monta.sh` lo dice.
- Si può anche registrare una scena intera (`girato/voce/NN-<scena>.m4a`, guardando la clip muta `clip/NN-<scena>.mp4` con il suo `.srt`) o tutto il video in un file (`girato/voce.m4a`, guardando `bozza.mp4` senza audio; con silenzio all'inizio: `./monta.sh --voce-da 1.5`).
- Stanza silenziosa e con tende o divani (meno eco), telefono a 20 cm dalla bocca, leggermente di lato, sempre lo stesso telefono per la stessa persona. Memo vocali di iPhone o Registratore di Android vanno bene; un microfono a clip è meglio.
- I sottotitoli restano anche con la voce: molti guardano senza audio.
- **Fissate un'ora limite** per rimontare con le voci (per esempio le 10:30 di domenica): il montaggio con la cache dura pochi minuti, poi va riguardato.

### Facoltativo · `girato/musica.mp3`

Solo musica **libera da diritti** (CC0 o fatta da noi), con la licenza scritta in `girato/LEGGIMI.md`. Il montaggio la mette a basso volume e la abbassa ancora quando c'è la voce; senza voce la mette un po' più alta (piano B se le voci non arrivano in tempo: il video non resta muto). Nel dubbio, niente musica.

## Cosa è reale e cosa è simulato (lo diciamo anche nel video)

| Nel video | Reale o simulato |
|---|---|
| Regata 3D (scene 1 e 12) | **Simulazione** del gemello digitale su strade ed edifici veri (OpenStreetMap). Barche, percorso della regata e folla per zona sono ipotesi; la testata lo dice in tutte e due le scene. Lo scenario «Napoli 2027» è un'ipotesi: l'America's Cup a Napoli nel 2027 è reale, la giornata con navi e partita è inventata |
| Isole e muro delle fonti (scene 2 e 4) | **Reali**: le righe del catalogo `docs/fonti-dati-napoli.md` (58 righe, 56 fonti pubbliche), lette da `scene/fonti/catalogo.json`, con le icone ufficiali dei siti. In scena ce ne sono 55: TIM Big Data (dati di Milano del 2013) resta nel catalogo (`FUORI_DAL_VIDEO` in `scene/fonti/isole.js`). «Oltre 50 fonti pubbliche, verificate una per una» vuol dire provate una per una (45 confermate, 11 da riprovare dalla rete italiana); «pubbliche» comprende anche fonti private accessibili; non tutte hanno licenza aperta e non tutte sono collegate all'API (per scelta il video non lo quantifica: i punti di dati verso TwinCIRO partono solo da quelle collegate). Le presenze per zona non sono un dato pubblico |
| Risposte di TwinCIRO nella chat ricostruita (scena 6) | **Vere** le risposte su pizzeria, prenotazione e percorso e l'avviso: uscite dall'API `/chiedi` e `/notifiche` di `c5-agentic-city`, con gli agenti a regole, senza LLM (`scene/chat_da_api.py`), senza ritocchi. Le stesse che TwinCIRO inoltra su WhatsApp con la skill `twinciro-citta`. La risposta sul meteo invece la compone lo script con i dati veri (sotto): lo dice la nota della scena |
| Negoziazione con la pizzeria, offerte, conferma | Il meccanismo è **vero** (agenti delle imprese sul bus). Le **imprese sono di fantasia** e i posti liberi sono simulati |
| Messaggi «dietro le quinte» | **Veri** i messaggi tra agenti stampati dalla città durante la stessa conversazione (l'«Assistente di Marta» compare come TwinCIRO). Quelli lunghi sono accorciati a una frase, presa così com'è: quella sulla zona dell'avviso. I messaggi «Folla → TwinCIRO» li compone lo script leggendo `/stato`; nel passo del meteo, lo scambio con la skill `napoli-citta-dati` è ricostruito con i dati veri di Open-Meteo e Meteoalarm |
| Meteo nella chat | **Reale**: Open-Meteo dal vivo (14/11 alle 15:45: 18,9 °C, pioggia al massimo 18% nelle 6 ore successive) e allerta Meteoalarm (arancione per temporali il 15/11, 07:00–18:59; l'avviso della Protezione Civile per il 15/11 era giallo, n. 94: la chat cita solo Meteoalarm, e lo dice). Il testo lo compone lo script |
| Operatore della Polizia Locale (scena 7) | Dashboard: la mappa «Napoli in tempo reale» in modalità demo (**folla, sensori e loro KPI simulati**, allerte, meteo ed eventi **veri**), non collegata agli agenti della città; non si mostra il suo pannello delle decisioni (agenti nel browser, un'altra simulazione). Proposta D4 e sala nel terminale: la **città vera** (simulazione della giornata) con `--approvazione`, approvata davvero con `POST /operatore`; l'avviso che parte è identico a quello della chat (che è stata generata senza `--approvazione`: stesse regole, stessa decisione). I pulsanti *Approva / Blocca* sono una scheda di presentazione delle due funzioni vere (nel progetto si approva da API o con `strumenti/operatore.py`). «~1.915 persone spostate» è la stima dell'agente Turismo, simulata |
| Architettura (scena 8) | **Vera**: gli agenti, l'orchestratore, il bus `napoli/#`, la sala e il drone (pilota umano nel loop) sono quelli di `c5-agentic-city`; le fonti pubbliche le legge l'API dati città (`citta-api`), non gli agenti; i sensori sono i due dispositivi di `firmware/` |
| Grafo della città (scena 9) | Relazioni **ricavate dai file del repository** (`grafo/genera.mjs`, nessuna scritta a mano): luoghi, stazioni (GTFS) e fonti reali; eventi e flussi dello scenario simulato 2027; imprese di fantasia; presenze da rete mobile simulate; i due sensori sono «in prova». È una rappresentazione delle relazioni, non un database interrogato dagli agenti: titolo, nota e voce lo dicono |
| Napoli adesso (scena 10) | **Dati veri** dell'API dati città, catturati il 14/11/2026 alle 19:30 (`scene/oggi/`), ognuno con la sua fonte e il suo stato (reale, snapshot, programmato…); la risposta su Città della Scienza è il testo vero dell'API. La cattura è di prima della correzione dell'API sull'allerta di domani (commit 8b33a40): l'avviso giallo n. 94 della Protezione Civile non c'è, per questo la voce non cita livelli |
| Badge WHY2025 e scheda Tasmota (scena 11) | **Dispositivi veri**, configurati per l'hotspot e il broker di `twinciro.robertodisanto.it`, **da provare**; firmware del badge e regole di Tasmota sono nostri (i sensori di luce, temperatura e umidità sono moduli I2C collegati al badge). Le loro letture compaiono nel video solo con le riprese R2 e R3. Senza riprese: il cartello con i due dispositivi e il formato dei messaggi, solo segnaposto tra `< >`, nessun valore inventato, e la nota che le prove sui dispositivi veri sono in corso |
| Notifica di TwinCIRO sulla regata 3D (scena 12) | Lo stesso testo dell'avviso della chat (agente Turismo, simulazione). Compare alle 14:37 simulate, quando la simulazione 3D manda il suo avviso per la Rotonda Diaz (testo quasi uguale, di una versione precedente della città) |
| Fastweb + Vodafone (scena 13) | **Fatti verificati**: Vodafone Analytics; lo studio sperimentale Istat–Vodafone sul turismo (comunicato del 9/5/2023) e i progetti europei sui dati di rete mobile MNO-MINDS (a guida Istat) e Multi-MNO (Eurostat, con Fastweb + Vodafone), comunicato del 17/3/2026; Walter di DPTechnics (ESP32-S3 con modem LTE-M/NB-IoT, SIM integrata e slot nano-SIM); FastwebMIIA-7B su Hugging Face (licenza non commerciale); in produzione FastwebAI Suite, nell'AI Factory di Fastweb vicino a Bergamo. «Può integrare»: l'adattatore della città è provato con server compatibili, non ancora con MIIA. La riga finale dice la challenge, non una collaborazione ufficiale |
| Folla per zona (chat, mappa, regata 3D, operatore) | **Simulata**: modello con ipotesi dichiarate. In produzione: presenze anonime e aggregate da rete mobile, il dato di Fastweb + Vodafone |
| «≈ 1.900 persone spostate» (scena 14) | Stima dell'agente Turismo nella stessa simulazione della chat (~1.915): presenti in zona × adesione ipotizzata (6–12% secondo il livello, ipotesi in `turismo.py`), al massimo fino al 70% della capienza della zona di arrivo (nel caso della chat decide questo tetto). Voce e cartello dicono che l'adesione è un'ipotesi |
| «Offerte solo dove c'è posto» (scena 14) | Regole delle imprese di fantasia (`c5-agentic-city/dati/imprese.json`): sconti dal 10 al 30%, decisi dalle imprese, solo con posti liberi |
| −9% di ore in coda (scena 14) | Media su 4 semi della simulazione SUMO (da −1% a −18%), rispetto ai semafori fissi di oggi; −7,9% già con il controllo adattivo neutro, senza priorità degli agenti: `c5-agentic-city/README.md`, «Risultati del gemello» |

## Controlli prima di consegnare

- [ ] `./monta.sh --controllo` e scorri i fotogrammi in `$C5_VIDEO_LAVORO/controllo/` (uno ogni 5 s): niente segnaposto, testi leggibili, nessun refuso.
- [ ] Durata ≤ 3:00 e file ≤ 40 MB: li stampa `monta.sh` alla fine.
- [ ] `./monta.sh --solo-testi` non segnala niente (sovrapposizioni, battute fuori scena, ritmo).
- [ ] Guardalo una volta intero con l'audio e una senza.
- [ ] Nessun numero di telefono, token o password visibile nelle riprese.
- [ ] Se la voce dice qualcosa di diverso, aggiorna `scene/scaletta.json`: i sottotitoli vengono da lì.
- [ ] Se si rifà la cattura di «Napoli adesso» (scena 10) la voce resta valida; se si rigenera la chat (`python3 scene/chat_da_api.py`), rifai anche la cattura della città dell'operatore (`scene/operatore/cattura_citta.py`), che controlla che l'avviso sia lo stesso.
