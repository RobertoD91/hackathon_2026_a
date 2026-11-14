# Riprese vere

Metti qui le riprese girate in sede. Se un file esiste, `../monta.sh` lo usa al posto del segnaposto o della scena simulata. Formati video: `.mp4`, `.mov`, `.m4v`, `.webm`, `.mkv`. Formati audio: `.m4a`, `.wav`, `.mp3`, `.aac`, `.ogg`, `.flac`.

| File | Scena | Durata usata | Se manca |
|---|---|---|---|
| `chat.mp4` | 06, la chat WhatsApp vera con il contatto TwinCIRO | 40 s (anche a pezzi, vedi `"pezzi"`) | chat ricostruita (risposte vere dell'API) |
| `badge.mp4` | 11, sensori fatti da noi: il badge WHY2025 che pubblica | 4 s, oppure 8 s se manca `tasmota.mp4` | se mancano tutte e due: cartello «Sensori fatti da noi» (dispositivi, formato `napoli/...`, rete; con `--segnaposto`: cartello «Qui va una ripresa reale») |
| `tasmota.mp4` | 11, sensori fatti da noi: la scheda Tasmota e i suoi messaggi | 4 s, oppure 8 s se manca `badge.mp4` | come sopra |
| `voce/NN-<scena>-K.m4a` | la battuta K della scena (nomi in [`../voce/COPIONE-VOCE.md`](../voce/COPIONE-VOCE.md)) | lo spazio della battuta | sottotitolo senza voce |
| `voce/NN-<scena>.m4a` | una scena intera | la scena | come sopra |
| `voce.m4a` | tutto il video | 2:58 | video muto con i sottotitoli |
| `musica.mp3` | tutto il video, sotto la voce | 2:58, in loop | niente musica |

- Si usano i **primi** secondi di ogni file. Per partire più avanti cambia `"da"` della scena in `../scene/scaletta.json` (per la chat si possono indicare i `"pezzi"` da tenere).
- Una ripresa più corta della sua parte resta ferma sull'ultimo fotogramma.
- Indicazioni precise per ogni ripresa (inquadratura, cosa scrivere a TwinCIRO): [`../copione.md`](../copione.md), sezione «Riprese da girare».
- **Musica solo se libera da diritti** (CC0 o fatta da noi), con la licenza annotata in questo file. Nel dubbio, niente musica.

I file audio e video di questa cartella non vanno nel repository (vedi `../.gitignore`): restano sul portatile che monta il video. La voce entra nel repository solo già mescolata nelle clip di `../clip/`.
