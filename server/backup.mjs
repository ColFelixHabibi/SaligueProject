// A consistent copy of Saligue's database, made with VACUUM INTO while the app keeps running:
//   node server/backup.mjs        → /var/backups/saligue/saligue-YYYY-MM-DD.db (the last 14 days are kept)
// Meant to run every night (a systemd timer or cron job).
// Off this server: set SALIGUE_BACKUP_TARGET in /etc/saligue.env to an rsync destination, e.g.
//   SALIGUE_BACKUP_TARGET=backup@203.0.113.9:/srv/saligue      (another machine, over SSH with a key; no password)
//   SALIGUE_BACKUP_TARGET=/mnt/storagebox/saligue               (a mounted disk, e.g. a Hetzner Storage Box)
// Then each night copies the database backups AND the photos, videos, voice notes and uploads (media/, chat/,
// uploads/) there. A backup that stays on this disk is lost with it, and the database alone has no pictures.
// A failed copy makes the run fail (systemctl status saligue-backup shows it), never silently.
// Restore: stop saligue, copy a backup over data/saligue.db (remove saligue.db-wal and -shm), start saligue.
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DIR = process.env.SALIGUE_BACKUP_DIR || '/var/backups/saligue';
const KEEP = 14;
mkdirSync(DIR, { recursive: true });
const DATA = resolve(process.env.SALIGUE_DATA || 'data');
const db = new DatabaseSync(join(DATA, 'saligue.db'), { readOnly: true });
const file = join(DIR, `saligue-${new Date().toISOString().slice(0, 10)}.db`);
try { unlinkSync(file); } catch { /* first backup today */ }
db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
db.close();
const old = readdirSync(DIR).filter((f) => /^saligue-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort().slice(0, -KEEP);
for (const f of old) unlinkSync(join(DIR, f));
console.log(`Backup saved: ${file}${old.length ? ` (removed ${old.length} old)` : ''}`);

// The copy off this server.
const target = process.env.SALIGUE_BACKUP_TARGET?.trim().replace(/\/+$/, '');
if (target) {
  // Over SSH: key only (BatchMode, no password prompt to hang on), and a host it already trusts.
  const ssh = 'ssh -o BatchMode=yes -o ConnectTimeout=30';
  const rsync = (from, to) => execFileSync('rsync', ['-a', '--mkpath', '--timeout=600', '-e', ssh, from, to], { stdio: 'inherit' });
  try {
    // Kept like here: the last 14 nights (older ones go there too, so the far copy is not a growing pile).
    rsync(`${DIR}/`, `${target}/database/`);
    for (const dir of ['media', 'chat', 'uploads']) {
      if (existsSync(join(DATA, dir))) rsync(`${join(DATA, dir)}/`, `${target}/files/${dir}/`);
    }
    console.log(`Copied off this server: ${target} (database, media, chat, uploads)`);
  } catch (error) {
    console.error(`Backup NOT copied off this server (${target}): ${error.message}`);
    process.exit(1);
  }
} else {
  console.warn('Backup is on this server only. Set SALIGUE_BACKUP_TARGET in /etc/saligue.env to copy it elsewhere (see the top of server/backup.mjs).');
}
