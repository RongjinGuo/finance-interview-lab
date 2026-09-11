import { randomBytes, scrypt as deriveKey, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(deriveKey);
const SESSION_MS = 12 * 60 * 60 * 1000;
const WINDOW_MS = 15 * 60 * 1000;
const COOKIE = 'finance_account_session';

export class HttpError extends Error {
  constructor(status, message, extra = {}, headers = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
    this.headers = headers;
  }
}

export function validPasswordHash(value) {
  return typeof value === 'string' && /^[a-f0-9]{32}:[a-f0-9]{128}$/i.test(value);
}

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 64);
  return `${salt}:${hash.toString('hex')}`;
}

async function checkPassword(password, encoded) {
  if (!validPasswordHash(encoded)) return false;
  const [salt, expected] = encoded.split(':');
  const actual = await scrypt(password, salt, 64);
  return timingSafeEqual(actual, Buffer.from(expected, 'hex'));
}

export function publicUser(user, includeCreatedAt = false) {
  return { username: user.username, displayName: user.displayName, role: user.role, ...(includeCreatedAt ? { createdAt: user.createdAt } : {}) };
}

export async function createAuth({ secureCookies, now }) {
  const sessions = new Map();
  const attempts = new Map();
  const dummyHash = await hashPassword(randomBytes(32).toString('hex'));
  const digest = value => createHash('sha256').update(value).digest('hex');
  function prune(map, limit) {
    for (const [key, entry] of map) if (entry.expiresAt <= now()) map.delete(key);
    while (map.size >= limit) map.delete(map.keys().next().value);
  }
  function cookie(token, age) {
    return `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${age}${secureCookies ? '; Secure' : ''}`;
  }
  function readToken(request) {
    const raw = request.headers.cookie || '';
    if (raw.length > 8192) return '';
    const entry = raw.split(';').map(part => part.trim()).find(part => part.startsWith(`${COOKIE}=`));
    const token = entry?.slice(COOKIE.length + 1) || '';
    return /^[a-f0-9]{64}$/.test(token) ? token : '';
  }
  function reserveAttempt(key, limit) {
    const entry = attempts.get(key) || { count: 0, expiresAt: now() + WINDOW_MS };
    entry.count++;
    attempts.set(key, entry);
    if (entry.count > limit) throw new HttpError(429, '登录尝试过多，请稍后再试。', {}, { 'Retry-After': String(Math.max(1, Math.ceil((entry.expiresAt - now()) / 1000))) });
  }
  return {
    async login(request, username, password, users) {
      prune(attempts, 10000);
      const peer = request.socket.remoteAddress || 'unknown';
      const accountKey = `${peer}:${username}`;
      reserveAttempt(`peer:${peer}`, 100);
      reserveAttempt(accountKey, 5);
      const availableUsers = typeof users === 'function' ? await users() : users;
      const user = availableUsers.find(candidate => candidate.username === username);
      const valid = await checkPassword(password, user?.passwordHash || dummyHash);
      if (!valid || !user) throw new HttpError(401, '用户名或密码不正确。');
      attempts.delete(accountKey);
      prune(sessions, 10000);
      const token = randomBytes(32).toString('hex');
      sessions.set(digest(token), { username, expiresAt: now() + SESSION_MS });
      return { user: publicUser(user), cookie: cookie(token, SESSION_MS / 1000) };
    },
    authenticate(request, users) {
      const token = readToken(request);
      const session = token && sessions.get(digest(token));
      if (!session || session.expiresAt <= now()) {
        if (token) sessions.delete(digest(token));
        throw new HttpError(401, '请登录后继续。');
      }
      const user = users.find(candidate => candidate.username === session.username);
      if (!user) throw new HttpError(401, '账号已失效，请重新登录。');
      return user;
    },
    logout(request) {
      const token = readToken(request);
      if (token) sessions.delete(digest(token));
      return cookie('', 0);
    },
    close() { sessions.clear(); attempts.clear(); }
  };
}
