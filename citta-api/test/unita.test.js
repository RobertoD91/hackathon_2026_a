// Test dei singoli pezzi: rete (User-Agent, pause dopo 429 ed errori), ricerca tollerante,
// cache delle fonti (TTL, coalescenza, esiti degradati, stale-while-revalidate), folla stimata,
// configurazione, archivio degli snapshot, rinfresco degli snapshot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { creaRete, dominio, retryAfterMs } from '../src/rete.js';
import { cercaLuoghi, cercaStazioni, punteggio, levenshtein, SOGLIA } from '../src/ricerca.js';
import { creaSorgenti } from '../src/sorgenti.js';
import { creaStimaFolla, scenariAttivi } from '../src/folla.js';
import { leggiConfig, durata, pianoAggiornamento, originiCors, CARTELLA_DATI_REPO } from '../src/config.js';
import { creaArchivio, generatoIl } from '../src/archivio.js';
import { creaAggiornamento } from '../src/aggiornamento.js';
import { oraLocale, quando, finoA, intervallo, fonteBreve, citazione } from '../src/formato.js';
import { LUOGHI } from '../fonti/luoghi.js';
import * as N from '../fonti/normalizza.js';
import { orologio, fetchFinto, risposta, snapshotSintetici, T, H, M } from './aiuti.js';

// ------------------------------------------------------------------ rete

test('rete: User-Agent messo se manca, UA da browser lasciato, NAPOLI_UA forzato', async () => {
  const f = fetchFinto([[/./, () => risposta({})]]);
  const r = creaRete({ fetch: f, ua: 'mio-ua/1.0' });
  await r.fetch('https://api.met.no/x');
  await r.fetch('https://www.comune.napoli.it/x', { headers: { 'user-agent': 'Mozilla/5.0 (X11)' } });
  await r.fetch('https://api.transitous.org/x', { headers: { 'user-agent': 'napoli-in-tempo-reale/1.0' } });
  assert.deepEqual(f.chiamate.map((c) => c.headers['user-agent']), ['mio-ua/1.0', 'Mozilla/5.0 (X11)', 'napoli-in-tempo-reale/1.0']);
  const f2 = fetchFinto([[/./, () => risposta({})]]);
  const forzata = creaRete({ fetch: f2, ua: 'progetto (contatto)', uaForzato: true });
  await forzata.fetch('https://api.transitous.org/x', { headers: { 'user-agent': 'napoli-in-tempo-reale/1.0' } });
  await forzata.fetch('https://www.comune.napoli.it/x', { headers: { 'user-agent': 'Mozilla/5.0' } });
  assert.deepEqual(f2.chiamate.map((c) => c.headers['user-agent']), ['progetto (contatto)', 'Mozilla/5.0']);
});

test('rete: un 429 mette in pausa tutto il dominio (Retry-After se più lungo), gli altri domini no', async () => {
  const o = orologio();
  const f = fetchFinto([
    [/open-meteo/, () => risposta({}, 429, { 'retry-after': '3600' })],
    [/met\.no/, () => risposta({ ok: true })],
  ]);
  const r = creaRete({ fetch: f, ora: o.ora, pausa429Ms: 15 * M });
  assert.equal((await r.fetch('https://api.open-meteo.com/v1/forecast')).status, 429);
  await assert.rejects(r.fetch('https://air-quality-api.open-meteo.com/v1/air-quality'), /open-meteo\.com in pausa.*429/);
  assert.equal(f.conta(/open-meteo/), 1, 'in pausa nessuna richiesta parte');
  assert.equal((await r.fetch('https://api.met.no/x')).status, 200);
  o.avanza(30 * M);
  assert.ok(r.inPausa('https://api.open-meteo.com/'), 'Retry-After di un\'ora più lungo dei 15 minuti');
  o.avanza(31 * M);
  assert.equal(r.inPausa('https://api.open-meteo.com/'), 0);
  const st = r.stato().find((d) => d.dominio === 'open-meteo.com');
  assert.equal(st.richieste, 1);
  assert.equal(st.non_inviate_per_pausa, 1);
});

test('rete: 3 errori di fila (rete o 5xx) = pausa breve; un successo azzera il conto', async () => {
  const o = orologio();
  let modo = 'giu';
  const f = async () => {
    if (modo === 'giu') throw new TypeError('fetch failed');
    if (modo === '503') return risposta({}, 503);
    return risposta({});
  };
  const r = creaRete({ fetch: f, ora: o.ora, pausaErroriMs: 2 * M });
  await assert.rejects(r.fetch('https://a.example.org/'));
  modo = 'ok';
  await r.fetch('https://a.example.org/');
  modo = '503';
  await r.fetch('https://a.example.org/');
  await r.fetch('https://a.example.org/');
  assert.equal(r.inPausa('https://a.example.org/'), 0);
  await r.fetch('https://a.example.org/');
  assert.ok(r.inPausa('https://a.example.org/') > 0);
  await assert.rejects(r.fetch('https://b.a.example.org/'), /in pausa.*3 errori di fila/);
  o.avanza(2 * M + 1);
  modo = 'ok';
  assert.equal((await r.fetch('https://a.example.org/')).status, 200);
});

test('rete: dominio e Retry-After', () => {
  assert.equal(dominio('https://air-quality-api.open-meteo.com/v1/x?y=1'), 'open-meteo.com');
  assert.equal(dominio('non un url'), 'sconosciuto');
  assert.equal(retryAfterMs('120'), 120_000);
  assert.equal(retryAfterMs(new Date(T + 60_000).toUTCString(), T), 60_000);
  assert.equal(retryAfterMs(null), null);
});

// ------------------------------------------------------------------ ricerca

test('ricerca dei luoghi: nomi, parole della zona, refusi, frasi', () => {
  const primo = (q) => cercaLuoghi(q, LUOGHI)[0];
  const casi = {
    "castel dell'ovo": 'castel_ovo',
    'Castello dell Ovo': 'castel_ovo',
    plebiscito: 'plebiscito',
    'piazza plebiscitto': 'plebiscito',
    maradona: 'maradona',
    stadio: 'maradona',
    'san paolo': 'maradona',
    'spacca napoli': 'centro_storico',
    'museo archeologico': 'centro_storico',
    'stazione centrale': 'garibaldi',
    'piazza garibaldi': 'garibaldi',
    'maschio angioino': 'beverello',
    'come arrivo allo stadio maradona?': 'maradona',
    'Rione Sanità': 'sanita',
    'via toledo': 'plebiscito',
    capodimonte: 'sanita',
  };
  for (const [q, id] of Object.entries(casi)) {
    const r = primo(q);
    assert.ok(r && r.punteggio >= SOGLIA, `${q}: nessun risultato`);
    assert.equal(r.id, id, q);
  }
  for (const q of ['napoli', 'xyzzy', '', 'oggi']) assert.ok(!primo(q) || primo(q).punteggio < SOGLIA, q);
});

test('ricerca delle stazioni: nome, id, linea, spareggi', () => {
  const st = snapshotSintetici().trasporti.stazioni;
  assert.equal(cercaStazioni('toledo', st)[0].stazione.id, 'anm-6325');
  assert.equal(cercaStazioni('anm-6347', st)[0].stazione.nome, 'Garibaldi');
  assert.equal(cercaStazioni('stazione garibaldi', st)[0].stazione.id, 'anm-6347');
  assert.equal(cercaStazioni('montesanto', st, { linea: 'cumana' })[0].stazione.id, 'eav-6801');
  assert.equal(cercaStazioni('cumana mostra', st)[0].stazione.id, 'eav-6804');
  assert.deepEqual(cercaStazioni('pippo', st), []);
});

test('punteggio e levenshtein', () => {
  assert.equal(levenshtein('plebiscito', 'plebiscitto'), 1);
  assert.equal(punteggio('plebiscito', 'plebiscito'), 100);
  assert.equal(punteggio('spacca napoli', 'spaccanapoli'), 95);
  assert.equal(punteggio('allo stadio', 'stadio'), 90);
  assert.equal(punteggio('garibaldi', 'napoli centrale garibaldi'), 70);
  assert.equal(punteggio('napoli', 'ssc napoli'), 0, '"napoli" da sola non è un luogo');
});

// ------------------------------------------------------------------ cache delle fonti

function Dfinto(o, risultati) {
  const conta = {};
  const D = new Proxy(
    {},
    {
      get: (_, nome) => async (...args) => {
        conta[nome] = (conta[nome] || 0) + 1;
        const r = risultati[nome];
        return typeof r === 'function' ? r(...args) : r;
      },
    },
  );
  return { D, conta };
}

test('sorgenti: TTL, coalescenza, esito degradato riprovato dopo 3 minuti', async () => {
  const o = orologio();
  let tipo = 'live';
  const { D, conta } = Dfinto(o, { meteo: () => ({ dati: { x: 1 }, fonte: { tipo, ts: o.t } }) });
  const s = creaSorgenti({ D, ora: o.ora });
  await Promise.all([s.leggi('meteo'), s.leggi('meteo'), s.leggi('meteo')]);
  assert.equal(conta.meteo, 1, 'tre richieste insieme = una lettura');
  o.avanza(14 * M);
  await s.leggi('meteo');
  assert.equal(conta.meteo, 1);
  o.avanza(2 * M);
  tipo = 'riserva';
  await s.leggi('meteo');
  assert.equal(conta.meteo, 2);
  o.avanza(2 * M);
  await s.leggi('meteo');
  assert.equal(conta.meteo, 2, 'esito degradato tenuto 3 minuti');
  o.avanza(1 * M + 1);
  await s.leggi('meteo');
  assert.equal(conta.meteo, 3);
  assert.equal(s.stato().meteo.letture, 3);
  assert.equal(s.stato().meteo.richieste, 7);
});

test('sorgenti: stale-while-revalidate (risponde col vecchio dopo attesaMaxMs e lo dichiara)', async () => {
  const o = orologio();
  let lento = false;
  const { D } = Dfinto(o, {
    eventi: () => (lento ? new Promise((ok) => setTimeout(() => ok({ dati: 'nuovo', fonte: { tipo: 'snapshot' } }), 200)) : { dati: 'vecchio', fonte: { tipo: 'snapshot' } }),
  });
  const s = creaSorgenti({ D, ora: o.ora, attesaMaxMs: 20 });
  assert.equal((await s.leggi('eventi')).dati, 'vecchio');
  o.avanza(7 * H);
  lento = true;
  const r = await s.leggi('eventi');
  assert.equal(r.dati, 'vecchio');
  assert.equal(r.fonte.vecchio, true);
  assert.match(r.fonte.nota, /aggiornamento in corso/);
  await new Promise((ok) => setTimeout(ok, 250));
  assert.equal((await s.leggi('eventi')).dati, 'nuovo');
});

test('sorgenti: passaggi con chiave per stazione, invalida, errore interno = assente', async () => {
  const o = orologio();
  const { D, conta } = Dfinto(o, {
    passaggi: (st) => ({ dati: [st.id], fonte: { tipo: 'live' } }),
    trasporti: () => {
      throw new Error('rotto');
    },
  });
  const s = creaSorgenti({ D, ora: o.ora });
  assert.deepEqual((await s.leggi('passaggi', { chiave: 'passaggi:a', args: [{ id: 'a' }] })).dati, ['a']);
  assert.deepEqual((await s.leggi('passaggi', { chiave: 'passaggi:b', args: [{ id: 'b' }] })).dati, ['b']);
  await s.leggi('passaggi', { chiave: 'passaggi:a', args: [{ id: 'a' }] });
  assert.equal(conta.passaggi, 2);
  s.invalida(['passaggi']);
  await s.leggi('passaggi', { chiave: 'passaggi:a', args: [{ id: 'a' }] });
  assert.equal(conta.passaggi, 3);
  const t = await s.leggi('trasporti');
  assert.equal(t.fonte.tipo, 'assente');
  await assert.rejects(s.leggi('boh'), /fonte sconosciuta/);
});

// ------------------------------------------------------------------ folla

test('folla stimata: curva del simulatore, effetti degli eventi reali e della stagione', () => {
  const stima = creaStimaFolla();
  const d = snapshotSintetici();
  const base = stima('maradona', { ora: T, attivi: new Map(), capienza: LUOGHI.maradona.capienza });
  assert.equal(base.persone_stimate, 40);
  assert.equal(base.livello_id, 'tranquillo');
  // partita alle 20:45: lo scenario evento_maradona si accende 3 ore prima
  const sera = N.daOraLocale(2026, 11, 14, 19, 0);
  const attivi = scenariAttivi({ eventi: d.eventi, riferimenti: d.riferimenti, ora: sera });
  assert.ok(attivi.has('evento_maradona'));
  assert.ok(attivi.has('stagione_bassa'), 'arrivi 0,5× la media: stagione bassa');
  const partita = stima('maradona', { ora: sera, attivi, capienza: LUOGHI.maradona.capienza });
  assert.equal(partita.persone_stimate, 11500); // 40 + 11 500, arrotondato al centinaio
  assert.equal(partita.livello_id, 'affollato');
  assert.ok(partita.effetti.some((e) => e.scenario === 'evento_maradona' && /Napoli - Torino/.test(e.motivo)));
  assert.equal(stima('inesistente', { ora: T, attivi, capienza: 1 }), null);
});

// ------------------------------------------------------------------ formato

test('formato: orari locali e frasi', () => {
  assert.equal(oraLocale(T), '2026-11-14 15:00');
  assert.equal(oraLocale(null), null);
  assert.equal(quando(T + H, T), 'alle 16:00');
  assert.equal(quando(T - 20 * H, T), 'ieri alle 19:00');
  assert.equal(quando(T + 2 * 24 * H, T), 'il 16/11 alle 15:00');
  assert.equal(finoA(T + 24 * H, T), 'fino a domani alle 15:00');
  assert.equal(intervallo(T + 16 * H, T + 28 * H, T), 'domani dalle 07:00 alle 19:00');
  assert.equal(intervallo(T + 5 * H, T + 20 * H, T), 'da oggi alle 20:00 a domani alle 11:00');
  assert.deepEqual(fonteBreve({ nome: 'X', tipo: 'cache', ts: T, licenza: 'CC0' }), { nome: 'X', stato: 'reale', ora_dato: '2026-11-14 15:00', licenza: 'CC0' });
  assert.equal(fonteBreve(null).stato, 'assente');
  assert.equal(citazione({ nome: 'MET', tipo: 'riserva', ts: T - H }, T), 'MET, fonte di riserva, dato delle 14:00');
});

// ------------------------------------------------------------------ configurazione

test('configurazione: predefiniti, durate, piano di aggiornamento, CORS, errori', () => {
  const c = leggiConfig({});
  assert.equal(c.porta, 8791);
  assert.equal(c.token, null);
  assert.deepEqual(c.cors, ['https://robertodisanto.it']);
  assert.equal(c.cartellaDati, CARTELLA_DATI_REPO);
  assert.deepEqual(c.aggiorna, {});
  assert.equal(c.tieniCaldo, true);
  assert.equal(c.uaForzato, false);
  const c2 = leggiConfig({ PORT: '9000', CITTA_API_TOKEN: ' abc ', CITTA_API_CORS: '*', NAPOLI_UA: 'x', CITTA_AGGIORNA: 'si', CITTA_TIENI_CALDO: '0', CITTA_PAUSA_429: '30m' });
  assert.equal(c2.porta, 9000);
  assert.equal(c2.token, 'abc');
  assert.deepEqual(c2.cors, ['*']);
  assert.equal(c2.uaForzato, true);
  assert.equal(c2.aggiorna.eventi, 6 * H);
  assert.equal(c2.tieniCaldo, false);
  assert.equal(c2.pausa429Ms, 30 * M);
  assert.equal(durata('90s'), 90_000);
  assert.equal(durata('2d'), 48 * H);
  assert.equal(durata('boh'), null);
  assert.deepEqual(pianoAggiornamento('eventi=6h, aria=90m'), { eventi: 6 * H, aria: 90 * M });
  assert.throws(() => pianoAggiornamento('pippo=1h'), /sconosciuta/);
  assert.throws(() => pianoAggiornamento('aria=1m'), /almeno 10 minuti/);
  assert.deepEqual(originiCors('https://a.it/, http://localhost:8701'), ['https://a.it', 'http://localhost:8701']);
  assert.deepEqual(originiCors(''), []);
  assert.throws(() => leggiConfig({ PORT: 'abc' }), /PORT/);
});

// ------------------------------------------------------------------ archivio e aggiornamento

test('archivio: semina dalla repo solo i file mancanti o più vecchi, ricarica i file cambiati', async () => {
  const repo = await mkdtemp(join(tmpdir(), 'citta-repo-'));
  const vol = await mkdtemp(join(tmpdir(), 'citta-vol-'));
  try {
    const d = snapshotSintetici();
    for (const [n, v] of Object.entries(d)) await writeFile(join(repo, `${n}.json`), JSON.stringify(v));
    // nel volume: eventi più recenti (rigenerati dal servizio) e meteo più vecchio
    const eventiNuovi = { ...d.eventi, meta: { ...d.eventi.meta, generato: new Date(T).toISOString() } };
    await writeFile(join(vol, 'eventi.json'), JSON.stringify(eventiNuovi));
    await writeFile(join(vol, 'meteo.json'), JSON.stringify({ ...d.meteo, meta: { generato: '2026-11-01T00:00:00Z' } }));
    const iniettati = {};
    const o = orologio();
    const a = creaArchivio({ cartella: vol, iniziale: repo, inietta: (n, v) => (iniettati[n] = v), ora: o.ora });
    await a.prepara();
    assert.equal(generatoIl(a.get('eventi')), T, 'il file più recente del volume resta');
    assert.equal(a.get('meteo').meta.generato, d.meteo.meta.generato, 'il file più vecchio è sostituito da quello della repo');
    assert.ok(iniettati.trasporti?.stazioni?.length, 'snapshot passati a fonti/dati.js');
    // file cambiato: ricaricato al controllo successivo (non prima di 30 s)
    await writeFile(join(vol, 'eventi.json'), JSON.stringify({ ...eventiNuovi, partite: [] }));
    assert.deepEqual(await a.controlla(), []);
    o.avanza(31_000);
    assert.deepEqual(await a.controlla(), ['eventi']);
    assert.deepEqual(a.get('eventi').partite, []);
    // file rovinato: resta il dato di prima
    await writeFile(join(vol, 'eventi.json'), '{rotto');
    o.avanza(31_000);
    await a.controlla();
    assert.deepEqual(a.get('eventi').partite, []);
    assert.match(a.info().eventi.errore, /JSON/);
  } finally {
    await rm(repo, { recursive: true, force: true });
    await rm(vol, { recursive: true, force: true });
  }
});

test('aggiornamento: rigenera la sezione più vecchia, una alla volta, e aspetta dopo un errore', async () => {
  const o = orologio();
  const dir = await mkdtemp(join(tmpdir(), 'citta-agg-'));
  try {
    const d = snapshotSintetici();
    for (const [n, v] of Object.entries(d)) await writeFile(join(dir, `${n}.json`), JSON.stringify(v));
    const a = creaArchivio({ cartella: dir, inietta: () => {}, ora: o.ora });
    await a.prepara();
    const chiamate = [];
    let fallisci = false;
    const aggiornaDati = async ({ solo, out }) => {
      chiamate.push(solo[0]);
      if (fallisci) return { scritti: [], errori: [{ sezione: solo[0], errore: 'giù' }] };
      const file = join(out, `${solo[0]}.json`);
      const v = JSON.parse(await readFile(file, 'utf8'));
      v.meta.generato = new Date(o.t).toISOString();
      await writeFile(file, JSON.stringify(v));
      return { scritti: [`${solo[0]}.json`], errori: [] };
    };
    let dopo = 0;
    const ag = creaAggiornamento({ piano: { eventi: 6 * H, aria: 1 * H }, archivio: a, aggiornaDati, fetch: () => {}, ora: o.ora, dopo: () => dopo++ });
    // snapshot di 5 ore fa: solo "aria" (1 h) è da rigenerare
    assert.deepEqual(ag.scadute(), ['aria']);
    await ag.giro();
    assert.deepEqual(chiamate, ['aria']);
    assert.equal(generatoIl(a.get('aria')), T);
    assert.equal(dopo, 1);
    assert.deepEqual(ag.scadute(), []);
    o.avanza(2 * H);
    fallisci = true;
    await ag.giro(); // eventi (7 h) e aria (2 h): prima il più vecchio
    assert.deepEqual(chiamate, ['aria', 'eventi']);
    assert.equal(ag.stato().ultimi_tentativi.eventi.esito, 'errore');
    await ag.giro();
    assert.deepEqual(chiamate, ['aria', 'eventi', 'aria'], 'eventi in attesa dopo l\'errore');
    o.avanza(61 * M);
    fallisci = false;
    assert.ok(ag.scadute().includes('eventi'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
