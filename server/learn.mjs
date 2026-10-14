// What Saligue's AI has learned from its own shop, in real time (no retraining, no outside service):
// - every listed item (photo fingerprint, category and type) teaches it how sellers name things;
// - every review decision (an item removed as not fashion, or put back) teaches it what to refuse or allow.
// The memory rebuilds itself whenever the database changes, including changes made by admin.mjs.
import { db, now, parse } from './db.mjs';

let listed = []; // { id, embedding, category, type }
let refused = []; // embeddings of items removed as not fashion
let allowed = []; // embeddings of reported items put back after review
let version = null;
let dirty = true;

function refresh() {
  const current = `${db.prepare('pragma data_version').get().data_version}:${db.prepare('select count(*) as n, max(created_at) as t from products').get().n}:${db.prepare('select count(*) as n from learned_examples').get().n}`;
  if (current === version && !dirty) return;
  version = current;
  dirty = false;
  listed = db.prepare("select id, embedding, category, type from products where hidden = 0 and status = 'active' and embedding is not null").all()
    .map((r) => ({ id: r.id, embedding: parse(r.embedding), category: r.category, type: r.type }))
    .filter((r) => Array.isArray(r.embedding));
  const examples = db.prepare('select embedding, label from learned_examples').all().map((r) => ({ embedding: parse(r.embedding), label: r.label }));
  refused = examples.filter((e) => e.label === 'not_fashion').map((e) => e.embedding);
  allowed = examples.filter((e) => e.label === 'fashion').map((e) => e.embedding);
}
/** Call after products change in this process (new listing, edit, hide, delete). */
export function productsChanged() {
  dirty = true;
}

const similarity = (a, b) => {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
};
const nearest = (embedding, list) => list.reduce((best, e) => Math.max(best, similarity(embedding, e)), -1);

/** A review decision: this picture is (not) fashion. Look-alike photos follow it from now on. */
export function learn(embedding, label, source) {
  if (!Array.isArray(embedding)) return;
  db.prepare('insert into learned_examples (embedding, label, source, created_at) values (?, ?, ?, ?)').run(JSON.stringify(embedding), label, source, now());
  dirty = true;
}

/**
 * What the shop's memory says about a photo: how close it is to refused and allowed items, and the
 * category and type that sellers gave the most similar items.
 */
export function recall(embedding, excludeId = null) {
  refresh();
  const neighbours = listed
    .filter((p) => p.id !== excludeId)
    .map((p) => ({ ...p, score: similarity(embedding, p.embedding) }))
    .filter((p) => p.score > 0.75)
    .sort((a, b) => b.score - a.score)
    .slice(0, 9);
  const votes = (key, items) => {
    const tally = new Map();
    for (const p of items) if (p[key]) tally.set(p[key], (tally.get(p[key]) ?? 0) + p.score);
    return [...tally].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  };
  const category = neighbours.length >= 2 ? votes('category', neighbours) : null;
  const type = category ? votes('type', neighbours.filter((p) => p.category === category)) : null;
  return {
    refused: refused.length ? nearest(embedding, refused) : -1,
    allowed: Math.max(allowed.length ? nearest(embedding, allowed) : -1, neighbours[0]?.score ?? -1),
    suggestion: category ? { category, type, from: neighbours.length } : null,
  };
}
