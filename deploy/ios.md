# Building the Saligue iPhone app

Everything the iOS side needs, taken from this repository. Like `deploy/play-store.md`, each claim names the file it
comes from so it can be re-checked when the code changes.

Current build: `com.indeciana.saligue`, versionName **2.39**, build **50** — the same two numbers as the Android app,
so the two stores never drift. They live in `ios/App/App.xcodeproj/project.pbxproj` (`MARKETING_VERSION`,
`CURRENT_PROJECT_VERSION`) and reach the app through `$(MARKETING_VERSION)` / `$(CURRENT_PROJECT_VERSION)` in
`ios/App/App/Info.plist`.

**An `.ipa` can only be produced on macOS.** Xcode and `xcodebuild` do not run on Linux, so the live server cannot
build it — the web assets can be prepared here, the signed app cannot. Two ways to get the app: the GitHub Actions
runner, or any Mac.

---

## 1. Keep the web assets in step

The iPhone app is the same Next.js site inside a WebView (`capacitor.config.ts`: `webDir: 'out'`). Whatever sits in
`ios/App/App/public` at build time is what the app opens, so it must be rebuilt before every release:

```bash
npm ci
npm run build:app
# → rebuilds the site and copies it into ios/App/App/public (and android/app/src/main/assets/public)
```

`scripts/build-app.mjs` now syncs both native projects:

- `npx cap sync ios` — normal path (Capacitor 8 uses Swift Package Manager here,
  `ios/App/CapApp-SPM/Package.swift`; there is no Podfile, so CocoaPods is not needed);
- `npx cap copy ios` — fallback on a machine without the iOS toolchain, which still refreshes the web assets;
- either way a missing iOS toolchain never stops an Android release.

Confirm the copy happened: `ios/App/App/public/_next/static/chunks/` should hold the full set of chunks for this
build, not a couple of leftovers from an old one.

### Links in WhatsApp (one line away — it needs your Apple Team ID)

A Saligue link sent on WhatsApp (a product, a look, a live, a lesson) already opens **the app on that page** on
Android, because the site publishes `/.well-known/assetlinks.json` with the signing key (`deploy/play-store.md` §1).
The iPhone equivalent is *Universal Links*. Everything except your **Apple Team ID** is in this repository:

| Piece | Where it lives |
| --- | --- |
| The address the app claims | `ios/App/App/App.entitlements` — `applinks:78-47-151-100.sslip.io`, compiled in through `CODE_SIGN_ENTITLEMENTS` in `ios/App/App.xcodeproj/project.pbxproj` |
| The answer Apple fetches | `public/.well-known/apple-app-site-association`, served by `server/index.mjs` → `serveWellKnown` as `application/json`, with no redirect |
| Keeping the pair in step | `scripts/apple-association.mjs`, run by every `node scripts/build-app.mjs` |
| Handing the link to the page | `src/components/app-links.tsx` (shared with Android) and `ios/App/App/SceneDelegate.swift` (`scene(_:continue:)`) |

To finish it, once the Apple Developer account exists:

1. Find the Team ID: Xcode → *Settings → Accounts* (the ten characters beside the team), or App Store Connect →
   *Membership*.
2. Put it in `deploy/apple-team-id` — one line, no quotes — or pass `APPLE_TEAM_ID=…` to the build.
3. Publish the file: `node scripts/build-app.mjs --apk`, or on its own
   `node -e "import('./scripts/apple-association.mjs').then((m) => m.refreshAppleAssociation())"`.
   It prints `Universal links: published <TEAM>.com.indeciana.saligue`.
4. In Xcode the target's *Signing & Capabilities* already shows **Associated Domains** →
   `applinks:78-47-151-100.sslip.io` (it comes from the entitlements file; automatic signing adds the capability to
   the App ID, so nothing needs clicking).
5. On a phone, a Saligue link tapped in Messages or WhatsApp opens the app. Apple caches the file — and caches a
   *failure* for longer — so if a link still opens Safari, reinstall the app and wait a few minutes.

Until step 2 nothing is published and the file answers `404`, which is the honest answer: iPhones open shared links
in Safari, and "Add to Home Screen" still gives the full app.

One trap: the entitlement host must be exactly the address the site is served on. `tests/universallinks.test.mjs`
compares it with `scripts/site-url.mjs` and with the Android manifest, so a domain switch that forgets one of the
three fails the test suite instead of quietly breaking links.

## 2. Build it on a Mac (App Store / TestFlight)

Install Xcode 16 or newer, signed in with the Apple Developer account for INDECIANA.

```bash
npm ci
npm run build:app
open ios/App/App.xcodeproj        # the project, not a workspace: this app has no CocoaPods workspace
```

In Xcode:

1. Select the **App** target → **Signing & Capabilities** → pick the team, tick *Automatically manage signing*.
   The bundle id is already `com.indeciana.saligue`, matching the Android application id.
2. Set the destination to **Any iOS Device (arm64)** — an Archive needs a real device target.
3. **Product → Archive** (this also builds for its own use, so nothing else needs running first).
4. In Organizer: **Distribute App → App Store Connect → Upload**.

Then add the build to TestFlight in App Store Connect. Every later upload needs a higher build number: bump
`CURRENT_PROJECT_VERSION` (and `MARKETING_VERSION` when the user-facing version changes) in
`ios/App/App.xcodeproj/project.pbxproj`, and the matching `versionCode` / `versionName` in
`android/app/build.gradle`.

## 3. Build it without a Mac (CI)

`.github/workflows/apps.yml`, job `ios`, runs on `macos-15` and every push to `main`:

```bash
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath build CODE_SIGNING_ALLOWED=NO build
```

That proves the app **compiles** against every change; it deliberately does not sign, so it cannot be installed on a
phone. It uploads `saligue-ios-simulator.zip` from the run's artifacts. The job becomes a distributable build only
once an Apple Developer certificate and provisioning profile are added as repository secrets.

## 4. What App Review asks, and where the answer already is

| Apple asks | Where it is answered |
| --- | --- |
| iPhone-only permission wording | `ios/App/App/Info.plist` — camera, microphone ("…and to record a voice status"), photo library |
| Works on 64-bit devices only | `ios/App/App/Info.plist` — `UIRequiredDeviceCapabilities` = `arm64` (a 32-bit `armv7` there gets the bundle rejected as uninstallable) |
| Minimum iOS version | `IPHONEOS_DEPLOYMENT_TARGET = 15.0` |
| Account deletion inside the app | `src/app/my-account/settings/page.tsx` → `DELETE /api/account` (`server/index.mjs`) |
| Age gate | 16+, `MIN_AGE` in `server/index.mjs`; date of birth captured at sign-up |
| No in-app purchase of coins (App Store billing rules) | `src/lib/native.ts` — coin sales are switched off inside the app |
| Privacy policy and terms | `/privacy`, `/policies`, `/cookies` (`src/lib/policies.ts`) |
| Content that can be reported or hidden | comments, story replies, block list (`src/lib/blocks.ts`) |
