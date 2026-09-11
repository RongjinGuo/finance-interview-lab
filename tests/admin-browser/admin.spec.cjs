const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

async function login(page) {
  const { password } = JSON.parse(await fs.readFile(path.join(os.homedir(), '.local/share/finance-interview-lab/admin-access.json'), 'utf8'));
  await page.goto('/');
  await page.locator('#admin-password').fill(password);
  await page.locator('#login-submit').click();
  await expect(page.locator('#dashboard')).toBeVisible();
}

test('protected admin shows real recorded requests, filters, exports, and logs out', async ({ page, request }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  expect((await request.get('/api/admin/visits')).status()).toBe(401);
  await page.goto('/');
  await page.locator('#admin-password').fill('incorrect-password');
  await page.locator('#login-submit').click();
  await expect(page.getByTestId('login-error')).toBeVisible();
  await login(page);
  const record = await request.post('/api/visit', {
    headers: { Origin: 'http://127.0.0.1:43188', 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/130.0.0.0' },
    data: { path: '/finance-interview-lab/browser-verification' }
  });
  expect(record.status()).toBe(204);
  await page.locator('#refresh-visits').click();
  await expect(page.getByTestId('visit-row').first()).toBeVisible();
  await expect(page.getByTestId('summary-visits')).not.toHaveText('0');
  await page.screenshot({ path: 'artifacts/admin-desktop.png', fullPage: true, animations: 'disabled' });
  await page.locator('#filter-q').fill('not-a-real-ip-or-location');
  await page.locator('#apply-filters').click();
  await expect(page.getByTestId('visit-row')).toHaveCount(0);
  await page.locator('#reset-filters').click();
  await expect(page.getByTestId('visit-row').first()).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#export-visits').click();
  const download = await downloadPromise;
  const csv = await fs.readFile(await download.path(), 'utf8');
  expect(csv).toContain('/finance-interview-lab/browser-verification');
  await page.locator('#logout').click();
  await expect(page.locator('#login-form')).toBeVisible();
  expect((await page.request.get('/api/admin/visits')).status()).toBe(401);
  expect(errors).toEqual([]);
});

test('admin layout supports mobile and keeps private API behind login', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.screenshot({ path: 'artifacts/admin-mobile.png', fullPage: true, animations: 'disabled' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.reload();
  await expect(page.locator('#dashboard')).toBeVisible();
  await page.locator('#logout').click();
  await page.reload();
  await expect(page.locator('#login-form')).toBeVisible();
});
