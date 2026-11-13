// Generatore pseudo-casuale con seme: la simulazione è deterministica.
// Stesso annuncio + stesso seme = stessi numeri, in Node e nel browser.

/** Hash di una stringa in un intero a 32 bit (cyrb53 ridotto). */
export function hashString(str) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 ^ h1) >>> 0;
}

/** mulberry32: restituisce una funzione che produce numeri in [0, 1). */
export function makeRng(seed) {
  let a = (typeof seed === 'string' ? hashString(seed) : seed) >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Numero in [0,1) deterministico per una combinazione di chiavi. */
export function unit(...keys) {
  return makeRng(keys.join('|'))();
}

/** Normale standard deterministica (Box-Muller) da una combinazione di chiavi. */
export function gauss(...keys) {
  const r = makeRng(keys.join('|'));
  const u = Math.max(r(), 1e-9);
  const v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function pickWeighted(rng, items, weightOf) {
  const total = items.reduce((s, it) => s + weightOf(it), 0);
  let x = rng() * total;
  for (const it of items) {
    x -= weightOf(it);
    if (x <= 0) return it;
  }
  return items[items.length - 1];
}

export function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length) % arr.length];
}

export const sigmoid = (x) => 1 / (1 + Math.exp(-x));
export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
