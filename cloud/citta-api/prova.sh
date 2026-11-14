#!/usr/bin/env bash
# Prova dell'API dati città in esecuzione: /salute, token, /citta/riassunto, /citta/luogo, fonti.
#   ./prova.sh                       usa .env di questa cartella (porta e token)
#   ./prova.sh https://host/percorso indirizzo diverso (es. dietro il reverse proxy)
set -euo pipefail
cd "$(dirname "$0")"

if [[ -f .env ]]; then
  # solo le due variabili che servono, senza eseguire il file
  CITTA_API_PORTA=$(grep -E '^CITTA_API_PORTA=' .env | tail -1 | cut -d= -f2- || true)
  CITTA_API_TOKEN=$(grep -E '^CITTA_API_TOKEN=' .env | tail -1 | cut -d= -f2- || true)
fi
BASE=${1:-http://127.0.0.1:${CITTA_API_PORTA:-8791}}
TOKEN=${CITTA_API_TOKEN:-}
AUTH=()
[[ -n "$TOKEN" ]] && AUTH=(-H "Authorization: Bearer $TOKEN")
ok=0
ko=0
prova() { # descrizione, codice atteso, curl...
  local desc=$1 atteso=$2
  shift 2
  local codice
  codice=$(curl -s -o /tmp/citta-api-prova.$$ -w '%{http_code}' --max-time 30 "$@" || echo 000)
  if [[ "$codice" == "$atteso" ]]; then
    echo "OK   $desc ($codice)"
    ok=$((ok + 1))
  else
    echo "ERRORE $desc: atteso $atteso, ricevuto $codice"
    head -c 300 /tmp/citta-api-prova.$$ 2>/dev/null; echo
    ko=$((ko + 1))
  fi
}

if [[ -n "$TOKEN" ]]; then echo "API: $BASE (token impostato)"; else echo "API: $BASE (senza token)"; fi
prova "/salute senza token" 200 "$BASE/salute"
cat /tmp/citta-api-prova.$$; echo
if [[ -n "$TOKEN" ]]; then
  prova "/citta/riassunto senza token rifiutato" 401 "$BASE/citta/riassunto"
fi
prova "/citta/riassunto" 200 "${AUTH[@]}" "$BASE/citta/riassunto?formato=testo"
echo "---"; cat /tmp/citta-api-prova.$$; echo "---"
prova "/citta/luogo?nome=castel dell'ovo" 200 "${AUTH[@]}" -G "$BASE/citta/luogo" --data-urlencode "nome=castel dell'ovo" --data-urlencode formato=testo
cat /tmp/citta-api-prova.$$; echo
prova "/citta/passaggi?stazione=toledo" 200 "${AUTH[@]}" "$BASE/citta/passaggi?stazione=toledo&formato=testo"
cat /tmp/citta-api-prova.$$; echo
prova "/citta/fonti" 200 "${AUTH[@]}" "$BASE/citta/fonti"
if grep -q '"in_pausa_fino":"' /tmp/citta-api-prova.$$; then echo "Nota: qualche fonte è in pausa dopo un 429 o errori ripetuti (vedi /citta/fonti, campo rete)."; fi
rm -f /tmp/citta-api-prova.$$
echo "Esito: $ok prove riuscite, $ko fallite"
[[ $ko -eq 0 ]]
