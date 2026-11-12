// The English text is the key (see src/lib/i18n.ts), so a string handed to t('…') that is not in the dictionary
// shows up in English on a Kinyarwanda or French phone — with no error anywhere to notice. That is exactly how the
// close-friends, archive and forwarding copy shipped untranslated. This keeps the dictionary and the screens in step.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const unquote = (s) => s.replace(/\\(['"\\])/g, '$1');

const dictionary = readFileSync('src/lib/i18n.ts', 'utf8');

// A key is written either quoted ('Add to cart') or bare (Email), always indented two spaces inside DICT.
const keys = new Map();
for (const line of dictionary.split('\n')) {
  const m = /^ {2}(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|([A-Za-z_$][\w$]*))\s*:\s*\[/.exec(line);
  if (!m) continue;
  const key = unquote(m[1] ?? m[2] ?? m[3]);
  keys.set(key, (keys.get(key) ?? 0) + 1);
}

// Every screen and client module that translates.
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.(tsx?|mjs)$/.test(name)) files.push(path);
  }
};
walk('src');

// t('Follow') and t("Don't have an account?"): literal first arguments only; a template is built at runtime.
const used = new Map();
let literals = 0;
for (const file of files) {
  for (const m of readFileSync(file, 'utf8').matchAll(/\bt\(\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")\s*[,)]/g)) {
    literals += 1;
    const key = unquote(m[1] ?? m[2]);
    if (!used.has(key)) used.set(key, new Set());
    used.get(key).add(file);
  }
}

test('the dictionary was actually read', () => {
  // Without this, a parsing slip would make every check below pass on an empty set.
  assert.ok(keys.size > 400, `only ${keys.size} keys found in src/lib/i18n.ts — the file was not parsed as expected`);
  assert.ok(files.length > 50, `only ${files.length} source files scanned`);
  assert.ok(literals > 300, `only ${literals} t() literals found — the scan is not seeing the screens`);
  assert.ok(keys.has('Follow'), "known key 'Follow' is missing: the key parser is wrong");
});

test('no screen asks for a translation that is not in the dictionary', () => {
  const missing = [...used.keys()].filter((key) => !keys.has(key)).sort();
  assert.deepEqual(
    missing,
    [],
    `${missing.length} string(s) still show in English on a Kinyarwanda or French phone:\n` +
      missing.map((key) => `  ${key}\n    ${[...used.get(key)].join('\n    ')}`).join('\n') +
      `\nAdd each one to DICT in src/lib/i18n.ts.`
  );
});

test('every key has one Kinyarwanda and one French line', () => {
  // A repeated key silently wins with the later pair, so the earlier translation disappears without any error.
  const repeated = [...keys.entries()].filter(([, n]) => n > 1).map(([key]) => key);
  assert.deepEqual(repeated, [], `these keys are declared more than once: ${repeated.join(', ')}`);
});

// The body of the app — long paragraphs, labels inside cards — is translated from /i18n/<lang>.json instead of DICT
// (src/components/page-translator.tsx: dict first, DICT second). That file is fetched at runtime and its error is
// swallowed on purpose, so one stray comma turns every screen back to English in that language with nothing to
// notice anywhere: no build error, no console warning, no failing screen.
const sheet = (lang) => {
  const text = readFileSync(`public/i18n/${lang}.json`, 'utf8');
  const json = JSON.parse(text);
  const declared = [...text.matchAll(/^ {2}"((?:[^"\\]|\\.)*)":/gm)].map((m) => unquote(m[1]));
  return { json, declared };
};

test('the /i18n files load, and every line in them says something', () => {
  for (const lang of ['rw', 'fr']) {
    // JSON.parse above is the real check: it throws here instead of silently emptying the dictionary at runtime.
    const { json, declared } = sheet(lang);
    assert.ok(declared.length > 1000, `${lang}.json: only ${declared.length} keys found — the file was not read as expected`);
    assert.equal(
      declared.length,
      Object.keys(json).length,
      `${lang}.json declares a key twice: the later line wins silently, so the earlier translation is lost`
    );
    const blank = Object.entries(json)
      .filter(([, value]) => typeof value !== 'string' || !value.trim())
      .map(([key]) => key);
    assert.deepEqual(blank, [], `${lang}.json has lines with no translation: ${blank.join(', ')}`);
  }
});

test('both /i18n files translate the same texts', () => {
  const rw = new Set(sheet('rw').declared);
  const fr = new Set(sheet('fr').declared);
  const onlyRw = [...rw].filter((key) => !fr.has(key)).sort();
  const onlyFr = [...fr].filter((key) => !rw.has(key)).sort();
  assert.deepEqual(
    { onlyRw, onlyFr },
    { onlyRw: [], onlyFr: [] },
    'a text translated in one language only shows in English in the other:\n' +
      onlyRw.map((key) => `  only in rw.json: ${key}`).join('\n') +
      (onlyRw.length && onlyFr.length ? '\n' : '') +
      onlyFr.map((key) => `  only in fr.json: ${key}`).join('\n')
  );
});

// The stylist's two answers with no AI (and when nothing fits) are plain sentences printed straight onto the card, so
// PageTranslator translates them from DICT — no t() call, so the scan above cannot see them. A small rewording would
// silently leave a Kinyarwanda shopper reading English, which is what happened before they were listed.
test('the stylist answers in the reader’s language even when there is no AI', () => {
  const stylist = readFileSync('server/stylist.mjs', 'utf8');
  const answers = [...stylist.matchAll(/(?:FALLBACK_REPLY = |\breply: )'((?:[^'\\]|\\.)*)'/g)].map((m) => unquote(m[1]));
  assert.ok(answers.length >= 2, `only ${answers.length} answer(s) found in server/stylist.mjs — the scan missed them`);
  const missing = answers.filter((answer) => !keys.has(answer));
  assert.deepEqual(
    missing,
    [],
    `these answers are not in DICT, so they show in English on a Kinyarwanda or French phone:\n${missing
      .map((answer) => `  ${answer}`)
      .join('\n')}\nAdd each one to DICT in src/lib/i18n.ts.`
  );
});
