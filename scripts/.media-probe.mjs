// A one-off check, not part of the app: what would the media sweep remove from data/media right now?
// Reads the database without changing it and prints the files nothing points at. Run: node scripts/.media-probe.mjs
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const data = process.argv[2] || 'data';
const media = join(data, 'media');
const db = new DatabaseSync(join(data, 'saligue.db'), { readOnly: true });

const columns = [];
const skipped = new Set();
for (const { name } of db.prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%'").all()) {
  for (const column of db.prepare('select name, type from pragma_table_info(?)').all(name)) {
    if (/blob/i.test(column.type)) skipped.add(`${name}.${column.name}:${column.type}`);
    else columns.push({ table: name, column: column.name });
  }
}

const inUse = new Set();
let scanned = 0;
for (const { table, column } of columns) {
  const rows = db.prepare(`select "${column}" as value from "${table}" where instr("${column}", '/media/') > 0`).all();
  scanned += rows.length;
  for (const row of rows) for (const found of String(row.value ?? '').matchAll(/\/media\/([A-Za-z0-9_.-]{1,120})/g)) inUse.add(found[1]);
}

const files = readdirSync(media);
const cutoff = Date.now() - 3_600_000;
const orphans = [];
let old = 0;
for (const name of files) {
  const info = statSync(join(media, name));
  if (!inUse.has(name) && info.isFile() && info.mtimeMs <= cutoff) orphans.push([name, info.size]);
  if (!inUse.has(name)) old += 1;
}
const bytes = orphans.reduce((sum, [, size]) => sum + size, 0);
console.log(`${files.length} files in ${media}, ${inUse.size} names found in ${scanned} referring row(s)`);
console.log(`${old} file(s) referenced nowhere; ${orphans.length} of them older than an hour (${(bytes / 1048576).toFixed(1)} MB) would go now:`);
for (const [name, size] of orphans.slice(0, 40)) console.log(`  ${name}  ${size} bytes`);
if (orphans.length > 40) console.log(`  … and ${orphans.length - 40} more`);
const missing = [...inUse].filter((name) => !files.includes(name));
if (missing.length) console.log(`NOTE: ${missing.length} name(s) in the database have no file (already gone): ${missing.slice(0, 5).join(', ')}`);
// Printed last, so it survives a short tail: every column the scan did NOT read.
console.log(`${columns.length} column(s) read; blobs skipped: ${[...skipped].join(', ') || 'none'}`);
db.close();
