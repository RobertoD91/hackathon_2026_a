// Logger leggibile per la console. Isomorfo.
//
// Livelli: debug < info < warn < error < silent.
// In Node il livello si sceglie con LOG_LEVEL (predefinito: info).

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

const env = typeof process !== 'undefined' && process.env ? process.env : {};
const useColor =
  typeof process !== 'undefined' && process.stdout && process.stdout.isTTY && !env.NO_COLOR;

const COLORS = { debug: 90, info: 36, warn: 33, error: 31 };
const paint = (code, s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);

function hhmmss(d = new Date()) {
  return d.toTimeString().slice(0, 8);
}

/**
 * @param {{level?: string, prefix?: string, sink?: (level: string, line: string) => void}} [opts]
 * @returns {{debug: Function, info: Function, warn: Function, error: Function, child: (prefix: string) => object, level: string}}
 */
export function createLogger({ level = env.LOG_LEVEL || 'info', prefix = '', sink } = {}) {
  const min = LEVELS[level] ?? LEVELS.info;
  const out =
    sink ||
    ((lvl, line) => {
      const fn = lvl === 'error' ? console.error : lvl === 'warn' ? console.warn : console.log;
      fn(line);
    });

  const make = (lvl) => (...args) => {
    if (LEVELS[lvl] < min) return;
    const text = args
      .map((a) => (a instanceof Error ? a.stack || a.message : typeof a === 'object' ? safeJson(a) : String(a)))
      .join(' ');
    const tag = prefix ? paint(COLORS[lvl], `[${prefix}]`) + ' ' : '';
    out(lvl, `${paint(90, hhmmss())} ${tag}${text}`);
  };

  return {
    level,
    debug: make('debug'),
    info: make('info'),
    warn: make('warn'),
    error: make('error'),
    child: (p) => createLogger({ level, prefix: prefix ? `${prefix}:${p}` : p, sink }),
  };
}

function safeJson(v) {
  try {
    const s = JSON.stringify(v);
    return s.length > 300 ? s.slice(0, 300) + '…' : s;
  } catch {
    return String(v);
  }
}

/** Logger che non stampa nulla (utile nei test). */
export const silentLogger = createLogger({ level: 'silent' });
