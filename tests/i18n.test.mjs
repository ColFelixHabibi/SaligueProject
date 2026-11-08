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
