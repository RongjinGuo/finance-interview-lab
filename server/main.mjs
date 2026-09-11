import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './http.mjs';
import { createGitStore } from './git-store.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try {
  let initialUsers;
  try { initialUsers = JSON.parse(process.env.INITIAL_USERS_JSON || '[]'); }
  catch { throw new Error('Invalid account bootstrap configuration'); }
  const store = createGitStore({
    directory: process.env.GIT_DATA_DIR || '/tmp/finance-interview-data',
    remoteUrl: process.env.GIT_REMOTE_URL,
    privateKey: process.env.GIT_PRIVATE_KEY,
    knownHosts: process.env.GIT_KNOWN_HOSTS,
    authorName: process.env.GIT_AUTHOR_NAME || 'Finance Interview',
    authorEmail: process.env.GIT_AUTHOR_EMAIL || 'finance-interview@users.noreply.github.com'
  });
  const app = await createApp({ root, store, publicOrigin: process.env.PUBLIC_ORIGIN, localDev: process.env.LOCAL_DEV === 'true', initialUsers, inviteCodeSecret: process.env.INVITE_CODE_SECRET });
  const port = Number(process.env.PORT || 7860);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port');
  app.server.listen(port, process.env.HOST || '0.0.0.0', () => console.log(`Finance Interview account service listening on port ${port}`));
  app.server.on('error', () => { console.error('Account service could not start.'); process.exitCode = 1; });
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, async () => { await app.close(); process.exit(0); });
} catch {
  console.error('Account service startup failed. Check account and storage configuration.');
  process.exitCode = 1;
}
