# Fonti dati pubbliche per Napoli

Catalogo delle fonti dati per la mappa "Napoli in tempo reale" (`shared/iot-agents/example/`, 10 luoghi in `luoghi.js`) e per gli agenti di C5 (Fastweb + Vodafone, "Napoli Agentic City"). Nasce da una ricerca su quattro domini: meteo e ambiente, mobilità, eventi e turismo, territorio e cataloghi. Un verificatore indipendente ha poi ricontrollato ogni dominio e, quando ricerca e verifica non coincidono, qui vale la verifica. Non c'è niente che non sia stato trovato o provato in quella ricerca: dove la verifica non ha confermato, è scritto.

**Quando e da dove.** Le prove sono state fatte dalla sandbox cloud di Claude Code tra la sera del 13/11/2026 e la notte del 14/11/2026: la verifica, tra le 00:00 e le 01:45 UTC del 14/11. La sandbox esce verso l'esterno da un unico IP condiviso, non italiano, attraverso un proxy HTTPS. Per questo negli esiti si distinguono tre casi:

- **bloccata dalla sandbox**: è il proxy della sandbox a rifiutare o chiudere la connessione. Non vuol dire che la fonte non funzioni: va riprovata dalla rete dell'evento o da `cloud.robertodisanto.it`;
- **irraggiungibile da questo IP**: il proxy lascia passare la richiesta ma il server non risponde (timeout, reset, 502). Anche in questo caso va riprovata da una rete italiana;
- **429** di Open-Meteo o di Wikimedia: è la quota dell'IP condiviso che si esaurisce, non un guasto della fonte.

Gli esiti della verifica sono: **Confermata**, **Confermata con correzioni** (funziona, ma qualcosa della ricerca era sbagliato o incompleto), **Non verificabile** (serve una chiave, oppure il server non risponde), **Bloccata dalla sandbox**, **Non funziona**. Le fonti segnate **Aggiunta dal verificatore** le ha trovate e provate il verificatore.

Ultimo aggiornamento: 14/11/2026. Quando proviamo di nuovo una fonte dalla rete dell'evento, aggiorniamo la riga corrispondente.

---

## 0. Cosa è davvero integrato nella mappa (14/11)

Questo catalogo è la ricerca: elenca anche fonti che **non** abbiamo usato, e nella colonna "Uso nella mappa / agenti" descrive l'uso possibile. Quello che oggi gira nella mappa di Napoli (`shared/iot-agents/example/`, dettagli nel [README della base](../shared/iot-agents/README.md#dati-reali-di-napoli)) è questo. Non c'è nessun proxy sul server: le fonti con CORS le legge il browser (con cache, timeout e una riserva dichiarata), le altre arrivano da **snapshot JSON** in `example/dati/` (circa 120 KB), rigenerati con `node shared/iot-agents/tools/aggiorna-dati-napoli.js [--curl]`.

| Dato in pagina | Fonte usata | Come arriva | Dove si vede |
|---|---|---|---|
| Meteo per luogo | Open-Meteo ICON-2I → Open-Meteo predefinito → MET Norway → snapshot | browser | modalità Meteo, scheda, KPI "Temperatura reale", chat |
| Qualità dell'aria | centraline ARPAC via EEA (Parquet E2a) entro 1,5 km e con meno di 48 ore; altrimenti Open-Meteo CAMS | centraline: snapshot; CAMS: browser | modalità Aria, livello "Centraline aria (ARPAC)", scheda, KPI |
| Allerta meteo | Centro Funzionale Campania (Zona 1) | browser, riserva sullo snapshot | banner, scheda, KPI, avviso WhatsApp dell'orchestratore |
| Avvisi Meteoalarm | Meteoalarm (Campania) | snapshot (niente CORS) | banner |
| Terremoti | INGV (Campi Flegrei, 30 giorni) | browser, riserva sullo snapshot | pannello "Oggi a Napoli" |
| Linee e stazioni, corse per ora | GTFS ANM ed EAV (copie di Mobility Database) | snapshot ridotto (11 linee, 92 stazioni) | livello "Metro, funicolari e treni", scheda, chat "come arrivo a…" |
| Prossimi passaggi | Transitous (solo metro, funicolari e treni: i bus raggruppati con la stazione sono esclusi) | browser, a richiesta | popup della stazione e pulsante nella scheda |
| Avvisi trasporti | EAV (WordPress) | browser | scheda, pannello |
| Traffico | ASPI (solo Tangenziale e autostrade) | browser, solo con il livello acceso | livello "Traffico su tangenziale e autostrade" con un riquadro di stato |
| Eventi di oggi e prossimi | Comune di Napoli, openfootball (anche dal vivo), TheSportsDB, Cruise Timetables, America's Cup | snapshot | pannello, livello "Eventi reali di oggi", scenari `evento_<zona>`, chat |
| Riferimenti | visitatori dei siti comunali, Wikidata, AdSP, balneazione EEA 2025, Inside Airbnb, stagionalità ISTAT | snapshot | scheda, scenario `stagione_bassa`/`stagione_alta` |

**Non integrate** (restano proposte del catalogo): stazioni del Centro Funzionale, meteo@uniparthenope, Open-Meteo Marine ed ERA5, BusOne, ViaggiaTreno, Trenitalia/Italo, OpenSky, Alilauro, quartieri ISTAT, farmacie, Sensor.Community, WAQI, radar DPC.

**Come sono etichettati i valori in pagina:** *dal vivo*, *fonte di riserva*, *ultimo dato salvato*, *snapshot*, *orario programmato*, *simulato*, *non disponibile*; la tabella "Fonti dei dati, stato e licenze" sotto la mappa mostra lo stato di ogni fonte con ora e licenza.

**Affollamento: cosa è implementato.** È ancora la stima del simulatore (`sim-config.json`, curva oraria per luogo con capienze indicative), modificata da due fattori reali dichiarati come ipotesi: gli eventi reali di oggi accendono `evento_<zona>` (persone in più: partita da 3 ore prima a 3 ore dopo il calcio d'inizio, navi dalle 8 alle 18, eventi grandi del Comune, regate) e la stagionalità ISTAT accende `stagione_bassa` (novembre: 0,52× la media, folla −20 % nei luoghi turistici, −10 % a Vomero, Sanità e Garibaldi) o `stagione_alta`. La formula completa della sezione 4.2 (base dai visitatori, profilo orario, fattore meteo) **non** è ancora implementata.

---

## 1. Sintesi

- **Cosa c'è di reale, aperto e verificato.** Meteo previsto e misurato: Open-Meteo con il modello italiano ICON-2I, MET Norway, il WRF dell'Università Parthenope e le 3 stazioni del Centro Funzionale Campania in città. Allerte: Centro Funzionale per la Zona 1 e Meteoalarm. Qualità dell'aria misurata dalle centraline ARPAC, che passa da EEA con 3-4 ore di ritardo. Mare, balneazione 2025 e terremoti dei Campi Flegrei (INGV). Per la mobilità: gli orari di ANM, EAV, Trenitalia e degli aliscafi Alilauro, le posizioni live dei bus ANM, i ritardi dei treni, le chiusure sulla Tangenziale e gli avvisi EAV. Per gli eventi: l'agenda del Comune e i calendari di Serie A, America's Cup e scali delle navi da crociera. Infine le basi statiche: visitatori mensili dei siti comunali, passeggeri del porto, presenze turistiche ISTAT, annunci Airbnb, quartieri e popolazione ISTAT 2021.
- **Cosa manca.** Prima di tutto le **presenze da rete mobile**, cioè il dato con cui Seoul misura la folla: in Italia non è pubblico e va chiesto agli sponsor Fastweb + Vodafone. Poi il **traffico urbano**: il Comune non ha open data, TomTom e HERE funzionano solo con una chiave, i dati ASPI coprono solo Tangenziale e autostrade. Mancano anche il tempo reale di metro, funicolari e treni EAV, l'occupazione dei parcheggi, lo sharing, il rumore e le isole di calore.
- **Come lo sostituiamo.** Con simulazioni dichiarate, che il regolamento della challenge ammette espressamente: "Dove mancano dati reali, puoi utilizzare simulazioni realistiche, spiegando le ipotesi adottate". L'affollamento di un luogo si calcola come base reale (visitatori mensili, passeggeri del porto) × stagionalità ISTAT × profilo orario × eventi del giorno (partita, navi in porto, regate, eventi del Comune) × meteo e allerta (nella demo di oggi solo eventi e stagionalità: vedi la sezione 0). In interfaccia ogni valore dice da dove viene: *dal vivo*, *snapshot*, *orario programmato*, *fonte di riserva* o *simulato*.
- **Cosa comporta in pratica.** Circa metà delle fonti non ha CORS. Servono un proxy con cache sul server del team (o un Worker Cloudflare nuovo, **non** `mbl-privato`) oppure snapshot JSON statici nella repo, che per la demo sono preferibili (sezione 2.5). La demo usa gli snapshot (sezione 0).

---

## 2. Catalogo per dominio

Nella colonna "Verifica" la data è quella della prova del verificatore.

### 2.1 Meteo, allerte e ambiente

| Fonte | Ente | Contenuto | Endpoint | Formato | Accesso | Licenza | CORS | Aggiornamento | Verifica | Uso nella mappa / agenti |
|---|---|---|---|---|---|---|---|---|---|---|
| Open-Meteo Forecast | Open-Meteo.com (ECMWF, DWD ICON, Météo-France, ItaliaMeteo-ARPAE ICON-2I) | Meteo attuale, previsioni orarie fino a 16 giorni, indice UV | [api.open-meteo.com/v1/forecast](https://api.open-meteo.com/v1/forecast?latitude=40.8359,40.8506&longitude=14.2488,14.2560&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,uv_index&daily=uv_index_max&timezone=Europe/Rome&forecast_days=2), con `&models=italia_meteo_arpae_icon_2i` | JSON (un array se si passano più coordinate) | aperto | Dati CC BY 4.0. API gratuita solo per uso non commerciale: meno di 10.000 chiamate al giorno, 5.000 l'ora, 600 al minuto | sì (`*`) | orario (current ogni 15 min) | Confermata con correzioni, 14/11. Ogni coordinata vale una chiamata (10 luoghi = costo 10). ICON-2I funziona ed è l'unica variante che distingue i luoghi | Scheda meteo di ogni luogo. Una chiamata unica per tutti i luoghi ogni 15 min con cache sul server: circa 960 chiamate al giorno |
| Allerta meteo Campania | Regione Campania, Protezione Civile, Centro Funzionale Decentrato | Avviso di allerta per oggi e domani; livello, fenomeni e scenari per zona (Napoli è la Zona 1) | [findLastAllertaNew](https://centrofunzionale.regione.campania.it/CentroFunzionalePortaleRest/rest/bollettinometeo/findLastAllertaNew), poi `.../bollettinometeo/findByIdZona/1/{idBollettino}`; per domani `.../findAllertaDomaniNew` | JSON | aperto (API interna del portale, non documentata) | Nessuna licenza aperta: "Copyright 2024 - Protezione Civile Regione Campania". Citare la fonte; per una ridistribuzione stabile chiedere il permesso | sì (rimanda qualsiasi Origin) | a ogni emissione, di norma una volta al giorno | Confermata con correzioni, 14/11. Il livello di Napoli va letto da findByIdZona/1. getPDF restituisce un JSON con il PDF in base64 | Banner di allerta e badge del livello. È la fonte ufficiale: va usata prima di Meteoalarm |
| Stazioni idro-meteo Campania | Regione Campania, Centro Funzionale | 213 stazioni con serie orarie. In città: Camaldoli e Capodimonte (solo pluviometro), Nisida (stazione completa) | [getAllStazioni](https://centrofunzionale.regione.campania.it/CentroFunzionalePortaleRest/rest/utils/getAllStazioni); serie `.../rest/recuperodati/temporeale/{idSensore}` | JSON | aperto (API interna) | Copyright Protezione Civile Regione Campania | sì (rimanda l'Origin) | orario (circa 50 valori, dalla mezzanotte di due giorni prima) | Confermata con correzioni, 14/11. Usare solo `value`; l'ultimo valore è parziale; fuso orario e unità del vento non sono dichiarati | Pioggia misurata (Capodimonte per centro storico e Sanità, Camaldoli per il Vomero); temperatura e vento di Nisida per i luoghi costieri |
| EEA E2a, centraline ARPAC | European Environment Agency (dati di ARPA Campania trasmessi tramite ISPRA) | PM10, NO2, PM2.5 e O3 orari; 18 stazioni nell'area "Napoli (greater city)" | [POST ParquetFile/urls](https://eeadmz1-downloads-api-appservice.azurewebsites.net/ParquetFile/urls); [metadati delle stazioni](https://discomap.eea.europa.eu/map/fme/metadata/PanEuropean_metadata.csv) (27 MB) | CSV con gli URL, poi un file Parquet per punto di campionamento (circa 400 KB, anno in corso) | aperto | Riuso libero, anche commerciale, citando l'EEA (legal notice). I dati E2a non sono validati | API sì; file Parquet no | orario, con 3,5-4,5 ore di ritardo (orari in UTC+01) | Confermata con correzioni, 14/11 | Aria misurata per zona, dalla centralina più vicina a ogni luogo. Un job orario sul server converte i Parquet in JSON |
| Open-Meteo Marine | Open-Meteo.com (MFWAM, ECMWF WAM, Copernicus Marine) | Onde, temperatura del mare, correnti | [marine-api.open-meteo.com](https://marine-api.open-meteo.com/v1/marine?latitude=40.83&longitude=14.24&current=wave_height,wave_direction,wave_period,sea_surface_temperature,ocean_current_velocity&hourly=wave_height&timezone=Europe/Rome&forecast_days=1) | JSON | aperto | CC BY 4.0, gratuita per uso non commerciale | sì (`*`) | orario | Confermata, 14/11. Tutta la costa cittadina finisce in una sola cella, al largo di Posillipo | Scheda mare per Lungomare, Mergellina, Castel dell'Ovo e Beverello |
| Open-Meteo Air Quality (CAMS) | Open-Meteo.com su dati Copernicus CAMS | AQI europeo, PM, NO2, O3, pollini, UV | [air-quality-api.open-meteo.com](https://air-quality-api.open-meteo.com/v1/air-quality?latitude=40.8359,40.8506,40.8303&longitude=14.2488,14.2560,14.2172&current=european_aqi,pm10,pm2_5,nitrogen_dioxide,ozone,olive_pollen,grass_pollen&domains=cams_europe&timezone=Europe/Rome) | JSON | aperto | CC BY 4.0, attribuzione a Copernicus | sì (`*`) | orario, previsione a 5 giorni | Confermata con correzioni, 14/11. Con `domains=cams_europe` l'UV è null: va chiesto senza `domains`. Con una griglia di 11 km tutti i luoghi hanno lo stesso valore | Fondo regionale, previsione dell'AQI e pollini. Non distingue un luogo dall'altro |
| ARPAC Open Data | ARPA Campania | Qualità dell'aria (orari NRT e dati validati), balneazione, Ostreopsis | [package_show (CKAN)](https://dati.arpacampania.it/api/3/action/package_show?id=dati-grezzi-orari-qualita-aria) | CSV mensili da un catalogo CKAN | aperto (dichiarato) | CC BY 4.0 secondo le pagine indicizzate; non verificata | non verificato | NRT orari, validati giornalieri | Non verificabile: irraggiungibile da questo IP (reset e timeout dell'upstream, non un blocco di policy) | Fonte primaria ufficiale, se risponde dalla rete italiana o dal server del team |
| meteo@uniparthenope | Università di Napoli Parthenope, CMMMA | Modelli WRF (meteo) e WW3 (onde) per luoghi di Napoli: città, Baia, Rada S. Lucia, porto, stadio, Lungomare | [wrf5/forecast/com63049](https://api.meteo.uniparthenope.it/products/wrf5/forecast/com63049); serie `.../wrf5/timeseries/com63049?hours=24&step=1`; onde `.../ww33/forecast/ca004` | JSON (anche CSV); Swagger su `/swagger.json` | aperto | Nessuna licenza. Il disclaimer dice che i dati sono forniti "as is" e non sostituiscono gli avvisi ufficiali. Citare meteo@uniparthenope | sì (rimanda l'Origin) | corse del modello quotidiane, previsione oraria a 7 giorni | Confermata con correzioni, 14/11. `/forecast/` funziona e restituisce l'ora corrente in 947 B. Orari in UTC | Previsioni "fatte a Napoli" per i luoghi costieri e per lo stadio; onde più dettagliate vicino alla costa |
| Meteoalarm Italia | EUMETNET Meteoalarm, su dati dell'Aeronautica Militare | Avvisi CAP per regione, in italiano e in inglese | [feeds-italy](https://feeds.meteoalarm.org/api/v1/warnings/feeds-italy) | JSON (struttura CAP) | aperto | Termini da verificare prima di ridistribuire | no | più volte al giorno | Confermata con correzioni, 14/11. Il 13/11 c'erano giallo pioggia e temporali e arancione vento, non solo verde. Per domenica 15/11 c'è un arancione per temporali. Filtrare per onset ed expires | Seconda fonte di allerta, con testi in inglese utili ai turisti. Va letta dal server |
| EEA Bathing Water 2025 (ArcGIS) | EEA (dati e coordinate delle autorità nazionali) | Classe di balneazione dal 2015 al 2025, con nome e coordinate degli 11 siti di Napoli | [BathingWater_Dyna_WM_2025](https://water.discomap.eea.europa.eu/arcgis/rest/services/BathingWater/BathingWater_Dyna_WM_2025/MapServer/3/query?where=bathingWaterIdentifier%20LIKE%20'IT015063049%25'&outFields=*&outSR=4326&f=json) | JSON (ArcGIS) | aperto | Riuso EEA con attribuzione | sì (rimanda l'Origin) | annuale | Aggiunta dal verificatore, 14/11. 11 siti: 9 Excellent, Via Partenope Good, Pietrarsa Poor. Sostituisce la query discodata 2024 della ricerca, che non ha CORS né nomi o coordinate dei siti | Livello statico "qualità del mare" con il badge della classe |
| Open-Meteo Historical (ERA5) | Open-Meteo.com su ERA5 ed ERA5-Land (Copernicus C3S) | Clima dal 1940 | [archive-api.open-meteo.com](https://archive-api.open-meteo.com/v1/archive?latitude=40.8359&longitude=14.2488&start_date=2025-01-01&end_date=2025-12-31&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=Europe/Rome) | JSON (CSV con `&format=csv`) | aperto | CC BY 4.0, gratuita per uso non commerciale | sì (`*`) | con best_match fino al giorno prima; ERA5 puro con `models=era5` | Confermata con correzioni, 14/11. Un anno di 3 variabili giornaliere costa circa 7,8 chiamate | Snapshot statico nella repo per le anomalie (la media delle massime di novembre 2025 è 17,2 °C) |
| MET Norway Locationforecast | Norwegian Meteorological Institute | Previsione a 10 giorni | [locationforecast/2.0/compact](https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=40.836&lon=14.249) | JSON (GeoJSON) | aperto | CC BY 4.0. User-Agent identificativo obbligatorio, coordinate con al massimo 4 decimali, rispettare Expires | sì (`*`) | circa orario | Confermata, 14/11 | Riserva quando Open-Meteo risponde 429 |
| INGV, terremoti | INGV | Eventi sismici (FDSN), compresi i Campi Flegrei | [fdsnws/event](https://webservices.ingv.it/fdsnws/event/1/query?starttime=2026-11-01T00:00:00&minlat=40.75&maxlat=40.90&minlon=14.00&maxlon=14.25&minmag=0&format=geojson&orderby=time&limit=50) | GeoJSON | aperto | CC BY 4.0 | sì (`*`) | tempo reale | Aggiunta dal verificatore, 14/11. 5 eventi dal 1/11, per esempio Md 2.6 ai Campi Flegrei il 13/11 alle 07:22 | Scheda "rischi naturali" (bradisismo) per Napoli ovest: Bagnoli, Fuorigrotta, Posillipo, Maradona |
| Sensor.Community | Sensor.Community (ex Luftdaten) | Sensori civici di PM e temperatura | [filter/area](https://data.sensor.community/airrohr/v1/filter/area=40.85,14.25,20) | JSON | aperto | DbCL 1.0 secondo il sito ufficiale (la ricerca indicava ODbL senza fonte) | sì (`*`) | ogni 5 min | Confermata con correzioni, 14/11. Nessun sensore dentro il Comune: 9-13 letture, tutte nell'area vesuviana | Strato facoltativo "sensori dei cittadini", utile soprattutto per il racconto della demo |
| WAQI / aqicn.org | World Air Quality Index Project | AQI per stazione (riprende ARPAC) | `https://api.waqi.info/feed/geo:40.85;14.25/?token=TOKEN` | JSON | chiave gratuita | I termini vietano di ridistribuire dati in cache o archiviati. Attribuzione a WAQI e all'ente che produce il dato | sì (`*`) | orario | Non verificabile: con il token demo restituisce sempre Shanghai. Anche OpenAQ v3 senza chiave risponde 401 | Solo chiamate dirette dal browser, senza cache |
| DPC, radar e bollettini | Dipartimento della Protezione Civile | Radar della pioggia (SRI ogni 5 min) e bollettini di criticità | `https://radar-api.protezionecivile.it/wide/product/findLastProductByType?type=SRI`; repository `pcm-dpc/DPC-Bollettini-Criticita-Idrogeologica-Idraulica` | JSON con GeoTIFF; repository | aperto | CC BY 4.0 (README del repository) | non verificabile | 5 min (radar), giornaliero entro le 16 (bollettini) | Non verificabile: 403 di Akamai lato server, non del proxy. Il README non descrive struttura né formato dei file | Facoltativo: pioggia in atto sovrapposta alla mappa |
| EEA END, rumore | EEA | Mappe acustiche strategiche (strade, giorno) | `https://noise.discomap.eea.europa.eu/arcgis/rest/services/Noise/roads_day/ImageServer/identify?...` | JSON (ArcGIS) | aperto | non indicata | sì | n/d | Aggiunta dal verificatore: funziona ma non serve. Restituisce sempre il valore 12 (anche a Milano e Roma), senza legenda | Nessun uso: il rumore va simulato |

### 2.2 Mobilità e trasporti

| Fonte | Ente | Contenuto | Endpoint | Formato | Accesso | Licenza | CORS | Aggiornamento | Verifica | Uso nella mappa / agenti |
|---|---|---|---|---|---|---|---|---|---|---|
| GTFS ANM | ANM (pubblicato anche come dataset del Comune) | Orari di metro L1, L6 e L2 (agency FS), funicolari F1, F3 e F4, tram, filobus e bus: 2.392 fermate, 112 linee | [anm.it/google/google-transit.zip](https://www.anm.it/google/google-transit.zip); copia con CORS [mdb-893](https://files.mobilitydatabase.org/mdb-893/latest.zip) | GTFS zip (senza feed_info) | aperto | CC BY 4.0, ma dichiarata solo sul dataset del Comune su dati.gov.it; il file di anm.it non dichiara una licenza | ufficiale no; copia sì (`*`) | calendario dal 09/11 al 31/12/2026 | Confermata con correzioni, 14/11. Manca la funicolare F2 Montesanto; i filobus hanno route_type 11, i tram 0 | Fermate di metro e funicolari vicino ai luoghi; corse per ora come frequenza e capacità |
| ANM in tempo reale (BusOne) | BusOne, aggregatore privato: non è una fonte ufficiale ANM | Posizioni GPS e TripUpdates di bus, tram e filobus | [vehicle-positions.json](https://proxy.busone.app/anm/gtfs-rt/vehicle-positions.json); `.../trip-updates.json`; versioni `.pb`; `/anm/status`; WebSocket `/anm/ws` | GTFS-RT (protobuf e JSON) | aperto senza chiave; il limite di richieste è dichiarato in due modi diversi | Gratis solo per uso non commerciale di privati, enti non profit e ONG, con attribuzione obbligatoria. Altre organizzazioni e usi commerciali: consenso scritto | sì (`*`) | circa 10 s (il GPS cambia ogni 30 s circa) | Confermata con correzioni, 14/11. Mandare subito gli header X-BusOne-Client e X-BusOne-Use. I TripUpdates sono previsioni del modello BusOne | Livello "mezzi in movimento" e ritardi entro 500 m dai luoghi. Un solo proxy sul server, non ogni browser |
| ViaggiaTreno | RFI / Trenitalia | Partenze e arrivi in tempo reale per stazione, compresa la Linea 2 | `http://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno/partenze/{codStazione}/{data in formato JS}` (anche `arrivi/...` e `autocompletaStazione/NAPOLI`) | JSON | aperto ma non documentato. Senza un User-Agent da browser Akamai risponde 403 | nessuna (API interna del sito) | no | tempo reale | Confermata, 14/11 | Pannello treni per Garibaldi (S09218, S09109), Mergellina (S09105), Campi Flegrei (S09103), Montesanto (S09107). Proxy con cache e una riserva simulata |
| Transitous (MOTIS) | Progetto comunitario Transitous | Prossime partenze di più operatori (ANM, EAV, Trenitalia con la L2), ricerca delle fermate, itinerari | [geocode](https://api.transitous.org/api/v1/geocode?text=Napoli%20Piazza%20Garibaldi&type=STOP); [stoptimes](https://api.transitous.org/api/v1/stoptimes?stopId=it-trenitalia_09109:station&n=10) | JSON | aperto | Servizio best-effort, solo per progetti open source, non commerciali e leggeri. User-Agent con nome dell'app, versione e contatto; link visibile a transitous.org/sources | sì (`*`) | tempo reale dove c'è (di notte `realTime=false`) | Aggiunta dal verificatore, 14/11 | Prossime partenze per i 10 luoghi direttamente dal browser, senza convertire GTFS e NeTEx |
| GTFS EAV | EAV srl | Circumvesuviana, Cumana, Circumflegrea, Metrocampania Nord (le autolinee sono scadute) | [wimob.it google-transit.zip](https://www.wimob.it/cfile/download.php?file=google-transit.zip); copia con CORS [tld-4833](https://files.mobilitydatabase.org/tld-4833/latest.zip) | GTFS zip | aperto | non indicata | ufficiale no; copia sì | ferrovia dal 12/11/2026 al 31/12/2030; autolinee solo fino a ottobre 2025 | Confermata, 14/11 | Stazioni EAV vicine ai luoghi (Porta Nolana, Garibaldi, Montesanto, Mostra); corse per ora; linee verso Pompei e Sorrento per i flussi turistici |
| Infomobilità EAV | EAV srl (API REST di WordPress) | Avvisi su guasti, scioperi e ascensori fuori servizio | [wp-json/wp/v2/posts](https://www.eavsrl.it/wp-json/wp/v2/posts?categories=41,21,17,65&per_page=20&_fields=date,title,link,categories); [RSS](https://www.eavsrl.it/feed/) | JSON, RSS 2.0 | aperto | non indicata | sì (rimanda l'Origin) | più volte al giorno | Confermata, 14/11. Nei titoli ci sono entità HTML da decodificare | Riquadro "stato del servizio": avvisi collegati alla stazione per nome, badge sciopero, avvisi sull'accessibilità |
| Eventi ASPI e Tangenziale | Autostrade per l'Italia | Chiusure, code, cantieri e webcam su A56 Tangenziale e accessi autostradali | [eventi.json](https://viabilita.autostrade.it/json/eventi.json) (anche `cantieri.json` e `webcams.json`) | JSON | aperto (endpoint interno) | "Tutti i diritti riservati": citare la fonte e usarlo solo come dato di contesto | sì (`*`) | tempo reale | Confermata con correzioni, 14/11. `d_agg` è un campo di ogni evento | Livello traffico su Tangenziale e uscite (Fuorigrotta, Capodichino, Corso Malta). `lunghezzaCoda` e `n_vel_med` danno un indice di congestione |
| Trenitalia e Italo (BusOne) | BusOne, sul NeTEx Trenitalia del NAP | GTFS nazionale e ritardi in GTFS-RT; GTFS di Italo | [trenitalia/gtfs.zip](https://proxy.busone.app/trenitalia/gtfs.zip) (25 MB); [trip-updates.json](https://proxy.busone.app/trenitalia/gtfs-rt/trip-updates.json); [italo/gtfs.zip](https://proxy.busone.app/italo/gtfs.zip) | GTFS, GTFS-RT, SIRI-ET | aperto | Termini BusOne: non commerciale con attribuzione. Italo, secondo BusOne, è gratuito anche per uso commerciale | sì (`*`) | GTFS ricostruito ogni giorno, RT continuo | Confermata, 14/11. Le posizioni dei treni sono sintetiche: non vanno disegnate come reali | Ritardi di regionali e L2, con CORS. Arrivi pianificati a Garibaldi |
| NAP Italia, NeTEx Campania | MIT, CCISS (dati del RAP Regione Campania) | Orari di 13 operatori; l'unico orario aperto di aliscafi dal Beverello (Alilauro) | `https://www.cciss.it/nap/mmtis/public/api/v1/download/blob/Asset/{id}/resource` (Alilauro 572463, ANM 647946, EAV 1971690); [pagina del dataset 1481](https://www.cciss.it/nap/mmtis/public/en/catalog/Dataset/1481) | NeTEx XML compresso con gzip | aperto | "No licence – No contract" (nessuna licenza esplicita e nessun contratto richiesto) | sì (rimanda l'Origin) | pubblicazioni di fine ottobre 2026; gli id cambiano a ogni versione | Confermata con correzioni, 14/11. Gli asset di sharing (Lime, Voi, Bird, Amicar) sono vuoti | Partenze per ora dal Beverello come stima dell'afflusso al molo. Conversione in JSON sul server |
| OpenStreetMap via Overpass | OpenStreetMap | Parcheggi con capienza, stazioni, moli, posteggi taxi, punti di interesse turistici | `https://overpass-api.de/api/interpreter`; copia `https://maps.mail.ru/osm/tools/overpass/api/interpreter` | JSON | aperto | ODbL 1.0 | copia mail.ru sì (`*`) | minuti | Bloccata dalla sandbox (overpass-api.de). La copia mail.ru va e viene: in una verifica ha risposto 200 (174 punti di interesse turistici), in un'altra ha dato tre volte 504 | Snapshot GeoJSON statico nella repo, da scaricare dalla rete dell'evento |
| TomTom / HERE Traffic | TomTom; HERE Technologies | Velocità e incidenti sulle strade urbane | `https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json?point=40.8518,14.2681&key=KEY`; `https://data.traffic.hereapi.com/v7/flow?in=circle:40.85,14.26;r=1000&locationReferencing=shape&apiKey=KEY` | JSON | chiave gratuita | Termini commerciali con un piano gratuito; limiti non verificati | sì per entrambi | circa 1 min | Non verificabile: senza chiave risponde 401 | Unica via per il traffico urbano reale: rapporto tra currentSpeed e freeFlowSpeed vicino ai luoghi. Chiave tenuta sul server |
| Assaeroporti | Assaeroporti | Passeggeri e movimenti mensili di Capodichino | [download-export/2026/9](https://data-upload.assaeroporti.com/download-export/2026/9) | XLSX | aperto | non indicata: citare Assaeroporti | no | mensile (ultimo mese disponibile: settembre 2026) | Confermata, 14/11. Un mese non ancora pubblicato risponde 200 con un file vuoto | Base statica per l'aeroporto: 1.483.050 passeggeri a settembre 2026 |
| OpenSky Network | OpenSky Network | Aerei in volo nel riquadro di Napoli | [states/all](https://opensky-network.org/api/states/all?lamin=40.70&lomin=14.05&lamax=41.05&lomax=14.55) | JSON | anonimo con 400 crediti al giorno | Uso non commerciale o di ricerca; termini non verificati (la pagina risponde 403) | no | risoluzione di 10 s | Confermata con correzioni, 14/11. Con una chiamata ogni 10 s la quota finisce in circa 67 minuti | Indicatore "aeroporto attivo", con una chiamata ogni 4-5 minuti dal proxy |
| Validazioni TPL Campania | Regione Campania (con ACaMIR) | Validazioni dei titoli di viaggio per fermata e ora | `https://dati.regione.campania.it/catalogo/resources/validazioni.csv`; copia Wayback `http://web.archive.org/web/20251220052523id_/https://dati.regione.campania.it/catalogo/resources/validazioni.csv` | JSON / CSV | aperto (dai metadati) | CC BY 4.0 (metadati di dati.gov.it) | non verificabile | estratto unico del 28/06/2023 | Non verificabile: host irraggiungibile (502) e copia Wayback bloccata dalla sandbox | Se contiene fermate e orari: profilo orario dei passeggeri per stazione |
| ANM, stato del servizio e parcheggi | ANM | Stato di metro e funicolari, attese in banchina, posti liberi nei parcheggi | nessun endpoint pubblico | n/d | non pubblico | n/d | n/d | n/d | Non funziona: non c'è un'API, il tempo reale è solo nell'app ANM Go | Simulato e dichiarato; da chiedere ad ANM tramite i mentor |
| AIS Stream | aisstream.io | Posizioni AIS di aliscafi e traghetti nel golfo | `wss://stream.aisstream.io/v0/stream` | WebSocket con messaggi JSON | chiave gratuita | termini di aisstream.io (non letti nel dettaglio) | no: la documentazione vieta le connessioni dirette dal browser | streaming | Non verificabile: serve una chiave | Unico tempo reale possibile per il mare; serve un processo sempre attivo sul server |

Utili anche: il catalogo dei feed GTFS di Mobility Database, [feeds_v2.csv](https://files.mobilitydatabase.org/feeds_v2.csv), e il GTFS ANM rielaborato da BusOne, [anm/gtfs.zip](https://proxy.busone.app/anm/gtfs.zip). Quest'ultimo ha CORS ed è coerente con i `route_id` del tempo reale, ma ricade nei termini BusOne.

### 2.3 Eventi e turismo

| Fonte | Ente | Contenuto | Endpoint | Formato | Accesso | Licenza | CORS | Aggiornamento | Verifica | Uso nella mappa / agenti |
|---|---|---|---|---|---|---|---|---|---|---|
| Agenda eventi del Comune | Comune di Napoli | 10 eventi in corso e in arrivo, con luogo in testo libero, tipo e costi | [wp-json/api/v1/news](https://www.comune.napoli.it/wp-json/api/v1/news); RSS [feed/?post_type=evento](https://www.comune.napoli.it/feed/?post_type=evento) | JSON (API WordPress personalizzata), RSS | aperto | CC BY 4.0 secondo le note legali del sito; le immagini possono essere di terzi | no | più volte a settimana | Confermata con correzioni, 14/11. Niente paginazione né coordinate. Gli orari sono l'ora locale scritta come se fosse UTC | Livello eventi e aumento dell'affollamento nel luogo vicino (es. Tri Gold Caracciolo sul Lungomare il 14-15/11). Proxy con cache |
| Calendario Serie A (openfootball) | openfootball | Le 380 partite 2026/27, 19 delle quali in casa del Napoli | [it.1.json](https://raw.githubusercontent.com/openfootball/football.json/master/2026-27/it.1.json) | JSON (servito come text/plain) | aperto | CC0 1.0 (LICENSE.md del repository) | sì (`*`) | curato da volontari: risultati solo fino alla 5ª giornata, orari delle giornate lontane null | Confermata, 14/11 | Agente "Maradona": partite in casa (Napoli-Torino il 21/11 alle 20:45) |
| TheSportsDB | TheSportsDB | Prossima e ultima partita del Napoli (id 133670) | [eventsnext](https://www.thesportsdb.com/api/v1/json/123/eventsnext.php?id=133670); `eventslast.php?id=133670` | JSON | chiave pubblica di prova "123" | Termini di TheSportsDB: citare la fonte; con la chiave gratuita niente app negli store; 30 richieste al minuto | sì (`*`) | quasi in tempo reale | Confermata con correzioni, 14/11. Con la chiave gratuita non si può dimostrare che copra le coppe europee. Orari in UTC | Conto alla rovescia "prossimo evento al Maradona" e controllo incrociato degli orari |
| Visitatori dei siti comunali | Comune di Napoli (CKAN dati.comune.napoli.it) | Visitatori mensili di 8 siti: Maschio Angioino, Castel dell'Ovo, PAN, San Domenico Maggiore, San Severo al Pendino, Casina Pompeiana, Pausilypon, Real Casa dell'Annunziata | [package_search?q=visitatori](https://dati.comune.napoli.it/api/3/action/package_search?q=visitatori&rows=20); [datastore del Maschio Angioino 2025](https://dati.comune.napoli.it/api/3/action/datastore_search?resource_id=765e5b88-898a-4488-a7ba-337d4ecc2cf0) | CSV con `;`, JSON CKAN | aperto | CC BY ("cc-by" in CKAN; CC BY 4.0 secondo le note legali del Comune) | sì (`*`) | annuale | Confermata con correzioni, 14/11. Il server è lento (9-55 s). Castel dell'Ovo è chiuso per lavori nel 2024-2025, il PAN nel 2025 | Base reale dell'affollamento: Maschio Angioino per Plebiscito e Beverello, Castel dell'Ovo con i dati 2019, siti del centro storico, Casina Pompeiana per il Lungomare, Pausilypon per Mergellina |
| Bollettini del Porto di Napoli | AdSP del Mar Tirreno Centrale | Crocieristi e passeggeri locali del golfo, per mese | [bollettino 12 mesi 2025](https://adsptirrenocentrale.it/wp-content/uploads/2026/03/12_Bollettino-statistico-12-mesi-2025.pdf); [6 mesi 2026](https://adsptirrenocentrale.it/wp-content/uploads/2026/11/6_Bollettino-statistico-6-mesi-2026.pdf) | PDF | aperto | Diritti riservati secondo le note legali: citare pochi valori aggregati; per un JSON derivato nella repo chiedere il permesso | no | mensile con cumulato da inizio anno, pubblicato con mesi di ritardo | Confermata con correzioni, 14/11. A dicembre 2025 i crocieristi sono stati 61.350, non 130.092 (quella è la cifra degli imbarchi home port in tutto il 2025) | Base per il Molo Beverello: nel 2025 6.654.994 passeggeri locali e 1.829.254 crocieristi |
| Cruise Timetables | sito privato, non ufficiale | Calendario degli scali delle navi da crociera a Napoli | [RSS di Napoli](https://www.cruisetimetables.com/cruises-to-naples-italy.xml) | RSS (ISO-8859-1) | aperto, con un User-Agent da browser (altrimenti 403 del sito) | Proprietaria: va bene per la demo citando la fonte, per un uso pubblico serve il permesso | no | giornaliero | Confermata, 14/11. Per gli anni lontani la copertura è incompleta | Agente "porto": giorni con navi in porto (16/11: Celebrity Equinox, MSC Magnifica, Oceania Marina) |
| Musei statali (MiC) | Ministero della Cultura, Ufficio di Statistica | Visitatori annui di MANN, Capodimonte, Palazzo Reale, Castel Sant'Elmo, Certosa di San Martino | `https://statistica.cultura.gov.it/wp-content/uploads/2025/05/MUSEI_TAVOLA7_2024-1.pdf` (URL non confermato) | PDF | aperto | non verificata | non verificabile | annuale | Bloccata dalla sandbox. Non è dimostrato nemmeno che l'URL esista | Base annuale dei musei statali; nel frattempo i valori di Wikidata |
| ISTAT, turismo e capacità ricettiva | ISTAT (SDMX REST, esploradati) | Arrivi e presenze mensili della provincia di Napoli (ITF33); posti letto del Comune; ingressi nei musei per comune (fino al 2020) | `https://esploradati.istat.it/SDMXWS/rest/data/122_54_DF_DCSC_TUR_3/M.ITF33.........?startPeriod=2024-06` | SDMX-CSV | aperto | CC BY 4.0 | no | mensile, con circa 11 mesi di ritardo (ultimo mese 2025-12) | Confermata con correzioni, 14/11. La capacità comunale arriva al 2025, ma nel 2025 la serie si rompe (entrano gli alloggi in affitto) | Fattore stagionale (mese rispetto alla media annua) e quota di stranieri, in un JSON precalcolato |
| Inside Airbnb | Inside Airbnb | 11.737 annunci geolocalizzati nel Comune | [listings.csv](https://data.insideairbnb.com/italy/campania/naples/2026-09-19/visualisations/listings.csv) (anche `neighbourhoods.geojson` e `data/calendar.csv.gz`) | CSV, GeoJSON | aperto | CC BY 4.0 | sì (`*`) | istantanea trimestrale (ultima del 19/09/2026) | Confermata, 14/11 | Peso per distribuire le presenze ISTAT tra i quartieri; mappa di calore "dove dormono i turisti", solo con dati aggregati |
| Wikipedia pageviews | Wikimedia Foundation | Visite giornaliere a una voce | `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/it.wikipedia/all-access/user/{Titolo}/daily/{AAAAMMGG}/{AAAAMMGG}` | JSON | aperto (User-Agent obbligatorio; dal browser `Api-User-Agent`) | CC0 1.0 | sì (`*`) | giornaliero, con 1-2 giorni di ritardo | Confermata, 14/11 | Indice di interesse relativo tra luoghi e picchi legati agli eventi. Misura l'interesse online, non le presenze: va dichiarato |
| Wikidata SPARQL | Wikimedia Foundation | Coordinate e visitatori annui dei luoghi di Napoli | [query.wikidata.org](https://query.wikidata.org/) (query in sezione 3.8) | JSON (risultati SPARQL) | aperto | CC0 | sì (`*`) | continuo | Confermata con correzioni, 14/11. 369 righe su 121 luoghi, con duplicati. Palazzo Reale, Sant'Elmo e San Martino si fermano al 2022 | Riserva per i musei statali; codici Q per collegare OSM e Wikipedia |
| America's Cup 2027 | America's Cup (sito ufficiale); Comune di Napoli (comunicato) | Calendario ufficiale: Louis Vuitton Cup, Youth e Women's America's Cup, Match | [schedule-ac38.json](https://www.americascup.com/json/schedule-ac38.json); [comunicato del 21/01/2026](https://static-www.comune.napoli.it/wp-content/uploads/2026/01/260121_ACP_TEAMS_Press-Release_ITA.pdf) | JSON, PDF | aperto | non dichiarata: citare la fonte | no | JSON aggiornato il 13/11/2026 | Confermata con correzioni, 14/11. Il JSON ufficiale, trovato dal verificatore, sostituisce le date riprese dalla stampa | Scenario "Napoli 2027": giorni di regata su Lungomare, Mergellina e Castel dell'Ovo |
| Nager.Date | Nager.Date | Festività nazionali | [PublicHolidays/2027/IT](https://date.nager.at/api/v3/PublicHolidays/2027/IT) | JSON | aperto | non verificata | sì (`*`) | n/d | Aggiunta dal verificatore, 14/11. Manca San Gennaro (19/09), da aggiungere a mano | Fattore "giorno festivo o ponte" |
| football-data.org | football-data.org | Calendario e risultati di Serie A e Champions League | `https://api.football-data.org/v4/teams/113/matches?status=SCHEDULED` (header X-Auth-Token) | JSON | chiave gratuita | Termini di football-data.org; nel piano gratuito orari e risultati arrivano in ritardo | no (consentito solo localhost) | n/d | Non verificabile: senza chiave risponde 403 | Alternativa per gli orari ufficiali, dal server |
| Presenze da rete mobile | Fastweb + Vodafone (sponsor della C5: un'unica azienda) | Persone presenti per area e ora, residenti e turisti | nessun endpoint pubblico | n/d | non pubblico | proprietaria, solo su accordo | n/d | potenzialmente orario | Non verificabile: in Italia non esistono dati aperti di questo tipo (vedi sezione 4) | È il dato "alla Seoul": da chiedere ai mentor al checkpoint |

### 2.4 Territorio, servizi e cataloghi

| Fonte | Ente | Contenuto | Endpoint | Formato | Accesso | Licenza | CORS | Aggiornamento | Verifica | Uso nella mappa / agenti |
|---|---|---|---|---|---|---|---|---|---|---|
| Basi territoriali ISTAT (ASC 2021) | ISTAT | Confini e popolazione dei 30 quartieri e delle 10 municipalità | [ASC_21.zip](https://www.istat.it/wp-content/uploads/2025/04/ASC_21.zip) (9,4 MB); sezioni di censimento della Campania [R15_21.zip](https://www.istat.it/storage/cartografia/basi_territoriali/2021/R15_21.zip) | Shapefile in UTM 32N, tabelle CSV (separate da TAB), XLSX, ODS | aperto | CC BY 4.0 | no | censimento 2021 (file sostituito il 14/05/2026) | Confermata con correzioni, 14/11. Il livello 2 non dice a quale municipalità appartiene un quartiere. Il primo URL della ricerca per R15_21 dava 404 | Mappa colorata di quartieri e municipalità e assegnazione dei luoghi a un quartiere. GeoJSON statico nella repo |
| ISTAT, popolazione residente | ISTAT (SDMX) | Residenti del Comune al 1° gennaio | `https://esploradati.istat.it/SDMXWS/rest/data/IT1,22_289_DF_DCIS_POPRES1_18,1.0/A.063049.JAN.9.TOTAL.99?startPeriod=2024` | SDMX-CSV | aperto | CC BY 4.0 | no | annuale | Confermata, 14/11. 905.050 residenti nel 2026 (stima) | Riportare i quartieri del 2021 al 2026 (905.050 / 921.142 = 0,9825 circa) |
| Farmacie | Ministero della Salute | Elenco nazionale con coordinate: a Napoli 318 farmacie attive, 314 con coordinate | [pagina del dataset](https://www.dati.salute.gov.it/it/dataset/farmacie/) (file del giorno, es. `FRM_FARMA_5_20261113.csv`) | CSV con `;`, JSON, XML | aperto | IODL 2.0 (non CC BY 4.0 come scriveva la ricerca) | no | quotidiano | Confermata con correzioni, 14/11. Il nome del file va letto dalla pagina | Livello farmacie: snapshot GeoJSON di circa 30 KB. Non ci sono turni né orari |
| Parcheggi ANM | Comune di Napoli / ANM (CKAN) | 23 parcheggi con posti, orari, tariffe e coordinate | [parcheggi_anm_2025.csv](https://dati.comune.napoli.it/dataset/b9b21365-c509-4f4d-92a5-981091447ae8/resource/2e1586f6-5cb8-40ac-9047-2e1ff56d8ee8/download/parcheggi_anm_2025.csv) | CSV con `;` (cp1252) | aperto | CC BY 4.0 | sì (`*`) | statico (13/10/2025) | Confermata con correzioni, 14/11. Una coordinata è malformata e CDN-P5 compare due volte (sono due ingressi della stessa struttura) | Parcheggi di interscambio con la capienza (Brin 1.330 posti in questo file, 800 secondo OSM). Occupazione simulata |
| IndicePA | AgID / IndicePA | 138 unità organizzative del Comune, con le sedi delle 10 municipalità | `https://indicepa.gov.it/ipa-dati/api/3/action/datastore_search?resource_id=b0aa1f6c-f135-4c8a-b416-396fed4e1a5d&filters={"Codice_IPA":"c_f839"}&limit=1000` | JSON (CKAN) | aperto | CC BY 4.0 | sì (`*`) | continuo | Confermata, 14/11. Senza coordinate | Sedi delle municipalità per il cittadino, da geocodificare una volta |
| Altri dataset del CKAN comunale | Comune di Napoli | Incidenti stradali (totali annui), 54 parchi, aperture e cessazioni di attività per municipalità, stradario | [package_list](https://dati.comune.napoli.it/api/3/action/package_list) (40 dataset) | CSV con `;` | aperto | CC BY 4.0 | sì (`*`) | annuale o saltuario | Confermata con correzioni, 14/11. Gli incidenti ci sono solo per alcuni anni (2012, 2017, 2018, 2022-2024) e non sono georeferenziati | Indicatori di sicurezza stradale (2024: 35 incidenti mortali, 3.514 feriti), verde per quartiere |
| dati.gov.it | AgID | Metacatalogo: Comune (39 dataset), Città Metropolitana (96), Regione (370) | [package_search](https://www.dati.gov.it/opendata/api/3/action/package_search?fq=organization:comune-di-napoli&rows=1000) | JSON (CKAN) | aperto | licenza indicata dataset per dataset | sì (`*`) | harvesting settimanale | Confermata, 14/11. Alcuni URL delle risorse sono vecchi | Ricerca di dataset e metadati dei portali irraggiungibili. Non è una fonte di dati diretta |
| Open data Regione Campania | Regione Campania | Strutture ricettive (al 30/04/2024), farmacie in GeoJSON, centraline dell'aria (storico 2018-2019) | `https://dati.regione.campania.it/catalogo/resources/elenco_strutture_ricettive_30042024.csv` (URL presi dai metadati di dati.gov.it) | GeoJSON, CSV, JSON | aperto | Secondo i metadati CC BY 4.0; strutture ricettive al 30/04/2024 in pubblico dominio | non verificabile | variabile | Bloccata dalla sandbox: CONNECT 502, host irraggiungibile (vedi la nota sotto la tabella) | Posti letto per zona come misura della pressione turistica |
| Città Metropolitana di Napoli | Città Metropolitana di Napoli | Defibrillatori, segnalazioni georeferenziate, conferimenti di rifiuti 2019-2021 | `https://dati.cittametropolitana.na.it/api/3/action/package_list`; `https://crmurp.cittametropolitana.na.it/defibrillatori/Defibrillatori-CMNA.json` | CSV, JSON | aperto | CC BY 4.0 secondo i metadati | non verificabile | metadati del 24/10/2026, dati 2019-2022 | Bloccata dalla sandbox (reset e 503) | Defibrillatori, livello "problemi segnalati" |
| TIM Big Data Challenge (Milano 2013) | Telecom Italia / Harvard Dataverse | Attività telefonica su una griglia di 235 m: SMS, chiamate, Internet, ogni 10 minuti | [pagina del dataset](https://dataverse.harvard.edu/dataset.xhtml?persistentId=doi:10.7910/DVN/EGZHFV) | TXT/TSV giornalieri (circa 320 MB l'uno) | aperto, ma il download chiede di compilare un guestbook (nome, email, istituzione) | ODbL 1.0 | sì (API dei metadati) | statico (2013) | Confermata con correzioni, 14/11. Verificati solo metadati e licenza | Forma della curva oraria e settimanale, dichiarata come "derivata da Milano 2013". Napoli non c'è |

Nota sulla Regione Campania: due ricercatori davano `dati.regione.campania.it` per inesistente (NXDOMAIN). Il verificatore ha però osservato che nella sandbox il DNS passa dal proxy, quindi la cosa non è dimostrata, e la Wayback Machine conserva una copia del 20/12/2025 di un file di quel dominio. Va riprovato dalla rete dell'evento.

### 2.5 Chiamate dal browser o dal server

- **Direttamente dal browser (CORS ok), anche su GitHub Pages:** Open-Meteo (tutti gli host), MET Norway, Centro Funzionale Campania, Parthenope, INGV, EEA Bathing Water (ArcGIS), Sensor.Community, BusOne, Transitous, avvisi EAV, ASPI, NAP, copie GTFS di Mobility Database, CKAN del Comune, IndicePA, dati.gov.it, openfootball, TheSportsDB, Inside Airbnb, Wikimedia, Wikidata, Nager.Date, l'API dell'EEA che elenca i file sull'aria (ma non i file Parquet). WAQI va chiamato **solo** dal browser, perché i termini vietano la cache.
- **Solo dal server o da snapshot:** file Parquet dell'EEA, Meteoalarm, ViaggiaTreno, GTFS ufficiali di ANM ed EAV, NeTEx del NAP (va convertito), OpenSky, Assaeroporti, AIS Stream, agenda eventi del Comune, ISTAT, bollettini ADSP, Cruise Timetables, calendario dell'America's Cup, farmacie del Ministero, football-data.org.
- **Meglio uno snapshot statico nella repo anche quando c'è CORS:** quartieri ASC, estrazioni OSM, visitatori dal CKAN comunale (troppo lento), serie ISTAT, clima ERA5, cifre ADSP (con il vincolo di licenza), GTFS ridotti alle fermate entro 500 m dai luoghi con le corse per ora.
- **Quote:** dalla sandbox Open-Meteo e Wikimedia rispondono spesso 429 per l'IP condiviso. In produzione basta un proxy con cache, oppure lasciare le chiamate ai browser dei visitatori, ognuno con il proprio IP.
- **Certificato:** `www.arpacampania.it` non invia il certificato intermedio Sectigo OV R36. Senza `--cacert` curl fallisce, mentre i browser di solito lo recuperano da soli.

---

## 3. Le fonti più importanti, con esempi

Tutti gli esempi vengono dalle prove della ricerca e della verifica. Al posto di `<nome-app>` e degli altri segnaposto va messo un nome generico del progetto, senza dati personali.

### 3.1 Open-Meteo Forecast (meteo per luogo)

```bash
curl -s 'https://api.open-meteo.com/v1/forecast?latitude=40.8359,40.8506&longitude=14.2488,14.2560&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,uv_index&daily=uv_index_max&timezone=Europe/Rome&forecast_days=2'
# per distinguere i luoghi aggiungere: &models=italia_meteo_arpae_icon_2i
```

Si passano tutte le coordinate dei luoghi in una sola chiamata e la risposta è un array. Con il modello predefinito (best_match) i due punti di prova finiscono nella stessa cella (40.8329, 14.2755) e cambiano solo per la correzione dovuta alla quota. Con ICON-2I (griglia di 2,2 km) cadono in celle diverse e il verificatore ha misurato 17,9 °C contro 17,3 °C. Il verificatore ha provato ICON-2I con due punti; non ha controllato che tutte le variabili, per esempio `uv_index`, siano disponibili con quel modello.

Campi utili: `temperature_2m`, `apparent_temperature`, `relative_humidity_2m`, `precipitation`, `precipitation_probability`, `weather_code` (codici WMO), `wind_speed_10m`, `wind_direction_10m`, `wind_gusts_10m`, `uv_index`, `uv_index_max`, `is_day`.

Quota: l'header `X-RateLimit-Cost` vale quanto il numero di coordinate (10 luoghi = 10). Una chiamata ogni 15 minuti fa circa 960 chiamate al giorno, sotto il limite di 10.000. Le richieste con più di 10 variabili o più di 2 settimane di dati costano di più. Come riserva c'è MET Norway (`https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=40.836&lon=14.249`), con User-Agent del progetto, coordinate a 4 decimali (come in `luoghi.js`) e cache fino all'header Expires.

### 3.2 Centro Funzionale Campania (allerta e stazioni)

```bash
BASE=https://centrofunzionale.regione.campania.it/CentroFunzionalePortaleRest/rest
curl -s $BASE/bollettinometeo/findLastAllertaNew       # idBollettino (il 14/11 era 723), livello, urlPdf
curl -s $BASE/bollettinometeo/findByIdZona/1/723       # dettaglio della Zona 1 (Napoli)
curl -s $BASE/bollettinometeo/findAllertaDomaniNew     # avviso per domani
curl -s $BASE/utils/getAllStazioni                     # anagrafica: 213 stazioni
curl -s $BASE/recuperodati/temporeale/36127            # termometro di Nisida, circa 50 valori orari
```

Campi dell'allerta: `livello` (1 verde, 2 giallo, 3 arancione, 4 rosso), `livelloDesc`, `tipoDesc`, `dataDa`, `dataA`, `numeroAvviso`, `urlPdf`. `findLastAllertaNew` non dice a quale zona si riferisce il livello (`zona` null): per il badge di Napoli va usato `findByIdZona/1/{idBollettino}`, che restituisce anche `piogge`, `mare`, `tipoRischi`, `fenomeni` e `scenari` in italiano. Il 13/11 la Zona 1 era in giallo (avviso 93, piogge e mare, dalle 15:00 del 13/11 alle 12:00 del 14/11). `getPDF/{urlPdf}` non restituisce un PDF ma un JSON con il PDF codificato in base64 nel campo `file`.

Sensori del Comune di Napoli: termometri 36127 e 36218 (Nisida); pluviometri 18949 (Capodimonte), 18891 (Camaldoli), 36128 e 36224 (Nisida); igrometri 36126 e 36219; vento medio 36215 e 36228; raffica 36216 e 36229; barometri 36125 e 36223; radiometri 36129 e 36220. Le serie hanno i campi `timestamp`, `value` e `cumulativeValue`. Va usato solo `value`, perché `cumulativeValue` è una somma progressiva anche per temperatura e pressione. Il timestamp indica la fine dell'ora, quindi l'ultimo valore della pioggia è parziale. Il fuso orario e l'unità del vento (probabilmente m/s) non sono dichiarati. Solo `getAllStazioni` usa la virgola decimale nelle coordinate.

**Per domenica 15/11, giorno della consegna:** il 13/11 Meteoalarm (dati dell'Aeronautica Militare) segnalava per la Campania giallo pioggia e **arancione temporali** dalle 07:00 alle 18:59. Alle 01:40 del 14/11 il Centro Funzionale non aveva ancora emesso un avviso per il 15/11. Va ricontrollato dopo l'emissione del mattino (gli avvisi 92 e 93 sono usciti alle 10:40 e alle 11:10). Le API del Centro Funzionale non sono documentate e possono cambiare: servono cache e una riserva.

### 3.3 EEA E2a (centraline ARPAC orarie)

```bash
curl -s -X POST 'https://eeadmz1-downloads-api-appservice.azurewebsites.net/ParquetFile/urls' \
  -H 'Content-Type: application/json' \
  -d '{"countries":["IT"],"cities":["Napoli (greater city)"],"pollutants":["PM10","NO2"],"dataset":1,"dateTimeStart":"2025-01-01T00:00:00Z","dateTimeEnd":"2026-11-13T00:00:00Z","aggregationType":"hour"}'
# restituisce un CSV con circa 32 URL di file Parquet, uno per punto di campionamento
# (es. SPO.IT0898A_8_chemi = NO2 della stazione IT0898A): si scaricano e si leggono con pyarrow
```

Campi dei file Parquet: `Samplingpoint`, `Pollutant` (5 = PM10, 8 = NO2, 6001 = PM2.5, 7 = O3), `Start`, `End`, `Value`, `Unit`, `AggType`, `Validity`, `Verification`, `ResultTime`, `DataCapture`. `Start` ed `End` sono in UTC+01: l'ultimo valore che risultava alle 00:00 UTC del 14/11, 20:00-21:00 del 13/11, corrisponde alle 19:00-20:00 UTC. Il ritardo reale è quindi di 3,5-4,5 ore. Ogni file contiene l'anno in corso dal 1° gennaio e i parametri `dateTimeStart`/`dateTimeEnd` non lo filtrano. Con `"dataset":2` si ottengono i dati validati E1a per lo storico.

Stazioni da usare (coordinate dal file dei metadati):

| Stazione | Coordinate | Tipo | Luoghi |
|---|---|---|---|
| IT0898A | 40.85419, 14.25133 | traffico urbano | Spaccanapoli, Museo |
| IT1491A | 40.85361, 14.27167 | traffico | Garibaldi |
| IT1496A | 40.84936, 14.23111 | traffico | Vomero, Montesanto |
| IT1497A | 40.86369, 14.25451 | fondo urbano | Sanità, Capodimonte |
| IT2221A | 40.84495, 14.20567 | industriale | Maradona, Fuorigrotta |
| IT2277A | 40.79889, 14.17941 | fondo suburbano | solo NO2, niente PM10 |

In tutto le stazioni con PM10 o NO2 nell'area di Napoli sono 18. Per gli altri luoghi va presa la più vicina secondo il file dei metadati. I file Parquet non hanno CORS: serve un job orario sul server che li converta in un JSON leggero. Per ora è l'unica via verificata ai dati orari ARPAC, perché `dati.arpacampania.it` non è raggiungibile dalla sandbox.

### 3.4 ANM: orari GTFS e mezzi in tempo reale (BusOne)

```bash
curl -sL -o anm-gtfs.zip https://files.mobilitydatabase.org/mdb-893/latest.zip     # copia con CORS del GTFS ANM
curl -s -H 'X-BusOne-Client: <nome-app>' -H 'X-BusOne-Use: nonprofit' \
  https://proxy.busone.app/anm/gtfs-rt/vehicle-positions.json
curl -s https://proxy.busone.app/anm/status
```

Campi del GTFS: `stops.stop_lat/stop_lon`, `routes.route_type` (1 metro, 7 funicolare, 0 tram, 11 filobus, 3 bus) e `route_short_name`, `stop_times` per le frequenze, `shapes` per i tracciati. Lunedì 16/11 sono previste 548 corse di metro, 546 di funicolare, 394 di filobus, 240 di tram e 9.172 di bus. Nel CSV tutti i campi sono tra virgolette.

Campi del tempo reale: `vehicle.position.latitude/longitude`, `bearing`, `speed`, `trip.route_id`, `stop_id`, `current_status`; nei TripUpdates `stop_time_update.arrival.delay` e `time`. Alle 00:38 UTC del 14/11 c'erano 10 mezzi (servizio notturno) e tutti i `route_id` esistevano nel GTFS ANM. `/anm/status` indica che le posizioni sono GPS misurato (`measured-gps`) e i TripUpdates previsioni del modello BusOne (`oracle-predicted`). Metro e funicolari non sono comprese.

I limiti di richieste sono dichiarati in due modi (120 subito e poi 5 al secondo nella home, 2 subito e poi una al minuto nel readme ANM per gli anonimi). Gli header `X-BusOne-Client` e `X-BusOne-Use` stanno per diventare obbligatori. Quindi un solo proxy sul server, con cache. Un team di hackathon con una giuria aziendale non rientra chiaramente tra "privati e non profit": va chiesto il permesso a BusOne, oppure va dichiarato in demo l'uso dimostrativo non commerciale.

### 3.5 Treni e prossime partenze: Transitous e ViaggiaTreno

```bash
# Transitous: partenze di più operatori, con CORS
curl -s -A '<nome-app>/<versione> (<contatto>)' 'https://api.transitous.org/api/v1/geocode?text=Napoli%20Piazza%20Garibaldi&type=STOP'
curl -s -A '<nome-app>/<versione> (<contatto>)' 'https://api.transitous.org/api/v1/stoptimes?stopId=it-trenitalia_09109:station&n=10'

# ViaggiaTreno: partenze da Napoli Centrale alle 08:00 del 14/11 (data in formato JavaScript, con url-encoding)
curl -s -A '<User-Agent di un browser>' 'http://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno/partenze/S09218/Sat%20Nov%2014%202026%2008%3A00%3A00%20GMT%2B0100'
```

Transitous: tra le fermate trovate ci sono `it-Campania-ANM_6271` (Piazza Garibaldi ANM), `it-trenitalia_09109:station` (Napoli Piazza Garibaldi, L2) e `it-Campania-EAV_6003` (Napoli P. Garibaldi EAV). Le partenze della L2 risultano in modalità METRO verso San Giovanni-Barra, Campi Flegrei e Castellammare. Esiste anche `/api/v5/stoptimes`, e `/api/v1/plan` calcola gli itinerari. I termini chiedono un link visibile a https://transitous.org/sources/.

ViaggiaTreno: codici delle stazioni urbane da `autocompletaStazione/NAPOLI` (Napoli Centrale S09218, Piazza Garibaldi S09109, Mergellina S09105, Montesanto S09107, Piazza Amedeo S09106, Cavour S09108, Leopardi S09104, Campi Flegrei S09103, Gianturco S09110, Afragola S09988). Campi: `numeroTreno`, `categoria`, `destinazione`/`origine`, `compOrarioPartenza`, `ritardo`, `binarioProgrammatoPartenzaDescrizione`, `binarioEffettivo...`, `provvedimento` (soppressioni). Con un orario già passato la risposta è `[]`, e HTTPS reindirizza su HTTP. L'API non è ufficiale: servono un proxy, una cache e una riserva simulata. Per i ritardi con CORS c'è anche il GTFS-RT Trenitalia di BusOne (sezione 2.2).

### 3.6 Agenda eventi del Comune

```bash
curl -s https://www.comune.napoli.it/wp-json/api/v1/news
curl -s 'https://www.comune.napoli.it/feed/?post_type=evento'       # RSS; &paged=1 risponde 301
```

Campi: `titolo`, `data_orario_inizio` e `data_orario_fine` (epoch in secondi), `luogo_evento` (`title`, `address`), `tipo_evento`, `argomenti`, `costi`, `descrizione_breve`, `immagine`. Il 14/11 l'API restituiva 10 eventi ordinati per data di inizio decrescente: tra questi Tri Gold Caracciolo (14-15/11, "Rotonda Diaz, Lungomare Caracciolo"), Viva la Strada (15/11, Parco San Laise), Pink Up Festival (21/11, Piazza Municipio) e Viaggio Dharmico (4-18/12, Castel Nuovo).

Avvertenze: non c'è paginazione (`page`, `per_page`, `limit` e `offset` restituiscono sempre gli stessi 10 eventi) e mancano le coordinate. In 8 eventi su 10 `luogo_evento.title` è assente e c'è solo un indirizzo testuale: l'abbinamento ai luoghi va fatto con regole sull'indirizzo o con una geocodifica. Gli epoch sono l'ora locale scritta come se fosse UTC: 1794735000 è il 15/11 alle 09:30 UTC e la descrizione dice "dalle ore 9:30". Vanno quindi decodificati in UTC e mostrati così, senza convertirli a Europe/Rome. Nel feed RSS gli eventi sono ordinati per data di pubblicazione e le date dell'evento compaiono solo nel testo. L'API non ha CORS: proxy con cache di 15-30 minuti.

### 3.7 Grandi eventi: partite, navi da crociera, America's Cup

```bash
curl -s https://raw.githubusercontent.com/openfootball/football.json/master/2026-27/it.1.json
curl -s 'https://www.thesportsdb.com/api/v1/json/123/eventsnext.php?id=133670'
curl -s -A 'Mozilla/5.0' https://www.cruisetimetables.com/cruises-to-naples-italy.xml
curl -s --compressed -A 'Mozilla/5.0' https://www.americascup.com/json/schedule-ac38.json
```

- **Partite (openfootball):** `matches[].round`, `date`, `time` (ora italiana), `team1`, `team2`, `score.ft`. Partite in casa in arrivo: Napoli-Torino il 21/11 alle 20:45, Napoli-Lecce il 06/12 e Napoli-Milan il 13/12 (orari non ancora fissati). I risultati arrivano solo fino alla 5ª giornata. TheSportsDB conferma gli orari, li dà in UTC (19:45 = 20:45 italiane) e ha i risultati recenti (Napoli-Lazio 1-1 l'8/11).
- **Navi da crociera (Cruise Timetables):** un elemento per ogni giorno con navi in porto. `title` ("Cruises To Naples, Italy on 16 Nov 2026"), `description` con compagnie e navi, `category` per nave. Ci sono 586 giorni dal 16/11/2026 all'agosto 2029: 11 a novembre 2026, 14 a dicembre 2026, 29 a maggio 2027. È l'unico calendario degli scali trovato: l'ADSP non ne pubblica uno aperto e il sito del Terminal Napoli è protetto da una verifica anti-bot. Va presentato come fonte non ufficiale.
- **America's Cup (JSON ufficiale):** 52 voci con `time`, `date_to`, `title` (Fleet race, Match race, Reserve day) e `short_text`. Louis Vuitton Cup dal 22/05/2027 (regate di flotta il 22-23/05, poi match race), finale dal 26/06 al 04/07; Youth America's Cup dal 02 al 07/06; Women's America's Cup dal 05 al 12/07; Match il 10, 11, 14, 16, 17, 18 e 19/07, con giorni di riserva il 13, il 15 e il 20/07. Gli orari sono tutti 12:00-14:00 e sembrano segnaposto: vanno usati solo i giorni. Il comunicato del 21/01/2026 parla di una conclusione il 17-18 luglio, ma il calendario ufficiale ha regate anche il 19/07. La Preliminary Regatta AC40 di settembre 2026 non si è corsa a Napoli: le prime Preliminary Regattas sono a Cagliari.

### 3.8 Basi statiche per l'affollamento: visitatori comunali, ISTAT, quartieri

```bash
# visitatori mensili del Maschio Angioino nel 2025 (server lento: 9-55 s)
curl -s 'https://dati.comune.napoli.it/api/3/action/datastore_search?resource_id=765e5b88-898a-4488-a7ba-337d4ecc2cf0'

# arrivi e presenze mensili della provincia di Napoli
curl -s -H 'Accept: application/vnd.sdmx.data+csv;version=1.0.0' \
  'https://esploradati.istat.it/SDMXWS/rest/data/122_54_DF_DCSC_TUR_3/M.ITF33.........?startPeriod=2024-06'

# quartieri di Napoli in GeoJSON a partire dalle basi territoriali ISTAT
curl -sO https://www.istat.it/wp-content/uploads/2025/04/ASC_21.zip   # poi unzip
npx -y mapshaper@0.6.102 ASC_Liv_2_2021.shp -filter 'PRO_COM==63049' -proj wgs84 \
  -simplify 10% keep-shapes -o format=geojson precision=0.00001

# musei di Napoli con visitatori su Wikidata
curl -s -G https://query.wikidata.org/sparql -H 'Accept: application/sparql-results+json' --data-urlencode \
  'query=SELECT ?item ?itemLabel ?coord ?visitors ?time WHERE { ?item wdt:P131 wd:Q2634; wdt:P625 ?coord; p:P1174 ?st. ?st ps:P1174 ?visitors. OPTIONAL{?st pq:P585 ?time} SERVICE wikibase:label { bd:serviceParam wikibase:language "it,en". } }'
```

- **Visitatori comunali:** i campi sono `MESE`, `ANNO`, `Nro VISITATORI` e `Nota` (es. "CHIUSO PER LAVORI"). Castel Nuovo nel 2025 ha avuto 196.835 visitatori, con il picco ad aprile (25.712) e 9.634 a novembre. Castel dell'Ovo è a 0 per tutto il 2024 e il 2025 per lavori: come anno di riferimento si usa il 2019 (233.500 visitatori), i cui valori però sono arrotondati e quindi probabilmente stime. Va dichiarato. Le serie non coprono tutti gli anni: Pausilypon va dal 2018 al 2022, Casina Pompeiana dal 2021 al 2025. I nomi dei file non sono uniformi, quindi conviene `package_show` per ogni dataset (`numero-visitatori-*`). Altri problemi: separatore delle migliaia in alcuni valori ("1.279"), BOM UTF-8 in alcuni CSV del 2025, San Domenico Maggiore a 0 a luglio e agosto 2025 senza nota.
- **ISTAT TUR_3:** `DATA_TYPE` (AR = arrivi, NI = presenze), `TYPE_ACCOMMODATION`, `COUNTRY_RES_GUESTS` (WORLD, IT, WRL_X_ITA), `TIME_PERIOD`, `OBS_VALUE`. Agosto 2025: 526.896 arrivi e 2.229.023 presenze. Gennaio 2025: 124.235 arrivi e 399.848 presenze. Il dato esiste solo per la provincia (ITF33): per il singolo Comune c'è solo il download in blocco DF_BULK_DCSC_OCCUPCOLLE, che non si interroga via REST. La chiave SDMX deve avere tutte le dimensioni (11 per TUR, 6 per POPRES1), altrimenti la risposta è 422.
- **ASC 2021:** `COD_ASC2`, `DEN_ASC2` (nome del quartiere), `POP21`, `FAM21`, `ABI21`, `EDI21`, più la geometria. La popolazione dei 30 quartieri somma 921.142 (San Ferdinando 26.163, Chiaia 40.730, San Lorenzo 48.486, Vomero 46.437, Arenella 67.539, Fuorigrotta 67.608). Il livello 2 non dice a quale municipalità appartiene un quartiere: serve uno spatial join con il livello 1 o una tabella fatta a mano. Per Napoli `DEN_ASC1` vale solo da '1' a '10'. I CSV sono separati da TAB, quello del livello 1 è in latin-1 e quello del livello 2 in cp1252; i DBF sono in UTF-8. I GeoJSON prodotti durante la ricerca (`/tmp/claude-0/od/conv/napoli_quartieri.geojson`, 30 quartieri, e `napoli_municipalita.geojson`, 10 municipalità) sono fuori dalla repo e possono sparire: si rigenerano con il comando sopra.
- **Wikidata:** MANN 532.985 visitatori nel 2024 (553.141 nel 2023), Capodimonte 151.559 nel 2024, Tesoro di San Gennaro 110.000 nel 2023. Per Palazzo Reale (341.325), Castel Sant'Elmo (274.891), San Martino (139.671), Catacombe di San Gennaro (207.000) e Cappella Sansevero (558.895) l'ultimo anno è il 2022. Vanno tolti i duplicati per luogo e anno, e prima di mostrare un valore conviene controllarne la fonte.

---

## 4. Lacune e ipotesi per le simulazioni

### 4.1 Cosa manca e con cosa lo sostituiamo

| Cosa manca | Perché | Cosa usiamo nella demo |
|---|---|---|
| **Presenze da rete mobile** (il dato di Seoul) | In Italia non ci sono dati aperti. Nei progetti Eurostat MNO-MINDS e Multi-MNO, Fastweb + Vodafone ha fornito con Motion Analytica dati anonimi e aggregati (circa un terzo della popolazione, 40 milioni di metadati georeferenziati, comunicato ISTAT del 17/03/2026), ma senza pubblicarli. I progetti ISTAT con Vodafone e con TIM non hanno dataset per Napoli, e il TIM Big Data Challenge riguarda solo Milano e Trentino nel 2013 | Affollamento simulato e dichiarato (formula in 4.2). Al checkpoint chiediamo a Fastweb + Vodafone un campione aggregato e anonimo, anche di una sola giornata: presenze orarie per area sub-comunale o per i 10 luoghi, divise tra residenti, turisti italiani e stranieri |
| **Traffico urbano** | Il Comune non ha open data sul traffico: per la mobilità su dati.gov.it ci sono solo il GTFS ANM e gli incidenti, che sono totali annui senza coordinate. Waze for Cities è riservato agli enti pubblici. TomTom e HERE richiedono una chiave, non provata. ASPI copre solo Tangenziale e autostrade | Eventi ASPI reali per la Tangenziale. Se registriamo una chiave gratuita TomTom o HERE, la usiamo sul server per i punti vicino ai luoghi. Altrimenti un indice di congestione simulato e dichiarato, legato a ora, eventi e affollamento |
| Tempo reale di metro L1 e L6, funicolari, treni EAV | Non esistono API: c'è solo l'app ANM Go, e i vecchi servizi di `srv.anm.it` rispondono 404. Per EAV ci sono solo gli avvisi testuali | Orari GTFS e avvisi EAV reali; lo stato della metro è simulato (anche lo scenario di guasto alla metro che la challenge propone). Da chiedere ad ANM tramite i mentor |
| Occupazione dei parcheggi | Non è pubblica, né per ANM né per i privati | Capienza reale (CKAN ANM, OSM) per un tasso di occupazione simulato |
| Sharing (monopattini, bici, auto) | I GBFS di Lime Naples e Amicar Napoli rispondono 404, Dott e Bird anche; gli asset del NAP sono vuoti. Secondo la stampa BIT Mobility ha sospeso i monopattini a luglio 2026 | Nessuno: non lo mostriamo |
| Traghetti diversi da Alilauro | SNAV, NLG, Caremar, Medmar e Gestour non hanno orari aperti; non c'è tempo reale, salvo AIS con chiave; le statistiche del porto sono solo in PDF | Orari Alilauro dal NAP più i passeggeri locali ADSP |
| Rumore | Non abbiamo trovato in open data la mappa acustica strategica del Comune; il servizio EEA END restituisce sempre lo stesso valore | Rumore stimato da traffico e affollamento, dichiarato come stima |
| Isole di calore | Non c'è un dataset aperto per Napoli. Urban Atlas, Landsat ed ECOSTRESS non sono stati verificati | Come approssimazione, `apparent_temperature` da Open-Meteo con ICON-2I |
| Temperatura misurata per luogo | Le stazioni ufficiali in città sono solo 3, e solo Nisida è completa | Valori dei modelli, etichettati "previsto"; "misurato" per pioggia e Nisida |
| Qualità dell'aria per luogo, senza ritardo | CAMS ha celle di 11 km, quindi lo stesso valore ovunque; i dati NRT di ARPAC non sono raggiungibili | Centralina EEA più vicina, con l'indicazione "dato di N ore fa" |
| Balneazione: esiti dei singoli prelievi | Il Portale Acque del Ministero della Salute non ha un'API e il dataset ARPAC non è raggiungibile | Classi annuali EEA 2025 (a novembre la stagione è chiusa) |
| Tabellone voli dell'aeroporto | `aeroportodinapoli.it` è dietro Radware Bot Manager con hCaptcha | OpenSky (anonimo) e medie mensili Assaeroporti |
| Visitatori 2024 dei musei statali | MiC bloccato dalla sandbox | Wikidata (MANN e Capodimonte 2024, gli altri 2022) |
| Turismo per singolo Comune | Via REST c'è solo la provincia (ITF33) | Dato della provincia distribuito sui quartieri in base agli annunci Airbnb |
| Tempi di attesa del pronto soccorso | La Campania non li pubblica (lo fanno Lazio, Toscana, Emilia-Romagna, Puglia e Veneto) | Simulati, solo se servono |
| Wi-Fi pubblico | Nessun dataset aperto | OSM (`internet_access=wlan`) da scaricare con Overpass dalla rete dell'evento, oppure un elenco fatto a mano |
| Sportelli comunali e attese | IndicePA dà solo gli indirizzi delle direzioni di municipalità; le API di prenotazione del Comune rispondono 401 | Indirizzi reali, attese simulate |
| Rifiuti (ASIA) | ASIA non ha open data; il catasto rifiuti ISPRA è una pagina JavaScript con esportazione manuale (non verificato) | Nessuno |
| Non cercati o non verificati | Mareografo ISPRA di Napoli (nessuna API JSON trovata; `www.idromare.it` non raggiungibile), pollini ARPAC (solo PDF), Copernicus Marine (registrazione gratuita), PurpleAir (chiave e crediti a pagamento), Ticketmaster (401 senza chiave) | Pollini da CAMS |

### 4.2 Ipotesi per l'affollamento simulato

Lo schema viene dalla ricerca: si parte da una base reale e la si modula con fattori che hanno ciascuno una fonte. Ogni parametro va scritto nella pagina "ipotesi" della demo.

```
affollamento(luogo, ora) = base(luogo, mese) × profilo_orario(luogo, giorno della settimana, ora)
                           × fattore_stagionale(mese) × fattori_evento(luogo, giorno, ora) × fattore_meteo
```

- **Base (reale):** visitatori mensili dei siti comunali diviso i giorni di apertura (Maschio Angioino per Plebiscito e Beverello, San Domenico Maggiore e San Severo per Spaccanapoli, Casina Pompeiana per il Lungomare, Pausilypon per Mergellina, Castel dell'Ovo con il 2019). Per il Beverello, passeggeri locali ADSP del mese diviso i giorni. Per i musei statali, i visitatori annui da Wikidata, finché il MiC non è raggiungibile.
- **Profilo orario (ipotesi dichiarata):** una curva per tipo di luogo e di giorno. La forma può venire dall'attività telefonica di Milano 2013 (TIM Big Data Challenge, ODbL, scaricabile dopo il guestbook), dichiarando che è un profilo milanese del 2013.
- **Stagionalità (reale):** indice mensile delle presenze ISTAT della provincia (mese diviso media annua) e quota di stranieri. Gli annunci Airbnb pesano i quartieri; le visite su Wikipedia danno l'interesse relativo e i picchi.
- **Eventi (reali nel calendario, stimati nell'effetto):**
  - partita in casa (openfootball, TheSportsDB): aumento al Maradona nelle 3 ore prima e nell'ora dopo, che si estende a Fuorigrotta e Mergellina;
  - navi in porto (Cruise Timetables): escursionisti a terra tra le 9 e le 17 al Beverello e alla Stazione Marittima, a Municipio, Plebiscito e nel centro storico. Il numero di passeggeri per nave si stima dalla capacità della nave e va dichiarato come stima;
  - regate dell'America's Cup (calendario ufficiale): Lungomare, Mergellina e Castel dell'Ovo nei giorni di gara;
  - eventi del Comune nel luogo (es. Tri Gold Caracciolo sul Lungomare questo fine settimana);
  - festività e ponti (Nager.Date più San Gennaro il 19/09).
- **Meteo (reale):** pioggia, allerta del Centro Funzionale e temperatura percepita modulano l'afflusso nei luoghi all'aperto; l'archivio ERA5 serve a tarare l'effetto. L'entità dell'effetto è un'ipotesi da dichiarare.

Le stesse regole valgono per il resto: occupazione dei parcheggi = capienza reale × curva simulata; stato della metro = orario GTFS reale più eventi di guasto simulati; rumore stimato da traffico e affollamento.

**Come lo rendiamo trasparente in UI:** ogni valore ha un cartellino con la provenienza (*dal vivo*, *snapshot*, *orario programmato*, *fonte di riserva*, *ultimo dato salvato*, *simulato*) e, dove serve, fonte e ora del dato. Se arrivano i dati degli sponsor, prendono il posto della base e del profilo orario e le stime vengono tarate su di essi.

**Stato dell'implementazione:** di questa formula oggi ci sono solo i fattori evento (additivi, `evento_<zona>`) e la stagionalità (moltiplicativa, `stagione_bassa`/`stagione_alta`), sopra la curva oraria del simulatore. Le finestre implementate sono leggermente diverse da quelle proposte qui: partita da 3 ore prima a 3 ore dopo il calcio d'inizio, navi dalle 8 alle 18. Base dai visitatori, profilo orario per giorno della settimana e fattore meteo restano da fare.

### 4.3 Da chiedere ai mentor e da riprovare all'evento

- **Fastweb + Vodafone:** campione aggregato e anonimo di presenze (vedi 4.1).
- **ANM:** stato del servizio di metro e funicolari, posti liberi nei parcheggi.
- **BusOne:** permesso d'uso, oppure dichiarazione di uso dimostrativo non commerciale.
- **Da riprovare dalla rete dell'evento o dal server del team:** `dati.arpacampania.it` (aria NRT, balneazione), `dati.regione.campania.it` (validazioni TPL, strutture ricettive) e la copia Wayback delle validazioni, `dati.cittametropolitana.na.it` e `crmurp.cittametropolitana.na.it`, `statistica.cultura.gov.it` e `dati.beniculturali.it`, `overpass-api.de` (salvando subito un GeoJSON), `radar-api.protezionecivile.it`, `opendata.comune.napoli.it`, `archive.sensor.community`, `download.geofabrik.de`, `www.idromare.it`. Di giorno, OpenSky sul riquadro di Napoli (di notte era vuoto). Domenica mattina, l'avviso del Centro Funzionale per il 15/11.
- **Chiavi gratuite da registrare solo se servono:** TomTom o HERE, WAQI o OpenAQ, football-data.org, AIS Stream. Vanno tenute sul server, come variabili d'ambiente e mai nei file della repo.

---

## 5. Licenze e attribuzioni da mostrare in demo

| Fonte | Licenza o termini | Attribuzione da mostrare | Vincoli |
|---|---|---|---|
| Open-Meteo (forecast, marine, archivio) | CC BY 4.0 | "Dati meteo: Open-Meteo.com (CC BY 4.0)" | API gratuita solo per uso non commerciale e sotto i limiti di quota |
| Open-Meteo Air Quality | CC BY 4.0, dati CAMS | "Open-Meteo.com, Copernicus Atmosphere Monitoring Service" | come sopra |
| MET Norway | CC BY 4.0 | "MET Norway" | User-Agent identificativo, al massimo 4 decimali, rispettare Expires |
| Centro Funzionale Campania | Copyright Protezione Civile Regione Campania | "Fonte: Protezione Civile Regione Campania, Centro Funzionale" | Nessuna licenza aperta: per una ridistribuzione stabile chiedere il permesso |
| meteo@uniparthenope | nessuna licenza; disclaimer "as is" | "meteo@uniparthenope" | Non sostituisce gli avvisi ufficiali |
| EEA (aria, balneazione) | riuso libero con citazione (legal notice EEA) | "Fonte: EEA, dati ARPA Campania"; per la balneazione "EEA, Bathing waters data and coordinates: Member states authorities" | I dati E2a non sono validati: scriverlo |
| Meteoalarm | termini EUMETNET non verificati | "Meteoalarm / EUMETNET, Aeronautica Militare" | Da verificare prima di ridistribuire |
| INGV | CC BY 4.0 | "INGV" | |
| Sensor.Community | DbCL 1.0 | "Sensor.Community" | |
| WAQI | termini WAQI | "World Air Quality Index Project" e l'ente che produce il dato | Vietati cache e archivio; niente uso commerciale |
| OpenStreetMap (anche le tessere della mappa) | ODbL 1.0 | "© OpenStreetMap contributors" | |
| GTFS ANM | CC BY 4.0 (dataset del Comune su dati.gov.it) | "Comune di Napoli / ANM, CC BY 4.0" | Il file di anm.it non dichiara una licenza propria |
| GTFS EAV, avvisi EAV | non indicata | "EAV srl" | |
| BusOne (ANM in tempo reale, Trenitalia) | termini BusOne | "BusOne" (attribuzione obbligatoria), più le fonti originali e "OpenStreetMap contributors" per le geometrie | Gratis solo per privati e non profit, uso non commerciale; altrimenti consenso scritto |
| Transitous | termini del servizio | link visibile a https://transitous.org/sources/ | Solo progetti open source, non commerciali e leggeri; User-Agent con contatto |
| ViaggiaTreno | nessuna (API non ufficiale) | "RFI / Trenitalia, ViaggiaTreno" | Può cambiare senza preavviso |
| ASPI | tutti i diritti riservati | "Autostrade per l'Italia" | Solo come dato di contesto |
| NAP CCISS (Alilauro) | "No licence – No contract" | "NAP Italia, CCISS" | |
| Assaeroporti; OpenSky | non indicata; uso non commerciale o di ricerca | "Assaeroporti"; "OpenSky Network" | Termini OpenSky non verificati |
| Comune di Napoli (sito, CKAN) | CC BY 4.0 | "Comune di Napoli" | Le immagini degli eventi possono essere di terzi |
| openfootball | CC0 1.0 | facoltativa | |
| TheSportsDB | termini TheSportsDB | "TheSportsDB" | Con la chiave gratuita niente app negli store |
| AdSP Mar Tirreno Centrale | diritti riservati | "AdSP Mar Tirreno Centrale, bollettini statistici" | Solo pochi aggregati citati; per un JSON derivato nella repo pubblica chiedere il permesso |
| Cruise Timetables | proprietaria | "CruiseTimetables.com (fonte non ufficiale)" | Per un uso pubblico oltre la demo serve il permesso |
| America's Cup | non dichiarata | "America's Cup" | |
| ISTAT | CC BY 4.0 | "Fonte: ISTAT" | |
| Inside Airbnb | CC BY 4.0 | "Inside Airbnb" | Solo dati aggregati: non mostrare host_name, host_id e codici di licenza |
| Wikimedia pageviews, Wikidata | CC0 | facoltativa ("Wikimedia, Wikidata") | User-Agent obbligatorio per le pageviews |
| Ministero della Salute (farmacie) | IODL 2.0 | "Ministero della Salute, IODL 2.0" | |
| IndicePA | CC BY 4.0 | "IndicePA" | |
| TIM Big Data Challenge | ODbL 1.0 | "Telecom Italia, Harvard Dataverse" | Profilo di Milano 2013: dichiararlo |

La nota sotto la mappa (`notaFonti` in `example/napoli-fonti.js`) cita le fonti effettivamente usate, con un cartellino di stato per meteo, aria, allerta, trasporti ed eventi; la tabella "Fonti dei dati" sotto la mappa riporta ente, ora e licenza di ognuna. Testo completo proposto dalla ricerca (comprende anche fonti non integrate, come meteo@uniparthenope e BusOne):

> Dati: Open-Meteo.com (CC BY 4.0), Copernicus CAMS, MET Norway (CC BY 4.0), meteo@uniparthenope, Protezione Civile Regione Campania – Centro Funzionale, EEA (dati ARPA Campania; dati orari non validati), INGV (CC BY 4.0), Comune di Napoli (CC BY 4.0), ANM, EAV, BusOne, Transitous ([fonti](https://transitous.org/sources/)), ISTAT (CC BY 4.0), Inside Airbnb (CC BY 4.0), Wikimedia, © OpenStreetMap contributors (ODbL). L'affollamento è una stima simulata con ipotesi dichiarate, non una misura.
