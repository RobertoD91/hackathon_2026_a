// Il servizio completo: rete educata + archivio degli snapshot + cache delle fonti + risposte +
// server HTTP (node:http) con token facoltativo, CORS, log e chiusura pulita.
//
//   const s = await creaServizio(leggiConfig());   // prepara gli snapshot
//   await s.avvia();                                // ascolta su config.porta, scalda le fonti
//   await s.chiudi();

import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import * as D from '../fonti/dati.js';
import { aggiornaDati } from '../strumenti/aggiorna-dati-napoli.js';
import { creaRete } from './rete.js';
import { creaArchivio, generatoIl } from './archivio.js';
import { creaSorgenti } from './sorgenti.js';
import { creaStimaFolla } from './folla.js';
import { creaCitta } from './citta.js';
import { creaAggiornamento } from './aggiornamento.js';
import { LEGENDA_STATI, STATI, oraLocale, ErroreApi } from './formato.js';

export const VERSIONE = '1.0.0';

/** Fonti mostrate in /citta/fonti: cosa danno, catena di riserve, voce del catalogo di fonti/dati.js. */
const CATALOGO = [
  { id: 'meteo', dato: 'Meteo per luogo', sorgente: 'meteo', voce: 'openMeteo', catena: 'Open-Meteo ICON-2I → Open-Meteo predefinito → MET Norway (un punto) → ultimo dato salvato' },
  { id: 'aria_modello', dato: "Qualità dell'aria, modello", sorgente: 'ariaModello', voce: 'cams', catena: 'Open-Meteo Air Quality (Copernicus CAMS) → ultimo dato salvato' },
  { id: 'aria_centraline', dato: "Qualità dell'aria, centraline ARPAC", sorgente: 'centraline', voce: 'centraline', catena: 'EEA, misure orarie non validate (snapshot)' },
  { id: 'allerta', dato: 'Allerta meteo regionale e Meteoalarm', sorgente: 'allerta', voce: 'allerta', catena: 'Centro Funzionale Campania dal vivo → ultimo avviso salvato; Meteoalarm dallo snapshot' },
  { id: 'terremoti', dato: 'Terremoti dei Campi Flegrei', sorgente: 'terremoti', voce: 'ingv', catena: 'INGV dal vivo → snapshot' },
  { id: 'trasporti', dato: 'Linee, stazioni e corse programmate', sorgente: 'trasporti', voce: 'gtfs', catena: 'GTFS ANM ed EAV (snapshot)' },
  { id: 'passaggi', dato: 'Prossimi passaggi (metro, funicolari, treni)', sorgente: 'passaggi', voce: 'transitous', catena: 'Transitous dal vivo, a richiesta → orario programmato GTFS' },
  { id: 'avvisi', dato: 'Avvisi treni EAV (guasti, scioperi, ascensori)', sorgente: 'avvisi', voce: 'eav', catena: 'EAV dal vivo' },
  { id: 'traffico', dato: 'Traffico su tangenziale e autostrade', sorgente: 'traffico', voce: 'aspi', catena: "Autostrade per l'Italia dal vivo (il traffico urbano non ha dati aperti)" },
  { id: 'eventi', dato: "Eventi, partite, navi da crociera, America's Cup", sorgente: 'eventi', voce: 'eventi', catena: 'snapshot + calendario Serie A dal vivo (openfootball)' },
  { id: 'riferimenti', dato: 'Visitatori, stagionalità, porto, mare, affitti brevi', sorgente: 'riferimenti', voce: 'riferimenti', catena: 'snapshot' },
];

const SCALDA = ['meteo', 'ariaModello', 'centraline', 'allerta', 'terremoti', 'trasporti', 'eventi', 'riferimenti'];

const ENDPOINT = [
  ['/citta/riassunto', 'il quadro della città adesso in un colpo solo (allerta, meteo, aria, eventi di oggi e prossimi, avvisi trasporti, terremoti, stagione, folla simulata): da mettere nel contesto', '/citta/riassunto?formato=testo'],
  ['/citta/luoghi', 'i 10 luoghi monitorati con la stazione più vicina', '/citta/luoghi'],
  ['/citta/luogo', 'tutto su un luogo: meteo, aria, stazioni vicine, eventi, visitatori, folla stimata (nome tollerante, oppure lat e lon)', "/citta/luogo?nome=castel dell'ovo"],
  ['/citta/meteo', 'meteo adesso, per luogo o per tutta la città', '/citta/meteo?luogo=lungomare'],
  ['/citta/aria', "qualità dell'aria (centralina vicina o modello)", '/citta/aria?luogo=garibaldi'],
  ['/citta/allerta', 'allerta della Protezione Civile Campania (Zona 1) e Meteoalarm', '/citta/allerta'],
  ['/citta/trasporti/vicino', 'stazioni di metro, funicolari e treni vicine (passaggi=1 aggiunge le prossime partenze della prima)', '/citta/trasporti/vicino?luogo=maradona&passaggi=1'],
  ['/citta/passaggi', 'prossime partenze da una stazione (Transitous) o, se mancano, le corse programmate', '/citta/passaggi?stazione=toledo'],
  ['/citta/eventi', "eventi di un giorno (oggi, domani, sabato, AAAA-MM-GG) e prossimi: Comune, partite, navi, America's Cup", '/citta/eventi?giorno=domani'],
  ['/citta/terremoti', 'ultimi terremoti dei Campi Flegrei (INGV)', '/citta/terremoti'],
  ['/citta/traffico', "eventi di traffico su tangenziale e autostrade (Autostrade per l'Italia)", '/citta/traffico'],
  ['/citta/fonti', 'stato di ogni fonte, ora dell\'ultimo dato, licenza, pause per limite di richieste, snapshot', '/citta/fonti'],
  ['/salute', 'il servizio è vivo? (senza token, per il healthcheck)', '/salute'],
];

function uguali(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * @param {ReturnType<import('./config.js').leggiConfig>} config
 * @param {{fetch?: Function, ora?: () => number, log?: (m: string) => void, aggiornaDati?: Function, stimaFolla?: Function}} [deps]
 */
export async function creaServizio(config, deps = {}) {
  const ora = deps.ora || (() => Date.now());
  const log = deps.log || (config.log ? (m) => console.log(`[citta-api] ${m}`) : () => {});
  const avviato = ora();

  const rete = creaRete({ fetch: deps.fetch, ua: config.ua, uaForzato: config.uaForzato, ora, pausa429Ms: config.pausa429Ms, log });
  D.impostaRete({ fetch: rete.fetch, ora });
  D.svuotaCache();

  const archivio = creaArchivio({ cartella: config.cartellaDati, iniziale: config.cartellaIniziale, inietta: D.impostaSnapshot, ora, log });
  const sorgenti = creaSorgenti({ D, ora, log, ...(deps.sorgenti || {}) });
  const citta = creaCitta({ sorgenti, archivio, ora, stimaFolla: deps.stimaFolla ?? creaStimaFolla() });
  const aggiornamento = creaAggiornamento({
    piano: config.aggiorna || {},
    archivio,
    aggiornaDati: deps.aggiornaDati || aggiornaDati,
    fetch: rete.fetch,
    ora,
    log,
    dopo: () => sorgenti.invalida(),
  });

  await archivio.prepara();

  /** Fonti da tenere pronte: quelle del riassunto, compresi gli avvisi EAV (con i nomi delle stazioni). */
  async function scalda() {
    const nomi = (archivio.get('trasporti')?.stazioni || []).filter((s) => s.operatore === 'EAV').map((s) => s.nome);
    await sorgenti.scalda([...SCALDA, { nome: 'avvisi', args: [nomi] }]);
  }

  /** Ricarica gli snapshot cambiati (al massimo ogni 30 s) e dimentica le risposte vecchie. */
  async function controllaSnapshot() {
    const cambiati = await archivio.controlla();
    if (cambiati.length) sorgenti.invalida();
  }

  // -------------------------------------------------------------- risposte di servizio

  function salute() {
    const t = ora();
    const info = archivio.info();
    const snapshot = Object.fromEntries(Object.entries(info).map(([n, x]) => [n, x.generato ? oraLocale(x.generato) : null]));
    const pause = rete.stato().filter((d) => d.in_pausa_fino).map((d) => ({ dominio: d.dominio, fino: oraLocale(d.in_pausa_fino), motivo: d.motivo_pausa }));
    const ok = info.trasporti.generato || info.eventi.generato;
    const ag = aggiornamento.stato();
    return {
      stato: ok ? 'ok' : 'degradato',
      servizio: 'citta-api',
      versione: VERSIONE,
      ora: oraLocale(t),
      attivo_da_s: Math.round((t - avviato) / 1000),
      token_richiesto: Boolean(config.token),
      snapshot,
      fonti_in_pausa: pause,
      aggiornamento_snapshot: ag.attivo ? { piano_ore: ag.piano_ore, in_corso: ag.in_corso, da_rigenerare: ag.da_rigenerare } : { attivo: false },
      ...(ok ? {} : { nota: 'nessuno snapshot caricato: controlla CITTA_DATI' }),
    };
  }

  function fonti() {
    const t = ora();
    const st = sorgenti.stato();
    const elenco = CATALOGO.map((c) => {
      const s = st[c.sorgente];
      const f = s?.ultimo?.fonte;
      const base = D.FONTI[c.voce] || {};
      return {
        id: c.id,
        dato: c.dato,
        catena_delle_riserve: c.catena,
        stato: f ? STATI[f.tipo] || f.tipo : 'non ancora letto',
        nome: f?.nome ?? base.nome ?? null,
        url: f?.url ?? base.url ?? null,
        licenza: f?.licenza ?? base.licenza ?? null,
        ora_dato: oraLocale(f?.ts),
        letto_alle: oraLocale(s?.ultimo?.letto),
        durata_ms: s?.ultimo?.durataMs ?? null,
        nota: f?.nota ?? null,
        cache_min: Math.round(sorgenti.ttl[c.sorgente] / 60_000),
        richieste_ricevute: s?.richieste ?? 0,
        letture_fatte: s?.letture ?? 0,
      };
    });
    elenco.push({
      id: 'folla',
      dato: 'Folla stimata per luogo',
      catena_delle_riserve: 'simulatore della demo (citta-api/simulatore/sim-config.json) + eventi reali di oggi + stagionalità ISTAT',
      stato: 'simulato',
      nome: 'Simulatore della demo',
      url: null,
      licenza: 'stima dichiarata',
      ora_dato: oraLocale(t),
      nota: 'le presenze da rete mobile non sono pubbliche: vanno chieste a Fastweb + Vodafone',
    });
    const snapshot = Object.fromEntries(
      ['trasporti', 'aria', 'eventi', 'riferimenti', 'meteo'].map((n) => {
        const s = archivio.get(n);
        return [
          n,
          {
            generato: oraLocale(generatoIl(s)),
            fonti: (s?.meta?.fonti || []).map((x) => ({ nome: x.nome, ente: x.ente ?? null, licenza: x.licenza ?? null, stato: x.stato, ...(x.errore ? { errore: x.errore } : {}), ...(x.datoDel ? { dato_del: x.datoDel } : {}) })),
          },
        ];
      }),
    );
    return {
      ora: oraLocale(t),
      fonti: elenco,
      rete: rete.stato().map((d) => ({ ...d, ultima: d.ultima ? { ...d.ultima, ts: oraLocale(d.ultima.ts) } : null, in_pausa_fino: oraLocale(d.in_pausa_fino) })),
      snapshot,
      aggiornamento_snapshot: aggiornamento.stato(),
      legenda_stati: LEGENDA_STATI,
      catalogo_completo: 'docs/fonti-dati-napoli.md nella repo (59 fonti verificate, licenze ed esiti delle prove)',
    };
  }

  function indice() {
    return {
      servizio: 'API dati città di Napoli (citta-api)',
      descrizione: 'Dati reali della città per CiroGPT e per la mappa, con cache, riserve dichiarate e rispetto delle quote delle fonti. Ogni risposta ha una `fonte` con lo stato del dato e un campo `testo` pronto da citare.',
      versione: VERSIONE,
      endpoint: ENDPOINT.map(([percorso, cosa, esempio]) => ({ percorso, cosa, esempio })),
      parametri_comuni: { formato: 'testo → solo il campo testo (text/plain)', leggibile: '1 → JSON indentato' },
      alias: 'gli stessi percorsi funzionano anche senza /citta (es. /meteo?luogo=vomero), più /citta/eventi/oggi, /citta/eventi/domani, /citta/eventi/AAAA-MM-GG',
      stati: LEGENDA_STATI,
      orari: 'tutti gli orari sono locali di Napoli, formato AAAA-MM-GG HH:MM',
    };
  }

  const ROTTE = {
    '/': indice,
    '/citta': indice,
    '/salute': salute,
    '/citta/riassunto': () => citta.riassunto(),
    '/citta/luoghi': () => citta.luoghi(),
    '/citta/luogo': (q) => citta.luogo(q),
    '/citta/meteo': (q) => citta.meteo(q),
    '/citta/aria': (q) => citta.aria(q),
    '/citta/allerta': () => citta.allerta(),
    '/citta/terremoti': () => citta.terremoti(),
    '/citta/traffico': () => citta.traffico(),
    '/citta/trasporti/vicino': (q) => citta.trasportiVicino(q),
    '/citta/passaggi': (q) => citta.passaggi(q),
    '/citta/eventi': (q) => citta.eventi(q),
    '/citta/fonti': fonti,
  };
  const PUBBLICHE = new Set(['/salute']);

  /** Percorso → rotta: anche senza il prefisso /citta (/meteo, /luoghi…) e /citta/eventi/<giorno>. */
  function trova(percorso, q) {
    if (ROTTE[percorso]) return [percorso, q];
    if (ROTTE[`/citta${percorso}`]) return [`/citta${percorso}`, q];
    const m = /^(?:\/citta)?\/eventi\/([^/]+)$/.exec(percorso);
    if (m) {
      let giorno = m[1];
      try {
        giorno = decodeURIComponent(m[1]);
      } catch {
        /* codifica non valida (%E0%A4%A): resta grezzo e /citta/eventi risponde 400 "giorno non capito" */
      }
      return ['/citta/eventi', { ...q, giorno }];
    }
    return [null, q];
  }

  /**
   * Percorso normalizzato: barre doppie e finali tolte, minuscole ("//citta//meteo/" e "/CITTA/METEO"
   * sono /citta/meteo). L'URL si compone a mano: con new URL('//citta…', base) "citta" diventerebbe l'host.
   */
  function leggiUrl(grezzo) {
    const s = String(grezzo || '/');
    let url;
    try {
      url = s.startsWith('/') ? new URL(`http://citta-api${s}`) : new URL(s, 'http://citta-api');
    } catch {
      throw new ErroreApi(400, 'indirizzo della richiesta non valido');
    }
    const percorso = url.pathname.replace(/\/{2,}/g, '/').replace(/\/+$/, '').toLowerCase() || '/';
    return { url, percorso };
  }

  // -------------------------------------------------------------- HTTP

  function intestazioniCors(req) {
    const origine = req.headers.origin;
    if (!config.cors?.length || !origine) return {};
    if (config.cors.includes('*')) return { 'access-control-allow-origin': '*' };
    if (config.cors.includes(origine.replace(/\/+$/, ''))) return { 'access-control-allow-origin': origine, vary: 'Origin' };
    return {};
  }

  function invia(res, status, corpo, { cors = {}, testo = false, leggibile = false } = {}) {
    const s = testo ? `${typeof corpo === 'string' ? corpo : corpo.testo ?? JSON.stringify(corpo)}\n` : `${JSON.stringify(corpo, null, leggibile ? 2 : 0)}\n`;
    res.writeHead(status, {
      'content-type': testo ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...cors,
    });
    res.end(s);
  }

  async function gestisci(req, res) {
    const t0 = ora();
    const cors = intestazioniCors(req);
    let status = 500;
    let percorso = '?';
    try {
      const letto = leggiUrl(req.url);
      const url = letto.url;
      percorso = letto.percorso;
      if (req.method === 'OPTIONS') {
        status = 204;
        res.writeHead(204, { ...cors, 'access-control-allow-methods': 'GET, OPTIONS', 'access-control-allow-headers': 'Authorization, Content-Type', 'access-control-max-age': '600' });
        return res.end();
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        status = 405;
        return invia(res, 405, { errore: 'metodo non consentito: questa API è di sola lettura (GET)' }, { cors });
      }
      const [nomeRotta, q] = trova(percorso, Object.fromEntries(url.searchParams.entries()));
      if (config.token && !PUBBLICHE.has(nomeRotta)) {
        const h = String(req.headers.authorization || '');
        const m = /^Bearer\s+(.+)$/i.exec(h);
        if (!m || !uguali(m[1].trim(), config.token)) {
          status = 401;
          res.setHeader('www-authenticate', 'Bearer');
          return invia(res, 401, { errore: 'token mancante o errato: serve l\'header "Authorization: Bearer <CITTA_API_TOKEN>"' }, { cors });
        }
      }
      if (!nomeRotta) {
        status = 404;
        return invia(res, 404, { errore: `percorso sconosciuto: ${percorso}`, endpoint: ENDPOINT.map((e) => e[0]) }, { cors });
      }
      if (nomeRotta.startsWith('/citta/')) await controllaSnapshot();
      const corpo = await ROTTE[nomeRotta](q);
      status = 200;
      invia(res, 200, corpo, { cors, testo: q.formato === 'testo', leggibile: /^(1|si|true)$/i.test(q.leggibile || '') });
    } catch (err) {
      if (err instanceof ErroreApi) {
        status = err.status;
        invia(res, err.status, { errore: err.message, ...err.extra }, { cors });
      } else {
        status = 500;
        log(`errore su ${percorso}: ${err?.stack || err}`);
        if (!res.headersSent) invia(res, 500, { errore: 'errore interno del servizio' }, { cors });
        else res.end();
      }
    } finally {
      if (percorso !== '/salute') log(`${req.method} ${percorso} ${status} ${ora() - t0} ms`);
    }
  }

  let server = null;
  const timer = [];

  return {
    config,
    rete,
    archivio,
    sorgenti,
    citta,
    aggiornamento,
    gestisci,
    salute,
    fonti,
    /** Avvia il server HTTP, scalda le fonti e i controlli periodici. */
    async avvia({ porta = config.porta, host = config.host } = {}) {
      server = createServer((req, res) => {
        gestisci(req, res);
      });
      server.keepAliveTimeout = 5000;
      await new Promise((ok, ko) => {
        server.once('error', ko);
        server.listen(porta, host, ok);
      });
      const indirizzo = server.address();
      log(`in ascolto su http://${host}:${indirizzo.port} (token ${config.token ? 'richiesto' : 'non richiesto'}, CORS: ${config.cors.join(', ') || 'nessuno'}, snapshot in ${archivio.cartella})`);
      // fonti tenute "calde": la prima domanda di CiroGPT non aspetta le fonti lente
      if (config.tieniCaldo) {
        scalda().catch(() => {});
        const t = setInterval(() => scalda().catch(() => {}), 5 * 60_000);
        t.unref?.();
        timer.push(t);
      }
      const t2 = setInterval(() => {
        controllaSnapshot().catch(() => {});
        sorgenti.pulisci();
      }, 60_000);
      t2.unref?.();
      timer.push(t2);
      aggiornamento.avvia();
      return indirizzo.port;
    },
    async chiudi() {
      for (const t of timer) clearInterval(t);
      aggiornamento.ferma();
      if (server) {
        await new Promise((ok) => {
          server.close(() => ok());
          server.closeAllConnections?.();
        });
        server = null;
      }
    },
  };
}
