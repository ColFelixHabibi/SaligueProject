# Putting Saligue on Google Play

Everything the Play Console asks for, taken from this repository: the exact commands, the listing text, and the
data-safety answers that match what the code actually does. Nothing here is guessed — each claim names the file it
comes from, so it can be re-checked when the code changes.

Current build: `com.indeciana.saligue`, versionCode **42**, versionName **2.31**, minSdk 24, targetSdk 36.
The iOS app carries the same two numbers (`ios/App/App.xcodeproj/project.pbxproj`), so the two stores never drift.

---

## 1. The build you upload

Play takes a **bundle**, not an APK. The release script already produces one, signed with the same key as the APK:

```bash
node scripts/build-app.mjs --aab
# → dist/saligue-2.32-43.aab   (and data/downloads/saligue.apk, and the live website rebuilt)
```

**Upload that `.aab`. Never the `.apk`.** The bundle goes to `dist/`, deliberately never to `data/downloads/`
(see the comment in `scripts/build-app.mjs`): phones download the APK from the site, the bundle is for the Play
Console only.

**Always build through that script, never `./gradlew bundleRelease` directly.** The script parks the on-device AI
models (`public/models`, 216 MB) so they are not copied into the app — the app loads them from the server. A bundle
assembled by hand picks up whatever the previous sync left in `android/app/src/main/assets/public`, and a stray
`node scripts/build-app.mjs` run (the offline variant, no flag) leaves the models there: the bundle then comes out at
**158 MB instead of ~34 MB**. A sane `.aab` is 33–35 MB, roughly the same as the APK; anything near 100 MB means the
models leaked in, so re-run the script before uploading.

### Enrol your existing key in Play App Signing

`android/app/build.gradle` signs with the project's own keystore, not one Google generated. When you create the app in
Play Console, choose **"Use an existing app signing key"** and upload the same key (or let Play generate one and keep
your key as the upload key). If you let Google make a *different* app signing key, every phone that installed
`saligue.apk` from the site gets "App not installed" when it tries to update from Play. Keep one key.

After the first upload, **every later upload must have a higher `versionCode`** in `android/app/build.gradle`
(currently `versionCode 43`). `/api/app/version` reads the same number, so the in-app "update available" banner and
the Play update arrive from one source.

### Links in WhatsApp must open the app

A Saligue link sent in WhatsApp (a product, a look, a live, a lesson) opens **the app on that page**, not a browser
tab. Android grants that only when the site publishes the SHA-256 of the key the installed app is signed with, at:

```
https://78-47-151-100.sslip.io/.well-known/assetlinks.json
```

- The file is `public/.well-known/assetlinks.json`, served straight from the repository by the server (so a stale
  `out/` can never publish an old key). The app side is the `autoVerify` filter in
  `android/app/src/main/AndroidManifest.xml`; `src/components/app-links.tsx` turns the incoming link into the page.
- `scripts/build-app.mjs` reads the key back from `/etc/saligue/android-signing.properties` before every app build
  and publishes its fingerprint (`scripts/assetlinks.mjs`), so **a rotated key cannot leave this file stale**.
  It prints `App links: signing key published (E4:9B:D9:DE…)` — commit the file if it changed.
- **If Play signs your app with Google's key** (Play App Signing, which is the default and keeps the upload key
  above as a separate key), Play re-signs the APK, so Android compares against **Google's** certificate. Copy it
  from Play Console → *Test and release → App integrity → App signing key certificate → SHA-256 certificate
  fingerprint* and add it as a second entry in `sha256_cert_fingerprints`. Without it, links open a browser on
  installs that came from Play, while the APK from the site keeps working — an easy thing to miss.
- Check it on a phone: **Settings → Apps → Saligue → Open by default → Add links** should list the address as
  verified, or run
  `adb shell pm get-app-links com.indeciana.saligue` (look for `verified`) and
  `adb shell am start -a android.intent.action.VIEW -d "https://78-47-151-100.sslip.io/product/?id=<id>"`.
- Nothing here needs a domain of its own; `deploy/switch-domain.sh` moves the address, and the new host must then be
  **added** (not substituted) in the manifest, because phones already installed were built with the old one.

---

## 2. Listing text

**App name** (30 characters max — Play rejects more):

```
Saligue
```

**Short description** (80 characters max):

```
Buy and sell fashion from local shops near you — live, in Kinyarwanda, with Mobile Money.
```

**Full description** (4000 characters max):

```
Saligue is fashion shopping built for Rwanda.

Local shops list their clothes, shoes and bags in minutes, straight from a phone. Shoppers see what is actually
available nearby, try it on before paying, and receive it at home or pick it up at the shop.

TRY IT ON BEFORE YOU BUY
Take one photo of yourself and see a shop's item on your own body. Saligue's AI works on the shop's item and your
photo, then shows you the result in seconds. Your photo is used only for that try-on, only with your consent, and
you can delete it at any time.

SHOP LIVE
Watch a shop go live and buy in the moment. Ask questions in the chat, and the shop shows the item on camera. Shops
can hold an item up for claiming ("drops"), run a quick poll, take a guest on camera, and send the replay afterwards
so nothing is missed.

LEARN FROM PEOPLE WHO SEW
Short lessons on styling, sewing, traditional wear and running a fashion business — with duets, so you can answer a
lesson with your own.

SELL WITHOUT A SHOP FRONT
Switch to selling in the app: add your items with a photo, set your price, and share your shop with a link. Every
shopper who buys from your link earns you more reach, and Saligue pays the sharer, not you.

PAY THE WAY YOU ALREADY PAY
Mobile Money. Delivery or pickup, you choose.

BUILT FOR RWANDA
English, Kinyarwanda and French. Light on data: photos are resized on your phone before they are sent. Works on
older Android phones (Android 7 and up).

SAFETY
Block anyone, report an item, a comment or a person, and Saligue's moderators look at every report. You can download
everything Saligue holds about you, and delete your account from inside the app.

Questions: see the terms and privacy policy at the links on this page.
```

**Category:** Shopping. **Tags:** Fashion, Marketplace, Live shopping.

**Contact details** — Play requires all three to be public on the listing:

| Field | Value |
|---|---|
| Developer name | INDECIANA |
| Email | `saligue.shop@gmail.com` (the address already used in the in-app mail composer, `src/app/admin/page.tsx:160`) — change it here and in Play together if you use another |
| Website | `https://78-47-151-100.sslip.io/` — **replace with the real domain before submitting**, see §7 |
| Privacy policy | `https://78-47-151-100.sslip.io/privacy` (served by `src/app/privacy/page.tsx`) |

---

## 3. Graphics Play will ask for

| Asset | Size | Notes |
|---|---|---|
| App icon | 512 × 512 PNG, no transparency | the same mark as `android/app/src/main/res/` |
| Feature graphic | 1024 × 500 PNG/JPEG | top of the listing, no text needed |
| Phone screenshots | 2–8, at least 320 px, 16:9 or 9:16 | see the shot list below |

Shot list that shows what makes Saligue different (take them on a phone, in order):
1. For You feed with the status rings and a live ring at the top.
2. An item page with the **Wear it** button.
3. A try-on result (your own photo, a shop's dress).
4. A shop live: chat, gifts, and an item pinned with its Buy button.
5. A live **drop** with the claim countdown.
6. The status composer with **An item with this status** attached.
7. The seller dashboard: orders and earnings.
8. Language set to Kinyarwanda (proves the trilingual claim).

---

## 4. Data safety — the answers that match the code

Play will compare your answers with what the app actually does and can reject it for a mismatch. These are taken
from `server/index.mjs`, `server/db.mjs` and `src/`:

| Data type | Collected? | Purpose | Notes / where |
|---|---|---|---|
| Name, email | Yes | Account management | `POST /api/auth/register`, `PATCH /api/auth/me` |
| Date of birth | Yes | Age assurance (16+) | asked once at sign-up; **only the age is kept and never returned to any client** (`tests/api.test.mjs` proves it) |
| Phone number | Yes | Payouts and orders | `tip_accounts`, order delivery |
| Photos | Yes | App functionality | item photos, statuses, optional try-on photo (consent first, `src/lib/ai/consent.ts`) |
| Messages | Yes | App functionality | buyer ↔ shop chat |
| Other user-generated content | Yes | App functionality | comments, statuses, lessons, live chat |
| App activity | Yes | App functionality, personalisation | likes, follows, orders, searches, interest signals (cookie-consent gated, `src/lib/taste.ts`) |
| Device or other IDs | Yes | Notifications | push registration tokens (`push_targets`) |
| Crash logs | Yes | Diagnostics | `POST /api/client-errors` from `src/lib/report-error.ts` |
| Location | **No** | — | the chosen city stays in the phone's storage only ("It stays on this phone only", `src/lib/i18n.ts`) |
| Payment info (card numbers) | **No** | — | Mobile Money is handled outside the app; Saligue stores order and payout records, not card data |

**Security practices:** data is encrypted in transit (HTTPS with HSTS, verified on a live response), and **users can
request that their data be deleted** — in-app, from Settings → Delete my account (`src/components/delete-account.tsx`),
with a type-DELETE confirmation. Users can also download their data (`GET /api/auth/me/export`).

**No third-party ads or analytics SDKs ship in the app** — `package.json` contains no AdMob, Firebase Analytics or
Sentry dependency. The "sponsored" items in the feed are Saligue's own placements (`src/lib/ads.ts`), which Play does
not treat as advertising.

---

## 5. Content rating (IARC questionnaire)

| Question | Answer |
|---|---|
| Violence, blood, fear | No |
| Sexuality, nudity | No (fashion photos are ordinary product and outfit photos, moderated) |
| Profanity | No in the app's own text. Users write their own comments and messages, and a user can hide words they do not want to see (Settings → hidden words, `server/index.mjs:706`) |
| Drugs, alcohol, gambling | No |
| **User-generated content** | **Yes** — comments, statuses, lessons, live chat, buyer–shop messages |
| **Users can interact / share content** | **Yes** |
| **Moderation** | Yes — block (`src/lib/blocks.ts`), report an item / comment / person, moderator tools at `/admin` |
| Purchases | Yes — physical goods and tips, paid by Mobile Money |
| Ads | No |
| Designed for children | No — Saligue is 16+ |

Expected outcome: an **Everyone / Teen** style rating with the "Users can interact" and "Shares location-independent
user content" flags. Declare the UGC: hiding it is the fastest way to a rejection.

---

## 6. What the reviewer will be asked to do

Play testers cannot guess how to reach the distinctive parts. Put this in **App access → Instructions**:

```
Saligue works without signing in for browsing, but Live and Try-on need an account.
Test account: <email> / <password>
   (make one before submitting: register with a date of birth before 2009, then open /sell once
    to switch the account to a shop — Live is for shops only.)
Live: open Live in the bottom bar → Go live. The camera needs HTTPS, which Play builds always use.
Try-on: open any item → Wear it → choose a photo → allow the camera. Consent is asked once.
Payment is Mobile Money, handled outside the app; physical goods only.
No card payment is possible in-app, by design (see the native-app rule in src/lib/native.ts).
```

Create that test account ahead of time, with at least one active item and one story posted, so the reviewer sees a
normal app rather than empty screens.

---

## 7. Before you submit — two things outside the code

1. **A real domain.** The app, the APK, share links and every API call currently carry
   `78-47-151-100.sslip.io`, an IP with dashes. Play accepts the app, but a listing pointing at that address looks
   untrustworthy and some networks block `sslip.io` DNS. Point two A records at `78.47.151.100`, then
   `deploy/switch-domain.sh <domain> --apply` and rebuild with `node scripts/build-app.mjs --aab`. Everything else
   here (privacy policy URL, website, the API origin baked into the bundle) becomes the new domain automatically.
2. **The keystore and `play-store.json` service key.** Back up the keystore in `android/` somewhere safe and offline.
   Losing it means you can never update the app — Play App Signing helps only after the first upload.

---

## 8. After release

- Each release: bump `versionCode` and `versionName` in `android/app/build.gradle`, run
  `node scripts/build-app.mjs --aab`, upload the `.aab`. The same run refreshes the direct-download APK and the
  `/api/app/version` record, so both channels stay on the same build.
- Keep the listing's privacy policy link pointed at `/privacy`, which is generated from `src/lib/policies.ts` and can
  be edited by an admin in the app (`DEFAULT_POLICIES`).
- Data-safety answers change if you ever add an analytics or ads SDK. If you do, update §4 in the same commit.
