import { randomBytes, pbkdf2Sync } from 'node:crypto';
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const privateDir = path.join(os.homedir(), '.local/share/finance-interview-lab');
await mkdir(privateDir, { recursive: true, mode: 0o700 });
await chmod(privateDir, 0o700);
const accessPath = path.join(privateDir, 'admin-access.json');
let access;
try { access = JSON.parse(await readFile(accessPath, 'utf8')); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  const password = randomBytes(21).toString('base64url');
  const salt = randomBytes(16).toString('hex');
  access = { password, hash: `${salt}:${pbkdf2Sync(password, Buffer.from(salt, 'hex'), 100000, 32, 'sha256').toString('hex')}`, sessionSecret: randomBytes(32).toString('hex') };
  await writeFile(accessPath, JSON.stringify(access, null, 2), { mode: 0o600 });
}
const secrets = { ADMIN_PASSWORD_HASH: access.hash, SESSION_SECRET: access.sessionSecret };
await writeFile(path.join(privateDir, 'worker-secrets.json'), JSON.stringify(secrets, null, 2), { mode: 0o600 });
await writeFile(path.join(root, 'worker/.dev.vars'), Object.entries({ ...secrets, ALLOWED_ORIGIN: 'http://127.0.0.1:43188', SITE_PATH_PREFIX: '/', LOCAL_DEV: 'true' }).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join('\n') + '\n', { mode: 0o600 });
const info = `# 财务面试访问后台\n\n管理员密码：\`${access.password}\`\n\n后台网址将在部署完成后填入项目的 deployment.json。\n\n这份文件保存在本机，未提交到 GitHub。密码不要发给访客。\n`;
await writeFile(path.join(privateDir, '后台登录信息.md'), info, { mode: 0o600 });
console.log(`Admin credentials prepared in ${privateDir}. Secrets are not printed.`);
