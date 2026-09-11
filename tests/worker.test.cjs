const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { readFileSync } = require('node:fs');
const { pbkdf2Sync } = require('node:crypto');
const path = require('node:path');

const password = 'correct-test-password-827';
const origin = 'https://admin.example.workers.dev';
const siteOrigin = 'https://rongjinguo.github.io';
const salt = 'c7f3060b879fdce83d352b371a1c4429';
const passwordHash = `${salt}:${pbkdf2Sync(password, Buffer.from(salt, 'hex'), 100000, 32, 'sha256').toString('hex')}`;
let worker;
test.before(async () => { worker = (await import('../worker/index.mjs')).default; });

function fixture(t, overrides = {}) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(path.join(__dirname, '../worker/migrations/0001_visitors.sql'), 'utf8'));
  t.after(() => sqlite.close());
  function prepared(sql, values = []) {
    return {
      bind(...args) { return prepared(sql, args); },
      async first(column) {
        const row = sqlite.prepare(sql).get(...values);
        return row ? column ? row[column] : { ...row } : null;
      },
      async all() { return { success: true, results: sqlite.prepare(sql).all(...values).map(row => ({ ...row })) }; },
      async run() {
        const result = sqlite.prepare(sql).run(...values);
        return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
      }
    };
  }
  const env = {
    DB: {
      prepare: prepared,
      async batch(statements) {
        sqlite.exec('BEGIN');
        try {
          const values = [];
          for (const statement of statements) values.push(await statement.all());
          sqlite.exec('COMMIT');
          return values;
        } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
      }
    },
    ASSETS: { fetch: async () => new Response('<!doctype html><title>Admin</title>', { headers: { 'content-type': 'text/html' } }) },
    ALLOWED_ORIGIN: siteOrigin,
    SITE_PATH_PREFIX: '/finance-interview-lab/',
    ADMIN_PASSWORD_HASH: passwordHash,
    SESSION_SECRET: 'a-long-test-session-secret-with-more-than-32-bytes',
    RETENTION_DAYS: '90',
    ...overrides
  };
  const tasks = [];
  async function request(route, { method = 'GET', body, headers = {}, cf, urlOrigin = origin } = {}) {
    const req = new Request(`${urlOrigin}${route}`, {
      method,
      headers: { 'CF-Connecting-IP': '8.8.8.8', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)
    });
    if (cf) Object.defineProperty(req, 'cf', { value: cf });
    const response = await worker.fetch(req, env, { waitUntil(promise) { tasks.push(promise); } });
    await Promise.all(tasks.splice(0));
    return response;
  }
  async function login() {
    const res = await request('/api/admin/login', { method: 'POST', body: { password }, headers: { Origin: origin } });
    assert.equal(res.status, 200);
    return res.headers.get('set-cookie').split(';')[0];
  }
  async function visit(extra = {}) {
    return request('/api/visit', { method: 'POST', body: { path: '/finance-interview-lab/' }, headers: { Origin: siteOrigin }, ...extra });
  }
  return { sqlite, env, request, login, visit };
}

test('visit trusts platform IP and location, never a client JSON IP or forwarding headers', async t => {
  const f = fixture(t);
  const res = await f.visit({
    body: { path: '/finance-interview-lab/', ip: '1.2.3.4', city: 'fake' },
    headers: { Origin: siteOrigin, 'CF-Connecting-IP': '8.8.4.4', 'X-Forwarded-For': '1.2.3.4', 'X-Real-IP': '1.2.3.5', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128.0.0.0 Safari/537.36' },
    cf: { country: 'CN', region: 'Guangdong', city: 'Shenzhen' }
  });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), siteOrigin);
  assert.equal(res.headers.get('access-control-allow-credentials'), null);
  const row = f.sqlite.prepare('SELECT * FROM visits').get();
  assert.equal(row.ip, '8.8.4.4');
  assert.equal(row.country, '中国');
  assert.equal(row.city, 'Shenzhen');
  assert.equal(row.browser, 'Chrome');
  assert.equal(row.os, 'Windows');
  assert.equal(row.path, '/finance-interview-lab/');
  assert.match(row.time, /^\d{4}-\d\d-\d\dT.*Z$/);
});

test('visit enforces exact CORS origin and validates preflight', async t => {
  const f = fixture(t);
  for (const attackOrigin of ['', 'https://evil.example', `${siteOrigin}.evil.example`, `${siteOrigin}/`]) {
    assert.equal((await f.visit({ headers: { Origin: attackOrigin } })).status, 403);
  }
  const preflight = await f.request('/api/visit', { method: 'OPTIONS', headers: { Origin: siteOrigin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), siteOrigin);
  assert.equal((await f.request('/api/visit', { method: 'OPTIONS', headers: { Origin: siteOrigin, 'Access-Control-Request-Method': 'DELETE' } })).status, 405);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM visits').get().n, 0);
});

test('visit rejects oversized JSON, malformed paths, and spoofed missing platform headers', async t => {
  const f = fixture(t);
  for (const visitPath of ['/other/', '/finance-interview-lab-evil/', '/finance-interview-lab/../private', '/finance-interview-lab/%2e%2e/private', '/finance-interview-lab/%252e%252e/private', '/finance-interview-lab/?answers=secret', '/finance-interview-lab/#secret', 'https://evil.example/', '/finance-interview-lab/\\private', '/finance-interview-lab/%ZZ']) {
    const res = await f.visit({ body: { path: visitPath } });
    assert.equal(res.status, 400, visitPath);
  }
  assert.equal((await f.visit({ body: { path: '/finance-interview-lab/', extra: 'x'.repeat(2048) } })).status, 413);
  assert.equal((await f.visit({ body: '{bad json' })).status, 400);
  assert.equal((await f.visit({ headers: { Origin: siteOrigin, 'CF-Connecting-IP': '', 'X-Forwarded-For': '1.1.1.1' } })).status, 400);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM visits').get().n, 0);
});

test('explicit local development labels local visits without trusting forwarding headers', async t => {
  const f = fixture(t, { LOCAL_DEV: 'true' });
  const res = await f.visit({ urlOrigin: 'http://localhost:8787', headers: { Origin: siteOrigin, 'CF-Connecting-IP': '', 'X-Forwarded-For': '1.1.1.1' } });
  assert.equal(res.status, 204);
  const row = f.sqlite.prepare('SELECT * FROM visits').get();
  assert.equal(row.ip, '127.0.0.1');
  assert.match(row.location, /本地|内网/);
});

test('admin APIs require authentication and mutations require same origin', async t => {
  const f = fixture(t);
  for (const route of ['/api/admin/session', '/api/admin/visits', '/api/admin/export']) {
    const response = await f.request(route);
    assert.equal(response.status, 401);
    assert.match(response.headers.get('cache-control'), /no-store/);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  }
  for (const attackOrigin of ['', siteOrigin, `${origin}.evil.example`, 'null']) {
    const response = await f.request('/api/admin/login', { method: 'POST', body: { password }, headers: { Origin: attackOrigin } });
    assert.equal(response.status, 403);
  }
  assert.equal((await f.request('/api/admin/login', { method: 'POST', body: { password: 'wrong-password' }, headers: { Origin: origin } })).status, 401);
  assert.equal((await f.request('/api/admin/login', { method: 'POST', body: { password: 'x'.repeat(9000) }, headers: { Origin: origin } })).status, 413);
});

test('login issues secure revocable cookies and sessions survive isolate reload', async t => {
  const f = fixture(t);
  const login = await f.request('/api/admin/login', { method: 'POST', body: { password }, headers: { Origin: origin } });
  assert.equal(login.status, 200);
  assert.deepEqual(await login.json(), { ok: true });
  const setCookie = login.headers.get('set-cookie');
  for (const flag of ['HttpOnly', 'SameSite=Strict', 'Secure', 'Path=/', 'Max-Age=43200']) assert.ok(setCookie.includes(flag), flag);
  const cookie = setCookie.split(';')[0];
  const response = await f.request('/api/admin/session', { headers: { Cookie: cookie } });
  assert.deepEqual(await response.json(), { authenticated: true });
  const stored = f.sqlite.prepare('SELECT * FROM admin_sessions').get();
  assert.ok(!JSON.stringify(stored).includes(cookie.split('=')[1]));
  const freshWorker = (await import(`../worker/index.mjs?fresh=${Date.now()}`)).default;
  const freshResponse = await freshWorker.fetch(new Request(`${origin}/api/admin/session`, { headers: { Cookie: cookie } }), f.env, { waitUntil() {} });
  assert.equal(freshResponse.status, 200);
  assert.equal((await f.request('/api/admin/logout', { method: 'POST', headers: { Cookie: cookie, Origin: siteOrigin } })).status, 403);
  const logout = await f.request('/api/admin/logout', { method: 'POST', headers: { Cookie: cookie, Origin: origin } });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await f.request('/api/admin/session', { headers: { Cookie: cookie } })).status, 401);
});

test('forged and expired sessions are rejected', async t => {
  const f = fixture(t);
  const cookie = await f.login();
  const token = cookie.split('=')[1];
  assert.equal((await f.request('/api/admin/session', { headers: { Cookie: `visitor_admin_session=${token.slice(0, -1)}X` } })).status, 401);
  f.sqlite.exec('UPDATE admin_sessions SET expires_at = 0');
  assert.equal((await f.request('/api/admin/session', { headers: { Cookie: cookie } })).status, 401);
});

test('login failures are persisted and bounded by trusted platform IP', async t => {
  const f = fixture(t);
  let response;
  for (let attempt = 0; attempt < 6; attempt++) {
    response = await f.request('/api/admin/login', { method: 'POST', body: { password: 'wrong-password' }, headers: { Origin: origin, 'X-Forwarded-For': `192.0.2.${attempt}` } });
  }
  assert.equal(response.status, 429);
  assert.ok(Number(response.headers.get('retry-after')) > 0);
  assert.equal((await f.request('/api/admin/login', { method: 'POST', body: { password }, headers: { Origin: origin } })).status, 429);
  f.sqlite.exec('UPDATE login_attempts SET reset_at = 0');
  assert.ok(await f.login());
});

test('query filters and summaries share Shanghai day boundaries and escape literal search', async t => {
  const f = fixture(t);
  const cookie = await f.login();
  const insert = f.sqlite.prepare('INSERT INTO visits (time,ip,country,region,city,location,browser,os,path) VALUES (?,?,?,?,?,?,?,?,?)');
  const today = new Date().toISOString().slice(0, 10);
  const shanghaiStart = new Date(`${today}T00:00:00+08:00`).toISOString();
  const prior = new Date(Date.parse(shanghaiStart) - 1).toISOString();
  insert.run(prior, '1.1.1.1', '中国', '广东', '深圳', '中国 广东 深圳', 'Chrome', 'Windows', '/finance-interview-lab/');
  insert.run(shanghaiStart, '8.8.8.8', '中国', '浙江', '杭州', '中国 浙江 杭州', 'Safari', 'macOS', '/finance-interview-lab/');
  insert.run(shanghaiStart, '8.8.8.8', '中国', '浙江', '杭州', '中国 浙江 杭州', 'Safari', 'macOS', '/finance-interview-lab/');
  const res = await f.request(`/api/admin/visits?from=${today}&to=${today}&q=${encodeURIComponent('杭州')}`, { headers: { Cookie: cookie } });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.total, 2);
  assert.equal(data.pageSize, 50);
  assert.equal(data.summary.visits, 2);
  assert.equal(data.summary.uniqueIps, 1);
  assert.equal(data.summary.topRegions[0].count, 2);
  assert.ok(data.items.every(row => row.city === '杭州'));
  const literal = await f.request('/api/admin/visits?q=%25', { headers: { Cookie: cookie } });
  assert.equal((await literal.json()).total, 0);
  const injection = await f.request(`/api/admin/visits?q=${encodeURIComponent("' OR 1=1 --")}`, { headers: { Cookie: cookie } });
  assert.equal((await injection.json()).total, 0);
  for (const query of ['from=2026-02-30', 'from=garbage', 'page=0', 'page=1.2', 'page=1e3', 'page=1000001', 'from=2026-02-02&to=2026-02-01', `q=${'x'.repeat(201)}`]) {
    assert.equal((await f.request(`/api/admin/visits?${query}`, { headers: { Cookie: cookie } })).status, 400, query);
  }
});

test('pagination counts all filtered visits and CSV is UTF-8 formula-safe', async t => {
  const f = fixture(t);
  const cookie = await f.login();
  const insert = f.sqlite.prepare('INSERT INTO visits (time,ip,country,region,city,location,browser,os,path) VALUES (?,?,?,?,?,?,?,?,?)');
  for (let i = 0; i < 53; i++) insert.run(new Date().toISOString(), `8.8.8.${i}`, '中国', '=2+2', '+SUM(1,2)', '@command', '-formula', '\tformula', '/finance-interview-lab/');
  const response = await f.request('/api/admin/visits?page=2', { headers: { Cookie: cookie } });
  const data = await response.json();
  assert.equal(data.total, 53);
  assert.equal(data.items.length, 3);
  assert.equal(data.pages, 2);
  assert.equal(data.summary.uniqueIps, 53);
  const csv = await f.request('/api/admin/export', { headers: { Cookie: cookie } });
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-disposition'), /attachment/);
  assert.match(csv.headers.get('content-type'), /text\/csv; charset=utf-8/);
  const bytes = new Uint8Array(await csv.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [239, 187, 191]);
  const text = new TextDecoder().decode(bytes);
  for (const value of ["'=2+2", "'+SUM(1,2)", "'@command", "'-formula", "'\tformula"]) assert.ok(text.includes(value), value);
  assert.equal(text.trim().split('\r\n').length, 54);
  assert.equal((await f.request('/api/admin/export?from=invalid', { headers: { Cookie: cookie } })).status, 400);
});

test('large CSV downloads stream bounded chunks and exclude visits arriving after export starts', async t => {
  const f = fixture(t);
  const cookie = await f.login();
  const insert = f.sqlite.prepare('INSERT INTO visits (time,ip,country,region,city,location,browser,os,path) VALUES (?,?,?,?,?,?,?,?,?)');
  const timestamp = new Date().toISOString();
  f.sqlite.exec('BEGIN');
  for (let i = 0; i < 5001; i++) insert.run(timestamp, `row-${i}`, '中国', '浙江', '杭州', '中国 / 浙江 / 杭州', 'Chrome', 'Windows', `/finance-interview-lab/${'a'.repeat(500)}`);
  f.sqlite.exec('COMMIT');
  const response = await f.request('/api/admin/export', { headers: { Cookie: cookie } });
  assert.equal(response.status, 200);
  insert.run(timestamp, 'new-visit-excluded', '', '', '', '', '', '', '/finance-interview-lab/');
  const reader = response.body.getReader();
  const first = await reader.read();
  assert.ok(first.value.length < 2000000, 'A download should not buffer all CSV rows in a single response chunk');
  const decoder = new TextDecoder();
  let csv = decoder.decode(first.value, { stream: true });
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    csv += decoder.decode(chunk.value, { stream: true });
  }
  csv += decoder.decode();
  assert.equal(csv.trim().split('\r\n').length, 5002);
  assert.ok(!csv.includes('new-visit-excluded'));
  const rows = csv.trim().split('\r\n').slice(1);
  assert.equal(new Set(rows.map(row => row.split(',')[1])).size, 5001);
});

test('scheduled cleanup enforces retention, count cap, and expired auth cleanup', async t => {
  const f = fixture(t, { RETENTION_DAYS: '7' });
  await f.login();
  const oldTime = new Date(Date.now() - 8 * 86400000).toISOString();
  const insert = f.sqlite.prepare('INSERT INTO visits (time,ip,country,region,city,location,browser,os,path) VALUES (?,?,?,?,?,?,?,?,?)');
  insert.run(oldTime, '1.1.1.1', '', '', '', '', '', '', '/finance-interview-lab/');
  f.sqlite.exec('BEGIN');
  for (let i = 0; i < 100002; i++) insert.run(new Date().toISOString(), '8.8.8.8', '', '', '', '', '', '', '/finance-interview-lab/');
  f.sqlite.exec('COMMIT');
  f.sqlite.exec('UPDATE admin_sessions SET expires_at = 0');
  f.sqlite.exec("INSERT INTO login_attempts (ip,failures,reset_at) VALUES ('8.8.4.4',5,0)");
  await worker.scheduled({}, f.env, { waitUntil() {} });
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM visits').get().n, 100000);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM visits WHERE time = ?').get(oldTime).n, 0);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM admin_sessions').get().n, 0);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM login_attempts').get().n, 0);
});

test('assets and unknown API requests create no visits and receive security headers', async t => {
  const f = fixture(t);
  for (const route of ['/', '/admin.js', '/admin.css']) {
    const response = await f.request(route);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert.match(response.headers.get('content-security-policy'), /script-src 'self'/);
  }
  for (const route of ['/api/admin/not-found', '/api/not-found', '/.env', '/wrangler.jsonc', '/migrations/0001_visitors.sql']) assert.equal((await f.request(route)).status, 404, route);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM visits').get().n, 0);
});
