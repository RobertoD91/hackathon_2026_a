// Dati REALI nella mappa "Napoli in tempo reale": modalità Meteo e Aria, livelli sovrapposti
// (metro, funicolari e treni; eventi di oggi; centraline ARPAC; traffico su tangenziale e
// autostrade), sezioni della scheda di dettaglio, pannello "Oggi a Napoli" e tabella delle fonti.
//
// I dati arrivano da fonti/dati.js (live con cache e riserva, oppure snapshot in dati/) e
// entrano nella mappa con mappa.setExtra(nome, { dati, fonte }): ogni valore mostrato dice da
// dove viene e di quando è. La pagina funziona anche se una fonte è giù (lo dichiara).
//
//   import { indicatoriReali, SOVRAPPOSTI_REALI, sezioniReali, avviaFonti } from './napoli-fonti.js';
//   avviaFonti(api)   // aggancio `avvio` della dashboard (app.js), dopo la creazione della mappa

import * as D from './fonti/dati.js';
import * as N from './fonti/normalizza.js';
import { LUOGHI } from './luoghi.js';

let mappaRef = null; // la mappa avviata (per selezionare un luogo dagli eventi)
const ORA = () => Date.now(); // i dati reali sono "adesso" (l'orologio simulato vale per i sensori)
const H = 3_600_000;

// ------------------------------------------------------------------ utilità di testo

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (v, dec = 1) => (typeof v === 'number' && Number.isFinite(v) ? new Intl.NumberFormat('it-IT', { maximumFractionDigits: dec, minimumFractionDigits: 0 }).format(v) : '–');
const quando = (ts) => {
  if (!Number.isFinite(ts)) return '';
  const oggi = N.giornoLocale(ORA()) === N.giornoLocale(ts);
  return oggi ? `alle ${N.oraBreve(ts)}` : `alle ${N.oraBreve(ts)} del ${N.dataBreve(ts)}`;
};
const ETICHETTE_TIPO = { live: 'dal vivo', cache: 'dal vivo', riserva: 'fonte di riserva', salvato: 'ultimo dato salvato', snapshot: 'snapshot', programmato: 'orario programmato', assente: 'non disponibile', simulato: 'simulato' };
/** Cartellino "reale / simulato" con la provenienza del dato. */
export function tagFonte(f) {
  const tipo = f?.tipo || 'assente';
  return `<span class="nf-tag nf-${esc(tipo)}" title="${esc([f?.nome, f?.nota].filter(Boolean).join(' · '))}">${esc(ETICHETTE_TIPO[tipo] || tipo)}</span>`;
}
const riga = (f, testo) => `<small class="nf-fonte">${esc(testo || f?.nome || '')}${f?.ts ? ` · ${esc(quando(f.ts))}` : ''}${f?.licenza ? ` · ${esc(f.licenza)}` : ''}</small>`;

function chipLinea(sigla, c) {
  const l = c.extra.trasporti?.dati?.linee?.find((x) => x.sigla === sigla);
  const col = l?.colore || '#777';
  return `<span class="nf-linea" style="--nf-col:${esc(col)}">${esc(sigla)}</span>`;
}

// ------------------------------------------------------------------ modalità (indicatori)

const allertaAttiva = (c) => {
  const a = c.extra.allerta?.dati?.regionale;
  return a && !a.scaduta ? a : null;
};

/** Centralina ARPAC vicina a una zona (entro 1,5 km) con la sua classe EAQI, se il dato ha meno di 48 ore. */
function centralinaVicina(zona, c) {
  const a = c.extra.centraline?.dati;
  const v = a?.vicine?.[zona];
  if (!v || v.km > 1.5) return null;
  const s = a.stazioni.find((x) => x.id === v.id);
  const cl = s ? N.classeCentralina(s.misure) : null;
  if (!cl) return null;
  return { stazione: s, km: v.km, ...cl, recente: ORA() - cl.ts < 48 * H };
}

/** Classe dell'aria di un luogo: centralina vicina (misura recente) o modello CAMS. */
export function ariaDelLuogo(zona, c) {
  const st = centralinaVicina(zona, c);
  if (st?.recente) return { classe: st.classe, origine: 'centralina', st };
  const m = c.extra.ariaModello?.dati?.[zona];
  if (m?.aqi != null) return { classe: N.classeAqi(m.aqi), origine: 'modello', aqi: m.aqi, st };
  if (st) return { classe: st.classe, origine: 'centralina', st };
  return null;
}

/** Le due modalità con dati reali (colori uguali alle altre, testi propri). */
export function indicatoriReali(colori) {
  const conColori = (livelli) => livelli.map((l) => ({ ...l, ...colori[l.id] }));
  return [
    {
      id: 'meteo',
      label: 'Meteo',
      livelli: conColori([
        { id: 'tranquillo', label: 'Bel tempo' },
        { id: 'normale', label: 'Variabile' },
        // l'allerta regionale vale per tutta la Zona 1 (anche solo per mare agitato): lo dice la legenda
        { id: 'vivace', label: 'Pioggia, vento o allerta gialla' },
        { id: 'affollato', label: 'Maltempo o allerta arancione' },
      ]),
      valuta: (a, l, z, c) => N.livelloMeteo(c.extra.meteo?.dati?.[z], allertaAttiva(c)),
    },
    {
      id: 'aria',
      label: 'Aria',
      livelli: conColori(N.LIVELLI_ARIA.map((x) => ({ ...x }))),
      valuta: (a, l, z, c) => {
        const x = ariaDelLuogo(z, c);
        if (!x || x.classe == null) return null;
        return { livello: N.livelloAria(x.classe).id, valore: x.classe + (x.aqi ?? 0) / 1000 };
      },
    },
  ];
}

// ------------------------------------------------------------------ livelli sovrapposti

/** Opzioni dei popup: su desktop la legenda copre il lato sinistro della mappa, il popup si sposta oltre. */
function opzioniPopup(maxWidth) {
  const side = typeof document !== 'undefined' ? document.querySelector('#citymap .cm-side') : null;
  const sopra = side && getComputedStyle(side).position === 'absolute';
  return { maxWidth, autoPanPaddingTopLeft: [sopra ? side.offsetWidth + 24 : 10, 10] };
}

function apriStazione(s, marker, c) {
  const html = () => {
    const p = c.extra.passaggi?.[s.id];
    const ora = N.corseInOra(s, ORA());
    return `<div class="nf-pop"><b>${esc(s.nome)}</b> ${s.linee.map((x) => chipLinea(x, c)).join(' ')}
      <div class="nf-pop-sub">${esc(s.operatore)} · ${ora ? `${ora.corse} corse programmate in quest'ora (${ora.tipo})` : 'orario non disponibile'}</div>
      ${passaggiHtml(p)}</div>`;
  };
  marker.bindPopup(html, opzioniPopup(280)).openPopup();
  caricaPassaggi(s, c).then(() => marker.isPopupOpen?.() && marker.setPopupContent(html()));
}

async function caricaPassaggi(s, c) {
  const prima = c.extra.passaggi?.[s.id];
  if (prima?.stato === 'carico' || (prima?.stato === 'ok' && ORA() - prima.letto < 60_000)) return;
  const tutti = { ...(c.extra.passaggi || {}) };
  tutti[s.id] = { stato: 'carico' };
  mappaRef?.setExtra('passaggi', tutti);
  const r = await D.passaggi(s);
  mappaRef?.setExtra('passaggi', { ...(c.extra.passaggi || {}), [s.id]: { stato: r.dati.length ? 'ok' : 'errore', dati: r.dati, fonte: r.fonte, letto: ORA() } });
}

function passaggiHtml(p) {
  if (!p) return '';
  if (p.stato === 'carico') return '<div class="nf-pass muted">Prossimi passaggi: chiedo a Transitous…</div>';
  if (!p.dati?.length) return `<div class="nf-pass muted">Prossimi passaggi non disponibili${p.fonte?.nota ? ` (${esc(p.fonte.nota)})` : ''}: vale l'orario programmato.</div>`;
  return `<ol class="nf-pass">${p.dati
    .slice(0, 6)
    .map(
      (x) =>
        `<li><b>${esc(N.oraBreve(x.ts))}</b> <span class="nf-pass-l">${esc(x.linea)}</span> ${esc(x.verso)}${x.soppresso ? ' <em class="nf-ko">soppresso</em>' : ''}${
          x.tempoReale ? ` <span class="nf-tag nf-live" title="tempo reale">${x.ritardoMin ? `${x.ritardoMin > 0 ? '+' : ''}${x.ritardoMin} min` : 'in orario'}</span>` : ''
        }</li>`,
    )
    .join('')}</ol>${riga(p.fonte, `Transitous · ${p.fonte?.nota || ''}`)}`;
}

function coloreStazione(s, t) {
  return t.linee.find((l) => l.sigla === s.linee[0])?.colore || '#555';
}

/** Media delle ultime 24 ore di una serie di misure [[ts, valore], ...] (come in N.classeCentralina). */
function media24(m) {
  const serie = (m?.serie || []).filter((p) => typeof p[1] === 'number');
  if (!serie.length) return null;
  const ultimo = serie[serie.length - 1][0];
  const giorno = serie.filter((p) => p[0] > ultimo - 24 * H);
  return giorno.reduce((t, p) => t + p[1], 0) / giorno.length;
}

let statoTraffico = ''; // "3 eventi alle 08:44", "nessun evento alle 08:44", "non disponibile"

const ICONA_TRAFFICO = (L, e) => {
  const tipo = /chius/i.test(e.tipo) ? 'chiuso' : /coda|rallent/i.test(e.tipo) ? 'coda' : 'altro';
  return L.divIcon({ className: 'nf-icon', html: `<span class="nf-tr nf-tr-${tipo}" title="${esc(e.tipo)}">▲</span>`, iconSize: [0, 0] });
};

export const SOVRAPPOSTI_REALI = [
  {
    id: 'trasporti',
    label: 'Metro, funicolari e treni',
    attivo: true,
    crea: ({ L }) => Object.assign(L.layerGroup(), { _L: L, _v: null }),
    aggiorna: (g, c) => {
      const t = c.extra.trasporti?.dati;
      if (!t || g._v === t) return;
      g._v = t;
      g.clearLayers();
      const L = g._L;
      const ordine = { ferrovia: 0, funicolare: 1, metro: 2 };
      for (const l of [...t.linee].sort((a, b) => ordine[a.tipo] - ordine[b.tipo])) {
        for (const tratto of l.tratti) {
          L.polyline(tratto, { color: '#1d1d1b', weight: l.tipo === 'ferrovia' ? 5 : 6, opacity: 0.18, interactive: false }).addTo(g);
          L.polyline(tratto, { color: l.colore, weight: l.tipo === 'ferrovia' ? 3 : 4, opacity: l.tipo === 'ferrovia' ? 0.7 : 0.85, interactive: false, dashArray: l.tipo === 'funicolare' ? '5 5' : null }).addTo(g);
        }
      }
      for (const s of t.stazioni) {
        L.circleMarker([s.lat, s.lon], { radius: s.tipo === 'ferrovia' ? 3.5 : 4.5, weight: 2, color: coloreStazione(s, t), fillColor: '#fff', fillOpacity: 1, bubblingMouseEvents: false })
          .bindTooltip(`${s.nome} · ${s.linee.join(', ')}`, { direction: 'top', offset: [0, -4] })
          .on('click', (e) => apriStazione(s, e.target, c))
          .addTo(g);
      }
    },
  },
  {
    id: 'eventi',
    label: 'Eventi reali di oggi',
    attivo: true,
    crea: ({ L }) => Object.assign(L.layerGroup(), { _L: L, _f: null }),
    aggiorna: (g, c) => {
      const ev = c.extra.eventi?.dati;
      const oggi = N.eventiDelGiorno(ev, N.giornoLocale(ORA())).filter((e) => e.zona && LUOGHI[e.zona]);
      const firma = JSON.stringify(oggi.map((e) => [e.titolo, e.zona]));
      if (g._f === firma) return;
      g._f = firma;
      g.clearLayers();
      const L = g._L;
      const perZona = {};
      for (const e of oggi) (perZona[e.zona] ||= []).push(e);
      for (const [z, lista] of Object.entries(perZona)) {
        const l = LUOGHI[z];
        L.marker([l.lat + 0.0016, l.lon + 0.0022], {
          icon: L.divIcon({ className: 'nf-icon', html: `<span class="nf-ev" title="${esc(lista.map((e) => e.titolo).join(' · '))}">${lista.length > 1 ? lista.length : '★'}</span>`, iconSize: [0, 0] }),
          keyboard: true,
          title: lista.map((e) => e.titolo).join(' · '),
          zIndexOffset: 600,
        })
          .on('click', () => mappaRef?.seleziona(z, { vola: true }))
          .addTo(g);
      }
    },
  },
  {
    id: 'centraline',
    label: 'Centraline aria (ARPAC)',
    attivo: false,
    crea: ({ L }) => Object.assign(L.layerGroup(), { _L: L, _v: null }),
    aggiorna: (g, c) => {
      const a = c.extra.centraline?.dati;
      if (!a || g._v === a) return;
      g._v = a;
      g.clearLayers();
      const L = g._L;
      const colori = c.extra._coloriAria || {};
      for (const s of a.stazioni) {
        const cl = N.classeCentralina(s.misure);
        const lv = cl ? N.livelloAria(cl.classe) : null;
        const testo = cl ? `${cl.inquinante} ${fmt(cl.valore)}` : s.id;
        L.marker([s.lat, s.lon], {
          icon: L.divIcon({ className: 'nf-icon', html: `<span class="nf-aq" style="--nf-col:${esc(colori[lv?.id] || '#9a9993')}">${esc(testo)}</span>`, iconSize: [0, 0] }),
          title: s.nome,
        })
          .bindPopup(
            () => `<div class="nf-pop"><b>${esc(s.nome)}</b> <small>${esc(s.id)}${s.tipo ? ` · ${esc(s.tipo)}` : ''}</small>
              <table class="nf-tab">${Object.entries(s.misure)
                .map(([k, m]) => {
                  // per i PM l'indice europeo usa la media delle ultime 24 ore (è il valore scritto sul marker)
                  const m24 = /^PM/.test(k) ? media24(m) : null;
                  return `<tr><td>${esc(k)}</td><td><b>${fmt(m.ultimo.valore)}</b> µg/m³</td><td>${esc(quando(m.ultimo.ts))}</td>${m24 != null ? `<td>media 24 h <b>${fmt(m24)}</b></td>` : '<td></td>'}</tr>`;
                })
                .join('')}</table>
              <small class="nf-fonte">ARPA Campania via EEA · dati orari non validati${lv ? ` · indice europeo: ${esc(lv.label.toLowerCase())}` : ''}</small></div>`,
            opzioniPopup(280),
          )
          .addTo(g);
      }
    },
  },
  {
    id: 'traffico',
    // l'etichetta della casella dice lo stato ("nessun evento in corso" non deve sembrare un errore)
    get label() {
      return `Traffico su tangenziale e autostrade${statoTraffico ? ` (${statoTraffico})` : ''}`;
    },
    attivo: false,
    crea: ({ L }) => Object.assign(L.layerGroup(), { _L: L, _v: null }),
    aggiorna: (g, c) => {
      const x = c.extra.traffico;
      if (!x) {
        if (!g._carico) {
          g._carico = true;
          statoTraffico = 'carico…';
          setTimeout(() => mappaRef?.setExtra('_trafficoStato', statoTraffico));
          D.traffico().then((r) => {
            mappaRef?.setExtra('traffico', r);
            renderPannello(c); // la tabella delle fonti mostra lo stato del traffico
          });
        }
        return;
      }
      if (g._v === x) return;
      g._v = x;
      g.clearLayers();
      const n = x.dati?.length ?? 0;
      statoTraffico = !x.dati ? 'non disponibile' : `${n ? `${n} ${n === 1 ? 'evento' : 'eventi'}` : 'nessun evento'} alle ${N.oraBreve(x.fonte?.letto ?? ORA())}`;
      setTimeout(() => mappaRef?.setExtra('_trafficoStato', statoTraffico)); // ridisegna la legenda (fuori da questo render)
      const L = g._L;
      for (const e of x.dati || []) {
        L.marker([e.lat, e.lon], { icon: ICONA_TRAFFICO(L, e), title: `${e.strada}: ${e.tipo}` })
          .bindPopup(
            `<div class="nf-pop"><b>${esc(e.strada)}</b><div>${esc(e.tipo)}${e.causa ? ` · ${esc(e.causa)}` : ''}</div>
              <div class="nf-pop-sub">${esc([e.da, e.a].filter(Boolean).join(' → '))}${e.codaKm ? ` · coda ${fmt(e.codaKm)} km` : ''}${e.fino ? ` · fino ${esc(quando(e.fino))}` : ''}</div>
              ${riga(x.fonte, "Autostrade per l'Italia")}</div>`,
            opzioniPopup(260),
          )
          .addTo(g);
      }
    },
  },
];

// ------------------------------------------------------------------ scheda di dettaglio

function sezMeteo(z, c) {
  const x = c.extra.meteo;
  const m = x?.dati?.[z];
  if (!x) return '';
  if (!m) return `<section class="nf-sez"><h4>Meteo ${tagFonte(x.fonte)}</h4><p class="muted">${esc(x.fonte?.nota || 'in arrivo…')}</p></section>`;
  const a = allertaAttiva(c);
  return `<section class="nf-sez"><h4>Meteo adesso ${tagFonte(x.fonte)}</h4>
    <div class="nf-meteo"><b>${fmt(m.temperatura)} °C</b>${m.percepita != null ? ` <span>percepiti ${fmt(m.percepita)} °C</span>` : ''} · ${esc(m.cielo)}</div>
    <dl class="cm-d-grid">
      <dt>Umidità</dt><dd>${m.umidita != null ? `${fmt(m.umidita, 0)} %` : '–'}</dd>
      <dt>Pioggia</dt><dd>${m.pioggia != null ? `${fmt(m.pioggia)} mm` : '–'}</dd>
      <dt>Vento</dt><dd>${m.vento != null ? `${fmt(m.vento, 0)} km/h` : '–'}${m.raffiche != null ? ` <small>raffiche ${fmt(m.raffiche, 0)}</small>` : ''}</dd>
    </dl>
    ${a && a.livello >= 2 ? `<div class="nf-allerta-mini nf-al-${a.livello}">Allerta ${esc(a.colore)} (Protezione Civile Campania) fino ${esc(quando(a.al))}</div>` : ''}
    ${riga(x.fonte)}</section>`;
}

function sezAria(z, c) {
  const x = ariaDelLuogo(z, c);
  const m = c.extra.ariaModello;
  if (!x && !m) return '';
  const lv = x ? N.livelloAria(x.classe) : null;
  const st = x?.st;
  return `<section class="nf-sez"><h4>Qualità dell'aria ${lv ? c.badge({ ...lv, ...coloreLv(c, lv.id) }) : ''}</h4>
    ${
      st
        ? `<p>Centralina ARPAC <b>${esc(st.stazione.nome)}</b> a ${fmt(st.km)} km${st.stazione.tipo ? ` (${esc(st.stazione.tipo)})` : ''}: ${Object.entries(st.stazione.misure)
            .map(([k, v]) => `${esc(k)} ${fmt(v.ultimo.valore)}${/^PM/.test(k) && media24(v) != null ? ` (media 24 h ${fmt(media24(v))})` : ''}`)
            .join(', ')} µg/m³ ${esc(quando(st.ts))} ${tagFonte(c.extra.centraline?.fonte)}${st.recente ? '' : ' <small>(dato vecchio: vale il modello)</small>'}</p>`
        : '<p class="muted">Nessuna centralina entro 1,5 km: vale il modello regionale.</p>'
    }
    ${m?.dati?.[z] ? `<p>Modello Copernicus CAMS: indice europeo <b>${fmt(m.dati[z].aqi, 0)}</b> ${tagFonte(m.fonte)}</p>` : ''}
    <small class="nf-fonte">Centraline: ARPA Campania via EEA (dati orari non validati) · Modello: Open-Meteo/CAMS, CC BY 4.0</small></section>`;
}

const coloreLv = (c, id) => (c.extra._colori?.[id] ? { colore: c.extra._colori[id].colore, inchiostro: c.extra._colori[id].inchiostro } : {});

function sezTrasporti(z, c) {
  const t = c.extra.trasporti?.dati;
  if (!t) return '';
  const perId = new Map(t.stazioni.map((s) => [s.id, s]));
  const vicine = (t.vicine?.[z] || []).map((v) => ({ ...v, s: perId.get(v.id) })).filter((v) => v.s);
  const avvisi = (c.extra.avvisi?.dati || []).filter((a) => a.stazioni.some((n) => vicine.some((v) => N.piatto(v.s.nome).includes(N.piatto(n)))));
  if (!vicine.length) return '<section class="nf-sez"><h4>Trasporti</h4><p class="muted">Nessuna stazione di metro, funicolare o treno entro 1,2 km.</p></section>';
  return `<section class="nf-sez"><h4>Metro e treni vicini ${tagFonte(c.extra.trasporti.fonte)}</h4>
    <ul class="nf-staz">${vicine
      .map((v) => {
        const ora = N.corseInOra(v.s, ORA());
        const p = c.extra.passaggi?.[v.s.id];
        return `<li><div><b>${esc(v.s.nome)}</b> ${v.s.linee.map((x) => chipLinea(x, c)).join(' ')}</div>
          <small>${v.piedi} min a piedi · ${ora ? `${ora.corse} corse/ora adesso (programmate)` : '–'}</small>
          ${v.s.transitous?.length ? `<button type="button" class="nf-btn" data-passaggi="${esc(v.s.id)}">${p?.dati?.length ? 'Aggiorna i passaggi' : 'Prossimi passaggi'}</button>` : ''}
          ${passaggiHtml(p)}</li>`;
      })
      .join('')}</ul>
    ${avvisi.length ? `<div class="nf-avvisi-mini">${avvisi.slice(0, 2).map((a) => `<a href="${esc(a.link)}" target="_blank" rel="noopener">⚠ ${esc(a.titolo)}</a>`).join('')}</div>` : ''}
    <small class="nf-fonte">Orari GTFS di ANM ed EAV (corse programmate) · passaggi da Transitous</small></section>`;
}

/** "dalle 09:00", "in corso fino al 15 dic" (eventi lunghi) o "orario da definire". */
function orarioEvento(e) {
  if (e.lungo && e.fine) return N.giornoLocale(e.fine) === N.giornoLocale(ORA()) ? `in corso, ultimo giorno (fino alle ${N.oraBreve(e.fine)})` : `in corso fino al ${N.dataBreve(e.fine, ORA())}`;
  return e.inizio ? `dalle ${N.oraBreve(e.inizio)}` : 'orario da definire';
}

function sezEventi(z, c) {
  const oggi = N.eventiDelGiorno(c.extra.eventi?.dati, N.giornoLocale(ORA())).filter((e) => e.zona === z);
  if (!oggi.length) return '';
  return `<section class="nf-sez nf-sez-ev"><h4>Oggi qui ${tagFonte(c.extra.eventi?.fonte)}</h4><ul>${oggi
    .map((e) => `<li><b>${esc(e.titolo)}</b><small>${esc(e.tipo)} · ${esc(orarioEvento(e))}${e.nota ? ` · ${esc(e.nota)}` : ''}${e.scenario ? ' · <em>alza la folla stimata</em>' : ''}</small></li>`)
    .join('')}</ul></section>`;
}

function sezRiferimenti(z, c) {
  const r = c.extra.riferimenti?.dati;
  const voci = r?.perZona?.[z] || [];
  if (!voci.length) return '';
  const mese = N.partiLocali(ORA()).mese - 1;
  const li = voci.slice(0, 5).map((v) => {
    let val = '';
    if (v.tipo === 'visitatori') {
      const m = v.mesi?.[mese];
      val = v.chiuso ? `<em>${esc(v.nota)}</em> (${v.anno})` : `${fmt(v.totale, 0)} visitatori nel ${v.anno}${m ? ` · ${new Intl.DateTimeFormat('it-IT', { month: 'long' }).format(new Date(2026, mese, 1))}: ${fmt(m, 0)}` : ''}`;
    } else if (v.tipo === 'mare') val = `classe ${esc(v.valore)} (${v.anno})${v.nota ? ` · ${esc(v.nota)}` : ''}`;
    else val = `${fmt(v.totale, 0)}${v.nota ? ` · ${esc(v.nota)}` : ''}${v.tipo !== 'airbnb' ? ` (${v.anno})` : ''}`;
    return `<li><span>${esc(v.etichetta)}</span><span>${val}</span><a href="${esc(v.url)}" target="_blank" rel="noopener" title="${esc(v.fonte)}">fonte</a></li>`;
  });
  return `<section class="nf-sez"><h4>Dati reali di riferimento ${tagFonte({ tipo: 'snapshot', nome: 'snapshot dei dati statici' })}</h4><ul class="nf-rif">${li.join('')}</ul>
    <small class="nf-fonte">Danno la scala della stima di folla (simulata): Comune di Napoli, ISTAT, Wikidata, AdSP, EEA, Inside Airbnb</small></section>`;
}

/** Sezioni con i dati reali da aggiungere alla scheda del luogo. */
export function sezioniReali(r, c) {
  return [sezEventi, sezMeteo, sezAria, sezTrasporti, sezRiferimenti].map((f) => f(r.zona, c)).join('');
}

/** Cartellino del marker nelle modalità reali (es. "Plebiscito 17,7°"). */
export function etichettaReale(r, c) {
  const nome = r.luogo.nome.split(' · ')[0];
  if (c.stato.modo === 'meteo') {
    const m = c.extra.meteo?.dati?.[r.zona];
    return m ? `${nome} ${fmt(m.temperatura)}°` : nome;
  }
  return nome;
}

/** Colonne in più per la vista lista. */
export const COLONNE_REALI = [
  { titolo: 'Meteo reale', classe: 'num', mobile: false, cella: (r, c) => { const m = c.extra.meteo?.dati?.[r.zona]; return m ? `${fmt(m.temperatura)} °C <small>${esc(m.cielo)}</small>` : '–'; } },
  { titolo: 'Aria', mobile: false, cella: (r, c) => { const x = ariaDelLuogo(r.zona, c); const lv = x ? N.livelloAria(x.classe) : null; return lv ? c.badge({ ...lv, ...coloreLv(c, lv.id) }) : '–'; } },
  {
    titolo: 'Stazione vicina',
    mobile: false,
    cella: (r, c) => {
      const t = c.extra.trasporti?.dati;
      const v = t?.vicine?.[r.zona]?.[0];
      const s = v && t.stazioni.find((x) => x.id === v.id);
      return s ? `${esc(s.nome)} <small>${esc(s.linee.join(', '))} · ${v.piedi} min</small>` : '–';
    },
  },
];

/** Nota in fondo alla mappa: cosa è reale, cosa è simulato, attribuzioni. */
export function notaFonti(c) {
  const f = (k) => c.extra[k]?.fonte;
  const st = (k, nome) => `${nome} ${tagFonte(f(k))}`;
  return (
    'Il cerchio che pulsa indica il luogo più critico di ogni categoria. ' +
    '<b>Affollamento e temperatura dei sensori: simulati</b> (in produzione: celle telefoniche aggregate e sensori ESP32 5G, come ' +
    '<a href="https://data.seoul.go.kr/SeoulRtd/" target="_blank" rel="noopener">Seoul Real-Time City Data</a>), con scala tarata su dati reali e aumentati dagli eventi reali di oggi. ' +
    `<b>Dati reali:</b> ${st('meteo', 'meteo')}, ${st('ariaModello', 'aria')}, ${st('allerta', 'allerta')}, ${st('trasporti', 'trasporti')}, ${st('eventi', 'eventi')}. ` +
    'Fonti: <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a> (CC BY 4.0), Copernicus CAMS, ARPAC via EEA, Protezione Civile Regione Campania, ' +
    'GTFS ANM (CC BY 4.0) ed EAV, <a href="https://transitous.org/sources/" target="_blank" rel="noopener">Transitous</a>, Comune di Napoli (CC BY 4.0), openfootball (CC0), ' +
    'ISTAT (CC BY 4.0), Wikidata (CC0), Inside Airbnb (CC BY 4.0). Dettagli in "Fonti dei dati" sotto la mappa.'
  );
}

// ------------------------------------------------------------------ pannello "Oggi a Napoli"

const $ = (id) => document.getElementById(id);

function renderAllerta(c) {
  const box = $('nf-allerta');
  if (!box) return;
  const x = c.extra.allerta;
  const a = x?.dati?.regionale;
  const ma = (x?.dati?.meteoalarm || []).filter((w) => w.fine > ORA() && w.inizio < ORA() + 48 * H);
  const attiva = a && !a.scaduta && a.livello >= 2 ? a : null;
  if (!attiva && !ma.length) {
    box.hidden = true;
    return;
  }
  const liv = Math.max(attiva?.livello ?? 1, ...ma.map((w) => w.livello));
  box.hidden = false;
  box.className = `nf-allerta nf-al-${liv}`;
  box.innerHTML = `<strong>${attiva ? `Allerta ${esc(attiva.colore)} per Napoli` : 'Avvisi meteo'}</strong>
    ${attiva ? `<span>${esc(N.descriviTipiAllerta(attiva.tipi) || attiva.descrizione)} · fino ${esc(quando(attiva.al))} · Protezione Civile Regione Campania (Zona 1) ${tagFonte(x.fonte)}</span>` : ''}
    ${ma.length ? `<span>Meteoalarm: ${ma.map((w) => `${esc(w.fenomeno.toLowerCase())} ${esc(w.colore)} ${esc(N.dataBreve(w.inizio))} ${esc(N.oraBreve(w.inizio))}-${esc(N.oraBreve(w.fine))}`).join(', ')} ${tagFonte({ tipo: 'snapshot', nome: 'Meteoalarm (EUMETNET), dallo snapshot' })}</span>` : ''}`;
}

function renderEventi(c) {
  const el = $('nf-eventi');
  if (!el) return;
  const giorno = N.giornoLocale(ORA());
  const x = c.extra.eventi;
  const oggi = N.eventiDelGiorno(x?.dati, giorno);
  $('nf-oggi-data').textContent = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Rome' }).format(ORA());
  el.innerHTML = !x
    ? '<li class="muted">Carico il calendario…</li>'
    : oggi.length
      ? oggi
          .map(
            (e) => `<li><button type="button" class="nf-card${e.scenario ? ' nf-card-folla' : ''}" ${e.zona ? `data-vai="${esc(e.zona)}"` : 'disabled'}>
              <span class="nf-ev-t">${esc(e.titolo)}</span>
              <small>${esc(e.tipo)} · ${esc(orarioEvento(e))} · ${esc(e.zona ? LUOGHI[e.zona].nome : e.nota || 'Napoli')}</small>
              ${e.scenario ? '<small class="nf-ev-f">alza la folla stimata nella zona</small>' : ''}</button></li>`,
          )
          .join('')
      : '<li class="muted">Nessun grande evento in calendario oggi.</li>';
  const pr = $('nf-prossimi');
  const prossimi = N.prossimiEventi(x?.dati, giorno, { max: 5 });
  pr.innerHTML = prossimi.length
    ? prossimi
        .map(
          (p) => `<li><button type="button" class="nf-card" ${p.zona ? `data-vai="${esc(p.zona)}"` : 'disabled'}><span class="nf-ev-d">${esc(N.dataBreve(N.inizioGiorno(p.giorno), ORA()))}</span>
            <span class="nf-ev-t">${esc(p.titolo)}</span><small>${esc(p.tipo)}${p.nota ? ` · ${esc(p.nota)}` : ''}</small></button></li>`,
        )
        .join('')
    : '<li class="muted">Nessun evento nei prossimi giorni.</li>';
  const st = N.stagione(c.extra.riferimenti?.dati, N.partiLocali(ORA()).mese);
  $('nf-stagione').innerHTML = st
    ? `Stagione turistica: gli arrivi di questo mese sono <b>${fmt(st.indice, 2)}×</b> la media mensile (ISTAT ${st.anno}, provincia di Napoli${st.stranieriPct != null ? `, ${st.stranieriPct} % stranieri` : ''})${
        st.scenario ? ` → folla stimata ${st.scenario === 'stagione_bassa' ? 'ridotta del 10-20 %' : 'aumentata del 10-20 %'} nei luoghi turistici (ipotesi).` : '.'
      }`
    : '';
}

function renderAvvisi(c) {
  const el = $('nf-avvisi');
  if (!el) return;
  const out = [];
  const t = c.extra.terremoti?.dati?.[0];
  if (t) out.push(`<li class="nf-card"><span class="nf-ev-t">Campi Flegrei: ultimo terremoto Md ${fmt(t.magnitudo)}</span><small>${esc(quando(t.ts))} · prof. ${fmt(t.profonditaKm)} km · INGV ${tagFonte(c.extra.terremoti.fonte)}</small></li>`);
  // prima gli avvisi che citano stazioni nel Comune di Napoli, poi gli altri; al massimo 3
  const avvisi = [...(c.extra.avvisi?.dati || [])].sort((x, y) => Number(!x.stazioni.length) - Number(!y.stazioni.length) || (y.ts ?? 0) - (x.ts ?? 0));
  for (const a of avvisi.slice(0, 3)) {
    out.push(`<li class="nf-card"><a href="${esc(a.link)}" target="_blank" rel="noopener" class="nf-ev-t">${esc(a.titolo)}</a><small>EAV · ${esc(a.tipo)} · ${esc(quando(a.ts))}</small></li>`);
  }
  el.innerHTML = out.length ? out.join('') : '<li class="muted">Carico gli avvisi…</li>';
}

/** Tabella "Fonti dei dati": stato di ogni fonte, ora del dato, licenza. */
function renderFonti(c) {
  const el = $('nf-fonti');
  if (!el) return;
  const righe = [
    ['Affollamento dei luoghi', { tipo: 'simulato', nome: 'Simulatore della demo (sim-config.json), scala da dati reali', licenza: 'stima dichiarata' }],
    ['Temperatura dei sensori', { tipo: 'simulato', nome: 'Sensori simulati (in produzione ESP32)', licenza: '' }],
    ['Meteo per luogo', c.extra.meteo?.fonte],
    ['Aria: modello', c.extra.ariaModello?.fonte],
    ['Aria: centraline', c.extra.centraline?.fonte],
    ['Allerta meteo', c.extra.allerta?.fonte],
    ['Terremoti', c.extra.terremoti?.fonte],
    ['Linee e stazioni', c.extra.trasporti?.fonte],
    ['Prossimi passaggi', { ...D.FONTI.transitous, tipo: 'live', nota: 'a richiesta, aprendo una stazione' }],
    ['Avvisi trasporti', c.extra.avvisi?.fonte],
    ['Traffico', c.extra.traffico?.fonte ?? { ...D.FONTI.aspi, tipo: 'assente', nota: 'si carica accendendo il livello "Traffico"' }],
    ['Eventi', c.extra.eventi?.fonte],
    ['Dati di riferimento', c.extra.riferimenti?.fonte],
  ];
  el.innerHTML = `<thead><tr><th>Dato</th><th>Stato</th><th>Fonte</th><th class="cm-m-hide">Aggiornato</th><th class="cm-m-hide">Licenza</th></tr></thead><tbody>${righe
    .map(
      ([d, f]) => `<tr><td>${esc(d)}</td><td>${tagFonte(f)}</td><td>${f?.url ? `<a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.nome)}</a>` : esc(f?.nome || '–')}${f?.nota ? `<small>${esc(f.nota)}</small>` : ''}</td>
        <td class="cm-m-hide">${f?.ts ? esc(`${N.dataBreve(f.ts)} ${N.oraBreve(f.ts)}`) : '–'}</td><td class="cm-m-hide">${esc(f?.licenza || '')}</td></tr>`,
    )
    .join('')}</tbody>`;
  D.indice().then((i) => {
    const n = $('nf-snapshot');
    if (n && i?.generato) n.textContent = `Snapshot statici generati il ${N.dataBreve(Date.parse(i.generato))} alle ${N.oraBreve(Date.parse(i.generato))} con tools/aggiorna-dati-napoli.js.`;
  });
}

function renderPannello(c) {
  try {
    renderAllerta(c);
    renderEventi(c);
    renderAvvisi(c);
    renderFonti(c);
  } catch (err) {
    console.error('[fonti] pannello in errore:', err);
  }
}

// ------------------------------------------------------------------ avvio

/**
 * Carica le fonti reali e le collega a mappa e pannello. Non blocca la pagina: ogni fonte entra
 * appena arriva; quelle live si aggiornano ogni 10 minuti (con la cache di fonti/dati.js).
 * @param {{mappa: object}} api  l'oggetto `api` della dashboard (app.js)
 */
export async function avviaFonti(api, { colori = {} } = {}) {
  const m = api.mappa;
  if (!m) return;
  mappaRef = m;
  const c = m.ctx;
  c.extra._colori = colori;
  c.extra._coloriAria = Object.fromEntries(Object.entries(colori).map(([k, v]) => [k, v.colore]));
  const metti = (nome, v) => {
    m.setExtra(nome, v);
    renderPannello(c);
  };
  const carica = (nome, fn) =>
    fn()
      .then((v) => metti(nome, v))
      .catch((err) => metti(nome, { dati: null, fonte: { tipo: 'assente', nome, nota: err.message } }));

  document.addEventListener('click', (e) => {
    const vai = e.target.closest?.('[data-vai]');
    if (vai) {
      m.seleziona(vai.dataset.vai, { vola: true, vista: 'mappa' });
      document.getElementById('citymap')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
  // il pulsante dei passaggi sta nella scheda, che si ridisegna spesso: si risponde già al pointerdown
  let ultimo = 0;
  const passaggi = (e) => {
    const b = e.target.closest?.('[data-passaggi]');
    if (!b || Date.now() - ultimo < 600) return;
    ultimo = Date.now();
    const s = c.extra.trasporti?.dati?.stazioni?.find((x) => x.id === b.dataset.passaggi);
    if (s) {
      const tutti = { ...(c.extra.passaggi || {}) };
      if (tutti[s.id]?.stato === 'ok') delete tutti[s.id]; // "aggiorna": si richiede di nuovo
      c.extra.passaggi = tutti;
      caricaPassaggi(s, c);
    }
  };
  const root = document.getElementById('citymap');
  root?.addEventListener('pointerdown', passaggi);
  root?.addEventListener('click', passaggi);

  renderPannello(c);
  await Promise.all([
    carica('trasporti', D.trasporti).then(() => {
      const nomi = (c.extra.trasporti?.dati?.stazioni || []).filter((s) => s.operatore === 'EAV').map((s) => s.nome);
      return carica('avvisi', () => D.avvisiEav(nomi));
    }),
    carica('eventi', D.eventi),
    carica('riferimenti', D.riferimenti),
    carica('centraline', D.centraline),
    carica('meteo', D.meteo),
    carica('ariaModello', D.ariaModello),
    carica('allerta', D.allerta),
    carica('terremoti', D.terremoti),
  ]);
  setInterval(() => {
    carica('meteo', D.meteo);
    carica('ariaModello', D.ariaModello);
    carica('allerta', D.allerta);
    carica('terremoti', D.terremoti);
    if (c.stato.sovrapposti.traffico) carica('traffico', D.traffico);
  }, 10 * 60_000);
}
