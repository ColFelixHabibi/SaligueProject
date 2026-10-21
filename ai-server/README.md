# Saligue AI Studio — Saligue's own try-on AI

Draws clothes realistically on a shopper's photo with **Leffa** (MIT licence, commercial use allowed), on a server
you own. No daily limit, no outside AI company. Saligue uses it first for every try-on once it is connected.

## What you need

A server with an **NVIDIA GPU, 16 GB or more** (24 GB recommended) and Ubuntu 22.04 or 24.04 —
for example a Hetzner **GEX44** (Dedicated → GPU). Each look takes about 10–20 seconds.

## Install (about 30 minutes)

On the GPU server, as root:

```bash
git clone <your Saligue repository> saligue && cd saligue/ai-server
SALIGUE_SERVER_IP=78.47.151.100 bash install.sh
```

If the script installs the NVIDIA driver, it asks you to `reboot`; run it again afterwards.
`SALIGUE_SERVER_IP` makes the firewall accept only your Saligue server.

At the end it prints an **address** and a **secret key**. Paste them in Saligue →
**Me → Platform settings → Own AI server** (or run `node server/admin.mjs aiserver <address> <key>` on the Saligue server).

## Day to day

- Status: `systemctl status saligue-ai` · logs: `journalctl -u saligue-ai -f`
- Health: `https://<address>/api/health` (shows the GPU and whether the models are loaded)
- Settings: `/etc/saligue-ai.env` (`STEPS` = quality vs speed, default 30)

Every request needs the secret key (`X-Saligue-Key`), so only Saligue can use the AI.
Shoppers' photos are used only to make the look and are not stored by the AI server.
