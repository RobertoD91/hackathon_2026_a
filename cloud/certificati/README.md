# Certificati HTTPS di twinciro.robertodisanto.it, leggibili senza root

Sul server `twinciro.robertodisanto.it` il team **non ha root**. Il certificato Let's Encrypt lo rilascia l'amministratore con certbot, in `/etc/letsencrypt/`, dove la chiave privata è leggibile solo da root. Serve una copia leggibile dall'utente che lancia `docker compose` (e da altri utenti non root, se servono).

[`copia-certificati.sh`](copia-certificati.sh) è un **hook di certbot**. A ogni rilascio o rinnovo copia `fullchain.pem` e `privkey.pem` in `/srv/certificati/twinciro.robertodisanto.it/`:

| File | Permessi | Chi lo legge |
|---|---|---|
| `fullchain.pem` | 0644 `UTENTE:certificati` | tutti (è pubblico) |
| `privkey.pem` | 0640 `UTENTE:certificati` | l'utente dei servizi Docker e chi è nel gruppo `certificati` |

I permessi di `/etc/letsencrypt` restano quelli di certbot.

## Comandi per l'amministratore (root, una volta)

Sul server l'utente che usa Docker è **`openclaw`** (già impostato nello script). Aggiungi al gruppo anche gli altri utenti non root che devono leggere i certificati.

```bash
sudo groupadd -f certificati
sudo usermod -aG certificati openclaw
```

```bash
sudo curl -fsSL -o /etc/letsencrypt/renewal-hooks/deploy/twinciro-copia.sh \
  https://raw.githubusercontent.com/RobertoD91/hackathon_2026_a/master/cloud/certificati/copia-certificati.sh
```

```bash
sudo chmod 755 /etc/letsencrypt/renewal-hooks/deploy/twinciro-copia.sh
```

Prima copia, subito (poi la rifà certbot a ogni rinnovo):

```bash
sudo /etc/letsencrypt/renewal-hooks/deploy/twinciro-copia.sh
```

Controllo:

```bash
ls -l /srv/certificati/twinciro.robertodisanto.it/
```

Il gruppo nuovo vale dal login successivo dell'utente (oppure con `newgrp certificati`). Lo script copia solo il certificato di `twinciro.robertodisanto.it`: certbot gli passa `RENEWED_DOMAINS` e gli altri certificati del server li ignora. `certbot renew --dry-run` non lancia gli hook di tipo "deploy": per provarlo basta rilanciarlo a mano come sopra.

Se il certificato non c'è ancora:

```bash
sudo certbot certonly --standalone -d twinciro.robertodisanto.it
```

Serve la porta 80 libera; se c'è già un web server, usa `--webroot`.

## Chi li usa

- **API dati città in HTTPS** ([`../citta-api/`](../citta-api/README.md), profilo `https`): in `.env` `CITTA_CERTIFICATI_DIR=/srv/certificati/twinciro.robertodisanto.it`. nginx gira in un container e rilegge i certificati da solo ogni 12 ore.
- **Broker MQTT**, solo se un giorno si accende TLS ([`../mqtt/`](../mqtt/README.md); oggi MQTT è in chiaro): `MQTT_CERTIFICATI=letsencrypt` e `LETSENCRYPT_DIR=/srv/certificati`.

Con Docker classico (demone di root) i container leggono la chiave anche se è di un altro utente. Con Docker rootless la legge perché `UTENTE` ne è il proprietario. Come sapere quale dei due c'è sul server:

```bash
docker info -f '{{.SecurityOptions}}'
```

Se compare `rootless`, è Docker rootless. In quel caso la porta 443 si può pubblicare solo se l'amministratore abbassa `net.ipv4.ip_unprivileged_port_start`; altrimenti si usa `CITTA_HTTPS_PORTA=8443`.
