#!/usr/bin/env node
// Controlla che dei messaggi MQTT rispettino il formato unico di TwinCiro (firmware/README.md).
// Legge righe "<topic> <payload>" (come le stampa `mosquitto_sub -v`) da stdin o da un file:
//
//   mosquitto_sub -h ... -t 'napoli/#' -v | node firmware/valida-messaggi.mjs
//   node firmware/valida-messaggi.mjs messaggi.txt
//   node firmware/valida-messaggi.mjs --zone c5-agentic-city/dati/scenario_regata.json messaggi.txt
//
// Le zone valide arrivano dalla chiave "zone" dello scenario di c5-agentic-city (predefinito:
// ../c5-agentic-city/dati/scenario_regata.json rispetto a questo file); se il file non c'è
// si controlla solo la forma del nome. Gli altri topic napoli/... (folla, meteo, agenti, i topic
// interni di Tasmota sotto napoli/nodi/<id>/cmnd|stat|tele/) sono della città e vengono saltati;
// qualsiasi topic fuori da napoli/ è un errore (es. il vecchio bighack/ o tele/ di Tasmota).
// Esce con 1 se almeno un messaggio non va bene. Node ≥ 18, nessuna dipendenza.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const QUI = dirname(fileURLToPath(import.meta.url));
const ID = /^[A-Za-z0-9._-]{1,64}$/;
const NOME_ZONA = /^[a-z0-9_]{1,31}$/;
// grandezza → [minimo, massimo, intero]
const GRANDEZZE = {
  temperatura: [-40, 85, false],
  umidita: [0, 100, false],
  luce: [0, 200000, false],
  pressione: [300, 1100, false],
  persone: [0, 100000, true],
};
const RUOLI = ['badge', 'tasmota'];

function argomenti(argv) {
  const a = { zone: join(QUI, '..', 'c5-agentic-city', 'dati', 'scenario_regata.json'), file: null, zoneEsplicite: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--zone') { a.zone = argv[++i]; a.zoneEsplicite = true; }
    else a.file = argv[i];
  }
  return a;
}

function caricaZone(percorso, esplicite) {
  if (!existsSync(percorso)) {
    if (esplicite) throw new Error(`file delle zone non trovato: ${percorso}`);
    return null;
  }
  return new Set(Object.keys(JSON.parse(readFileSync(percorso, 'utf8')).zone || {}));
}

function oggetto(testo) {
  let v;
  try { v = JSON.parse(testo); } catch { return [null, 'JSON non valido']; }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return [null, 'il JSON deve essere un oggetto'];
  return [v, null];
}

function zonaOk(z, zone) {
  if (typeof z !== 'string' || !NOME_ZONA.test(z)) return 'zona assente o non valida (minuscole, cifre e _)';
  if (zone && !zone.has(z)) return `zona "${z}" non è nello scenario (${[...zone].join(', ')})`;
  return null;
}

/** Controlla un messaggio. Ritorna { esito: 'ok'|'errore'|'saltato', motivo }. */
export function controlla(topic, payload, zone = null) {
  const p = topic.split('/');
  if (p[0] !== 'napoli') return { esito: 'errore', motivo: 'fuori dal formato: i topic iniziano con napoli/' };

  if (p[1] === 'sensori') {
    if (p.length !== 4) return { esito: 'errore', motivo: 'atteso napoli/sensori/<id>/<grandezza>' };
    const [, , id, g] = p;
    if (!ID.test(id)) return { esito: 'errore', motivo: `id "${id}" non valido (1-64 tra lettere, cifre, . _ -)` };
    if (!GRANDEZZE[g]) return { esito: 'errore', motivo: `grandezza "${g}" sconosciuta (${Object.keys(GRANDEZZE).join(', ')})` };
    const [m, e] = oggetto(payload);
    if (e) return { esito: 'errore', motivo: e };
    const ammesse = g === 'persone' ? ['zona', 'valore', 'moltiplicatore'] : ['zona', 'valore'];
    const extra = Object.keys(m).filter((k) => !ammesse.includes(k));
    if (extra.length) return { esito: 'errore', motivo: `campi non previsti: ${extra.join(', ')}` };
    const ez = zonaOk(m.zona, zone);
    if (ez) return { esito: 'errore', motivo: ez };
    const [min, max, intero] = GRANDEZZE[g];
    if (typeof m.valore !== 'number' || !Number.isFinite(m.valore)) return { esito: 'errore', motivo: 'valore deve essere un numero' };
    if (m.valore < min || m.valore > max) return { esito: 'errore', motivo: `valore ${m.valore} fuori da ${min}..${max}` };
    if (intero && !Number.isInteger(m.valore)) return { esito: 'errore', motivo: 'persone: valore intero' };
    if ('moltiplicatore' in m && !(Number.isInteger(m.moltiplicatore) && m.moltiplicatore > 0))
      return { esito: 'errore', motivo: 'moltiplicatore: intero positivo' };
    return { esito: 'ok' };
  }

  if (p[1] === 'nodi') {
    if (p.length < 4 || !ID.test(p[2])) return { esito: 'errore', motivo: 'atteso napoli/nodi/<id>/...' };
    if (p.length === 4 && p[3] === 'stato') {
      if (payload === '') return { esito: 'saltato', motivo: 'stato trattenuto cancellato' };
      const [m, e] = oggetto(payload);
      if (e) return { esito: 'errore', motivo: e };
      if (typeof m.online !== 'boolean') return { esito: 'errore', motivo: 'online (true/false) obbligatorio' };
      if (!m.online) {
        return Object.keys(m).length === 1 ? { esito: 'ok' } : { esito: 'errore', motivo: 'offline: solo {"online":false}' };
      }
      if (!RUOLI.includes(m.ruolo)) return { esito: 'errore', motivo: `ruolo deve essere ${RUOLI.join(' o ')}` };
      const ez = zonaOk(m.zona, zone);
      if (ez) return { esito: 'errore', motivo: ez };
      if ('versione' in m && typeof m.versione !== 'string') return { esito: 'errore', motivo: 'versione: testo' };
      if ('ip' in m && !(typeof m.ip === 'string' && /^\d{1,3}(\.\d{1,3}){3}$/.test(m.ip))) return { esito: 'errore', motivo: 'ip: IPv4 come testo' };
      if ('rssi' in m && !(Number.isInteger(m.rssi) && m.rssi >= -120 && m.rssi < 0)) return { esito: 'errore', motivo: 'rssi: intero in dBm (-120..-1)' };
      return { esito: 'ok' };
    }
    if (p.length === 4 && p[3] === 'cmd') {
      const [, e] = oggetto(payload);
      return e ? { esito: 'errore', motivo: `cmd: ${e}` } : { esito: 'ok' };
    }
    if (['cmnd', 'stat', 'tele'].includes(p[3])) return { esito: 'saltato', motivo: 'topic interno di Tasmota' };
    return { esito: 'errore', motivo: 'sotto napoli/nodi/<id>/ ci sono solo stato, cmd e i topic di Tasmota' };
  }

  return { esito: 'saltato', motivo: 'topic della città (c5-agentic-city)' };
}

function principale() {
  const a = argomenti(process.argv.slice(2));
  const zone = caricaZone(a.zone, a.zoneEsplicite);
  if (!zone) console.error(`(zone dello scenario non trovate in ${a.zone}: controllo solo la forma del nome)`);
  const testo = readFileSync(a.file ?? 0, 'utf8');
  const conta = { ok: 0, errore: 0, saltato: 0 };
  for (const riga of testo.split('\n')) {
    if (!riga.trim()) continue;
    const spazio = riga.indexOf(' ');
    const topic = spazio < 0 ? riga : riga.slice(0, spazio);
    const payload = spazio < 0 ? '' : riga.slice(spazio + 1);
    const r = controlla(topic, payload, zone);
    conta[r.esito]++;
    if (r.esito === 'errore') console.log(`ERRORE  ${topic}  ${r.motivo}\n        ${payload}`);
    else if (r.esito === 'ok') console.log(`OK      ${topic}`);
  }
  console.log(`messaggi nel formato: ${conta.ok} ok, ${conta.errore} errati, ${conta.saltato} saltati (non sono letture né stato)`);
  process.exit(conta.errore ? 1 : 0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) principale();
