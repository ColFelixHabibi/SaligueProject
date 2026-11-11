// Four additions borrowed from the way chat apps treat statuses and messages: close friends (a status for a small
// list instead of everyone), muted statuses (a ring taken out of the bar), archived chats (put away, not deleted)
// and the "Forwarded" mark on a copy of someone else's message.
// These are the parts that would fail silently, so they are checked here: a column that never got added, a bar that
// never filtered, a forward that could carry a file another message owns.
// What the four features *do* — who sees a close status, what a mute hides, what an archive leaves, what a forward
// carries — is exercised against a running server at the end of tests/api.test.mjs, so this file stays the shape
// guard and that one is the behaviour.
// The last block guards three later additions the same way: the History list (one row per item and person, cleared
// in one go), a % discount on a post (charged, never counted twice) and the 90-day deletion of a suspended account.
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

  test('a chat shows the photo, video or voice note it carries', () => {
    const inbox = source('src/components/messages/inbox.tsx');
    // The bubble draws the attachment. Before this, a photo or voice note was uploaded, stored and never seen.
    assert.match(inbox, /\{m\.attachment && <Attachment a=\{m\.attachment\} \/>\}/);
    assert.match(inbox, /a\.kind === 'image'/);
    assert.match(inbox, /a\.kind === 'video'/);
    assert.match(inbox, /<audio src=\{url\}/);
    // A signed chat file is not under /media/, so mediaUrl() has to recognise it too — otherwise the phone app,
    // whose pages come from https://localhost, asks itself for a file it does not have and shows nothing.
    assert.match(source('src/lib/api.ts'), /path\?\.startsWith\('\/api\/chat-files\/'\)/);
  });

  test('the composer can send a photo or a video', () => {
    const inbox = source('src/components/messages/inbox.tsx');
    assert.match(inbox, /sendFile\(file\.type\.startsWith\('video\/'\) \? 'video' : 'image', file, \(p\) => setUpload\(p\)\)/);
    assert.match(inbox, /accept="image\/\*,video\/\*"/);
  });

  test('a chat file is private: a signed link, no wildcard CORS, no referrer', () => {
    const media = source('server/chat-media.mjs');
    assert.doesNotMatch(media, /Access-Control-Allow-Origin/, 'no other site\'s script may read a private chat file');
    assert.match(media, /'Referrer-Policy': 'no-referrer'/);
    assert.match(media, /timingSafeEqual/, 'the signature is compared without leaking it through timing');
  });
});

describe('history, discounts and the 90-day deletion', () => {
  test('the history is one row per item and person, so it stays short and can be cleared', () => {
    const cols = db.prepare("select name, pk from pragma_table_info('view_history')").all();
    assert.deepEqual(cols.map((c) => c.name).sort(), ['product_id', 'seen_at', 'times', 'user_id']);
    // The pair is the key: watching the same item again is never a second row.
    assert.ok(cols.find((c) => c.name === 'user_id').pk > 0 && cols.find((c) => c.name === 'product_id').pk > 0);
    // It goes with the account, in both directions.
    const fks = db.prepare("select \"table\", on_delete from pragma_foreign_key_list('view_history')").all();
    assert.ok(fks.every((f) => f.on_delete === 'CASCADE'), 'nothing is left behind when the account or the item goes');
    assert.match(source('server/db.mjs'), /create index if not exists view_history_user on view_history\(user_id, seen_at desc\)/);
  });

  test('each person reads, removes and clears only their own list', () => {
    for (const pattern of ["'/api/history', ({ user, url })", "'/api/history', ({ user, body })"]) {
      const route = routeBody(pattern);
      assert.match(route, /if \(!user \|\| user\.is_guest\)/, `${pattern} is this person's alone`);
    }
    const read = routeBody("'/api/history', ({ user, url })");
    assert.match(read, /where user_id = \? order by seen_at desc/);
    // An item that has been taken down (or hidden after reports) is dropped rather than shown as a hole.
    assert.match(read, /if \(!p \|\| \(\(p\.hidden \|\| p\.status !== 'active'\) && p\.seller_id !== user\.id\)\) continue;/);
    const write = routeBody("'/api/history', ({ user, body })");
    assert.match(write, /on conflict \(user_id, product_id\) do update set seen_at = excluded\.seen_at, times = view_history\.times \+ 1/);
    // Bounded, so the table cannot grow for ever.
    assert.match(write, /limit \?\)`\)\.run\(user\.id, user\.id, HISTORY_MAX\)/);
    assert.match(server, /const HISTORY_MAX = 500;/);
    // Clearing all of it removes this account's rows only (a visitor with no session has none to clear).
    const clearAll = routeBody("'/api/history', ({ user })");
    assert.match(clearAll, /delete from view_history where user_id = \?/);
    const one = routeBody("'/api/history/([\\\\w-]+)'");
    assert.match(one, /delete from view_history where user_id = \? and product_id = \?/);
    // Deleting the account deletes the list, and the history is in the account file.
    assert.match(server, /'story_views', 'view_history',/);
    assert.match(server, /history: all\('select product_id, seen_at, times from view_history where user_id = \?/);
  });

  test('a % discount is a real price: the usual one is kept and checkout charges the lower one', () => {
    assert.ok(columns('products').includes('discount'));
    // No discount while a live deal already sets the lower price, and 1–90 is the range.
    assert.match(server, /const discountOf = \(r\) => \(dealActive\(r\) \? 0 : Math\.min\(90, Math\.max\(0, Math\.floor\(Number\(r\.discount\) \|\| 0\)\)\)\);/);
    assert.match(server, /if \(dealActive\(r\)\) return r\.deal_price;/);
    assert.match(server, /return percent \? round2\(Number\(r\.price\) \* \(1 - percent \/ 100\)\) : r\.price;/);
    // Both prices go to the app: the one to pay and the usual one to show crossed out.
    assert.match(server, /discount: \{ percent: discountOf\(r\), was: Number\(r\.price\) \}/);
    // An order is priced from priceOf(), so the discount is charged, not just displayed.
    assert.match(server, /price: priceOf\(product\), quantity/);
    assert.match(server, /group\.total \+= priceOf\(product\) \* quantity;/);
    // The edit form sending the shown price back must not turn it into the usual price (a discount on a discount).
    // Unless the same request changes the discount: then the price it sends is the one meant.
    assert.match(server, /if \(fields\.price !== undefined && \(dealActive\(before\) \|\| fields\.discount === undefined\)\s+&& Number\(fields\.price\) === Number\(shown\) && Number\(shown\) !== Number\(before\.price\)\) delete fields\.price;/);
    assert.match(server, /if \(!\(percent >= 0 && percent <= 90\)\) fail\(400, 'invalid_discount'/);
  });

  test('a suspension has a deadline, and an expired one is emptied for good', () => {
    assert.match(server, /const SUSPEND_DELETE_DAYS = 90;/);
    const suspend = routeBody("'/api/admin/users/([\\\\w-]+)/suspend'");
    assert.match(suspend, /const deleteAfter = suspend \? new Date\(Date\.now\(\) \+ SUSPEND_DELETE_DAYS \* 86_400_000\)\.toISOString\(\) : null;/);
    assert.match(suspend, /suspended_at = \?, delete_after = \?/);
    // Signed out everywhere at once, and told the day in the notification.
    assert.match(suspend, /delete from sessions where user_id = \?/);
    assert.match(suspend, /permanently deleted on \$\{deleteAfter\.slice\(0, 10\)\}/);
    assert.equal(columns('users').includes('suspended_at'), true);
    assert.equal(columns('users').includes('delete_after'), true);
    // The person is told the same thing at the door.
    assert.match(server, /If it is not restored, the account and everything in it is permanently deleted on/);
    // The sweep runs at start-up and once a day, skips the main admin, and empties the account through the one
    // routine that deletes an account (so a suspended account is erased exactly like one its owner deleted).
    assert.match(server, /function eraseExpiredAccounts\(\) \{/);
    assert.match(server, /where delete_after is not null and delete_after <= \? and is_guest = 0 and coalesce\(admin_level, 0\) != 1/);
    assert.match(server, /eraseAccount\(account, 'Suspended account deleted after 90 days'\);/);
    assert.match(server, /eraseExpiredAccounts\(\);\nsetInterval\(eraseExpiredAccounts, 86_400_000\)\.unref\(\);/);
    // An emptied account carries no deadline any more.
    assert.match(server, /suspended = 1, suspend_reason = \?, suspended_at = null, delete_after = null where id = \?/);
  });

  test('the app records what was seen, shows it, and shows both prices', () => {
    const history = source('src/lib/history.ts');
    assert.match(history, /api<SeenItem\[\]>\('\/history'\)/, 'the list is read from the server');
    assert.match(history, /api\('\/history', \{ method: 'DELETE' \}\)/, 'cleared in one go');
    assert.match(history, /api\(`\/history\/\$\{encodeURIComponent\(productId\)\}`, \{ method: 'DELETE' \}\)/, 'one item out');
    assert.match(history, /export function noteSeen\(/, 'what came on screen is noted');
    // The feed notes the item that is really on screen, and the item page notes what was opened.
    assert.match(source('src/components/social/feed-slide.tsx'), /noteSeen\(product\.id\)/);
    assert.match(source('src/app/product/view.tsx'), /noteSeen\(id\)/);
    // The list is reachable, and it can be cleared.
    assert.match(source('src/app/my-account/layout.tsx'), /'\/my-account\/history'/);
    assert.match(source('src/app/my-account/page.tsx'), /'\/my-account\/history'/);
    const page = source('src/app/my-account/history/page.tsx');
    assert.match(page, /clearHistory\(\)/);
    assert.match(page, /forgetSeen\(id\)/);
    // Both prices on the post: the discount is not a label only the shop sees.
    for (const file of ['src/components/social/feed-slide.tsx', 'src/components/product-card.tsx', 'src/components/social/feed-side-panel.tsx']) {
      assert.match(source(file), /<DiscountTag percent=\{product\.discount\.percent\} was=\{product\.discount\.was\}/, `${file} shows both prices`);
    }
    // A shop can set it when posting and when editing.
    assert.match(source('src/app/sell/page.tsx'), /discountPercent: formValues\.discount === '' \? null : Number\(formValues\.discount\)/);
    assert.match(source('src/app/edit-product/view.tsx'), /discountPercent: formValues\.discount === '' \? null : Number\(formValues\.discount\)/);
    // The page a shopper buys on, and the cart line: what is paid now, plus the usual price crossed out.
    assert.match(source('src/app/product/view.tsx'), /<DiscountTag percent=\{product\.discount\.percent\} was=\{product\.discount\.was\}/);
    assert.match(source('src/app/cart/page.tsx'), /<DiscountTag percent=\{item\.discount\.percent\} was=\{item\.discount\.was\}/);
    // Checkout charges what the server works out (priceOf), and shows that same amount.
    assert.match(source('src/app/checkout/page.tsx'), /formatPrice\(item\.price \* item\.quantity\)/);
    // A shop edits its own usual price, never the sale price: writing that back would count the discount twice.
    assert.match(source('src/app/edit-product/view.tsx'), /price: \(product\.discount\?\.was \?\? product\.deal\?\.was \?\? product\.price\)\.toString\(\)/);
    assert.match(source('src/app/dashboard/products/page.tsx'), /<InlineNumber value=\{p\.discount\?\.was \?\? p\.deal\?\.was \?\? p\.price\}/);
  });

  test('stories sit at the top of every feed tab, not only For You', () => {
    const feed = source('src/app/page.tsx');
    assert.match(feed, /<StoryBar compact/);
    // Learn keeps its own row of topics in that spot, so the story row is the only tab it is hidden on.
    assert.match(feed, /mode === 'learn' && 'hidden'/);
  });
});
