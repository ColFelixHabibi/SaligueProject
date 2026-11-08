// Builds the Android/iOS apps' web part, served from inside the app and talking to the Saligue server.
//   node scripts/build-app.mjs                 → bundle everything (AI models inside the app, works offline)
//   node scripts/build-app.mjs --apk           → also build the Android app (signed release APK) into data/downloads/saligue.apk;
//                                                AI models load from the server, so the app stays small
//   node scripts/build-app.mjs --aab           → also build the Play Store bundle (signed .aab) into dist/saligue-<version>.aab
// The server address comes from scripts/site-url.mjs (SALIGUE_SERVER, SITE_URL, or /etc/saligue.env).
// The app build temporarily replaces the website's build (out/); with --apk the website is rebuilt at the end.
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { siteUrl } from './site-url.mjs';

const aab = process.argv.includes('--aab');
// A Play Store bundle is built like the APK: models load from the server, so the app stays small.
const apk = process.argv.includes('--apk') || aab;
const server = siteUrl();
const DATA = resolve(process.env.SALIGUE_DATA || 'data');
// The app knows its own version, so it can tell when the server has a newer one (update banner).
const gradle = readFileSync('android/app/build.gradle', 'utf8');
const versionCode = Number(/versionCode\s+(\d+)/.exec(gradle)?.[1] ?? 0);
const versionName = /versionName\s+"([^"]+)"/.exec(gradle)?.[1] ?? '';
const env = {
  ...process.env,
  NEXT_PUBLIC_APP_VERSION: String(versionCode),
  NEXT_PUBLIC_BASE_PATH: '',
  NEXT_PUBLIC_API_URL: server,
  ...(apk ? { NEXT_PUBLIC_BUNDLED_MODELS: '0', NEXT_PUBLIC_MODELS_URL: `${server}/models` } : { NEXT_PUBLIC_BUNDLED_MODELS: '1' }),
};
const run = (cmd, cwd) => execSync(cmd, { stdio: 'inherit', env, cwd });

run('node scripts/copy-ort.mjs');
if (!apk) run('node scripts/bundle-models.mjs');
// Models stay out of the app when they load from the server, so they are parked for the app build.
// Parked at the repository root: outside public/ (which `cap sync` copies wholesale into the app's assets,
// so a copy parked inside it ended up in the APK — every model shipped twice, though the app loads them from
// <server>/models), and on the same filesystem as public/ so the rename cannot fail.
const parked = '.models-parked';
const stale = 'public/.models-parked';
if (existsSync(stale)) {
  // An older build parked inside public/, and may have been cut short. Put the models back before anything else.
  if (existsSync('public/models')) rmSync(stale, { recursive: true, force: true });
  else renameSync(stale, 'public/models');
}
if (apk && existsSync('public/models')) renameSync('public/models', parked);
try {
  run('npx next build');
  // `cap sync` copies public/ wholesale into the app's assets, so clear any model files an older or
  // cut-short build left behind there: parked models were once duplicated into the APK, and the app
  // reads them from <server>/models, never from its own assets.
  for (const leftover of ['android/app/src/main/assets/public/.models-parked', 'android/app/src/main/assets/public/models']) {
    rmSync(leftover, { recursive: true, force: true });
  }
  run('npx cap sync android');
  // The iPhone app must carry the same web build as the Android one, or it opens an old version of Saligue:
  // `cap copy ios` alone refreshes the web assets, while `cap sync ios` additionally runs `pod install`,
  // which needs CocoaPods and therefore macOS. Try the full sync, fall back to the copy, and never let a
  // missing iOS toolchain stop an Android release.
  if (existsSync('ios/App')) {
    try {
      run('npx cap sync ios');
    } catch {
      try {
        run('npx cap copy ios');
      } catch {
        console.warn('iOS web assets not refreshed — run `npx cap copy ios` on a Mac before archiving.');
      }
    }
  }
} finally {
  // Put the website's models back (a run cut short mid-build leaves them parked).
  if (existsSync(parked)) {
    if (existsSync('public/models')) rmSync(parked, { recursive: true, force: true });
    else renameSync(parked, 'public/models');
  }
}

if (apk) {
  run('./gradlew --no-daemon assembleRelease', 'android');
  const built = 'android/app/build/outputs/apk/release/app-release.apk';
  if (!existsSync(built)) throw new Error('No signed APK: create the signing key first (see android/app/build.gradle).');
  const target = join(DATA, 'downloads');
  mkdirSync(target, { recursive: true });
  copyFileSync(built, join(target, 'saligue.apk'));
  // Installed apps compare this with their own version and offer the update.
  writeFileSync(join(target, 'saligue.json'), JSON.stringify({ versionCode, versionName, builtAt: new Date().toISOString() }));
  // The Play Store takes a bundle, not an APK. Same code, same version, same signing key: enrol it in Play App
  // Signing with this existing key (not a key Google makes), or phones that installed the APK cannot update from Play.
  // It goes to dist/, never to data/downloads: the bundle is for the Play Console, not for phones.
  if (aab) {
    run('./gradlew --no-daemon bundleRelease', 'android');
    const bundle = 'android/app/build/outputs/bundle/release/app-release.aab';
    if (!existsSync(bundle)) throw new Error('No signed bundle came out of bundleRelease.');
    mkdirSync('dist', { recursive: true });
    copyFileSync(bundle, join('dist', `saligue-${versionName}-${versionCode}.aab`));
  }
  // Put the website's own build back (with its AI models), so the live site keeps working.
  execSync('npm run build', { stdio: 'inherit', env: { ...process.env, NEXT_PUBLIC_API_URL: '', NEXT_PUBLIC_MODELS_URL: '', NEXT_PUBLIC_BUNDLED_MODELS: '' } });
  console.log(`Android app ready: ${server}/download/saligue.apk${aab ? ` and dist/saligue-${versionName}-${versionCode}.aab for the Play Console` : ''}.`);
  console.log('Website rebuilt and live. Restart the server only if server/ changed since it last started.');
}
