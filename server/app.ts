import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import staticFiles from '@fastify/static';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { zipSync, unzipSync } from 'fflate';
import { Store } from './store.js';
import { Collaboration } from './collaboration.js';
import { Compiler } from './compiler.js';
import { getConfig, type Config } from './config.js';
import {
  assertSize,
  hashPassword,
  HttpError,
  normalizeFilePath,
  tokenHash,
  verifyPassword,
} from './security.js';
import type { User } from '../shared/types.js';
declare module 'fastify' {
  interface FastifyRequest {
    user: User | null;
  }
}
const loginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(256),
});
const userSchema = z.object({
  username: z.string().regex(/^[a-zA-Z0-9_-]{2,32}$/),
  displayName: z.string().trim().min(1).max(48),
  password: z.string().min(10).max(256),
});
const idParams = z.object({ id: z.string().uuid() });
export async function createApp(config: Config = getConfig()) {
  const app = Fastify({ logger: false, bodyLimit: 3 * 1024 * 1024, trustProxy: false });
  const store = new Store(config),
    collab = new Collaboration(store, app.server),
    compiler = new Compiler(store, config);
  collab.onChange = (id) => {
    compiler.changed(id);
    collab.broadcast({ type: 'project', projectId: id });
  };
  compiler.onBuild = (build) =>
    collab.broadcast({ type: 'build', projectId: build.projectId, build });
  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: 80 * 1024 * 1024, files: 1, fields: 5 } });
  app.decorateRequest('user', null);
  app.addHook('onRequest', async (req, reply) => {
    reply
      .header('X-Content-Type-Options', 'nosniff')
      .header('X-Frame-Options', 'DENY')
      .header('Referrer-Policy', 'same-origin');
    if (req.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      store.writable();
      if (req.headers.origin) {
        const origin = new URL(req.headers.origin);
        const dev =
          origin.hostname === '127.0.0.1' &&
          origin.port === '5173' &&
          (req.headers.host || '').startsWith('127.0.0.1:');
        if (origin.host !== req.headers.host && !dev) throw new HttpError(403, '请求来源不匹配。');
      }
    }
    req.user = store.session(req.cookies.paper_session);
    if (
      req.url.startsWith('/api/') &&
      !['/api/auth/login', '/api/health'].includes(req.url.split('?')[0]) &&
      !req.user
    )
      throw new HttpError(401, '请先登录。');
  });
  app.setErrorHandler((error, req, reply) => {
    const e = error as Error & { statusCode?: number };
    const status = e instanceof z.ZodError ? 400 : e.statusCode || 500;
    if (status === 500) console.error('Request failed:', req.method, req.url, e.message);
    reply
      .status(status)
      .send({
        error:
          e instanceof z.ZodError
            ? '输入格式不正确。'
            : status === 500
              ? '操作失败，请稍后重试。'
              : e.message,
      });
  });
  app.get('/api/health', async () => {
    store.writable();
    return { status: 'ok', compiler: config.backend };
  });
  const attempts = new Map<string, { count: number; until: number }>();
  app.post('/api/auth/login', async (req, reply) => {
    const key = req.ip;
    let limit = attempts.get(key);
    if (!limit || limit.until < Date.now()) {
      limit = { count: 0, until: Date.now() + 60000 };
      attempts.set(key, limit);
    }
    if (attempts.size > 10000)
      for (const [k, v] of attempts) if (v.until < Date.now()) attempts.delete(k);
    if (++limit.count > 10) throw new HttpError(429, '尝试次数过多，请一分钟后再试。');
    const { username, password } = loginSchema.parse(req.body);
    const row = store.db.prepare('SELECT * FROM users WHERE username=?').get(username) as any;
    if (!row || !verifyPassword(password, row.password_hash))
      throw new HttpError(401, '用户名或密码不正确。');
    attempts.delete(key);
    const token = store.createSession(row.id);
    reply.setCookie('paper_session', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.secureCookie,
      path: '/',
      maxAge: 7 * 86400,
    });
    return { user: store.user(row) };
  });
  app.get('/api/auth/me', async (req) => ({ user: req.user }));
  app.post('/api/auth/logout', async (req, reply) => {
    if (req.cookies.paper_session)
      store.db
        .prepare('DELETE FROM sessions WHERE token_hash=?')
        .run(tokenHash(req.cookies.paper_session));
    reply.clearCookie('paper_session', { path: '/' });
    return { ok: true };
  });
  app.post('/api/auth/password', async (req) => {
    const body = z
      .object({ oldPassword: z.string(), newPassword: z.string().min(10).max(256) })
      .parse(req.body);
    const row = store.db
      .prepare('SELECT password_hash FROM users WHERE id=?')
      .get(req.user!.id) as any;
    if (!verifyPassword(body.oldPassword, row.password_hash))
      throw new HttpError(400, '原密码不正确。');
    store.db
      .prepare('UPDATE users SET password_hash=? WHERE id=?')
      .run(hashPassword(body.newPassword), req.user!.id);
    store.db
      .prepare('DELETE FROM sessions WHERE user_id=? AND token_hash<>?')
      .run(req.user!.id, tokenHash(req.cookies.paper_session!));
    return { ok: true };
  });
  app.get('/api/users', async (req) => {
    if (!req.user!.isAdmin) throw new HttpError(403, '需要管理员权限。');
    return (store.db.prepare('SELECT * FROM users ORDER BY username').all() as any[]).map((r) =>
      store.user(r),
    );
  });
  app.post('/api/users', async (req) => {
    if (!req.user!.isAdmin) throw new HttpError(403, '需要管理员权限。');
    const body = userSchema.parse(req.body);
    return store.addUser(body.username, body.displayName, body.password);
  });
  app.get('/api/projects', async (req) => store.listProjects(req.user!.id));
  app.post('/api/projects', async (req) => {
    const body = z
      .object({
        title: z.string().trim().min(1).max(100),
        template: z.enum(['chinese', 'english', 'blank']).default('chinese'),
      })
      .parse(req.body);
    return store.createProject(req.user!.id, body.title, body.template);
  });
  app.get('/api/projects/:id', async (req) => {
    const { id } = idParams.parse(req.params);
    return {
      project: store.project(id, req.user!.id),
      files: store.files(id),
      build: store.latestBuild(id),
      lastSuccess: store.latestBuild(id, true),
    };
  });
  app.get('/api/projects/:id/completions', async (req) => {
    const { id } = idParams.parse(req.params);
    store.requireRole(id, req.user!.id);
    const labels = new Set<string>(),
      citations = new Set<string>();
    for (const f of store.files(id).filter((f) => f.kind === 'text')) {
      const text = store.content(f.id).toString();
      for (const m of text.matchAll(/\\label\{([^}]+)\}/g)) labels.add(m[1]);
      if (f.path.endsWith('.bib'))
        for (const m of text.matchAll(/@\w+\s*\{\s*([^,\s]+)\s*,/g)) citations.add(m[1]);
    }
    return { labels: [...labels], citations: [...citations] };
  });
  app.get('/api/projects/:id/search', async (req) => {
    const { id } = idParams.parse(req.params);
    store.requireRole(id, req.user!.id);
    const { q } = z.object({ q: z.string().min(1).max(200) }).parse(req.query);
    const results: { fileId: string; path: string; line: number; text: string }[] = [];
    for (const f of store.files(id).filter((f) => f.kind === 'text')) {
      const lines = store.content(f.id).toString().split('\n');
      for (let i = 0; i < lines.length && results.length < 200; i++)
        if (lines[i].toLocaleLowerCase().includes(q.toLocaleLowerCase()))
          results.push({ fileId: f.id, path: f.path, line: i + 1, text: lines[i].slice(0, 250) });
    }
    return results;
  });
  app.patch('/api/projects/:id', async (req) => {
    const { id } = idParams.parse(req.params);
    store.requireRole(id, req.user!.id, true);
    const body = z
      .object({
        title: z.string().trim().min(1).max(100).optional(),
        engine: z.enum(['xelatex', 'pdflatex', 'lualatex']).optional(),
        mainFileId: z.string().uuid().optional(),
        autoCompile: z.boolean().optional(),
      })
      .parse(req.body);
    store.updateProject(id, body);
    collab.broadcast({ type: 'project', projectId: id });
    compiler.changed(id);
    return store.project(id, req.user!.id);
  });
  app.get('/api/projects/:id/members', async (req) => {
    const { id } = idParams.parse(req.params);
    store.requireRole(id, req.user!.id);
    return (
      store.db
        .prepare(
          'SELECT u.*,m.role FROM users u JOIN members m ON m.user_id=u.id WHERE m.project_id=? ORDER BY u.display_name',
        )
        .all(id) as any[]
    ).map((r) => ({ ...store.user(r), role: r.role }));
  });
  app.post('/api/projects/:id/members', async (req) => {
    const { id } = idParams.parse(req.params);
    store.requireRole(id, req.user!.id, false, true);
    const body = z
      .object({ username: z.string().min(1), role: z.enum(['editor', 'viewer']) })
      .parse(req.body);
    const row = store.db.prepare('SELECT id FROM users WHERE username=?').get(body.username) as any;
    if (!row) throw new HttpError(404, '用户不存在，请让管理员先创建账号。');
    if (store.role(id, row.id) === 'owner') throw new HttpError(400, '不能修改项目所有者角色。');
    store.db
      .prepare(
        'INSERT INTO members VALUES(?,?,?) ON CONFLICT(project_id,user_id) DO UPDATE SET role=excluded.role',
      )
      .run(id, row.id, body.role);
    collab.revoke(id, row.id);
    return { ok: true };
  });
  app.delete('/api/projects/:id/members/:userId', async (req) => {
    const p = z.object({ id: z.string().uuid(), userId: z.string().uuid() }).parse(req.params);
    store.requireRole(p.id, req.user!.id, false, true);
    if (store.role(p.id, p.userId) === 'owner') throw new HttpError(400, '不能移除项目所有者。');
    store.db.prepare('DELETE FROM members WHERE project_id=? AND user_id=?').run(p.id, p.userId);
    collab.revoke(p.id, p.userId);
    return { ok: true };
  });
  app.post('/api/projects/:id/files', async (req) => {
    const { id } = idParams.parse(req.params);
    store.requireRole(id, req.user!.id, true);
    const body = z
      .object({
        path: z.string(),
        content: z
          .string()
          .max(2 * 1024 * 1024)
          .default(''),
      })
      .parse(req.body);
    const file = store.addFile(id, body.path, Buffer.from(body.content));
    collab.broadcast({ type: 'files', projectId: id });
    compiler.changed(id);
    return file;
  });
  app.post('/api/projects/:id/upload', async (req) => {
    const { id } = idParams.parse(req.params);
    store.requireRole(id, req.user!.id, true);
    const data = await req.file();
    if (!data) throw new HttpError(400, '请选择文件。');
    const buffer = await data.toBuffer();
    assertSize(buffer.length);
    const target = (data.fields.path as { value?: string } | undefined)?.value || data.filename;
    const file = store.addFile(id, target, buffer);
    collab.broadcast({ type: 'files', projectId: id });
    compiler.changed(id);
    return file;
  });
  app.get('/api/files/:id/content', async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const file = store.file(id);
    store.requireRole(file.projectId, req.user!.id);
    const content = store.content(id);
    if (file.kind === 'text') return { content: content.toString('utf8') };
    reply.header(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(file.path.split('/').pop()!)}`,
    );
    return reply.type('application/octet-stream').send(content);
  });
  app.patch('/api/files/:id', async (req) => {
    const { id } = idParams.parse(req.params),
      file = store.file(id);
    store.requireRole(file.projectId, req.user!.id, true);
    store.renameFile(id, z.object({ path: z.string() }).parse(req.body).path);
    collab.broadcast({ type: 'files', projectId: file.projectId });
    compiler.changed(file.projectId);
    return store.file(id);
  });
  app.delete('/api/files/:id', async (req) => {
    const { id } = idParams.parse(req.params),
      file = store.file(id);
    store.requireRole(file.projectId, req.user!.id, true);
    store.deleteFile(id);
    collab.removeFile(id);
    collab.broadcast({ type: 'files', projectId: file.projectId });
    compiler.changed(file.projectId);
    return { ok: true };
  });
  const exportZip = (id: string) => {
    const files = store.files(id);
    let size = 0;
    const input: Record<string, Uint8Array> = {};
    for (const f of files) {
      size += f.size;
      if (size > 100 * 1024 * 1024) throw new HttpError(413, '项目导出大小超过 100 MB。');
      input[f.path] = store.content(f.id);
    }
    return Buffer.from(zipSync(input, { level: 6 }));
  };
  app.get('/api/projects/:id/export', async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const p = store.project(id, req.user!.id);
    return reply
      .type('application/zip')
      .header(
        'Content-Disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(p.title)}.zip`,
      )
      .send(exportZip(id));
  });
  const readArchive = (buffer: Buffer) => {
    let size = 0,
      count = 0;
    let entries: Record<string, Uint8Array>;
    try {
      entries = unzipSync(buffer, {
        filter: (f) => {
          if (
            f.name.endsWith('/') ||
            f.name.startsWith('__MACOSX/') ||
            f.name.endsWith('.DS_Store')
          )
            return false;
          size += f.originalSize;
          count++;
          if (size > 100 * 1024 * 1024 || f.originalSize > 20 * 1024 * 1024 || count > 500)
            throw new HttpError(413, 'ZIP 解压内容过大（最多 100 MB、500 个文件）。');
          return true;
        },
      });
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(400, 'ZIP 无法读取，请检查是否为有效的源码压缩包。');
    }
    if (!Object.keys(entries).length) throw new HttpError(400, 'ZIP 中没有文件。');
    const keys = Object.keys(entries);
    for (const name of keys) normalizeFilePath(name);
    const prefix = keys[0].includes('/') ? keys[0].split('/')[0] + '/' : '';
    const strip = prefix && keys.every((k) => k.startsWith(prefix));
    const result: Record<string, Buffer> = {};
    for (const [name, data] of Object.entries(entries)) {
      const clean = normalizeFilePath(strip ? name.slice(prefix.length) : name);
      if (Object.keys(result).some((k) => k.toLowerCase() === clean.toLowerCase()))
        throw new HttpError(400, 'ZIP 包含重名文件。');
      assertSize(data.byteLength);
      result[clean] = Buffer.from(data);
    }
    return result;
  };
  const importProject = (
    userId: string,
    title: string,
    entries: Record<string, Buffer>,
    engine: 'xelatex' | 'pdflatex' | 'lualatex' = 'xelatex',
    mainPath?: string,
  ) =>
    store.db.transaction(() => {
      const p = store.createProject(userId, title, 'blank');
      for (const f of store.files(p.id)) store.deleteFile(f.id);
      for (const [name, content] of Object.entries(entries)) store.addFile(p.id, name, content);
      const files = store.files(p.id),
        main =
          files.find((f) => f.path === mainPath) ||
          files.find((f) => f.path === 'main.tex') ||
          files.find(
            (f) =>
              f.path.endsWith('.tex') && entries[f.path].toString().includes('\\documentclass'),
          );
      store.updateProject(p.id, { engine, ...(main ? { mainFileId: main.id } : {}) });
      return store.project(p.id, userId);
    })();
  app.post('/api/projects/import', async (req) => {
    const data = await req.file();
    if (!data) throw new HttpError(400, '请选择 ZIP 文件。');
    const buffer = await data.toBuffer();
    const entries = readArchive(buffer);
    return importProject(
      req.user!.id,
      data.filename.replace(/\.zip$/i, '').slice(0, 100) || '导入项目',
      entries,
    );
  });
  app.get('/api/projects/:id/snapshots', async (req) => {
    const { id } = idParams.parse(req.params);
    store.requireRole(id, req.user!.id);
    return (
      store.db
        .prepare('SELECT * FROM snapshots WHERE project_id=? ORDER BY created_at DESC')
        .all(id) as any[]
    ).map((r) => ({
      id: r.id,
      projectId: r.project_id,
      name: r.name,
      createdAt: r.created_at,
      revision: r.revision,
    }));
  });
  app.post('/api/projects/:id/snapshots', async (req) => {
    const { id } = idParams.parse(req.params);
    store.requireRole(id, req.user!.id, true);
    const p = store.project(id, req.user!.id),
      name = z.object({ name: z.string().trim().min(1).max(100) }).parse(req.body).name,
      snapshotId = randomUUID();
    const root = path.join(config.dataDir, 'snapshots');
    fs.writeFileSync(path.join(root, snapshotId + '.zip'), exportZip(id));
    fs.writeFileSync(
      path.join(root, snapshotId + '.json'),
      JSON.stringify({
        title: p.title,
        engine: p.engine,
        mainPath: store.files(id).find((f) => f.id === p.mainFileId)?.path,
      }),
    );
    store.db
      .prepare('INSERT INTO snapshots VALUES(?,?,?,?,?)')
      .run(snapshotId, id, name, Date.now(), p.revision);
    return { id: snapshotId };
  });
  app.post('/api/snapshots/:id/restore', async (req) => {
    const { id } = idParams.parse(req.params);
    const row = store.db.prepare('SELECT * FROM snapshots WHERE id=?').get(id) as any;
    if (!row) throw new HttpError(404, '快照不存在。');
    store.requireRole(row.project_id, req.user!.id);
    const root = path.join(config.dataDir, 'snapshots'),
      meta = JSON.parse(fs.readFileSync(path.join(root, id + '.json'), 'utf8'));
    return importProject(
      req.user!.id,
      `${meta.title} · 恢复`,
      readArchive(fs.readFileSync(path.join(root, id + '.zip'))),
      meta.engine,
      meta.mainPath,
    );
  });
  app.post('/api/projects/:id/compile', async (req) => {
    const { id } = idParams.parse(req.params);
    store.requireRole(id, req.user!.id, true);
    return compiler.request(id);
  });
  app.post('/api/projects/:id/compile/cancel', async (req) => {
    const { id } = idParams.parse(req.params);
    store.requireRole(id, req.user!.id, true);
    await compiler.cancel(id);
    return { ok: true };
  });
  app.get('/api/builds/:id', async (req) => {
    const { id } = idParams.parse(req.params),
      build = store.build(id);
    if (!build) throw new HttpError(404, '编译不存在。');
    store.requireRole(build.projectId, req.user!.id);
    return build;
  });
  app.get('/api/builds/:id/pdf', async (req, reply) => {
    const { id } = idParams.parse(req.params),
      build = store.build(id);
    if (!build?.hasPdf) throw new HttpError(404, 'PDF 不存在。');
    store.requireRole(build.projectId, req.user!.id);
    const file = path.join(config.dataDir, 'artifacts', id, 'output.pdf');
    return reply
      .type('application/pdf')
      .header('Content-Disposition', 'inline; filename="paper.pdf"')
      .send(fs.createReadStream(file));
  });
  app.post('/api/builds/:id/synctex', async (req) => {
    const { id } = idParams.parse(req.params),
      build = store.build(id);
    if (!build) throw new HttpError(404, '编译不存在。');
    store.requireRole(build.projectId, req.user!.id);
    const input = z
      .object({
        fileId: z.string().uuid().optional(),
        line: z.number().int().min(1).max(1000000).optional(),
        page: z.number().int().min(1).max(100000).optional(),
        x: z.number().finite().min(0).max(100000).optional(),
        y: z.number().finite().min(0).max(100000).optional(),
      })
      .parse(req.body);
    return compiler.syncTex(id, input);
  });
  const clientRoot = path.resolve('dist/client');
  if (fs.existsSync(path.join(clientRoot, 'index.html'))) {
    await app.register(staticFiles, { root: clientRoot });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: '接口不存在。' });
      return reply.sendFile('index.html');
    });
  }
  app.addHook('onClose', async () => {
    compiler.close();
    collab.close();
    store.close();
  });
  return { app, store, collab, compiler, config };
}
