// A consistent copy of Saligue's database, made with VACUUM INTO while the app keeps running:
//   node server/backup.mjs        → /var/backups/saligue/saligue-YYYY-MM-DD.db (the last 14 days are kept)
// Meant to run every night (a systemd timer or cron job). Copy the backups off this server too.
// Restore: stop saligue, copy a backup over data/saligue.db (remove saligue.db-wal and -shm), start saligue.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DIR = process.env.SALIGUE_BACKUP_DIR || '/var/backups/saligue';
const KEEP = 14;
mkdirSync(DIR, { recursive: true });
const db = new DatabaseSync(join(resolve(process.env.SALIGUE_DATA || 'data'), 'saligue.db'), { readOnly: true });
const file = join(DIR, `saligue-${new Date().toISOString().slice(0, 10)}.db`);
try { unlinkSync(file); } catch { /* first backup today */ }
db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
db.close();
const old = readdirSync(DIR).filter((f) => /^saligue-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort().slice(0, -KEEP);
for (const f of old) unlinkSync(join(DIR, f));
console.log(`Backup saved: ${file}${old.length ? ` (removed ${old.length} old)` : ''}`);
