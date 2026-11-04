// Security watch: notices attacks on Saligue (website, app and the server itself), keeps a record, blocks clear
// attackers for a while, and tells the main admins at once by push and email. Admin → Security shows it all.
//
// What is watched:
//   login_failed / account_locked   password guessing on one account, or many accounts from one address
//   admin_login                     a sign-in to an admin account (alert when it comes from a new address)
//   admin_denied                    someone without the right calling admin functions
//   probe                           scanners looking for weak spots (/.env, /.git, wp-admin, .php…): Saligue has none
//   injection                       attack text in addresses or forms (SQL injection, scripts, path tricks)
//   flood                           far too many requests from one address
//   webhook_forged                  a fake "payment succeeded" call without Flutterwave's secret
//   signup_burst                    many new accounts from one address (fake accounts, Share & earn fraud)
//   reset_flood                     many password-reset requests from one address
//   admin_change                    admins added or their rights changed, platform settings (payments, email…) changed
//   ssh_login / ssh_failed          sign-ins and password guessing on the server itself (read from the system log)
//
// Alerts are limited (one per kind and address per hour, at most 30 an hour in all) so a big attack can't bury
// the admins' phones; everything is still recorded, and a daily summary says how the day went.
import { execFile, execFileSync } from 'node:child_process';
import { db, now } from './db.mjs';

const MIN = 60_000;
const HOUR = 60 * MIN;

let alertSink = () => {};
let countryOf = () => null;
/** index.mjs connects how alerts are sent (notify the main admins) and how addresses become countries. */
export function connectSecurity({ alert, country }) {
  alertSink = alert;
  if (country) countryOf = country;
}

// ---------------------------------------------------------------------------
// Recording and alerting
// ---------------------------------------------------------------------------

const lastAlert = new Map();
let alertsThisHour = [];
function alert(kind, ip, title, body, { always = false } = {}) {
  const key = `${kind}|${ip ?? ''}`;
  const t = Date.now();
  if (!always && t - (lastAlert.get(key) ?? 0) < HOUR) return false;
  alertsThisHour = alertsThisHour.filter((x) => x > t - HOUR);
  if (!always && alertsThisHour.length >= 30) return false;
  lastAlert.set(key, t);
  alertsThisHour.push(t);
  try {
    alertSink({ title, body });
  } catch (error) {
    console.error('Security alert not sent:', error);
  }
  db.prepare('update security_events set alerted = 1 where id = (select max(id) from security_events where kind = ? and coalesce(ip, \'\') = ?)').run(kind, ip ?? '');
  return true;
}

const recent = (kind, column, value, ms) =>
  db.prepare(`select count(*) as n from security_events where kind = ? and ${column} = ? and created_at > ?`).get(kind, value, new Date(Date.now() - ms).toISOString()).n;

/** Records one event. Returns its id. */
export function securityEvent(kind, { ip = null, userId = null, detail = '' } = {}) {
  const country = ip ? countryOf(ip) : null;
  return db.prepare('insert into security_events (kind, ip, country, user_id, detail, created_at) values (?, ?, ?, ?, ?, ?)')
    .run(kind, ip, country, userId, String(detail).slice(0, 300), now()).lastInsertRowid;
}
const where = (ip) => {
  if (!ip) return '';
  const c = countryOf(ip);
  return ` from ${ip}${c ? ` (${c})` : ''}`;
};

// ---------------------------------------------------------------------------
// Blocking addresses
// ---------------------------------------------------------------------------

const blockedCache = { at: 0, set: new Map() };
function blocked() {
  if (Date.now() - blockedCache.at > 30_000) {
    blockedCache.set = new Map(db.prepare('select ip, until from blocked_ips where until is null or until > ?').all(now()).map((r) => [r.ip, r.until]));
    blockedCache.at = Date.now();
  }
  return blockedCache.set;
}
export const isBlocked = (ip) => !!ip && blocked().has(ip);
/** Blocks an address for `hours` (null = until an admin lifts it). */
// The server's own address (Caddy in front, or a request that came without its real address) is never blocked:
// that would lock everyone out. It is still recorded.
const ownAddress = (ip) => /^(127\.|::1$|::ffff:127\.|localhost)/.test(ip);
export function blockIp(ip, hours, reason, by = 'Saligue') {
  if (!ip || ownAddress(ip)) return;
  const until = hours ? new Date(Date.now() + hours * HOUR).toISOString() : null;
  db.prepare('insert into blocked_ips (ip, reason, until, by, created_at) values (?, ?, ?, ?, ?) on conflict(ip) do update set reason = excluded.reason, until = excluded.until, by = excluded.by, created_at = excluded.created_at')
    .run(ip, String(reason).slice(0, 200), until, by, now());
  blockedCache.at = 0;
}
export function unblockIp(ip) {
  db.prepare('delete from blocked_ips where ip = ?').run(ip);
  blockedCache.at = 0;
}

// ---------------------------------------------------------------------------
// Detectors
// ---------------------------------------------------------------------------

// Paths only scanners ask for: Saligue has no PHP, WordPress, .env or .git on the web.
const PROBE = /(^|\/)(\.env|\.git|\.svn|\.aws|\.ssh|\.htaccess|wp-admin|wp-login|wp-content|wp-includes|xmlrpc\.php|phpmyadmin|pma|adminer|cgi-bin|vendor\/phpunit|actuator|server-status|config\.(json|yml|yaml|php)|backup\.(zip|sql|tar)|.*\.php\d?$|.*\.(asp|aspx|jsp|cgi)$|etc\/passwd|boaform|HNAP1|owa\/)/i;
// Attack text: SQL injection, script injection, path tricks, template and Log4Shell probes.
const INJECTION = /(\bunion\b[\s\S]{0,40}\bselect\b|\bselect\b[\s\S]{0,40}\bfrom\b[\s\S]{0,40}\b(users|sqlite_master|information_schema)\b|'\s*or\s*'?\d+'?\s*=\s*'?\d+|\bor\s+1\s*=\s*1\b|;\s*drop\s+table|<script[\s>]|javascript:|onerror\s*=|\.\.\/\.\.\/|%2e%2e%2f|\$\{jndi:|\{\{\s*7\s*\*\s*7\s*\}\})/i;

/** Every request: refused when the address is blocked; scanners and floods are noticed. Returns false to refuse. */
const perMinute = new Map();
let minuteStart = Date.now();
export function screenRequest(ip, path, query) {
  if (isBlocked(ip)) return false;
  if (Date.now() - minuteStart > MIN) {
    perMinute.clear();
    minuteStart = Date.now();
  }
  // Floods: counted on the API only (pictures and videos load many files at once). Phone networks put many
  // people behind one address, so the limit is high and the block short.
  if (path.startsWith('/api/')) {
    const n = (perMinute.get(ip) ?? 0) + 1;
    perMinute.set(ip, n);
    if (n === 1200) {
      securityEvent('flood', { ip, detail: `${n} requests in a minute` });
      blockIp(ip, 0.25, 'Too many requests (flood)');
      alert('flood', ip, 'Security: request flood blocked', `One address sent over 1,200 requests in a minute${where(ip)}. It is blocked for 15 minutes.`);
      return false;
    }
  }
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    // Badly encoded on purpose: check it as it is.
  }
  if (PROBE.test(decoded)) {
    securityEvent('probe', { ip, detail: path.slice(0, 200) });
    const n = recent('probe', 'ip', ip, 10 * MIN);
    if (n >= 30) {
      blockIp(ip, 24, 'Scanning for weak spots');
      alert('probe', ip, 'Security: a scanner was blocked', `An address looked for ${n} weak spots in 10 minutes${where(ip)} (for example ${path.slice(0, 80)}). Saligue has none of them. It is blocked for 24 hours.`);
    }
    return true;
  }
  if (query && INJECTION.test(safeDecode(query))) injection(ip, null, `query: ${query.slice(0, 150)}`);
  return true;
}
const safeDecode = (s) => {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch {
    return s;
  }
};

/** Checks the text sent in a form (all string values). */
export function screenBody(ip, userId, body) {
  if (!body || typeof body !== 'object') return;
  const texts = [];
  const walk = (v, depth = 0) => {
    if (depth > 3 || texts.length > 50) return;
    if (typeof v === 'string') {
      // Pictures and videos travel inline as data: URLs; they are not text.
      if (!v.startsWith('data:') && v.length < 5000) texts.push(v);
    } else if (v && typeof v === 'object') for (const x of Object.values(v)) walk(x, depth + 1);
  };
  walk(body);
  const hit = texts.find((t) => INJECTION.test(t));
  if (hit) injection(ip, userId, `form: ${hit.slice(0, 150)}`);
}
function injection(ip, userId, detail) {
  securityEvent('injection', { ip, userId, detail });
  const n = recent('injection', 'ip', ip, 10 * MIN);
  // Saligue's database calls never mix in visitors' text, so these fail; repeated ones are an attack.
  if (n >= 5) {
    blockIp(ip, 24, 'Attack text (injection attempts)');
    alert('injection', ip, 'Security: injection attempts blocked', `An address sent attack text ${n} times in 10 minutes${where(ip)}${userId ? ` (signed in as account ${userId.slice(0, 8)})` : ''}. They failed. It is blocked for 24 hours.`);
  } else if (n === 3) alert('injection', ip, 'Security: attack text received', `An address sent attack text 3 times${where(ip)}: ${detail.slice(0, 120)}. It had no effect.`);
}

export function loginFailed(ip, email, { admin = false } = {}) {
  securityEvent('login_failed', { ip, detail: email });
  if (admin && recent('login_failed', 'detail', email, 15 * MIN) >= 3) {
    alert('admin_login_failed', email, 'Security: someone is guessing an admin password', `${recent('login_failed', 'detail', email, 15 * MIN)} wrong passwords for the admin account ${email} in 15 minutes${where(ip)}. If this is not you, change the password now.`);
  }
  const byIp = recent('login_failed', 'ip', ip, 15 * MIN);
  if (byIp >= 40) {
    blockIp(ip, 6, 'Password guessing on many accounts');
    alert('login_failed', ip, 'Security: password guessing blocked', `${byIp} wrong passwords in 15 minutes${where(ip)}, on several accounts. The address is blocked for 6 hours.`);
  } else if (byIp === 20) alert('login_failed', ip, 'Security: many wrong passwords', `20 wrong passwords in 15 minutes${where(ip)}.`);
}
export function accountLocked(ip, email) {
  securityEvent('account_locked', { ip, detail: email });
  alert('account_locked', email, 'Security: an account was locked after wrong passwords', `10 wrong passwords for ${email} in 15 minutes${where(ip)}. Sign-in is paused for 15 minutes.`);
}

/** A successful sign-in to an admin account: alert when the address was never used by that admin before. */
export function adminSignedIn(ip, user) {
  const known = db.prepare("select 1 from security_events where kind = 'admin_login' and user_id = ? and ip = ? limit 1").get(user.id, ip);
  securityEvent('admin_login', { ip, userId: user.id, detail: user.email });
  if (!known) {
    alert('admin_login', `${user.id}|${ip}`, 'Security: admin sign-in from a new place', `${user.email} signed in${where(ip)}. If this was not you, change the password at once and remove unknown admins.`, { always: true });
  }
}

export function adminDenied(ip, userId, path) {
  securityEvent('admin_denied', { ip, userId, detail: path });
  const n = recent('admin_denied', 'ip', ip, 10 * MIN);
  if (n === 5) alert('admin_denied', ip, 'Security: someone is trying admin functions', `5 refused admin requests in 10 minutes${where(ip)}${userId ? ` by account ${userId.slice(0, 8)}` : ''}, e.g. ${path}.`);
  if (n >= 15) blockIp(ip, 6, 'Trying admin functions without the right');
}

export function webhookForged(ip) {
  securityEvent('webhook_forged', { ip, detail: 'payment webhook without the secret' });
  alert('webhook_forged', ip, 'Security: fake payment confirmation refused', `Someone sent a "payment succeeded" call without Flutterwave's secret${where(ip)}. It was refused; no order was marked paid. If it repeats, change the secret hash in Platform and in Flutterwave.`);
}

export function signedUp(ip) {
  const n = db.prepare("select count(*) as n from security_events where kind = 'signup' and ip = ? and created_at > ?").get(ip, new Date(Date.now() - HOUR).toISOString()).n;
  securityEvent('signup', { ip });
  if (n + 1 === 10) {
    securityEvent('signup_burst', { ip, detail: '10 accounts in an hour' });
    alert('signup_burst', ip, 'Security: many new accounts from one address', `10 accounts were created in an hour${where(ip)}. It may be a school or a phone network, or fake accounts (watch Share & earn and reviews from them).`);
  }
}

/** Someone starts chats with many people in a short time: how spam and scams look. */
export function chatSpam(ip, userId, n) {
  securityEvent('chat_spam', { ip, userId, detail: `${n} new chats in an hour` });
  alert('chat_spam', ip ?? userId, 'Security: someone is messaging many people', `An account started ${n} new chats in an hour${where(ip)} (account ${userId}). It was stopped for now; check Admin → Security and the account.`);
}

export function resetRequested(ip, email) {
  securityEvent('reset', { ip, detail: email });
  if (recent('reset', 'ip', ip, HOUR) === 10) alert('reset_flood', ip, 'Security: many password-reset requests', `10 password-reset requests in an hour${where(ip)}.`);
}

/** Admins added or changed, platform settings changed: always told, it's how a break-in takes hold. */
export function adminChange(ip, actorEmail, what) {
  securityEvent('admin_change', { ip, detail: `${actorEmail}: ${what}` });
  alert('admin_change', `${actorEmail}|${what}`, 'Security: admin change', `${actorEmail} ${what}${where(ip)}. If this was not planned, check Admin → Admins now.`, { always: true });
}

// ---------------------------------------------------------------------------
// The server itself: SSH sign-ins and password guessing, from the system log (Linux with systemd only).
// ---------------------------------------------------------------------------

let sshSince = new Date(Date.now() - 10 * MIN);
function readSsh() {
  const since = sshSince;
  sshSince = new Date();
  const stamp = since.toISOString().replace('T', ' ').slice(0, 19);
  execFile('journalctl', ['-u', 'ssh', '-u', 'sshd', '--since', stamp, '--utc', '--no-pager', '-o', 'cat'], { timeout: 20_000, maxBuffer: 20 * 1024 * 1024 }, (error, out) => {
    if (error || !out) return;
    const failed = new Map();
    for (const line of out.split('\n')) {
      const fail = /(?:Failed password|Invalid user|Failed publickey).* from ([\d.:a-f]+)/i.exec(line);
      if (fail) failed.set(fail[1], (failed.get(fail[1]) ?? 0) + 1);
      const ok = /Accepted (\w+) for (\S+) from ([\d.:a-f]+)/.exec(line);
      if (ok) {
        const [, method, who, ip] = ok;
        const known = db.prepare("select 1 from security_events where kind = 'ssh_login' and ip = ? and detail like ? limit 1").get(ip, `${who} %`);
        securityEvent('ssh_login', { ip, detail: `${who} by ${method}` });
        if (!known) alert('ssh_login', `${who}|${ip}`, 'Security: someone signed in to the server', `"${who}" signed in to the server by ${method}${where(ip)}, an address not seen before. If this was not you or your team, the server may be taken over: change the password at once.`, { always: true });
      }
    }
    if (failed.size) {
      const total = [...failed.values()].reduce((s, n) => s + n, 0);
      const top = [...failed].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([ip, n]) => `${ip} ×${n}`).join(', ');
      securityEvent('ssh_failed', { detail: `${total} failed sign-ins from ${failed.size} addresses: ${top}` });
    }
  });
}

// ---------------------------------------------------------------------------
// Admin → Security
// ---------------------------------------------------------------------------

export function securityOverview() {
  const since = new Date(Date.now() - 24 * HOUR).toISOString();
  const counts = Object.fromEntries(db.prepare('select kind, count(*) as n from security_events where created_at > ? group by kind').all(since).map((r) => [r.kind, r.n]));
  // SSH failures are stored as one summary line per check: add up their totals.
  const ssh = db.prepare("select detail from security_events where kind = 'ssh_failed' and created_at > ?").all(since).reduce((s, r) => s + (Number(/^(\d+)/.exec(r.detail)?.[1]) || 0), 0);
  return {
    last24h: { ...counts, ssh_failed_attempts: ssh },
    topAddresses: db.prepare("select ip, country, count(*) as n, group_concat(distinct kind) as kinds from security_events where created_at > ? and ip is not null and kind not in ('signup', 'admin_login', 'reset') group by ip order by n desc limit 10").all(since),
    events: db.prepare("select id, kind, ip, country, user_id, detail, alerted, created_at from security_events where kind != 'signup' order by id desc limit 200").all(),
    blocked: db.prepare('select * from blocked_ips where until is null or until > ? order by created_at desc').all(now()),
    server: serverChecks(),
  };
}

/** How the server itself is set up (Linux): the doors attackers try first. null when it can't be read. */
export function serverChecks() {
  const run = (cmd, args) => {
    try {
      return execFileSync(cmd, args, { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      return null;
    }
  };
  const sshd = run('sshd', ['-T']);
  const ufw = run('ufw', ['status']);
  const f2b = run('fail2ban-client', ['ping']);
  const opt = (name) => new RegExp(`^${name} (\\S+)`, 'm').exec(sshd ?? '')?.[1] ?? null;
  const checks = [];
  if (sshd) {
    checks.push({ key: 'ssh_password', ok: opt('passwordauthentication') === 'no', label: 'Server sign-in with SSH keys only (no passwords)', fix: 'Add your SSH key first, then set PasswordAuthentication no. Bots try passwords all day.' });
    checks.push({ key: 'ssh_root', ok: ['no', 'prohibit-password', 'without-password'].includes(opt('permitrootlogin') ?? ''), label: 'No password sign-in as root', fix: 'Set PermitRootLogin prohibit-password (keys only) once your key works.' });
  }
  if (ufw !== null) checks.push({ key: 'firewall', ok: /Status: active/.test(ufw), label: 'Firewall on (only web, LiveKit and SSH open)', fix: 'Turn on ufw allowing 22, 80, 443 and LiveKit’s ports.' });
  checks.push({ key: 'fail2ban', ok: f2b !== null && /pong/i.test(f2b), label: 'Password guessers on the server are banned automatically (fail2ban)', fix: 'Install fail2ban: addresses that guess wrong 5 times are banned.' });
  return checks;
}

/** Once a day: how the last 24 hours went, so quiet days are confirmed too. */
function dailySummary() {
  const s = securityOverview().last24h;
  const parts = [
    s.ssh_failed_attempts && `${s.ssh_failed_attempts.toLocaleString('en')} password guesses on the server (SSH)`,
    s.login_failed && `${s.login_failed} wrong passwords on Saligue`,
    s.probe && `${s.probe} scans for weak spots`,
    s.injection && `${s.injection} attack texts`,
    s.admin_denied && `${s.admin_denied} refused admin requests`,
    s.webhook_forged && `${s.webhook_forged} fake payment calls`,
    s.flood && `${s.flood} floods`,
  ].filter(Boolean);
  const blockedNow = db.prepare('select count(*) as n from blocked_ips where until is null or until > ?').get(now()).n;
  const weak = serverChecks().filter((c) => !c.ok).map((c) => c.label.toLowerCase());
  const server = weak.length ? ` Server still to fix: ${weak.join('; ')}.` : '';
  alert('daily', 'summary', 'Security: daily summary', (parts.length ? `Last 24 hours: ${parts.join(', ')}. ${blockedNow} address${blockedNow === 1 ? '' : 'es'} blocked now. All of them failed. Details: Admin → Security.` : 'Last 24 hours: no attacks noticed.') + server, { always: true });
}

export function startSecurityWatch() {
  readSsh();
  setInterval(readSsh, 5 * MIN).unref();
  // Old events go after 90 days; the summary is sent each morning (07:00 UTC = 09:00 in Kigali).
  setInterval(() => db.prepare('delete from security_events where created_at < ?').run(new Date(Date.now() - 90 * 24 * HOUR).toISOString()), 6 * HOUR).unref();
  const scheduleSummary = () => {
    const next = new Date();
    next.setUTCHours(7, 0, 0, 0);
    if (next <= new Date()) next.setUTCDate(next.getUTCDate() + 1);
    setTimeout(() => {
      dailySummary();
      scheduleSummary();
    }, next - Date.now()).unref();
  };
  scheduleSummary();
}
