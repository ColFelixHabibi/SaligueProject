// Emails from Saligue (welcome, orders, password reset).
// Sending needs an SMTP account, set with SMTP_URL / MAIL_FROM or `node server/admin.mjs mail <smtp url> [from]`,
// e.g. smtps://you%40gmail.com:APP_PASSWORD@smtp.gmail.com. Without one, emails are saved to data/outbox/ instead.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import nodemailer from 'nodemailer';
import { DATA_DIR, db, parse } from './db.mjs';

function settings() {
  const saved = parse(db.prepare("select value from app_config where key = 'mail'").get()?.value) ?? {};
  return {
    url: process.env.SMTP_URL || saved.url || null,
    from: process.env.MAIL_FROM || saved.from || 'Saligue by INDECIANA <no-reply@saligue.app>',
  };
}

/** Public address of the website, used in links inside emails (never taken from the request). */
export function siteUrl() {
  const saved = parse(db.prepare("select value from app_config where key = 'site'").get()?.value);
  return (process.env.SITE_URL || saved?.url || `http://localhost:${process.env.PORT || 8080}`).replace(/\/+$/, '');
}

let transport = null;
let transportUrl = null;

const escape = (text) => String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// One simple, branded layout for every email.
function html({ title, lines, button }) {
  return `<!doctype html><html><body style="margin:0;background:#f6f6f7;font-family:Arial,sans-serif;color:#1d1d1f">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border-radius:12px;overflow:hidden">
<tr><td style="background:#e21376;padding:18px 24px;color:#fff;font-size:20px;font-weight:bold">Saligue <span style="font-size:11px;letter-spacing:3px;font-weight:normal">BY INDECIANA</span></td></tr>
<tr><td style="padding:24px">
<h1 style="margin:0 0 12px;font-size:20px">${escape(title)}</h1>
${lines.map((l) => `<p style="margin:0 0 10px;line-height:1.5">${escape(l)}</p>`).join('')}
${button ? `<p style="margin:20px 0"><a href="${escape(button.url)}" style="background:#e21376;color:#fff;padding:12px 20px;border-radius:999px;text-decoration:none;font-weight:bold">${escape(button.label)}</a></p>` : ''}
</td></tr>
<tr><td style="padding:14px 24px;background:#fafafa;font-size:12px;color:#888">You get this email because you have a Saligue account. <a href="${siteUrl()}/privacy" style="color:#888">Privacy</a> · <a href="${siteUrl()}/terms" style="color:#888">Terms</a></td></tr>
</table></td></tr></table></body></html>`;
}

/**
 * Sends an email in the background; failures are logged, never shown to the person using the app.
 * `button.url` may be a path ("/orders"), which is turned into a full link to the website.
 */
export function sendEmail(to, { subject, title = subject, lines, button }) {
  if (!to || to.endsWith('@demo.saligue.app')) return;
  const link = button && { ...button, url: button.url.startsWith('/') ? `${siteUrl()}${button.url}` : button.url };
  const text = [title, '', ...lines, ...(link ? ['', `${link.label}: ${link.url}`] : [])].join('\n');
  const message = { from: settings().from, to, subject, text, html: html({ title, lines, button: link }) };

  const { url } = settings();
  if (!url) {
    // No mail account yet: keep the email so it can be read (e.g. to open a password reset link).
    const dir = join(DATA_DIR, 'outbox');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${to.replace(/[^\w@.-]/g, '_')}.txt`);
    writeFileSync(file, `To: ${to}\nSubject: ${subject}\n\n${text}\n`);
    console.log(`Email not sent (no mail account set up), saved to ${file}`);
    return;
  }
  if (!transport || transportUrl !== url) {
    transport = nodemailer.createTransport(url);
    transportUrl = url;
  }
  transport.sendMail(message).catch((error) => console.error(`Could not send email to ${to}:`, error.message));
}
