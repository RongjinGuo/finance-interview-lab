import engine from '../src/engine.js';
import bank from '../src/questions.js';
import { HttpError, validPasswordHash } from './auth.mjs';

const questionIds = new Set(bank.questions.map(question => question.id));
const roles = new Set(bank.roles.map(role => role.id));
export const validUsername = username => typeof username === 'string' && /^[a-z0-9][a-z0-9_-]{2,31}$/.test(username);
export const validPassword = password => typeof password === 'string' && password.length >= 12 && password.length <= 128;
const validName = name => typeof name === 'string' && name.trim().length > 0 && name.length <= 80 && !/[\u0000-\u001f\u007f]/.test(name);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const exactKeys = (value, keys) => plain(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

export function validateAccounts(value) {
  if (!exactKeys(value, ['users']) || !Array.isArray(value.users) || !value.users.length || value.users.length > 1000) throw new Error('Invalid accounts');
  const names = new Set();
  for (const user of value.users) {
    if (!exactKeys(user, ['username', 'displayName', 'role', 'passwordHash', 'createdAt']) || !validUsername(user.username) || names.has(user.username) || !validName(user.displayName) || !['admin', 'user'].includes(user.role) || !validPasswordHash(user.passwordHash) || typeof user.createdAt !== 'string' || !Number.isFinite(Date.parse(user.createdAt))) throw new Error('Invalid account');
    names.add(user.username);
  }
  if (!value.users.some(user => user.role === 'admin')) throw new Error('Administrator required');
  return value;
}

export function validateNewUser(body) {
  if (!exactKeys(body, ['username', 'displayName', 'password']) || !validUsername(body.username) || !validName(body.displayName) || !validPassword(body.password)) throw new HttpError(400, '用户名需为 3–32 位小写字母、数字、下划线或连字符；姓名需为 1–80 字，密码需为 12–128 字。');
}

export function validateState(state) {
  if (!exactKeys(state, ['settings', 'active', 'history', 'favorites'])) return false;
  if (!exactKeys(state.settings, ['role', 'mode', 'count']) || !roles.has(state.settings.role) || !['practice', 'mock'].includes(state.settings.mode) || ![6, 10].includes(state.settings.count)) return false;
  if (state.active !== null && (!engine.validateSession(state.active, bank.questions) || state.active.phase === 'finished')) return false;
  if (!Array.isArray(state.history) || state.history.length > 30 || !state.history.every(session => engine.validateSession(session, bank.questions) && session.phase === 'finished')) return false;
  const sessionIds = state.history.map(session => session.id);
  if (state.active) sessionIds.push(state.active.id);
  if (new Set(sessionIds).size !== sessionIds.length) return false;
  if (!Array.isArray(state.favorites) || state.favorites.length > questionIds.size || !state.favorites.every(id => questionIds.has(id)) || new Set(state.favorites).size !== state.favorites.length) return false;
  return true;
}

export function validateSave(body) {
  if (!exactKeys(body, ['revision', 'mutationId', 'state']) || !Number.isSafeInteger(body.revision) || body.revision < 0 || typeof body.mutationId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(body.mutationId) || !validateState(body.state)) throw new HttpError(400, '练习记录格式无效，请保留本地草稿后重试。');
  // Reserve room for the revision and replay ledger in the Git document.
  if (Buffer.byteLength(JSON.stringify(body.state)) > 8 * 1024 * 1024 - 32768) throw new HttpError(413, '练习记录过大，请导出并清理部分历史记录。');
}

export function stateEnvelope(document) {
  if (document === null) return { revision: 0, updatedAt: null, state: null };
  if (!plain(document) || !Number.isSafeInteger(document.revision) || document.revision < 1 || typeof document.updatedAt !== 'string' || !Number.isFinite(Date.parse(document.updatedAt)) || !validateState(document.state)) throw new Error('Invalid stored state');
  return { revision: document.revision, updatedAt: document.updatedAt, state: document.state };
}
