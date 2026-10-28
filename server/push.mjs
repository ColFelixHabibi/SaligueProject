// Push notifications to phones and computers, for Saligue's in-app notifications (see notify() in index.mjs):
// - Web push (Chrome, Edge, Firefox, Android browsers, the installed web app): standard VAPID keys that Saligue
//   makes once and keeps in app_config 'vapid'. No outside account needed.
// - The Android app (Capacitor): Firebase Cloud Messaging. Off until a Firebase service account is given:
//   FCM_SERVICE_ACCOUNT=/etc/saligue/fcm.json in /etc/saligue.env (and android/app/google-services.json in the app).
import { createSign } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import webpush from 'web-push';
import { db, json, now, parse } from './db.mjs';

function vapid() {
  let keys = parse(db.prepare("select value from app_config where key = 'vapid'").get()?.value);
  if (!keys?.publicKey) {
    keys = webpush.generateVAPIDKeys();
    db.prepare("insert into app_config (key, value) values ('vapid', ?) on conflict (key) do update set value = excluded.value").run(json(keys));
  }
  return keys;
}
export const webPushKey = () => vapid().publicKey;

// Firebase: the service account signs a short-lived token (RS256), kept until a few minutes before it expires.
let fcmAccount;
function fcm() {
  if (fcmAccount === undefined) {
    const file = process.env.FCM_SERVICE_ACCOUNT;
    try {
      fcmAccount = file && existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
    } catch (error) {
      console.error('FCM service account could not be read:', error.message);
      fcmAccount = null;
    }
  }
  return fcmAccount;
}
export const fcmReady = () => !!fcm();
let fcmToken = null;
async function fcmAccess() {
  if (fcmToken && fcmToken.until > Date.now()) return fcmToken.value;
  const a = fcm();
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const t = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: a.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: a.token_uri, iat: t, exp: t + 3600 })}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(a.private_key, 'base64url');
  const r = await fetch(a.token_uri, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }), signal: AbortSignal.timeout(15_000) });
  const data = await r.json();
  if (!data.access_token) throw new Error(`FCM sign-in failed: ${data.error ?? r.status}`);
  fcmToken = { value: data.access_token, until: Date.now() + (data.expires_in - 300) * 1000 };
  return fcmToken.value;
}

export function savePushTarget(userId, kind, target) {
  if (kind === 'web') {
    if (!target?.endpoint || !target?.keys?.p256dh || !target?.keys?.auth) throw new Error('Invalid subscription');
    db.prepare('insert into push_targets (target, user_id, kind, keys, created_at) values (?, ?, ?, ?, ?) on conflict (target) do update set user_id = excluded.user_id, keys = excluded.keys')
      .run(String(target.endpoint).slice(0, 1000), userId, 'web', json(target.keys), now());
  } else {
    const token = String(target ?? '').slice(0, 500);
    if (token.length < 20) throw new Error('Invalid token');
    db.prepare('insert into push_targets (target, user_id, kind, keys, created_at) values (?, ?, ?, null, ?) on conflict (target) do update set user_id = excluded.user_id')
      .run(token, userId, 'fcm', now());
  }
}
export const removePushTarget = (userId, target) => db.prepare('delete from push_targets where target = ? and user_id = ?').run(String(target ?? ''), userId);

// Calm by design: nothing buzzes at night (22:00–07:00 in Kigali, UTC+2) except orders and sales.
const quiet = (type) => {
  const hour = (new Date().getUTCHours() + 2) % 24;
  return (hour >= 22 || hour < 7) && !['order', 'sale'].includes(type);
};

/** Sends one notification to every device of a person. Never throws; dead devices are forgotten. */
export async function pushTo(userId, { title, body = '', link = '/', type = 'account', site = '' }) {
  if (quiet(type)) return;
  const targets = db.prepare('select * from push_targets where user_id = ?').all(userId);
  if (!targets.length) return;
  const url = link || '/';
  // One per kind of notification on the device (a newer one replaces the older), so phones don't fill up.
  const tag = `saligue-${type}`;
  for (const t of targets) {
    try {
      if (t.kind === 'web') {
        const k = vapid();
        await webpush.sendNotification({ endpoint: t.target, keys: parse(t.keys) }, JSON.stringify({ title, body, url, tag }), {
          vapidDetails: { subject: site || 'mailto:support@saligue.app', publicKey: k.publicKey, privateKey: k.privateKey },
          TTL: 24 * 3600,
          timeout: 15_000,
        });
      } else if (fcm()) {
        const r = await fetch(`https://fcm.googleapis.com/v1/projects/${fcm().project_id}/messages:send`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${await fcmAccess()}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: { token: t.target, notification: { title, body: body.slice(0, 200) }, data: { url }, android: { notification: { tag, color: '#E6007E' } } } }),
          signal: AbortSignal.timeout(15_000),
        });
        // 404: the app was removed or the token expired.
        if (r.status === 404) throw Object.assign(new Error('gone'), { statusCode: 410 });
        if (!r.ok) throw new Error(`FCM ${r.status}`);
      }
    } catch (error) {
      if ([404, 410].includes(error?.statusCode)) db.prepare('delete from push_targets where target = ?').run(t.target);
      else console.error(`Push to ${t.kind} failed:`, String(error?.message ?? error).slice(0, 160));
    }
  }
}
