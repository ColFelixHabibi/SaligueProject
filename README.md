# Saligue — Mirror My-Self

A fashion marketplace where shoppers can search for clothes, shoes, or accessories and preview items on a photo of themselves. Sellers list products, manage orders, and share shop contact details.

AI features run on the user's device (browser or installed app). Shopper photos are not uploaded by the try-on flow.

## AI features

| Step | Model | Code |
|---|---|---|
| Remove the background from a shopper photo | MODNet | `src/lib/ai/segment.ts` |
| Cut out a seller's item photo | U-2-Netp | `src/lib/ai/segment.ts` |
| Detect body landmarks | MediaPipe Pose Landmarker lite | `src/lib/ai/pose.ts` |
| Place garments on the body | Landmark geometry | `src/lib/ai/dress.ts` |
| Search by text or photo | MobileCLIP-S0 / Transformers.js | `src/lib/ai/embed.ts`, `src/lib/search.ts` |

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
