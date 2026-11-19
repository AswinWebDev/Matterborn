#!/usr/bin/env node
// Saves the Aholo API key into .env (both names the tools read) without echoing it, then checks
// it with a free read-only call. Run in your own terminal:  npm run setkey

import readline from 'node:readline';
import { readFile, writeFile, chmod } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLux3dClient } from '@manycore/aholo-sdk-lux3d';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV = process.env.SETKEY_ENV_PATH || path.join(ROOT, '.env'); // override only for tests

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let muted = false;
    rl._writeToOutput = (s) => {
      if (!muted) rl.output.write(s);
      else if (s.includes('\n') || s.includes('\r')) rl.output.write('\n');
    };
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
    muted = true;
  });
}

const key = (await askHidden('Paste your Aholo API key (from labs.aholo.ai/api-keys) and press Enter: ')).trim();
if (!key || /\s/.test(key) || key.length < 12) {
  console.error('That does not look like an API key. Nothing was saved.');
  process.exit(1);
}

const wanted = { AHOLO_API_KEY: key, AHOLO_REGION: 'com', LUX3D_GLOBAL_API_KEY: key };
const lines = existsSync(ENV) ? (await readFile(ENV, 'utf8')).split('\n') : [];
const kept = lines.filter((l) => l.trim() && !Object.keys(wanted).some((k) => l.startsWith(`${k}=`)));
const body = [...kept, ...Object.entries(wanted).map(([k, v]) => `${k}=${v}`)].join('\n') + '\n';
await writeFile(ENV, body, { mode: 0o600 });
await chmod(ENV, 0o600);
console.log(`Saved to ${path.relative(process.cwd(), ENV) || '.env'} (only you can read it; it is gitignored).`);

process.stdout.write('Checking the key with a free, read-only request... ');
try {
  const lux = createLux3dClient({ apiKey: key, region: 'com', timeoutMs: 30000, userAgent: 'matterborn-setkey' });
  const list = await lux.tasks.list({ page: 1, pageSize: 1 });
  console.log(`works. Your account has ${list?.total ?? list?.totalCount ?? 'some'} Lux3D task(s) so far.`);
} catch (err) {
  const code = err?.statusCode ? ` (HTTP ${err.statusCode})` : '';
  console.log(`failed${code}: ${String(err?.message || err).replace(key, '***').slice(0, 200)}`);
  console.log('The key is saved, but the check failed. Make sure it is an international (labs.aholo.ai) key.');
  process.exit(1);
}
