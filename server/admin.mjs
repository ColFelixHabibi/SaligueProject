// Small admin tool for the Saligue database.
//   node server/admin.mjs official <email>      mark an account as INDECIANA (official)
//   node server/admin.mjs unofficial <email>    remove the official mark
//   node server/admin.mjs users                 list accounts
//   node server/admin.mjs support               list support requests
//   node server/admin.mjs google <client id>    switch on Google sign-in (OAuth web client ID)
//   node server/admin.mjs mail <smtp url> [from] send real emails, e.g. smtps://you%40gmail.com:APP_PASSWORD@smtp.gmail.com
//   node server/admin.mjs site <url>            the website's public address, used in links inside emails
//   node server/admin.mjs reports               reported items (hidden ones first)
//   node server/admin.mjs show <product id>     put a hidden item back after review (the AI learns look-alikes are fine)
//   node server/admin.mjs remove <product id>   remove a reported item as not fashion (the AI learns to refuse look-alikes)
//   node server/admin.mjs payments <secret key> <secret hash> [currency] [rate]
//                                               switch on online payments (Flutterwave), e.g. ... FLWSECK-xxx myhash RWF 1450
//   node server/admin.mjs payments off          switch online payments off
//   node server/admin.mjs testmail <email>      send a test email (shows whether the mail account works)
import { db } from './db.mjs';
import { learn } from './learn.mjs';
import { sendEmail } from './mail.mjs';

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
} else if (command === 'reports') {
  console.table(db.prepare(`select p.id, p.name, p.seller, p.hidden, count(r.user_id) as reports, group_concat(distinct r.reason) as reasons
    from reports r join products p on p.id = r.product_id group by p.id order by p.hidden desc, reports desc`).all());
} else if (command === 'remove') {
  // Here the second argument is a product id.
  const product = db.prepare('select id, name, embedding from products where id = ?').get(String(email ?? ''));
  if (!product) {
    console.error('No item with this id.');
    process.exit(1);
  }
  if (product.embedding) learn(JSON.parse(product.embedding), 'not_fashion', product.id);
  db.prepare('delete from products where id = ?').run(product.id);
  console.log(`Removed "${product.name}". Photos that look like it will be refused from now on.`);
} else if (command === 'show') {
  // Here the second argument is a product id.
  const shown = db.prepare('select embedding from products where id = ?').get(String(email ?? ''));
  if (shown?.embedding) learn(JSON.parse(shown.embedding), 'fashion', String(email));
  db.prepare('update products set hidden = 0 where id = ?').run(String(email ?? ''));
  db.prepare('delete from reports where product_id = ?').run(String(email ?? ''));
  console.log('The item is visible again and its reports are cleared.');
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
} else if (command === 'payments') {
  const [secretKey, secretHash, currency = 'RWF', rate] = process.argv.slice(3);
  if (secretKey === 'off') {
    db.prepare("delete from app_config where key = 'payments'").run();
    console.log('Online payments are off. Checkout offers Mobile Money to the shop, cash on delivery and pickup.');
  } else if (!secretKey || !secretHash) {
    console.error('Usage: node server/admin.mjs payments <secret key> <secret hash> [currency] [rate]');
    process.exit(1);
  } else {
    const upper = currency.toUpperCase();
    const value = Number(rate || (upper === 'USD' ? 1 : 0));
    if (!(value > 0)) {
      console.error(`Give the exchange rate: how many ${upper} one listed dollar is worth, e.g. 1450.`);
      process.exit(1);
    }
    db.prepare("insert into app_config (key, value) values ('payments', ?) on conflict(key) do update set value = excluded.value")
      .run(JSON.stringify({ secretKey, secretHash, currency: upper, rate: value }));
    console.log(`Online payments are on (${upper}, 1 USD = ${value} ${upper}). Set the Flutterwave webhook URL to <your site>/api/payments/webhook with the same secret hash.`);
  }
} else if (command === 'testmail') {
  sendEmail(String(email ?? ''), { subject: 'Saligue test email', lines: ['If you can read this, Saligue can send emails.'] });
  setTimeout(() => process.exit(0), 8000);
} else {
  console.log('Usage: node server/admin.mjs official <email> | unofficial <email> | users | support | google <client id> | mail <smtp url> [from] | site <url> | reports | show <product id> | remove <product id> | payments <key> <hash> [currency] [rate] | payments off | testmail <email>');
}
