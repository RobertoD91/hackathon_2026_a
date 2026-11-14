# Riprese vere

Metti qui le riprese girate in sede. Se un file esiste, `../monta.sh` lo usa al posto del segnaposto o della scena simulata. Formati video: `.mp4`, `.mov`, `.m4v`, `.webm`, `.mkv`. Formati audio: `.m4a`, `.wav`, `.mp3`, `.aac`, `.ogg`, `.flac`.

| File | Scena | Durata usata | Se manca |
|---|---|---|---|
| `cirogpt.mp4` | 03, la chat con CiroGPT | 58 s | chat ricostruita (risposte vere dell'API) |
| `badge.mp4` | 06, IoT | 7 s | riquadro di riserva: formato dei messaggi MQTT del firmware (con `--segnaposto`: cartello «Qui va una ripresa reale») |
| `plastico.mp4` | 07, IoT | 6 s | riquadro di riserva: firmware installato dal browser (con `--segnaposto`: cartello) |
| `voce.m4a` | tutto il video | 2:54 | video muto con i sottotitoli |
| `musica.mp3` | tutto il video, sotto la voce | 2:54, in loop | niente musica |

- Si usano i **primi** secondi di ogni file. Per partire più avanti cambia `"da"` della scena in `../scene/scaletta.json`.
- Una ripresa più corta della scena resta ferma sull'ultimo fotogramma.
- Indicazioni precise per ogni ripresa (inquadratura, cosa scrivere a CiroGPT): [`../copione.md`](../copione.md), sezione «Riprese da girare».
- **Musica solo se libera da diritti** (CC0 o fatta da noi), con la licenza annotata in questo file. Nel dubbio, niente musica.

I file audio e video di questa cartella non vanno nel repository (vedi `../.gitignore`): restano sul portatile che monta il video.
