import { authenticate, HttpError, login, logout } from './auth.mjs';

const DAY_MS = 86400000;
const SHANGHAI_OFFSET = 8 * 60 * 60 * 1000;
const PAGE_SIZE = 50;
const ASSET_PATHS = new Set(['/', '/index.html', '/admin.js', '/admin.css', '/shared.css', '/favicon.ico']);
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
};

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });
}

function daysToRetain(env) {
  const days = Number(env.RETENTION_DAYS || 90);
  if (!Number.isInteger(days) || days < 1 || days > 3650) throw new HttpError(503, '访问记录保留时间配置不正确。');
  return days;
}

async function readJson(request, maximum) {
  if (!(request.headers.get('Content-Type') || '').toLowerCase().startsWith('application/json')) throw new HttpError(415, '请使用 JSON 格式提交请求。');
  const declaredLength = request.headers.get('Content-Length');
  if (declaredLength && Number(declaredLength) > maximum) throw new HttpError(413, '提交内容过长。');
  if (!request.body) throw new HttpError(400, '请求内容不能为空。');
  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maximum) { await reader.cancel(); throw new HttpError(413, '提交内容过长。'); }
    chunks.push(value);
  }
  const buffer = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Object required');
    return body;
  } catch { throw new HttpError(400, '请求内容不是有效的 JSON 对象。'); }
}

function configuredSiteOrigin(env) {
  try {
    const url = new URL(env.ALLOWED_ORIGIN);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== env.ALLOWED_ORIGIN) throw new Error('Invalid origin');
    return url.origin;
  } catch { throw new HttpError(503, '访问记录服务尚未配置网站来源。'); }
}

function requireVisitOrigin(request, env) {
  const origin = configuredSiteOrigin(env);
  if (request.headers.get('Origin') !== origin) throw new HttpError(403, '不允许此网站提交访问记录。');
  return origin;
}

function requireAdminOrigin(request) {
  if (request.headers.get('Origin') !== new URL(request.url).origin) throw new HttpError(403, '请求来源不匹配，请从后台页面重新操作。');
}

function visitPath(input, env) {
  const prefix = env.SITE_PATH_PREFIX;
  if (typeof prefix !== 'string' || !prefix.startsWith('/') || !prefix.endsWith('/') || /[?#\\%\u0000-\u0020]/.test(prefix)) throw new HttpError(503, '访问记录服务尚未正确配置网站路径。');
  if (typeof input !== 'string' || input.length > 1024) throw new HttpError(400, '访问页面路径无效。');
  let decoded;
  try { decoded = decodeURIComponent(input); } catch { throw new HttpError(400, '访问页面路径无效。'); }
  if (!decoded.startsWith(prefix) || decoded.startsWith('//') || /[?#\\%\u0000-\u001f\u007f]/.test(decoded) || decoded.split('/').some(part => part === '.' || part === '..')) throw new HttpError(400, '访问页面路径无效。');
  return decoded;
}

function normalizeIp(value) {
  if (!value || value.length > 64) return null;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) {
    const parts = value.split('.').map(Number);
    return parts.every(part => part <= 255) ? parts.join('.') : null;
  }
  if (!/^[a-f0-9:.]+$/i.test(value) || !value.includes(':')) return null;
  try {
    const normalized = new URL(`http://[${value}]/`).hostname.slice(1, -1);
    const mapped = normalized.match(/^::ffff:([a-f0-9]+):([a-f0-9]+)$/i);
    if (mapped) {
      const high = parseInt(mapped[1], 16), low = parseInt(mapped[2], 16);
      return [high >> 8, high & 255, low >> 8, low & 255].join('.');
    }
    return normalized;
  } catch { return null; }
}

function platformIp(request, env) {
  const ip = normalizeIp(request.headers.get('CF-Connecting-IP'));
  if (ip) return ip;
  const hostname = new URL(request.url).hostname;
  if (String(env.LOCAL_DEV) === 'true' && ['localhost', '127.0.0.1', '[::1]'].includes(hostname)) return '127.0.0.1';
  throw new HttpError(400, '未获取到可信的访客网络地址。');
}

function isLocalIp(ip) {
  if (ip.includes(':')) return ip === '::' || ip === '::1' || /^(fc|fd|fe[89ab])/i.test(ip);
  const [a, b] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
}

function locationInfo(request, ip) {
  if (isLocalIp(ip)) return { country: '', region: '', city: '', location: '本地 / 内网' };
  const cf = request.cf || {};
  const clean = value => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 120) : '';
  const code = clean(cf.country);
  let country = code;
  if (/^[A-Z]{2}$/.test(code) && code !== 'XX' && code !== 'ZZ') {
    try { country = new Intl.DisplayNames(['zh-CN'], { type: 'region' }).of(code) || code; } catch { country = code; }
  } else country = '';
  const region = clean(cf.region), city = clean(cf.city);
  return { country, region, city, location: [country, region, city].filter(Boolean).join(' / ') || '未知地区' };
}

function userAgentInfo(request) {
  const ua = (request.headers.get('User-Agent') || '').slice(0, 512);
  const browsers = [[/Edg(?:e|A|iOS)?\//i, 'Edge'], [/OPR\/|Opera/i, 'Opera'], [/Firefox\/|FxiOS\//i, 'Firefox'], [/Chrome\/|CriOS\//i, 'Chrome'], [/Safari\//i, 'Safari']];
  const systems = [[/iPhone|iPad|iPod/i, 'iOS'], [/Android/i, 'Android'], [/Windows/i, 'Windows'], [/Mac OS X|Macintosh/i, 'macOS'], [/Linux/i, 'Linux']];
  return { browser: browsers.find(([pattern]) => pattern.test(ua))?.[1] || '未知浏览器', os: systems.find(([pattern]) => pattern.test(ua))?.[1] || '未知系统' };
}

async function cleanup(env, force = false) {
  const now = Date.now();
  if (!force) {
    const claim = await env.DB.prepare("UPDATE maintenance_state SET last_run = ? WHERE name = 'cleanup' AND last_run < ?").bind(now, now - 15 * 60 * 1000).run();
    if (!claim.meta.changes) return;
  }
  await env.DB.batch([
    env.DB.prepare('DELETE FROM visits WHERE time < ?').bind(new Date(now - daysToRetain(env) * DAY_MS).toISOString()),
    env.DB.prepare('DELETE FROM visits WHERE id <= (SELECT MAX(id) - 100000 FROM visits)'),
    env.DB.prepare('DELETE FROM admin_sessions WHERE expires_at <= ?').bind(now),
    env.DB.prepare('DELETE FROM login_attempts WHERE reset_at <= ?').bind(now)
  ]);
}

async function recordVisit(request, env) {
  const origin = requireVisitOrigin(request, env);
  const body = await readJson(request, 2048);
  const path = visitPath(body.path, env);
  const ip = platformIp(request, env);
  const place = locationInfo(request, ip);
  const agent = userAgentInfo(request);
  await cleanup(env);
  await env.DB.batch([
    env.DB.prepare('INSERT INTO visits (time,ip,country,region,city,location,browser,os,path) VALUES (?,?,?,?,?,?,?,?,?)').bind(new Date().toISOString(), ip, place.country, place.region, place.city, place.location, agent.browser, agent.os, path),
    env.DB.prepare('DELETE FROM visits WHERE id <= (SELECT MAX(id) - 100000 FROM visits)')
  ]);
  return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Cache-Control': 'no-store' } });
}

function dateBoundary(value, exclusiveEnd = false) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new HttpError(400, '日期格式应为 YYYY-MM-DD。');
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new HttpError(400, '请选择有效的日期。');
  return new Date(date.getTime() - SHANGHAI_OFFSET + (exclusiveEnd ? DAY_MS : 0)).toISOString();
}

function queryFilters(url, env) {
  const params = url.searchParams;
  const q = (params.get('q') || '').trim();
  const from = params.get('from') || '', to = params.get('to') || '';
  const pageText = params.get('page') || '1';
  if (q.length > 200) throw new HttpError(400, '搜索内容请控制在 200 个字符以内。');
  if (!/^[1-9]\d*$/.test(pageText) || Number(pageText) > 1000000) throw new HttpError(400, '页码必须是有效的正整数。');
  const retentionDays = daysToRetain(env);
  const conditions = ['time >= ?'];
  const values = [new Date(Date.now() - retentionDays * DAY_MS).toISOString()];
  if (from) { conditions.push('time >= ?'); values.push(dateBoundary(from)); }
  if (to) { conditions.push('time < ?'); values.push(dateBoundary(to, true)); }
  if (from && to && from > to) throw new HttpError(400, '开始日期不能晚于结束日期。');
  if (q) {
    const literal = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
    conditions.push("(ip LIKE ? ESCAPE '\\' OR location LIKE ? ESCAPE '\\')");
    values.push(literal, literal);
  }
  return { where: `WHERE ${conditions.join(' AND ')}`, values, page: Number(pageText), retentionDays };
}

async function listVisits(url, env) {
  const { where, values, page, retentionDays } = queryFilters(url, env);
  const today = new Date(Date.now() + SHANGHAI_OFFSET).toISOString().slice(0, 10);
  const todayFrom = dateBoundary(today), todayTo = dateBoundary(today, true);
  const results = await env.DB.batch([
    env.DB.prepare(`SELECT COUNT(*) AS visits, COUNT(DISTINCT ip) AS uniqueIps, COALESCE(SUM(CASE WHEN time >= ? AND time < ? THEN 1 ELSE 0 END),0) AS todayVisits FROM visits ${where}`).bind(todayFrom, todayTo, ...values),
    env.DB.prepare(`SELECT id,time,ip,country,region,city,location,browser,os,path FROM visits ${where} ORDER BY time DESC, id DESC LIMIT ? OFFSET ?`).bind(...values, PAGE_SIZE, (page - 1) * PAGE_SIZE),
    env.DB.prepare(`SELECT CASE WHEN country <> '' OR region <> '' THEN trim(country || ' / ' || region, ' /') ELSE location END AS region, COUNT(*) AS count FROM visits ${where} GROUP BY 1 ORDER BY count DESC, region ASC LIMIT 5`).bind(...values)
  ]);
  const stats = results[0].results[0];
  const total = stats.visits;
  return json({ items: results[1].results, total, page, pageSize: PAGE_SIZE, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), summary: { ...stats, topRegions: results[2].results }, retentionDays });
}

function csvCell(value) {
  let text = String(value ?? '');
  if (/^[\s\u0000-\u001f]*[=+\-@]|^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

async function exportVisits(url, env) {
  const { where, values } = queryFilters(url, env);
  const keys = ['time', 'ip', 'country', 'region', 'city', 'location', 'browser', 'os', 'path'];
  const header = ['访问时间（UTC）', 'IP 地址', '国家或地区', '省份或区域', '城市', '大致位置', '浏览器', '操作系统', '访问页面'];
  const maximumId = await env.DB.prepare('SELECT COALESCE(MAX(id),0) AS id FROM visits').first('id');
  const batchSize = 2500;
  let cursor = null;
  let emitted = 0;
  async function nextBatch() {
    const continuation = cursor ? ' AND (time,id) < (?,?)' : '';
    const cursorValues = cursor ? [cursor.time, cursor.id] : [];
    const result = await env.DB.prepare(`SELECT id,${keys.join(',')} FROM visits ${where} AND id <= ?${continuation} ORDER BY time DESC, id DESC LIMIT ?`).bind(...values, maximumId, ...cursorValues, Math.min(batchSize, 100000 - emitted)).all();
    return result.results;
  }
  // Fetch the first batch before sending headers, then keep exports within
  // Worker memory limits and the free D1 budget of 50 queries per request.
  let pending = await nextBatch();
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) { controller.enqueue(encoder.encode(`\uFEFF${header.map(csvCell).join(',')}\r\n`)); },
    async pull(controller) {
      try {
        const rows = pending || await nextBatch();
        pending = null;
        if (rows.length) {
          controller.enqueue(encoder.encode(`${rows.map(row => keys.map(key => csvCell(row[key])).join(',')).join('\r\n')}\r\n`));
          cursor = rows[rows.length - 1];
          emitted += rows.length;
        }
        if (rows.length < batchSize || emitted >= 100000) controller.close();
      } catch (error) { controller.error(error); }
    }
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="visits-${new Date().toISOString().slice(0, 10)}.csv"`, 'Cache-Control': 'no-store' } });
}

async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (path === '/api/visit') {
    if (request.method === 'OPTIONS') {
      const origin = requireVisitOrigin(request, env);
      if (request.headers.get('Access-Control-Request-Method') !== 'POST') throw new HttpError(405, '此接口仅支持 POST 请求。', { Allow: 'POST, OPTIONS' });
      const headers = (request.headers.get('Access-Control-Request-Headers') || '').toLowerCase().split(',').map(item => item.trim()).filter(Boolean);
      if (headers.some(header => header !== 'content-type')) throw new HttpError(403, '请求包含不允许的请求头。');
      return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400', Vary: 'Origin' } });
    }
    if (request.method !== 'POST') throw new HttpError(405, '此接口仅支持 POST 请求。', { Allow: 'POST, OPTIONS' });
    return recordVisit(request, env);
  }
  const adminMethods = { '/api/admin/login': 'POST', '/api/admin/session': 'GET', '/api/admin/logout': 'POST', '/api/admin/visits': 'GET', '/api/admin/export': 'GET' };
  if (Object.hasOwn(adminMethods, path)) {
    if (request.method !== adminMethods[path]) throw new HttpError(405, '此接口不支持该请求方式。', { Allow: adminMethods[path] });
    if (request.method === 'POST') requireAdminOrigin(request);
    if (path === '/api/admin/login') {
      const body = await readJson(request, 8192);
      const cookie = await login(request, env, body.password, platformIp(request, env));
      return json({ ok: true }, 200, { 'Set-Cookie': cookie });
    }
    const hash = await authenticate(request, env);
    if (path === '/api/admin/session') return json({ authenticated: true });
    if (path === '/api/admin/logout') return json({ ok: true }, 200, { 'Set-Cookie': await logout(request, env, hash) });
    await cleanup(env);
    return path === '/api/admin/visits' ? listVisits(url, env) : exportVisits(url, env);
  }
  if (!ASSET_PATHS.has(path)) throw new HttpError(404, '页面或接口不存在。');
  if (!['GET', 'HEAD'].includes(request.method)) throw new HttpError(405, '此页面仅支持 GET 请求。', { Allow: 'GET, HEAD' });
  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const localDevelopment = String(env.LOCAL_DEV) === 'true' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    let response;
    try {
      if (url.protocol === 'http:' && !localDevelopment) {
        const secureUrl = new URL(url);
        secureUrl.protocol = 'https:';
        response = new Response(null, { status: 308, headers: { Location: secureUrl.href, 'Cache-Control': 'no-store' } });
      } else response = await route(request, env);
    }
    catch (error) {
      response = error instanceof HttpError ? json({ error: error.message }, error.status, error.headers) : json({ error: '服务暂时不可用，请稍后重试。' }, 500);
      if (url.pathname === '/api/visit' && request.headers.get('Origin') === env.ALLOWED_ORIGIN) {
        response.headers.set('Access-Control-Allow-Origin', env.ALLOWED_ORIGIN);
        response.headers.set('Vary', 'Origin');
      }
    }
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(SECURITY_HEADERS)) headers.set(key, value);
    if (url.protocol === 'https:') headers.set('Strict-Transport-Security', 'max-age=31536000');
    if (url.pathname !== '/api/visit') headers.set('Cache-Control', 'no-store');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  },
  async scheduled(_event, env) { await cleanup(env, true); }
};
