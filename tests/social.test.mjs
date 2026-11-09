// Four additions borrowed from the way chat apps treat statuses and messages: close friends (a status for a small
// list instead of everyone), muted statuses (a ring taken out of the bar), archived chats (put away, not deleted)
// and the "Forwarded" mark on a copy of someone else's message.
// These are the parts that would fail silently, so they are checked here: a column that never got added, a bar that
// never filtered, a forward that could carry a file another message owns.
// What the four features *do* — who sees a close status, what a mute hides, what an archive leaves, what a forward
// carries — is exercised against a running server at the end of tests/api.test.mjs, so this file stays the shape
// guard and that one is the behaviour.
//   npm test
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A database of its own, never the real one.
const data = mkdtempSync(join(tmpdir(), 'saligue-social-'));
process.env.SALIGUE_DATA = data;

const { db } = await import('../server/db.mjs');

after(() => rmSync(data, { recursive: true, force: true }));

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const server = source('server/index.mjs');
const columns = (table) => db.prepare(`select name from pragma_table_info('${table}')`).all().map((r) => r.name);

/** One registered route's body, from its pattern to the `});` that closes it. */
const routeBody = (pattern) => {
  const at = server.indexOf(pattern);
  assert.ok(at > 0, `${pattern} is registered on the server`);
  return server.slice(at, server.indexOf('\n});', at));
};

describe('schema', () => {
  test('a status can be kept to a close friends list', () => {
    assert.ok(columns('stories').includes('audience'), 'stories.audience exists');
    const dflt = db.prepare("select dflt_value from pragma_table_info('stories') where name = 'audience'").get();
    assert.equal(dflt.dflt_value, "'everyone'", 'a status is for everyone unless it says otherwise');
  });

  test('the close friends list and the muted rings have their own tables', () => {
    for (const table of ['close_friends', 'story_mutes']) {
      assert.ok(db.prepare("select name from sqlite_master where type = 'table' and name = ?").get(table), `${table} exists`);
    }
  });

  test('a chat is archived per side, and a message remembers it was forwarded', () => {
    assert.ok(columns('conversations').includes('buyer_archived'));
    assert.ok(columns('conversations').includes('seller_archived'));
    assert.ok(columns('messages').includes('forwarded'));
  });
});

describe('the bar', () => {
  test('leaves out a muted ring and close-friends statuses from people who did not choose this account', () => {
    assert.match(server, /const closeTo = closeFriendsOf\(user\.id\);/);
    assert.match(server, /const muted = mutedStatuses\(user\.id\);/);
    assert.match(server, /muted\.has\(r\.user_id\) \|\| \(r\.audience === 'close' && !closeTo\.has\(r\.user_id\)\)/);
    // The author always sees their own statuses, whatever list they are on.
    assert.match(server, /if \(r\.user_id !== user\.id &&/);
  });

  test('carries the audience back to the app', () => {
    assert.match(server, /audience: r\.audience === 'close' \? 'close' : 'everyone'/);
    assert.match(server, /muted: muted\.has\(author\.id\)/);
  });

  test('only a connected person can be put on a close friends list', () => {
    const route = routeBody("'/api/close-friends/([\\\\w-]+)'");
    assert.match(route, /if \(!connected\(user\.id, friendId\)\)/);
  });

  test('muting is never your own status', () => {
    const route = routeBody("'/api/stories/mute/([\\\\w-]+)'");
    assert.match(route, /if \(id === user\.id\) fail\(400, 'own_story'/);
    assert.match(route, /insert or ignore into story_mutes/);
    assert.match(route, /delete from story_mutes/);
  });
});

describe('chats', () => {
  test('archiving touches this account\'s side only', () => {
    const route = routeBody("'/api/conversations/([\\\\w-]+)/archive'");
    assert.match(route, /c\.buyer_id === user\.id \? 'buyer' : 'seller'/);
    assert.match(route, /_archived = \?/);
    // Archiving is not clearing: nothing is deleted.
    assert.doesNotMatch(route, /delete from messages|delete from conversations/);
  });

  test('a forward carries no file, so unsending one copy cannot break the other', () => {
    const route = routeBody("'/api/conversations/([\\\\w-]+)/forward'");
    assert.match(route, /forwarded: true/);
    // removeChatFiles() deletes a chat file outright, so two messages must never point at one file.
    assert.doesNotMatch(route, /attachment/);
  });

  test('only a message this account can see may be forwarded', () => {
    const route = routeBody("'/api/conversations/([\\\\w-]+)/forward'");
    assert.match(route, /from\.buyer_id !== user\.id && from\.seller_id !== user\.id/);
    assert.match(route, /if \(source\.deleted_at\) fail\(400, 'gone'/);
    assert.match(route, /nothing_to_forward/);
  });

  test('the archive flag is read back per side', () => {
    assert.match(server, /archived: !!\(iAmBuyer \? c\.buyer_archived : c\.seller_archived\)/);
    assert.match(server, /forwarded: !!m\.forwarded,/);
  });
});

describe('the app uses them', () => {
  test('the story composer posts an audience and lets the list be edited', () => {
    const bar = source('src/components/social/story-bar.tsx');
    assert.match(bar, /audience,/);
    assert.match(bar, /closeFriends\(\)/);
    assert.match(bar, /setCloseFriend\(/);
  });

  test('the viewer can mute and unmute a ring', () => {
    assert.match(source('src/components/social/story-viewer.tsx'), /muteStatuses\(group\.user\.id, muted\)/);
  });

  test('the inbox archives and forwards', () => {
    const inbox = source('src/components/messages/inbox.tsx');
    assert.match(inbox, /setArchived\(c\.id, !c\.archived\)/);
    assert.match(inbox, /forwardMessage\(source\.id, to\.id\)/);
    // The archived chats are kept out of the main list, never dropped.
    assert.match(inbox, /shown\.filter\(\(c\) => c\.archived\)/);
  });
});
