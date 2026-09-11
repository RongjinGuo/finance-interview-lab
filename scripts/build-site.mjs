import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const site = path.join(root, 'site');
await mkdir(path.join(site, 'src'), { recursive: true });
await copyFile(path.join(root, 'index.html'), path.join(site, 'index.html'));
for (const name of ['styles.css', 'questions.js', 'engine.js', 'app.js', 'visits.js']) {
  await copyFile(path.join(root, 'src', name), path.join(site, 'src', name));
}
let endpoint = process.env.VISIT_ENDPOINT || '';
if (!endpoint) {
  try { endpoint = JSON.parse(await readFile(path.join(root, 'deployment.json'), 'utf8')).visitEndpoint || ''; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
if (endpoint && new URL(endpoint).protocol !== 'https:') throw new Error('Deployed visitor endpoint must use HTTPS.');
await writeFile(path.join(site, 'src/visit-config.js'), `window.FinanceVisitConfig = ${JSON.stringify({ endpoint })};\n`);
await writeFile(path.join(site, '.nojekyll'), '');
await mkdir(path.join(root, 'worker/public'), { recursive: true });
await copyFile(path.join(root, 'src/styles.css'), path.join(root, 'worker/public/shared.css'));
console.log(`Site built. Visit endpoint ${endpoint ? 'configured' : 'not configured; visit reporting disabled'}.`);
