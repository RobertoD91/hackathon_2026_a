# Brainstorming — challenge 1, 2, 5

Testi ufficiali delle challenge: [`hackathon.md`](hackathon.md). Punti di forza del team: IoT (ESP32, modulo 5G), OpenClaw già funzionante con WhatsApp, server cloud e deploy rapido con Claude Code.

Idea trasversale: **C2 e C5 possono condividere la stessa base tecnica**. Il flusso è: ESP32 con sensori → backend di ingestione → agenti specializzati → orchestratore (OpenClaw) → canale verso le persone (WhatsApp) e dashboard per l'operatore. Si costruisce una volta (firmware, ingestione, simulatore di sensori, formato dei messaggi) e cambia solo lo scenario. Proposta: una cartella condivisa `shared/iot-agents/`.

---

## C1 — Bhblasted, "Clienti che non esistono" (basso sforzo)

### Cosa premia davvero

Il testo dice: *"Ti diamo annunci reali di cui noi conosciamo il risultato e tu no. Il tuo sistema dice quale vince, che CTR aspettarsi segmento per segmento, in che fascia starà il CPM, e perché. Vince chi prevede meglio."*

È una **gara di previsione su annunci consegnati in sede**. La pagina social simulata è un'ottima interfaccia, ma da sola non basta: dietro servono numeri (vincitore, CTR per segmento, fascia di CPM) e spiegazioni.

### Idea: `c1-feed-simulato`

1. **Input:** l'annuncio (immagine, testo, call to action), la piattaforma, il target dichiarato. Più varianti per gli A/B test.
2. **Pubblico sintetico:** da 200 a 500 persone virtuali per segmento. Età, genere e area si estraggono dalle distribuzioni ISTAT; uso dei social, interessi e abitudini vengono assegnati per fascia. Ogni persona ha un breve profilo.
3. **Esposizione:** ogni persona (un LLM economico con visione) vede l'annuncio *dentro un feed*, tra altri post, e restituisce un JSON:
   - probabilità di fermarsi;
   - probabilità di cliccare;
   - reazione (like, commento, ignora);
   - un commento plausibile;
   - il motivo.

   Usiamo probabilità e non sì/no, per avere meno rumore.
4. **Calibrazione:** è il punto chiave. Gli LLM cliccano molto più delle persone vere, quindi il loro tasso di click non è un CTR. Lo usiamo come **punteggio relativo**: CTR previsto = CTR di riferimento della piattaforma/settore × (punteggio dell'annuncio / punteggio medio). Se Bhblasted fornisce qualche annuncio d'esempio con i risultati, ci tariamo sopra una regressione semplice. **Da chiedere al kickoff.**
5. **CPM:** non dipende da come reagiscono le persone ma dall'asta. Conta l'ampiezza del target, la fascia d'età, la piattaforma, il posizionamento e il periodo: a novembre, con il Black Friday, il CPM è più alto. Una tabella di fasce più una spiegazione generata.
6. **Il perché:** raggruppiamo i motivi per segmento. Esempio: *"18–24: testo troppo lungo, non si capisce l'offerta nei primi 2 secondi"*.
7. **Interfaccia:**
   - una pagina stile Instagram/Facebook con l'annuncio, i like e i commenti delle persone virtuali, filtrabile per segmento;
   - accanto, la scheda di previsione: vincitore, CTR per segmento, fascia di CPM, motivi;
   - confronto fianco a fianco delle varianti.

**Sforzo:** basso (1–2 persone). Frontend statico su Pages più un endpoint (Cloudflare Worker o il nostro server) che chiama l'LLM. Le immagini delle creatività di prova si possono generare con FLUX.

**Rischi:**
- l'accuratezza assoluta del CTR;
- i bias degli LLM.

Il vincitore tra due varianti (ranking relativo) è molto più affidabile del CTR assoluto: in demo puntiamo su quello e diciamo esplicitamente quanto siamo incerti.

**Cosa serve:** una chiave API di un LLM con visione e un modello economico per le persone virtuali.

---

## C2 — Meditech / Federico II, sostenibilità con l'AI (energia, ambiente, agrifood)

### Cosa premia

Il brief chiede di **collegare una visione a un utilizzo concreto**: a chi si rivolge, quale cambiamento rende possibile, **come si verificano i benefici**. Insiste sulle **comunità** che useranno il modello. Servono quindi una persona reale da servire e un numero da misurare (litri, kWh, euro, CO₂).

### Idee

**A. `c2-acqua-comune` — agrifood (idea di Roberto, sviluppata)**
Una comunità agricola condivide una risorsa idrica limitata.
- Ogni campo ha un agente: ESP32 con umidità del suolo, temperatura e luce, più la coltura e la sua fase.
- Un agente meteo usa le previsioni di Open-Meteo e l'evapotraspirazione ET0 (metodo FAO-56).
- L'agente del consorzio assegna i turni d'acqua secondo priorità: stress della coltura, fase, pioggia prevista.
- Gli agricoltori ricevono istruzioni su WhatsApp, per esempio *"stanotte irriga 20 minuti, domani piove"*.

Beneficio misurabile: litri risparmiati rispetto all'irrigazione a calendario, a parità di stress delle colture. Demo: un vaso vero con sensore, gli altri campi simulati. Racconto forte: siccità nel Sud, Campania agricola.
- Serve un sensore di umidità del suolo (capacitivo, pochi euro).

**B. `c2-fabbrica-solare` — energia, smart factory (idea di Roberto)**
- Ogni reparto ha un ESP32 con luce e temperatura.
- L'agente energia sposta i carichi flessibili (compressori, ricariche, pre-raffrescamento) nelle ore di produzione fotovoltaica o di prezzo basso (prezzo PUN di GME).
- Le luci si abbassano quando c'è luce naturale.
- Misura: kWh, euro e CO₂ evitati (fattori ISPRA).

Usa **solo i sensori che abbiamo già**: il sensore di luce fa da proxy della produzione del pannello.

**C. `c2-cer-quartiere` — energia, comunità energetica rinnovabile**
È la variante "di comunità" di B.
- Gli agenti delle case (luce = produzione fotovoltaica simulata, temperatura = domanda) si coordinano per massimizzare l'**energia condivisa** dentro la CER, che è quella incentivata dal GSE.
- Ogni famiglia riceve consigli tipo *"lava alle 13, c'è sole"*.
- Misura: quota di energia condivisa ed euro di incentivo.

È molto attuale in Italia e risponde alla parte "nuove forme di accesso e partecipazione" del brief.

**Consiglio:** **A** se riusciamo a procurare un sensore di umidità del suolo, altrimenti **C**. C sfrutta luce e temperatura e ha la dimensione di comunità che il brief chiede. Tutte e tre usano la base condivisa con C5.

---

## C5 — Fastweb + Vodafone, "Napoli Agentic City" (IoT con modulo 5G)

Esiste già `c5-agentic-city/` con la direzione: niente webapp, agenti + ESP32 + droni. Le idee sotto sono soluzioni possibili, anche in cartelle `c5-*` separate.

### Cosa premia

- Agenti che **si vedono coordinarsi e reagire ai cambiamenti**.
- Benefici misurabili.
- Perché Napoli dovrebbe adottarla.
- Bonus: assistenti personali e opportunità di business per le imprese locali.

I partner sono operatori di rete: **5G e dati di rete anonimi** sono il loro terreno.

### Idee

1. **`c5-regia-grande-evento`**: è lo scenario d'esempio del brief. Un sabato con regata dell'America's Cup, partita al Maradona e tre navi da crociera. Agenti:
   - **folla:** densità per zona da dati anonimi e aggregati delle celle telefoniche, simulati, sul modello di *Seoul Real-Time City Data*;
   - **mobilità:** metro, funicolari e bus dagli orari GTFS di ANM ed EAV;
   - **meteo e caldo:** sensori ESP32 5G più Open-Meteo;
   - **turismo:** alternative ai luoghi affollati e offerte delle attività vicine, che è la parte di business;
   - **orchestratore** su OpenClaw.

   Canali: WhatsApp per turisti e cittadini, una vista "sala operativa" per il Comune.
2. **`c5-heatescape`** (idea di Roberto): percorsi che bilanciano tempo, caldo e affollamento. Si può integrare in 1 come funzione dell'assistente ("portami al Castel dell'Ovo all'ombra").
3. **`c5-smartwaste`** (idea di Roberto): cestini con ESP32 e sensore a ultrasuoni per il livello di riempimento. L'agente eventi prevede i picchi (partita = più rifiuti), l'agente logistica ripianifica il giro di raccolta. Demo fisica molto efficace: riempi il cestino e il percorso del camion cambia in diretta.
4. **`c5-metro-ko`**: un guasto in metro.
   - L'orchestratore rileva il guasto;
   - l'agente folla vede le stazioni che si riempiono;
   - l'agente mobilità propone bus sostitutivi;
   - l'assistente avvisa su WhatsApp chi è coinvolto con un'alternativa.

   Misura: minuti di ritardo evitati.
5. **Cruscotto "Napoli Real-Time"** sul modello di Seoul: livelli di affollamento per luogo, per l'operatore.

**Consiglio:** **una demo unica che unisce 1 e 4.** Il sabato del grande evento va avanti e noi, dal vivo, facciamo partire il guasto in metro, per esempio premendo un pulsante su un ESP32. Gli agenti reagiscono, la sala operativa si aggiorna e i telefoni ricevono il WhatsApp.
- **I giurati possono scrivere al bot dal proprio telefono.** È il pezzo più forte della demo e sfrutta OpenClaw già funzionante.
- I nodi ESP32 con 5G sono i "sensori della città": allineati al partner.
- SmartWaste (3) è un ottimo secondo scenario se c'è tempo, oppure va come soluzione separata.

**Ipotesi da dichiarare:** i dati di cella sono simulati, con l'algoritmo che useremmo su quelli veri; il guasto è simulato.

---

## Come lavorare con i subagent

- **Un subagent per soluzione**, ognuno solo nella sua cartella. Lavorano in worktree separati per non pestarsi i piedi su `master`; poi integro io e pusho.
- Ordine consigliato:
  1. **C1 subito:** è indipendente e a basso sforzo.
  2. **Base IoT condivisa** (`shared/iot-agents/`): firmware ESP32, ingestione e simulatore di sensori.
  3. **Scenari C2 e C5** sopra la base.
- I subagent consumano crediti: meglio partire con 2–3 alla volta, con brief stretti, piuttosto che lanciarli tutti.

### Informazioni che servono dal team

- **OpenClaw:** dove gira, come si definiscono agenti e strumenti, come si collega il numero WhatsApp, se possiamo aggiungere agenti da codice.
- **Hardware:** modelli di ESP32, sensori disponibili (luce, temperatura, altro?), modello del modulo 5G, display, droni.
- **LLM:** quale API e quale chiave usiamo per gli agenti e per le persone virtuali di C1.
- **Server cloud:** cosa c'è e come ci facciamo il deploy.
