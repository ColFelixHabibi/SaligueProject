// What Saligue's AI learns from the people who use it.
//
// Nothing here trains a model: it is the memory around the models, and it is what makes them better every week:
//   * a description a seller keeps (or edits) becomes an example the writer follows next time — the seller's own
//     style first, the marketplace's style after that;
//   * every realistic look is counted against the AI that made it and the part of the body, and when shoppers keep
//     throwing a model's looks away, the next shopper tries that model later in the chain (server/tryon.mjs);
//   * tokens spent per account, model and purpose, so the cost is visible and a wrong key is noticed early.
// Three tables hold it (server/db.mjs): ai_feedback, ai_tryon_stats and ai_usage. The rules stay simple on purpose:
// a few clear counters that cannot go wrong, instead of a model that could learn the wrong thing.
import { randomUUID } from 'node:crypto';
import { db, json, now } from './db.mjs';

// ---------------------------------------------------------------------------
// Text: how close is what the AI wrote to what the seller actually kept?
// ---------------------------------------------------------------------------

/** The words that carry meaning in a description (numbers and one-letter words are noise here). */
const STOP = new Set(['the', 'and', 'for', 'with', 'are', 'you', 'your', 'our', 'his', 'her', 'its', 'this', 'that', 'from', 'was', 'has', 'have', 'not', 'but', 'all', 'any', 'can', 'new', 'very']);
function words(text) {
  return new Set(
    String(text ?? '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w))
  );
}

/**
 * How much of the AI's wording survived in what the person kept: 0 (rewritten from scratch) to 1 (kept as it was).
 * Jaccard over meaningful words, which treats a reorder or a small edit the way a person would.
 */
export function similarity(written, kept) {
  const a = words(written);
  const b = words(kept);
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared++;
  return shared / (a.size + b.size - shared);
}

// ---------------------------------------------------------------------------
// Writing: the AI remembers what sellers keep
// ---------------------------------------------------------------------------

/** One example may not be long enough to smuggle a whole set of instructions into the writer's prompt. */
const EXAMPLE_CHARS = 240;

/**
 * A description the AI wrote, before anyone has used it. `final` stays empty until the item is saved with a
 * description (see noteDescriptionUsed), which is how the AI finds out whether its words were actually kept.
 */
export function noteWritten({ userId, input, output, model = null }) {
  if (!userId || !output) return null;
  const id = randomUUID();
  db.prepare(`insert into ai_feedback (id, user_id, kind, signal, model, input, output, created_at)
    values (?, ?, 'write', 'written', ?, ?, ?, ?)`)
    .run(id, userId, model, json(input), String(output).slice(0, 1200), now());
  return id;
}

/**
 * The seller saved an item with this description: compare it with the newest AI description still waiting for an
 * answer. Kept word for word (score 1), lightly edited, or rewritten — all three teach the writer something.
 * Returns null when the seller wrote the words themselves, which is the common case and must cost nothing.
 */
export function noteDescriptionUsed(userId, text) {
  const kept = String(text ?? '').trim();
  if (!userId || kept.length < 20) return null;
  const since = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const waiting = db.prepare(`select id, output from ai_feedback
    where user_id = ? and kind = 'write' and final is null and created_at > ?
    order by created_at desc limit 1`).get(userId, since);
  if (!waiting) return null;
  const score = Math.round(similarity(waiting.output, kept) * 1000) / 1000;
  const signal = score >= 0.85 ? 'kept' : score >= 0.5 ? 'edited' : 'rewritten';
  db.prepare('update ai_feedback set final = ?, score = ?, signal = ? where id = ?').run(kept.slice(0, 1200), score, signal, waiting.id);
  return { signal, score };
}

/** One seller's kept descriptions, best first: the voice the writer should match for that shop. */
function keptExamples(userId, limit) {
  const rows = userId
    ? db.prepare(`select output from ai_feedback where user_id = ? and kind = 'write' and signal = 'kept'
        order by score desc, created_at desc limit ?`).all(userId, limit)
    : [];
  if (rows.length < limit) {
    rows.push(...db.prepare(`select output from ai_feedback where kind = 'write' and signal = 'kept'
      order by score desc, created_at desc limit ?`).all(limit));
  }
  const unique = new Set();
  for (const row of rows) {
    const text = String(row.output ?? '').replace(/\s+/g, ' ').trim();
    // Examples are data, never instructions: one line, no markup, and never long enough to smuggle a rule in.
    if (text.length >= 20) unique.add(text.slice(0, EXAMPLE_CHARS));
    if (unique.size >= limit) break;
  }
  return [...unique];
}

/** Descriptions that sellers kept, for the writer's prompt. Empty until the marketplace has taught it anything. */
export function writeExamples(userId, limit = 3) {
  return keptExamples(userId, Math.max(1, Math.min(5, limit)));
}

// ---------------------------------------------------------------------------
// Realistic try-on: which AI pleases shoppers
// ---------------------------------------------------------------------------

const ENGINES = ['own', 'fashn', 'free'];

/** A look was attempted (whether it worked or not), so the scoreboard knows how each AI is doing. */
export function noteTryOn({ engine, category, ok, ms = 0 }) {
  if (!ENGINES.includes(engine) || !category) return;
  db.prepare(`insert into ai_tryon_stats (engine, category, made, failed, kept, rejected, ms_total, updated_at)
    values (?, ?, ?, ?, 0, 0, ?, ?)
    on conflict (engine, category) do update set
      made = made + excluded.made, failed = failed + excluded.failed,
      ms_total = ms_total + excluded.ms_total, updated_at = excluded.updated_at`)
    .run(engine, category, ok ? 1 : 0, ok ? 0 : 1, Math.max(0, Math.round(ms)), now());
}

/**
 * A shopper kept a look or threw it away. This is the signal the whole engine chain learns from, so it is recorded
 * both on the scoreboard (counters only) and in ai_feedback (with the reason, for looking at later).
 */
export function noteLookFeedback({ userId = null, engine = null, category = null, kept = false, reason = null, detail = null }) {
  const by = ENGINES.includes(engine) ? engine : null;
  const slot = String(category ?? '').slice(0, 20) || null;
  if (by && slot) {
    const column = kept ? 'kept' : 'rejected';
    db.prepare(`insert into ai_tryon_stats (engine, category, made, failed, kept, rejected, ms_total, updated_at)
      values (?, ?, 0, 0, ?, ?, 0, ?)
      on conflict (engine, category) do update set ${column} = ${column} + 1, updated_at = excluded.updated_at`)
      .run(by, slot, kept ? 1 : 0, kept ? 0 : 1, now());
  }
  if (userId) {
    db.prepare(`insert into ai_feedback (id, user_id, kind, signal, engine, category, detail, created_at)
      values (?, ?, 'tryon', ?, ?, ?, ?, ?)`)
      .run(randomUUID(), userId, kept ? 'kept' : 'rejected', by, slot, json({ reason, ...(detail ?? {}) }), now());
  }
}

/** How often looks from this engine and category were kept, once there is enough evidence to mean anything. */
function keptRate(rows, engine, minimum = 8) {
  const row = rows.find((r) => r.engine === engine);
  const seen = (row?.kept ?? 0) + (row?.rejected ?? 0);
  return seen >= minimum ? row.kept / seen : null;
}

/**
 * The order the try-on chain should try the AIs in for this part of the body. The default is the honest one:
 * Saligue's own server, then the paid model, then the free public models — a free look is never preferred just
 * because it is free. The learned order only changes when shoppers have clearly kept the free models' looks
 * (70% or more, at least 8 looks) and clearly thrown the paid model's away (45% or less): then the free models
 * are tried first and the paid one still finishes the job if they cannot.
 */
export function tryOnOrder(category) {
  const rows = db.prepare('select engine, kept, rejected from ai_tryon_stats where category = ?').all(category);
  const free = keptRate(rows, 'free');
  const paid = keptRate(rows, 'fashn');
  return free !== null && paid !== null && free >= 0.7 && paid <= 0.45 ? ['own', 'free', 'fashn'] : ['own', 'fashn', 'free'];
}

// ---------------------------------------------------------------------------
// LLM cost
// ---------------------------------------------------------------------------

/** One call, counted per account, day, model and purpose (never the prompt itself). */
export function noteAiUsage({ userId, provider = 'deepseek', model = 'unknown', purpose = 'other', tokens = 0 }) {
  if (!userId) return;
  db.prepare(`insert into ai_usage (user_id, day, provider, model, purpose, calls, tokens, updated_at)
    values (?, ?, ?, ?, ?, 1, ?, ?)
    on conflict (user_id, day, provider, model, purpose) do update set
      calls = calls + 1, tokens = tokens + excluded.tokens, updated_at = excluded.updated_at`)
    .run(userId, new Date().toISOString().slice(0, 10), provider, String(model).slice(0, 60), String(purpose).slice(0, 30), Math.max(0, Math.round(Number(tokens) || 0)), now());
}

/** What AI has cost and learned over the last `days` days — for INDECIANA, never for shoppers. */
export function aiLearningSummary(days = 30) {
  const since = new Date(Date.now() - Math.max(1, days) * 86_400_000).toISOString();
  const feedback = db.prepare(`select kind, signal, count(*) as n from ai_feedback where created_at > ? group by kind, signal`).all(since);
  const count = (kind, signal) => feedback.find((r) => r.kind === kind && (signal === undefined || r.signal === signal))?.n ?? 0;
  return {
    days,
    writing: {
      written: count('write', 'written') + count('write', 'kept') + count('write', 'edited') + count('write', 'rewritten'),
      kept: count('write', 'kept'),
      edited: count('write', 'edited'),
      rewritten: count('write', 'rewritten'),
      examples: db.prepare("select count(*) as n from ai_feedback where kind = 'write' and signal = 'kept'").get().n,
    },
    tryOn: {
      kept: count('tryon', 'kept'),
      rejected: count('tryon', 'rejected'),
      engines: db.prepare('select engine, category, made, failed, kept, rejected, ms_total from ai_tryon_stats order by category, engine').all(),
    },
    usage: db.prepare(`select model, purpose, sum(calls) as calls, sum(tokens) as tokens from ai_usage
      where day >= ? group by model, purpose order by tokens desc`).all(since.slice(0, 10)),
  };
}
