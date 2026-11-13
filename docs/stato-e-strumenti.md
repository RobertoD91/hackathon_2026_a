# Stato del lavoro e strumenti

Diario delle decisioni e di quello che sappiamo sull'ambiente di lavoro. Aggiornalo quando cambia qualcosa.

## Convenzioni della repo

- Una cartella per soluzione, con prefisso della challenge: `c1-...`, `c2-...`, `c4-...`, `c5-...`. **Per una stessa challenge possono esserci più soluzioni** (es. `c5-agentic-city`, `c5-heatescape`).
- Ogni cartella ha il suo `README.md` con brief, scelte, come avviarla e stato.
- Tutto su `master`, in italiano (vedi `CLAUDE.md`).

## Cronologia delle decisioni

| Quando | Decisione |
|---|---|
| 13/11 | Repo predisposta: `CLAUDE.md` (regole: solo `master`, italiano), README, `.gitignore`. Team di 5. |
| 13/11 | C4: cercato codice open da riusare prima di scrivere da zero. Scelto **Monster Tamer** (Phaser 3, MIT). Scartati RPG-JS (troppo grande, combattimento in tempo reale), phaser-rpg (senza battaglie), giochi cyber esistenti (non sono JRPG). |
| 13/11 | Hosting su **GitHub Pages** con workflow Actions; dominio dell'account `robertodisanto.it`. |
| 13/11 | C4: contromosse red vs blue, tutto in italiano, partenza diretta con Black Hat, titolo con immagine FLUX e nomi del team. |
| 13/11 | Un'altra sessione ha aperto `c5-agentic-city/` (direzione: niente webapp, agenti + ESP32 + droni; Worker Cloudflare nuovo, **non `mbl-privato`**). |
| 13/11 | `jrpg/` rinominata `c4-jrpg/` (resta un redirect in `jrpg/index.html`). Brainstorming su C1, C2, C5 in [`brainstorming.md`](brainstorming.md). |
| — | Tower defense per C4: previsto dopo, non iniziato. |

## Punti di forza del team

- Hardware IoT: **ESP32** con sensori (luce, temperatura), possibilità di modulo **5G** (rilevante per Fastweb + Vodafone), droni.
- **OpenClaw** già funzionante come orchestratore di agenti, con canale WhatsApp.
- Server su cloud e deploy veloce con Claude Code.

## Strumenti e servizi disponibili nelle sessioni cloud di Claude Code

| Servizio | Uso | Note |
|---|---|---|
| GitHub Pages | Hosting statico dei prototipi | Workflow `.github/workflows/pages.yml`, deploy in ~20 s dopo il push. URL: https://robertodisanto.it/hackathon_2026_a/ |
| FLUX.1 Kontext (Hugging Face Space) | Generazione immagini (titoli, creatività pubblicitarie per C1, mockup) | `tools/flux-gen.sh "<prompt>" out.webp`. Funziona dalle sessioni cloud (credenziali iniettate dal proxy); altrove serve un token Hugging Face. Restituisce WebP 1024×1024. |
| Hunyuan3D 2.1 (Hugging Face Space) | Generazione di modelli 3D da immagine | Non ancora usato. |
| Cloudflare API | Workers, deploy di backend leggeri | Per C5: Worker **nuovo**, non toccare `mbl-privato`. |
| Playwright + Chromium | Test end-to-end e screenshot dei prototipi | Già installati nel container. |
| ffmpeg | Conversione audio/immagini | Usato per i WAV → MP3 di C4. |

## C4 (`c4-jrpg/`) in breve

Vedi [`../c4-jrpg/README.md`](../c4-jrpg/README.md) e la sezione in `CLAUDE.md`. Giocabile su https://robertodisanto.it/hackathon_2026_a/c4-jrpg/

Da fare:
- sostituire gli asset di terze parti non ridistribuibili;
- grafica a tema (mostri e mappa sono ancora fantasy);
- progressione, livelli e punteggi (richiesti esplicitamente dal brief);
- tecnologie Cisco, per esempio missioni ispirate a Packet Tracer.
