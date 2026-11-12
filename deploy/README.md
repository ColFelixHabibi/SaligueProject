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
- **Log files stay out of the repository.** One-off shell probes and their captured output are ignored: dotfiles with
  an extension (`/.*.sh`, `/.*.txt`, `/.*.log`), every root name that starts with a dash (`/-*` — a mangled paste can
  leave the command itself behind as a filename, `-la | tail -n +2 | awk ...`), and the plain names seen so far
  (`/exit=0`, `/.modified`). One of them ran `git checkout server/index.mjs` and could undo a release. `.gitignore`
  stops these being committed, it does not delete them — and a name that starts with `-` is read as an option, so
  those need `rm -f -- ./-*`. Ignoring is only possible where the name is predictable: a mangled paste can leave a
  file called `k > .agent-probe.txt`, and step 6 (`git add -A`) would commit it. Read `git status --short` before
  step 6 instead of trusting the tree. Ignoring cannot help once
  one is committed — `.gitignore` only decides what is newly added — so it has to be taken back out by hand:
  `git rm -- 'h -c echo alive' 'k > .agent-probe.txt'` (the `--` matters for any name starting with `-`).
  `/.modified` was that case: an empty file a probe left behind, tracked in the index, so its ignore rule hid nothing
  on its own. It was taken out with `git rm --cached -- .modified` (commit `23dc051`) — `--cached`, because that empty
  file stays on disk, unlike the two above, whose files themselves had to go — and only from then on does the rule keep
  it out. To see which rule covers a name, without staging or deleting anything: `git check-ignore -v --no-index --
  -zzz './---locks---' 'exit=0'` prints the file and line of the rule that matches each one (exit 1 if none match).

## Release
1. `npm test`
2. `node server/backup.mjs` (a copy of the database before the release)
3. Raise `versionCode` / `versionName` in **four** files, or the update is never offered: android/app/build.gradle,
   both `CURRENT_PROJECT_VERSION` / `MARKETING_VERSION` pairs in ios/App/App.xcodeproj/project.pbxproj, the "Current
   build" line and the `.aab` filename in deploy/play-store.md, and the "Current build" line in deploy/ios.md.
   `tests/universallinks.test.mjs` reads the number out of android/app/build.gradle and refuses the other three if
   they disagree, so a half-done bump fails `npm test` — which is why step 1 is run again after this one.
4. `node scripts/build-app.mjs --apk`: builds the app into data/downloads and rebuilds the website (out/). This is
   also what writes data/downloads/saligue.json — `{versionCode, versionName, builtAt}`, read out of build.gradle and
   never edited by hand — and that file is the only thing a phone reads to decide an update exists. So a number
   raised here but never rebuilt is not a release: `tests/applinks.test.mjs` compares the two wherever an app has been
   built, which means `npm test` fails between step 3 and this one, on purpose, instead of shipping a version nobody
   is offered.
5. `systemctl restart saligue`, then check `curl -s localhost:8080/api/health` and `journalctl -u saligue -n 50`
6. Commit "Android app X (versionCode N)" — after step 4, never before: the commit has to describe an app that
   really exists in data/downloads. Read `git status --short` first (see the note above about probe files).
