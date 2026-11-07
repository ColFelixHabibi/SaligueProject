// Giving space back (server/media.mjs): a photo, video or voice note is removed only once nothing in the
// database points at it any more — and never while something still does.
//   npm test
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A database and a media folder of its own, never the real ones.
const data = mkdtempSync(join(tmpdir(), 'saligue-media-'));
process.env.SALIGUE_DATA = data;

const { MEDIA_DIR, mediaName, mediaInUse, releaseMedia, sweepMedia } = await import('../server/media.mjs');
const { db } = await import('../server/db.mjs');

after(() => rmSync(data, { recursive: true, force: true }));

/** A file name exactly as this server writes one: 32 hex characters from the file's own bytes. */
const nameFor = (text, ext = 'jpg') => `${createHash('sha256').update(text).digest('hex').slice(0, 32)}.${ext}`;
const put = (name) => {
  writeFileSync(join(MEDIA_DIR, name), `bytes of ${name}`);
  return join(MEDIA_DIR, name);
};
const there = (name) => existsSync(join(MEDIA_DIR, name));
const old = (name, secondsAgo = 7_200) => utimesSync(join(MEDIA_DIR, name), new Date(Date.now() - secondsAgo * 1000), new Date(Date.now() - secondsAgo * 1000));

describe('media cleanup', () => {
  test('only names this server writes are read as files of its own', () => {
    const picture = nameFor('a shirt');
    assert.equal(mediaName(`/media/${picture}`), picture);
    assert.equal(mediaName('/media/live-0b1e5f9c-abc.mp4'), 'live-0b1e5f9c-abc.mp4', "a live's replay is named after the live");
    // Anything else is ignored rather than acted on: a link can never point outside data/media/.
    for (const bad of [null, undefined, '', 'x', 'data:image/jpeg;base64,AAAA', `https://elsewhere.test/media/${picture}`,
      '/media/../saligue.db', '/media/sub/dir.jpg', '/media/', '/media/abc.jpg?x=1']) {
      assert.equal(mediaName(bad), null, `${String(bad)} is not a file of ours`);
    }
  });

  test('a file something still shows is kept; one nobody shows is removed', () => {
    const shown = nameFor('still shown');
    const unused = nameFor('nobody shows this');
    put(shown);
    put(unused);
    // A link kept inside JSON, the way a lesson's captions are kept: the check has to look inside a value too.
    db.prepare('insert into app_config (key, value) values (?, ?)').run('media-test-shown', JSON.stringify({ poster: `/media/${shown}` }));

    assert.equal(mediaInUse(shown), true);
    assert.equal(mediaInUse(unused), false);
    assert.equal(releaseMedia(`/media/${shown}`, `/media/${unused}`), 1);
    assert.equal(there(shown), true, 'a file the database still points at is never removed');
    assert.equal(there(unused), false, 'a file nothing points at is removed');

    // Nothing that is not a /media/ link is acted on, so a bad value can never delete something else.
    assert.equal(releaseMedia(null, undefined, '', 'https://elsewhere.test/x.jpg', 'data:image/jpeg;base64,AAAA'), 0);
    assert.equal(there(shown), true);
  });

  test('the sweep leaves a file saved a moment ago alone, and clears what is old and unused', () => {
    const fresh = nameFor('saved a moment ago');
    const stale = nameFor('saved long ago, shown nowhere');
    const used = nameFor('saved long ago, still shown');
    put(fresh);
    put(stale);
    put(used);
    old(stale);
    old(used);
    db.prepare('insert into app_config (key, value) values (?, ?)').run('media-test-used', `/media/${used}`);

    sweepMedia();
    assert.equal(there(fresh), true, 'a file saved a moment ago may be about to be written on a row, so it is left alone');
    assert.equal(there(stale), false, 'an old file nothing points at is removed');
    assert.equal(there(used), true, 'an old file the database still points at stays');

    // With no grace period even a brand-new file goes — the grace is what protects one mid-save.
    sweepMedia({ youngerThanMs: 0 });
    assert.equal(there(fresh), false);
    assert.equal(there(used), true);
  });
});
