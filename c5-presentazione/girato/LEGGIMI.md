# Riprese vere

Metti qui le riprese girate in sede. Se un file esiste, `../monta.sh` lo usa al posto del segnaposto o della scena simulata. Formati video: `.mp4`, `.mov`, `.m4v`, `.webm`, `.mkv`. Formati audio: `.m4a`, `.wav`, `.mp3`, `.aac`, `.ogg`, `.flac`.

| File | Scena | Durata usata | Se manca |
|---|---|---|---|
| `chat.mp4` | 06, la chat WhatsApp vera con il contatto TwinCIRO | 38 s (anche a pezzi, vedi `"pezzi"`) | chat ricostruita (risposte vere dell'API) |
| `badge.mp4` | 11, sensori fatti da noi: il badge WHY2025 che pubblica | 4 s, oppure 8 s se manca `tasmota.mp4` | se mancano tutte e due: cartello «Sensori fatti da noi» (dispositivi, formato `napoli/...`, rete; con `--segnaposto`: cartello «Qui va una ripresa reale») |
| `tasmota.mp4` | 11, sensori fatti da noi: la scheda Tasmota e i suoi messaggi | 4 s, oppure 8 s se manca `badge.mp4` | come sopra |
| `voce/NN-<scena>-K.m4a` | la battuta K della scena (nomi in [`../voce/COPIONE-VOCE.md`](../voce/COPIONE-VOCE.md)) | lo spazio della battuta | la voce sintetica di prova di [`../audio/voce-sintetica/`](../audio/LEGGIMI.md), se il testo della battuta è ancora quello; altrimenti sottotitolo senza voce |
| `voce/NN-<scena>.m4a` | una scena intera | la scena | come sopra (con questo file la scena non usa la voce sintetica) |
| `voce.m4a` | tutto il video | 2:59 | come sopra (con questo file la voce sintetica non si usa per niente) |
| `musica.mp3` | tutto il video, sotto la voce | 2:59, in loop | la musica CC0 di [`../audio/`](../audio/LEGGIMI.md) |

- Si usano i **primi** secondi di ogni file. Per partire più avanti cambia `"da"` della scena in `../scene/scaletta.json` (per la chat si possono indicare i `"pezzi"` da tenere).
- Una ripresa più corta della sua parte resta ferma sull'ultimo fotogramma.
- Indicazioni precise per ogni ripresa (inquadratura, cosa scrivere a TwinCIRO): [`../copione.md`](../copione.md), sezione «Riprese da girare».
- **Musica solo se libera da diritti** (CC0 o fatta da noi), con la licenza annotata in questo file. Nel dubbio, niente musica. Il montaggio porta qualsiasi musica a -14 LUFS e poi la abbassa sotto la voce.
- Per sentire solo le voci vere: `../monta.sh --senza-voce-sintetica`; senza musica: `--senza-musica`.

I file audio e video di questa cartella non vanno nel repository (vedi `../.gitignore`): restano sul portatile che monta il video. La voce registrata entra nel repository solo già mescolata nelle clip di `../clip/`. La musica CC0 e la voce sintetica di prova stanno invece in [`../audio/`](../audio/LEGGIMI.md), nel repository, con le loro licenze.
