// Fonti dati reali di Napoli: funzioni pure che trasformano le risposte delle API (o degli
// snapshot in ../dati/) nei formati usati da mappa, agenti e script degli snapshot.
// Modulo isomorfo (Node e browser), senza rete e senza dipendenze: è quello che provano i test.
//
// Convenzioni:
// - orari in millisecondi Unix; "giorno" = 'AAAA-MM-GG' nel fuso Europe/Rome;
// - ogni risultato dice da dove viene (`fonte`) e quando è stato misurato o previsto (`ts`);
// - le funzioni non lanciano su dati mancanti: restituiscono null o liste vuote.

export const FUSO = 'Europe/Rome';

// ------------------------------------------------------------------ tempo

const fmtParti = new Intl.DateTimeFormat('en-US', {
  timeZone: FUSO,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** Parti della data nel fuso di Napoli. */
export function partiLocali(ts) {
  const p = Object.fromEntries(fmtParti.formatToParts(ts).map((x) => [x.type, x.value]));
  return { anno: +p.year, mese: +p.month, giorno: +p.day, ora: +p.hour % 24, minuto: +p.minute, secondo: +p.second };
}

/** Scarto in ms tra l'ora di Napoli e UTC all'istante `ts` (3 600 000 d'inverno, 7 200 000 d'estate). */
export function scartoRoma(ts) {
  const p = partiLocali(ts);
  return Date.UTC(p.anno, p.mese - 1, p.giorno, p.ora, p.minuto, p.secondo) - Math.floor(ts / 1000) * 1000;
}

/** Istante (ms) di una data e ora locali di Napoli. */
export function daOraLocale(anno, mese, giorno, ora = 0, minuto = 0) {
  const finta = Date.UTC(anno, mese - 1, giorno, ora, minuto);
  let t = finta - scartoRoma(finta);
  const s2 = scartoRoma(t);
  if (finta - s2 !== t) t = finta - s2;
  return t;
}

/** 'AAAA-MM-GG' nel fuso di Napoli. */
export function giornoLocale(ts) {
  const p = partiLocali(ts);
  return `${p.anno}-${String(p.mese).padStart(2, '0')}-${String(p.giorno).padStart(2, '0')}`;
}

/** Istante della mezzanotte locale di un giorno 'AAAA-MM-GG'. */
export function inizioGiorno(giorno) {
  const [a, m, g] = giorno.split('-').map(Number);
  return daOraLocale(a, m, g);
}

/** 'AAAA-MM-GGTHH:MM' (ora locale, come Open-Meteo con timezone=Europe/Rome) → ms. */
export function daIsoLocale(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(String(s || ''));
  return m ? daOraLocale(+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0)) : null;
}

/** '15:00 - 13/11/2026' (formato del Centro Funzionale Campania) → ms. */
export function daDataCf(s) {
  const m = /(\d{1,2}):(\d{2})\s*-\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(s || ''));
  return m ? daOraLocale(+m[5], +m[4], +m[3], +m[1], +m[2]) : null;
}

/** 'HH:MM' locale di un istante. */
export function oraBreve(ts) {
  if (!Number.isFinite(ts)) return '–';
  const p = partiLocali(ts);
  return `${String(p.ora).padStart(2, '0')}:${String(p.minuto).padStart(2, '0')}`;
}

const MESI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
/** '14 nov' o '14 nov 2027' (se l'anno è diverso da quello di `rispetto`). */
export function dataBreve(ts, rispetto = Date.now()) {
  if (!Number.isFinite(ts)) return '–';
  const p = partiLocali(ts);
  const anno = partiLocali(rispetto).anno !== p.anno ? ` ${p.anno}` : '';
  return `${p.giorno} ${MESI[p.mese - 1]}${anno}`;
}

/** Distanza approssimata in km (equirettangolare). */
export function km(a, b) {
  const rad = Math.PI / 180;
  const x = (b.lon - a.lon) * rad * Math.cos(((a.lat + b.lat) / 2) * rad);
  const y = (b.lat - a.lat) * rad;
  return Math.sqrt(x * x + y * y) * 6371;
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);

// ------------------------------------------------------------------ meteo

/** Codici meteo WMO (Open-Meteo) in italiano. */
export function descriviMeteo(codice) {
  const c = Number(codice);
  if (c === 0) return 'Sereno';
  if (c === 1) return 'Quasi sereno';
  if (c === 2) return 'Parzialmente nuvoloso';
  if (c === 3) return 'Coperto';
  if (c === 45 || c === 48) return 'Nebbia';
  if (c >= 51 && c <= 55) return 'Pioviggine';
  if (c === 56 || c === 57) return 'Pioviggine gelata';
  if (c === 61) return 'Pioggia debole';
  if (c === 63) return 'Pioggia';
  if (c === 65) return 'Pioggia forte';
  if (c === 66 || c === 67) return 'Pioggia gelata';
  if (c >= 71 && c <= 77) return 'Neve';
  if (c === 80) return 'Rovesci deboli';
  if (c === 81) return 'Rovesci';
  if (c === 82) return 'Rovesci violenti';
  if (c === 85 || c === 86) return 'Rovesci di neve';
  if (c === 95) return 'Temporale';
  if (c === 96 || c === 99) return 'Temporale con grandine';
  return 'n/d';
}

/**
 * Risposta di Open-Meteo forecast (una o più coordinate, nello stesso ordine di `zone`) →
 * { zona: { temperatura, percepita, umidita, pioggia, codice, cielo, vento, raffiche, giorno, ts, cella } }.
 */
export function meteoDaOpenMeteo(json, zone) {
  const lista = Array.isArray(json) ? json : json ? [json] : [];
  const out = {};
  zone.forEach((z, i) => {
    const r = lista[i];
    const c = r?.current;
    if (!c || num(c.temperature_2m) == null) return;
    out[z] = {
      temperatura: num(c.temperature_2m),
      percepita: num(c.apparent_temperature),
      umidita: num(c.relative_humidity_2m),
      pioggia: num(c.precipitation),
      codice: num(c.weather_code),
      cielo: descriviMeteo(c.weather_code),
      vento: num(c.wind_speed_10m),
      raffiche: num(c.wind_gusts_10m),
      giorno: c.is_day == null ? null : c.is_day === 1,
      ts: daIsoLocale(c.time),
      cella: r.latitude != null ? [r.latitude, r.longitude] : null,
    };
  });
  return out;
}

const SIMBOLI_MET = [
  [/thunder/, 95, 'Temporale'],
  [/heavyrain/, 65, 'Pioggia forte'],
  [/lightrain/, 61, 'Pioggia debole'],
  [/rain/, 63, 'Pioggia'],
  [/sleet|snow/, 71, 'Neve'],
  [/fog/, 45, 'Nebbia'],
  [/cloudy/, 3, 'Coperto'],
  [/partlycloudy/, 2, 'Parzialmente nuvoloso'],
  [/fair/, 1, 'Quasi sereno'],
  [/clearsky/, 0, 'Sereno'],
];

/** MET Norway Locationforecast 2.0 (compact) → lo stesso formato di un luogo di meteoDaOpenMeteo. */
export function meteoDaMetNo(json) {
  const s = json?.properties?.timeseries?.[0];
  const d = s?.data?.instant?.details;
  if (!d || num(d.air_temperature) == null) return null;
  const simbolo = s.data.next_1_hours?.summary?.symbol_code || '';
  const sim = SIMBOLI_MET.find(([re]) => re.test(simbolo.replace(/_(day|night|polartwilight)$/, '')));
  const vento = num(d.wind_speed) != null ? r1(d.wind_speed * 3.6) : null; // m/s → km/h
  return {
    temperatura: num(d.air_temperature),
    percepita: null,
    umidita: num(d.relative_humidity),
    pioggia: num(s.data.next_1_hours?.details?.precipitation_amount),
    codice: sim ? sim[1] : null,
    cielo: sim ? sim[2] : 'n/d',
    vento,
    raffiche: null,
    giorno: null,
    ts: Date.parse(s.time) || null,
    cella: json?.geometry?.coordinates ? [json.geometry.coordinates[1], json.geometry.coordinates[0]] : null,
  };
}

/** Livello della modalità "Meteo" (4 livelli) da meteo reale ed eventuale allerta regionale. */
export function livelloMeteo(m, allerta = null) {
  if (!m) return null;
  const c = m.codice ?? -1;
  const raff = m.raffiche ?? 0;
  const vento = m.vento ?? 0;
  const pioggia = m.pioggia ?? 0;
  const liv = allerta?.livello ?? 1;
  let id = 'tranquillo';
  if ([65, 82, 95, 96, 99].includes(c) || (c >= 71 && c <= 77) || c === 85 || c === 86 || raff >= 70 || vento >= 50 || pioggia >= 4 || liv >= 3) id = 'affollato';
  else if ([55, 61, 63, 66, 67, 80, 81, 56, 57].includes(c) || raff >= 50 || vento >= 35 || pioggia >= 0.3 || liv >= 2) id = 'vivace';
  else if ([3, 45, 48, 51, 53].includes(c) || raff >= 35 || vento >= 25) id = 'normale';
  const peso = { tranquillo: 0, normale: 1, vivace: 2, affollato: 3 }[id];
  return { livello: id, valore: peso + Math.min(0.99, raff / 200 + pioggia / 20) };
}

// ------------------------------------------------------------------ qualità dell'aria

/**
 * Fasce dell'indice europeo della qualità dell'aria (EEA, versione usata anche da Open-Meteo):
 * limiti superiori di buona, discreta, moderata, scadente, molto scadente (µg/m³).
 * NO2 e O3 su 1 ora, PM10 e PM2.5 sulla media delle ultime 24 ore.
 */
export const FASCE_EAQI = Object.freeze({
  NO2: [40, 90, 120, 230, 340],
  PM10: [20, 40, 50, 100, 150],
  'PM2.5': [10, 20, 25, 50, 75],
  O3: [50, 100, 130, 240, 380],
  SO2: [100, 200, 350, 500, 750],
});

/** I 4 livelli della modalità "Aria" (gli id coincidono con quelli dei colori della mappa). */
export const LIVELLI_ARIA = Object.freeze([
  { id: 'tranquillo', label: 'Buona' },
  { id: 'normale', label: 'Discreta' },
  { id: 'vivace', label: 'Moderata' },
  { id: 'affollato', label: 'Scadente' },
]);

/** Classe EAQI (0 buona … 5 pessima) di un inquinante. */
export function classeInquinante(inquinante, valore) {
  const f = FASCE_EAQI[inquinante];
  if (!f || num(valore) == null) return null;
  const i = f.findIndex((s) => valore < s);
  return i === -1 ? 5 : i;
}

/** Indice europeo (0-100+, come `european_aqi` di Open-Meteo) → classe 0-5. */
export function classeAqi(aqi) {
  if (num(aqi) == null) return null;
  return aqi < 20 ? 0 : aqi < 40 ? 1 : aqi < 60 ? 2 : aqi < 80 ? 3 : aqi < 100 ? 4 : 5;
}

/** Classe 0-5 → uno dei 4 livelli della mappa (scadente comprende anche molto scadente e pessima). */
export function livelloAria(classe) {
  if (classe == null) return null;
  return LIVELLI_ARIA[Math.min(3, classe)];
}

/** Open-Meteo Air Quality (una o più coordinate, nell'ordine di `zone`) → { zona: { aqi, pm10, pm25, no2, o3, ts } }. */
export function ariaDaOpenMeteo(json, zone) {
  const lista = Array.isArray(json) ? json : json ? [json] : [];
  const out = {};
  zone.forEach((z, i) => {
    const c = lista[i]?.current;
    if (!c || num(c.european_aqi) == null) return;
    out[z] = {
      aqi: num(c.european_aqi),
      pm10: num(c.pm10),
      pm25: num(c.pm2_5),
      no2: num(c.nitrogen_dioxide),
      o3: num(c.ozone),
      ts: daIsoLocale(c.time),
    };
  });
  return out;
}

/**
 * Classe EAQI di una centralina dagli ultimi valori misurati: il peggiore tra gli inquinanti
 * (NO2 e O3 sull'ultima ora; PM sulla media delle ultime 24 ore disponibili).
 * `misure`: { NO2: { serie: [[ts, valore], ...] }, PM10: ... } come in dati/aria.json.
 */
export function classeCentralina(misure) {
  let peggiore = null;
  let motivo = null;
  for (const [inq, m] of Object.entries(misure || {})) {
    const serie = (m?.serie || []).filter((p) => num(p[1]) != null);
    if (!serie.length) continue;
    const ultimo = serie[serie.length - 1];
    let v = ultimo[1];
    if (inq === 'PM10' || inq === 'PM2.5') {
      const giorno = serie.filter((p) => p[0] > ultimo[0] - 24 * 3_600_000);
      v = giorno.reduce((s, p) => s + p[1], 0) / giorno.length;
    }
    const c = classeInquinante(inq, v);
    if (c != null && (peggiore == null || c > peggiore)) {
      peggiore = c;
      motivo = { inquinante: inq, valore: r1(v), ts: ultimo[0] };
    }
  }
  return peggiore == null ? null : { classe: peggiore, ...motivo };
}

// ------------------------------------------------------------------ allerte

const COLORI_ALLERTA = { 1: 'verde', 2: 'gialla', 3: 'arancione', 4: 'rossa' };

/**
 * Avviso del Centro Funzionale per domani (findAllertaDomaniNew), letto da solo: serve anche quando
 * oggi non c'è nessun avviso in vigore (allora allertaDaCentroFunzionale restituisce null).
 * null se per domani non c'è nessun avviso (lista vuota o livello assente).
 */
export function allertaDomaniDaCentroFunzionale(domani) {
  const b = domani?.bollettinoMeteoBindList?.find((x) => x.zona === 1 || x.zona == null);
  const livello = Number(b?.livello);
  if (!b || !livello) return null;
  return {
    fonte: 'centro-funzionale',
    livello,
    colore: COLORI_ALLERTA[livello] || 'n/d',
    descrizione: b.livelloDesc || `Livello ${livello}`,
    tipi: String(b.tipoDesc || '').trim().split(/\s+/).filter(Boolean),
    dal: daDataCf(domani.dataDa),
    al: daDataCf(domani.dataA),
    numero: domani.numeroAvviso ?? null,
    emissione: daDataCf(domani.dataEmissione),
  };
}

const NOMI_TIPI_ALLERTA = { piogge: 'piogge', temporali: 'temporali', neve: 'neve', vento: 'vento forte', mare: 'mare agitato', calore: 'caldo intenso', freddo: 'freddo intenso' };
/** Tipi dell'avviso del Centro Funzionale in parole per i cittadini (['mare'] → 'mare agitato'). */
export function descriviTipiAllerta(tipi) {
  return (tipi || []).map((t) => NOMI_TIPI_ALLERTA[String(t).toLowerCase()] || t).join(', ');
}

/**
 * Allerta del Centro Funzionale della Campania per la Zona 1 (Napoli):
 * `ultima` = findLastAllertaNew, `zona` = findByIdZona/1/{id} (facoltativo), `domani` = findAllertaDomaniNew.
 */
export function allertaDaCentroFunzionale(ultima, zona = null, domani = null, ora = Date.now()) {
  const b = zona?.bollettinoMeteoBindList?.find((x) => x.zona === 1) || ultima?.bollettinoMeteoBindList?.[0];
  if (!ultima || !b) return null;
  const dal = daDataCf(ultima.dataDa);
  const al = daDataCf(ultima.dataA);
  const livello = Number(b.livello) || 1;
  const tipi = String(b.tipoDesc || ultima.bollettinoMeteoBindList?.[0]?.tipoDesc || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const dom = domani?.bollettinoMeteoBindList?.find((x) => x.zona === 1 || x.zona == null) ?? null;
  return {
    fonte: 'centro-funzionale',
    zona: zona ? 1 : null,
    livello,
    colore: COLORI_ALLERTA[livello] || 'n/d',
    descrizione: b.livelloDesc || `Livello ${livello}`,
    tipi,
    rischi: b.tipoRischi || null,
    fenomeni: b.fenomeni || null,
    dal,
    al,
    inCorso: dal != null && al != null ? ora >= dal && ora <= al : null,
    scaduta: al != null ? ora > al : null,
    numero: ultima.numeroAvviso ?? null,
    emissione: daDataCf(ultima.dataEmissione),
    domani: dom ? { livello: Number(dom.livello) || 1, descrizione: dom.livelloDesc || null } : null,
  };
}

/**
 * Meteoalarm (feed CAP dell'Italia) → avvisi della Campania non scaduti, in italiano, il
 * livello più alto per tipo di fenomeno e per giorno: [{ fenomeno, livello, colore, inizio, fine, titolo }].
 */
export function meteoalarmCampania(json, ora = Date.now()) {
  const out = new Map();
  for (const w of json?.warnings || []) {
    for (const inf of w?.alert?.info || []) {
      if (inf.language !== 'it-IT') continue;
      if (!(inf.area || []).some((a) => a.areaDesc === 'Campania')) continue;
      const fine = Date.parse(inf.expires);
      const inizio = Date.parse(inf.onset || inf.effective);
      if (!Number.isFinite(fine) || fine < ora) continue;
      const par = Object.fromEntries((inf.parameter || []).map((p) => [p.valueName, p.value]));
      const livello = parseInt(par.awareness_level, 10) || 1;
      const fenomeno = String(inf.event || '').replace(/^(Verde|Giallo|Arancione|Rosso)\s+/, '').replace(/\s+Allerta$/, '') || 'n/d';
      const chiave = `${fenomeno}|${giornoLocale(inizio)}`;
      const prima = out.get(chiave);
      if (!prima || livello > prima.livello) {
        out.set(chiave, { fenomeno, livello, colore: COLORI_ALLERTA[livello] || 'n/d', inizio, fine, titolo: inf.headline || inf.event });
      }
    }
  }
  return [...out.values()].filter((a) => a.livello >= 2).sort((a, b) => a.inizio - b.inizio || b.livello - a.livello);
}

/** INGV FDSN (GeoJSON) → terremoti [{ ts, magnitudo, tipoMag, luogo, profonditaKm, lat, lon }], dal più recente. */
export function terremotiIngv(geojson) {
  return (geojson?.features || [])
    .map((f) => ({
      ts: Date.parse(f.properties?.time) || null,
      magnitudo: num(f.properties?.mag),
      tipoMag: f.properties?.magType || '',
      luogo: f.properties?.place || '',
      profonditaKm: num(f.geometry?.coordinates?.[2]),
      lat: num(f.geometry?.coordinates?.[1]),
      lon: num(f.geometry?.coordinates?.[0]),
    }))
    .filter((t) => t.ts)
    .sort((a, b) => b.ts - a.ts);
}

// ------------------------------------------------------------------ trasporti

/** Le `n` stazioni più vicine a un punto entro `maxKm` (con distanza in metri e minuti a piedi). */
export function stazioniVicine(punto, stazioni, { n = 3, maxKm = 1.2 } = {}) {
  return (stazioni || [])
    .map((s) => ({ ...s, m: Math.round(km(punto, s) * 1000) }))
    .filter((s) => s.m <= maxKm * 1000)
    .sort((a, b) => a.m - b.m)
    .slice(0, n)
    .map((s) => ({ ...s, piedi: Math.max(1, Math.round((s.m * 1.3) / 75)) })); // 4,5 km/h, percorso 1,3 × la distanza in linea d'aria
}

/** Corse programmate in un'ora per una stazione: `corse` = { feriale|sabato|festivo: [24 numeri] }. */
export function corseInOra(stazione, ts) {
  const p = partiLocali(ts);
  const dow = new Date(Date.UTC(p.anno, p.mese - 1, p.giorno)).getUTCDay();
  const tipo = dow === 0 || festivo(giornoLocale(ts)) ? 'festivo' : dow === 6 ? 'sabato' : 'feriale';
  const v = stazione?.corse?.[tipo]?.[p.ora];
  return v == null ? null : { corse: v, tipo };
}

const FESTIVI_FISSI = ['01-01', '01-06', '04-25', '05-01', '06-02', '08-15', '09-19', '11-01', '12-08', '12-25', '12-26'];
/** Festività nazionali fisse e San Gennaro (patrono di Napoli, 19 settembre); Pasquetta esclusa. */
export function festivo(giorno) {
  return FESTIVI_FISSI.includes(giorno.slice(5));
}

/** Transitous (MOTIS) /api/v1/stoptimes → prossimi passaggi [{ ts, linea, verso, tempoReale, ritardoMin, modo, operatore }]. */
export function passaggiDaTransitous(json, ora = Date.now()) {
  return (json?.stopTimes || [])
    .map((s) => {
      const p = s.place || {};
      const ts = Date.parse(p.departure || p.arrival || '');
      const prog = Date.parse(p.scheduledDeparture || p.scheduledArrival || '');
      return {
        ts,
        linea: s.routeShortName || s.displayName || '',
        verso: s.headsign || '',
        tempoReale: s.realTime === true,
        ritardoMin: s.realTime && Number.isFinite(prog) && Number.isFinite(ts) ? Math.round((ts - prog) / 60_000) : null,
        modo: s.mode || '',
        operatore: s.agencyName || '',
        soppresso: s.cancelled === true || s.tripCancelled === true,
      };
    })
    .filter((x) => Number.isFinite(x.ts) && x.ts >= ora - 60_000)
    .sort((a, b) => a.ts - b.ts);
}

/** Decodifica le entità HTML più comuni dei titoli WordPress (&#8211; &amp; …). */
export function decodificaEntita(s) {
  return String(s ?? '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#039;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/<[^>]+>/g, '')
    .trim();
}

const CATEGORIE_EAV = { 41: 'ferrovia', 21: 'autolinee', 17: 'sciopero', 65: 'impianti', 64: 'accessibilità', 173: 'servizio sostitutivo' };

/**
 * Avvisi EAV (WordPress REST) → [{ ts, titolo, link, tipo, stazioni }], dove `stazioni` sono i nomi
 * delle stazioni note citati nel titolo (confronto senza maiuscole).
 */
export function avvisiEav(posts, nomiStazioni = []) {
  const nomi = nomiStazioni.map((n) => [n, n.toLowerCase()]).filter(([, l]) => l.length >= 4);
  return (Array.isArray(posts) ? posts : [])
    .map((p) => {
      const titolo = decodificaEntita(p?.title?.rendered ?? p?.title);
      const t = titolo.toLowerCase();
      return {
        ts: Date.parse(p?.date_gmt ? `${p.date_gmt}Z` : p?.date) || null,
        titolo,
        link: p?.link || null,
        tipo: (p?.categories || []).map((c) => CATEGORIE_EAV[c]).find(Boolean) || 'avviso',
        stazioni: nomi.filter(([, l]) => new RegExp(`\\b${l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(t)).map(([n]) => n),
      };
    })
    .filter((a) => a.titolo);
}

/**
 * Eventi di traffico di Autostrade per l'Italia (viabilita.autostrade.it/json/eventi.json) nel
 * riquadro dell'area di Napoli → [{ strada, tipo, causa, da, a, lat, lon, codaKm, velocita, ts }].
 */
export function trafficoAspi(json, box = { s: 40.74, n: 40.98, o: 14.05, e: 14.5 }) {
  return (json?.events || json?.eventi || [])
    .map((e) => {
      const lat = num(e.n_crd_lat) ?? num(e.n_crd_lat_ini) ?? num(parseFloat(e.n_crd_lat));
      const lon = num(e.n_crd_lon) ?? num(e.n_crd_lon_ini) ?? num(parseFloat(e.n_crd_lon));
      const fino = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(String(e.fino_al || ''));
      const desc = String(e.t_des_str || '').trim();
      return {
        strada: desc ? (desc.toUpperCase().startsWith(String(e.c_str || '').toUpperCase()) ? desc : `${e.c_str} ${desc}`).replace(/^(\w+)\s+\1\b/, '$1') : e.c_str || '',
        tratto: e.t_des_ram || '',
        tipo: e.t_des_fra_it || '',
        causa: e.t_des_fra_cau_it || '',
        da: e.locpri || '',
        a: e.locsec || '',
        lat,
        lon,
        codaKm: num(e.lunghezzaCoda) ?? (num(parseFloat(e.lunghezzaCoda)) || null),
        velocita: num(e.n_vel_med) ?? null,
        ts: num(e.d_agg) ?? null,
        fino: fino ? daOraLocale(+fino[1], +fino[2], +fino[3], +fino[4], +fino[5]) : null,
      };
    })
    .filter((e) => e.lat != null && e.lon != null && e.lat >= box.s && e.lat <= box.n && e.lon >= box.o && e.lon <= box.e);
}

// ------------------------------------------------------------------ eventi

/** Normalizza un testo per il confronto (minuscole, senza accenti né punteggiatura). */
export function piatto(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’'`]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Zona della mappa citata in un testo (luogo o indirizzo di un evento), dalle `parole` dei luoghi; null se nessuna. */
export function zonaPerTesto(testo, luoghi) {
  const t = ` ${piatto(testo)} `;
  let migliore = null;
  for (const [zona, l] of Object.entries(luoghi || {})) {
    for (const p of [l.nome, ...(l.parole || [])]) {
      const q = piatto(p);
      if (q.length >= 4 && t.includes(` ${q} `) && (!migliore || q.length > migliore.lunghezza)) migliore = { zona, lunghezza: q.length };
    }
  }
  return migliore?.zona ?? null;
}

const GRANDI = /festival|concert|maratona|triathlon|\btri\b|corsa|corri|parata|fiera|mercatin|regata|cup|partita|notte bianca|capodanno|processione|sport/;

/** Un evento del Comune "sposta folla"? Evento sportivo o titolo da grande evento (le mostre no). Ipotesi dichiarata. */
export function eventoGrande(titolo, tipo) {
  const t = piatto(`${titolo} ${tipo}`);
  if (/mostra|presentazione|libro|convegno|infopoint|seminario/.test(t)) return false;
  return GRANDI.test(t);
}

/**
 * Evento dell'API del Comune di Napoli (wp-json/api/v1/news) → { titolo, inizio, fine, luogo, tipo, zona, grande }.
 * I timestamp dell'API sono l'ora locale codificata come UTC: si leggono le cifre UTC come ora di Napoli.
 */
export function eventoComune(e, luoghi) {
  const loc = typeof e?.luogo_evento === 'string' ? safeJson(e.luogo_evento) : e?.luogo_evento || {};
  const tipo = (typeof e?.tipo_evento === 'string' ? safeJson(e.tipo_evento) : e?.tipo_evento)?.title || '';
  const t = (x) => {
    const n = Number(x);
    if (!Number.isFinite(n) || n <= 0) return null;
    const d = new Date(n * 1000);
    return daOraLocale(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes());
  };
  const luogo = [loc?.title, loc?.address].filter(Boolean).join(' · ');
  const titolo = decodificaEntita(e?.titolo);
  return {
    titolo,
    inizio: t(e?.data_orario_inizio),
    fine: t(e?.data_orario_fine),
    luogo,
    tipo,
    zona: zonaPerTesto(`${luogo} ${titolo}`, luoghi),
    grande: eventoGrande(titolo, tipo),
  };
}

function safeJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

/**
 * Partite in casa del Napoli dal calendario openfootball (football.json): [{ giorno, ora, casa, ospite,
 * competizione, giornata, fonte }]. La usano sia lo script degli snapshot sia la pagina (dato dal vivo).
 */
export function partiteDaOpenfootball(json) {
  return (json?.matches || [])
    .filter((m) => /napoli/i.test(m.team1 || ''))
    .map((m) => ({
      giorno: m.date,
      ora: m.time || null,
      casa: 'Napoli',
      // "AS Roma" → "Roma", "Bologna FC 1909" → "Bologna", "Parma Calcio 1913" → "Parma"
      ospite: String(m.team2 || '')
        .replace(/^(AS|SS|US|ACF|AC|SSC|FC|UC|SPAL)\s+/, '')
        .replace(/(\s+(FC|CFC|BC|Calcio|AC|SSC|\d{4}))+$/i, ''),
      competizione: 'Serie A',
      giornata: m.round || null,
      fonte: 'openfootball',
    }))
    .sort((a, b) => a.giorno.localeCompare(b.giorno));
}

/** Scenario del simulatore che rappresenta un evento reale in una zona (effetti in sim-config.json). */
export const scenarioEvento = (zona) => `evento_${zona}`;

/**
 * Eventi reali di un giorno dallo snapshot dati/eventi.json (più eventuali partite aggiornate dal vivo):
 * [{ titolo, tipo, zona, inizio, fine, fonte, scenario, nota }], ordinati per inizio.
 * `scenario` è valorizzato solo per gli eventi che, per ipotesi dichiarata, spostano folla.
 */
export function eventiDelGiorno(dati, giorno, { partite = null } = {}) {
  if (!dati) return [];
  const g0 = inizioGiorno(giorno);
  const g1 = g0 + 24 * 3_600_000;
  const out = [];
  for (const p of partite || dati.partite || []) {
    if (p.giorno !== giorno) continue;
    const inizio = p.ora ? daIsoLocale(`${p.giorno}T${p.ora}`) : null;
    out.push({
      titolo: `${p.casa} - ${p.ospite}`,
      tipo: p.competizione || 'Serie A',
      zona: 'maradona',
      inizio,
      fine: inizio ? inizio + 2 * 3_600_000 : null,
      finestra: inizio ? [inizio - 3 * 3_600_000, inizio + 3 * 3_600_000] : [g0 + 12 * 3_600_000, g1],
      fonte: p.fonte || 'openfootball',
      scenario: scenarioEvento('maradona'),
      nota: p.ora ? `calcio d'inizio ${p.ora}` : 'orario non ancora fissato',
    });
  }
  const navi = (dati.crociere || []).find((c) => c.giorno === giorno);
  if (navi?.navi?.length) {
    out.push({
      titolo: `${navi.navi.length === 1 ? 'Nave' : `${navi.navi.length} navi`} da crociera in porto`,
      tipo: 'Crociere',
      zona: 'beverello',
      inizio: g0 + 8 * 3_600_000,
      fine: g0 + 18 * 3_600_000,
      finestra: [g0 + 8 * 3_600_000, g0 + 18 * 3_600_000],
      fonte: 'cruisetimetables',
      scenario: scenarioEvento('beverello'),
      nota: navi.navi.join(', '),
    });
  }
  for (const e of dati.comune || []) {
    if (e.inizio == null || e.inizio >= g1 || (e.fine ?? e.inizio) < g0) continue;
    const inizio = Math.max(e.inizio, g0);
    const fine = Math.min(e.fine ?? e.inizio + 2 * 3_600_000, g1);
    out.push({
      titolo: e.titolo,
      tipo: e.tipo || 'Evento',
      zona: e.zona,
      inizio: e.inizio,
      fine: e.fine,
      // iniziato prima di oggi o lungo più di un giorno (mostre, rassegne): "in corso fino al …"
      lungo: e.inizio < g0 || (e.fine ?? e.inizio) - e.inizio > 24 * 3_600_000,
      finestra: [inizio - 3_600_000, fine + 3_600_000],
      fonte: 'comune-napoli',
      scenario: e.grande && e.zona ? scenarioEvento(e.zona) : null,
      nota: e.luogo,
    });
  }
  for (const r of dati.speciali || []) {
    if (r.giorno !== giorno) continue;
    out.push({
      titolo: r.titolo,
      tipo: r.evento || 'Grande evento',
      zona: r.zona || 'lungomare',
      inizio: g0 + 11 * 3_600_000,
      fine: g0 + 17 * 3_600_000,
      finestra: [g0 + 10 * 3_600_000, g0 + 19 * 3_600_000],
      fonte: r.fonte || 'americascup',
      scenario: r.riserva ? null : scenarioEvento(r.zona || 'lungomare'),
      nota: r.nota || '',
    });
  }
  // prima gli eventi che spostano folla, poi quelli di oggi per orario, in fondo quelli lunghi in corso
  return out.sort((a, b) => Number(!a.scenario) - Number(!b.scenario) || Number(Boolean(a.lungo)) - Number(Boolean(b.lungo)) || (a.inizio ?? 0) - (b.inizio ?? 0));
}

/** Prossimi eventi (dopo `giorno`, entro `giorni`) per il pannello: partite, navi, grandi eventi. */
export function prossimiEventi(dati, giorno, { giorni = 30, max = 6, partite = null } = {}) {
  if (!dati) return [];
  const g0 = inizioGiorno(giorno) + 24 * 3_600_000;
  const lim = g0 + giorni * 24 * 3_600_000;
  const dentro = (g) => {
    const t = inizioGiorno(g);
    return t >= g0 && t < lim;
  };
  const out = [];
  for (const p of partite || dati.partite || []) if (dentro(p.giorno)) out.push({ giorno: p.giorno, titolo: `${p.casa} - ${p.ospite}`, tipo: p.competizione || 'Serie A', zona: 'maradona', nota: p.ora || '' });
  for (const c of dati.crociere || []) if (dentro(c.giorno)) out.push({ giorno: c.giorno, titolo: `${c.navi.length === 1 ? 'Nave' : `${c.navi.length} navi`} da crociera`, tipo: 'Crociere', zona: 'beverello', nota: c.navi.join(', ') });
  for (const e of dati.comune || []) {
    if (e.inizio == null || !e.grande) continue; // solo gli eventi che spostano persone
    const g = giornoLocale(e.inizio);
    if (dentro(g)) out.push({ giorno: g, titolo: e.titolo, tipo: e.tipo, zona: e.zona, nota: e.luogo });
  }
  const primo = (dati.speciali || []).find((r) => inizioGiorno(r.giorno) >= g0);
  const ordinati = out.sort((a, b) => a.giorno.localeCompare(b.giorno));
  const prossimi = ordinati.slice(0, max);
  // la prossima partita al Maradona resta in elenco anche se i giorni di navi la spingerebbero fuori
  const partita = ordinati.find((x) => x.zona === 'maradona');
  if (partita && !prossimi.includes(partita)) prossimi.splice(Math.max(0, max - 1), prossimi.length, partita);
  if (primo && !prossimi.some((x) => x.giorno === primo.giorno)) prossimi.push({ giorno: primo.giorno, titolo: primo.titolo, tipo: primo.evento, zona: primo.zona || 'lungomare', nota: 'primo giorno di regate a Napoli' });
  return prossimi;
}

// ------------------------------------------------------------------ stagionalità

/** Indice stagionale del mese (arrivi del mese / media mensile dell'anno, ISTAT) e livello dichiarato. */
export function stagione(riferimenti, mese) {
  const m = riferimenti?.stagionalita?.mesi?.[String(mese)];
  if (!m || !riferimenti.stagionalita.mediaArrivi) return null;
  const indice = m.arrivi / riferimenti.stagionalita.mediaArrivi;
  return {
    mese,
    indice: Math.round(indice * 100) / 100,
    arrivi: m.arrivi,
    stranieriPct: m.stranieri != null && m.arrivi ? Math.round((m.stranieri / m.arrivi) * 100) : null,
    anno: riferimenti.stagionalita.anno,
    scenario: indice < 0.8 ? 'stagione_bassa' : indice > 1.2 ? 'stagione_alta' : null,
  };
}
