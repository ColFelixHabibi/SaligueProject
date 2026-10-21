#!/usr/bin/env bash
# Installs Saligue AI Studio (realistic try-on with Leffa) on a fresh Ubuntu 22.04/24.04 server with an NVIDIA GPU,
# e.g. a Hetzner GEX44. Run as root on the GPU server:
#
#   curl -fsSL <this file> -o install.sh   (or copy the ai-server folder)   &&   bash install.sh
#
# Optional: SALIGUE_SERVER_IP=78.47.151.100 bash install.sh  → only Saligue's server may reach the AI (firewall).
# At the end it prints the address and the secret key to paste into Saligue → Platform settings → Own AI server.
set -euo pipefail

APP_DIR=/opt/saligue-ai
ENV_FILE=/etc/saligue-ai.env
SALIGUE_SERVER_IP="${SALIGUE_SERVER_IP:-}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

say() { printf '\n\033[1;35m== %s\033[0m\n' "$*"; }
[ "$(id -u)" = 0 ] || { echo "Run as root."; exit 1; }

say "1/7 Graphics card"
if ! command -v nvidia-smi >/dev/null || ! nvidia-smi >/dev/null 2>&1; then
  apt-get update -q && DEBIAN_FRONTEND=noninteractive apt-get install -y -q ubuntu-drivers-common
  ubuntu-drivers install
  echo "The NVIDIA driver was installed. Reboot (reboot), then run this script again."
  exit 0
fi
nvidia-smi --query-gpu=name,memory.total --format=csv,noheader
MEM=$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits | head -1)
[ "${MEM%%.*}" -ge 15000 ] || echo "Warning: the GPU has less than 16 GB; Leffa may run out of memory."

say "2/7 System packages"
DEBIAN_FRONTEND=noninteractive apt-get install -y -q python3-venv python3-dev git git-lfs build-essential libgl1 libglib2.0-0 caddy ufw curl

say "3/7 Saligue AI Studio code"
mkdir -p "$APP_DIR"
cp -r "$HERE"/server.py "$HERE"/setup_models.py "$HERE"/requirements.txt "$APP_DIR"/
cd "$APP_DIR"
[ -d venv ] || python3 -m venv venv
# shellcheck disable=SC1091
source venv/bin/activate
pip install -q --upgrade pip wheel

say "4/7 PyTorch with GPU support"
pip install -q torch torchvision --index-url https://download.pytorch.org/whl/cu124
python -c "import torch; assert torch.cuda.is_available(), 'PyTorch cannot see the GPU'; print('GPU OK:', torch.cuda.get_device_name(0))"
pip install -q -r requirements.txt

say "5/7 Leffa and its models (about 15 GB, takes a while)"
LEFFA_DIR="$APP_DIR/Leffa" python setup_models.py
# Leffa's own Python packages (from its repository).
[ -f "$APP_DIR/Leffa/requirements.txt" ] && pip install -q -r "$APP_DIR/Leffa/requirements.txt" || true

say "6/7 Secret key and service"
if [ ! -f "$ENV_FILE" ]; then
  KEY=$(openssl rand -hex 32)
  cat > "$ENV_FILE" <<EOF
# Saligue AI Studio settings.
SALIGUE_AI_KEY=$KEY
LEFFA_DIR=$APP_DIR/Leffa
HOST=127.0.0.1
PORT=7860
STEPS=30
PRELOAD=1
STUDIO_PAGE=0
EOF
  chmod 600 "$ENV_FILE"
fi
cat > /etc/systemd/system/saligue-ai.service <<EOF
[Unit]
Description=Saligue AI Studio (realistic try-on)
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=$APP_DIR/venv/bin/python server.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now saligue-ai

say "7/7 HTTPS and firewall"
IP=$(curl -fsS4 https://api.ipify.org)
HOSTNAME_SSLIP="${IP//./-}.sslip.io"
cat > /etc/caddy/Caddyfile <<EOF
# Saligue AI Studio over HTTPS (certificate from Let's Encrypt, renewed automatically).
$HOSTNAME_SSLIP {
	request_body {
		max_size 20MB
	}
	reverse_proxy 127.0.0.1:7860 {
		transport http {
			read_timeout 180s
		}
	}
}
EOF
systemctl reload caddy || systemctl restart caddy
ufw allow 22/tcp >/dev/null
ufw allow 80/tcp >/dev/null
if [ -n "$SALIGUE_SERVER_IP" ]; then
  ufw allow from "$SALIGUE_SERVER_IP" to any port 443 proto tcp >/dev/null
else
  ufw allow 443/tcp >/dev/null
fi
ufw --force enable >/dev/null

echo "Waiting for the AI to load (first start takes a few minutes)…"
for _ in $(seq 1 120); do
  if curl -fsS "https://$HOSTNAME_SSLIP/api/health" 2>/dev/null | grep -q '"ready":true'; then break; fi
  sleep 10
done
curl -fsS "https://$HOSTNAME_SSLIP/api/health" || true

KEY=$(grep '^SALIGUE_AI_KEY=' "$ENV_FILE" | cut -d= -f2)
cat <<EOF

=====================================================================
 Saligue AI Studio is installed.

 Paste these in Saligue → Me → Platform settings → Own AI server:
   Address:     https://$HOSTNAME_SSLIP
   Secret key:  $KEY

 Or on the Saligue server:
   node server/admin.mjs aiserver https://$HOSTNAME_SSLIP $KEY
=====================================================================
EOF
