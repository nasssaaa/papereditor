import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import * as Y from 'yjs';
import type { Build, Engine, Project, ProjectFile, Role, User } from '../shared/types.js';
import { assertStorage, type Config } from './config.js';
import { fileKind, hashPassword, HttpError, normalizeFilePath, tokenHash } from './security.js';
import { chineseTemplate, englishTemplate } from './templates.js';
export class Store {
  db: Database.Database;
  constructor(public config: Config) {
    fs.mkdirSync(config.dataDir, { recursive: true });
    for (const folder of ['assets', 'builds', 'artifacts', 'snapshots'])
      fs.mkdirSync(path.join(config.dataDir, folder), { recursive: true });
    this.db = new Database(path.join(config.dataDir, 'papereditor.sqlite'));
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('synchronous = FULL');
    this.db.pragma('busy_timeout = 5000');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL, password_hash TEXT NOT NULL, is_admin INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, title TEXT NOT NULL, owner_id TEXT NOT NULL REFERENCES users(id), main_file_id TEXT, engine TEXT NOT NULL DEFAULT 'xelatex', revision INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS members(project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, role TEXT NOT NULL, PRIMARY KEY(project_id,user_id));
      CREATE TABLE IF NOT EXISTS files(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, path TEXT NOT NULL, path_key TEXT NOT NULL, kind TEXT NOT NULL, y_state BLOB, size INTEGER NOT NULL DEFAULT 0, UNIQUE(project_id,path_key));
      CREATE TABLE IF NOT EXISTS builds(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, revision INTEGER NOT NULL, status TEXT NOT NULL, started_at INTEGER NOT NULL, finished_at INTEGER, duration_ms INTEGER, log TEXT NOT NULL DEFAULT '', diagnostics TEXT NOT NULL DEFAULT '[]', has_pdf INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS snapshots(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, name TEXT NOT NULL, created_at INTEGER NOT NULL, revision INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS files_project ON files(project_id);
      CREATE INDEX IF NOT EXISTS builds_project ON builds(project_id,started_at);
    `);
    if (
      !(this.db.pragma('table_info(projects)') as { name: string }[]).some(
        (c) => c.name === 'auto_compile',
      )
    )
      this.db.exec('ALTER TABLE projects ADD COLUMN auto_compile INTEGER NOT NULL DEFAULT 1');
    this.db
      .prepare(
        "UPDATE builds SET status='error', finished_at=?, log=log || '\n服务重启，任务已中断。' WHERE status IN ('queued','running')",
      )
      .run(Date.now());
  }
  writable() {
    assertStorage(this.config);
  }
  user(row: any): User {
    return {
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      isAdmin: !!row.is_admin,
    };
  }
  addUser(username: string, displayName: string, password: string, isAdmin = false): User {
    this.writable();
    const id = randomUUID();
    if (this.db.prepare('SELECT id FROM users WHERE username=?').get(username))
      throw new HttpError(409, '用户名已存在。');
    this.db
      .prepare('INSERT INTO users VALUES (?,?,?,?,?)')
      .run(id, username, displayName, hashPassword(password), +isAdmin);
    return { id, username, displayName, isAdmin };
  }
  createSession(userId: string) {
    const token = randomBytes(32).toString('hex');
    this.db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
    this.db
      .prepare('INSERT INTO sessions VALUES(?,?,?)')
      .run(tokenHash(token), userId, Date.now() + 7 * 86400000);
    return token;
  }
  session(token?: string): User | null {
    if (!token) return null;
    const row = this.db
      .prepare(
        'SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>?',
      )
      .get(tokenHash(token), Date.now());
    return row ? this.user(row) : null;
  }
  role(projectId: string, userId: string): Role | null {
    const r = this.db
      .prepare('SELECT role FROM members WHERE project_id=? AND user_id=?')
      .get(projectId, userId) as any;
    return r?.role || null;
  }
  requireRole(projectId: string, userId: string, write = false, owner = false): Role {
    const role = this.role(projectId, userId);
    if (!role || (write && role === 'viewer') || (owner && role !== 'owner'))
      throw new HttpError(403, '没有此项目的操作权限。');
    return role;
  }
  project(id: string, userId: string): Project {
    const role = this.requireRole(id, userId);
    const r = this.db.prepare('SELECT * FROM projects WHERE id=?').get(id) as any;
    return {
      id: r.id,
      title: r.title,
      ownerId: r.owner_id,
      mainFileId: r.main_file_id,
      engine: r.engine,
      autoCompile: !!r.auto_compile,
      revision: r.revision,
      updatedAt: r.updated_at,
      role,
    };
  }
  listProjects(userId: string) {
    return (
      this.db
        .prepare(
          'SELECT p.id FROM projects p JOIN members m ON p.id=m.project_id WHERE m.user_id=? ORDER BY p.updated_at DESC',
        )
        .all(userId) as any[]
    ).map((r) => this.project(r.id, userId));
  }
  bump(projectId: string) {
    this.writable();
    this.db
      .prepare('UPDATE projects SET revision=revision+1,updated_at=? WHERE id=?')
      .run(Date.now(), projectId);
  }
  createProject(
    userId: string,
    title: string,
    template: 'chinese' | 'english' | 'blank' = 'chinese',
  ): Project {
    this.writable();
    const id = randomUUID();
    this.db.transaction(() => {
      this.db
        .prepare('INSERT INTO projects(id,title,owner_id,updated_at) VALUES(?,?,?,?)')
        .run(id, title, userId, Date.now());
      this.db.prepare('INSERT INTO members VALUES(?,?,?)').run(id, userId, 'owner');
      const files =
        template === 'chinese'
          ? chineseTemplate
          : template === 'english'
            ? englishTemplate
            : {
                'main.tex':
                  '\\documentclass{article}\n\\begin{document}\nHello, research!\n\\end{document}\n',
              };
      for (const [name, content] of Object.entries(files))
        this.addFile(id, name, Buffer.from(content));
      const main = this.files(id).find((f) => f.path === 'main.tex')!;
      this.db
        .prepare('UPDATE projects SET main_file_id=?,engine=? WHERE id=?')
        .run(main.id, template === 'english' ? 'pdflatex' : 'xelatex', id);
    })();
    return this.project(id, userId);
  }
  files(projectId: string): ProjectFile[] {
    return (
      this.db
        .prepare('SELECT id,project_id,path,kind,size FROM files WHERE project_id=? ORDER BY path')
        .all(projectId) as any[]
    ).map((r) => ({ id: r.id, projectId: r.project_id, path: r.path, kind: r.kind, size: r.size }));
  }
  file(id: string): ProjectFile {
    const r = this.db
      .prepare('SELECT id,project_id,path,kind,size FROM files WHERE id=?')
      .get(id) as any;
    if (!r) throw new HttpError(404, '文件不存在或已删除。');
    return { id: r.id, projectId: r.project_id, path: r.path, kind: r.kind, size: r.size };
  }
  addFile(projectId: string, rawPath: string, content: Buffer): ProjectFile {
    this.writable();
    const name = normalizeFilePath(rawPath),
      kind = fileKind(name),
      id = randomUUID();
    if (this.files(projectId).length >= 500) throw new HttpError(413, '每个项目最多 500 个文件。');
    if (
      this.db
        .prepare('SELECT id FROM files WHERE project_id=? AND path_key=?')
        .get(projectId, name.toLowerCase())
    )
      throw new HttpError(409, '同名文件已存在。');
    let state: Buffer | null = null;
    if (kind === 'text') {
      if (content.length > 2 * 1024 * 1024) throw new HttpError(413, '文本文件上限 2 MB。');
      const doc = new Y.Doc();
      doc.getText('content').insert(0, new TextDecoder('utf-8', { fatal: true }).decode(content));
      state = Buffer.from(Y.encodeStateAsUpdate(doc));
      doc.destroy();
    } else fs.writeFileSync(path.join(this.config.dataDir, 'assets', id), content);
    this.db
      .prepare(
        'INSERT INTO files(id,project_id,path,path_key,kind,y_state,size) VALUES(?,?,?,?,?,?,?)',
      )
      .run(id, projectId, name, name.toLowerCase(), kind, state, content.length);
    this.bump(projectId);
    return this.file(id);
  }
  loadDoc(id: string): Y.Doc {
    const r = this.db.prepare('SELECT y_state,kind FROM files WHERE id=?').get(id) as any;
    if (!r || r.kind !== 'text') throw new HttpError(404, '文本文件不存在。');
    const doc = new Y.Doc();
    Y.applyUpdate(doc, new Uint8Array(r.y_state));
    return doc;
  }
  saveDoc(id: string, doc: Y.Doc) {
    this.writable();
    const f = this.file(id);
    this.db.transaction(() => {
      this.db
        .prepare('UPDATE files SET y_state=?,size=? WHERE id=?')
        .run(
          Buffer.from(Y.encodeStateAsUpdate(doc)),
          Buffer.byteLength(doc.getText('content').toString()),
          id,
        );
      this.bump(f.projectId);
    })();
  }
  content(id: string): Buffer {
    const f = this.file(id);
    if (f.kind === 'binary') return fs.readFileSync(path.join(this.config.dataDir, 'assets', id));
    const doc = this.loadDoc(id);
    const result = Buffer.from(doc.getText('content').toString());
    doc.destroy();
    return result;
  }
  updateProject(
    id: string,
    data: { title?: string; engine?: Engine; mainFileId?: string; autoCompile?: boolean },
  ) {
    this.writable();
    if (data.mainFileId) {
      const f = this.file(data.mainFileId);
      if (f.projectId !== id || !f.path.endsWith('.tex'))
        throw new HttpError(400, '主文件必须是此项目内的 .tex 文件。');
    }
    for (const [key, column] of [
      ['title', 'title'],
      ['engine', 'engine'],
      ['mainFileId', 'main_file_id'],
    ] as const)
      if (data[key] !== undefined)
        this.db.prepare(`UPDATE projects SET ${column}=? WHERE id=?`).run(data[key], id);
    if (data.autoCompile !== undefined)
      this.db.prepare('UPDATE projects SET auto_compile=? WHERE id=?').run(+data.autoCompile, id);
    this.bump(id);
  }
  renameFile(id: string, rawPath: string) {
    this.writable();
    const f = this.file(id),
      name = normalizeFilePath(rawPath);
    if (fileKind(name) !== f.kind) throw new HttpError(400, '不能改变文本与二进制文件类型。');
    const conflict = this.db
      .prepare('SELECT id FROM files WHERE project_id=? AND path_key=? AND id<>?')
      .get(f.projectId, name.toLowerCase(), id);
    if (conflict) throw new HttpError(409, '同名文件已存在。');
    this.db
      .prepare('UPDATE files SET path=?,path_key=? WHERE id=?')
      .run(name, name.toLowerCase(), id);
    this.bump(f.projectId);
  }
  deleteFile(id: string) {
    this.writable();
    const f = this.file(id);
    this.db.transaction(() => {
      this.db.prepare('UPDATE projects SET main_file_id=NULL WHERE main_file_id=?').run(id);
      this.db.prepare('DELETE FROM files WHERE id=?').run(id);
      this.bump(f.projectId);
    })();
    if (f.kind === 'binary')
      fs.rmSync(path.join(this.config.dataDir, 'assets', id), { force: true });
  }
  saveBuild(b: Build) {
    this.writable();
    this.db
      .prepare('INSERT OR REPLACE INTO builds VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(
        b.id,
        b.projectId,
        b.revision,
        b.status,
        b.startedAt,
        b.finishedAt,
        b.durationMs,
        b.log,
        JSON.stringify(b.diagnostics),
        +b.hasPdf,
      );
  }
  build(id: string): Build | null {
    const r = this.db.prepare('SELECT * FROM builds WHERE id=?').get(id) as any;
    return r
      ? {
          id: r.id,
          projectId: r.project_id,
          revision: r.revision,
          status: r.status,
          startedAt: r.started_at,
          finishedAt: r.finished_at,
          durationMs: r.duration_ms,
          log: r.log,
          diagnostics: JSON.parse(r.diagnostics),
          hasPdf: !!r.has_pdf,
        }
      : null;
  }
  latestBuild(projectId: string, success = false): Build | null {
    const r = this.db
      .prepare(
        `SELECT id FROM builds WHERE project_id=? ${success ? "AND status='success'" : ''} ORDER BY started_at DESC,rowid DESC LIMIT 1`,
      )
      .get(projectId) as any;
    return r ? this.build(r.id) : null;
  }
  close() {
    this.db.close();
  }
}
