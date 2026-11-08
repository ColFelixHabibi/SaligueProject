# Building the Saligue iPhone app

Everything the iOS side needs, taken from this repository. Like `deploy/play-store.md`, each claim names the file it
comes from so it can be re-checked when the code changes.

Current build: `com.indeciana.saligue`, versionName **2.31**, build **42** — the same two numbers as the Android app,
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
