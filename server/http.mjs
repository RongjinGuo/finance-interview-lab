import http from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createAuth, hashPassword, HttpError, publicUser } from './auth.mjs';
import { exactKeys, stateEnvelope, validPassword, validUsername, validateAccounts, validateNewUser, validateSave } from './validation.mjs';

const ASSETS = new Map([
  ['/', 'index.html'], ['/index.html', 'index.html'],
  ...['app.js', 'engine.js', 'questions.js', 'styles.css', 'accounts.js', 'account.css', 'visits.js'].map(name => [`/src/${name}`, `src/${name}`]),
  ['/dist/财务面试练习室.html', 'dist/财务面试练习室.html'], ['/favicon.ico', 'favicon.ico']
]);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.ico': 'image/x-icon' };
const loopback = address => ['localhost', '127.0.0.1', '[::1]', '::1', '::ffff:127.0.0.1'].includes(address);

function readJson(request, limit) {
  return new Promise((resolve, reject) => {
    if (!(request.headers['content-type'] || '').toLowerCase().startsWith('application/json')) { request.resume(); reject(new HttpError(415, '请使用 JSON 格式提交。')); return; }
    const chunks = [];
    let size = 0;
    let completed = false;
    request.on('data', chunk => {
      if (completed) return;
      size += chunk.length;
      if (size > limit) { completed = true; chunks.length = 0; reject(new HttpError(413, '提交内容过大。')); return; }
      chunks.push(chunk);
    });
    request.once('end', () => {
      if (completed) return;
      try {
        const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Object required');
        resolve(value);
      } catch { reject(new HttpError(400, '请求内容不是有效的 JSON 对象。')); }
    });
    request.once('error', () => reject(new HttpError(400, '请求未完整接收，请重试。')));
    request.once('aborted', () => reject(new HttpError(400, '请求已中断，请重试。')));
  });
}

function requestPath(request) {
  if (!request.url?.startsWith('/') || request.url.startsWith('//')) throw new HttpError(400, '请求路径无效。');
  const rawPath = request.url.split('?')[0];
  let decoded;
  try { decoded = decodeURIComponent(rawPath); } catch { throw new HttpError(400, '请求路径无效。'); }
  if (/[\\%\u0000-\u001f\u007f]/.test(decoded) || decoded.split('/').some(segment => segment === '.' || segment === '..')) throw new HttpError(400, '请求路径无效。');
  return decoded;
}

export async function createApp({ root = process.cwd(), store, publicOrigin, localDev = false, initialUsers = [], now = Date.now } = {}) {
  let origin;
  try { origin = new URL(publicOrigin); } catch { throw new Error('PUBLIC_ORIGIN must be an HTTPS origin.'); }
  const development = (localDev === true || localDev === 'true') && loopback(origin.hostname);
  if (origin.origin !== publicOrigin || (origin.protocol !== 'https:' && !(development && origin.protocol === 'http:'))) throw new Error('PUBLIC_ORIGIN must be an HTTPS origin; HTTP requires LOCAL_DEV and loopback.');
  const secureCookies = origin.protocol === 'https:';
  const auth = await createAuth({ secureCookies, now });
  const rootPath = await realpath(root);
  let ready = false;
  let accountsCache = null;
  let accountGeneration = 0;
  let nextAccountRefresh = 0;
  let nextInitialization = 0;
  let initialization = null;
  let accountRefresh = null;
  function cacheAccounts(document) {
    accountsCache = validateAccounts(document);
    accountGeneration++;
    nextAccountRefresh = now() + 30000;
  }
  async function initialize() {
    if (initialization) return initialization;
    if (ready || now() < nextInitialization) return;
    nextInitialization = now() + 30000;
    initialization = (async () => {
      try {
        await store.init();
        const existing = await store.read('accounts.json');
        if (existing) cacheAccounts(existing);
        else {
          const bootstrap = validateAccounts({ users: initialUsers.map(user => ({ ...user, createdAt: user.createdAt || new Date(now()).toISOString() })) });
          cacheAccounts(await store.update('accounts.json', current => current ? validateAccounts(current) : bootstrap, 'Initialize accounts'));
        }
        ready = true;
      } catch { ready = false; }
    })();
    try { await initialization; } finally { initialization = null; }
  }
  async function refreshAccounts() {
    if (accountRefresh) return accountRefresh;
    if (now() < nextAccountRefresh) return;
    const generation = accountGeneration;
    nextAccountRefresh = now() + 30000;
    accountRefresh = (async () => {
      const latest = validateAccounts(await store.read('accounts.json'));
      // A concurrent account creation has a newer acknowledged snapshot.
      if (generation === accountGeneration) cacheAccounts(latest);
    })();
    try { await accountRefresh; } finally { accountRefresh = null; }
  }
  await initialize();

  const sendJson = (response, status, body, headers = {}) => {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
    response.end(JSON.stringify(body));
  };
  async function handle(request, response) {
    const pathname = requestPath(request);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Frame-Options', 'DENY');
    if (secureCookies) response.setHeader('Strict-Transport-Security', 'max-age=31536000');
    if (development && !loopback(request.socket.remoteAddress)) throw new HttpError(403, '本地开发模式仅允许本机访问。');
    if (pathname === '/api/health') {
      if (request.method !== 'GET') throw new HttpError(405, '请求方式不支持。');
      await initialize();
      sendJson(response, ready ? 200 : 503, { ok: ready });
      return;
    }
    if (pathname.startsWith('/api/')) {
      response.setHeader('Cache-Control', 'no-store');
      const adminState = pathname.match(/^\/api\/admin\/users\/([^/]+)\/state$/);
      const methods = { '/api/login': ['POST'], '/api/session': ['GET'], '/api/logout': ['POST'], '/api/state': ['GET', 'PUT'], '/api/admin/users': ['GET', 'POST'] };
      const allowed = adminState ? ['GET'] : methods[pathname];
      if (!allowed) throw new HttpError(404, '接口不存在。');
      if (!allowed.includes(request.method)) throw new HttpError(405, '请求方式不支持。', {}, { Allow: allowed.join(', ') });
      if (['POST', 'PUT'].includes(request.method) && request.headers.origin !== publicOrigin) throw new HttpError(403, '请求来源不匹配，请从网站页面重试。');
      if (pathname === '/api/login') {
        const body = await readJson(request, 8192);
        if (!exactKeys(body, ['username', 'password']) || !validUsername(body.username) || !validPassword(body.password)) throw new HttpError(400, '请输入有效的用户名和 12–128 字密码。');
        const result = await auth.login(request, body.username, body.password, async () => {
          await initialize();
          if (!ready) throw new HttpError(503, '账号存储尚未就绪，请稍后重试。');
          return accountsCache.users;
        });
        sendJson(response, 200, { user: result.user }, { 'Set-Cookie': result.cookie });
        return;
      }
      let user = auth.authenticate(request, accountsCache?.users || []);
      if (pathname === '/api/state') {
        const expectedAccount = request.headers['x-finance-account'];
        if (!validUsername(expectedAccount)) throw new HttpError(400, '请明确当前练习所属的账号后再读取或保存。');
        if (expectedAccount !== user.username) throw new HttpError(401, '登录账号已在其他页面切换，请保留当前草稿并重新登录原账号。');
      }
      if (pathname === '/api/logout') {
        sendJson(response, 200, { ok: true }, { 'Set-Cookie': auth.logout(request) });
        return;
      }
      if (pathname.startsWith('/api/admin/') && user.role !== 'admin') throw new HttpError(403, '此操作需要管理员权限。');
      await refreshAccounts();
      const accounts = accountsCache;
      user = auth.authenticate(request, accounts.users);
      if (pathname.startsWith('/api/admin/') && user.role !== 'admin') throw new HttpError(403, '此操作需要管理员权限。');
      if (pathname === '/api/session') sendJson(response, 200, { user: publicUser(user) });
      else if (pathname === '/api/admin/users') {
        if (request.method === 'GET') sendJson(response, 200, { users: accounts.users.map(account => publicUser(account, true)) });
        else {
          const body = await readJson(request, 8192);
          validateNewUser(body);
          const account = { username: body.username, displayName: body.displayName.trim(), role: 'user', passwordHash: await hashPassword(body.password), createdAt: new Date(now()).toISOString() };
          const updatedAccounts = await store.update('accounts.json', current => {
            const latest = validateAccounts(current);
            if (latest.users.some(candidate => candidate.username === account.username)) throw new HttpError(409, '该用户名已存在。');
            if (latest.users.length >= 1000) throw new HttpError(400, '账号数量已达到上限。');
            return { users: [...latest.users, account] };
          }, 'Create account');
          cacheAccounts(updatedAccounts);
          sendJson(response, 201, { user: publicUser(account, true) });
        }
      } else if (adminState) {
        const username = adminState[1];
        if (!validUsername(username) || !accounts.users.some(account => account.username === username)) throw new HttpError(404, '账号不存在。');
        sendJson(response, 200, stateEnvelope(await store.read(`users/${username}/state.json`)));
      } else if (request.method === 'GET') sendJson(response, 200, stateEnvelope(await store.read(`users/${user.username}/state.json`)));
      else {
        const body = await readJson(request, 8 * 1024 * 1024);
        validateSave(body);
        const digest = createHash('sha256').update(JSON.stringify(body.state)).digest('hex');
        const saved = await store.update(`users/${user.username}/state.json`, current => {
          const envelope = stateEnvelope(current);
          const mutations = Array.isArray(current?.mutations) ? current.mutations : [];
          const previous = mutations.find(mutation => mutation.id === body.mutationId);
          if (previous) {
            if (previous.digest !== digest) throw new HttpError(409, '此保存编号已用于不同的内容。', { current: envelope });
            return current;
          }
          if (body.revision !== envelope.revision) throw new HttpError(409, '其他设备已更新这份记录，请选择要保留的版本。', { current: envelope });
          return { revision: envelope.revision + 1, updatedAt: new Date(now()).toISOString(), state: body.state, mutations: [...mutations, { id: body.mutationId, digest }].slice(-100) };
        }, `Save practice for ${user.username}`);
        sendJson(response, 200, stateEnvelope(saved));
      }
      return;
    }
    if (!['GET', 'HEAD'].includes(request.method)) throw new HttpError(405, '请求方式不支持。');
    const generated = { '/src/account-config.js': 'window.FinanceAccountConfig = {enabled:true};\n', '/src/visit-config.js': "window.FinanceVisitConfig = {endpoint:''};\n" };
    let content, filename;
    if (Object.hasOwn(generated, pathname)) { content = Buffer.from(generated[pathname]); filename = pathname; }
    else {
      const asset = ASSETS.get(pathname);
      if (!asset) throw new HttpError(404, '页面不存在。');
      try {
        filename = await realpath(path.join(rootPath, asset));
        if (!filename.startsWith(`${rootPath}${path.sep}`)) throw new HttpError(404, '页面不存在。');
        content = await readFile(filename);
      } catch { throw new HttpError(404, '页面不存在。'); }
    }
    const hashes = pathname.startsWith('/dist/') ? [...content.toString().matchAll(/<script>([\s\S]*?)<\/script>/gi)].map(match => `'sha256-${createHash('sha256').update(match[1]).digest('base64')}'`).join(' ') : '';
    response.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self' ${hashes}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`);
    response.writeHead(200, { 'Content-Type': TYPES[path.extname(filename)] || 'application/octet-stream', 'Content-Length': content.length, 'Cache-Control': 'no-store' });
    response.end(request.method === 'HEAD' ? undefined : content);
  }
  const server = http.createServer((request, response) => {
    handle(request, response).catch(error => {
      if (response.headersSent) { response.destroy(); return; }
      if (error instanceof HttpError) sendJson(response, error.status, { error: error.message, ...error.extra }, error.headers);
      else sendJson(response, 503, { error: '云端存储暂时不可用，请保留本地草稿并稍后重试。' });
    });
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  return { server, async close() { auth.close(); if (server.listening) { server.closeAllConnections(); await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); } } };
}
