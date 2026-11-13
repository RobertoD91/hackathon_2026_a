#!/usr/bin/env node
// Simula il ponte OpenClaw ↔ hub (CONTRATTO.md, sezione 5), senza WhatsApp e senza OpenClaw.
//
// Fa esattamente quello che dovrà fare OpenClaw:
//   in entrata:  ogni messaggio di un utente → POST /api/chat { from, text } → stampa { reply }
//   in uscita:   polling di GET /api/notifications?since=<next>&channel=whatsapp ogni N secondi
//                → per ogni notifica "invia" (qui: stampa) data.text a data.to
//
// Uso:
//   node shared/iot-agents/tools/openclaw-bridge-sim.js                    # interattivo: scrivi e premi invio
//   node shared/iot-agents/tools/openclaw-bridge-sim.js --say "che temperatura c'è?"   # un messaggio ed esce
//   node shared/iot-agents/tools/openclaw-bridge-sim.js --listen 60        # solo uscita, per 60 s
//
// Opzioni:
//   --target <url>    hub (predefinito http://localhost:8701)
//   --from <id>       mittente dei messaggi (predefinito whatsapp:+390000000000)
//   --channel <c>     canale da leggere (predefinito whatsapp; "all" = tutti)
//   --interval <s>    intervallo di polling (predefinito 2)
//   --replay          alla partenza invia anche le notifiche già presenti (di norma si saltano)
//   --token <t>       token del hub (oppure env HUB_TOKEN)

import readline from 'node:readline';

const args = parseArgs(process.argv.slice(2));
const target = (args.target || 'http://localhost:8701').replace(/\/+$/, '');
const from = args.from || 'whatsapp:+390000000000';
const channel = args.channel || 'whatsapp';
const intervalMs = (Number(args.interval) || 2) * 1000;
const token = args.token || process.env.HUB_TOKEN;
const headers = { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) };

let since; // cursore: il `next` dell'ultima risposta

/** Una chiamata di polling: restituisce le notifiche nuove e aggiorna il cursore. */
async function pollOnce({ deliver = true } = {}) {
  const q = new URLSearchParams();
  if (since !== undefined) q.set('since', String(since));
  if (channel !== 'all') q.set('channel', channel);
  const res = await fetch(`${target}/api/notifications?${q}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  since = j.next;
  if (deliver) for (const n of j.notifications) send(n);
  return j.notifications;
}

/** Qui OpenClaw manderebbe il messaggio WhatsApp. */
function send(n) {
  const d = n.data;
  console.log(`\n[${d.channel} → ${d.to}] ${d.text}   (da ${n.source}, ${new Date(n.ts).toLocaleTimeString('it-IT')})`);
}

async function chat(text) {
  const res = await fetch(`${target}/api/chat`, { method: 'POST', headers, body: JSON.stringify({ from, text }) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok && !j.reply) throw new Error(j.error || `HTTP ${res.status}`);
  return j.reply;
}

async function main() {
  // primo polling: di norma salta lo storico (non rimanda vecchi messaggi a ogni riavvio)
  try {
    const old = await pollOnce({ deliver: !!args.replay });
    console.log(`Ponte collegato a ${target} (canale ${channel}). Notifiche già presenti: ${old.length}${args.replay ? ' (inviate)' : ' (saltate)'}.`);
  } catch (err) {
    console.error(`Hub non raggiungibile su ${target}: ${err.cause?.code || err.message}`);
    process.exit(1);
  }

  if (args.say) {
    console.log(`${from}> ${args.say}`);
    console.log(`hub> ${await chat(args.say)}`);
    await new Promise((r) => setTimeout(r, 500));
    await pollOnce();
    return;
  }

  const timer = setInterval(() => pollOnce().catch((err) => console.error(`polling fallito: ${err.message}`)), intervalMs);

  if (args.listen) {
    setTimeout(() => {
      clearInterval(timer);
      process.exit(0);
    }, Number(args.listen) * 1000);
    return;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: `${from}> ` });
  console.log('Scrivi un messaggio come se fossi su WhatsApp (Ctrl+C per uscire).');
  rl.prompt();
  rl.on('line', async (line) => {
    const text = line.trim();
    if (text) {
      try {
        console.log(`hub> ${await chat(text)}`);
      } catch (err) {
        console.error(`errore: ${err.message}`);
      }
    }
    rl.prompt();
  });
  rl.on('close', () => {
    clearInterval(timer);
    process.exit(0);
  });
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    if (key === 'replay') out.replay = true;
    else out[key] = argv[++i];
  }
  return out;
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
