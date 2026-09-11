import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;
const MAX_PUSH_ATTEMPTS = 3;
const queues = new Map();

function failure(message, code = 'GIT_STORE_UNAVAILABLE') {
  return Object.assign(new Error(message), { code });
}

function safePath(value) {
  if (typeof value !== 'string' || value.length > 240 || !value.endsWith('.json') ||
      !value.split('/').every(part => /^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/.test(part))) {
    throw failure('Invalid JSON storage path.', 'GIT_STORE_INVALID_PATH');
  }
  return value;
}

function remoteConfiguration(value, privateKey, knownHosts) {
  if (typeof value !== 'string' || !value || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new TypeError('Invalid Git remote configuration.');
  }
  const github = value.match(/^(?:git@github\.com:|git@ssh\.github\.com:|ssh:\/\/git@github\.com\/(?=.)|ssh:\/\/git@ssh\.github\.com:443\/)([a-zA-Z0-9][a-zA-Z0-9_.-]*\/[a-zA-Z0-9][a-zA-Z0-9_.-]*?)(?:\.git)?$/);
  if (github) {
    if (typeof privateKey !== 'string' || !privateKey.includes('PRIVATE KEY-----') ||
        typeof knownHosts !== 'string' || !knownHosts.trim() || knownHosts.includes('\0')) {
      throw new TypeError('SSH requires a private key and pinned known hosts.');
    }
    const pins = knownHosts.split(/\r?\n/).filter(line => line.trim() && !line.trim().startsWith('#'));
    if (!pins.length || pins.some(line => !/^\[ssh\.github\.com\]:443 (?:ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp256) [A-Za-z0-9+/]+={0,2}(?:\s.*)?$/.test(line.trim()))) {
      throw new TypeError('SSH known hosts must pin [ssh.github.com]:443.');
    }
    return { url: `ssh://git@ssh.github.com:443/${github[1]}.git`, ssh: true };
  }
  if (value.startsWith('file://')) {
    let url;
    try { url = new URL(value); } catch { throw new TypeError('Invalid local Git remote.'); }
    if (url.hostname && url.hostname !== 'localhost') throw new TypeError('Unsupported Git remote transport.');
    return { url: fileURLToPath(url), ssh: false };
  }
  if (path.isAbsolute(value)) return { url: path.resolve(value), ssh: false };
  throw new TypeError('Git remote must be a local repository or GitHub SSH remote.');
}

const shellQuote = value => `'${value.replace(/'/g, `'\\''`)}'`;

export function createGitStore({ directory, remoteUrl, privateKey, knownHosts, authorName = 'Finance Interview Sync', authorEmail = 'finance-interview@users.noreply.github.com' } = {}) {
  if (typeof directory !== 'string' || !directory || /[\u0000-\u001f\u007f]/.test(directory)) throw new TypeError('Invalid Git storage directory.');
  const remote = remoteConfiguration(remoteUrl, privateKey, knownHosts);
  if (![authorName, authorEmail].every(value => typeof value === 'string' && value.length > 0 && value.length <= 200 && !/[<>\u0000-\u001f\u007f]/.test(value))) {
    throw new TypeError('Invalid Git author identity.');
  }
  const root = path.resolve(directory);
  const repository = path.join(root, 'repository.git');
  const marker = path.join(root, 'finance-git-store.json');
  let initialization;
  let branch;
  let hasRemoteCommit = false;
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_') && !key.startsWith('SSH_')));
  Object.assign(environment, {
    GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0',
    GIT_ALLOW_PROTOCOL: 'file:ssh', GIT_NO_REPLACE_OBJECTS: '1',
    GIT_AUTHOR_NAME: authorName, GIT_AUTHOR_EMAIL: authorEmail,
    GIT_COMMITTER_NAME: authorName, GIT_COMMITTER_EMAIL: authorEmail
  });

  function serial(operation) {
    const next = (queues.get(root) || Promise.resolve()).then(operation);
    const tail = next.catch(() => {});
    queues.set(root, tail);
    void tail.then(() => { if (queues.get(root) === tail) queues.delete(root); });
    return next;
  }

  function command(args, { input, extraEnv = {}, maximum = 256 * 1024 } = {}) {
    return new Promise(resolve => {
      const child = spawn('git', ['--git-dir', repository, ...args], { env: { ...environment, ...extraEnv }, stdio: ['pipe', 'pipe', 'pipe'] });
      const output = [], errors = [];
      let bytes = 0, interrupted = false;
      const timer = setTimeout(() => { interrupted = true; child.kill('SIGKILL'); }, 60000);
      timer.unref();
      const collect = target => chunk => {
        bytes += chunk.length;
        if (bytes > maximum) { interrupted = true; child.kill('SIGKILL'); }
        else target.push(chunk);
      };
      child.stdout.on('data', collect(output));
      child.stderr.on('data', collect(errors));
      child.stdin.on('error', () => {});
      child.on('error', () => { interrupted = true; });
      child.on('close', code => {
        clearTimeout(timer);
        resolve({ code: interrupted ? -1 : code, stdout: Buffer.concat(output), stderr: Buffer.concat(errors) });
      });
      child.stdin.end(input);
    });
  }

  async function checked(args, operation, options) {
    const result = await command(args, options);
    if (result.code !== 0) throw failure(`Git storage ${operation} failed.`);
    return result.stdout.toString('utf8').trim();
  }

  async function initialize() {
    if (initialization) return initialization;
    initialization = (async () => {
      await mkdir(root, { recursive: true, mode: 0o700 });
      const info = await lstat(root);
      if (!info.isDirectory() || info.isSymbolicLink()) throw failure('Git storage requires a dedicated directory.');
      let existing;
      try { existing = JSON.parse(await readFile(marker, 'utf8')); }
      catch (error) {
        if (error.code !== 'ENOENT') throw failure('Git storage metadata is invalid.');
        if ((await readdir(root)).length) throw failure('Git storage requires an empty dedicated directory.');
      }
      if (existing && (existing.version !== 1 || existing.remote !== remote.url)) throw failure('Git storage remote does not match its dedicated directory.');
      await chmod(root, 0o700);
      if (!existing) await writeFile(marker, JSON.stringify({ version: 1, remote: remote.url }), { mode: 0o600 });
      if (remote.ssh) {
        const keyPath = path.join(root, 'deploy-key');
        const hostsPath = path.join(root, 'known_hosts');
        await writeFile(keyPath, `${privateKey.trim()}\n`, { mode: 0o600 });
        await writeFile(hostsPath, `${knownHosts.trim()}\n`, { mode: 0o600 });
        await chmod(keyPath, 0o600);
        await chmod(hostsPath, 0o600);
        environment.GIT_SSH_COMMAND = [
          'ssh', '-F', os.devNull, '-p', '443', '-i', keyPath,
          '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'IdentityAgent=none',
          '-o', 'StrictHostKeyChecking=yes', '-o', `UserKnownHostsFile=${hostsPath}`,
          '-o', `GlobalKnownHostsFile=${os.devNull}`, '-o', 'PasswordAuthentication=no',
          '-o', 'KbdInteractiveAuthentication=no', '-o', 'ConnectTimeout=20', '-o', 'LogLevel=ERROR'
        ].map(shellQuote).join(' ');
      }
      try {
        const repoInfo = await lstat(repository);
        if (!repoInfo.isDirectory() || repoInfo.isSymbolicLink()) throw failure('Git storage repository is invalid.');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        await checked(['init', '--bare', '--initial-branch=main', repository], 'initialization');
      }
      if (await checked(['rev-parse', '--is-bare-repository'], 'validation') !== 'true') throw failure('Git storage repository must be bare.');
      await checked(['config', 'remote.origin.url', remote.url], 'configuration');
      await checked(['config', 'core.hooksPath', os.devNull], 'configuration');
      const head = await checked(['ls-remote', '--symref', 'origin', 'HEAD'], 'remote discovery');
      const match = head.match(/^ref: refs\/heads\/(.+)\tHEAD$/m);
      if (match) {
        branch = match[1];
        await checked(['check-ref-format', '--branch', branch], 'branch validation');
      }
      await refresh();
    })();
    try { await initialization; } catch (error) { initialization = undefined; throw error; }
  }

  async function refresh() {
    await checked(['fetch', '--quiet', '--no-tags', '--prune', 'origin', '+refs/heads/*:refs/remotes/origin/*'], 'fetch');
    if (!branch) {
      const names = (await checked(['for-each-ref', '--format=%(refname:strip=3)', 'refs/remotes/origin/'], 'branch discovery')).split('\n').filter(Boolean);
      branch = names.includes('main') ? 'main' : names.includes('master') ? 'master' : names.length === 1 ? names[0] : 'main';
      if (names.length && !names.includes(branch)) throw failure('Git storage remote default branch is ambiguous.');
    }
    const result = await command(['rev-parse', '--verify', `refs/remotes/origin/${branch}^{commit}`]);
    if (result.code !== 0) {
      if (hasRemoteCommit) throw failure('Git storage remote branch is unavailable.');
      return null;
    }
    hasRemoteCommit = true;
    return result.stdout.toString('utf8').trim();
  }

  async function readAt(commit, filename) {
    if (!commit) return { exists: false, value: null };
    const entry = await checked(['ls-tree', commit, '--', filename], 'read');
    if (!entry) return { exists: false, value: null };
    const match = entry.match(/^100(?:644|755) blob ([a-f0-9]{40,64})\t/);
    if (!match) throw failure('Git storage JSON must be a regular file.');
    const size = Number(await checked(['cat-file', '-s', match[1]], 'read'));
    if (!Number.isSafeInteger(size) || size > MAX_DOCUMENT_BYTES) throw failure('Git storage document exceeds the 8 MiB limit.', 'GIT_STORE_TOO_LARGE');
    const content = await command(['cat-file', 'blob', match[1]], { maximum: MAX_DOCUMENT_BYTES + 1024 });
    if (content.code !== 0) throw failure('Git storage read failed.');
    try { return { exists: true, value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(content.stdout)) }; }
    catch { throw failure('Git storage document is not valid JSON.', 'GIT_STORE_INVALID_JSON'); }
  }

  async function makeCommit(parent, filename, content, message) {
    const index = path.join(root, `index-${randomUUID()}`);
    const extraEnv = { GIT_INDEX_FILE: index };
    try {
      const blob = await checked(['hash-object', '-w', '--stdin'], 'document preparation', { input: content });
      await checked(['read-tree', parent || '--empty'], 'tree preparation', { extraEnv });
      await checked(['update-index', '--add', '--cacheinfo', `100644,${blob},${filename}`], 'tree preparation', { extraEnv });
      const tree = await checked(['write-tree'], 'tree preparation', { extraEnv });
      return await checked(['commit-tree', tree, ...(parent ? ['-p', parent] : [])], 'commit', { input: `${message}\n` });
    } finally {
      await rm(index, { force: true });
      await rm(`${index}.lock`, { force: true });
    }
  }

  return {
    init() { return serial(initialize); },
    read(filename) {
      return serial(async () => {
        safePath(filename);
        await initialize();
        return (await readAt(await refresh(), filename)).value;
      });
    },
    update(filename, updater, message = 'Update private records') {
      return serial(async () => {
        safePath(filename);
        if (typeof updater !== 'function') throw new TypeError('Git storage updater must be a function.');
        if (typeof message !== 'string' || !message.trim() || message.length > 4096 || message.includes('\0')) throw new TypeError('Invalid Git commit message.');
        await initialize();
        for (let attempt = 0; attempt < MAX_PUSH_ATTEMPTS; attempt += 1) {
          const parent = await refresh();
          const current = await readAt(parent, filename);
          const previous = JSON.stringify(current.value);
          const next = await updater(current.value);
          let serialized;
          try { serialized = JSON.stringify(next); } catch { throw failure('Git storage updater must return JSON.', 'GIT_STORE_INVALID_JSON'); }
          if (serialized === undefined) throw failure('Git storage updater must return JSON.', 'GIT_STORE_INVALID_JSON');
          const content = `${serialized}\n`;
          if (Buffer.byteLength(content) > MAX_DOCUMENT_BYTES) throw failure('Git storage document exceeds the 8 MiB limit.', 'GIT_STORE_TOO_LARGE');
          if (current.exists && serialized === previous) return JSON.parse(serialized);
          const commit = await makeCommit(parent, filename, content, message);
          const pushed = await command(['push', '--porcelain', 'origin', `${commit}:refs/heads/${branch}`]);
          if (pushed.code === 0) return JSON.parse(serialized);
          // Only remote refs are read. Rejected commits stay unreachable and cannot leak into later saves.
          if (!/\[rejected\].*(?:non-fast-forward|fetch first)/i.test(`${pushed.stdout}\n${pushed.stderr}`)) throw failure('Git storage push failed.');
        }
        throw failure('Git storage concurrent update conflict; retry the save.', 'GIT_STORE_CONFLICT');
      });
    }
  };
}
