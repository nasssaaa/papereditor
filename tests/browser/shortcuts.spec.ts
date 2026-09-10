import { type Page } from '@playwright/test';
import { test, expect } from './fixtures';
import fs from 'node:fs';
const credentials = JSON.parse(
  fs.readFileSync(process.env.TEST_CREDENTIALS_FILE || '.data/bootstrap-admin.json', 'utf8'),
);
const editor = (page: Page) => page.locator('.monaco-editor textarea.inputarea').first();
async function ready(page: Page) {
  await expect(page.getByTitle('保存状态')).toContainText('已保存', { timeout: 25000 });
}
async function palette(page: Page, query: string) {
  await editor(page).focus();
  await page.keyboard.press('Control+Shift+P');
  await expect(page.getByRole('dialog', { name: '命令面板', exact: true })).toBeVisible();
  await page.getByLabel('搜索命令').fill(query);
}
async function runCommand(page: Page, id: string, query = '') {
  await page.getByRole('button', { name: '命令面板', exact: true }).click();
  if (query) await page.getByLabel('搜索命令').fill(query);
  await page.locator(`[data-command="${id}"]`).click();
  await expect(page.getByRole('dialog', { name: '命令面板', exact: true })).toBeHidden();
}
async function setup(page: Page, text = 'alpha\nomega') {
  const request = page.context().request;
  expect((await request.post('api/auth/login', { data: credentials })).ok()).toBeTruthy();
  const project = await (
    await request.post('api/projects', {
      data: { title: `快捷键验收 ${Date.now()}`, template: 'blank' },
    })
  ).json();
  await request.patch(`api/projects/${project.id}`, { data: { autoCompile: false } });
  const file = await (
    await request.post(`api/projects/${project.id}/files`, {
      data: { path: 'scratch.tex', content: text },
    })
  ).json();
  await page.goto(`./#/project/${project.id}`);
  await ready(page);
  await editor(page).focus();
  await page.keyboard.press('Control+p');
  await page.getByLabel('快速打开文件名').fill('scratch');
  await page.keyboard.press('Enter');
  await ready(page);
  await expect(page.locator('.breadcrumbs')).toContainText('scratch.tex');
  return {
    project,
    file,
    read: async () =>
      (await (await request.get(`api/files/${file.id}/content`)).json()).content as string,
  };
}

test('palette, quick open, focus scopes, IME and compile request coalescing', async ({ page }) => {
  const { project } = await setup(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await palette(page, 'build');
  await expect(page.locator('[data-command="compile"]')).toBeVisible();
  await expect(page.getByRole('dialog', { name: '快速打开', exact: true })).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(editor(page)).toBeFocused();
  await page.keyboard.press('Control+b');
  await expect(page.locator('.sidebar')).toBeHidden();
  await page.keyboard.press('Control+Shift+f');
  await expect(page.getByLabel('全局搜索词')).toBeFocused();
  await page.keyboard.press('Control+b');
  await expect(page.locator('.sidebar')).toBeVisible();
  await editor(page).focus();
  await page.keyboard.press('Control+f');
  await expect(page.locator('.monaco-editor .find-widget.visible')).toBeVisible();
  await expect(
    page.locator('.monaco-editor .find-widget').getByRole('textbox', { name: 'Find', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+Backquote');
  await expect(page.locator('.output-panel')).toHaveClass(/expanded/);
  await page.keyboard.press('Control+Alt+v');
  await expect(page.getByLabel('PDF 正文', { exact: true })).toBeFocused();
  await page.keyboard.press('Control+Alt+v');
  await expect(editor(page)).toBeFocused();
  let calls = 0;
  await page.route(`**/api/projects/${project.id}/compile`, async (route) => {
    calls++;
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: '测试编译响应' }),
    });
  });
  await editor(page).dispatchEvent('keydown', {
    key: 's',
    code: 'KeyS',
    ctrlKey: true,
    isComposing: true,
  });
  await editor(page).dispatchEvent('keydown', {
    key: 's',
    code: 'KeyS',
    ctrlKey: true,
    repeat: true,
  });
  await runCommand(page, 'newFile');
  await expect(page.getByRole('dialog', { name: '新建文件', exact: true })).toBeVisible();
  await page.keyboard.press('Control+s');
  expect(calls).toBe(0);
  await page.keyboard.press('Escape');
  await editor(page).focus();
  await page.keyboard.press('Control+s');
  await page.keyboard.press('Control+s');
  await page.keyboard.press('Control+s');
  await expect(page.getByRole('status')).toContainText('测试编译响应');
  expect(calls).toBe(1);
  await page.getByRole('button', { name: '快捷键速查' }).click();
  await page.getByLabel('搜索命令').fill('公式');
  await expect(page.locator('[data-command="inlineMath"]')).toBeVisible();
  await page.screenshot({ path: 'test-results/shortcuts-reference.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('writing tracks selection across collaborator edits and undo keeps remote changes', async ({
  page,
  browser,
  baseURL,
}) => {
  const { project, file, read } = await setup(page);
  const account = {
    username: `keys${Date.now()}`,
    displayName: '快捷键协作者',
    password: 'keyboard-test-password-4392',
  };
  const request = page.context().request;
  expect((await request.post('api/users', { data: account })).ok()).toBeTruthy();
  await request.post(`api/projects/${project.id}/members`, {
    data: { username: account.username, role: 'editor' },
  });
  const other = await browser.newContext({ baseURL });
  await other.request.post('api/auth/login', { data: account });
  const peer = await other.newPage();
  await peer.goto(`./#/project/${project.id}`);
  await ready(peer);
  await editor(peer).focus();
  await peer.keyboard.press('Control+p');
  await peer.getByLabel('快速打开文件名').fill('scratch');
  await peer.keyboard.press('Enter');
  await ready(peer);
  await editor(page).focus();
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('Shift+End');
  await palette(page, '粗体');
  await editor(peer).focus();
  await peer.keyboard.press('Control+Home');
  await peer.keyboard.insertText('remote\n');
  await ready(peer);
  await page.locator('[data-command="bold"]').click();
  await expect.poll(read).toBe('remote\n\\textbf{alpha}\nomega');
  await editor(page).focus();
  await page.keyboard.press('Control+z');
  await expect.poll(read).toBe('remote\nalpha\nomega');
  await page.keyboard.press('Control+y');
  await expect.poll(read).toBe('remote\n\\textbf{alpha}\nomega');
  await expect(peer.locator('.view-lines')).toContainText('textbf');
  await request.post(`api/projects/${project.id}/members`, {
    data: { username: account.username, role: 'viewer' },
  });
  await expect(peer.getByTitle('保存状态')).toContainText('只读模式');
  await runCommand(peer, 'shortcuts');
  await peer.getByLabel('搜索命令').fill('粗体');
  await expect(peer.locator('[data-command="bold"]')).toHaveAttribute('aria-disabled', 'true');
  await peer.keyboard.press('Escape');
  await other.close();
  await page.context().setOffline(true);
  await expect(page.getByTitle('保存状态')).toContainText('离线草稿');
  await editor(page).focus();
  await page.keyboard.press('Control+End');
  await runCommand(page, 'inlineMath', '行内公式');
  await page.keyboard.insertText('x+1');
  await page.keyboard.press('Control+s');
  await expect(page.getByRole('status')).toContainText('离线');
  await page.context().setOffline(false);
  await ready(page);
  await expect.poll(read).toContain('omega\\(x+1\\)');
  expect(file.id).toBeTruthy();
});

test('multi-selection writing is one undo step and all empty helpers accept typing', async ({
  page,
}) => {
  const { read } = await setup(page, 'alpha\nalpha');
  await editor(page).focus();
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('Shift+End');
  await page.keyboard.press('Control+d');
  await palette(page, '斜体');
  await page.keyboard.press('Enter');
  await expect.poll(read).toBe('\\textit{alpha}\n\\textit{alpha}');
  await page.keyboard.press('Control+z');
  await expect.poll(read).toBe('alpha\nalpha');
  for (const id of ['bold', 'italic', 'inlineMath', 'displayMath', 'itemize', 'enumerate']) {
    await editor(page).focus();
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Escape');
    await runCommand(page, id);
    await page.keyboard.insertText('TEST');
    await ready(page);
    expect(await read()).toContain('TEST');
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    await expect.poll(read).toBe('alpha\nalpha');
  }
});

test('PDF shortcuts search the preview, locate source, and reveal hidden regions', async ({
  page,
}) => {
  const request = page.context().request;
  await request.post('api/auth/login', { data: credentials });
  const projects = await (await request.get('api/projects')).json();
  const project = projects.find((p: any) => p.title === '我的第一篇论文');
  const detail = await (await request.get(`api/projects/${project.id}`)).json();
  test.skip(!detail.lastSuccess, 'Compile the Chinese sample before running PDF shortcuts.');
  await page.goto(`./#/project/${project.id}`);
  await ready(page);
  await expect(page.locator('.textLayer').first()).toContainText('研究');
  await editor(page).focus();
  await page.keyboard.press('Control+Home');
  for (let n = 0; n < 13; n++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Control+Alt+s');
  await expect(page.locator('.pdf-location')).toBeVisible();
  await page.keyboard.press('Control+Alt+v');
  await expect(page.getByLabel('PDF 正文', { exact: true })).toBeFocused();
  await page.keyboard.press('Control+f');
  await expect(page.getByLabel('PDF 搜索词')).toBeFocused();
  await page.keyboard.insertText('研究');
  await expect(page.locator('.pdf-search')).toContainText('1/');
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('PDF 正文', { exact: true })).toBeFocused();
  await runCommand(page, 'editorView');
  await expect(page.getByLabel('PDF 预览', { exact: true })).toBeHidden();
  await page.keyboard.press('Control+Alt+v');
  await expect(page.getByLabel('PDF 正文', { exact: true })).toBeFocused();
  await page.setViewportSize({ width: 800, height: 900 });
  await page.keyboard.press('Control+Alt+v');
  await expect(editor(page)).toBeFocused();
  await page.keyboard.press('Control+Alt+v');
  await expect(page.getByLabel('PDF 正文', { exact: true })).toBeFocused();
  await page.getByRole('button', { name: '命令面板', exact: true }).click();
  await page.getByLabel('搜索命令').fill('PDF');
  await page.screenshot({ path: 'test-results/shortcuts-narrow.png', fullPage: true });
});

test('Windows CRLF files keep source offsets and text intact during writing commands', async ({
  page,
}) => {
  const { read } = await setup(page, 'alpha\r\nomega\r\n');
  await expect.poll(read).toBe('alpha\nomega\n');
  await editor(page).focus();
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
  await palette(page, '粗体');
  await page.keyboard.press('Enter');
  await expect.poll(read).toBe('alpha\n\\textbf{omega}\n');
  await page.keyboard.press('Control+z');
  await expect.poll(read).toBe('alpha\nomega\n');
});

test('diagnostics wrap across files, stale diagnostics disable navigation, and file switches keep one handler', async ({
  page,
}) => {
  const { project, file, read } = await setup(page, 'first\nsecond\nthird');
  const detail = await (await page.context().request.get(`api/projects/${project.id}`)).json();
  const fakeBuild = {
    id: 'keyboard-diagnostic-fixture',
    projectId: project.id,
    revision: detail.project.revision,
    status: 'error',
    startedAt: Date.now(),
    finishedAt: Date.now(),
    durationMs: 1,
    log: '',
    hasPdf: false,
    diagnostics: [
      { file: 'scratch.tex', line: 2, severity: 'error', message: 'Second diagnostic' },
      { file: 'main.tex', line: 4, severity: 'warning', message: 'First diagnostic' },
    ],
  };
  await page.route(`**/api/projects/${project.id}`, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch(),
      current = await response.json();
    await route.fulfill({ response, json: { ...current, build: fakeBuild } });
  });
  await page.reload();
  await ready(page);
  await editor(page).focus();
  await page.keyboard.press('F8');
  await expect(page.getByRole('status')).toContainText('1/2');
  await expect(page.locator('.breadcrumbs')).toContainText('main.tex');
  await page.keyboard.press('F8');
  await expect(page.locator('.breadcrumbs')).toContainText('scratch.tex');
  await ready(page);
  await page.keyboard.press('Shift+F8');
  await expect(page.locator('.breadcrumbs')).toContainText('main.tex');
  await ready(page);
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Control+p');
    await page.getByLabel('快速打开文件名').fill('scratch');
    await page.keyboard.press('Enter');
    await ready(page);
    await page.keyboard.press('Control+p');
    await page.getByLabel('快速打开文件名').fill('main');
    await page.keyboard.press('Enter');
    await ready(page);
  }
  await page.keyboard.press('Control+p');
  await page.getByLabel('快速打开文件名').fill('scratch');
  await page.keyboard.press('Enter');
  await ready(page);
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('Control+/');
  await expect.poll(read).toMatch(/^% ?first/);
  await page.keyboard.press('Control+z');
  await expect.poll(read).toBe('first\nsecond\nthird');
  await page.keyboard.press('Alt+ArrowDown');
  await expect.poll(read).toBe('second\nfirst\nthird');
  await page.keyboard.press('Control+z');
  await expect.poll(read).toBe('first\nsecond\nthird');
  await page.keyboard.press('Alt+Shift+ArrowDown');
  await expect.poll(read).toBe('first\nfirst\nsecond\nthird');
  await page.keyboard.press('Control+z');
  await expect.poll(read).toBe('first\nsecond\nthird');
  await palette(page, '下一个问题');
  await expect(page.locator('[data-command="nextProblem"]')).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  expect(file.id).toBeTruthy();
});
