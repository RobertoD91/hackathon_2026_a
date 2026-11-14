#!/bin/sh
# Hook di certbot ("deploy"): a ogni rilascio o rinnovo del certificato copia fullchain.pem e
# privkey.pem in una cartella leggibile da chi gestisce i servizi Docker, SENZA cambiare i
# permessi di /etc/letsencrypt. Lo installa e lo lancia l'amministratore del server (root),
# una volta: istruzioni in cloud/certificati/README.md.
#
#   DEST/fullchain.pem   0644  UTENTE:GRUPPO
#   DEST/privkey.pem     0640  UTENTE:GRUPPO   (leggibile dal proprietario e dal gruppo)
#
# Modifica le tre righe qui sotto prima di installarlo.
set -eu
DOMINIO=twinciro.robertodisanto.it
UTENTE=openclaw            # l'utente che lancia docker compose sul server (twinciro.robertodisanto.it)
GRUPPO=certificati         # gli altri utenti non root che devono leggere i certificati
DEST=/srv/certificati/$DOMINIO

# certbot passa RENEWED_DOMAINS: se il rinnovo riguarda un altro certificato non faccio nulla.
# Lanciato a mano (senza RENEWED_DOMAINS) copia sempre.
case " ${RENEWED_DOMAINS:-$DOMINIO} " in
    *" $DOMINIO "*) ;;
    *) exit 0 ;;
esac
[ "$UTENTE" != CAMBIAMI ] || { echo "copia-certificati.sh: imposta UTENTE nello script" >&2; exit 1; }

SRC=/etc/letsencrypt/live/$DOMINIO
install -d -m 0755 "$(dirname "$DEST")"
install -d -m 0750 -o "$UTENTE" -g "$GRUPPO" "$DEST"
# Copia in un file temporaneo e poi rename: chi legge non vede mai un file a metà.
install -m 0644 -o "$UTENTE" -g "$GRUPPO" "$SRC/fullchain.pem" "$DEST/.fullchain.pem.nuovo"
install -m 0640 -o "$UTENTE" -g "$GRUPPO" "$SRC/privkey.pem" "$DEST/.privkey.pem.nuovo"
mv -f "$DEST/.fullchain.pem.nuovo" "$DEST/fullchain.pem"
mv -f "$DEST/.privkey.pem.nuovo" "$DEST/privkey.pem"
echo "copia-certificati.sh: certificati di $DOMINIO copiati in $DEST ($UTENTE:$GRUPPO)"
