import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { scryptSync } from 'node:crypto';
import { createGitStore } from '../server/git-store.mjs';
import { createApp } from '../server/http.mjs';

const directory = await mkdtemp(path.join(os.tmpdir(), 'finance-accounts-browser-'));
const remoteUrl = path.join(directory, 'records.git');
execFileSync('git', ['init', '--bare', '--initial-branch=main', remoteUrl], { stdio: 'ignore' });
const salt = 'ab'.repeat(16);
const passwordHash = `${salt}:${scryptSync('browser-test-password-123', salt, 64).toString('hex')}`;
const initialUsers = ['admin', 'alice', 'bob'].map(username => ({ username, displayName: username, role: username === 'admin' ? 'admin' : 'user', passwordHash }));
const store = createGitStore({ directory: path.join(directory, 'clone'), remoteUrl, authorName: 'Browser Test', authorEmail: 'browser-test@example.invalid' });
const application = await createApp({ root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), store, publicOrigin: 'http://127.0.0.1:43189', localDev: true, initialUsers });
application.server.listen(43189, '127.0.0.1', () => console.log('Account browser test server ready on 43189.'));
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await application.close();
  await rm(directory, { recursive: true, force: true });
  process.exit(0);
}
process.on('SIGTERM', close);
process.on('SIGINT', close);
