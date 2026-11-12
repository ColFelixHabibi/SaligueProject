# Saligue — Mirror My-Self

A fashion marketplace where shoppers can search for clothes, shoes, or accessories and preview items on a photo of themselves. Sellers list products, manage orders, and share shop contact details.

Most AI runs on the user's device (browser or installed app), and a shopper photo only leaves the phone for a
*realistic* try-on — the one they confirm first, which goes to Saligue's own AI server.

## AI features

**On the shopper's device** — the quick preview, nothing leaves the phone:

| Step | Model | Code |
|---|---|---|
| Remove the background from a shopper photo | MODNet | `src/lib/ai/segment.ts` |
| Cut out a seller's item photo | U-2-Netp | `src/lib/ai/segment.ts` |
| Detect body landmarks | MediaPipe Pose Landmarker lite | `src/lib/ai/pose.ts` |
| Place garments on the body | Landmark geometry | `src/lib/ai/dress.ts` |
| Search by text or photo | MobileCLIP-S0 / Transformers.js | `src/lib/ai/embed.ts`, `src/lib/search.ts` |

**On Saligue's side** — the realistic look and the words:

| Step | What runs | Code |
|---|---|---|
| Turn the shopper's words into a real picture prompt | DeepSeek, fast model | `server/index.mjs` (`/api/ai/look`), `server/ai-keys.mjs` |
| Redraw the garment on the shopper's photo | Saligue's own AI Studio (Leffa + SDXL inpainting), then FASHN on fal.ai, then free public models | `server/tryon.mjs`, `ai-server/server.py` |
| Check that only that garment changed, before the look is shown | the app | `src/lib/ai/composite.ts` |
| Write a seller's item description from the details they typed | DeepSeek | `server/index.mjs` (`/api/ai/write`), `src/components/write-with-ai.tsx` |
| Pick an outfit for where a shopper is going, from what Saligue really sells | DeepSeek, chat model (not the reasoner: it spends its budget thinking) | `server/stylist.mjs` (`/api/ai/stylist`), `src/app/stylist/page.tsx` |

A shopper photo leaves the phone only when they ask for a realistic look, and only after confirming it is them
(`src/lib/ai/consent.ts`). Our own Studio is always tried first; the free public models are the fallback that finishes
the job when it and the paid one cannot, never the first choice. **Look quality** in the Fitting Room (`fast`, `high`,
`ultra`) says how much work each AI may do: it becomes steps for the free models, FASHN's performance or quality mode,
and the Studio's own presets, and it is part of what a look is kept under, so a quick look is never handed back as the
best one.

The **AI Stylist** (`/stylist`, the front door of the Fitting Room) is the friendlier half of the same work: a shopper
says where they are going, size and budget, and one to four pieces come back with a line each, ready to be tried on. It
is built to be trusted rather than clever — it may only choose ids from a shortlist of items that are in stock and
already ranked by that shopper's own behaviour (`server/recommend.mjs`), so it cannot invent a product, a shop, a size
or a price, and the size and budget it is given are hard limits. With no AI key, a busy model, a guest account (whose
questions never spend Saligue's key) or twenty questions in an hour, it answers from that same ranking and the card
says so plainly instead of pretending the AI said it. Only a question that really reaches the AI spends one of those
twenty: a guest's question and one too short to answer cost no token, so a visitor who tries the stylist as a guest and
then registers is not left an hour without its key — the guest becomes the account, and the account's own key works at
once. It answers in the shopper's own language, Kinyarwanda and French
included; that answer is kept in `DICT` (`src/lib/i18n.ts`) as well, so the no-AI reply is translated too rather than
leaving a Kinyarwanda shopper reading English.

There are two dictionaries, and they do different jobs: `DICT` holds what the screens ask for by name (`t('Follow')`)
and is also the fallback for whole texts, while `public/i18n/<lang>.json` holds the long body copy the page translator
matches in place. `tests/i18n.test.mjs` checks the first against the screens, and now checks that both `.json` files
still parse (a stray comma there silently turns every screen back to English), carry no blank line, and say the same
things in both languages — plus that the stylist's no-AI replies stay in `DICT`, since no `t()` call would notice them
going.

### What the AI learns

Nothing is trained. A few counters around the models are what makes them better every week — three tables in
`server/db.mjs`, the rules in `server/ai-learn.mjs`:

- a **description the seller keeps** is compared word for word with the AI's draft; kept ones become the examples the
  next draft for that shop follows (their own voice first, the rest of the marketplace after), and a rewritten draft
  never becomes a model of good writing;
- every **realistic look** is counted against the AI that drew it and the part of the body. When shoppers clearly keep
  the free models' looks (70% or more, at least 8 answers) and clearly throw the paid one's away (45% or less), the
  chain tries the free ones first; otherwise the honest order stands: our own Studio, then the paid model, then the
  free ones;
- **tokens** are counted per account, model and purpose, so a cut-off key or a prompt that grew shows up early;
- every **stylist question** is kept in the shopper's own words, so the next answer carries on from the last one ("last
  time it was a wedding"), and an item opened afterwards is counted as follow-through
  (`/api/ai/stylist/feedback`). Only questions the AI actually answered are counted, so a quiet fallback cannot flatter
  the numbers.

INDECIANA reads all of it in **Admin → Platform → What the AI has learned**
(`src/components/admin/ai-learning-admin.tsx`, `GET /api/ai/learning`): the writer's counts and the examples in use,
each try-on engine's kept rate and seconds per look, and what the stylist was asked and how often its advice was
followed. Saligue's own Studio is told what shoppers keep too, and nudges its guidance for that part of the body a
little (`ai-server/server.py`, `POST /api/feedback`). `tests/ai-learn.test.mjs` pins the rules, and the "what the AI
learns" cases in `tests/api.test.mjs` walk each loop all the way round — a draft written, published and put in front of
the writer as an example; a kept look voting for the engine that drew it; an outfit chosen and opened afterwards —
because a loop that stops half-way is the one bug nobody would notice.

Models are downloaded on first use and cached by the browser. Product photos and their cut-outs are stored with the product in Supabase; try-on photos remain on the shopper's device.

## Statuses, chats and what stays private

A status is a photo, a line of words or a voice note that clears itself after 24 hours. It goes to everyone who follows
the author, or to a **close friends** list chosen in the composer. That list only accepts someone the account is already
connected to — it follows them or they follow it, the same rule a direct chat uses (`/api/close-friends`), so a stranger
cannot be put on it. The server drops a close status for anyone not on the author's list *before* the bar is built
(`server/index.mjs`), so the audience is enforced on the server, not by hiding it in the app.

**Muting** somebody's statuses takes their ring out of this account's bar and touches nothing else: their items, chats
and profile stay as they were, and they are never told (`/api/stories/mute/:id`). It is reversible from the same bell.

**Archiving** a chat puts it away for one side only — `conversations.buyer_archived` and `seller_archived` are separate
columns — so the other person still sees the chat, nothing is deleted, and the row comes back from "Archived" whenever
it is wanted (`/api/conversations/:id/archive`). This is different from clearing a chat, which hides its messages from
that one account until something new is written in it.

**Forwarding** copies a message into another chat of the same account, marked "Forwarded". The text, the item and the
order travel with it; a photo, video or voice note never does — that file belongs to the message it was sent with, and
unsending that message deletes the file outright (`removeChatFiles` in `server/chat-media.mjs`), so a second reference
would break the original. `tests/social.test.mjs` pins that rule so it cannot be "improved" into data loss later, and the
end-to-end cases in `tests/api.test.mjs` prove the four features over HTTP: a close status reaches the list and nobody
else, a mute hides one account's ring only, an archive is per side and deletes nothing, and a forward outlives the
message it was copied from.

The screens are `src/components/social/story-bar.tsx` (composer and audience), `story-viewer.tsx` (mute, remove) and
`src/components/messages/inbox.tsx` (archive, forward), over `src/lib/stories.ts` and `src/lib/messages.ts`. All copy
added with these features is translated into Kinyarwanda and French, and `tests/i18n.test.mjs` fails on any string
handed to `t('…')` that is missing from the dictionary in `src/lib/i18n.ts`.

## Accounts and security

A **password** is stored as scrypt output with a salt of its own. Before a sign-in is checked, the stored string is
matched against the shape this server writes, so a row edited by hand or damaged on disk is answered as a wrong
password (401) instead of crashing the check into a 500.

A **session** is a random token handed to the device; the database keeps only its SHA-256 (`sessionHash` in
`server/index.mjs`), so a copy of `data/saligue.db` is not a set of logins. Rows written before that change keep
working and are converted the first time they are used. The cookie is `HttpOnly`, `Secure` and `SameSite`, every
JSON answer (tokens, own data, refusals) carries `nosniff` and `no-store`, and signing out deletes the row.

Failed sign-ins are counted per key, and that map is bounded and pruned, so a flood of random addresses cannot grow
it without limit. A **suspended** account is refused on both paths — email and Google — rather than only the first.
Google's ID token is verified against Google's keys before an account is created or entered.

Accounts on this server are not the only secret it keeps: a shopper's own AI key is sealed (as `enc2`) with the key
in `/etc/saligue/seal.key`, outside the database, so a copy of the database alone opens nothing (`server/ai-keys.mjs`).
Uploaded photos and voice notes live under `data/`. Nothing there is writable by any account but the server's
(`755` directories, the database at `600`, media at `644`), and `.env.local` — which holds the Supabase keys — is
`600` as well.

The server itself runs sandboxed: `NoNewPrivileges`, `ProtectSystem=full`, `ProtectHome=read-only`, a private
`/tmp` and address families limited to `AF_INET`, `AF_INET6` and `AF_UNIX`, with `UMask=0027` so the files it
creates are never for everyone (`saligue.service`). It keeps root deliberately — Admin → Security reads the
journal, `ufw` and `fail2ban` — and the nightly backup is its own unit with its own access.

Pages carry a Content-Security-Policy built in `server/csp.mjs` (overridable with `SALIGUE_CSP` in
`/etc/saligue.env`), and Caddy answers HTTPS with a Let's Encrypt certificate for the hostname, renewing it
automatically, with HSTS. The bare address is a permanent redirect to that hostname and never the app itself:
plain HTTP there would carry passwords and session tokens in the clear, and a certificate for the address cannot
be issued on this box because its port 80 does not answer challenges.

## Supabase setup

1. Create a Supabase project and run [`supabase/schema.sql`](supabase/schema.sql) in its SQL Editor.
2. In **Authentication → Providers**, enable Anonymous, Email, and Google sign-in. Enable identity linking so guest accounts can be upgraded to Google accounts.
3. Add `http://localhost:9002/**` and the deployed site URL to **Authentication → URL Configuration → Redirect URLs**. Configure Google OAuth in the provider settings and add the Supabase callback URL shown there (`https://<project-ref>.supabase.co/auth/v1/callback`) as an authorized redirect URI in Google Cloud.
4. Copy `.env.example` to `.env.local` and set the project's URL and anon key.


## Develop

```bash
npm install
npm run dev        # http://localhost:9002
```

## Publish

Saligue runs on its own server (`npm run build`, then `node server/index.mjs` behind HTTPS), which serves the website,
the API and the database together. The live test address is https://78-47-151-100.sslip.io.

## Android and iOS

The site is installable as a web app. Open the published link on a phone and choose **Add to Home Screen** (iPhone: Share → Add to Home Screen; Android: menu → Install app). It opens full-screen with its own icon.

Native apps wrap the same site (`capacitor.config.ts`, `webDir: 'out'`):

```bash
node scripts/build-app.mjs --apk    # signed APK → data/downloads/saligue.apk, downloaded from /download/saligue.apk
node scripts/build-app.mjs --aab    # signed bundle for Google Play → dist/
```

Both commands rebuild the website into the native projects, so the apps always carry the current code. The Android
app can be built anywhere with the Android SDK; the iPhone app needs macOS and Xcode — see
[deploy/play-store.md](deploy/play-store.md) and [deploy/ios.md](deploy/ios.md).

Shared links open the app, not a browser tab: a Saligue link sent on WhatsApp lands on that product, look, live or
lesson. Android is switched on by `public/.well-known/assetlinks.json` (`scripts/assetlinks.mjs`), the iPhone by
`public/.well-known/apple-app-site-association` plus the Associated Domains entitlement
(`scripts/apple-association.mjs`) — the iPhone half waits for an Apple Team ID in `deploy/apple-team-id`.
Android names a key per install channel: the build publishes the key it signs the APK with, and when Play App
Signing re-signs the bundle, Google's certificate goes in `deploy/play-signing-sha256` — a rebuild adds it beside
the first, because a phone that installed from Play compares against Google's key and one that installed from the
site compares against ours.

The one link that does not stay inside the app is the download: `/download/` asks for the APK as soon as it opens, and
the app hands those addresses to the phone's browser (`openInBrowser` in `src/lib/native.ts`), because the WebView
cannot save a file — the in-app **Update** banner takes the same road. That handoff depends on
`server.allowNavigation` staying empty in `capacitor.config.ts`: Capacitor keeps listed sites in the WebView, and a
download kept there does nothing.

## Licence

Proprietary. Copyright © 2026 INDECIANA. All rights reserved. See [LICENSE](LICENSE).
