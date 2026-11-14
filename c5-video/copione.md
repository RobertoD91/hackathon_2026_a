# Copione del video di consegna · TwinCiro (C5)

**Durata: 2:54** (limite 3:00) · 1920×1080 · 30 fps · in italiano · sottotitoli impressi.

**Al centro c'è CiroGPT**, come hanno chiesto Fastweb e Vodafone il 14/11: da 0:14 a 1:35 si parla solo di lui (titolo, chat, architettura vista da CiroGPT); la mappa (1:35–1:54) è presentata come le fonti di CiroGPT e nel gemello digitale compare il suo avviso. In tutto circa due terzi del video. IoT e gemello servono da prove di concretezza. **Traffico e semafori** (non piaciuti ai partner) restano solo in un riquadro dei benefici: la scena SUMO è pronta ma esclusa (`"salta": true` in `scaletta.json`).

Questo file è la versione da leggere di [`scene/scaletta.json`](scene/scaletta.json), che è quella usata dal montaggio: se cambi un tempo o un testo, cambialo in tutti e due i file.

## Il racconto in una riga

Una crocerista scrive a CiroGPT su WhatsApp. CiroGPT chiede agli agenti della città, negozia con la pizzeria, usa i dati veri e poi la avvisa quando la Rotonda Diaz si riempie. Dietro ci sono un orchestratore, un catalogo di 59 fonti pubbliche, nodi ESP32 e un gemello digitale. Si chiude con i benefici, con i numeri, e con il perché Napoli dovrebbe adottarla.

## Scene

| # | Tempo | Durata | Cosa si vede | Testo a schermo |
|---|---|---|---|---|
| 1 | 0:00–0:14 | 14 s | Regata in 3D (`regata_3d.mp4` da 0:05, ritagliata e ingrandita, Mergellina compresa): città notturna, colonne della folla, barche. Un velo scuro copre il vecchio titolo, la legenda e i riquadri dei KPI | Testata: *Napoli 2027 · lo scenario. America's Cup, due navi da crociera, la partita al Maradona: lo stesso sabato* |
| 2 | 0:14–0:21 | 7 s | Cartello del titolo | **TwinCiro**. *La città che ci pensa. E te lo dice su WhatsApp.* Twin = gemello digitale, Ciro = CiroGPT |
| 3 | 0:21–1:19 | 58 s | **CiroGPT.** A sinistra il telefono con la chat: la ripresa vera se c'è `girato/cirogpt.mp4`, altrimenti la chat ricostruita. A destra il passo del racconto e «dietro le quinte», cioè i messaggi veri tra gli agenti | 5 passi: *Negozia con le imprese → Prenota con un «ok» → Ti porta dove serve → Usa dati reali, con la fonte → Ti avvisa prima del problema*. In basso, la nota su cosa è simulato |
| 4 | 1:19–1:35 | 16 s | Schema dell'architettura, che si compone in sincronia con la voce, partendo da CiroGPT | *Come pensa la città*: persone → CiroGPT → API → orchestratore → 6 agenti → bus MQTT → ESP32, drone, gemello, sala operativa; fonti pubbliche reali (catalogo di 59) |
| 5 | 1:35–1:54 | 19 s | Registrazione della mappa «Napoli in tempo reale»: banner Meteoalarm, ricerca di Castel dell'Ovo con la sua scheda, modalità Meteo, modalità Aria con le centraline ARPAC, pannello «Oggi a Napoli» con gli eventi veri | Testata: *Dati reali · le fonti di CiroGPT. Mappa «Napoli in tempo reale»: le stesse fonti pubbliche delle skill di CiroGPT* |
| 6 | 1:54–2:01 | 7 s | **Ripresa vera** `girato/badge.mp4`. Se manca: riquadro di riserva con il formato reale dei due messaggi MQTT del firmware (`napoli/sensori/<id>/persone`, `napoli/nodi/<id>/stato`) | Testata: *IoT · i sensi della città. Nodi ESP32 e badge WHY2025 → MQTT → agenti* |
| 7 | 2:01–2:07 | 6 s | **Ripresa vera** `girato/plastico.mp4`. Se manca: riquadro di riserva «Si installa dal browser» con l'indirizzo del flasher web | Testata: *Oggi su Wi-Fi, domani su 5G: firmware unico, installato dal browser* |
| 8 | 2:07–2:20 | 13 s | Regata in 3D (`regata_3d.mp4` da 0:40): le colonne della folla a Rotonda Diaz e Mergellina diventano gialle. Da 2:13 compare la notifica di CiroGPT con l'avviso della chat | Testata: *Gemello digitale. La giornata della regata simulata sulle strade vere: folla per zona e barche* |
| – | – | 0 s | *Scena 9, gemello SUMO affiancato con i numeri medi: esclusa (`"salta": true`)* | – |
| 10 | 2:20–2:35 | 15 s | Cartello «Cosa cambia, con i numeri»: 4 riquadri che compaiono con la voce (il quarto, il traffico, senza voce) | Chi visita · imprese · città · traffico, ognuno con la fonte del numero |
| 11 | 2:35–2:47 | 12 s | Cartello «Perché Napoli dovrebbe adottarla»: 5 righe | Nessuna app nuova · i dati ci sono · il 2027 è vicino · con Fastweb + Vodafone · si parte piccoli |
| 12 | 2:47–2:54 | 7 s | Cartello di chiusura | **TwinCiro**. *Napoli ci pensa.* «Scrivi a CiroGPT». Roberto D'Isanto · Mario Varlese · link |

Le dissolvenze sono brevi (0,2 s attraverso il nero). Il video si apre dal nero in 0,6 s e si chiude nel nero in 1 s.

## Voce fuori campo (da leggere)

Ritmo: circa **150 parole al minuto** dentro ogni battuta, contando le sigle come si pronunciano, con pause tra una battuta e l'altra (circa 340 parole in 2:54). Tono: caldo, sicuro, senza fretta.

Come registrare: guarda `bozza.mp4` **senza audio** e leggi i sottotitoli quando compaiono (fanno da gobbo). Una sola ripresa, dall'inizio alla fine. Se sbagli, fermati, aspetta due secondi e ricomincia dalla scena: poi taglia.

Pronuncia: *WHY2025* = «uài duemilaventicinque»; *ESP32* = «esse pi trentadue»; *MQTT* = «emme cu ti ti»; *OpenClaw* = «open clò»; *5G* = «cinque gi»; *9%* = «nove per cento».

**1 · Apertura (0:00)**
> Napoli, 2027. Lo stesso sabato: l'America's Cup, due navi da crociera e la partita al Maradona. Migliaia di persone, ognuna con una domanda. E ogni servizio della città fa da sé.

**2 · Titolo (0:14)**
> Per questo abbiamo creato TwinCiro: una città che pensa, e che ti parla su WhatsApp.

**3 · CiroGPT (0:21)**, una battuta per ogni passo della chat, *aspettando che compaia il messaggio*:
> (0:21) Marta è in crociera, e scrive a CiroGPT come a un amico.
> (0:27) CiroGPT chiede agli agenti: la pizzeria alle 13 è piena, e propone le 14.
> (0:36) Marta risponde «ok», e il tavolo è prenotato. Nessuna telefonata.
> (0:45) Poi CiroGPT le dice come arrivare alla regata, e quanta gente c'è adesso.
> (0:57) Per il meteo usa dati veri, e cita la fonte: domani c'è allerta arancione.
> (1:08) E quando la Rotonda Diaz si riempie, è CiroGPT a scrivere per primo: c'è un posto più tranquillo, con un'offerta.

**4 · Architettura (1:19)**
> Quando Marta scrive, CiroGPT chiama l'API della città. L'orchestratore interroga sei agenti: meteo, eventi, folla, traffico, turismo e imprese. Si parlano su un bus MQTT, e ogni decisione ha la sua motivazione.

**5 · Dati reali (1:35)**
> CiroGPT risponde con dati veri: un catalogo di cinquantanove fonti pubbliche, provate una per una. Meteo e aria, metro e funicolari, eventi del giorno, allerte. La folla è simulata: è il dato che la rete di Fastweb e Vodafone può dare, anonimo.

**6–7 · IoT (1:54)**
> La città ha anche i sensi: nodi ESP32 che parlano MQTT. Oggi su Wi-Fi, domani sul 5G. Il firmware si installa dal browser.

*Il firmware dei nodi è compilato ma, secondo `c5-agentic-city/firmware/README.md`, non ancora provato su hardware. Se le riprese 6 e 7 non mostrano un dispositivo che pubblica davvero, la frase resta vera (il firmware parla MQTT) e il video usa i riquadri di riserva; non aggiungere «misurano» o «pubblicano» senza la ripresa.*

**8 · Gemello digitale (2:07)**
> Il gemello digitale prova la giornata della regata, sulle strade vere del lungomare. Mostra dove si forma la folla, e quante persone sposta un avviso di CiroGPT.

**10 · Benefici (2:20)**
> Per chi visita: risposte in pochi secondi, e un tavolo senza telefonate. Le imprese riempiono le ore vuote, con offerte mirate. E un solo avviso sposta circa millenovecento persone, prima del pienone.

*Il riquadro del traffico (−9% di ore in coda, media su 4 simulazioni, da −1% a −18%) resta a schermo senza voce: è l'unico punto del video sul traffico.*

**11 · Perché Napoli (2:35)**
> Perché Napoli? WhatsApp ce l'hanno tutti, e i dati pubblici ci sono. Il 2027 è vicino: con Fastweb e Vodafone si parte da un quartiere.

**12 · Chiusura (2:47)**
> TwinCiro. Napoli ci pensa. Scrivi a CiroGPT.

## Riprese da girare

Metti i file in [`girato/`](girato/LEGGIMI.md) con questi nomi esatti, poi lancia `./monta.sh`. Tutto orizzontale 1920×1080 tranne il telefono. Luce frontale, niente controluce verso le vetrate, telefono e portatile con la luminosità al massimo. Per vedere dove andranno le riprese mancanti: `./monta.sh --segnaposto` (cartelli «Qui va una ripresa reale» al posto delle riserve).

### R1 · `girato/cirogpt.mp4`: la chat vera con CiroGPT (la più importante)

Sostituisce la chat ricostruita della scena 3. Il telefono vero va al posto di quello disegnato, e a destra resta il pannello «dietro le quinte».

- **Cosa:** registrazione dello schermo del telefono (iPhone: Centro di Controllo → Registra schermo; Android: Registra schermo dalle impostazioni rapide), verticale, nel gruppo WhatsApp con CiroGPT.
- **Prima di registrare:** modalità Non disturbare (niente notifiche di altre chat sullo schermo), batteria e ora pulite, carattere di WhatsApp a grandezza media, sfondo della chat semplice. Nel gruppo cancella o scorri via i messaggi vecchi. Se nel gruppo ci sono numeri di persone che non vogliono comparire, usa un gruppo nuovo solo con te e CiroGPT.
- **La città:** perché le risposte siano quelle del racconto, avvia l'API come per la chat ricostruita, partendo alle 12:10 con la giornata accelerata:
  `cd c5-agentic-city && python avvia.py --llm regole --senza-sala --senza-gemello --inizio 12:10 --velocita 30 --api-porta 8080`
  Con `--llm claude` (e la chiave) le risposte sono più naturali, ma vanno ricontrollate: la pizzeria deve dire pieno alle 13:00 e posto alle 14:00. Se la città gira da più di 2 minuti, riavviala: alle 12:30 simulate le 13:00 non sono più «future».
- **Attenzione al testo:** la skill `twinciro-citta` inoltra la risposta dell'API **senza riscriverla**. Con le regole la prima risposta comincia con «Alle 13:00 siamo pieni…» (sembra parlare la pizzeria) e l'avviso dice «A Rotonda Diaz (village)… è molto più tranquillo». Nella chat ricostruita questi punti sono corretti con i ritocchi dichiarati in `scene/chat_domande.json`; su WhatsApp si vedono finché non li corregge `c5-agentic-city` (vedi «Problemi noti» nel README).
- **Cosa scrivere**, uno alla volta, aspettando la risposta (testi in [`scene/chat_domande.json`](scene/chat_domande.json)):
  1. `Ciao Ciro! Siamo 4 croceristi: vogliamo prenotare in una pizzeria vicino al Castel dell'Ovo alle 13:00 🍕`
  2. `Ok, va bene!`
  3. `Poi vogliamo andare a vedere la regata alla Rotonda Diaz: come si arriva?`
  4. `Ci serve l'ombrello?` (risponde la skill `napoli-meteo-allerte`, se è caricata su CiroGPT; se non lo è, salta questa domanda e togli la battuta del meteo dalla voce)
  5. Poi **aspetta l'avviso**: arriva da solo dopo le 14:00 simulate, cioè circa 5 minuti reali dopo l'avvio, se l'heartbeat di OpenClaw interroga `/notifiche`. Se l'heartbeat non c'è ancora, scrivi `Com'è la situazione alla Rotonda Diaz?` dopo le 14:30 simulate.
- **Durata:** la registrazione sarà lunga qualche minuto. Non serve tagliarla a mano: annota in `scene/scaletta.json`, nella scena `03-cirogpt`, i pezzi da tenere. Per esempio `"girato": { "file": "cirogpt", "modo": "telefono", "pezzi": [[2, 16], [20, 31], [40, 53], [62, 72], [300, 310]] }` tiene 14 + 11 + 13 + 10 + 10 = 58 s. In totale i pezzi devono fare **58 s**: se sono di meno, l'ultimo fotogramma resta fermo. Il pannello a destra (passi e «dietro le quinte») segue i tempi della chat ricostruita, quindi scegli i pezzi in modo che le risposte di CiroGPT compaiano vicino a questi secondi della scena: pizzeria 6,8 s, conferma 17,9 s, percorso 26,0 s, meteo 38,0 s, avviso 49,4 s (i messaggi di Marta circa 3 s prima). Se non ci riesci, riallinea i tempi della voce della scena 3 ai momenti in cui arrivano i messaggi.
- **Ritmo:** scrivi con calma (si vede la tastiera) e lascia ogni risposta sullo schermo 4–5 secondi prima di scrivere la successiva.

### R2 · `girato/badge.mp4`: badge WHY2025 o nodo ESP32 (7 s)

- **Inquadratura:** primo piano orizzontale, con la mano che tiene il badge (o l'ESP32 con il sensore) a 30–40 cm. Sfondo scuro e pulito, telefono su un appoggio o treppiede.
- **Azione:** 0–3 s il display con i valori (temperatura, umidità o luce); 3–7 s spostamento lento verso il portatile, dove lo stesso valore arriva in un terminale con `mosquitto_sub -t 'napoli/#' -v` oppure nella mappa.
- **Niente a schermo** di password, token o IP privati.

### R3 · `girato/plastico.mp4`: plastico oppure messaggi MQTT (6 s)

- **Se c'è il plastico:** carrellata lenta e stabile (telefono sul treppiede, o mano ferma con stabilizzazione) sui nodi ESP32 con i LED accesi, all'altezza del plastico, da sinistra a destra.
- **Se non c'è:** registrazione dello schermo del portatile con i messaggi MQTT che arrivano (`mosquitto_sub -t 'napoli/#' -v` mentre gira la città con `--broker`), carattere grande del terminale (almeno 20 pt), tema scuro.

### R4 · `girato/voce.m4a`: voce fuori campo (2:54)

- Stanza silenziosa e con tende o divani (meno eco), telefono a 20 cm dalla bocca, leggermente di lato. Memo vocali di iPhone o Registratore di Android vanno bene; un microfono a clip è meglio.
- Leggi guardando `bozza.mp4` senza audio: comincia a parlare quando compare il primo sottotitolo, a 0,6 s. Se la registrazione ha silenzio all'inizio, usa `./monta.sh --voce-da 1.5` (secondi da saltare).
- Il montaggio normalizza il volume (−16 LUFS). I sottotitoli restano anche con la voce: molti guardano senza audio.

### Facoltativo · `girato/musica.mp3`

Solo musica **libera da diritti** (CC0 o fatta da noi), con la licenza scritta in `girato/LEGGIMI.md`. Il montaggio la mette a basso volume e la abbassa ancora quando c'è la voce. Nel dubbio, niente musica.

## Cosa è reale e cosa è simulato (lo diciamo anche nel video)

| Nel video | Reale o simulato |
|---|---|
| Risposte di CiroGPT nella chat ricostruita | **Vere**: uscite dall'API `/chiedi` di `c5-agentic-city`, con gli agenti a regole (`scene/chat_da_api.py`). Le stesse che CiroGPT inoltra su WhatsApp con la skill `twinciro-citta` |
| Ritocchi di forma nella chat | Dichiarati: chi parla nella controproposta («La Pizzeria 'O Scoglio alle 13:00 è piena…»), «alla Rotonda Diaz» senza il nome interno «(village)», l'accordo «sono molto più tranquilli», la Linea 6 senza «se attiva» (c'è nel GTFS ANM). Nessun fatto, numero od orario cambiato; il testo originale resta in `chat.json` (`testo_api`). Le regole sono in `scene/chat_domande.json`. La nota a schermo dice «solo ritocchi di forma» |
| Negoziazione con la pizzeria, offerte, conferma | Il meccanismo è **vero** (agenti delle imprese sul bus). Le **imprese sono di fantasia** e i posti liberi sono simulati |
| Messaggi «dietro le quinte» | **Veri**: il dialogo tra agenti stampato dalla città durante la stessa conversazione (con gli stessi ritocchi di forma) |
| Meteo nella chat | **Reale**: Open-Meteo dal vivo (14/11, 19,2 °C, pioggia al massimo 20% nelle 6 ore successive) e allerta Meteoalarm (snapshot della mappa: arancione per temporali il 15/11, 07:00–18:59). La frase la compone lo script con quei dati, come farebbe la skill `napoli-meteo-allerte` |
| Notifica di CiroGPT sulla regata 3D | Lo stesso testo dell'avviso della chat (agente Turismo, simulazione) |
| Folla per zona (chat, mappa, regata 3D) | **Simulata**: modello con ipotesi dichiarate. In produzione: presenze anonime e aggregate da rete mobile, il dato di Fastweb + Vodafone |
| Mappa: meteo, aria, allerte, metro e funicolari, eventi, terremoti | **Reali**, alcuni da snapshot del 14/11. «59 fonti» è il catalogo provato in `docs/fonti-dati-napoli.md` (non tutte con licenza aperta, non tutte integrate): per questo il video dice «fonti pubbliche, provate una per una» e non «aperte» |
| Regata 3D e gemello SUMO | **Simulazione** su strade e edifici veri (OpenStreetMap). Domanda di traffico, barche e percorso della regata sono ipotesi |
| −9% di ore in coda (riquadro dei benefici) | Media su 4 semi della simulazione (da −1% a −18%): `c5-agentic-city/README.md`, «Risultati del gemello» |
| Sconti dal −10% al −30% | Regole delle imprese di fantasia (`c5-agentic-city/dati/imprese.json`) |
| «Circa 1.900 persone spostate» | Stima dell'agente Turismo nella stessa simulazione della chat (~1.915; adesione del 6–12% secondo il livello, ipotesi in `turismo.py`) |
| Badge, ESP32, plastico | **Veri** solo se ci sono le riprese R2 e R3. Senza riprese: riquadri con il formato reale dei messaggi del firmware e il flasher web, nessun valore inventato |
| Scenario «Napoli 2027» | Ipotesi: l'America's Cup a Napoli nel 2027 è reale, la giornata con navi e partita è inventata |

## Controlli prima di consegnare

- [ ] `./monta.sh --controllo` e scorri i fotogrammi in `$C5_VIDEO_LAVORO/controllo/` (uno ogni 5 s): niente segnaposto, testi leggibili, nessun refuso.
- [ ] Durata ≤ 3:00 e file ≤ 40 MB: li stampa `monta.sh` alla fine.
- [ ] Guardalo una volta intero con l'audio e una senza.
- [ ] Nessun numero di telefono, token o password visibile nelle riprese.
- [ ] Se la voce dice qualcosa di diverso, aggiorna `scene/scaletta.json`: i sottotitoli vengono da lì.
- [ ] Meteo coerente: la chat dice «niente pioggia» con il dato di Open-Meteo; se la mappa registrata mostra pioggia (succede quando Open-Meteo dà 429 e risponde MET Norway), rigenera la mappa (`./monta.sh --rigenera-mappa`) o la chat (`python3 scene/chat_da_api.py`) nello stesso momento.
