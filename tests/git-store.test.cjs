const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { existsSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');

const modulePath = path.resolve(__dirname, '../server/git-store.mjs');
let createGitStore;
test.before(async () => {
  createGitStore = existsSync(modulePath) ? (await import(pathToFileURL(modulePath))).createGitStore : undefined;
});

function git(directory, args, input) {
  return execFileSync('git', ['--git-dir', directory, ...args], {
    input, encoding: 'utf8', maxBuffer: 12 * 1024 * 1024,
    env: { ...process.env, GIT_AUTHOR_NAME: 'Store Test', GIT_AUTHOR_EMAIL: 'store@example.invalid', GIT_COMMITTER_NAME: 'Store Test', GIT_COMMITTER_EMAIL: 'store@example.invalid', GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1' },
    stdio: ['pipe', 'pipe', 'pipe']
  }).trim();
}

async function fixture(t, { branch = 'main', seed = true } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'finance-git-store-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const remote = path.join(root, 'remote.git');
  execFileSync('git', ['init', '--bare', `--initial-branch=${branch}`, remote], { stdio: 'pipe' });
  if (seed) {
    const blob = git(remote, ['hash-object', '-w', '--stdin'], '# Private test records\n');
    const tree = git(remote, ['mktree'], `100644 blob ${blob}\tREADME.md\n`);
    const commit = git(remote, ['commit-tree', tree], 'Initialize private test records\n');
    git(remote, ['update-ref', `refs/heads/${branch}`, commit]);
  }
  let counter = 0;
  const store = () => createGitStore({ directory: path.join(root, `store-${++counter}`), remoteUrl: remote, authorName: 'Store Test', authorEmail: 'store@example.invalid' });
  return { root, remote, store, branch };
}

test('exports the requested Git store factory', () => {
  assert.equal(typeof createGitStore, 'function');
});

test('reads missing paths as null and persists updates in a real remote Git commit', async t => {
  const f = await fixture(t);
  const store = f.store();
  await store.init();
  assert.equal(await store.read('accounts.json'), null);
  const value = { users: [{ username: 'alice', role: 'user' }] };
  assert.deepEqual(await store.update('accounts.json', current => {
    assert.equal(current, null);
    return value;
  }, 'Create account'), value);
  assert.deepEqual(JSON.parse(git(f.remote, ['show', 'main:accounts.json'])), value);
  assert.equal(git(f.remote, ['show', 'main:README.md']), '# Private test records');
  assert.deepEqual(await store.read('accounts.json'), value);
});

test('a new store instance recovers committed JSON from the remote repository', async t => {
  const f = await fixture(t);
  await f.store().update('users/alice/state.json', () => ({ revision: 1, state: { active: null } }), 'Save state');
  const restarted = f.store();
  await restarted.init();
  assert.deepEqual(await restarted.read('users/alice/state.json'), { revision: 1, state: { active: null } });
});

test('initializes an empty remote without depending on a preexisting README', async t => {
  const f = await fixture(t, { seed: false });
  const store = f.store();
  await Promise.all([store.init(), store.init()]);
  assert.equal(await store.read('accounts.json'), null);
  await store.update('accounts.json', () => ({ users: [] }), 'Bootstrap');
  assert.deepEqual(JSON.parse(git(f.remote, ['show', 'main:accounts.json'])), { users: [] });
  assert.equal(git(f.remote, ['rev-list', '--count', 'main']), '1');
});

test('honors the existing remote default branch', async t => {
  const f = await fixture(t, { branch: 'records' });
  await f.store().update('accounts.json', () => ({ users: [] }), 'Bootstrap');
  assert.deepEqual(JSON.parse(git(f.remote, ['show', 'records:accounts.json'])), { users: [] });
  assert.equal(git(f.remote, ['for-each-ref', '--format=%(refname)', 'refs/heads/']), 'refs/heads/records');
});

test('identical updater output succeeds without creating an empty commit', async t => {
  const f = await fixture(t);
  const store = f.store();
  await store.update('accounts.json', () => ({ users: [] }), 'Bootstrap');
  const before = git(f.remote, ['rev-parse', 'main']);
  assert.deepEqual(await store.update('accounts.json', current => current, 'No change'), { users: [] });
  assert.equal(git(f.remote, ['rev-parse', 'main']), before);
});

test('serializes parallel updates and preserves every increment', async t => {
  const f = await fixture(t);
  const store = f.store();
  await Promise.all(Array.from({ length: 8 }, (_, index) => store.update('users/alice/state.json', async current => {
    await new Promise(resolve => setTimeout(resolve, index % 2));
    return { revision: (current?.revision || 0) + 1 };
  }, 'Increment')));
  assert.deepEqual(await store.read('users/alice/state.json'), { revision: 8 });
});

test('fetches changes from another store before applying an updater or reading', async t => {
  const f = await fixture(t);
  const first = f.store(), second = f.store();
  await first.init();
  await second.update('users/alice/state.json', () => ({ revision: 1, text: 'remote answer' }), 'Remote write');
  assert.deepEqual(await first.read('users/alice/state.json'), { revision: 1, text: 'remote answer' });
  await second.update('users/alice/state.json', () => ({ revision: 2, text: 'newer remote answer' }), 'Remote edit');
  await first.update('users/alice/state.json', current => ({ ...current, revision: current.revision + 1 }), 'Local edit');
  assert.deepEqual(await first.read('users/alice/state.json'), { revision: 3, text: 'newer remote answer' });
});

test('reapplies the updater to latest remote data after a non-fast-forward rejection', async t => {
  const f = await fixture(t);
  const first = f.store(), second = f.store();
  await first.update('users/alice/state.json', () => ({ revision: 0 }), 'Bootstrap');
  let calls = 0;
  const result = await first.update('users/alice/state.json', async current => {
    calls += 1;
    if (calls === 1) await second.update('users/alice/state.json', () => ({ revision: 1, remote: true }), 'Concurrent write');
    return { ...current, revision: current.revision + 1, local: true };
  }, 'Retry safely');
  assert.equal(calls, 2);
  assert.deepEqual(result, { revision: 2, remote: true, local: true });
  assert.deepEqual(await second.read('users/alice/state.json'), result);
});

test('propagates a revision conflict raised by the updater after refetching', async t => {
  const f = await fixture(t);
  const first = f.store(), second = f.store();
  await first.update('users/alice/state.json', () => ({ revision: 1 }), 'Bootstrap');
  const conflict = Object.assign(new Error('State revision changed'), { status: 409 });
  let calls = 0;
  await assert.rejects(first.update('users/alice/state.json', async current => {
    calls += 1;
    if (current.revision !== 1) throw conflict;
    await second.update('users/alice/state.json', () => ({ revision: 2, text: 'other device' }), 'Concurrent edit');
    return { revision: 2, text: 'stale device' };
  }, 'Stale write'), error => error === conflict);
  assert.equal(calls, 2);
  assert.deepEqual(await first.read('users/alice/state.json'), { revision: 2, text: 'other device' });
});

test('bounds repeated concurrent push conflicts and never reports an unpushed update', async t => {
  const f = await fixture(t);
  const first = f.store(), second = f.store();
  await first.update('users/alice/state.json', () => ({ revision: 0 }), 'Bootstrap');
  let calls = 0;
  await assert.rejects(first.update('users/alice/state.json', async current => {
    calls += 1;
    await second.update('users/alice/state.json', () => ({ revision: current.revision + 1, writer: 'other' }), 'Concurrent write');
    return { revision: current.revision + 1, writer: 'unpublished' };
  }, 'Contended write'), /concurrent|conflict|retry/i);
  assert.ok(calls >= 2 && calls <= 4);
  assert.equal((await first.read('users/alice/state.json')).writer, 'other');
});

test('push failure cannot leak into later reads or saves and remote diagnostics are not exposed', async t => {
  const f = await fixture(t);
  const store = f.store();
  await store.update('users/alice/state.json', () => ({ revision: 1, text: 'saved' }), 'Bootstrap');
  const hook = path.join(f.remote, 'hooks/pre-receive');
  await fs.writeFile(hook, '#!/bin/sh\necho "sensitive-remote-diagnostic" >&2\nexit 1\n', { mode: 0o700 });
  await assert.rejects(store.update('users/alice/state.json', () => ({ revision: 2, text: 'not saved' }), 'Rejected update'), error => {
    assert.ok(!String(error).includes('sensitive-remote-diagnostic'));
    assert.ok(!String(error).includes(f.remote));
    return true;
  });
  assert.deepEqual(await store.read('users/alice/state.json'), { revision: 1, text: 'saved' });
  await fs.unlink(hook);
  await store.update('accounts.json', () => ({ users: [] }), 'Separate successful write');
  assert.deepEqual(JSON.parse(git(f.remote, ['show', 'main:users/alice/state.json'])), { revision: 1, text: 'saved' });
});

test('propagates application errors and keeps the write queue usable', async t => {
  const f = await fixture(t);
  const store = f.store();
  const problem = Object.assign(new Error('Conflict'), { status: 409 });
  await assert.rejects(store.update('accounts.json', () => { throw problem; }, 'Rejected update'), error => error === problem);
  assert.equal(await store.read('accounts.json'), null);
  await store.update('accounts.json', () => ({ users: [] }), 'Later update');
  assert.deepEqual(await store.read('accounts.json'), { users: [] });
});

test('rejects traversal, Git internals, malformed paths, and non-JSON target files', async t => {
  const f = await fixture(t);
  const store = f.store();
  for (const invalid of ['../accounts.json', '/accounts.json', '.git/config.json', 'users/../accounts.json', 'users/alice//state.json', 'users/alice\\state.json', 'accounts.json:other', 'accounts.json\n', '-option.json', 'README.md', 'users/%2e%2e/state.json', '', null]) {
    await assert.rejects(store.read(invalid), /path/i, String(invalid));
    await assert.rejects(store.update(invalid, () => ({}), 'Invalid path'), /path/i, String(invalid));
  }
  assert.equal(git(f.remote, ['rev-list', '--count', 'main']), '1');
});

test('supports large JSON snapshots and rejects documents beyond 8 MiB', async t => {
  const f = await fixture(t);
  const store = f.store();
  const large = { text: 'a'.repeat(2 * 1024 * 1024) };
  await store.update('users/alice/state.json', () => large, 'Large snapshot');
  assert.equal((await store.read('users/alice/state.json')).text.length, large.text.length);
  await assert.rejects(store.update('users/alice/state.json', () => ({ text: 'b'.repeat(8 * 1024 * 1024) }), 'Oversized snapshot'), /size|large|MiB|limit/i);
  assert.equal((await store.read('users/alice/state.json')).text.length, large.text.length);
});

test('rejects unsafe remote transports and missing SSH pinning before connecting', () => {
  for (const remoteUrl of ['https://secret-token@github.com/owner/repo.git', 'ext::sh command', 'ssh://git@evil.example/owner/repo.git']) {
    assert.throws(() => createGitStore({ directory: '/tmp/unused-store-test', remoteUrl }), /remote|SSH|transport/i);
  }
  assert.throws(() => createGitStore({ directory: '/tmp/unused-store-test', remoteUrl: 'git@github.com:owner/repo.git' }), /key|host|SSH/i);
});

test('local repository paths may contain spaces without invoking a shell', async t => {
  const f = await fixture(t);
  const remote = path.join(f.root, 'remote repository.git');
  await fs.rename(f.remote, remote);
  const store = createGitStore({ directory: path.join(f.root, 'private store'), remoteUrl: remote });
  await store.update('accounts.json', () => ({ users: [] }), 'Save local records');
  assert.deepEqual(JSON.parse(git(remote, ['show', 'main:accounts.json'])), { users: [] });
});
