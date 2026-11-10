// What Saligue's AI learns from the people who use it (server/ai-learn.mjs), against a database of its own:
//   npm test
// Nothing here trains a model. What is checked is the memory around the models: how closely a kept description
// matches the one the AI wrote, which descriptions become the writer's examples (one line, short, never rules),
// and that the try-on chain only reorders itself on real evidence — never on a handful of looks, and never
// putting the free models first just because they are free.
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A database of its own, never the real one.
const data = mkdtempSync(join(tmpdir(), 'saligue-learn-'));
process.env.SALIGUE_DATA = data;

const { db, now } = await import('../server/db.mjs');
const {
  similarity,
  noteWritten,
  noteDescriptionUsed,
  writeExamples,
  noteTryOn,
  noteLookFeedback,
  tryOnOrder,
  noteAiUsage,
  aiLearningSummary,
} = await import('../server/ai-learn.mjs');

after(() => {
  try {
    rmSync(data, { recursive: true, force: true });
  } catch {
    // The database is still open; the temporary folder can stay behind.
  }
});

// The sellers whose kept descriptions the writer learns from.
for (const [id, name] of [['seller-1', 'Aline'], ['seller-2', 'Moses'], ['seller-3', 'Yvette'], ['seller-4', 'Eric'], ['seller-5', 'Diane']]) {
  db.prepare('insert into users (id, display_name, created_at) values (?, ?, ?)').run(id, name, now());
}

const AI_TEXT = 'A soft black cotton shirt with a relaxed fit, worn twice and kept in very good condition. Size M.';

describe('how close the AI came to what the seller kept', () => {
  test('the same words in another order are the same description', () => {
    assert.equal(similarity('Soft cotton shirt, worn twice', 'worn twice, soft cotton shirt'), 1);
  });

  test('a light edit is still the AI’s wording', () => {
    const score = similarity('A soft cotton shirt worn twice, no marks', 'A soft cotton shirt, worn twice, no marks at all, unisex');
    assert.ok(score > 0.8 && score < 1, `expected a high score, got ${score}`);
  });

  test('words written from scratch are not the AI’s', () => {
    assert.equal(similarity('A soft cotton shirt worn twice', 'Leather sandals, size 40'), 0);
  });

  test('nothing written means nothing kept', () => {
    assert.equal(similarity('', 'Leather sandals, size 40'), 0);
  });
});

describe('writing: what the seller did with the AI’s words', () => {
  test('a description kept as it was is remembered as kept', () => {
    const id = noteWritten({ userId: 'seller-1', input: { title: 'Black shirt' }, output: AI_TEXT, model: 'deepseek-chat' });
    assert.ok(id, 'the AI’s draft is kept until the seller saves the item');

    assert.deepEqual(noteDescriptionUsed('seller-1', AI_TEXT), { signal: 'kept', score: 1 });
  });

  test('a light edit is remembered as edited', () => {
    noteWritten({ userId: 'seller-1', input: { title: 'Black shirt' }, output: AI_TEXT });
    const learned = noteDescriptionUsed('seller-1', 'Soft black cotton shirt, relaxed fit, in very good condition. Worn twice.');
    assert.equal(learned.signal, 'edited');
    assert.ok(learned.score >= 0.5 && learned.score < 0.85, `expected an edited score, got ${learned.score}`);
  });

  test('a description rewritten from scratch is remembered as rewritten', () => {
    noteWritten({ userId: 'seller-1', input: { title: 'Black shirt' }, output: AI_TEXT });
    const learned = noteDescriptionUsed('seller-1', 'Leather sandals, size 40, barely worn, the soles are still clean.');
    assert.equal(learned.signal, 'rewritten');
  });

  test('a seller who writes their own words costs the AI nothing', () => {
    assert.equal(noteDescriptionUsed('seller-2', 'Leather sandals, size 40, barely worn at all.'), null, 'no draft was waiting for an answer');
  });

  test('a title-length description teaches nothing', () => {
    noteWritten({ userId: 'seller-5', input: { title: 'Shirt' }, output: AI_TEXT });
    assert.equal(noteDescriptionUsed('seller-5', 'Black shirt'), null);
  });

  test('a draft from days ago is not matched to what is saved today', () => {
    const id = noteWritten({ userId: 'seller-4', input: { title: 'Black shirt' }, output: AI_TEXT });
    db.prepare('update ai_feedback set created_at = ? where id = ?').run(new Date(Date.now() - 3 * 86_400_000).toISOString(), id);
    assert.equal(noteDescriptionUsed('seller-4', AI_TEXT), null, 'only a fresh draft can be the one the seller answered');
  });
});

describe('the examples the writer follows', () => {
  test('a seller’s kept description comes back as its first example', () => {
    noteWritten({ userId: 'seller-3', input: { title: 'Silk scarf' }, output: 'A printed silk scarf, 90 by 90 centimetres, kept folded and never worn.' });
    noteDescriptionUsed('seller-3', 'A printed silk scarf, 90 by 90 centimetres, kept folded and never worn.');

    const examples = writeExamples('seller-3', 3);
    assert.equal(examples[0], 'A printed silk scarf, 90 by 90 centimetres, kept folded and never worn.');
  });

  test('a new seller starts from what the marketplace kept', () => {
    const examples = writeExamples('seller-2', 2);
    assert.ok(examples.length >= 1, 'the marketplace’s kept wording is used until the shop has its own');
    assert.ok(examples.every((e) => e.length >= 20), 'a sentence, not a fragment');
  });

  test('an example is one short line, never long enough to smuggle a rule in', () => {
    const long = `A long description ${'with plenty of detail '.repeat(20)}that ends here.`;
    noteWritten({ userId: 'seller-4', input: { title: 'Long item' }, output: long });
    noteDescriptionUsed('seller-4', long);

    const [example] = writeExamples('seller-4', 1);
    assert.ok(example.length <= 240, `examples are shortened, got ${example.length} characters`);
    assert.ok(!example.includes('\n'), 'one line only');
  });

  test('the number of examples stays small', () => {
    assert.ok(writeExamples('seller-1', 99).length <= 5, 'a handful of examples, never a wall of text');
    assert.ok(writeExamples('seller-1', 0).length >= 1, 'asking for none still gives the writer something');
  });
});

describe('realistic try-on: which AI is tried first', () => {
  test('with no evidence at all, the honest order stands', () => {
    assert.deepEqual(tryOnOrder('dress'), ['own', 'fashn', 'free']);
  });

  test('a handful of looks is not evidence', () => {
    for (let i = 0; i < 7; i++) noteLookFeedback({ engine: 'fashn', category: 'top', kept: false });
    for (let i = 0; i < 3; i++) noteLookFeedback({ engine: 'free', category: 'top', kept: true });
    assert.deepEqual(tryOnOrder('top'), ['own', 'fashn', 'free'], 'seven refused looks cannot reorder the chain');
  });

  test('looks shoppers keep with the free models move them ahead of the paid one', () => {
    for (let i = 0; i < 8; i++) noteLookFeedback({ engine: 'free', category: 'top', kept: true });
    for (let i = 0; i < 8; i++) noteLookFeedback({ engine: 'fashn', category: 'top', kept: false });
    assert.deepEqual(tryOnOrder('top'), ['own', 'free', 'fashn']);
  });

  test('the own AI server is first whatever people kept', () => {
    assert.equal(tryOnOrder('top')[0], 'own');
  });

  test('what shoppers think of tops says nothing about dresses', () => {
    assert.deepEqual(tryOnOrder('dress'), ['own', 'fashn', 'free']);
  });

  test('a model people keep half the time is not moved', () => {
    for (let i = 0; i < 4; i++) noteLookFeedback({ engine: 'free', category: 'outerwear', kept: true });
    for (let i = 0; i < 4; i++) noteLookFeedback({ engine: 'free', category: 'outerwear', kept: false });
    for (let i = 0; i < 8; i++) noteLookFeedback({ engine: 'fashn', category: 'outerwear', kept: false });
    assert.deepEqual(tryOnOrder('outerwear'), ['own', 'fashn', 'free'], 'half the time is not clearly better');
  });

  test('a look with no engine or no part of the body is not counted', () => {
    const rows = () => db.prepare('select count(*) as n from ai_tryon_stats').get().n;
    const before = rows();
    noteLookFeedback({ engine: 'some-model', category: 'top', kept: true });
    noteLookFeedback({ engine: 'free', category: null, kept: true });
    noteTryOn({ engine: 'free', category: '', ok: true, ms: 10 });

    assert.equal(rows(), before, 'a look with nothing to file it under writes nothing');
    assert.equal(db.prepare("select count(*) as n from ai_tryon_stats where engine = 'some-model'").get().n, 0);
  });
});

describe('the scoreboard every look writes to', () => {
  test('a look that worked and one that failed are counted apart, with their time', () => {
    noteTryOn({ engine: 'own', category: 'bottom', ok: true, ms: 4200 });
    noteTryOn({ engine: 'own', category: 'bottom', ok: false, ms: 800 });

    const row = db.prepare("select made, failed, ms_total from ai_tryon_stats where engine = 'own' and category = 'bottom'").get();
    assert.equal(row.made, 1);
    assert.equal(row.failed, 1);
    assert.equal(row.ms_total, 5000);
  });

  test('an AI nobody knows is not counted', () => {
    noteTryOn({ engine: 'some-model', category: 'bottom', ok: true, ms: 100 });
    assert.equal(db.prepare("select count(*) as n from ai_tryon_stats where engine = 'some-model'").get().n, 0);
  });
});

describe('what the AI costs', () => {
  test('calls are added up per account, day, model and purpose', () => {
    noteAiUsage({ userId: 'seller-1', model: 'deepseek-chat', purpose: 'write', tokens: 120 });
    noteAiUsage({ userId: 'seller-1', model: 'deepseek-chat', purpose: 'write', tokens: 80 });

    const row = db.prepare("select calls, tokens from ai_usage where user_id = 'seller-1' and purpose = 'write'").get();
    assert.equal(row.calls, 2);
    assert.equal(row.tokens, 200);
  });

  test('a call with no account is not counted', () => {
    noteAiUsage({ userId: null, model: 'deepseek-chat', purpose: 'write', tokens: 900 });
    assert.equal(db.prepare('select count(*) as n from ai_usage where tokens = 900').get().n, 0);
  });

  test('the summary reads back what was learned and what was spent', () => {
    const summary = aiLearningSummary();
    assert.equal(summary.days, 30);
    assert.ok(summary.writing.written >= 3, 'every AI draft is counted, answered or not');
    assert.ok(summary.writing.kept >= 1, 'the descriptions sellers kept are the writer’s examples');
    assert.ok(summary.writing.examples >= 1);
    assert.ok(summary.tryOn.engines.some((e) => e.engine === 'own' && e.category === 'bottom'));
    assert.ok(summary.usage.some((u) => u.purpose === 'write' && u.tokens >= 200), 'tokens are visible per purpose');
  });
});
