#!/usr/bin/env bash
# Moves Saligue to its own domain (e.g. saligue.rw) without breaking the phones already installed.
#
#   deploy/switch-domain.sh saligue.rw            → shows what would change, changes nothing
#   deploy/switch-domain.sh saligue.rw --apply    → does it
#
# Before: point two DNS "A" records at this server: <domain> and live.<domain>.
# What it does:
#   - Caddy serves the new domain AND the old address (installed apps have the old one built in; a redirect
#     would break their sign-ins and uploads), and the bare IP now forwards to the new domain.
#   - SITE_URL and LIVEKIT_URL in /etc/saligue.env, and LiveKit's TURN domain, move to the new domain.
#   - Every file is copied to <file>.bak-<time> first; Caddy's config is validated before it is reloaded.
# After: release a new app version (node scripts/build-app.mjs --apk) so new installs use the new domain.
# The old address can be dropped from the Caddyfile once no phone runs a version built before the switch.
set -euo pipefail

DOMAIN="${1:-}"
APPLY="${2:-}"
CADDY=/etc/caddy/Caddyfile
ENVF=/etc/saligue.env
LIVEKIT=/etc/livekit.yaml

if [[ ! "$DOMAIN" =~ ^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$ ]]; then
  echo "Usage: $0 <domain> [--apply]   (a domain like saligue.rw, lowercase, without https://)" >&2
  exit 1
fi

OLD_URL=$(grep -E '^SITE_URL=' "$ENVF" | head -1 | cut -d= -f2- | tr -d "\"' ")
OLD=${OLD_URL#https://}
OLD=${OLD%%/*}
[[ -n "$OLD" ]] || { echo "No SITE_URL in $ENVF." >&2; exit 1; }
[[ "$OLD" != "$DOMAIN" ]] || { echo "Saligue already runs on $DOMAIN." >&2; exit 1; }
IP=$(ip -4 route get 1.1.1.1 | grep -o 'src [0-9.]*' | cut -d' ' -f2)

# DNS first: Caddy can only get a certificate for a name that already points here.
ok=1
for name in "$DOMAIN" "live.$DOMAIN"; do
  got=$(getent ahostsv4 "$name" | awk '{print $1}' | sort -u | tr '\n' ' ' || true)
  if [[ " $got " == *" $IP "* ]]; then echo "DNS  $name → $IP  ok"
  else echo "DNS  $name → ${got:-nothing}  (must be $IP: add an A record)"; ok=0; fi
done

echo
echo "Changes:"
echo "  $CADDY    serve $DOMAIN and $OLD; live.$DOMAIN and live.$OLD; http://$IP → https://$DOMAIN"
echo "  $ENVF     SITE_URL=https://$DOMAIN   LIVEKIT_URL=wss://live.$DOMAIN"
echo "  $LIVEKIT  turn domain: live.$DOMAIN"
echo "  then: caddy reload, livekit and saligue restart"

if [[ "$APPLY" != "--apply" ]]; then
  echo
  echo "Nothing changed. Run again with --apply$( ((ok)) || echo ' once the DNS records above are in place')."
  exit 0
fi
((ok)) || { echo "Stopping: fix the DNS records first, or Caddy cannot get certificates." >&2; exit 1; }

# Nobody should be cut off mid-live by the restart.
if curl -fsS "http://127.0.0.1:8080/api/lives" | grep -q '"status":"live"'; then
  echo "Someone is live right now. Run this again when the live has ended." >&2
  exit 1
fi

stamp=$(date -u +%Y%m%d-%H%M%S)
for f in "$CADDY" "$ENVF" "$LIVEKIT"; do cp -p "$f" "$f.bak-$stamp"; done
echo "Copies kept: *.bak-$stamp"
restore() {
  echo "Something failed: putting the old files back." >&2
  for f in "$CADDY" "$ENVF" "$LIVEKIT"; do cp -p "$f.bak-$stamp" "$f"; done
  systemctl reload caddy || true
}
trap restore ERR

esc() { printf '%s' "$1" | sed 's/[.]/\\./g'; }
O=$(esc "$OLD")
# Site and live blocks answer to both names; the bare-IP block forwards to the new one.
sed -i -E \
  -e "s/^${O} \{/${DOMAIN}, ${OLD} {/" \
  -e "s/^live\.${O} \{/live.${DOMAIN}, live.${OLD} {/" \
  -e "s#redir https://${O}\{uri\}#redir https://${DOMAIN}{uri}#" \
  "$CADDY"
sed -i -E \
  -e "s#^SITE_URL=.*#SITE_URL=https://${DOMAIN}#" \
  -e "s#^LIVEKIT_URL=.*#LIVEKIT_URL=wss://live.${DOMAIN}#" \
  "$ENVF"
sed -i -E "s/^(\s*domain:\s*)live\.${O}\s*$/\1live.${DOMAIN}/" "$LIVEKIT"

caddy validate --config "$CADDY" --adapter caddyfile >/dev/null
systemctl reload caddy
systemctl restart livekit
systemctl restart saligue
trap - ERR

sleep 3
for url in "https://$DOMAIN/api/app/version" "https://$OLD/api/app/version"; do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 "$url" || true)
  echo "check $url → $code"
done
echo
echo "Done. Next: release a new app version so new installs use $DOMAIN:"
echo "  sed -i 's/versionCode N/versionCode N+1/; ...' android/app/build.gradle && node scripts/build-app.mjs --apk"
echo "Keep $OLD in the Caddyfile until no phone runs a version built before today."
