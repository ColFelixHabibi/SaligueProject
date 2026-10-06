// Builds the static site for the Android/iOS apps: served from the app root, with AI models bundled.
import { execSync } from 'node:child_process';

const env = { ...process.env, NEXT_PUBLIC_BASE_PATH: '', NEXT_PUBLIC_BUNDLED_MODELS: '1' };
const run = (cmd) => execSync(cmd, { stdio: 'inherit', env });

run('node scripts/bundle-models.mjs');
run('npx next build');
run('npx cap sync');
