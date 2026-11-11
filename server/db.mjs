// Saligue's own database: one SQLite file (data/saligue.db). Uses Node's built-in SQLite, no installs.
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const DATA_DIR = resolve(process.env.SALIGUE_DATA || 'data');
mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(join(DATA_DIR, 'saligue.db'));

db.exec(`
  pragma journal_mode = wal;
  pragma foreign_keys = on;

  create table if not exists users (
    id text primary key,
    email text unique collate nocase,
    password_hash text,
    display_name text,
    role text not null default 'buyer' check (role in ('buyer', 'seller')),
    official integer not null default 0,
    shop text,                          -- JSON: shop name and full address
    is_guest integer not null default 0,
    created_at text not null
  );

  create table if not exists sessions (
    token text primary key,
    user_id text not null references users(id) on delete cascade,
    created_at text not null
  );
  -- Sessions are swept by age when a new one is made (index.mjs, tidySessions): the first index keeps the sweep
  -- from reading every session each time, the second keeps one account's own list to the newest few.
  create index if not exists sessions_created on sessions(created_at);
  create index if not exists sessions_user on sessions(user_id, created_at desc);

  create table if not exists products (
    id text primary key,
    name text not null,
    price real not null check (price >= 0),
    image text not null,                -- photo (data URL)
    cutout text,                        -- photo without background (data URL)
    embedding text,                     -- JSON: AI search fingerprint
    category text not null,
    seller text not null,
    seller_id text not null references users(id) on delete cascade,
    seller_email text,
    status text not null default 'active' check (status in ('active', 'archived', 'draft')),
    description text, size text, color text, brand text, condition text, contact text,
    shop text,                          -- JSON copy of the seller's shop
    official integer not null default 0,
    like_count integer not null default 0,
    sound text,                         -- JSON: { name, duration } when the item has a sound
    created_at text not null
  );
  create index if not exists products_created on products(created_at desc);
  create index if not exists products_seller on products(seller_id);

  create table if not exists likes (
    product_id text not null references products(id) on delete cascade,
    user_id text not null references users(id) on delete cascade,
    created_at text not null,
    primary key (product_id, user_id)
  );
  create index if not exists likes_user on likes(user_id);

  -- Resaligue (repost): someone passes an item on to the people who follow them. It also tells For You what they
  -- love (a strong signal) and helps the item trend. Public: shown on their profile and in their followers' feeds.
  create table if not exists reposts (
    product_id text not null references products(id) on delete cascade,
    user_id text not null references users(id) on delete cascade,
    created_at text not null,
    primary key (product_id, user_id)
  );
  create index if not exists reposts_user on reposts(user_id, created_at);
  create index if not exists reposts_time on reposts(created_at);

  create table if not exists comments (
    id text primary key,
    product_id text not null references products(id) on delete cascade,
    user_id text not null references users(id) on delete cascade,
    name text not null,
    text text not null,
    created_at text not null
  );
  create index if not exists comments_product on comments(product_id, created_at desc);

  create table if not exists cart_items (
    user_id text not null references users(id) on delete cascade,
    product_id text not null references products(id) on delete cascade,
    quantity integer not null check (quantity between 1 and 99),
    primary key (user_id, product_id)
  );

  create table if not exists wishlists (
    user_id text not null references users(id) on delete cascade,
    product_id text not null references products(id) on delete cascade,
    added_at text not null,
    primary key (user_id, product_id)
  );

  create table if not exists product_audio (
    product_id text primary key references products(id) on delete cascade,
    data text not null,                 -- MP3 (data URL)
    name text not null,
    duration real not null
  );

  create table if not exists orders (
    id text primary key,
    buyer_id text not null references users(id),
    buyer_name text not null,
    buyer_email text not null default '',
    seller_id text not null references users(id),
    shop text,
    items text not null,                -- JSON
    total real not null,
    delivery text not null,             -- JSON
    payment_method text not null,
    payment_status text not null default 'unpaid',
    status text not null default 'placed',
    created_at text not null
  );
  create index if not exists orders_buyer on orders(buyer_id, created_at desc);
  create index if not exists orders_seller on orders(seller_id, created_at desc);

  create table if not exists support_requests (
    id text primary key,
    user_id text references users(id) on delete set null,
    name text, email text, contact text,
    subject text not null,
    message text not null,
    source text,
    created_at text not null
  );

  create table if not exists notifications (
    id text primary key,
    user_id text not null references users(id) on delete cascade,
    type text not null,                 -- sale | order | message | account | product
    title text not null,
    body text not null default '',
    link text,
    read integer not null default 0,
    created_at text not null
  );
  create index if not exists notifications_user on notifications(user_id, created_at desc);

  create table if not exists password_resets (
    token_hash text primary key,        -- SHA-256 of the token sent by email
    user_id text not null references users(id) on delete cascade,
    expires_at text not null
  );

  create table if not exists reports (
    product_id text not null references products(id) on delete cascade,
    user_id text not null references users(id) on delete cascade,
    reason text not null,               -- not_fashion | fake | offensive | other
    created_at text not null,
    primary key (product_id, user_id)
  );

  -- Notice and takedown (page /takedown): someone says an item uses their photo, brand or work. A notice that
  -- names one of our items and carries the good-faith statement hides it at once, until INDECIANA reviews it.
  create table if not exists takedowns (
    id text primary key,
    kind text not null default 'other',  -- item | lesson | other
    target_id text,                      -- the item or lesson it is about, when we could find it
    url text,                            -- what the sender pointed at (a link or an id)
    rights text not null,                -- copyright | trademark | privacy | other
    claimant_name text not null,
    claimant_email text not null,
    details text not null,
    status text not null default 'open', -- open | actioned | rejected
    hidden integer not null default 0,   -- whether this notice took the item out of sight
    note text,                            -- INDECIANA's decision note
    decided_by text, decided_at text,
    created_at text not null
  );
  create index if not exists takedowns_status on takedowns(status, created_at desc);

  create table if not exists learned_examples (
    embedding text not null,            -- JSON: AI fingerprint of a reviewed photo
    label text not null,                -- fashion | not_fashion
    source text,                        -- e.g. the product it came from
    created_at text not null
  );

  create table if not exists app_config (
    key text primary key,
    value text not null                 -- JSON
  );

  -- An account's own AI key (e.g. DeepSeek), so two accounts never share one key. Kept with the account that added
  -- it, never shown again (only the last 4 characters are kept for the app), and checked with the company on save.
  create table if not exists user_ai_keys (
    user_id text not null references users(id) on delete cascade,
    provider text not null,             -- deepseek
    secret text not null,
    hint text not null,                 -- "••••" and the last 4 characters, all the app ever shows
    created_at text not null,
    checked_at text,                    -- last time the company accepted this key
    primary key (user_id, provider)
  );

  -- What the AI learns from people using it (server/ai-learn.mjs): a description a seller kept (or rewrote), a look a
  -- shopper kept (or threw away), so the writing has examples to follow and the try-on knows which AI pleases people.
  -- A row is one piece of work: what was asked (input), what the AI gave (output), and what the person really kept.
  create table if not exists ai_feedback (
    id text primary key,
    user_id text not null references users(id) on delete cascade,
    kind text not null,                 -- write | look | tryon
    signal text not null,               -- written | kept | edited | rewritten | rejected
    engine text,                        -- tryon only: own | fashn | free
    category text,                      -- tryon only: top | outerwear | bottom | dress
    model text,                         -- the LLM that wrote it, when known
    input text,                         -- JSON of the facts the AI was given
    output text,                        -- what the AI gave
    final text,                         -- what the person kept, after their own changes
    score real,                         -- 1 = kept exactly, 0 = completely rewritten
    detail text,                        -- JSON: why a look was refused, tokens, …
    created_at text not null
  );
  create index if not exists ai_feedback_recent on ai_feedback(kind, created_at desc);
  create index if not exists ai_feedback_user on ai_feedback(user_id, created_at desc);

  -- A small scoreboard per try-on AI and category: how many looks it made, how many shoppers kept or refused.
  -- server/tryon.mjs reads it to try the AI that has been pleasing people first, and writes to it after every look.
  create table if not exists ai_tryon_stats (
    engine text not null,               -- own | fashn | free
    category text not null,
    made integer not null default 0,
    failed integer not null default 0,
    kept integer not null default 0,
    rejected integer not null default 0,
    ms_total integer not null default 0,
    updated_at text not null,
    primary key (engine, category)
  );

  -- Tokens spent per account, day, model and purpose, so the AI's cost is visible (and a wrong key is noticed).
  create table if not exists ai_usage (
    user_id text not null references users(id) on delete cascade,
    day text not null,                  -- YYYY-MM-DD
    provider text not null,             -- deepseek
    model text not null,
    purpose text not null,              -- write | look | other
    calls integer not null default 0,
    tokens integer not null default 0,
    updated_at text not null,
    primary key (user_id, day, provider, model, purpose)
  );

  -- Direct chat between a buyer and a seller: one conversation per pair, messages may point at an item or order.
  create table if not exists conversations (
    id text primary key,
    buyer_id text not null references users(id) on delete cascade,
    seller_id text not null references users(id) on delete cascade,
    last_message_at text not null,
    buyer_read_at text,
    seller_read_at text,
    buyer_emailed_at text,              -- last "new message" email, so a busy chat sends one email, not fifty
    seller_emailed_at text,
    created_at text not null,
    unique (buyer_id, seller_id)
  );
  create index if not exists conversations_buyer on conversations(buyer_id, last_message_at desc);
  create index if not exists conversations_seller on conversations(seller_id, last_message_at desc);

  create table if not exists messages (
    id text primary key,
    conversation_id text not null references conversations(id) on delete cascade,
    sender_id text not null references users(id) on delete cascade,
    text text not null,
    product_id text references products(id) on delete set null,
    order_id text references orders(id) on delete set null,
    created_at text not null
  );
  create index if not exists messages_conversation on messages(conversation_id, created_at);

  -- Star ratings from buyers whose order with the item was delivered.
  create table if not exists reviews (
    id text primary key,
    product_id text not null references products(id) on delete cascade,
    user_id text not null references users(id) on delete cascade,
    name text not null,
    rating integer not null check (rating between 1 and 5),
    text text not null default '',
    created_at text not null,
    unique (product_id, user_id)
  );
  create index if not exists reviews_product on reviews(product_id, created_at desc);

  -- Online payments (card / Mobile Money through Flutterwave). One payment may cover orders from several shops.
  create table if not exists payments (
    id text primary key,                -- tx_ref sent to the payment provider
    user_id text not null references users(id) on delete cascade,
    order_ids text not null,            -- JSON
    amount real not null,
    currency text not null,
    status text not null default 'pending' check (status in ('pending', 'paid', 'failed')),
    provider_ref text,                  -- the provider's transaction id
    created_at text not null
  );

  -- Saligue Live: sellers stream video (LiveKit, see live.mjs) with chat, hearts, featured items and guests.
  create table if not exists lives (
    id text primary key,                -- also the LiveKit room name
    seller_id text not null references users(id) on delete cascade,
    title text not null,
    description text not null default '',
    status text not null default 'live' check (status in ('live', 'ended')),
    product_ids text not null default '[]', -- JSON: featured items
    pinned_product_id text,
    pinned_comment_id text,
    like_count integer not null default 0,
    peak_viewers integer not null default 0,
    muted text not null default '[]',   -- JSON: user ids who may not comment
    started_at text not null,
    ended_at text
  );
  create index if not exists lives_status on lives(status, started_at desc);

  create table if not exists live_comments (
    id text primary key,
    live_id text not null references lives(id) on delete cascade,
    user_id text not null references users(id) on delete cascade,
    name text not null,
    text text not null,
    kind text not null default 'comment' check (kind in ('comment', 'question', 'join')),
    created_at text not null
  );
  create index if not exists live_comments_live on live_comments(live_id, created_at);

  -- Viewers asking to join the live on camera, and the host's answer.
  create table if not exists live_guests (
    live_id text not null references lives(id) on delete cascade,
    user_id text not null references users(id) on delete cascade,
    status text not null check (status in ('requested', 'accepted', 'declined')),
    created_at text not null,
    primary key (live_id, user_id)
  );

  -- A live "drop": the host holds one item up during the live and viewers claim it, first come first served.
  -- Claiming only takes a place in the queue (see live_claims); stock itself is still checked when the order is placed.
  create table if not exists live_drops (
    id text primary key,
    live_id text not null references lives(id) on delete cascade,
    product_id text not null references products(id) on delete cascade,
    slots integer not null default 1,     -- how many of this item the host is giving at this price
    status text not null default 'open' check (status in ('open', 'closed')),
    created_at text not null
  );
  create index if not exists live_drops_live on live_drops(live_id, created_at desc);

  -- One place in a drop. 'held' for ten minutes; 'paid' once ordered (the place stays taken); 'released' when given back or late, freeing it.
  create table if not exists live_claims (
    id text primary key,
    drop_id text not null references live_drops(id) on delete cascade,
    user_id text not null references users(id) on delete cascade,
    name text not null,
    status text not null default 'held' check (status in ('held', 'released', 'paid')),
    created_at text not null,
    expires_at text not null
  );
  create index if not exists live_claims_drop on live_claims(drop_id, status, expires_at);
  -- One place per person per drop (they may claim again once theirs is released).
  create unique index if not exists live_claims_one_place on live_claims(drop_id, user_id) where status = 'held';

  -- Community lessons: anyone with an account teaches fashion in a short video (up to 4 min 30 s).
  create table if not exists lessons (
    id text primary key,
    user_id text not null references users(id) on delete cascade,
    title text not null,
    description text not null default '',
    topic text not null,
    language text not null default 'en',
    video text,                          -- set once the upload is converted (video.mjs)
    poster text,
    duration integer,
    like_count integer not null default 0,
    view_count integer not null default 0,
    hidden integer not null default 0,   -- after reports, until reviewed
    created_at text not null
  );
  create index if not exists lessons_new on lessons(created_at);
  create table if not exists lesson_likes (
    lesson_id text not null references lessons(id) on delete cascade,
    user_id text not null references users(id) on delete cascade,
    primary key (lesson_id, user_id)
  );
  -- Tips: anyone supports a teacher or shop directly. Saligue keeps a small fee; the rest is paid by Mobile Money.
  create table if not exists tips (
    id text primary key,
    from_user text not null references users(id) on delete cascade,
    to_user text not null references users(id) on delete cascade,
    lesson_id text,
    amount real not null,               -- dollars, what the supporter pays
    share real not null,                -- dollars the receiver gets
    message text not null default '',
    status text not null default 'pending_payment' check (status in ('pending_payment', 'paid', 'cancelled')),
    reference text not null,
    payout_id text,
    created_at text not null,
    paid_at text
  );
  create index if not exists tips_to on tips(to_user, status);
  -- Where a person who isn't a monetized shop receives tips.
  create table if not exists tip_accounts (
    user_id text primary key references users(id) on delete cascade,
    momo_number text not null,
    momo_name text not null
  );

  -- Blocking: the two people no longer see each other's comments, can't message, follow or comment on each other.
  create table if not exists blocks (
    blocker_id text not null references users(id) on delete cascade,
    blocked_id text not null references users(id) on delete cascade,
    created_at text not null,
    primary key (blocker_id, blocked_id)
  );
  -- Appeals: the owner of an item or lesson hidden after reports asks Saligue to look again.
  create table if not exists appeals (
    id text primary key,
    user_id text not null references users(id) on delete cascade,
    kind text not null check (kind in ('product', 'lesson')),
    target_id text not null,
    text text not null,
    status text not null default 'open' check (status in ('open', 'restored', 'kept')),
    note text,
    created_at text not null,
    decided_at text
  );

  -- Verification badge requests: ID card, passport or business registration, reviewed by an admin.
  -- Document photos are kept privately (data/private) and deleted as soon as an admin decides.
  create table if not exists verifications (
    id text primary key,
    user_id text not null references users(id) on delete cascade,
    type text not null check (type in ('id', 'passport', 'business')),
    legal_name text not null,
    doc_number text not null,           -- only the last 4 characters are kept
    country text not null,
    business_name text,
    files text not null default '{}',   -- JSON: private file names (removed after the decision)
    status text not null check (status in ('pending_payment', 'in_review', 'approved', 'rejected', 'cancelled')),
    amount real not null,
    reference text not null,
    note text,
    created_at text not null,
    decided_at text,
    decided_by text
  );

  -- Monthly renewals of the verification badge (documents are checked once; each payment adds 30 days).
  create table if not exists verification_renewals (
    id text primary key,
    user_id text not null references users(id) on delete cascade,
    amount real not null,
    reference text not null,
    status text not null check (status in ('pending_payment', 'paid', 'cancelled')),
    created_at text not null,
    paid_at text
  );

  -- What admins did (who, what, when), so the main admin can follow sub-admins' work.
  create table if not exists admin_log (
    id integer primary key autoincrement,
    user_id text not null,
    action text not null,
    detail text not null default '',
    created_at text not null
  );

  -- Fashion challenges set by Saligue: people join by posting a lesson video before the deadline.
  create table if not exists challenges (
    id text primary key,
    title text not null,
    description text not null default '',
    topic text not null,
    created_by text not null references users(id) on delete cascade,
    ends_at text not null,
    created_at text not null
  );

  -- Comments and questions under a lesson; replies (parent_id) make Q&A threads with the teacher.
  create table if not exists lesson_comments (
    id text primary key,
    lesson_id text not null references lessons(id) on delete cascade,
    user_id text not null references users(id) on delete cascade,
    parent_id text,
    kind text not null default 'comment' check (kind in ('comment', 'question')),
    text text not null,
    created_at text not null
  );
  create index if not exists lesson_comments_lesson on lesson_comments(lesson_id, created_at);
  create table if not exists lesson_reports (
    lesson_id text not null references lessons(id) on delete cascade,
    user_id text not null references users(id) on delete cascade,
    reason text not null,
    created_at text not null,
    primary key (lesson_id, user_id)
  );

  -- What shoppers do with items (opened, watched, tried on, skipped…), for the For You feed (recommend.mjs).
  -- Recorded only when the shopper allowed personalisation in the cookie banner.
  create table if not exists interactions (
    user_id text not null references users(id) on delete cascade,
    product_id text not null references products(id) on delete cascade,
    kind text not null,                 -- view | dwell | complete | wear | cart | message | share | skip | less
    weight real not null,
    created_at text not null
  );
  create index if not exists interactions_user on interactions(user_id, created_at desc);
  create index if not exists interactions_time on interactions(created_at);

  -- Shoppers following shops (counts toward creator monetization).
  create table if not exists follows (
    follower_id text not null references users(id) on delete cascade,
    seller_id text not null references users(id) on delete cascade,
    created_at text not null,
    primary key (follower_id, seller_id)
  );
  create index if not exists follows_seller on follows(seller_id, created_at);

  -- Stories (a "status"): a photo, a voice note, or a line of words that goes by itself after 24 hours
  -- (index.mjs /api/stories). product_id is the Saligue difference from a plain status: a story can open the item
  -- it is about.
  create table if not exists stories (
    id text primary key,
    user_id text not null references users(id) on delete cascade,
    kind text not null default 'image' check (kind in ('image', 'text', 'voice')),
    media text,                                   -- /media/… for a photo or a voice note; null for words
    caption text not null default '',
    background text not null default '#111111',   -- the colour words are written on
    product_id text references products(id) on delete set null,
    seconds integer,                              -- how long a voice note runs, so the ring knows when to move on
    created_at text not null,
    expires_at text not null
  );
  create index if not exists stories_expiry on stories(expires_at);
  create index if not exists stories_user on stories(user_id, created_at desc);

  -- Who has already watched a story: the ring around a photo turns grey and the author can see the count.
  create table if not exists story_views (
    story_id text not null references stories(id) on delete cascade,
    user_id text not null references users(id) on delete cascade,
    created_at text not null,
    primary key (story_id, user_id)
  );

  -- Close friends: the people a status can be shared with instead of everyone who follows you. Only someone this
  -- account is connected to (one follows the other, the same rule as a direct chat) can be put on it.
  create table if not exists close_friends (
    user_id text not null references users(id) on delete cascade,   -- whose list this is
    friend_id text not null references users(id) on delete cascade,
    created_at text not null,
    primary key (user_id, friend_id)
  );
  create index if not exists close_friends_friend on close_friends(friend_id);

  -- Someone whose statuses this account would rather not see in the ring bar. They are not told, and nothing else
  -- changes: their items, chats and profile stay exactly as they are.
  create table if not exists story_mutes (
    user_id text not null references users(id) on delete cascade,
    muted_id text not null references users(id) on delete cascade,
    created_at text not null,
    primary key (user_id, muted_id)
  );

  -- Saligue Ads: sellers promote an item for a budget; shown as "Sponsored" and billed per 1,000 views (ads.mjs).
  create table if not exists ad_campaigns (
    id text primary key,
    seller_id text not null references users(id) on delete cascade,
    product_id text not null references products(id) on delete cascade,
    headline text not null default '',
    budget real not null,               -- dollars
    spent real not null default 0,
    cpm real not null,                  -- dollars per 1,000 views, fixed when created
    days integer not null,
    placements text not null default '["feed","explore"]',
    status text not null default 'pending_payment'
      check (status in ('pending_payment', 'in_review', 'active', 'paused', 'completed', 'rejected')),
    payment_ref text,
    review_note text,
    impressions integer not null default 0,
    clicks integer not null default 0,
    starts_at text,
    ends_at text,
    created_at text not null
  );
  create index if not exists ad_campaigns_status on ad_campaigns(status);

  -- Every time an ad is handed to someone: a one-time code. A view is billed only when the same viewer reports this
  -- code back after the ad was on screen for at least a second, within the daily limits (person and network).
  create table if not exists ad_serves (
    id text primary key,
    campaign_id text not null references ad_campaigns(id) on delete cascade,
    viewer text not null,               -- account id, or a hash of network + browser for visitors without one
    ip text not null,                   -- hash of the network address (never the address itself)
    placement text not null,
    created_at text not null,
    viewed_at text,                     -- a real view (on screen at least a second)
    billed integer not null default 0,  -- the view was charged to the budget (within the limits)
    clicked_at text
  );
  create index if not exists ad_serves_viewer on ad_serves(campaign_id, viewer, viewed_at);
  create index if not exists ad_serves_ip on ad_serves(campaign_id, ip, viewed_at);
  create index if not exists ad_serves_buyer on ad_serves(viewer, viewed_at);

  -- Orders that came from an ad: placed within 7 days of a click, or 1 day of a view, on the advertised item.
  create table if not exists ad_conversions (
    campaign_id text not null references ad_campaigns(id) on delete cascade,
    order_id text not null references orders(id) on delete cascade,
    quantity integer not null,
    amount real not null,
    via text not null check (via in ('click', 'view')),
    created_at text not null,
    primary key (campaign_id, order_id)
  );

  -- A shop's ad balance, line by line: unused budget comes back here and pays for later ads.
  create table if not exists ad_credits (
    id text primary key,
    user_id text not null references users(id) on delete cascade,
    campaign_id text,
    amount real not null,               -- + added, − used
    reason text not null,
    created_at text not null
  );
  create index if not exists ad_credits_user on ad_credits(user_id, created_at desc);

  -- What each person searches for (only with "OK, personalise"): matching items rise in their For You.
  create table if not exists searches (
    user_id text not null references users(id) on delete cascade,
    q text not null,
    created_at text not null
  );
  create index if not exists searches_user on searches(user_id, created_at desc);

  -- Looks: a person's named boards ("Wedding", "Office") of items and lessons, shareable by link.
  create table if not exists looks (
    id text primary key,
    user_id text not null references users(id) on delete cascade,
    name text not null,
    created_at text not null,
    updated_at text not null
  );
  create index if not exists looks_user on looks(user_id, updated_at desc);
  create table if not exists look_items (
    look_id text not null references looks(id) on delete cascade,
    kind text not null check (kind in ('product', 'lesson')),
    ref_id text not null,
    added_at text not null,
    primary key (look_id, kind, ref_id)
  );

  -- Everything someone put in their cart, kept after it leaves the cart: their "Added to cart" collection.
  create table if not exists cart_history (
    user_id text not null references users(id) on delete cascade,
    product_id text not null references products(id) on delete cascade,
    added_at text not null,
    primary key (user_id, product_id)
  );

  -- Hearts during a live, in batches with their time: they float up again at the same moment in the replay.
  create table if not exists live_hearts (
    live_id text not null references lives(id) on delete cascade,
    count integer not null,
    emoji text not null,
    created_at text not null
  );
  create index if not exists live_hearts_live on live_hearts(live_id, created_at);

  -- Devices that receive push notifications: a browser's web push subscription or the Android app's FCM token.
  create table if not exists push_targets (
    target text primary key,
    user_id text not null references users(id) on delete cascade,
    kind text not null check (kind in ('web', 'fcm')),
    keys text,
    created_at text not null
  );
  create index if not exists push_targets_user on push_targets(user_id);

  -- Reports on comments and replies (items: 'item', lessons: 'lesson'); 3 reports hide one until a moderator looks.
  create table if not exists comment_reports (
    kind text not null check (kind in ('item', 'lesson')),
    comment_id text not null,
    user_id text not null references users(id) on delete cascade,
    reason text not null,
    created_at text not null,
    primary key (kind, comment_id, user_id)
  );

  -- Price-drop and back-in-stock alerts already sent (one per person, item and kind a week).
  create table if not exists product_alerts (
    user_id text not null references users(id) on delete cascade,
    product_id text not null references products(id) on delete cascade,
    kind text not null,
    sent_at text not null,
    primary key (user_id, product_id, kind)
  );

  -- Lives announced ahead ("Friday 18:00: new kitenge"), and who asked to be reminded.
  create table if not exists live_schedules (
    id text primary key,
    seller_id text not null references users(id) on delete cascade,
    title text not null,
    starts_at text not null,
    soon_sent_at text,
    live_id text,
    created_at text not null
  );
  create index if not exists live_schedules_time on live_schedules(starts_at);
  create table if not exists live_reminders (
    schedule_id text not null references live_schedules(id) on delete cascade,
    user_id text not null references users(id) on delete cascade,
    created_at text not null,
    primary key (schedule_id, user_id)
  );

  -- Questions to a shop about an item; the shop's answer is shown to every later shopper.
  create table if not exists product_questions (
    id text primary key,
    product_id text not null references products(id) on delete cascade,
    user_id text not null references users(id) on delete cascade,
    text text not null,
    answer text,
    answered_at text,
    created_at text not null
  );
  create index if not exists product_questions_product on product_questions(product_id, created_at desc);

  -- Lessons someone watched to the end (for their weekly note), and whether they said thank you.
  create table if not exists lesson_done (
    user_id text not null references users(id) on delete cascade,
    lesson_id text not null references lessons(id) on delete cascade,
    done_at text not null,
    thanked_at text,
    primary key (user_id, lesson_id)
  );
  create index if not exists lesson_done_user on lesson_done(user_id, done_at desc);

  -- Settling sales with a shop: Saligue pays out online-paid sales minus its fee, or the shop pays the fees
  -- on sales it was paid for directly (Mobile Money to the shop, cash, pickup). amount > 0: Saligue paid the shop.
  create table if not exists shop_settlements (
    id text primary key,
    seller_id text not null references users(id) on delete cascade,
    amount real not null,
    orders integer not null,
    reference text,
    created_at text not null
  );
  create index if not exists shop_settlements_seller on shop_settlements(seller_id, created_at desc);

  -- How much each person engages with each shop's lives (double-taps/hearts, comments, gifts): it ranks lives.
  create table if not exists live_engagement (
    user_id text not null references users(id) on delete cascade,
    seller_id text not null references users(id) on delete cascade,
    hearts integer not null default 0,
    comments integer not null default 0,
    gifts integer not null default 0,     -- coins
    updated_at text not null,
    primary key (user_id, seller_id)
  );

  -- Coins (like TikTok): bought in packs, spent on gifts in lives. Each line + bought / − spent.
  create table if not exists coin_orders (
    id text primary key,
    user_id text not null references users(id) on delete cascade,
    coins integer not null,
    amount real not null,               -- dollars
    status text not null default 'pending_payment' check (status in ('pending_payment', 'paid', 'cancelled')),
    reference text not null,
    created_at text not null,
    paid_at text
  );
  create table if not exists coins (
    id text primary key,
    user_id text not null references users(id) on delete cascade,
    amount integer not null,
    reason text not null,
    live_id text,
    created_at text not null
  );
  create index if not exists coins_user on coins(user_id, created_at desc);

  create table if not exists ad_stats (
    campaign_id text not null references ad_campaigns(id) on delete cascade,
    day text not null,
    impressions integer not null default 0,
    clicks integer not null default 0,
    spent real not null default 0,
    primary key (campaign_id, day)
  );

  -- Creator monetization: applications, and monthly earnings paid by Mobile Money.
  create table if not exists creators (
    user_id text primary key references users(id) on delete cascade,
    status text not null check (status in ('applied', 'approved', 'rejected', 'suspended')),
    momo_number text not null,
    momo_name text not null,
    note text,
    applied_at text not null,
    decided_at text
  );

  create table if not exists payouts (
    id text primary key,
    user_id text not null references users(id) on delete cascade,
    period text not null,               -- YYYY-MM
    amount real not null,               -- dollars
    breakdown text not null,            -- JSON: views, sales, followers, points, pool
    status text not null default 'pending' check (status in ('pending', 'paid')),
    reference text,
    paid_at text,
    created_at text not null,
    unique (user_id, period)
  );

  -- Share & earn (shares.mjs): who opened an item from someone's shared link (the latest sharer wins),
  -- and the reward each delivered sale from such a link earns the sharer (paid by Saligue, not by the shop).
  create table if not exists share_visits (
    user_id text not null references users(id) on delete cascade,
    product_id text not null references products(id) on delete cascade,
    sharer_id text not null references users(id) on delete cascade,
    created_at text not null,
    primary key (user_id, product_id)
  );
  create table if not exists share_rewards (
    id text primary key,
    order_id text not null references orders(id) on delete cascade,
    product_id text not null,
    sharer_id text not null references users(id) on delete cascade,
    sale real not null,                 -- dollars: the item's price x quantity in that order
    amount real not null,               -- dollars: the reward, fixed when the order is placed
    -- Orders paid to the shop directly (cash, Mobile Money to the shop, pickup) are checked by an admin first:
    -- no money reached Saligue, so a shop and two accounts could otherwise fake a sale and collect the reward.
    approved_at text,
    rejected_at text,
    payout_id text,
    created_at text not null,
    unique (order_id, product_id)
  );
  create index if not exists share_rewards_sharer on share_rewards(sharer_id, created_at desc);

  -- The days each person (or guest) used Saligue: launch numbers only (daily/monthly users, who comes back).
  create table if not exists active_days (
    user_id text not null references users(id) on delete cascade,
    day text not null,                  -- YYYY-MM-DD
    primary key (user_id, day)
  );
  create index if not exists active_days_day on active_days(day);

  -- Security watch (security.mjs): attacks noticed, and addresses blocked for a while.
  create table if not exists security_events (
    id integer primary key autoincrement,
    kind text not null,
    ip text,
    country text,
    user_id text,
    detail text not null default '',
    alerted integer not null default 0,
    created_at text not null
  );
  create index if not exists security_events_time on security_events(created_at);
  create index if not exists security_events_ip on security_events(ip, kind, created_at);
  create table if not exists blocked_ips (
    ip text primary key,
    reason text not null,
    until text,                         -- null: until an admin lifts it
    by text not null,
    created_at text not null
  );

  -- How often each item is opened per day, for the seller's dashboard.
  create table if not exists product_views (
    product_id text not null references products(id) on delete cascade,
    day text not null,                  -- YYYY-MM-DD
    views integer not null default 0,
    primary key (product_id, day)
  );

  -- History: the items a person opened or scrolled past, so they can find them again (My Saligue → History).
  -- One row per item and person (seen_at is the last time, times how often), which is what makes the list
  -- short, removable one by one, and cleared in one go. Deleted with the account.
  create table if not exists view_history (
    user_id text not null references users(id) on delete cascade,
    product_id text not null references products(id) on delete cascade,
    seen_at text not null,
    times integer not null default 1,
    primary key (user_id, product_id)
  );
  create index if not exists view_history_user on view_history(user_id, seen_at desc);
`);

// Columns added after the first release.
for (const [table, column, type] of [
  // Which version of the Terms an account accepted, so an acceptance can be proved after a change.
  ['users', 'terms_accepted_at', 'text'], ['users', 'terms_version', 'text'],
  // The date of birth a new account stated, and the day it was stated (the age gate: 16+, server/index.mjs).
  ['users', 'birth_date', 'text'], ['users', 'age_checked_at', 'text'],
  ['users', 'avatar', 'text'], ['users', 'bio', 'text'], ['lessons', 'challenge_id', 'text'], ['lessons', 'duet_of', 'text'], ['lessons', 'captions', 'text'], ['users', 'admin_level', 'integer not null default 0'], ['users', 'admin_perms', "text not null default '[]'"], ['users', 'suspended', 'integer not null default 0'], ['users', 'suspend_reason', 'text'],
  // When an account was suspended, and the day it is permanently deleted if it is not restored first (90 days).
  ['users', 'suspended_at', 'text'], ['users', 'delete_after', 'text'], ['users', 'verified', 'integer not null default 0'], ['users', 'verified_type', 'text'], ['users', 'verified_at', 'text'], ['users', 'verified_until', 'text'], ['users', 'identity_checked', 'integer not null default 0'], ['users', 'verify_reminded', 'text'], ['payments', 'verification_id', 'text'], ['payments', 'renewal_id', 'text'], ['lessons', 'captions_status', 'text'], ['users', 'admin', 'integer not null default 0'], ['products', 'hidden', 'integer not null default 0'], ['products', 'type', 'text'],
  // null stock = not tracked (always available)
  ['products', 'stock', 'integer'], ['products', 'rating_avg', 'real not null default 0'], ['products', 'rating_count', 'integer not null default 0'],
  ['orders', 'paid_at', 'text'], ['orders', 'payment_ref', 'text'], ['payments', 'campaign_id', 'text'], ['payments', 'tip_id', 'text'], ['lives', 'chat_mode', "text not null default 'everyone'"], ['lives', 'slow_seconds', 'integer not null default 0'], ['lives', 'video_fit', "text not null default 'fit'"], ['lives', 'moderators', "text not null default '[]'"], ['lives', 'invited', "text not null default '[]'"],
  ['ad_campaigns', 'credit_used', 'real not null default 0'], ['live_comments', 'reply_to', 'text'], ['live_comments', 'gift', 'text'], ['tips', 'live_id', 'text'], ['payments', 'coin_order_id', 'text'], ['ad_campaigns', 'credited', 'real'], ['lives', 'thumbnail', 'text'], ['lives', 'poll', 'text'], ['lives', 'heart_goal', 'integer not null default 0'], ['lives', 'blocked_words', "text not null default '[]'"],
  ['users', 'comment_mode', "text not null default 'everyone'"], ['users', 'hidden_words', "text not null default '[]'"],
  ['products', 'deal_price', 'real'], ['products', 'deal_until', 'text'], ['products', 'deal_live_id', 'text'], ['users', 'media', 'integer not null default 0'],
  // A % off the shop put on the post itself (1–90): the shopper sees the usual price crossed out next to the new one.
  ['products', 'discount', 'integer'],
  ['lives', 'egress_id', 'text'], ['lives', 'recorder', "text not null default 'phone'"], ['lives', 'layout', "text not null default 'side'"],
  ['orders', 'delivery_code', 'text'], ['orders', 'received_by', 'text'], ['orders', 'shop_reply', 'text'], ['users', 'payout_requested_at', 'text'],
  ['orders', 'shipped_at', 'text'], ['orders', 'received_at', 'text'], ['orders', 'problem', 'text'], ['orders', 'problem_at', 'text'], ['orders', 'problem_status', 'text'],
  ['comments', 'parent_id', 'text'], ['comments', 'hidden', 'integer not null default 0'], ['lesson_comments', 'hidden', 'integer not null default 0'],
  ['lives', 'replay_video', 'text'], ['lives', 'replay_poster', 'text'], ['lives', 'replay_duration', 'integer'], ['lives', 'replay_status', 'text'], ['lives', 'replay_started_at', 'text'],
  ['users', 'username', 'text'], ['users', 'referred_by', 'text'], ['users', 'referral_rewarded', 'integer not null default 0'],
  ['orders', 'fee', 'real not null default 0'], ['orders', 'settlement_id', 'text'],
  ['products', 'video', 'text'], ['products', 'video_poster', 'text'], ['products', 'video_duration', 'integer'], ['products', 'photo_type', "text not null default 'item'"],
  // Resaligue count, and when the shop pinned the item to the top of its profile.
  ['products', 'repost_count', 'integer not null default 0'], ['products', 'pinned_at', 'text'],
  // Chats: 'shop' (a shopper and a shop) or 'direct' (two people in each other's Clients or Network);
  // a photo, video or voice note on a message (JSON, files in data/chat/), and messages taken back (unsent).
  ['conversations', 'kind', "text not null default 'shop'"], ['messages', 'attachment', 'text'], ['messages', 'deleted_at', 'text'],
  // Clearing a chat empties it for the person who did it, not for the other side: their messages before this time
  // are hidden from the clearer's view, and the chat leaves their list until something new arrives.
  ['conversations', 'buyer_cleared_at', 'text'], ['conversations', 'seller_cleared_at', 'text'],
  // The order that bought a live-drop place, so cancelling that order gives the place back to the queue.
  ['live_claims', 'order_id', 'text'],
  // How long a voice status runs (the status itself is in the stories table, under "Stories" further down).
  ['stories', 'seconds', 'integer'],
  // Who a status is for: everyone who follows you, or only the people on your close friends list.
  ['stories', 'audience', "text not null default 'everyone'"],
  // Chats put away for later, each side for itself: the other person's list is never touched by it.
  ['conversations', 'buyer_archived', 'integer not null default 0'], ['conversations', 'seller_archived', 'integer not null default 0'],
  // A message passed on from another chat says so, the way paper mail shows it was forwarded.
  ['messages', 'forwarded', 'integer not null default 0'],
]) {
  const exists = db.prepare(`select 1 from pragma_table_info('${table}') where name = ?`).get(column);
  if (!exists) db.exec(`alter table ${table} add column ${column} ${type}`);
}

// A status used to be only a photo or words. A voice note is a third kind, and SQLite can only widen a `check`
// by re-making the table: the rows are copied across, nothing is lost, and the whole thing runs once (the guard
// reads the table's own definition, so a database made by this version skips it).
const storiesDdl = db.prepare("select sql from sqlite_master where type = 'table' and name = 'stories'").get()?.sql ?? '';
if (storiesDdl && !storiesDdl.includes("'voice'")) {
  db.exec('pragma foreign_keys = off');
  try {
    db.exec(`
      begin;
      create table stories_rebuilt (
        id text primary key,
        user_id text not null references users(id) on delete cascade,
        kind text not null default 'image' check (kind in ('image', 'text', 'voice')),
        media text,
        caption text not null default '',
        background text not null default '#111111',
        product_id text references products(id) on delete set null,
        seconds integer,
        audience text not null default 'everyone',
        created_at text not null,
        expires_at text not null
      );
      insert into stories_rebuilt (id, user_id, kind, media, caption, background, product_id, seconds, audience, created_at, expires_at)
        select id, user_id, kind, media, caption, background, product_id, seconds, audience, created_at, expires_at from stories;
      drop table stories;
      alter table stories_rebuilt rename to stories;
      create index if not exists stories_expiry on stories(expires_at);
      create index if not exists stories_user on stories(user_id, created_at desc);
      commit;
    `);
  } catch (error) {
    try { db.exec('rollback'); } catch { /* nothing pending */ }
    throw error;
  } finally {
    db.exec('pragma foreign_keys = on');
  }
}
// @usernames: unique (any case), for @mentions. Accounts without one get one from their name.
db.exec("create unique index if not exists users_username on users(lower(username)) where username is not null");
export function makeUsername(base, id) {
  const clean = String(base ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9_.]+/g, '').replace(/^[._]+|[._]+$/g, '').slice(0, 20) || 'user';
  let name = clean.length >= 3 ? clean : `${clean}${id.replace(/-/g, '').slice(0, 4)}`;
  for (let i = 0; db.prepare('select 1 from users where lower(username) = ? and id != ?').get(name, id); i++) name = `${clean.slice(0, 17)}${Math.floor(Math.random() * 900 + 100)}`;
  return name;
}
for (const u of db.prepare("select id, display_name, email, shop, role from users where username is null and is_guest = 0").all()) {
  const shopName = u.role === 'seller' ? JSON.parse(u.shop || 'null')?.name : null;
  db.prepare('update users set username = ? where id = ?').run(makeUsername(shopName || u.display_name || u.email?.split('@')[0], u.id), u.id);
}

// Lesson topics that were merged: clothing care joins sewing, shoes & bags join styling.
for (const table of ['lessons', 'challenges']) {
  db.exec(`update ${table} set topic = 'sewing' where topic = 'care'`);
  db.exec(`update ${table} set topic = 'styling' where topic = 'shoes_accessories'`);
}
// Admins from before admin levels are main admins (type 1).
db.exec('update users set admin_level = 1 where admin = 1 and admin_level = 0');
// Badges from before monthly billing: documents were checked, the first month starts now.
db.prepare('update users set identity_checked = 1, verified_until = ? where verified = 1 and verified_until is null').run(new Date(Date.now() + 30 * 86_400_000).toISOString());


export const now = () => new Date().toISOString();
export const json = (value) => (value === undefined || value === null ? null : JSON.stringify(value));
export const parse = (value) => (value ? JSON.parse(value) : null);

/** Runs several statements as one all-or-nothing change. */
export function transaction(fn) {
  db.exec('begin');
  try {
    const result = fn();
    db.exec('commit');
    return result;
  } catch (error) {
    db.exec('rollback');
    throw error;
  }
}
