# Cyber JRPG — Red vs Blue (prototipo)

Gioco educativo su networking e cybersecurity per la challenge **Consorzio Clara (Cisco Networking Academy)**.
JRPG a turni giocabile nel browser: le unità del **blue team** (difese) combattono contro le minacce del **red team** (attacchi).

Online: https://robertodisanto.it/hackathon_2026_a/jrpg/

## Base di partenza

Fork del codice di [Monster Tamer](https://github.com/devshareacademy/monster-tamer) (Dev Share Academy, licenza MIT, vedi `LICENSE`).
Il README originale con i crediti degli asset è in [`README.upstream.md`](README.upstream.md).

Differenze rispetto all'originale:
- asset grafici e audio inclusi nella repo (l'originale li scarica da uno zip separato), musica convertita da WAV a MP3;
- `Ignivolt.png` rinominato in `ignivolt.png` (su Linux/GitHub Pages i nomi dei file distinguono maiuscole e minuscole);
- chiave di salvataggio in `localStorage` rinominata in `CYBER_JRPG_DATA`;
- nomi di mostri e mosse a tema cyber (`assets/data/monsters.json`, `assets/data/attacks.json`).

## Avvio in locale

Non c'è build: serve solo un server web statico, avviato dalla **root della repo**:

```bash
python3 -m http.server 8000
```

Poi apri http://localhost:8000/jrpg/

Phaser 3.60 e webfontloader sono caricati da CDN in `index.html`.

Comandi: frecce per muoversi e scegliere, Spazio per confermare, Shift per tornare indietro, Invio per il menu.

## Dove mettere le mani

- `assets/data/*.json`: contenuti del gioco (mostri, mosse, NPC e dialoghi, incontri, oggetti, eventi). La maggior parte del tema cyber si fa qui.
- `assets/data/main_1.json` e simili: mappe Tiled.
- `src/scenes/battle-scene.js`: macchina a stati della battaglia.
- `src/battle/attacks/`: animazioni delle mosse. Ogni mossa in `attacks.json` usa una delle animazioni esistenti (`ICE_SHARD`, `SLASH`).
- `src/scenes/preload-scene.js`: caricamento di tutti gli asset.

## Asset di terze parti

Alcuni asset (personaggi AxulArt, NPC Parabellum Games, effetti Pimen, musica xDeviruchi, suoni leohpaz) hanno licenze che ne permettono l'uso nei giochi ma **non la ridistribuzione**. Vanno bene per il prototipo; per la consegna è meglio sostituirli con asset CC0 (es. [Kenney](https://www.kenney.nl/assets)) o con asset nostri.
