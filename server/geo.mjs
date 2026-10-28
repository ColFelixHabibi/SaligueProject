// Which country a visitor is in, from their internet address, using DB-IP's free "IP to Country Lite" database
// (https://db-ip.com, CC BY 4.0: "IP Geolocation by DB-IP"). The file lives on this server (data/geo/), so no
// visitor data is sent anywhere; a new edition is fetched once a month. Used for per-country features and
// "near you" recommendations. Countries are ISO codes ("RW", "KE"…); null when unknown (e.g. a local address).
import { createReadStream, existsSync, mkdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import { DATA_DIR } from './db.mjs';

const DIR = join(DATA_DIR, 'geo');
const FILE = join(DIR, 'dbip-country-lite.csv.gz');
mkdirSync(DIR, { recursive: true });

let v4 = { from: new Uint32Array(0), to: new Uint32Array(0), cc: new Uint16Array(0) };
let v6 = { from: new BigUint64Array(0), to: new BigUint64Array(0), cc: new Uint16Array(0) };
const codes = [];
const codeIndex = new Map();
const indexOf = (cc) => {
  if (!codeIndex.has(cc)) {
    codeIndex.set(cc, codes.length);
    codes.push(cc);
  }
  return codeIndex.get(cc);
};

const v4num = (ip) => {
  const p = ip.split('.');
  return p.length === 4 ? ((+p[0] << 24) >>> 0) + (+p[1] << 16) + (+p[2] << 8) + +p[3] : null;
};
// The first 64 bits of an IPv6 address (enough: country ranges are never smaller than a /64).
function v6num(ip) {
  let parts = ip.split('::');
  const head = parts[0] ? parts[0].split(':') : [];
  const tail = parts.length > 1 && parts[1] ? parts[1].split(':') : [];
  const groups = [...head, ...Array(Math.max(0, 8 - head.length - tail.length)).fill('0'), ...tail];
  if (groups.length !== 8) return null;
  let n = 0n;
  for (const g of groups.slice(0, 4)) n = (n << 16n) + BigInt(parseInt(g || '0', 16) || 0);
  return n;
}

async function load() {
  if (!existsSync(FILE)) return;
  const a = { from: [], to: [], cc: [] };
  const b = { from: [], to: [], cc: [] };
  const lines = createInterface({ input: createReadStream(FILE).pipe(createGunzip()), crlfDelay: Infinity });
  for await (const line of lines) {
    const [start, end, cc] = line.split(',');
    if (!cc || cc === 'ZZ') continue;
    if (start.includes(':')) {
      const s = v6num(start), e = v6num(end);
      if (s == null || e == null) continue;
      b.from.push(s); b.to.push(e); b.cc.push(indexOf(cc));
    } else {
      const s = v4num(start), e = v4num(end);
      if (s == null || e == null) continue;
      a.from.push(s); a.to.push(e); a.cc.push(indexOf(cc));
    }
  }
  v4 = { from: Uint32Array.from(a.from), to: Uint32Array.from(a.to), cc: Uint16Array.from(a.cc) };
  v6 = { from: BigUint64Array.from(b.from), to: BigUint64Array.from(b.to), cc: Uint16Array.from(b.cc) };
  console.log(`Countries: ${v4.from.length.toLocaleString()} IPv4 and ${v6.from.length.toLocaleString()} IPv6 ranges loaded (DB-IP).`);
}

function search(table, n) {
  let lo = 0, hi = table.from.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (n < table.from[mid]) hi = mid - 1;
    else if (n > table.to[mid]) lo = mid + 1;
    else return codes[table.cc[mid]];
  }
  return null;
}

/** ISO country code for an IP address, or null. */
export function countryOfIp(ip) {
  if (!ip) return null;
  const clean = ip.replace(/^::ffff:/, '');
  if (clean.includes(':')) {
    const n = v6num(clean);
    return n == null ? null : search(v6, n);
  }
  const n = v4num(clean);
  return n == null ? null : search(v4, n);
}

// A new edition each month (DB-IP publishes on the 1st).
async function refresh() {
  const age = existsSync(FILE) ? Date.now() - statSync(FILE).mtimeMs : Infinity;
  if (age < 32 * 86_400_000) return;
  const month = new Date().toISOString().slice(0, 7);
  try {
    const r = await fetch(`https://download.db-ip.com/free/dbip-country-lite-${month}.csv.gz`, { signal: AbortSignal.timeout(120_000) });
    if (!r.ok) return;
    writeFileSync(`${FILE}.new`, Buffer.from(await r.arrayBuffer()));
    renameSync(`${FILE}.new`, FILE);
    await load();
  } catch (error) {
    console.error('Country database not refreshed:', error.message);
  }
}

void load().then(refresh).catch((error) => console.error('Country database not loaded:', error.message));
setInterval(() => void refresh(), 86_400_000).unref();
