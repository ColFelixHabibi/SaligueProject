#!/bin/sh
# Saligue server firewall (ufw): only what Saligue needs is reachable from the internet.
# Run as root: sh deploy/firewall.sh      Check: ufw status verbose
# Everything else (e.g. 7890, the replay recorder's health check; Redis; LiveKit's API) stays closed.
set -e
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'SSH'
ufw allow 80/tcp comment 'web (Caddy)'
ufw allow 443/tcp comment 'web (Caddy)'
ufw allow 443/udp comment 'web HTTP/3 (Caddy)'
ufw allow 7881/tcp comment 'LiveKit RTC over TCP'
ufw allow 3478/udp comment 'LiveKit TURN'
ufw allow 50000:60000/udp comment 'LiveKit media'
ufw --force enable
