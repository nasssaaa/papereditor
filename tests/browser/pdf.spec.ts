import { test, expect } from './fixtures';
import fs from 'node:fs';

test('compiled PDF displays text, supports search, and maps back to source', async ({
  page,
  request,
}) => {
  const credentials = JSON.parse(
    fs.readFileSync(process.env.TEST_CREDENTIALS_FILE || '.data/bootstrap-admin.json', 'utf8'),
  );
  const login = await request.post('api/auth/login', { data: credentials });
  expect(login.ok()).toBeTruthy();
  const projects = await (await request.get('api/projects')).json();
  const project = projects.find((p: any) => p.title === '我的第一篇论文');
  const detail = await (await request.get(`api/projects/${project.id}`)).json();
  test.skip(
    !detail.lastSuccess,
    'Run deploy/check-compilation.mjs to generate the sample PDF first.',
  );
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`./#/project/${project.id}`);
  await page.getByLabel('用户名', { exact: true }).fill(credentials.username);
  await page.getByLabel('密码', { exact: true }).fill(credentials.password);
  await page.getByRole('button', { name: '进入工作空间' }).click();
  await expect(page.getByTitle('保存状态')).toContainText('已保存', { timeout: 25000 });
  await expect(page.locator('.textLayer').first()).toContainText('协作', { timeout: 25000 });
  await page.getByRole('button', { name: '搜索 PDF', exact: true }).click();
  await page.getByLabel('PDF 搜索词').fill('研究');
  await expect(page.locator('.pdf-search')).toContainText('1/');
  await page.getByRole('button', { name: '关闭搜索', exact: true }).click();
  const position = await request.post(`api/builds/${detail.lastSuccess.id}/synctex`, {
    data: { fileId: project.mainFileId, line: 14 },
  });
  expect(position.ok()).toBeTruthy();
  const point = await position.json();
  const reverse = await request.post(`api/builds/${detail.lastSuccess.id}/synctex`, {
    data: point,
  });
  expect(reverse.ok()).toBeTruthy();
  const result = await reverse.json();
  expect(detail.files.some((f: any) => f.id === result.fileId)).toBeTruthy();
  expect(result.line).toBeGreaterThan(0);
  await page.screenshot({ path: 'test-results/papereditor-compiled.png', fullPage: true });
  expect(errors).toEqual([]);
});
