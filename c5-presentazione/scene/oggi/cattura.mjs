#!/usr/bin/env node
// Cattura i DATI VERI di "Napoli adesso" per la scena scene/adesso.html del video di TwinCIRO.
//
// Avvia l'API dati città (citta-api) in locale su una porta libera, senza token e con la rete vera,
// le fa tutte le domande della scena nello stesso momento e salva le risposte in questa cartella
// (scene/oggi/*.json), ognuna con l'ora di cattura; cattura.json è l'indice. La scena legge solo
// questi file: nell'HTML non c'è nessun valore scritto a mano.
//
//   node c5-presentazione/scene/oggi/cattura.mjs                  # rinfresca eventi, aria e meteo (~30 s), poi cattura
//   node c5-presentazione/scene/oggi/cattura.mjs --aggiorna eventi,aria   # rinfresca solo queste sezioni
//   node c5-presentazione/scene/oggi/cattura.mjs --senza-aggiorna # usa gli snapshot della repo così come sono
//   node c5-presentazione/scene/oggi/cattura.mjs --api https://twinciro.robertodisanto.it/citta-api
//        # da un'API già accesa (token in CITTA_API_TOKEN): utile se dalla sandbox Open-Meteo risponde 429
//   node c5-presentazione/scene/oggi/cattura.mjs --uscita /tmp/prova   # scrive altrove (per provarla)
//   node c5-presentazione/scene/oggi/cattura.mjs --tieni          # non cancella la cartella temporanea (log dell'API)
//
// - Gli snapshot rinfrescati vanno in una cartella temporanea: quelli della repo (citta-api/dati/) non si toccano.
// - User-Agent verso le fonti: NAPOLI_UA oppure "TwinCIRO/1.0 (demo hackathon; dati aperti)". Mai dati personali.
// - Se una sola domanda fallisce non si scrive niente: la cattura precedente resta intera.
// - Alla fine cancella dalla cache di monta.py le vecchie rese di adesso.html ($C5_VIDEO_LAVORO/sorgenti/adesso-*.mp4):
//   la chiave della cache non guarda i JSON, quindi senza questo il montaggio userebbe i dati vecchi.

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const QUI = path.dirname(fileURLToPath(import.meta.url)); // c5-presentazione/scene/oggi
const REPO = path.resolve(QUI, '../../..');
const API_DIR = path.join(REPO, 'citta-api');
const UA = (process.env.NAPOLI_UA || '').trim() || 'TwinCIRO/1.0 (demo hackathon; dati aperti)';
const FUSO = 'Europe/Rome';

const arg = process.argv.slice(2);
const opz = (n, d = null) => {
  const i = arg.indexOf(`--${n}`);
  return i >= 0 && arg[i + 1] && !arg[i + 1].startsWith('--') ? arg[i + 1] : d;
};
if (arg.includes('--aiuto') || arg.includes('--help') || arg.includes('-h')) {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((r) => r.startsWith('//')).map((r) => r.slice(3)).join('\n'));
  process.exit(0);
}
const API_ESTERNA = opz('api')?.replace(/\/+$/, '') || null;
// Sezioni degli snapshot da rinfrescare prima della cattura: eventi (agenda di oggi), aria (centraline
// ARPAC) e meteo (Meteoalarm e le riserve di meteo, allerta e terremoti). Meteoalarm l'API lo legge solo da qui.
const SEZIONI = (opz('aggiorna', 'eventi,aria,meteo') || '').split(',').map((x) => x.trim()).filter(Boolean);
const AGGIORNA = !arg.includes('--senza-aggiorna') && !API_ESTERNA && SEZIONI.length > 0;
const USCITA = path.resolve(opz('uscita', QUI));
const TIENI = arg.includes('--tieni');

/** Le domande della scena: file di uscita, percorso dell'API e parametri. */
const CDS = 'Città della Scienza';
const DOMANDE = [
  { file: 'riassunto', percorso: '/citta/riassunto' },
  { file: 'meteo', percorso: '/citta/meteo' },
  { file: 'meteo-plebiscito', percorso: '/citta/meteo', q: { luogo: 'plebiscito' } },
  { file: 'meteo-castel-dell-ovo', percorso: '/citta/meteo', q: { luogo: "castel dell'ovo" } },
  { file: 'meteo-citta-della-scienza', percorso: '/citta/meteo', q: { luogo: CDS } },
  { file: 'allerta', percorso: '/citta/allerta' },
  { file: 'eventi-oggi', percorso: '/citta/eventi', q: { giorno: 'oggi' } },
  { file: 'trasporti-citta-della-scienza', percorso: '/citta/trasporti/vicino', q: { luogo: CDS, passaggi: '1' } },
  { file: 'passaggi-montesanto', percorso: '/citta/passaggi', q: { stazione: 'montesanto' } },
  { file: 'passaggi-toledo', percorso: '/citta/passaggi', q: { stazione: 'toledo' } },
  { file: 'aria', percorso: '/citta/aria' },
  { file: 'terremoti', percorso: '/citta/terremoti' },
  { file: 'traffico', percorso: '/citta/traffico' },
  { file: 'fonti', percorso: '/citta/fonti' },
  // La domanda che TwinCIRO riceverebbe dai giurati, che sono lì: la skill napoli-citta-dati usa formato=testo
  { file: 'come-arrivo', percorso: '/citta/trasporti/vicino', q: { luogo: CDS, passaggi: '1', formato: 'testo' }, domanda: `Come arrivo a ${CDS}?` },
];

// ------------------------------------------------------------------ orari (ora di Napoli)

const parti = (ts) =>
  Object.fromEntries(
    new Intl.DateTimeFormat('it-IT', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
      .formatToParts(ts)
      .map((p) => [p.type, p.value]),
  );
const oraLocale = (ts) => {
  const p = parti(ts);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
};
const giornoTesto = (ts) => new Intl.DateTimeFormat('it-IT', { timeZone: FUSO, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(ts);

// ------------------------------------------------------------------ utilità

const dorme = (ms) => new Promise((r) => setTimeout(r, ms));
const scrivi = (m) => console.log(`[cattura] ${m}`);

function portaLibera() {
  return new Promise((ok, ko) => {
    const s = net.createServer();
    s.unref();
    s.on('error', ko);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
  });
}

const haCurl = () => spawnSync('curl', ['--version'], { stdio: 'ignore' }).status === 0;

/** URL di una domanda (parametri codificati: spazi e apostrofi compresi). */
function url(base, d) {
  const qs = new URLSearchParams(d.q || {}).toString();
  return `${base}${d.percorso}${qs ? `?${qs}` : ''}`;
}

/** La stessa richiesta da leggere: /citta/meteo?luogo=castel dell'ovo */
const leggibile = (d) => `${d.percorso}${d.q ? `?${Object.entries(d.q).map(([k, v]) => `${k}=${v}`).join('&')}` : ''}`;
const mostra = (p) => (p.startsWith(`${REPO}${path.sep}`) ? path.relative(REPO, p) : p);

async function chiedi(base, d, token) {
  const t0 = Date.now();
  const res = await fetch(url(base, d), {
    headers: { accept: 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    signal: AbortSignal.timeout(60_000),
  });
  const corpo = await res.text();
  let risposta = corpo;
  if (d.q?.formato !== 'testo' || !res.ok) {
    try {
      risposta = JSON.parse(corpo);
    } catch {
      throw new Error(`${d.percorso}: risposta non JSON (HTTP ${res.status}): ${corpo.slice(0, 160)}`);
    }
  } else risposta = corpo.trim();
  return { d, http: res.status, ms: Date.now() - t0, risposta };
}

// ------------------------------------------------------------------ API locale

async function avviaApiLocale(tmp) {
  const dati = path.join(tmp, 'dati');
  fs.mkdirSync(dati, { recursive: true });
  for (const f of fs.readdirSync(path.join(API_DIR, 'dati'))) {
    if (f.endsWith('.json')) fs.copyFileSync(path.join(API_DIR, 'dati', f), path.join(dati, f));
  }
  const envBase = { ...process.env, CITTA_DATI: dati, CITTA_DATI_INIZIALI: dati, NAPOLI_UA: UA };
  let aggiornamento = { fatto: false };
  if (AGGIORNA) {
    const curl = haCurl();
    scrivi(`rinfresco gli snapshot (${SEZIONI.join(', ')}) in una cartella temporanea${curl ? ', con curl' : ''}…`);
    const r = spawnSync(process.execPath, [path.join(API_DIR, 'aggiorna.js'), '--solo', SEZIONI.join(','), ...(curl ? ['--curl'] : [])], {
      cwd: REPO,
      env: envBase,
      encoding: 'utf8',
      timeout: 8 * 60_000,
    });
    const righe = `${r.stdout || ''}${r.stderr || ''}`.split('\n').filter(Boolean);
    fs.writeFileSync(path.join(tmp, 'aggiorna.log'), `${righe.join('\n')}\n`);
    const importanti = righe.filter((x) => /scritto|ERRORE|pausa|fatto in/.test(x)).map((x) => x.replace(/^\[aggiorna\]\s*/, '').replace(tmp, '<temporanea>'));
    for (const x of importanti) scrivi(`  ${x}`);
    aggiornamento = { fatto: true, sezioni: SEZIONI, esito: r.status === 0 ? 'ok' : `con errori (uscita ${r.status ?? r.signal})`, righe: importanti };
  }
  const porta = await portaLibera();
  const log = fs.openSync(path.join(tmp, 'api.log'), 'a');
  const api = spawn(process.execPath, [path.join(API_DIR, 'server.js')], {
    cwd: REPO,
    env: { ...envBase, PORT: String(porta), HOST: '127.0.0.1', CITTA_API_TOKEN: '', CITTA_AGGIORNA: '', CITTA_API_CORS: '', CITTA_TIENI_CALDO: '1', CITTA_LOG: '1' },
    stdio: ['ignore', log, log],
  });
  const base = `http://127.0.0.1:${porta}`;
  const limite = Date.now() + 30_000;
  for (;;) {
    if (api.exitCode != null) throw new Error(`l'API si è fermata all'avvio (uscita ${api.exitCode}): vedi ${path.join(tmp, 'api.log')}`);
    try {
      const r = await fetch(`${base}/salute`, { signal: AbortSignal.timeout(2000) });
      if (r.ok) break;
    } catch {
      /* non ancora in ascolto */
    }
    if (Date.now() > limite) throw new Error("l'API non risponde su /salute dopo 30 s");
    await dorme(300);
  }
  scrivi(`API dati città in locale su ${base} (senza token, User-Agent "${UA}")`);
  return {
    base,
    dove: `locale: node citta-api/server.js su 127.0.0.1:${porta}, senza token`,
    aggiornamento,
    async ferma() {
      if (api.exitCode == null) {
        api.kill('SIGTERM');
        await Promise.race([new Promise((r) => api.once('exit', r)), dorme(6000)]);
      }
      fs.closeSync(log);
    },
  };
}

// ------------------------------------------------------------------ cattura

async function main() {
  // cartella temporanea solo per l'API locale (snapshot rinfrescati e log)
  const tmp = API_ESTERNA ? null : fs.mkdtempSync(path.join(os.tmpdir(), 'twinciro-cattura-'));
  const token = API_ESTERNA ? (process.env.CITTA_API_TOKEN || '').trim() : '';
  const api = API_ESTERNA
    ? { base: API_ESTERNA, dove: `${API_ESTERNA}${token ? ' (con token)' : ''}`, aggiornamento: { fatto: false, nota: 'API esterna: snapshot suoi' }, ferma: async () => {} }
    : await avviaApiLocale(tmp);
  let ok = false;
  try {
    // 1) Giro di riscaldamento: ogni fonte viene letta una volta (prima lettura, riserve, pause dopo un 429)
    scrivi('giro di riscaldamento (prima lettura di ogni fonte)…');
    await Promise.allSettled(DOMANDE.map((d) => chiedi(api.base, d, token)));
    await dorme(2500);

    // 2) La cattura vera: tutte le domande nello stesso istante, dalla cache appena riempita
    const t = Date.now();
    const esiti = await Promise.allSettled(DOMANDE.map((d) => chiedi(api.base, d, token)));
    const durata = Date.now() - t;
    const falliti = esiti
      .map((e, i) => (e.status === 'rejected' ? `${DOMANDE[i].file}: ${e.reason?.message || e.reason}` : e.value.http !== 200 ? `${DOMANDE[i].file}: HTTP ${e.value.http} ${JSON.stringify(e.value.risposta).slice(0, 200)}` : null))
      .filter(Boolean);
    if (falliti.length) throw new Error(`domande fallite, nessun file scritto:\n  ${falliti.join('\n  ')}`);

    let salute = null;
    try {
      salute = await (await fetch(`${api.base}/salute`, { signal: AbortSignal.timeout(5000) })).json();
    } catch {
      /* /salute è facoltativo per l'indice */
    }

    const catturato = oraLocale(t);
    fs.mkdirSync(USCITA, { recursive: true });
    const elenco = [];
    for (const e of esiti) {
      const { d, http, ms, risposta } = e.value;
      const richiesta = leggibile(d);
      const corpo = {
        catturato_il: catturato,
        richiesta: `GET ${richiesta}`,
        ...(d.domanda ? { domanda: d.domanda } : {}),
        formato: d.q?.formato === 'testo' ? 'testo' : 'json',
        http,
        risposta,
      };
      fs.writeFileSync(path.join(USCITA, `${d.file}.json`), `${JSON.stringify(corpo, null, 2)}\n`);
      elenco.push({ file: `${d.file}.json`, richiesta, http, ms });
    }
    const p = parti(t);
    const indice = {
      nota: "Dati veri di Napoli catturati dall'API dati città di TwinCIRO (citta-api) in un momento solo, per la scena adesso.html del video. Ogni file ha la richiesta, l'ora di cattura e la risposta dell'API così com'è (stato del dato in fonte.stato). Rifare: node c5-presentazione/scene/oggi/cattura.mjs",
      catturato_il: catturato,
      catturato_iso: new Date(t).toISOString(),
      fuso: FUSO,
      giorno_testo: giornoTesto(t),
      ora: `${p.hour}:${p.minute}`,
      durata_cattura_ms: durata,
      api: {
        dove: api.dove,
        versione: salute?.versione ?? null,
        user_agent: API_ESTERNA ? null : UA,
        snapshot_generati: salute?.snapshot ?? null,
        fonti_in_pausa: salute?.fonti_in_pausa ?? [],
        rinfresco_snapshot: api.aggiornamento,
      },
      file: elenco,
    };
    fs.writeFileSync(path.join(USCITA, 'cattura.json'), `${JSON.stringify(indice, null, 2)}\n`);
    ok = true;

    // Riepilogo a terminale: ora, stato di ogni fonte, la risposta per i giurati
    scrivi(`catturato ${indice.giorno_testo}, ore ${indice.ora} (${catturato}, ${FUSO}) in ${durata} ms → ${mostra(USCITA)}/`);
    const fonti = JSON.parse(fs.readFileSync(path.join(USCITA, 'fonti.json'), 'utf8')).risposta.fonti || [];
    for (const f of fonti) scrivi(`  ${String(f.stato).padEnd(16)} ${f.dato}${f.nome ? ` · ${f.nome}` : ''}${f.ora_dato ? ` · dato ${f.ora_dato}` : ''}`);
    for (const x of indice.api.fonti_in_pausa) scrivi(`  in pausa: ${x.dominio} fino alle ${x.fino} (${x.motivo})`);
    const ca = JSON.parse(fs.readFileSync(path.join(USCITA, 'come-arrivo.json'), 'utf8'));
    scrivi(`«${ca.domanda}» → ${ca.risposta}`);

    // La cache di monta.py non guarda i JSON: tolgo le vecchie rese della scena
    if (USCITA === QUI) {
      const sorgenti = path.join(process.env.C5_VIDEO_LAVORO || '/tmp/c5-video-lavoro', 'sorgenti');
      const vecchie = fs.existsSync(sorgenti) ? fs.readdirSync(sorgenti).filter((f) => /^adesso-.*\.mp4$/.test(f)) : [];
      for (const f of vecchie) fs.rmSync(path.join(sorgenti, f));
      if (vecchie.length) scrivi(`tolte dalla cache del montaggio ${vecchie.length} rese vecchie di adesso.html`);
    }
  } finally {
    await api.ferma();
    if (tmp && (TIENI || !ok)) scrivi(`cartella temporanea (log dell'API e del rinfresco): ${tmp}`);
    else if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(`[cattura] ERRORE: ${err?.message || err}`);
  process.exit(1);
});
