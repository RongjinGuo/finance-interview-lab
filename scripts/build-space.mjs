import { copyFile, mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'space');
const temporary = await mkdtemp(path.join(root, '.space-build-'));
const files = [
  'index.html',
  ...['styles.css', 'account.css', 'questions.js', 'engine.js', 'app.js', 'account-config.js', 'accounts.js', 'visit-config.js', 'visits.js'].map(name => `src/${name}`),
  ...['main.mjs', 'http.mjs', 'auth.mjs', 'validation.mjs', 'git-store.mjs'].map(name => `server/${name}`)
];
try {
  for (const file of files) {
    await mkdir(path.dirname(path.join(temporary, file)), { recursive: true });
    await copyFile(path.join(root, file), path.join(temporary, file));
  }
  for (const file of ['Dockerfile', 'README.md']) await copyFile(path.join(root, 'deploy/hf', file), path.join(temporary, file));
  // The output directory is generated exclusively from this source allowlist.
  await rm(output, { recursive: true, force: true });
  await rename(temporary, output);
  console.log(`Prepared HF Space package with ${files.length + 2} approved files.`);
} catch (error) {
  await rm(temporary, { recursive: true, force: true });
  throw error;
}
