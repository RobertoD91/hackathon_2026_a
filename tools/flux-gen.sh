#!/bin/bash
# uso: gen.sh "<prompt>" out.png
H=https://black-forest-labs-flux-1-kontext-dev.hf.space
P=$(python3 -c 'import json,sys;print(json.dumps({"data":[None,sys.argv[1],0,True,2.5,28]}))' "$1")
ID=$(curl -s -X POST $H/gradio_api/call/infer -H 'Content-Type: application/json' -d "$P" | python3 -c 'import json,sys;print(json.load(sys.stdin)["event_id"])')
OUT=$(curl -s -N $H/gradio_api/call/infer/$ID)
echo "$OUT" | tail -3 | cut -c1-400
URL=$(echo "$OUT" | grep '^data:' | tail -1 | sed 's/^data: //' | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d[0]["url"])' 2>/dev/null)
[ -n "$URL" ] && curl -s -o "$2" "$URL" && file "$2"
