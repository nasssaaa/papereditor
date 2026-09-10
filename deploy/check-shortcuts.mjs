// Read-only UI smoke test against an existing compiled Chinese sample.
// Run on the target OS with its installed Chrome and private credentials file.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const baseURL = (process.env.TEST_BASE_URL || 'http://127.0.0.1:18080').replace(/\/$/, '') + '/';
const credentials = JSON.parse(
  fs.readFileSync(process.env.TEST_CREDENTIALS_FILE || '.data/bootstrap-admin.json', 'utf8'),
);
const browser = await chromium.launch({
  channel: process.env.TEST_BROWSER_CHANNEL || 'chrome',
  headless: true,
});
const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
const editor = page.locator('.monaco-editor textarea.inputarea').first();
const ensure = async (condition, label) => {
  const deadline = Date.now() + 20000;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(label);
    await page.waitForTimeout(50);
  }
};
try {
  await page.goto(baseURL);
  await page.getByLabel('用户名', { exact: true }).fill(credentials.username);
  await page.getByLabel('密码', { exact: true }).fill(credentials.password);
  await page.getByRole('button', { name: '进入工作空间' }).click();
  await ensure(
    async () => (await page.getByTitle('保存状态').textContent())?.includes('已保存'),
    'Document did not become ready',
  );
  const projects = await (await context.request.get('api/projects')).json();
  const sample = projects.find(
    (p) => p.title === (process.env.TEST_PROJECT_TITLE || '我的第一篇论文'),
  );
  assert.ok(sample, 'Chinese sample missing');
  await page.getByLabel('选择项目').selectOption(sample.id);
  await ensure(
    async () => (await page.getByTitle('保存状态').textContent())?.includes('已保存'),
    'Sample did not become ready',
  );
  await ensure(
    async () => (await page.locator('.textLayer').first().textContent())?.includes('研究'),
    'PDF did not render',
  );
  await editor.focus();
  await page.keyboard.press(`${mod}+Shift+p`);
  await page.getByLabel('搜索命令').fill('build');
  assert.ok(await page.locator('[data-command="compile"]').isVisible());
  assert.ok(
    (await page.locator('[data-command="compile"]').textContent()).includes(
      process.platform === 'darwin' ? '⌘' : 'Ctrl',
    ),
  );
  await page.keyboard.press('Escape');
  await page.keyboard.press('F1');
  await page.getByLabel('搜索命令').fill('公式');
  assert.ok(await page.locator('[data-command="inlineMath"]').isVisible());
  await page.keyboard.press('Escape');
  await page.keyboard.press(`${mod}+p`);
  await page.getByLabel('快速打开文件名').fill('main.tex');
  await page.keyboard.press('Enter');
  await editor.focus();
  await page.keyboard.press(`${mod}+f`);
  await ensure(
    () => page.locator('.find-widget.visible').isVisible(),
    'Source search shortcut failed',
  );
  await page.keyboard.press('Escape');
  await editor.focus();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home');
  for (let i = 0; i < 13; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press(`${mod}+Alt+s`);
  await ensure(() => page.locator('.pdf-location').isVisible(), 'SyncTeX shortcut failed');
  await page.keyboard.press(`${mod}+Alt+v`);
  await page.keyboard.press(`${mod}+f`);
  await page.getByLabel('PDF 搜索词').fill('研究');
  await ensure(
    async () => (await page.locator('.pdf-search').textContent())?.includes('1/'),
    'PDF search failed',
  );
  await page.keyboard.press('Escape');
  await page.keyboard.press(`${mod}+Alt+v`);
  await page.keyboard.press(`${mod}+Backquote`);
  assert.ok(await page.locator('.output-panel.expanded').isVisible());
  await page.getByRole('button', { name: '快捷键速查' }).click();
  await page.getByLabel('搜索命令').fill('定位');
  await page.screenshot({
    path: process.env.TEST_SCREENSHOT || '.local/keyboard-smoke.png',
    fullPage: true,
  });
  assert.equal(context.pages().length, 1, 'A shortcut opened a browser page');
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      platform: process.platform,
      browser: await browser.version(),
      baseURL,
      result: 'passed',
      checks: [
        'palette',
        'F1',
        'quick open',
        'source find',
        'SyncTeX',
        'focus switch',
        'PDF find',
        'output panel',
        'shortcut help',
      ],
    }),
  );
} finally {
  await context.close();
  await browser.close();
}
