# Server setup and releases

The site runs from this folder: `saligue.service` (`node server/index.mjs`) behind Caddy.

## Security (done on the live server 2026-11-03, hardened 2026-11-09)
- `sh deploy/firewall.sh`: firewall (ufw); only SSH, web, and LiveKit are open.
- `apt install fail2ban && cp deploy/fail2ban/saligue.local /etc/fail2ban/jail.d/ && systemctl restart fail2ban`: bans SSH password guessers.
- Still to do: add your SSH key (`ssh-copy-id root@<server>` from your computer), check that it signs you in, then set
  `PasswordAuthentication no` and `PermitRootLogin prohibit-password` in /etc/ssh/sshd_config and run `systemctl reload ssh`.
  Keep one SSH window open while you test, and use Hetzner Cloud → Console if you get locked out.
- Admin → Security shows attacks, blocks and these server checks; alerts come by push and email.

Hardened on 2026-11-09 (see `README.md` → "Accounts and security" for what each one protects):
- **Sessions are stored as a hash.** The `sessions` table keeps the SHA-256 of a token, never the token. Older rows
  keep working and are rewritten the first time they are used, so nobody was signed out by the change.
- **The unit is sandboxed.** `saligue.service` sets `NoNewPrivileges`, `ProtectSystem=full`, `ProtectHome=read-only`,
  `PrivateTmp`, `ProtectKernel*`, `RestrictSUIDSGID`, `RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6`,
  `LockPersonality`, `SystemCallArchitectures=native` and `UMask=0027`. It keeps root on purpose: Admin → Security
  reads the journal, `ufw` and `fail2ban` (`server/security.mjs`). Roll back with the copy in
  `/root/saligue.service.bak-*` if a future release needs a path the sandbox hides.
- **Permissions, not world-writable.** The project root, `data/` and `data/media` were `777`, and `.env.local` (the
  Supabase keys) and `data/saligue.db` were `666`. Everything is now `755` for directories and `644`/`600` for files,
  owned by root — so no other account on the box can read the keys or rewrite the code the service runs.
  `data/recordings` is left at `755` for the LiveKit egress container, which writes the replays there.
- **The bare IP is a redirect, not the site.** `http://78.47.151.100` → `https://78-47-151-100.sslip.io`, and the
  `https://78.47.151.100` server block was removed: a certificate for an address needs a challenge this box cannot
  answer (port 80 is unreachable from outside), so that block could never serve anything, and plain HTTP would have
  carried every password and token in the clear. Only the two real hostnames are ACME identifiers now.
- **Log files stay out of the repository.** One-off shell probes and their captured output (`/.*.sh`, `/.*.txt` at the
  root) are ignored; one of them ran `git checkout server/index.mjs` and could undo a release.

## Release
1. `npm test`
2. `node server/backup.mjs` (a copy of the database before the release)
3. Raise `versionCode` / `versionName` in android/app/build.gradle (installed apps then offer the update)
4. `node scripts/build-app.mjs --apk`: builds the app into data/downloads and rebuilds the website (out/)
5. `systemctl restart saligue`, then check `curl -s localhost:8080/api/health` and `journalctl -u saligue -n 50`
6. Commit "Android app X (versionCode N)"
