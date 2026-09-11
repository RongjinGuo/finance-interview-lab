const test = require('node:test');
const assert = require('node:assert/strict');
const { scryptSync, createHmac } = require('node:crypto');
const path = require('node:path');

const publicOrigin = 'https://accounts.example.test';
const password = 'account-test-password-927';
const salt = '18c7d90133a62f16967dfe3d63d12fff';
const passwordHash = `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
const inviteCodeSecret = 'synthetic-test-secret-for-invite-hmac-at-least-32-chars';
const inviteCodes = { admin: '8301', alice: '0462', bobby: '7258', new_user: '6184', cache_user: '9374' };
const testInviteHash = code => createHmac('sha256', inviteCodeSecret).update(code).digest('hex');
const initialUsers = [
  { username: 'admin', displayName: '管理员', role: 'admin', inviteCodeHash: testInviteHash(inviteCodes.admin), passwordHash },
  { username: 'alice', displayName: 'Alice', role: 'user', inviteCodeHash: testInviteHash(inviteCodes.alice) },
  { username: 'bobby', displayName: 'Bobby', role: 'user', inviteCodeHash: testInviteHash(inviteCodes.bobby) }
];
const state = () => ({ settings: { role: 'accounting', mode: 'practice', count: 6 }, active: null, history: [], favorites: [] });
let createApp;
test.before(async () => { ({ createApp } = await import('../server/http.mjs')); });

function memoryStore() {
  const files = new Map();
  let queue = Promise.resolve();
  return {
    files, writes: 0, failUpdates: false,
    async init() {},
    async read(file) { return structuredClone(files.get(file) ?? null); },
    update(file, updater) {
      const task = queue.then(async () => {
        if (this.failUpdates) throw new Error('Test storage unavailable');
        const before = await this.read(file);
        const next = await updater(before);
        if (JSON.stringify(before) !== JSON.stringify(next)) {
          files.set(file, structuredClone(next));
          this.writes++;
        }
        return structuredClone(next);
      });
      queue = task.catch(() => {});
      return task;
    }
  };
}

async function fixture(t, options = {}) {
  const store = options.store || memoryStore();
  let now = Date.now();
  const app = await createApp({ root: path.resolve(__dirname, '..'), store, publicOrigin, initialUsers, inviteCodeSecret, now: () => now, ...options });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const accountByCookie = new Map();
  async function request(route, { method = 'GET', body, cookie, headers = {} } = {}) {
    return fetch(`${base}${route}`, {
      method, redirect: 'manual',
      headers: { ...(method !== 'GET' ? { Origin: options.publicOrigin || publicOrigin } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(route === '/api/state' && accountByCookie.has(cookie) ? { 'X-Finance-Account': accountByCookie.get(cookie) } : {}), ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)
    });
  }
  async function login(username = 'alice') {
    const response = await request('/api/login', { method: 'POST', body: { inviteCode: inviteCodes[username] } });
    assert.equal(response.status, 200, await response.clone().text());
    const cookie = response.headers.get('set-cookie').split(';')[0];
    accountByCookie.set(cookie, username);
    return cookie;
  }
  return { app, store, request, login, advance: ms => { now += ms; } };
}

test('health only becomes ready after Git initialization and valid account bootstrap', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/health')).status, 200);
  assert.equal((await f.store.read('accounts.json')).users.length, 3);
  const broken = memoryStore();
  broken.init = async () => { throw new Error('private-key-and-remote-url-should-not-leak'); };
  const unavailable = await fixture(t, { store: broken });
  const response = await unavailable.request('/api/health');
  assert.equal(response.status, 503);
  assert.ok(!(await response.text()).includes('private-key'));
  assert.equal((await unavailable.request('/api/login', { method: 'POST', body: { inviteCode: inviteCodes.alice } })).status, 503);
});

test('bootstrap never overwrites existing accounts', async t => {
  const store = memoryStore();
  store.files.set('accounts.json', { users: [{ ...initialUsers[0], displayName: 'Existing admin', createdAt: new Date().toISOString() }] });
  const f = await fixture(t, { store });
  assert.equal((await f.request('/api/health')).status, 200);
  assert.equal((await store.read('accounts.json')).users.length, 1);
  assert.equal((await store.read('accounts.json')).users[0].displayName, 'Existing admin');
});

test('login cookies use configured HTTPS origin behind an HTTP reverse proxy', async t => {
  const f = await fixture(t);
  const login = await f.request('/api/login', { method: 'POST', body: { inviteCode: inviteCodes.alice } });
  assert.equal(login.status, 200);
  assert.deepEqual(await login.json(), { user: { username: 'alice', displayName: 'Alice', role: 'user' } });
  const cookie = login.headers.get('set-cookie');
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', 'Max-Age=43200']) assert.ok(cookie.includes(flag), flag);
  const session = await f.request('/api/session', { cookie: cookie.split(';')[0] });
  assert.equal(session.status, 200);
  assert.ok(!(await session.text()).includes('passwordHash'));
  assert.match(session.headers.get('cache-control'), /no-store/);
});

test('authentication protects every account API and separates user records', async t => {
  const f = await fixture(t);
  for (const route of ['/api/session', '/api/state', '/api/admin/users', '/api/admin/users/alice/state']) assert.equal((await f.request(route)).status, 401, route);
  const alice = await f.login();
  const bobby = await f.login('bobby');
  const draft = state(); draft.favorites = ['opening-introduction'];
  const saved = await f.request('/api/state', { method: 'PUT', cookie: alice, body: { revision: 0, mutationId: 'save-alice-001', state: draft } });
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).revision, 1);
  assert.deepEqual(await (await f.request('/api/state', { cookie: bobby })).json(), { revision: 0, updatedAt: null, state: null });
  assert.deepEqual((await (await f.request('/api/state', { cookie: alice })).json()).state, draft);
  assert.equal((await f.request('/api/admin/users/bobby/state', { cookie: alice })).status, 403);
  assert.equal((await f.request('/api/admin/users', { cookie: alice })).status, 403);
});

test('all mutations enforce PUBLIC_ORIGIN and ignore spoofed forwarding headers', async t => {
  const f = await fixture(t);
  const cookie = await f.login();
  for (const route of ['/api/login', '/api/logout', '/api/state', '/api/admin/users']) {
    const response = await f.request(route, { method: route === '/api/state' ? 'PUT' : 'POST', cookie, body: {}, headers: { Origin: 'https://evil.example', Host: 'evil.example', 'X-Forwarded-Host': 'evil.example', 'X-Forwarded-Proto': 'https' } });
    assert.equal(response.status, 403, route);
  }
  assert.equal((await f.request('/api/login', { method: 'POST', body: { inviteCode: inviteCodes.alice }, headers: { Origin: '' } })).status, 403);
  assert.equal((await f.request('/api/session', { cookie })).status, 200);
});

test('stale revisions never overwrite state and repeated mutations are idempotent across restart', async t => {
  const f = await fixture(t);
  const cookie = await f.login();
  const first = { revision: 0, mutationId: 'mutation-one', state: state() };
  const saved = await (await f.request('/api/state', { method: 'PUT', cookie, body: first })).json();
  const writes = f.store.writes;
  assert.deepEqual(await (await f.request('/api/state', { method: 'PUT', cookie, body: first })).json(), saved);
  assert.equal(f.store.writes, writes);
  const stale = await f.request('/api/state', { method: 'PUT', cookie, body: { ...first, mutationId: 'mutation-two' } });
  assert.equal(stale.status, 409);
  assert.deepEqual((await stale.json()).current, saved);
  const second = { revision: 1, mutationId: 'mutation-two', state: { ...state(), favorites: ['opening-introduction'] } };
  assert.equal((await f.request('/api/state', { method: 'PUT', cookie, body: second })).status, 200);
  const restarted = await fixture(t, { store: f.store });
  assert.equal((await restarted.request('/api/session', { cookie })).status, 401);
  const newCookie = await restarted.login();
  const repeated = await restarted.request('/api/state', { method: 'PUT', cookie: newCookie, body: first });
  assert.equal(repeated.status, 200);
  assert.equal((await repeated.json()).revision, 2);
  const changed = await restarted.request('/api/state', { method: 'PUT', cookie: newCookie, body: { ...first, state: second.state } });
  assert.equal(changed.status, 409);
});

test('simultaneous saves from one revision yield one success and one recoverable conflict', async t => {
  const f = await fixture(t);
  const cookie = await f.login();
  const responses = await Promise.all(['concurrent-a', 'concurrent-b'].map(mutationId => f.request('/api/state', { method: 'PUT', cookie, body: { revision: 0, mutationId, state: state() } })));
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
  assert.equal((await (await f.request('/api/state', { cookie })).json()).revision, 1);
});

test('state validator rejects malformed settings, sessions, answers, history, and favorites', async t => {
  const f = await fixture(t);
  const cookie = await f.login();
  const invalid = [null, [], { ...state(), extra: true }, { ...state(), settings: { role: 'unknown', mode: 'practice', count: 6 } }, { ...state(), settings: { role: 'accounting', mode: 'practice', count: 99 } }, { ...state(), favorites: ['missing-question'] }, { ...state(), favorites: ['opening-introduction', 'opening-introduction'] }, { ...state(), active: {} }, { ...state(), history: Array(31).fill({}) }];
  for (const value of invalid) assert.equal((await f.request('/api/state', { method: 'PUT', cookie, body: { revision: 0, mutationId: 'invalid-state', state: value } })).status, 400);
  const active = { id: 'session-001', role: 'accounting', mode: 'practice', questionIds: ['opening-introduction'], current: 0, phase: 'answer', answers: { 'opening-introduction': { text: '我的答案', seconds: 1, skipped: false, reviewed: false, checked: [false, false, false, false] } }, createdAt: new Date().toISOString(), finishedAt: null };
  assert.equal((await f.request('/api/state', { method: 'PUT', cookie, body: { revision: 0, mutationId: 'valid-session', state: { ...state(), active } } })).status, 200);
  active.answers['opening-introduction'].text = 'x'.repeat(20001);
  assert.equal((await f.request('/api/state', { method: 'PUT', cookie, body: { revision: 1, mutationId: 'long-answer', state: { ...state(), active } } })).status, 400);
  for (const revision of [-1, 1.2, '1']) assert.equal((await f.request('/api/state', { method: 'PUT', cookie, body: { revision, mutationId: 'bad-version', state: state() } })).status, 400);
});

test('admin creates ordinary accounts and can read records without exposing credential hashes', async t => {
  const f = await fixture(t);
  const admin = await f.login('admin');
  const response = await f.request('/api/admin/users', { method: 'POST', cookie: admin, body: { username: 'new_user', displayName: '新用户', inviteCode: inviteCodes.new_user } });
  assert.equal(response.status, 201);
  const created = (await response.json()).user;
  assert.equal(created.role, 'user');
  assert.ok(!Object.hasOwn(created, 'passwordHash'));
  const saved = (await f.store.read('accounts.json')).users.find(user => user.username === 'new_user');
  assert.equal(saved.inviteCodeHash, testInviteHash(inviteCodes.new_user));
  assert.ok(!Object.hasOwn(saved, 'inviteCode'));
  assert.ok(!Object.hasOwn(saved, 'passwordHash'));
  assert.ok(!JSON.stringify(await f.store.read('accounts.json')).includes(password));
  assert.ok(await f.login('new_user'));
  const users = await (await f.request('/api/admin/users', { cookie: admin })).json();
  assert.equal(users.users.length, 4);
  assert.ok(!JSON.stringify(users).includes('passwordHash'));
  assert.equal((await f.request('/api/admin/users/alice/state', { cookie: admin })).status, 200);
  assert.equal((await f.request('/api/admin/users/missing/state', { cookie: admin })).status, 404);
  assert.equal((await f.request('/api/admin/users', { method: 'POST', cookie: admin, body: { username: 'new_user', displayName: 'Duplicate', inviteCode: inviteCodes.new_user } })).status, 409);
  for (const body of [{ username: '../escape', displayName: 'x', inviteCode: '9451' }, { username: 'short', displayName: 'x', inviteCode: '12' }, { username: 'long', displayName: 'x', inviteCode: '9'.repeat(13) }, { username: 'bad-role', displayName: 'x', inviteCode: '9451', role: 'admin' }]) assert.equal((await f.request('/api/admin/users', { method: 'POST', cookie: admin, body })).status, 400);
});

test('failed storage pushes are never acknowledged as a cloud save', async t => {
  const f = await fixture(t);
  const cookie = await f.login();
  f.store.failUpdates = true;
  const failed = await f.request('/api/state', { method: 'PUT', cookie, body: { revision: 0, mutationId: 'failed-write', state: state() } });
  assert.equal(failed.status, 503);
  assert.equal((await (await f.request('/api/state', { cookie })).json()).revision, 0);
});

test('logout and expiration revoke sessions; changing invite-code guesses remain bounded', async t => {
  const f = await fixture(t);
  const cookie = await f.login();
  const response = await f.request('/api/logout', { method: 'POST', cookie });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await f.request('/api/session', { cookie })).status, 401);
  const expiring = await f.login();
  f.advance(12 * 3600000 + 1);
  assert.equal((await f.request('/api/session', { cookie: expiring })).status, 401);
  let failed;
  for (let index = 0; index < 7; index++) failed = await f.request('/api/login', { method: 'POST', body: { inviteCode: String(9400 + index) }, headers: { 'X-Forwarded-For': `8.8.8.${index}` } });
  assert.equal(failed.status, 429);
  assert.ok(Number(failed.headers.get('retry-after')) > 0);
});

test('body limits and explicit static allowlist prevent private data exposure', async t => {
  const f = await fixture(t);
  const cookie = await f.login();
  assert.equal((await f.request('/api/state', { method: 'PUT', cookie, body: 'x'.repeat(8 * 1024 * 1024 + 1) })).status, 413);
  assert.equal((await f.request('/api/state', { method: 'PUT', cookie, body: '{bad' })).status, 400);
  for (const route of ['/server/main.mjs', '/accounts.json', '/users/alice/state.json', '/.git/config', '/.env', '/package.json', '/src/../server/http.mjs', '/%E0%A4%A']) assert.ok([400, 404].includes((await f.request(route)).status), route);
  for (const route of ['/', '/src/engine.js', '/src/questions.js', '/src/styles.css']) assert.equal((await f.request(route)).status, 200, route);
  assert.match(await (await f.request('/src/account-config.js')).text(), /enabled\s*:\s*true/);
  assert.match(await (await f.request('/src/visit-config.js')).text(), /endpoint\s*:\s*''/);
});

test('HTTP configuration requires explicit local mode and loopback origin', async t => {
  await assert.rejects(() => createApp({ store: memoryStore(), publicOrigin: 'http://example.com', initialUsers }), /HTTPS|https/);
  await assert.rejects(() => createApp({ store: memoryStore(), publicOrigin: 'http://example.com', localDev: true, initialUsers }), /HTTPS|https/);
  const f = await fixture(t, { publicOrigin: 'http://localhost:7860', localDev: true });
  const response = await f.request('/api/login', { method: 'POST', body: { inviteCode: inviteCodes.alice } });
  assert.equal(response.status, 200);
  assert.ok(!response.headers.get('set-cookie').includes('; Secure'));
});

test('unauthenticated traffic and login attempts never fetch remote accounts after bootstrap', async t => {
  const f = await fixture(t);
  let reads = 0;
  const originalRead = f.store.read;
  f.store.read = async function(file) { reads++; return originalRead.call(this, file); };
  const cookie = await f.login();
  assert.equal(reads, 0, 'Login should validate against the initialized account cache');
  f.advance(31000);
  for (let index = 0; index < 4; index++) {
    assert.equal((await f.request('/api/state')).status, 401);
    assert.equal((await f.request('/api/admin/users', { cookie: 'finance_account_session=forged' })).status, 401);
  }
  let response;
  for (let index = 0; index < 7; index++) response = await f.request('/api/login', { method: 'POST', body: { inviteCode: String(9500 + index) } });
  assert.equal(response.status, 429);
  assert.equal(reads, 0, 'Unauthenticated requests must not enqueue Git fetches, even after cache expiry');
  assert.equal((await f.request('/api/logout', { method: 'POST', cookie })).status, 200);
  assert.equal(reads, 0, 'Logout should revoke its local session without Git I/O');
});

test('authenticated account cache refresh is single-flight and honors external account changes', async t => {
  const f = await fixture(t);
  const cookie = await f.login();
  const accounts = await f.store.read('accounts.json');
  accounts.users.find(user => user.username === 'alice').displayName = 'Updated Alice';
  f.store.files.set('accounts.json', accounts);
  let accountReads = 0;
  const originalRead = f.store.read;
  f.store.read = async function(file) {
    if (file === 'accounts.json') { accountReads++; await new Promise(resolve => setTimeout(resolve, 25)); }
    return originalRead.call(this, file);
  };
  assert.equal((await (await f.request('/api/session', { cookie })).json()).user.displayName, 'Alice');
  assert.equal(accountReads, 0);
  f.advance(31000);
  const responses = await Promise.all(Array.from({ length: 6 }, () => f.request('/api/session', { cookie })));
  for (const response of responses) assert.equal((await response.json()).user.displayName, 'Updated Alice');
  assert.equal(accountReads, 1);
  await f.request('/api/session', { cookie });
  assert.equal(accountReads, 1);
});

test('new accounts are immediately usable from updated cache without an extra Git fetch', async t => {
  const f = await fixture(t);
  const admin = await f.login('admin');
  assert.equal((await f.request('/api/admin/users', { method: 'POST', cookie: admin, body: { username: 'cache_user', displayName: 'Cached user', inviteCode: inviteCodes.cache_user } })).status, 201);
  const originalRead = f.store.read;
  f.store.read = async function(file) { if (file === 'accounts.json') throw new Error('Unexpected remote account read'); return originalRead.call(this, file); };
  assert.ok(await f.login('cache_user'));
  assert.equal((await f.request('/api/admin/users', { cookie: admin })).status, 200);
});

test('transient startup failure recovers through a bounded single-flight health retry', async t => {
  const store = memoryStore();
  let attempts = 0;
  store.init = async () => {
    attempts++;
    if (attempts === 1) throw new Error('Transient startup failure');
    await new Promise(resolve => setTimeout(resolve, 25));
  };
  const f = await fixture(t, { store });
  assert.equal((await f.request('/api/health')).status, 503);
  assert.equal((await f.request('/api/health')).status, 503);
  assert.equal(attempts, 1, 'Health probes must back off after initialization fails');
  f.advance(31000);
  const responses = await Promise.all(Array.from({ length: 5 }, () => f.request('/api/health')));
  assert.ok(responses.every(response => response.status === 200));
  assert.equal(attempts, 2);
  assert.ok(await f.login());
});

test('login can recover initialization after backoff without overwriting existing accounts', async t => {
  const store = memoryStore();
  let attempts = 0;
  store.init = async () => { attempts++; if (attempts === 1) throw new Error('Transient startup failure'); };
  const existing = { users: [{ ...initialUsers[0], displayName: 'Existing owner', createdAt: new Date().toISOString() }] };
  store.files.set('accounts.json', structuredClone(existing));
  const f = await fixture(t, { store });
  f.advance(31000);
  assert.ok(await f.login('admin'));
  assert.equal(attempts, 2);
  assert.deepEqual(await store.read('accounts.json'), existing);
  assert.equal(store.writes, 0);
});

test('state requests require their expected account and reject cross-tab cookie switches before Git I/O', async t => {
  const f = await fixture(t);
  await f.login('alice');
  const bobby = await f.login('bobby');
  f.advance(31000);
  let reads = 0;
  const originalRead = f.store.read;
  f.store.read = async function(file) { reads++; return originalRead.call(this, file); };
  const writes = f.store.writes;
  for (const method of ['GET', 'PUT']) {
    const response = await f.request('/api/state', { method, cookie: bobby, headers: { 'X-Finance-Account': 'alice' }, ...(method === 'PUT' ? { body: { revision: 0, mutationId: 'alice-private-draft', state: { ...state(), favorites: ['opening-introduction'] } } } : {}) });
    assert.equal(response.status, 401, method);
    assert.match((await response.json()).error, /账号.*切换|账号.*变化/);
  }
  assert.equal(reads, 0);
  assert.equal(f.store.writes, writes);
  assert.equal(f.store.files.has('users/bobby/state.json'), false);
});

test('authenticated state requests without an expected account fail without Git I/O', async t => {
  const f = await fixture(t);
  const cookie = await f.login();
  f.advance(31000);
  let reads = 0;
  const originalRead = f.store.read;
  f.store.read = async function(file) { reads++; return originalRead.call(this, file); };
  for (const method of ['GET', 'PUT']) {
    const response = await f.request('/api/state', { method, cookie, headers: { 'X-Finance-Account': '' }, ...(method === 'PUT' ? { body: { revision: 0, mutationId: 'missing-account', state: state() } } : {}) });
    assert.equal(response.status, 400, method);
  }
  assert.equal(reads, 0);
  assert.equal((await f.request('/api/session', { cookie })).status, 200);
});

test('invite login preserves leading zeros and refuses numeric, malformed, or password credentials', async t => {
  const f = await fixture(t);
  const response = await f.request('/api/login', { method: 'POST', body: { inviteCode: inviteCodes.alice } });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).user.username, 'alice');
  for (const body of [{ inviteCode: Number(inviteCodes.alice) }, { inviteCode: '462' }, { inviteCode: ' 0462' }, { inviteCode: 'abcd' }, { inviteCode: '9'.repeat(13) }, { username: 'admin', password }, { inviteCode: inviteCodes.admin, username: 'admin' }]) {
    assert.equal((await f.request('/api/login', { method: 'POST', body })).status, 400);
  }
});

test('legacy password accounts remain valid during migration but passwords cannot authenticate', async t => {
  const store = memoryStore();
  const legacy = { users: [{ username: 'admin', displayName: 'Legacy admin', role: 'admin', passwordHash, createdAt: new Date().toISOString() }] };
  store.files.set('accounts.json', structuredClone(legacy));
  const f = await fixture(t, { store });
  assert.equal((await f.request('/api/health')).status, 200);
  assert.equal((await f.request('/api/login', { method: 'POST', body: { username: 'admin', password } })).status, 400);
  assert.equal((await f.request('/api/login', { method: 'POST', body: { inviteCode: inviteCodes.admin } })).status, 401);
  assert.deepEqual(await store.read('accounts.json'), legacy);
});

test('invite digests require a server secret and match HMAC without coercing leading zeros', async () => {
  const { hashInviteCode } = await import('../server/auth.mjs');
  assert.equal(typeof hashInviteCode, 'function');
  assert.equal(hashInviteCode(inviteCodes.alice, inviteCodeSecret), testInviteHash(inviteCodes.alice));
  assert.notEqual(hashInviteCode(inviteCodes.alice, inviteCodeSecret), hashInviteCode(inviteCodes.alice, `${inviteCodeSecret}-other`));
  await assert.rejects(() => createApp({ store: memoryStore(), publicOrigin, initialUsers }), /INVITE_CODE_SECRET/);
  await assert.rejects(() => createApp({ store: memoryStore(), publicOrigin, initialUsers, inviteCodeSecret: 'short' }), /INVITE_CODE_SECRET/);
});

test('duplicate invite codes cannot create a second account, including concurrent creation', async t => {
  const f = await fixture(t);
  const admin = await f.login('admin');
  const duplicate = await f.request('/api/admin/users', { method: 'POST', cookie: admin, body: { username: 'duplicate_code', displayName: 'Duplicate', inviteCode: inviteCodes.admin } });
  assert.equal(duplicate.status, 409);
  const responses = await Promise.all(['concurrent_one', 'concurrent_two'].map(username => f.request('/api/admin/users', { method: 'POST', cookie: admin, body: { username, displayName: username, inviteCode: '6843' } })));
  assert.deepEqual(responses.map(response => response.status).sort(), [201, 409]);
  const accounts = await f.store.read('accounts.json');
  assert.equal(accounts.users.filter(user => user.inviteCodeHash === testInviteHash('6843')).length, 1);
  assert.ok(accounts.users.every(user => !Object.hasOwn(user, 'inviteCode')));
  const listed = await (await f.request('/api/admin/users', { cookie: admin })).json();
  assert.ok(listed.users.every(user => !Object.hasOwn(user, 'inviteCodeHash') && !Object.hasOwn(user, 'passwordHash')));
});

test('successful ordinary invite login cannot reset earlier failed code guesses', async t => {
  const f = await fixture(t);
  for (let index = 0; index < 4; index++) {
    const response = await f.request('/api/login', { method: 'POST', body: { inviteCode: String(9560 + index) } });
    assert.equal(response.status, 401);
  }
  assert.ok(await f.login('alice'));
  assert.equal((await f.request('/api/login', { method: 'POST', body: { inviteCode: '9564' } })).status, 401);
  const blocked = await f.request('/api/login', { method: 'POST', body: { inviteCode: '9565' } });
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);
});
