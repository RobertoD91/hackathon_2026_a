// Test dell'API completa via HTTP (porta libera), con fetch finto per le fonti, orologio finto
// e snapshot sintetici: formato delle risposte, riserve dichiarate, 429, coalescenza, token, CORS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { avviaServizio, fontiNormali, orologio, snapshotSintetici, fetchFinto, risposta, openMeteo, T, H, M } from './aiuti.js';

test('/salute risponde senza token e con lo stato degli snapshot', async () => {
  const a = await avviaServizio({ config: { token: 'segreto' } });
  try {
    const r = await a.get('/salute');
    assert.equal(r.status, 200);
    assert.equal(r.json.stato, 'ok');
    assert.equal(r.json.token_richiesto, true);
    assert.equal(r.json.ora, '2026-11-14 15:00');
    assert.match(r.json.snapshot.eventi, /^2026-11-14 10:00$/);
    assert.equal(JSON.stringify(r.json).includes('segreto'), false, 'il token non compare mai');
  } finally {
    await a.chiudi();
  }
});

test('token: senza Bearer 401, con il token giusto 200', async () => {
  const a = await avviaServizio({ config: { token: 'segreto' } });
  try {
    assert.equal((await a.get('/citta/meteo')).status, 401);
    assert.equal((await a.get('/citta/meteo', { authorization: 'Bearer sbagliato' })).status, 401);
    const ok = await a.get('/citta/meteo', { authorization: 'Bearer segreto' });
    assert.equal(ok.status, 200);
    assert.ok(ok.json.luoghi.length >= 8);
  } finally {
    await a.chiudi();
  }
});

test('CORS: origine ammessa, origine non ammessa, preflight', async () => {
  const a = await avviaServizio();
  try {
    const si = await a.get('/citta/luoghi', { origin: 'https://robertodisanto.it' });
    assert.equal(si.headers.get('access-control-allow-origin'), 'https://robertodisanto.it');
    const no = await a.get('/citta/luoghi', { origin: 'https://altro.example' });
    assert.equal(no.headers.get('access-control-allow-origin'), null);
    const pre = await globalThis.fetch(`${a.base}/citta/meteo`, { method: 'OPTIONS', headers: { origin: 'https://robertodisanto.it', 'access-control-request-headers': 'authorization' } });
    assert.equal(pre.status, 204);
    assert.match(pre.headers.get('access-control-allow-headers'), /Authorization/);
  } finally {
    await a.chiudi();
  }
  const tutti = await avviaServizio({ config: { cors: ['*'] } });
  try {
    assert.equal((await tutti.get('/salute', { origin: 'https://x.example' })).headers.get('access-control-allow-origin'), '*');
  } finally {
    await tutti.chiudi();
  }
});

test('/citta/meteo?luogo=…: campi con unità, fonte reale, testo da citare, User-Agent', async () => {
  const a = await avviaServizio();
  try {
    const r = await a.get('/citta/meteo?luogo=plebiscito');
    assert.equal(r.status, 200);
    assert.equal(r.json.luogo.id, 'plebiscito');
    const m = r.json.meteo;
    assert.equal(m.temperatura_c, 18);
    assert.equal(m.vento_kmh, 19);
    assert.equal(m.vento_nodi, 10);
    assert.equal(m.cielo, 'Parzialmente nuvoloso');
    assert.equal(m.ora_dato, '2026-11-14 14:45');
    assert.equal(r.json.fonte.stato, 'reale');
    assert.equal(r.json.fonte.licenza, 'CC BY 4.0');
    assert.match(r.json.testo, /^Piazza del Plebiscito: 18 °C.*Open-Meteo.*dato delle 14:45/);
    const ua = a.fetch.chiamate.find((c) => /open-meteo/.test(c.url)).headers['user-agent'];
    assert.equal(ua, 'test-ua/1.0');
  } finally {
    await a.chiudi();
  }
});

test('429 di Open-Meteo: riserva MET Norway dichiarata e niente nuove richieste per 15 minuti', async () => {
  const o = orologio();
  const stato = { meteo429: true };
  const a = await avviaServizio({ orologio: o, regole: fontiNormali(o.t, stato) });
  try {
    const r = await a.get('/citta/meteo?luogo=vomero');
    assert.equal(r.json.fonte.stato, 'riserva');
    assert.match(r.json.fonte.nome, /MET Norway/);
    assert.match(r.json.fonte.nota, /429/);
    assert.match(r.json.testo, /fonte di riserva/);
    const dopo429 = a.fetch.conta(/open-meteo/);
    assert.equal(dopo429, 1, 'dopo il 429 non si prova il secondo modello sullo stesso dominio');
    // 5 minuti dopo l'esito degradato è scaduto: si riprova, ma open-meteo.com è in pausa (nessuna richiesta)
    o.avanza(5 * M);
    stato.meteo429 = false;
    await a.get('/citta/meteo?luogo=vomero');
    await a.get('/citta/aria?luogo=vomero');
    assert.equal(a.fetch.conta(/open-meteo/), dopo429, 'in pausa: zero richieste a open-meteo.com');
    const f = await a.get('/citta/fonti');
    const dom = f.json.rete.find((d) => d.dominio === 'open-meteo.com');
    assert.ok(dom.in_pausa_fino, 'la pausa è visibile in /citta/fonti');
    assert.ok(dom.non_inviate_per_pausa >= 1);
    assert.ok((await a.get('/salute')).json.fonti_in_pausa.some((p) => p.dominio === 'open-meteo.com'));
    // finita la pausa si torna alla fonte principale
    o.avanza(16 * M);
    const r2 = await a.get('/citta/meteo?luogo=vomero');
    assert.equal(r2.json.fonte.stato, 'reale');
    assert.match(r2.json.fonte.nome, /ICON-2I/);
  } finally {
    await a.chiudi();
  }
});

test('tutte le fonti meteo giù: ultimo dato salvato dello snapshot, dichiarato', async () => {
  const regole = [[/open-meteo|met\.no/, () => risposta({}, 503)]];
  const a = await avviaServizio({ regole });
  try {
    const r = await a.get('/citta/meteo?luogo=lungomare');
    assert.equal(r.json.fonte.stato, 'salvato');
    assert.equal(r.json.meteo.temperatura_c, 15);
    assert.equal(r.json.meteo.ora_dato, '2026-11-14 09:00');
    assert.match(r.json.testo, /ultimo dato salvato/);
  } finally {
    await a.chiudi();
  }
});

test('coalescenza e cache: 6 richieste insieme = 1 lettura; entro 15 minuti nessuna nuova lettura', async () => {
  const o = orologio();
  const a = await avviaServizio({ orologio: o });
  try {
    await Promise.all(['plebiscito', 'vomero', 'sanita', 'lungomare', 'garibaldi', 'mergellina'].map((l) => a.get(`/citta/meteo?luogo=${l}`)));
    assert.equal(a.fetch.conta(/\/\/api\.open-meteo\.com/), 1);
    o.avanza(10 * M);
    await a.get('/citta/meteo');
    assert.equal(a.fetch.conta(/\/\/api\.open-meteo\.com/), 1);
    o.avanza(6 * M);
    await a.get('/citta/meteo');
    assert.equal(a.fetch.conta(/\/\/api\.open-meteo\.com/), 2, 'dopo 15 minuti si rilegge');
  } finally {
    await a.chiudi();
  }
});

test("/citta/luogo: ricerca tollerante, stazioni, eventi, riferimenti, folla dichiarata simulata", async () => {
  const a = await avviaServizio();
  try {
    const r = await a.get(`/citta/luogo?nome=${encodeURIComponent("castel dell'ovo")}`);
    assert.equal(r.status, 200);
    assert.equal(r.json.luogo.id, 'castel_ovo');
    assert.equal(r.json.meteo.fonte.stato, 'reale');
    assert.ok(r.json.trasporti.stazioni.length >= 1);
    assert.equal(typeof r.json.trasporti.stazioni[0].minuti_a_piedi, 'number');
    assert.equal(r.json.riferimenti.voci[0].visitatori_stesso_mese, 11500);
    assert.equal(r.json.folla.stato, 'simulato');
    assert.match(r.json.folla.nota, /NON è una misura/);
    assert.ok(r.json.folla.effetti.some((e) => e.scenario === 'stagione_bassa'), 'novembre: stagione bassa (ISTAT)');
    assert.match(r.json.testo, /simulata, non misurata/);
    assert.match(r.json.testo, /nel 2025 Castel dell'Ovo risultava chiuso per lavori.*verificare l'apertura/);

    const pl = await a.get('/citta/luogo?nome=piazza%20plebiscitto');
    assert.equal(pl.json.luogo.id, 'plebiscito');
    const st = await a.get('/citta/luogo?nome=stadio');
    assert.equal(st.json.luogo.id, 'maradona');
    assert.equal(st.json.eventi_oggi[0].titolo, 'Napoli - Torino');
    assert.equal(st.json.eventi_oggi[0].sposta_folla, true);

    const bag = await a.get('/citta/luogo?nome=bagnoli');
    assert.equal(bag.json.luogo.tipo, 'stazione');
    assert.equal(bag.json.luogo.luogo_monitorato_vicino.zona, 'maradona');
    assert.match(bag.json.nota, /luogo monitorato più vicino/);

    const no = await a.get('/citta/luogo?nome=xyzzy');
    assert.equal(no.status, 404);
    assert.equal(no.json.suggerimenti.length, 10);
    assert.equal((await a.get('/citta/luogo')).status, 400);
    const coord = await a.get('/citta/luogo?lat=40.8359&lon=14.2488');
    assert.equal(coord.json.luogo.tipo, 'coordinate');
    assert.equal((await a.get('/citta/luogo?lat=45.46&lon=9.19')).status, 400);
  } finally {
    await a.chiudi();
  }
});

test('/citta/aria: centralina vicina recente oppure modello CAMS', async () => {
  const a = await avviaServizio();
  try {
    const g = await a.get('/citta/aria?luogo=garibaldi');
    assert.match(g.json.aria.origine, /centralina/);
    assert.equal(g.json.aria.classe_nome, 'moderata'); // NO2 95 µg/m³
    assert.equal(g.json.aria.centralina.misure.NO2.ultimo_ugm3, 95);
    assert.match(g.json.testo, /NA07 ENTE FERROVIE.*oggi alle 05:00/);
    const p = await a.get('/citta/aria?luogo=plebiscito'); // centralina a 2 km: vale il modello
    assert.match(p.json.aria.origine, /modello/);
    assert.equal(p.json.aria.modello.indice_europeo, 30);
    const tutta = await a.get('/citta/aria');
    assert.equal(tutta.json.luoghi.length, 10);
    assert.equal(tutta.json.centraline[0].classe, 'moderata');
  } finally {
    await a.chiudi();
  }
});

test('/citta/allerta: avviso giallo in vigore e "nessun avviso in vigore" dal vivo', async () => {
  const a = await avviaServizio();
  try {
    const r = await a.get('/citta/allerta');
    assert.equal(r.json.regionale.attiva, true);
    assert.equal(r.json.regionale.colore, 'gialla');
    assert.equal(r.json.regionale.fenomeni_tipo, 'mare agitato, vento forte');
    assert.equal(r.json.fonte.stato, 'reale');
    assert.match(r.json.testo, /^ALLERTA GIALLA per Napoli.*fino alle 21:00/);
    assert.match(r.json.testo, /Meteoalarm.*temporali arancione domani dalle 07:00 alle 19:00/);
  } finally {
    await a.chiudi();
  }
  const o = orologio();
  const dati = snapshotSintetici(o.t);
  dati.meteo.allerta = { grezzo: { ultima: { idBollettino: 3, numeroAvviso: 90, dataEmissione: '10:00 - 12/11/2026', dataDa: '12:00 - 12/11/2026', dataA: '12:00 - 13/11/2026', bollettinoMeteoBindList: [{ zona: 1, livello: 2, tipoDesc: 'piogge' }] }, zona: null, domani: null } };
  const b = await avviaServizio({ orologio: o, dati, regole: fontiNormali(o.t, { allerta: { vuota: true } }) });
  try {
    const r = await b.get('/citta/allerta');
    assert.equal(r.json.regionale.attiva, false);
    assert.equal(r.json.fonte.stato, 'reale');
    assert.match(r.json.testo, /^Nessuna allerta meteo regionale in corso per Napoli: l'ultimo avviso \(n\. 90/);
  } finally {
    await b.chiudi();
  }
});

test('/citta/eventi: oggi, domani, data, giorno della settimana, luogo, errori', async () => {
  const a = await avviaServizio();
  try {
    const oggi = await a.get('/citta/eventi');
    assert.equal(oggi.json.giorno, '2026-11-14');
    const partita = oggi.json.eventi.find((e) => e.titolo === 'Napoli - Torino');
    assert.equal(partita.orario, 'dalle 20:45');
    assert.equal(partita.inizio, '2026-11-14 20:45');
    assert.equal(partita.luogo, 'Stadio Diego Armando Maradona');
    assert.equal(partita.fonte, 'openfootball (calendario Serie A)');
    const tri = oggi.json.eventi.find((e) => e.titolo === 'Tri Gold Caracciolo');
    assert.equal(tri.in_corso, false, 'finito alle 13:00');
    assert.ok(oggi.json.prossimi.some((p) => /navi da crociera/.test(p.titolo)));
    assert.ok(oggi.json.prossimi.some((p) => /Louis Vuitton/.test(p.titolo)), "il primo giorno dell'America's Cup è sempre tra i prossimi");
    const lun = await a.get('/citta/eventi?giorno=luned%C3%AC');
    assert.equal(lun.json.giorno, '2026-11-16');
    const navi = lun.json.eventi.find((e) => e.tipo === 'Crociere');
    assert.equal(navi.inizio, null, 'niente orari inventati per le navi');
    assert.match(navi.orario, /non pubblicati/);
    assert.equal((await a.get('/citta/eventi?giorno=domani')).json.giorno, '2026-11-15');
    assert.equal((await a.get('/citta/eventi?giorno=21/11')).json.giorno, '2026-11-21');
    const lm = await a.get('/citta/eventi?luogo=lungomare');
    assert.deepEqual(lm.json.eventi.map((e) => e.titolo), ['Tri Gold Caracciolo']);
    assert.equal((await a.get('/citta/eventi?giorno=boh')).status, 400);
  } finally {
    await a.chiudi();
  }
});

test('/citta/passaggi: Transitous dal vivo, linea EAV leggibile, riserva sull\'orario programmato', async () => {
  const o = orologio();
  const stato = {};
  const a = await avviaServizio({ orologio: o, regole: fontiNormali(o.t, stato) });
  try {
    const r = await a.get('/citta/passaggi?stazione=toledo');
    assert.equal(r.json.stazione.id, 'anm-6325');
    assert.deepEqual(r.json.passaggi.map((p) => p.tra_min), [5, 14, 23]);
    assert.equal(r.json.passaggi[0].tempo_reale, true);
    assert.equal(r.json.fonte.stato, 'reale');
    assert.match(r.json.testo, /^Prossime partenze da Toledo \(L1\): 15:05 L1 per PISCINOLA/);
    const ms = await a.get('/citta/passaggi?stazione=montesanto&linea=cumana');
    assert.equal(ms.json.stazione.id, 'eav-6801');
    assert.equal(ms.json.passaggi[0].linea, 'Cumana');
    const g = await a.get('/citta/passaggi?stazione=garibaldi');
    assert.equal(g.json.stazione.id, 'anm-6347', 'a parità di nome vince la metro L1');
    assert.ok(g.json.altre_stazioni_con_nome_simile.some((s) => s.id === 'anm-6271'));
    stato.transitousGiu = true;
    o.avanza(2 * M);
    const giu = await a.get('/citta/passaggi?stazione=toledo');
    assert.equal(giu.json.passaggi.length, 0);
    assert.equal(giu.json.programmato.corse_in_quest_ora, 8, 'sabato: 8 corse programmate');
    assert.match(giu.json.testo, /non disponibili.*Orario programmato: 8 corse in quest'ora \(sabato\)/);
    assert.equal((await a.get('/citta/passaggi?stazione=pippo')).status, 404);
    assert.equal((await a.get('/citta/passaggi')).status, 400);
    assert.equal((await a.get(`/citta/passaggi?stazione=${'a'.repeat(200)}`)).status, 400);
  } finally {
    await a.chiudi();
  }
});

test('/citta/trasporti/vicino: stazioni ordinate, avvisi EAV pertinenti, passaggi della prima', async () => {
  const a = await avviaServizio();
  try {
    const r = await a.get('/citta/trasporti/vicino?luogo=plebiscito&passaggi=1');
    assert.equal(r.json.stazioni[0].nome, 'Chiaia');
    assert.ok(r.json.stazioni[0].distanza_m < 100);
    assert.equal(r.json.prossimi_passaggi.stazione, 'Chiaia');
    const st = await a.get('/citta/trasporti/vicino?luogo=maradona');
    assert.equal(st.json.stazioni[0].nome, 'Mostra');
    assert.equal(st.json.avvisi[0].titolo, 'Cumana: ascensore di Mostra fuori servizio');
  } finally {
    await a.chiudi();
  }
});

test('/citta/riassunto: quadro completo, testo per il contesto, formato=testo', async () => {
  const a = await avviaServizio();
  try {
    const r = await a.get('/citta/riassunto');
    assert.equal(r.status, 200);
    for (const k of ['ora', 'testo', 'allerta', 'meteo', 'aria', 'eventi_oggi', 'prossimi_eventi', 'trasporti', 'terremoti', 'stagione', 'folla_stimata', 'fonti', 'legenda_stati']) assert.ok(k in r.json, k);
    assert.equal(r.json.folla_stimata.stato, 'simulato');
    assert.ok(r.json.fonti.some((f) => f.dato === 'folla' && f.stato === 'simulato'));
    assert.match(r.json.testo, /^Napoli, sabato 14 novembre 2026, ore 15:00\. ALLERTA GIALLA/);
    assert.match(r.json.testo, /Napoli - Torino/);
    assert.match(r.json.testo, /stima del simulatore, non una misura/);
    assert.ok(r.testo.length < 20_000, 'risposta compatta');
    const t = await a.get('/citta/riassunto?formato=testo');
    assert.match(t.headers.get('content-type'), /text\/plain/);
    assert.equal(t.testo.trim(), r.json.testo);
  } finally {
    await a.chiudi();
  }
});

test('/citta/fonti, /citta/luoghi, indice, 404, metodo non GET', async () => {
  const a = await avviaServizio();
  try {
    await a.get('/citta/meteo');
    const f = await a.get('/citta/fonti');
    const meteo = f.json.fonti.find((x) => x.id === 'meteo');
    assert.equal(meteo.stato, 'reale');
    assert.equal(meteo.cache_min, 15);
    assert.equal(f.json.fonti.find((x) => x.id === 'folla').stato, 'simulato');
    assert.equal(f.json.fonti.find((x) => x.id === 'traffico').stato, 'non ancora letto');
    assert.ok(f.json.snapshot.eventi.generato);
    const l = await a.get('/citta/luoghi');
    assert.equal(l.json.luoghi.length, 10);
    assert.equal(l.json.luoghi[0].stazione_piu_vicina, 'Chiaia (L6), 2 min a piedi');
    const i = await a.get('/');
    assert.ok(i.json.endpoint.some((e) => e.percorso === '/citta/riassunto'));
    assert.equal((await a.get('/citta/boh')).status, 404);
    const post = await globalThis.fetch(`${a.base}/citta/meteo`, { method: 'POST' });
    assert.equal(post.status, 405);
  } finally {
    await a.chiudi();
  }
});

test('alias: percorsi senza /citta, /citta/eventi/<giorno>, token anche sugli alias', async () => {
  const a = await avviaServizio({ config: { token: 'x' } });
  const auth = { authorization: 'Bearer x' };
  try {
    assert.equal((await a.get('/meteo?luogo=vomero', auth)).json.luogo.id, 'vomero');
    assert.equal((await a.get('/eventi/domani', auth)).json.giorno, '2026-11-15');
    assert.equal((await a.get('/citta/eventi/2026-11-21', auth)).json.giorno, '2026-11-21');
    assert.equal((await a.get('/luoghi')).status, 401);
  } finally {
    await a.chiudi();
  }
});

test('snapshot rigenerato su disco: ricaricato entro 30 s senza riavvio', async () => {
  const o = orologio();
  const a = await avviaServizio({ orologio: o });
  try {
    assert.equal((await a.get('/citta/eventi?giorno=2026-11-20')).json.eventi.length, 0);
    const dati = snapshotSintetici(o.t);
    dati.eventi.partite.push({ giorno: '2026-11-20', ora: '18:00', casa: 'Napoli', ospite: 'Lecce', competizione: 'Coppa Italia', fonte: 'thesportsdb' });
    dati.eventi.meta.generato = new Date(o.t).toISOString();
    await writeFile(join(a.dir, 'eventi.json'), JSON.stringify(dati.eventi));
    o.avanza(31_000);
    const r = await a.get('/citta/eventi?giorno=2026-11-20');
    assert.equal(r.json.eventi[0].titolo, 'Napoli - Lecce');
    assert.equal(r.json.eventi[0].fonte, 'TheSportsDB');
  } finally {
    await a.chiudi();
  }
});

test('fetch finto: nessuna regola = 404 (controllo dell\'aiuto)', async () => {
  const f = fetchFinto([[/zzz/, () => risposta(openMeteo(T))]]);
  assert.equal((await f('https://boh.example/')).status, 404);
  assert.equal(f.conta(/boh/), 1);
  assert.ok(H > M);
});
