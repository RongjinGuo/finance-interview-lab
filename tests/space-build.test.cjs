const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');

function fixture(t, script) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'interview-build-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const name of ['scripts', 'src', 'server', 'deploy/hf']) fs.mkdirSync(path.join(dir, name), { recursive: true });
  fs.copyFileSync(path.join(root, 'scripts', script), path.join(dir, 'scripts', script));
  fs.copyFileSync(path.join(root, 'index.html'), path.join(dir, 'index.html'));
  for (const name of ['styles.css', 'account.css', 'questions.js', 'engine.js', 'app.js', 'account-config.js', 'accounts.js', 'visit-config.js', 'visits.js']) {
    fs.writeFileSync(path.join(dir, 'src', name), name.endsWith('.css') ? 'body {}' : '/* fixture */');
  }
  return dir;
}

test('offline export strips account and visitor scripts and external account CSS', t => {
  const dir = fixture(t, 'build.mjs');
  execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: dir });
  const html = fs.readFileSync(path.join(dir, 'dist/财务面试练习室.html'), 'utf8');
  assert.ok(!html.includes('src/account'));
  assert.ok(!html.includes('src/visits'));
  assert.ok(!html.includes('src/visit-config'));
  assert.ok(!/<script[^>]+src=/.test(html));
});

test('hosted package contains only approved application source and no private files', t => {
  const dir = fixture(t, 'build-space.mjs');
  for (const name of ['http.mjs', 'main.mjs', 'auth.mjs', 'validation.mjs', 'git-store.mjs']) fs.writeFileSync(path.join(dir, 'server', name), 'export {};');
  fs.writeFileSync(path.join(dir, 'deploy/hf/Dockerfile'), 'FROM node:24-bookworm-slim\n');
  fs.writeFileSync(path.join(dir, 'deploy/hf/README.md'), '---\nsdk: docker\n---\n');
  fs.writeFileSync(path.join(dir, '.env'), 'TOP_SECRET');
  fs.writeFileSync(path.join(dir, 'server/private.json'), 'TOP_SECRET');
  fs.writeFileSync(path.join(dir, 'server/unapproved.mjs'), 'TOP_SECRET');
  execFileSync(process.execPath, ['scripts/build-space.mjs'], { cwd: dir });
  const out = path.join(dir, 'space');
  assert.ok(fs.existsSync(path.join(out, 'server/main.mjs')));
  assert.ok(fs.existsSync(path.join(out, 'src/accounts.js')));
  assert.ok(fs.existsSync(path.join(out, 'Dockerfile')));
  assert.ok(!fs.existsSync(path.join(out, '.env')));
  assert.ok(!fs.existsSync(path.join(out, 'server/private.json')));
  assert.ok(!fs.existsSync(path.join(out, 'server/unapproved.mjs')));
  assert.ok(!fs.existsSync(path.join(out, '.git')));
});
