# Audio nel repository: musica CC0 e voce sintetica di prova

`../monta.sh` usa questi file solo dove [`../girato/`](../girato/LEGGIMI.md) non ha di meglio: la musica se manca `girato/musica.*`, la voce sintetica per le battute che Roberto e Mario non hanno ancora registrato. Quando si usano, la chiusura del video ne riporta i crediti. Per farne a meno: `./monta.sh --senza-musica` e `./monta.sh --senza-voce-sintetica`.

| File | Cosa |
|---|---|
| `musica.mp3` | musica di sottofondo, CC0 (sotto) |
| `musica.json` | titolo, autore e licenza della musica, per i crediti della chiusura |
| `voce-sintetica/NN-<scena>-K.m4a` | una battuta della voce fuori campo, sintetica (sotto) |
| `voce-sintetica/indice.json` | per ogni battuta il testo con cui è stata generata, la voce e le impostazioni |

## Musica

`musica.mp3` è **«Funshine» di Kevin MacLeod** (2018), allungata in loop fino a 3:05. Il montaggio la porta da sola a un volume di riferimento (-14 LUFS) e la abbassa sotto la voce.

- **Licenza:** CC0 1.0 Universal (https://creativecommons.org/publicdomain/zero/1.0/). Non ci sono obblighi, nemmeno quello di citare l'autore.
- **Da dove viene:** FreePD.com, la libreria di musica di pubblico dominio di Kevin MacLeod, chiusa nel 2025. File usato: https://archive.org/download/freepd/upbeat/Funshine.mp3, dalla raccolta https://archive.org/details/freepd, cartella `upbeat`.
- **Prove della licenza:**
  - nel file c'è il tag «Available from freepd.com. CC0 license.», con Kevin MacLeod come artista e compositore;
  - il sito di FreePD diceva «This music is all licensed CC0 1.0 Universal Public Domain Dedication» (copia del testo: https://a.ocv.me/pub/stuff/music/freepd/README.md);
  - la pagina di chiusura https://freepd.com/ parla di «Public Domain music downloads»;
  - il 15/11/2026 il brano non era nel catalogo CC BY di incompetech, né su Apple Music o MusicBrainz.
- **Scaricato:** il 15/11/2026.
  - sha256 dell'originale: `b98b226927367a977377fe4f75d1cf59e4366ca2f444c2c7d23d13e7f506f532`;
  - MD5 dell'originale: `9c8715a5f9fca611eec6fad8070f5bd8`, uguale a quello dei metadati di archive.org.
- **Modifica:** l'originale dura 2:45 e finisce con 3,7 s di silenzio. In `musica.mp3`, a 2:29,45, la musica torna indietro di 80 s esatti (32 battute) con un crossfade lineare di 0,5 s, in un punto in cui le due copie sono quasi identiche (correlazione 0,998). È un MP3 a 320 kb/s, 44,1 kHz, lungo 3:05.
  - sha256 di `musica.mp3`: `1a291cce81c98b30183997f6b41da22ff22766bc9560f44102dbddc5685fff29`.
- **Citazione facoltativa** (titoli di coda o descrizione del video): «Funshine» di Kevin MacLeod (FreePD.com), CC0 1.0.
- Se YouTube segnala un Content ID su questo brano, si contesta indicando la licenza CC0 descritta qui.

Scelta tra sei candidate di FreePD, Free Music Archive e incompetech, con un secondo controllo sulle licenze.
- **Scartate:** le tracce di Free Music Archive di John Bartmann. Su Free Music Archive risultano CC0, ma lo stesso album su Bandcamp dichiara CC BY-SA, e lo share-alike costringerebbe a pubblicare il video con la stessa licenza.
- **Alternativa pronta:** «Skydive Safari» di Kevin MacLeod, di pubblico dominio. L'autore chiede di non essere citato. Dura 3:11, non serve il loop, ma è più dinamica: a 0:20 ha un buco e poi un attacco forte.

## Voce sintetica di prova

Una voce di riserva, finché non ci sono le registrazioni vere. È fatta con **ElevenLabs**, modello `eleven_multilingual_v2`, in italiano: le voci predefinite **George** per Roberto ed **Eric** per Mario, con stability 0.5, similarity 0.75, style 0, speaker boost e seme 2026. Velocità 1.0, tranne `10-adesso-2` a 1.1 per entrare nel suo spazio (le battute importate dalle prove hanno `"speed": null` nell'indice; le rigenerate la riportano).

- **Scelta delle voci:** 13 voci maschili confrontate il 15/11, con la trascrizione automatica di faster-whisper, la durata e l'altezza della voce. George ed Eric sono l'unica coppia senza errori sulle parole difficili, ed entrano tutte nel loro spazio. **Riserva:** Brian per Roberto e Daniel per Mario.
- **Parole difficili:** sono scritte per la sintesi come si dicono, per esempio «Twin Ciro», «emme cu ti ti», «a pi i», «millenovecento» e «bèdge»: scritto «badge», la b usciva sorda e si sentiva «page». L'elenco è `SINTESI` in [`../scene/voce_sintetica.py`](../scene/voce_sintetica.py).
- **Titolo `03-titolo-1`:** letto tutto intero, ElevenLabs dice «Twin Zero». Il file è composto da «Twin Ciro.», tagliato da un'altra richiesta, poi 0,25 s di silenzio e «City Intelligence and Responsive Orchestration.» chiesto a parte. Lo script non lo rigenera da solo.
- **Testo cambiato:** se una battuta cambia nella scaletta, o passa da Roberto a Mario, il suo file non si usa più (lo controlla `indice.json`) e resta muta finché non la rigeneri. `monta.py` usa solo i file elencati in `indice.json`.
- **Rigenerare:** con la chiave di ElevenLabs nella variabile d'ambiente, mai nei file e meglio non sulla riga di comando, dove resterebbe nella cronologia della shell. Rifà solo le battute nuove o cambiate. `--prova` dice cosa farebbe, senza chiamare ElevenLabs.
  ```bash
  read -rs ELEVENLABS_API_KEY && export ELEVENLABS_API_KEY
  ```
  ```bash
  python3 scene/voce_sintetica.py
  ```
  Poi `./monta.sh`. I file che non corrispondono più a nessuna battuta restano finché non lanci lo script con `--pulisci`: così una scena saltata e poi rimessa non perde la sua voce.
- **Condizioni:** la voce è sintetica e lo dichiariamo nei crediti della chiusura («Voci sintetiche di prova (ElevenLabs)»). Con il piano gratuito ElevenLabs chiede di essere citata e non concede l'uso commerciale; per un video di hackathon va bene.
