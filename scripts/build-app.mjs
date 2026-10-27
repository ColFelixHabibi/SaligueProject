// Builds the Android/iOS apps' web part, served from inside the app and talking to the Saligue server.
//   node scripts/build-app.mjs                 → bundle everything (AI models inside the app, works offline)
//   node scripts/build-app.mjs --apk           → also build the Android app (signed release APK) into data/downloads/saligue.apk;
//                                                AI models load from the server, so the app stays small
// SALIGUE_SERVER sets the server address (default: SITE_URL, else the live link).
// The app build temporarily replaces the website's build (out/); with --apk the website is rebuilt at the end.
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const apk = process.argv.includes('--apk');
const server = (process.env.SALIGUE_SERVER || process.env.SITE_URL || 'https://78-47-151-100.sslip.io').replace(/\/+$/, '');
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
// Models stay out of the app when they load from the server.
const parked = 'public/.models-parked';
if (apk && existsSync('public/models')) renameSync('public/models', parked);
try {
  run('npx next build');
  run('npx cap sync android');
} finally {
  if (existsSync(parked)) renameSync(parked, 'public/models');
}

if (apk) {
  run('./gradlew --no-daemon assembleRelease', 'android');
  const built = 'android/app/build/outputs/apk/release/app-release.apk';
  if (!existsSync(built)) throw new Error('No signed APK: create the signing key first (see android/app/build.gradle).');
  const target = join(resolve(process.env.SALIGUE_DATA || 'data'), 'downloads');
  mkdirSync(target, { recursive: true });
  copyFileSync(built, join(target, 'saligue.apk'));
  // Installed apps compare this with their own version and offer the update.
  writeFileSync(join(target, 'saligue.json'), JSON.stringify({ versionCode, versionName, builtAt: new Date().toISOString() }));
  // Put the website's own build back (with its AI models), so the live site keeps working.
  execSync('npm run build', { stdio: 'inherit', env: { ...process.env, NEXT_PUBLIC_API_URL: '', NEXT_PUBLIC_MODELS_URL: '', NEXT_PUBLIC_BUNDLED_MODELS: '' } });
  console.log(`Android app ready: ${server}/download/saligue.apk (website rebuilt; restart the server)`);
}
