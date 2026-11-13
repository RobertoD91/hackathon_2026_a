// Caricamento dei file di dati (data/*.json) sia in Node sia nel browser.

const FILES = { popolazione: 'popolazione.json', benchmark: 'benchmark.json' };
let cache = null;

export async function loadData() {
  if (cache) return cache;
  const out = {};
  const isNode = typeof window === 'undefined' && typeof process !== 'undefined';
  for (const [key, name] of Object.entries(FILES)) {
    const url = new URL(`../../data/${name}`, import.meta.url);
    if (isNode) {
      const fs = await import('node:fs/promises');
      out[key] = JSON.parse(await fs.readFile(url, 'utf8'));
    } else {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Impossibile caricare ${name}`);
      out[key] = await res.json();
    }
  }
  cache = out;
  return out;
}

/** Etichette italiane condivise da UI e motore. */
export const PIATTAFORME = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  tiktok: 'TikTok',
  linkedin: 'LinkedIn',
};

export const OBIETTIVI = {
  notorieta: 'Notorietà',
  traffico: 'Traffico',
  interazione: 'Interazione',
  lead: 'Contatti (lead)',
  conversioni: 'Vendite (conversioni)',
};

export const POSIZIONAMENTI = {
  feed: 'Feed',
  storie: 'Storie',
  reels: 'Reels / video verticali',
  automatico: 'Automatico',
};

export const SETTORI = {
  moda: 'Moda e scarpe',
  beauty: 'Beauty e cosmetica',
  sport: 'Sport e fitness',
  tecnologia: 'Tecnologia',
  gaming: 'Gaming',
  viaggi: 'Viaggi',
  cibo: 'Cibo e delivery',
  casa: 'Casa e arredo',
  famiglia: 'Famiglia e bambini',
  finanza: 'Banche e finanza',
  motori: 'Auto e moto',
  musica_eventi: 'Musica ed eventi',
  salute: 'Salute e benessere',
  animali: 'Animali',
  sostenibilita: 'Sostenibilità',
  altro: 'Altro',
};

/** Call to action: forza (quanto spinge al click) e obiettivi coerenti. */
export const CTA = {
  'Acquista ora': { forza: 0.9, obiettivi: ['conversioni'] },
  'Scopri di più': { forza: 0.6, obiettivi: ['traffico', 'notorieta', 'interazione'] },
  'Ordina ora': { forza: 0.9, obiettivi: ['conversioni'] },
  'Prenota ora': { forza: 0.85, obiettivi: ['conversioni', 'lead'] },
  'Iscriviti': { forza: 0.75, obiettivi: ['lead'] },
  'Richiedi informazioni': { forza: 0.65, obiettivi: ['lead'] },
  'Scarica': { forza: 0.75, obiettivi: ['conversioni', 'traffico'] },
  'Guarda ora': { forza: 0.55, obiettivi: ['interazione', 'notorieta', 'traffico'] },
  'Invia messaggio': { forza: 0.5, obiettivi: ['lead', 'interazione'] },
  'Nessuna': { forza: 0, obiettivi: [] },
};

export const AREE_TARGET = {
  italia: 'Tutta Italia',
  nord: 'Nord',
  centro: 'Centro',
  sud: 'Sud e Isole',
};

export const AREA_MAP = {
  italia: ['nord-ovest', 'nord-est', 'centro', 'sud', 'isole'],
  nord: ['nord-ovest', 'nord-est'],
  centro: ['centro'],
  sud: ['sud', 'isole'],
};
