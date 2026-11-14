// Classe base degli agenti (CONTRATTO.md, sezione 3). Isomorfa.
//
//   export class Meteo extends Agent {
//     name = 'meteo';
//     subscribes = ['reading', 'scenario'];
//     async onEvent(event, ctx) {
//       const t = event.data.readings?.temperature_c;
//       if (t > 30 && this.cooldown('caldo', 60_000)) {
//         ctx.send('orchestrator', `Caldo: ${t} °C`, { t });
//       }
//     }
//   }
//
// Il `ctx` passato agli handler contiene:
//   ctx.state                      stato condiviso, sola lettura (vedi state.js)
//   ctx.llm                        adattatore LLM: ctx.llm.complete({ system, prompt | messages, json, fallback })
//   ctx.publish(type, data)        pubblica un evento con source = nome dell'agente
//   ctx.decide(summary, extra)     → evento agent.decision  { summary, actions, reasoning, metrics }
//   ctx.send(to, text, payload)    → evento agent.message   { to, text, payload }
//   ctx.notify(channel, to, text)  → evento notify          { channel, to, text }
//   ctx.metric(name, value, unit)  → evento metric          { name, value, unit }
//   ctx.every(ms, fn)              timer ripetuto, fermato in automatico a hub.stop()
//   ctx.log                        logger con prefisso = nome dell'agente
//   ctx.event                      l'evento che ha causato la chiamata (null in onStart/onChat)
//
// Anche un oggetto semplice `{ name, subscribes, onEvent }` funziona come agente:
// il nucleo usa solo queste proprietà. La classe aggiunge `cooldown()`.

export class Agent {
  /** Nome unico dell'agente; è la `source` degli eventi che pubblica. */
  name = 'agent';

  /** Tipi di evento da ricevere, es. ['reading', 'scenario']. '*' = tutti. */
  subscribes = [];

  /** Descrizione breve, mostrata in `/api/state` e utile nei prompt. */
  description = '';

  #cooldowns = new Map();

  /**
   * Chiamato per ogni evento di un tipo in `subscribes` (mai per gli eventi pubblicati
   * dall'agente stesso). Gli eventi arrivano a un agente uno alla volta, in ordine.
   * @param {{id: string, ts: number, type: string, source: string, data: object}} _event
   * @param {object} _ctx
   */
  async onEvent(_event, _ctx) {}

  /**
   * Solo per l'orchestratore (`name = 'orchestrator'`): risponde a `POST /api/chat`.
   * Restituisce la risposta come stringa (oppure `{ reply }`).
   * @param {{from: string, text: string}} _msg
   * @param {object} _ctx
   * @returns {Promise<string | {reply: string} | null>}
   */
  async onChat(_msg, _ctx) {
    return null;
  }

  /** Facoltativo: chiamato a `hub.start()`. Utile per avviare timer con `ctx.every`. */
  async onStart(_ctx) {}

  /** Facoltativo: chiamato a `hub.stop()`. */
  async onStop(_ctx) {}

  /**
   * Limitatore di frequenza: restituisce `true` (e segna l'ora) se dall'ultima volta
   * che ha restituito `true` per questa chiave sono passati almeno `ms` millisecondi.
   * Utile per non mandare la stessa notifica o la stessa chiamata LLM a ogni lettura.
   *
   *   if (this.cooldown(`caldo:${zona}`, 5 * 60_000)) ctx.notify(...)
   */
  cooldown(key, ms, now = Date.now()) {
    const last = this.#cooldowns.get(key);
    if (last !== undefined && now - last < ms) return false;
    this.#cooldowns.set(key, now);
    return true;
  }

  /** Azzera i limitatori (tutti o una chiave). */
  resetCooldown(key) {
    if (key === undefined) this.#cooldowns.clear();
    else this.#cooldowns.delete(key);
  }
}
