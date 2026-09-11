const { test, expect } = require('@playwright/test');

const origin = 'http://127.0.0.1:43189';
const inviteCodes = { alice_tabs: '6412', bob_tabs: '7413', offline_tabs: '08414', duplicate_tabs: '9415' };

async function login(page, username) {
  await page.goto('/');
  await page.locator('#account-invite-code').fill(inviteCodes[username]);
  await page.locator('#account-login-submit').click();
  await expect(page.locator('[data-action="start"]')).toBeVisible();
}

async function envelope(page, username) {
  const response = await page.request.get('/api/state', { headers: { 'X-Finance-Account': username } });
  expect(response.status()).toBe(200);
  return response.json();
}

function hasAnswer(state, text) {
  return Object.values(state?.active?.answers || {}).some(answer => answer.text === text);
}

async function blockSaves(page) {
  await page.route('**/api/state', route => route.request().method() === 'PUT' ? route.abort('internetdisconnected') : route.continue());
}

async function writeOfflineAnswer(page, text) {
  await page.locator('[data-action="start"]').click();
  await page.locator('#answer-input').fill(text);
  await page.locator('#account-save').click();
  await expect(page.locator('#account-sync-status')).toHaveAttribute('data-status', 'offline');
}

test.beforeAll(async ({ request }) => {
  const loggedIn = await request.post('/api/login', { headers: { Origin: origin }, data: { inviteCode: '8301' } });
  expect(loggedIn.status()).toBe(200);
  const listed = await request.get('/api/admin/users');
  expect(listed.status()).toBe(200);
  const existing = new Set((await listed.json()).users.map(user => user.username));
  for (const [username, inviteCode] of Object.entries(inviteCodes)) {
    if (existing.has(username)) continue;
    const created = await request.post('/api/admin/users', { headers: { Origin: origin }, data: { username, displayName: username, inviteCode } });
    expect(created.status()).toBe(201);
  }
});

test('switching accounts in another tab cannot upload the previous account draft', async ({ page, context }) => {
  const answer = 'Private answer that belongs only to Alice';
  await login(page, 'alice_tabs');
  const switchingTab = await context.newPage();
  await switchingTab.goto('/');
  await expect(switchingTab.locator('[data-action="start"]')).toBeVisible();
  await blockSaves(page);
  await writeOfflineAnswer(page, answer);

  await switchingTab.locator('#account-logout').click();
  await expect(switchingTab.locator('#account-login-form')).toBeVisible();
  await switchingTab.locator('#account-invite-code').fill(inviteCodes.bob_tabs);
  await switchingTab.locator('#account-login-submit').click();
  await expect(switchingTab.locator('[data-action="start"]')).toBeVisible();

  await page.unroute('**/api/state');
  await page.evaluate(() => window.FinanceAccounts.flush());
  expect((await envelope(switchingTab, 'bob_tabs')).state).toBeNull();
  await expect(page.locator('#account-login-form')).toBeVisible();

  await switchingTab.locator('#account-logout').click();
  await expect(switchingTab.locator('#account-login-form')).toBeVisible();
  await login(page, 'alice_tabs');
  await page.locator('[data-action="resume"]').click();
  await expect(page.locator('#answer-input')).toHaveValue(answer);
  await page.locator('#account-save').click();
  await expect.poll(async () => hasAnswer((await envelope(page, 'alice_tabs')).state, answer), { timeout: 20000 }).toBe(true);
});

test('two offline tabs retain separate drafts through reload and then expose their cloud conflict', async ({ page, context }) => {
  const firstAnswer = 'Unsynced answer from the first tab';
  const secondAnswer = 'Different unsynced answer from the second tab';
  await login(page, 'offline_tabs');
  const secondTab = await context.newPage();
  await secondTab.goto('/');
  await expect(secondTab.locator('[data-action="start"]')).toBeVisible();
  await blockSaves(page);
  await blockSaves(secondTab);
  await writeOfflineAnswer(page, firstAnswer);
  await writeOfflineAnswer(secondTab, secondAnswer);

  for (const [tab, answer] of [[page, firstAnswer], [secondTab, secondAnswer]]) {
    await tab.reload();
    await expect(tab.locator('[data-action="resume"]')).toBeVisible();
    await tab.locator('[data-action="resume"]').click();
    await expect(tab.locator('#answer-input')).toHaveValue(answer);
  }

  await page.unroute('**/api/state');
  await page.locator('#account-save').click();
  await expect.poll(async () => hasAnswer((await envelope(page, 'offline_tabs')).state, firstAnswer), { timeout: 20000 }).toBe(true);
  await secondTab.unroute('**/api/state');
  await secondTab.locator('#account-save').click();
  await expect(secondTab.locator('#account-conflict')).toBeVisible();
  await expect(secondTab.locator('#answer-input')).toHaveValue(secondAnswer);
  expect(hasAnswer((await envelope(page, 'offline_tabs')).state, firstAnswer)).toBe(true);

  await secondTab.close();
  const recoveryTab = await context.newPage();
  await blockSaves(recoveryTab);
  await recoveryTab.goto('/');
  await expect(recoveryTab.locator('#account-other-drafts')).toBeVisible();
  await recoveryTab.locator('#account-other-drafts summary').click();
  const recoveredDraft = recoveryTab.locator('.account-stored-draft').filter({ hasText: secondAnswer }).first();
  await expect(recoveredDraft).toBeVisible();
  recoveryTab.once('dialog', dialog => dialog.accept());
  await recoveredDraft.locator('[data-account-draft]').click();
  await recoveryTab.locator('[data-action="resume"]').click();
  await expect(recoveryTab.locator('#answer-input')).toHaveValue(secondAnswer);
  expect(hasAnswer((await envelope(page, 'offline_tabs')).state, firstAnswer)).toBe(true);
});

test('duplicating a tab keeps each offline answer recoverable despite copied session storage', async ({ page, context }) => {
  const originalAnswer = 'Draft belonging to the original browser tab';
  const duplicatedAnswer = 'Separate draft belonging to the duplicated browser tab';
  await login(page, 'duplicate_tabs');
  await context.route('**/api/state', route => route.request().method() === 'PUT' ? route.abort('internetdisconnected') : route.continue());
  const opened = page.waitForEvent('popup');
  await page.evaluate(() => window.open('/'));
  const duplicatedTab = await opened;
  await expect(duplicatedTab.locator('[data-action="start"]')).toBeVisible();
  await writeOfflineAnswer(page, originalAnswer);
  await writeOfflineAnswer(duplicatedTab, duplicatedAnswer);

  for (const [tab, answer] of [[page, originalAnswer], [duplicatedTab, duplicatedAnswer]]) {
    await tab.reload();
    await expect(tab.locator('[data-action="resume"]')).toBeVisible();
    await tab.locator('[data-action="resume"]').click();
    await expect(tab.locator('#answer-input')).toHaveValue(answer);
  }
  expect((await envelope(page, 'duplicate_tabs')).state).toBeNull();
});
