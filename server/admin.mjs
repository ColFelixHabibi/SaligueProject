// Small admin tool for the Saligue database.
//   node server/admin.mjs official <email>      mark an account as INDECIANA (official)
//   node server/admin.mjs unofficial <email>    remove the official mark
//   node server/admin.mjs users                 list accounts
//   node server/admin.mjs support               list support requests
//   node server/admin.mjs google <client id>    switch on Google sign-in (OAuth web client ID)
//   node server/admin.mjs mail <smtp url> [from] send real emails, e.g. smtps://you%40gmail.com:APP_PASSWORD@smtp.gmail.com
//   node server/admin.mjs site <url>            the website's public address, used in links inside emails
import { db } from './db.mjs';

const [command, email] = process.argv.slice(2);

if (command === 'official' || command === 'unofficial') {
  const flag = command === 'official' ? 1 : 0;
  const user = db.prepare('select id from users where email = ?').get(String(email ?? '').toLowerCase());
  if (!user) {
    console.error(`No account with the email ${email}.`);
    process.exit(1);
  }
  db.prepare('update users set official = ? where id = ?').run(flag, user.id);
  db.prepare('update products set official = ? where seller_id = ?').run(flag, user.id);
  console.log(`${email} is ${flag ? 'now' : 'no longer'} INDECIANA's official account.`);
} else if (command === 'users') {
  console.table(db.prepare('select email, display_name as name, role, official, created_at from users where is_guest = 0 order by created_at').all());
} else if (command === 'support') {
  console.table(db.prepare('select created_at, email, subject, message from support_requests order by created_at desc').all());
} else if (command === 'google') {
  // Here the second argument is the Google OAuth client ID, not an email.
  db.prepare("insert into app_config (key, value) values ('google', ?) on conflict(key) do update set value = excluded.value")
    .run(JSON.stringify({ clientId: String(email ?? '').trim() }));
  console.log('Google sign-in is switched on. Restart is not needed.');
} else if (command === 'mail' || command === 'site') {
  const value = String(email ?? '').trim();
  const config = command === 'mail' ? { url: value, from: process.argv[4] } : { url: value };
  db.prepare('insert into app_config (key, value) values (?, ?) on conflict(key) do update set value = excluded.value').run(command, JSON.stringify(config));
  console.log(command === 'mail' ? 'Emails will now be sent with this mail account.' : `Links in emails will point to ${value}.`);
} else {
  console.log('Usage: node server/admin.mjs official <email> | unofficial <email> | users | support | google <client id> | mail <smtp url> [from] | site <url>');
}
