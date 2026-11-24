// Where every sign-in and sign-in attempt came from, and whether it looks like the owner or somebody else.
//
// Each attempt is kept with the country of its address (geo.mjs, on this server), the kind of device, how it signed
// in and how it ended. A verdict is given at once, from the account's own history and from what that address has
// been doing across Saligue:
//   you         a sign-in, or a mistyped password, from a place and device this account has signed in from before
//   new_place   a sign-in that worked, from a country or device this account has never used (the owner is told)
//   suspicious  a wrong password from a place the account has never used
//   attacker    an address that is blocked, guesses on several accounts, tries email addresses that do not exist,
//               or keeps guessing on one account from somewhere new
// Owners see their own list (Account → Sign-in activity), admins see everyone's by country (Admin → Security).
// Kept 180 days.
import { db, now } from './db.mjs';

const MIN = 60_000;
const HOUR = 60 * MIN;
const KEEP_DAYS = 180;

db.exec(`
  create table if not exists sign_ins (
    id integer primary key autoincrement,
    user_id text,                 -- null when the email has no account
    email text not null default '',
    ip text,
    country text,
    device text not null default '',
    method text not null,         -- password | google
    outcome text not null,        -- ok | wrong_password | wrong_code | locked | suspended | no_account
    verdict text not null,        -- you | new_place | suspicious | attacker
    reason text not null default '',
    created_at text not null
  );
  create index if not exists sign_ins_user on sign_ins(user_id, created_at desc);
  create index if not exists sign_ins_ip on sign_ins(ip, created_at);
  create index if not exists sign_ins_time on sign_ins(created_at);
`);

let countryOf = () => null;
let tellOwner = () => {};
let isBlocked = () => false;
/** index.mjs connects how addresses become countries, how an owner is told, and which addresses are blocked. */
export function connectSignIns({ country, notify, blocked }) {
  if (country) countryOf = country;
  if (notify) tellOwner = notify;
  if (blocked) isBlocked = blocked;
}

/** "Android phone · Chrome", "iPhone · Saligue app", "Windows computer · Edge" — enough to recognise, never more. */
export function deviceOf(userAgent) {
  const ua = String(userAgent ?? '');
  if (!ua) return 'Unknown device';
  const app = /; wv\)|Capacitor/i.test(ua);
  const system = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android phone'
    : /Windows/.test(ua) ? 'Windows computer' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /CrOS/.test(ua) ? 'Chromebook'
    : /Linux/.test(ua) ? 'Linux computer' : /curl|python|wget|go-http|okhttp|axios|node-fetch|bot|spider/i.test(ua) ? 'Script or robot' : 'Unknown device';
  const browser = app ? 'Saligue app' : /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung Internet'
    : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
  return browser ? `${system} · ${browser}` : system;
}

const since = (ms) => new Date(Date.now() - ms).toISOString();
const count = (sql, ...args) => db.prepare(sql).get(...args).n;

/** Places this account signed in from successfully before (180 days): addresses, countries and devices. */
function knownPlaces(userId) {
  const rows = db.prepare("select ip, country, device from sign_ins where user_id = ? and outcome = 'ok' and created_at > ?").all(userId, since(KEEP_DAYS * 86_400_000));
  return { any: rows.length > 0, ips: new Set(rows.map((r) => r.ip)), countries: new Set(rows.map((r) => r.country)), devices: new Set(rows.map((r) => r.device)) };
}

/** The verdict on one attempt, with the reason in words (shown to admins and to the owner). */
export function judge({ userId, ip, country, device, outcome }) {
  // What this address has been doing across Saligue in the last hour.
  // Only real guesses count: a refused suspended account or a lock-out is not somebody guessing.
  const accountsTried = count("select count(distinct coalesce(user_id, email)) as n from sign_ins where ip = ? and outcome in ('wrong_password', 'no_account') and created_at > ?", ip, since(HOUR));
  const unknownTried = count("select count(*) as n from sign_ins where ip = ? and outcome = 'no_account' and created_at > ?", ip, since(HOUR));
  if (ip && isBlocked(ip)) return { verdict: 'attacker', reason: 'This address is blocked for attacking Saligue' };
  if (outcome === 'no_account') {
    return unknownTried >= 2 ? { verdict: 'attacker', reason: 'Trying email addresses that have no account' } : { verdict: 'suspicious', reason: 'No account has this email' };
  }
  const places = userId ? knownPlaces(userId) : { any: false, ips: new Set(), countries: new Set(), devices: new Set() };
  const knownHere = places.ips.has(ip) || (places.countries.has(country) && places.devices.has(device));
  if (outcome === 'ok') {
    if (!places.any || knownHere) return { verdict: 'you', reason: places.any ? 'A place this account uses' : 'First sign-in on record' };
    return { verdict: 'new_place', reason: !places.countries.has(country) ? 'A country this account has never signed in from' : 'A device this account has never used' };
  }
  // A wrong password (or a locked or suspended account). The owner's own device at an address or country they use
  // is the owner first: on a phone network many people share one address, and others' guessing there is not theirs.
  const misses = count("select count(*) as n from sign_ins where user_id = ? and outcome != 'ok' and created_at > ?", userId, since(HOUR));
  const ownerHere = places.devices.has(device) && (places.ips.has(ip) || (!!country && places.countries.has(country)));
  if (ownerHere && misses < 5) return { verdict: 'you', reason: 'Mistyped on a device and in a place this account uses' };
  if (accountsTried >= 3) return { verdict: 'attacker', reason: `Guessing passwords on ${accountsTried} accounts from one address` };
  if (misses >= 8) return { verdict: 'attacker', reason: `${misses + 1} wrong passwords in an hour` };
  return { verdict: 'suspicious', reason: places.any ? 'A wrong password from a place this account never used' : 'A wrong password on an account with no sign-in history' };
}

// The owner is told at most once a day that someone else is trying, so an attack does not become spam as well.
const warned = new Map();

/** Records one attempt, judges it, and tells the owner when it is news to them. Returns the verdict. */
export function recordSignIn({ userId = null, email = '', ip = null, userAgent = '', method = 'password', outcome }) {
  const country = ip ? countryOf(ip) : null;
  const device = deviceOf(userAgent);
  const { verdict, reason } = judge({ userId, ip, country, device, outcome });
  db.prepare('insert into sign_ins (user_id, email, ip, country, device, method, outcome, verdict, reason, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(userId, String(email).slice(0, 120), ip, country, device, method, outcome, verdict, reason, now());
  if (!userId) return verdict;
  const place = `${country ? countryName(country) : 'an unknown place'} on ${device === 'Unknown device' ? 'an unknown device' : `a ${device}`}`;
  if (verdict === 'new_place') {
    tellOwner(userId, {
      title: 'New sign-in to your Saligue account',
      body: `From ${place}. If this was you, nothing to do. If not, change your password and sign out everywhere in Account → Sign-in activity.`,
    });
  } else if ((verdict === 'suspicious' || verdict === 'attacker') && Date.now() - (warned.get(userId) ?? 0) > 24 * HOUR) {
    const tries = count("select count(*) as n from sign_ins where user_id = ? and verdict in ('suspicious', 'attacker') and created_at > ?", userId, since(HOUR));
    if (tries >= 3) {
      warned.set(userId, Date.now());
      if (warned.size > 50_000) warned.clear();
      tellOwner(userId, {
        title: 'Someone tried to sign in to your account',
        body: `${tries} wrong passwords from ${place}. They did not get in. If it was not you, choose a stronger password.`,
      });
    }
  }
  return verdict;
}

const names = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames(['en'], { type: 'region' }) : null;
export function countryName(code) {
  try {
    return (code && names?.of(code)) || code || 'Unknown';
  } catch {
    return code || 'Unknown';
  }
}

const out = (r) => ({ id: r.id, at: r.created_at, country: r.country, place: r.country ? countryName(r.country) : null, device: r.device, method: r.method, outcome: r.outcome, verdict: r.verdict, reason: r.reason });

/** One account's own sign-ins and attempts, newest first (no addresses: they are not the owner's business either). */
export function signInsOf(userId, limit = 40) {
  return db.prepare('select * from sign_ins where user_id = ? order by id desc limit ?').all(userId, limit).map(out);
}

/** Admin → Security: the last week, by country and verdict, and the latest attempts with their addresses. */
export function signInOverview(verdict = null) {
  const week = since(7 * 86_400_000);
  const byCountry = db.prepare('select country, verdict, count(*) as n from sign_ins where created_at > ? group by country, verdict').all(week);
  const countries = new Map();
  for (const r of byCountry) {
    const c = countries.get(r.country) ?? { country: r.country, place: r.country ? countryName(r.country) : 'Unknown', you: 0, new_place: 0, suspicious: 0, attacker: 0 };
    c[r.verdict] = r.n;
    countries.set(r.country, c);
  }
  const latest = (verdict
    ? db.prepare('select s.*, u.email as account from sign_ins s left join users u on u.id = s.user_id where s.verdict = ? order by s.id desc limit 100').all(verdict)
    : db.prepare('select s.*, u.email as account from sign_ins s left join users u on u.id = s.user_id order by s.id desc limit 100').all())
    .map((r) => ({ ...out(r), ip: r.ip, account: r.account ?? r.email }));
  const totals = { you: 0, new_place: 0, suspicious: 0, attacker: 0 };
  for (const c of countries.values()) for (const k of Object.keys(totals)) totals[k] += c[k];
  return {
    totals,
    countries: [...countries.values()].sort((a, b) => b.attacker + b.suspicious - (a.attacker + a.suspicious) || b.you - a.you),
    latest,
  };
}

const tidy = () => db.prepare('delete from sign_ins where created_at < ?').run(since(KEEP_DAYS * 86_400_000));
tidy();
setInterval(tidy, 24 * HOUR).unref();
