const { test, expect } = require('@playwright/test');
const { randomUUID } = require('node:crypto');

const origin = 'http://127.0.0.1:43189';
const inviteCodes = { admin: '8301', alice: '0462', bob: '9753', charlie: '2648' };

async function login(page, username) {
  await page.goto('/');
  await page.locator('#account-invite-code').fill(inviteCodes[username]);
  await expect(page.locator('#account-username, #account-password')).toHaveCount(0);
  await page.locator('#account-login-submit').click();
  await expect(page.locator('[data-action="start"]')).toBeVisible();
}

async function envelope(page) {
  const username = await page.locator('#account-current-user').textContent();
  const response = await page.request.get('/api/state', { headers: { 'X-Finance-Account': username.split(' · ').at(-1) } });
  expect(response.status()).toBe(200);
  return response.json();
}

function hasAnswer(state, answer) {
  return Object.values(state?.active?.answers || {}).some(item => item.text === answer);
}

test('answer saves to Git and resumes in a second browser while other accounts stay separate', async ({ page, browser }) => {
  await login(page, 'alice');
  await page.locator('[data-action="start"]').click();
  await page.locator('#answer-input').fill('独立账号同步验证：先说明现金流，再分析利润质量。');
  await page.locator('#account-save').click();
  await expect.poll(async () => hasAnswer((await envelope(page)).state, '独立账号同步验证：先说明现金流，再分析利润质量。'), { timeout: 20000 }).toBe(true);

  const second = await browser.newContext({ baseURL: origin });
  const restored = await second.newPage();
  await login(restored, 'alice');
  await restored.locator('[data-action="resume"]').click();
  await expect(restored.locator('#answer-input')).toHaveValue('独立账号同步验证：先说明现金流，再分析利润质量。');
  await second.close();

  await page.locator('#account-logout').click();
  await expect(page.locator('#account-login-form')).toBeVisible();
  expect((await page.request.get('/api/state')).status()).toBe(401);
  await page.locator('#account-invite-code').fill(inviteCodes.bob);
  await page.locator('#account-login-submit').click();
  await expect(page.locator('[data-action="start"]')).toBeVisible();
  expect((await envelope(page)).state).toBeNull();
  await expect(page.locator('body')).not.toContainText('先说明现金流，再分析利润质量');
  expect((await page.request.get('/api/admin/users/alice/state')).status()).toBe(403);
});

test('offline draft survives and a competing cloud edit requires explicit conflict recovery', async ({ page }) => {
  await login(page, 'bob');
  await page.locator('[data-action="start"]').click();
  await page.locator('#answer-input').fill('最初保存的草稿');
  await page.locator('#account-save').click();
  await expect.poll(async () => hasAnswer((await envelope(page)).state, '最初保存的草稿'), { timeout: 20000 }).toBe(true);
  const original = await envelope(page);

  await page.route('**/api/state', route => route.request().method() === 'PUT' ? route.abort('internetdisconnected') : route.continue());
  await page.locator('#answer-input').fill('断网期间保留的本机回答');
  await page.locator('#account-save').click();
  await expect(page.locator('#account-sync-status')).not.toContainText('已同步到云端');
  const remote = structuredClone(original.state);
  const qid = remote.active.questionIds[remote.active.current];
  remote.active.answers[qid].text = '另一台设备保存的回答';
  const saved = await page.request.put('/api/state', { headers: { Origin: origin, 'X-Finance-Account': 'bob' }, data: { revision: original.revision, mutationId: randomUUID(), state: remote } });
  expect(saved.status()).toBe(200);

  await page.unroute('**/api/state');
  await page.locator('#account-save').click();
  await expect(page.locator('#account-conflict')).toBeVisible();
  await expect(page.locator('#answer-input')).toHaveValue('断网期间保留的本机回答');
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#account-keep-local').click();
  await expect.poll(async () => hasAnswer((await envelope(page)).state, '断网期间保留的本机回答'), { timeout: 20000 }).toBe(true);
  await page.reload();
  await expect(page.locator('[data-action="resume"]')).toBeVisible();
  await page.locator('[data-action="resume"]').click();
  await expect(page.locator('#answer-input')).toHaveValue('断网期间保留的本机回答');
});

test('administrator can inspect records and create an ordinary account on mobile', async ({ page, browser }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, 'admin');
  await page.locator('#account-admin').click();
  await expect(page.locator('#account-user-list')).toContainText('alice');
  const users = await (await page.request.get('/api/admin/users')).json();
  expect(users.users.some(user => user.username === 'alice')).toBe(true);
  const records = await (await page.request.get('/api/admin/users/alice/state')).json();
  expect(hasAnswer(records.state, '独立账号同步验证：先说明现金流，再分析利润质量。')).toBe(true);
  await page.locator('[data-account-user="alice"]').click();
  await expect(page.locator('.account-answer-text').first()).toContainText('独立账号同步验证：先说明现金流，再分析利润质量。');
  await page.getByText('创建练习账号', { exact: true }).click();
  await page.locator('#new-username').fill('charlie');
  await page.locator('#new-display-name').fill('新的练习账号');
  await page.locator('#new-invite-code').fill(inviteCodes.charlie);
  await page.locator('#account-create-user button[type="submit"]').click();
  await expect(page.locator('#account-user-list')).toContainText('charlie');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/accounts-admin-mobile.png', fullPage: true });
  const fresh = await browser.newContext({ baseURL: origin });
  const candidate = await fresh.newPage();
  await login(candidate, 'charlie');
  expect((await candidate.request.get('/api/admin/users')).status()).toBe(403);
  await fresh.close();
});
