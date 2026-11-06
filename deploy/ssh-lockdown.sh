#!/usr/bin/env bash
# Turns SSH password login off, so a guessed or leaked password can no longer open this server.
# It refuses to run until a key is installed, because without one you would lock yourself out.
#
# 1. On YOUR computer (once):   ssh-keygen -t ed25519          (press Enter for the defaults, set a passphrase)
#                               ssh-copy-id root@78.47.151.100  (asks for the root password one last time)
#    Windows PowerShell:        type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh root@78.47.151.100 "cat >> ~/.ssh/authorized_keys"
# 2. Check the key works: open a NEW terminal and run  ssh root@78.47.151.100  (it must not ask for the password).
# 3. On the server:             deploy/ssh-lockdown.sh --apply
# Keep the current session open until step 3 is checked: it is your way back if anything is wrong.
set -euo pipefail

KEYS=/root/.ssh/authorized_keys
CONF=/etc/ssh/sshd_config.d/10-saligue-keys-only.conf

n=$(grep -cE '^(ssh-(ed25519|rsa)|ecdsa-sha2-|sk-)' "$KEYS" 2>/dev/null || true)
if [[ "${n:-0}" -lt 1 ]]; then
  echo "No SSH key in $KEYS yet: turning passwords off now would lock you out."
  echo "Add your key first (see the top of this file), check you can log in with it, then run this again."
  exit 1
fi
echo "$n key(s) found in $KEYS."

if [[ "${1:-}" != "--apply" ]]; then
  echo "Would write $CONF (passwords off, root by key only) and reload SSH. Run with --apply."
  exit 0
fi

cat > "$CONF" <<'EOF'
# Saligue: keys only (deploy/ssh-lockdown.sh). Remove this file and reload ssh to allow passwords again.
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
EOF
# A broken config would stop SSH from starting: check it before reloading, and undo if it fails.
if ! sshd -t; then
  rm -f "$CONF"
  echo "SSH refused the new settings, so nothing changed." >&2
  exit 1
fi
systemctl reload ssh 2>/dev/null || systemctl reload sshd
sshd -T | grep -E '^(passwordauthentication|permitrootlogin)'
echo "Done. Check from a NEW terminal that  ssh root@78.47.151.100  still works before closing this one."
