// Online payments through Flutterwave: cards and Mobile Money (MTN / Airtel Rwanda) on Flutterwave's own secure page.
// Saligue never sees card numbers. Switch it on with environment variables or `node server/admin.mjs payments …`:
//   FLW_SECRET_KEY   secret key from the Flutterwave dashboard (Settings → API keys)
//   FLW_SECRET_HASH  the "secret hash" set under Settings → Webhooks (webhook URL: <site>/api/payments/webhook)
//   PAY_CURRENCY     currency charged, e.g. RWF (default) or USD
//   PAY_RATE         how many units of that currency one listed dollar is worth (e.g. 1450 for RWF; 1 for USD)
// Without a secret key, checkout offers Mobile Money to the shop, cash on delivery and pickup only.
import { timingSafeEqual } from 'node:crypto';
import { db, parse } from './db.mjs';

// FLW_API_URL only for tests against a stand-in server.
const API = (process.env.FLW_API_URL || 'https://api.flutterwave.com/v3').replace(/\/+$/, '');

export function paymentSettings() {
  const saved = parse(db.prepare("select value from app_config where key = 'payments'").get()?.value) ?? {};
  const currency = String(process.env.PAY_CURRENCY || saved.currency || 'RWF').toUpperCase();
  const rate = Number(process.env.PAY_RATE || saved.rate || (currency === 'USD' ? 1 : 0));
  return {
    secretKey: process.env.FLW_SECRET_KEY || saved.secretKey || null,
    secretHash: process.env.FLW_SECRET_HASH || saved.secretHash || null,
    currency,
    rate,
  };
}

/** Whether checkout can take payments online. A non-dollar currency also needs an exchange rate. */
export function paymentsEnabled() {
  const { secretKey, rate } = paymentSettings();
  return !!secretKey && rate > 0;
}

/** Converts a listed dollar amount into the charged currency (whole units for currencies without cents). */
export function toCharge(dollars) {
  const { currency, rate } = paymentSettings();
  const amount = dollars * rate;
  return ['RWF', 'UGX', 'XAF', 'XOF', 'TZS'].includes(currency) ? Math.ceil(amount) : Math.round(amount * 100) / 100;
}

async function flutterwave(path, options = {}) {
  const { secretKey } = paymentSettings();
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.status !== 'success') {
    throw Object.assign(new Error(data?.message || `Payment provider error (${response.status}).`), { status: 502 });
  }
  return data.data;
}

/** Starts a payment on Flutterwave's hosted page and returns the link to send the buyer to. */
export async function startCheckout({ txRef, amount, currency, redirectUrl, customer, title, logo }) {
  const methods = currency === 'RWF' ? 'card,mobilemoneyrwanda' : 'card';
  const data = await flutterwave('/payments', {
    method: 'POST',
    body: JSON.stringify({
      tx_ref: txRef,
      amount,
      currency,
      redirect_url: redirectUrl,
      payment_options: methods,
      customer: { email: customer.email, name: customer.name, phonenumber: customer.phone },
      customizations: { title, logo },
    }),
  });
  return data.link;
}

/** Asks Flutterwave whether a transaction really succeeded. Never trust the redirect or the webhook body alone. */
export async function verifyTransaction(transactionId) {
  const data = await flutterwave(`/transactions/${encodeURIComponent(transactionId)}/verify`);
  return { status: data.status, txRef: data.tx_ref, amount: Number(data.amount), currency: data.currency, id: String(data.id) };
}

/** Looks a transaction up by our own reference (used when the buyer comes back without a transaction id). */
export async function findByReference(txRef) {
  const data = await flutterwave(`/transactions/verify_by_reference?tx_ref=${encodeURIComponent(txRef)}`);
  return { status: data.status, txRef: data.tx_ref, amount: Number(data.amount), currency: data.currency, id: String(data.id) };
}

/** Webhook calls carry the secret hash we chose in the Flutterwave dashboard. */
export function webhookIsGenuine(header) {
  const { secretHash } = paymentSettings();
  if (!secretHash || !header) return false;
  const a = Buffer.from(String(header));
  const b = Buffer.from(secretHash);
  return a.length === b.length && timingSafeEqual(a, b);
}
