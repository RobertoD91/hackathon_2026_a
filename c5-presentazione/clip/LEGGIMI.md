# Clip del video di TwinCIRO

Cartella scritta da `../monta.sh` a ogni montaggio: **non modificare questi file**, vengono riscritti (le tue versioni salvale fuori da qui). Sono nel repository apposta, come copia di sicurezza.

Ogni scena del video è una clip a sé, **senza sottotitoli**, per rimontare a mano:

- `NN-<scena>.mp4`: 1920×1080, 30 fps, H.264 (qualità costante, CRF 20) con l'audio del montaggio (AAC 48 kHz stereo: voce e musica se ci sono, altrimenti silenzio). Le dissolvenze dal nero e verso il nero (0,2 s) sono già dentro: messe in fila, senza transizioni, rifanno il video;
- `NN-<scena>.srt`: i sottotitoli della clip, con i tempi dall'inizio della clip (stesso nome della clip: VLC e mpv li caricano da soli). Le scene senza voce non lo hanno;
- `sottotitoli.srt`: i sottotitoli del video intero, e `00-finale-senza-sottotitoli.mp4`: il video intero (le clip unite) senza sottotitoli impressi. La bozza con i sottotitoli impressi è [`../bozza.mp4`](../bozza.mp4);
- `sottotitoli.ass`: gli stessi sottotitoli con lo stile della bozza (riquadro scuro, carattere Inter), per imprimerli con ffmpeg;
- `elenco.txt`: l'ordine delle clip (serve anche a `monta.sh` per togliere quelle vecchie: non cancellarlo).

I testi della voce, scena per scena e con chi li legge, sono in [`../voce/`](../voce/COPIONE-VOCE.md).

## Ordine e durate

| # | Clip | Nel video | Durata | Battute |
|---|---|---|---|---|
| 01 | `01-regata.mp4` | 0:00,0–0:08,0 | 8,0 s | 2 · Roberto 1, Mario 1 |
| 02 | `02-motivazione.mp4` | 0:08,0–0:19,0 | 11,0 s | 2 · Roberto 1, Mario 1 |
| 03 | `03-titolo.mp4` | 0:19,0–0:26,0 | 7,0 s | 2 · Roberto 1, Mario 1 |
| 04 | `04-fonti.mp4` | 0:26,0–0:34,0 | 8,0 s | 2 · Roberto 1, Mario 1 |
| 05 | `05-utenti.mp4` | 0:34,0–0:40,0 | 6,0 s | 1 · Roberto |
| 06 | `06-chat.mp4` | 0:40,0–1:18,0 | 38,0 s | 7 · Mario 3, Roberto 4 |
| 07 | `07-operatore.mp4` | 1:18,0–1:32,0 | 14,0 s | 3 · Roberto 2, Mario 1 |
| 08 | `08-architettura.mp4` | 1:32,0–1:43,0 | 11,0 s | 2 · Mario 1, Roberto 1 |
| 09 | `09-grafo.mp4` | 1:43,0–1:48,5 | 5,5 s | 1 · Mario |
| 10 | `10-adesso.mp4` | 1:48,5–1:57,5 | 9,0 s | 2 · Mario 1, Roberto 1 |
| 11 | `11-sensori.mp4` | 1:57,5–2:05,5 | 8,0 s | 2 · Mario 1, Roberto 1 |
| 12 | `12-gemello.mp4` | 2:05,5–2:14,5 | 9,0 s | 2 · Mario 1, Roberto 1 |
| 13 | `13-fastweb.mp4` | 2:14,5–2:30,5 | 16,0 s | 3 · Mario 2, Roberto 1 |
| 14 | `14-benefici.mp4` | 2:30,5–2:41,5 | 11,0 s | 2 · Roberto 1, Mario 1 |
| 15 | `15-vero.mp4` | 2:41,5–2:46,5 | 5,0 s | 1 · Roberto |
| 16 | `16-chiusura.mp4` | 2:46,5–2:54,5 | 8,0 s | 2 · Roberto 1, Mario 1 |
| | **Totale** | | **2:54** (174,5 s) | 36 |

## Rimontare a mano

1. Importa le clip nell'editor e mettile in fila nell'ordine dei numeri, una attaccata all'altra.
2. Sottotitoli: importa `sottotitoli.srt` e mettilo all'inizio della timeline (oppure l'SRT di ogni clip all'inizio della sua clip). Sono UTF-8, formato SRT standard:
   - **DaVinci Resolve**: *File › Import › Subtitle*, poi trascina l'SRT dal Media Pool sulla timeline;
   - **Premiere Pro**: *File › Import* dell'SRT, poi trascinalo sulla sequenza (diventa una traccia di didascalie);
   - **Final Cut Pro**: *File › Import › Captions*;
   - **YouTube**: carica `00-finale-senza-sottotitoli.mp4`, poi *Sottotitoli › Carica file › Con temporizzazione* e scegli `sottotitoli.srt`;
   - **VLC**, per guardare il video intero con i sottotitoli: *Sottotitoli › Aggiungi file di sottotitoli*.
3. Con ffmpeg, da questa cartella:
   - unire le clip: `ffmpeg -f concat -safe 0 -i elenco.txt -c copy prova.mp4` (a ogni giunta l'audio può slittare di un paio di centesimi: per il video intero usa `00-finale-senza-sottotitoli.mp4`);
   - imprimere i sottotitoli con lo stile della bozza: `ffmpeg -i 00-finale-senza-sottotitoli.mp4 -vf ass=sottotitoli.ass -c:a copy prova.mp4` (con `-vf subtitles=sottotitoli.srt` lo stile è quello semplice del lettore).

Per rifare clip, SRT e testi della voce senza la codifica lunga della bozza: `../monta.sh --solo-clip`.
