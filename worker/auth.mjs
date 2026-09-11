const encoder = new TextEncoder();
const COOKIE = 'visitor_admin_session';
const SESSION_SECONDS = 12 * 60 * 60;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

export class HttpError extends Error {
  constructor(status, message, headers = {}) {
    super(message);
    this.status = status;
    this.headers = headers;
  }
}

const hex = bytes => Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
const unhex = value => Uint8Array.from(value.match(/../g), byte => parseInt(byte, 16));

async function sessionKey(env) {
  if (typeof env.SESSION_SECRET !== 'string' || env.SESSION_SECRET.length < 32) {
    throw new HttpError(503, '后台登录密钥尚未正确配置。');
  }
  return crypto.subtle.importKey('raw', encoder.encode(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function verifyPassword(password, configuredHash) {
  if (typeof configuredHash !== 'string' || !/^[a-f0-9]{32,128}:[a-f0-9]{64}$/i.test(configuredHash)) {
    throw new HttpError(503, '后台密码尚未正确配置。');
  }
  const [salt, expected] = configuredHash.split(':');
  if (salt.length % 2) throw new HttpError(503, '后台密码尚未正确配置。');
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const actual = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: unhex(salt), iterations: 100000, hash: 'SHA-256' }, key, 256));
  const target = unhex(expected);
  let difference = 0;
  for (let index = 0; index < target.length; index++) difference |= actual[index] ^ target[index];
  return difference === 0;
}

function cookieValue(request) {
  const cookie = request.headers.get('Cookie') || '';
  if (cookie.length > 8192) return null;
  const value = cookie.split(';').map(part => part.trim()).find(part => part.startsWith(`${COOKIE}=`));
  return value ? value.slice(COOKIE.length + 1) : null;
}

function sessionCookie(request, value, maxAge) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${COOKIE}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure}`;
}

async function tokenHash(token) {
  return hex(await crypto.subtle.digest('SHA-256', encoder.encode(token)));
}

export async function authenticate(request, env) {
  const token = cookieValue(request);
  if (!token || !/^[a-f0-9]{64}\.[a-f0-9]{64}$/.test(token)) throw new HttpError(401, '请先登录后台。');
  const [random, signature] = token.split('.');
  const key = await sessionKey(env);
  const valid = await crypto.subtle.verify('HMAC', key, unhex(signature), encoder.encode(random));
  if (!valid) throw new HttpError(401, '登录已失效，请重新登录。');
  const hash = await tokenHash(token);
  const session = await env.DB.prepare('SELECT token_hash FROM admin_sessions WHERE token_hash = ? AND expires_at > ?').bind(hash, Date.now()).first();
  if (!session) throw new HttpError(401, '登录已失效，请重新登录。');
  return hash;
}

export async function login(request, env, password, ip) {
  if (typeof password !== 'string' || password.length > 1024) throw new HttpError(400, '请输入有效的后台密码。');
  const now = Date.now();
  // Reserve attempts atomically so concurrent requests cannot bypass the limit.
  const attempt = await env.DB.prepare(`
    INSERT INTO login_attempts (ip,failures,reset_at) VALUES (?,1,?)
    ON CONFLICT(ip) DO UPDATE SET
      failures = CASE WHEN reset_at <= ? THEN 1 ELSE failures + 1 END,
      reset_at = CASE WHEN reset_at <= ? THEN ? ELSE reset_at END
    RETURNING failures,reset_at
  `).bind(ip, now + LOGIN_WINDOW_MS, now, now, now + LOGIN_WINDOW_MS).first();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM login_attempts WHERE reset_at <= ?').bind(now),
    env.DB.prepare('DELETE FROM login_attempts WHERE ip IN (SELECT ip FROM login_attempts ORDER BY reset_at DESC, ip DESC LIMIT -1 OFFSET 10000)')
  ]);
  if (attempt.failures > 5) throw new HttpError(429, '尝试次数过多，请在 15 分钟后重试。', { 'Retry-After': String(Math.max(1, Math.ceil((attempt.reset_at - now) / 1000))) });
  if (!await verifyPassword(password, env.ADMIN_PASSWORD_HASH)) throw new HttpError(401, '密码不正确，请重试。');

  const random = hex(crypto.getRandomValues(new Uint8Array(32)));
  const signature = hex(await crypto.subtle.sign('HMAC', await sessionKey(env), encoder.encode(random)));
  const token = `${random}.${signature}`;
  await env.DB.batch([
    env.DB.prepare('DELETE FROM login_attempts WHERE ip = ?').bind(ip),
    env.DB.prepare('INSERT INTO admin_sessions (token_hash,created_at,expires_at) VALUES (?,?,?)').bind(await tokenHash(token), now, now + SESSION_SECONDS * 1000),
    env.DB.prepare('DELETE FROM admin_sessions WHERE expires_at <= ?').bind(now),
    env.DB.prepare('DELETE FROM admin_sessions WHERE token_hash IN (SELECT token_hash FROM admin_sessions ORDER BY created_at DESC, token_hash DESC LIMIT -1 OFFSET 1000)')
  ]);
  return sessionCookie(request, token, SESSION_SECONDS);
}

export async function logout(request, env, hash) {
  await env.DB.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').bind(hash).run();
  return sessionCookie(request, '', 0);
}
