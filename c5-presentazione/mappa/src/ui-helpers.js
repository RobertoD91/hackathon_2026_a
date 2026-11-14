// Utilità per le dashboard (browser). Nessuna dipendenza, nessun framework.
//
//   import { readingLabel, formatReading, sparklineSvg, escapeHtml } from '../src/ui-helpers.js';

/** Etichette italiane e unità delle grandezze standard del contratto. */
export const READING_INFO = {
  temperature_c: { label: 'Temperatura', unit: '°C', decimals: 1 },
  humidity_pct: { label: 'Umidità', unit: '%', decimals: 0 },
  light_lux: { label: 'Luce', unit: 'lux', decimals: 0 },
  soil_moisture_pct: { label: 'Umidità suolo', unit: '%', decimals: 0 },
  fill_pct: { label: 'Riempimento', unit: '%', decimals: 0 },
  button: { label: 'Pulsante', unit: '' },
  power_w: { label: 'Potenza', unit: 'W', decimals: 0 },
  people_count: { label: 'Persone', unit: '', decimals: 0 },
};

export function readingLabel(key) {
  return READING_INFO[key]?.label ?? key.replace(/_/g, ' ');
}

/** "24,1 °C", "5.300 lux", "premuto"... */
export function formatReading(key, value) {
  if (typeof value === 'boolean') return key === 'button' ? (value ? 'premuto' : '—') : value ? 'sì' : 'no';
  const info = READING_INFO[key] || {};
  return `${formatNumber(value, info.decimals ?? 1)}${info.unit ? ' ' + info.unit : ''}`;
}

/** Numero formattato all'italiana, con forma compatta oltre 10.000 (12,9 mila). */
export function formatNumber(v, decimals = 1) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—';
  if (Math.abs(v) >= 10_000) {
    return new Intl.NumberFormat('it-IT', { notation: 'compact', maximumFractionDigits: 1 }).format(v);
  }
  return new Intl.NumberFormat('it-IT', { maximumFractionDigits: decimals, minimumFractionDigits: 0 }).format(v);
}

/** "HH:MM:SS" dell'ora locale del browser. */
export function formatTime(ts) {
  return new Date(ts).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/**
 * Sparkline SVG (stringa) da punti `[[ts, valore], ...]`.
 * Linea 2px nel colore `currentColor` (impostalo via CSS), ultimo punto evidenziato.
 */
export function sparklineSvg(points, { width = 120, height = 28, pad = 3 } = {}) {
  if (!points || points.length < 2) return `<svg class="spark" width="${width}" height="${height}" aria-hidden="true"></svg>`;
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  let y0 = Math.min(...ys);
  let y1 = Math.max(...ys);
  if (y1 - y0 < 1e-9) {
    y0 -= 1;
    y1 += 1;
  }
  const sx = (x) => pad + ((x - x0) / (x1 - x0 || 1)) * (width - 2 * pad);
  const sy = (y) => height - pad - ((y - y0) / (y1 - y0)) * (height - 2 * pad);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join(' ');
  const last = points[points.length - 1];
  return (
    `<svg class="spark" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" ` +
    `aria-label="andamento: min ${formatNumber(Math.min(...ys))}, max ${formatNumber(Math.max(...ys))}">` +
    `<path d="${d}" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>` +
    `<circle cx="${sx(last[0]).toFixed(1)}" cy="${sy(last[1]).toFixed(1)}" r="3" fill="currentColor"/></svg>`
  );
}
