import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
const credentials = JSON.parse(
  fs.readFileSync(
    process.env.TEST_CREDENTIALS_FILE || path.resolve('.data/bootstrap-admin.json'),
    'utf8',
  ),
);
test('workspace editing, snapshots, project settings, and narrow preview', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByLabel('用户名', { exact: true }).fill(credentials.username);
  await page.getByLabel('密码', { exact: true }).fill(credentials.password);
  await page.getByRole('button', { name: '进入工作空间' }).click();
  await expect(page.getByRole('main').getByLabel('源码编辑区')).toBeVisible();
  await expect(page.getByTitle('保存状态')).toContainText('已保存', { timeout: 20000 });
  await page.screenshot({ path: 'test-results/workspace-desktop.png', fullPage: true });
  await page.getByRole('button', { name: '新建项目', exact: true }).click();
  await page.getByLabel('项目名称').fill('浏览器验收项目');
  await page.getByText('空白项目', { exact: true }).click();
  await page.getByRole('button', { name: '创建项目', exact: true }).click();
  await expect(page.getByLabel('选择项目')).toContainText('浏览器验收项目');
  await expect(page.getByTitle('保存状态')).toContainText('已保存');
  await page.getByLabel('自动编译').uncheck();
  const input = page.locator('.monaco-editor textarea').first();
  await input.focus();
  await page.keyboard.press('Control+Home');
  await page.keyboard.insertText('% Browser acceptance edit\n');
  await expect(page.getByTitle('保存状态')).toContainText('已保存');
  await page.reload();
  await expect(page.getByTitle('保存状态')).toContainText('已保存');
  await expect(page.locator('.monaco-editor .view-lines')).toContainText('Browser acceptance edit');
  await page.getByRole('button', { name: '版本快照', exact: true }).click();
  await page.getByRole('button', { name: '创建快照', exact: true }).click();
  await page.getByLabel('快照名称').fill('浏览器检查点');
  await page.getByRole('button', { name: '保存快照' }).click();
  await expect(page.getByRole('button', { name: /浏览器检查点/ })).toBeVisible();
  await page.getByRole('button', { name: '项目设置', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '项目设置' })).toBeVisible();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.setViewportSize({ width: 800, height: 900 });
  await page.getByRole('button', { name: '预览视图' }).click();
  await expect(page.getByLabel('PDF 预览', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/workspace-narrow.png', fullPage: true });
  expect(errors.filter((e) => !e.includes('Rendering cancelled'))).toEqual([]);
});
