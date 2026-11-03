# Server setup and releases

The site runs from this folder: `saligue.service` (`node server/index.mjs`) behind Caddy.

## Security (done on the live server 2026-11-03)
- `sh deploy/firewall.sh`: firewall (ufw); only SSH, web, and LiveKit are open.
- `apt install fail2ban && cp deploy/fail2ban/saligue.local /etc/fail2ban/jail.d/ && systemctl restart fail2ban`: bans SSH password guessers.
- Still to do: add your SSH key (`ssh-copy-id root@<server>` from your computer), check that it signs you in, then set
  `PasswordAuthentication no` and `PermitRootLogin prohibit-password` in /etc/ssh/sshd_config and run `systemctl reload ssh`.
  Keep one SSH window open while you test, and use Hetzner Cloud → Console if you get locked out.
- Admin → Security shows attacks, blocks and these server checks; alerts come by push and email.

## Release
1. `npm test`
2. `node server/backup.mjs` (a copy of the database before the release)
3. Raise `versionCode` / `versionName` in android/app/build.gradle (installed apps then offer the update)
4. `node scripts/build-app.mjs --apk`: builds the app into data/downloads and rebuilds the website (out/)
5. `systemctl restart saligue`, then check `curl -s localhost:8080/api/health` and `journalctl -u saligue -n 50`
6. Commit "Android app X (versionCode N)"
