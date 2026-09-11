const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs/promises');

test('practice saves drafts, resumes, pauses, self-reviews, finishes and exports', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('button', { name: '开始我的面试' })).toBeVisible();
  await page.getByRole('button', { name: '开始我的面试' }).click();
  await page.getByRole('button', { name: '提交并复盘' }).click();
  await expect(page.locator('#toast')).toContainText('先写下你的回答');
  await page.locator('#answer-input').fill('首先，我会确认目标，再检查原始数据。例如，在课程项目中，我核对了数据口径，按步骤处理并复核结果。');
  await page.reload();
  await page.getByRole('button', { name: '继续练习' }).click();
  await expect(page.locator('#answer-input')).toContainText('课程项目');
  await page.getByRole('button', { name: '暂停一下' }).click();
  await expect(page.locator('#answer-input')).toBeDisabled();
  await expect(page.getByRole('button', { name: '提交并复盘' })).toBeDisabled();
  await page.getByRole('button', { name: '继续作答' }).click();
  await page.getByRole('button', { name: '收藏此题' }).click();
  await expect(page.locator('#answer-input')).toContainText('课程项目');
  await page.getByRole('button', { name: '提交并复盘' }).click();
  await expect(page.getByText('参考回答思路', { exact: true })).toBeVisible();
  await page.locator('.self-check input').nth(0).check();
  await page.locator('.self-check input').nth(1).check();
  await page.getByRole('button', { name: '下一题', exact: true }).click();
  for (let i = 1; i < 6; i++) {
    await page.getByRole('button', { name: '暂时不会，跳过' }).click();
    await page.getByRole('button', { name: i === 5 ? '完成并查看复盘' : '下一题', exact: true }).click();
  }
  await expect(page.getByRole('heading', { name: '你的面试复盘' })).toBeVisible();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('finance-interview-v1')));
  expect(stored.history).toHaveLength(1);
  expect(stored.history[0].answers[stored.history[0].questionIds[0]].checked).toEqual([true, true, false, false]);
  expect(stored.active).toBe(null);
  await expect(page.locator('.stat').nth(3)).toContainText('50');
  await page.getByRole('button', { name: '查看复盘', exact: true }).first().click();
  await page.locator('.modal .self-check input').nth(2).check();
  await page.getByRole('button', { name: '保存自评' }).click();
  await expect(page.locator('.stat').nth(3)).toContainText('75');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出复盘' }).click();
  const download = await downloadPromise;
  const report = await fs.readFile(await download.path(), 'utf8');
  expect(report).toContain('课程项目');
  expect(report).toContain('75%');
  await page.reload();
  await page.getByRole('button', { name: /练习记录/ }).click();
  await expect(page.locator('.history-row')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('mock mode keeps answers hidden until finish and never invents unreviewed scores', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '完整模拟面试', exact: false }).click();
  await page.getByRole('button', { name: '开始我的面试' }).click();
  for (let i = 0; i < 6; i++) {
    await expect(page.getByText('参考回答思路', { exact: true })).toHaveCount(0);
    await page.locator('#answer-input').fill('我会先分析问题，再核对数据，根据结果提出建议并及时复核。');
    await page.getByRole('button', { name: i === 5 ? '完成面试' : '提交，下一题', exact: true }).click();
  }
  await expect(page.locator('.stat').nth(2)).toContainText('0');
  await expect(page.locator('.stat').nth(3)).toContainText('—');
  await page.getByRole('button', { name: '开始自评' }).first().click();
  await page.locator('.modal .self-check input').first().check();
  await page.getByRole('button', { name: '保存自评' }).click();
  await expect(page.locator('.stat').nth(2)).toContainText('1');
  await expect(page.locator('.stat').nth(3)).toContainText('25');
});

test('library filters, favorites, single question role, and modal keyboard work', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /面试题库/ }).click();
  await page.locator('#search-input').fill('现金流');
  await expect(page.locator('.library-card').first()).toBeVisible();
  await page.locator('#search-input').fill('zzz-no-result');
  await expect(page.getByText('暂时没有匹配的题目。')).toBeVisible();
  await page.getByRole('button', { name: '清除筛选' }).click();
  await page.locator('#filter-role').selectOption('audit');
  await page.locator('#filter-stage').selectOption('scenario');
  await page.locator('.library-card').first().getByRole('button', { name: '查看思路' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.locator('.library-card').first().getByRole('button', { name: '收藏', exact: true }).click();
  await page.getByRole('button', { name: /我的收藏/ }).click();
  await expect(page.locator('.library-card')).toHaveCount(1);
  await page.getByRole('button', { name: '练这一题' }).click();
  await expect(page.locator('.page-subtitle')).toContainText('审计助理');
  await page.reload();
  await expect(page.getByRole('button', { name: '继续练习' })).toBeVisible();
});

test('desktop and mobile layouts have no horizontal overflow', async ({ page }) => {
  await page.goto('/');
  await page.screenshot({ path: 'artifacts/home-desktop.png', fullPage: true, animations: 'disabled' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'artifacts/home-mobile.png', fullPage: true, animations: 'disabled' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '开始我的面试' }).click();
  await expect(page.locator('#answer-input')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/interview-mobile.png', fullPage: true, animations: 'disabled' });
});

test('bundled HTML works from file URL and corrupted storage recovers', async ({ page }) => {
  await page.goto(pathToFileURL(path.resolve('dist/财务面试练习室.html')).href);
  await page.getByRole('button', { name: '开始我的面试' }).click();
  await page.locator('#answer-input').fill('单文件可用');
  await page.reload();
  await page.getByRole('button', { name: '继续练习' }).click();
  await expect(page.locator('#answer-input')).toHaveValue('单文件可用');
  await page.evaluate(() => localStorage.setItem('finance-interview-v1', '{broken json'));
  await page.reload();
  await expect(page.getByRole('button', { name: '开始我的面试' })).toBeVisible();
});

test('search preserves normal typing and caret edits', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /面试题库/ }).click();
  await page.locator('#search-input').pressSequentially('Excel');
  await expect(page.locator('#search-input')).toHaveValue('Excel');
  await page.locator('#search-input').press('Home');
  await page.locator('#search-input').pressSequentially('X');
  await expect(page.locator('#search-input')).toHaveValue('XExcel');
});

test('keyboard focus remains on settings and moves to a new question', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-role="analysis"]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-role="analysis"]')).toBeFocused();
  await page.getByRole('button', { name: '开始我的面试' }).click();
  await expect(page.locator('.question-title')).toBeFocused();
  await page.getByRole('button', { name: '暂停一下' }).click();
  await expect(page.getByRole('button', { name: '继续作答' })).toBeFocused();
});

test('a duplicate tab cannot erase another tabs newer saved draft', async ({ context, page }) => {
  await page.goto('/');
  const other = await context.newPage();
  await other.goto('/');
  await page.getByRole('button', { name: '开始我的面试' }).click();
  await page.locator('#answer-input').fill('这是一份必须保留的最新草稿。');
  await other.getByRole('button', { name: /面试题库/ }).click();
  await other.getByRole('button', { name: /开始练习/ }).click();
  expect(await other.evaluate(() => {
    const active = JSON.parse(localStorage.getItem('finance-interview-v1')).active;
    return active && active.answers[active.questionIds[0]]?.text;
  })).toBe('这是一份必须保留的最新草稿。');
  await page.reload();
  await page.getByRole('button', { name: '继续练习' }).click();
  await expect(page.locator('#answer-input')).toHaveValue('这是一份必须保留的最新草稿。');
});

test('another tab changing favorites preserves pending report self-review', async ({ context, page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /面试题库/ }).click();
  await page.locator('.library-card').first().getByRole('button', { name: '练这一题' }).click();
  await page.locator('#answer-input').fill('我的回答包含自己的真实课程经历，以及具体行动和结果。');
  await page.getByRole('button', { name: '提交并复盘' }).click();
  await page.getByRole('button', { name: '完成并查看复盘' }).click();
  const other = await context.newPage();
  await other.goto('/');
  await other.getByRole('button', { name: /面试题库/ }).click();
  await page.getByRole('button', { name: '查看复盘', exact: true }).click();
  await page.locator('.modal .self-check input').first().check();
  await other.locator('.library-card').first().getByRole('button', { name: '收藏', exact: true }).click();
  await expect(page.locator('.modal .self-check input').first()).toBeChecked();
  await page.getByRole('button', { name: '保存自评' }).click();
  await expect(page.locator('.stat').nth(3)).toContainText('25');
});
