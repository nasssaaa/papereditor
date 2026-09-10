import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { Build, Diagnostic, Engine } from '../shared/types.js';
import type { Store } from './store.js';
import { HttpError, safeJoin } from './security.js';
import type { Config } from './config.js';
export function parseDiagnostics(log: string): Diagnostic[] {
  const result: Diagnostic[] = [];
  for (const line of log.split(/\r?\n/)) {
    const m = line.match(/(?:^|\s)((?:\.?\.?\/)?[^<>\r\n]*?\.(?:tex|sty|cls)):(\d+):\s*(.+)/);
    if (m)
      result.push({
        file: m[1]
          .trim()
          .replace(/^\/work\//, '')
          .replace(/^\.\//, ''),
        line: Number(m[2]),
        message: m[3],
        severity: 'error',
      });
    else if (/^(?:LaTeX|Package .+) Warning:/.test(line))
      result.push({ file: '', line: 0, message: line, severity: 'warning' });
    else if (line.startsWith('! '))
      result.push({ file: '', line: 0, message: line.slice(2), severity: 'error' });
  }
  return result.slice(0, 200);
}
export class Compiler {
  private timers = new Map<string, { timer: NodeJS.Timeout; first: number }>();
  private pending = new Map<string, Build>();
  private running = new Map<string, { build: Build; child?: ChildProcess; cancelled: boolean }>();
  onBuild: (build: Build) => void = () => {};
  constructor(
    private store: Store,
    private config: Config,
  ) {}
  changed(projectId: string) {
    if (this.config.backend === 'disabled') return;
    if (
      !(this.store.db.prepare('SELECT auto_compile FROM projects WHERE id=?').get(projectId) as any)
        ?.auto_compile
    ) {
      const t = this.timers.get(projectId);
      if (t) clearTimeout(t.timer);
      this.timers.delete(projectId);
      return;
    }
    const old = this.timers.get(projectId),
      first = old?.first || Date.now();
    if (old) clearTimeout(old.timer);
    const timer = setTimeout(
      () => {
        this.timers.delete(projectId);
        try {
          this.request(projectId);
        } catch {}
      },
      Math.max(0, Math.min(1000, 5000 - (Date.now() - first))),
    );
    timer.unref();
    this.timers.set(projectId, { timer, first });
  }
  request(projectId: string): Build {
    this.store.writable();
    const p = this.store.db
      .prepare('SELECT revision,main_file_id FROM projects WHERE id=?')
      .get(projectId) as any;
    if (!p) throw new HttpError(404, '项目不存在。');
    if (!p.main_file_id) throw new HttpError(400, '请在项目设置中选择主 .tex 文件。');
    const old = this.pending.get(projectId);
    if (old) {
      old.status = 'cancelled';
      old.finishedAt = Date.now();
      this.publish(old);
    }
    const b: Build = {
      id: randomUUID(),
      projectId,
      revision: p.revision,
      status: 'queued',
      startedAt: Date.now(),
      finishedAt: null,
      durationMs: null,
      log: '',
      diagnostics: [],
      hasPdf: false,
    };
    this.pending.set(projectId, b);
    this.publish(b);
    void this.drain();
    return b;
  }
  private publish(b: Build) {
    this.store.saveBuild(b);
    this.onBuild({ ...b });
  }
  private async drain() {
    for (const [id, b] of this.pending) {
      if (this.running.size >= Math.max(1, this.config.concurrency)) break;
      if (this.running.has(id)) continue;
      this.pending.delete(id);
      this.running.set(id, { build: b, cancelled: false });
      void this.run(b).finally(() => {
        this.running.delete(id);
        void this.drain();
      });
    }
  }
  private environment() {
    return {
      ...process.env,
      PATH: [this.config.extraPath, process.env.PATH].filter(Boolean).join(path.delimiter),
    };
  }
  private sandboxArgs(work: string, preview = work) {
    return [
      '-D',
      `TEXROOT=${this.config.texliveDir}`,
      '-D',
      `WORKDIR=${work}`,
      '-D',
      `PREVIEW=${preview}`,
      '-D',
      `TEMPDIR=${path.join(work, '.tmp')}`,
      '-f',
      path.resolve('deploy/compiler-macos.sb'),
    ];
  }
  private dockerArgs(work: string, readOnly = false) {
    return [
      'run',
      '--rm',
      '--platform',
      'linux/arm64',
      '--network=none',
      '--read-only',
      '--cap-drop=ALL',
      '--security-opt=no-new-privileges',
      '--pids-limit=128',
      '--memory=2g',
      '--cpus=2',
      '--tmpfs=/tmp:rw,noexec,nosuid,size=128m',
      '--user',
      `${process.getuid?.() || 1000}:${process.getgid?.() || 1000}`,
      '--mount',
      `type=bind,src=${this.config.texliveDir},dst=/opt/texlive,readonly`,
      '--mount',
      `type=bind,src=${work},dst=/work${readOnly ? ',readonly' : ''}`,
      '--workdir',
      '/work',
    ];
  }
  private execute(
    command: string,
    args: string[],
    cwd: string,
    timeout: number,
    onData?: (text: string) => void,
    onChild?: (c: ChildProcess) => void,
  ): Promise<{ code: number; log: string; timedOut: boolean }> {
    return new Promise((resolve) => {
      let log = '',
        done = false,
        timedOut = false;
      const env = this.environment();
      if (this.config.backend === 'macos-sandbox') {
        fs.mkdirSync(path.join(cwd, '.tmp'), { recursive: true });
        Object.assign(env, {
          PATH: `${this.config.texliveDir}/bin/universal-darwin:/usr/bin:/bin:/usr/sbin:/sbin`,
          HOME: cwd,
          TMPDIR: path.join(cwd, '.tmp'),
          TEXMFHOME: path.join(cwd, '.tex-home'),
          TEXMFVAR: path.join(cwd, '.tex-cache'),
          TEXMFCONFIG: path.join(cwd, '.tex-config'),
        });
      }
      const child = spawn(command, args, {
        cwd,
        env,
        shell: false,
        windowsHide: true,
        detached: process.platform !== 'win32',
      });
      onChild?.(child);
      const append = (data: Buffer) => {
        const s = data.toString();
        log = (log + s).slice(-1024 * 1024);
        onData?.(s);
      };
      child.stdout?.on('data', append);
      child.stderr?.on('data', append);
      const timer = setTimeout(() => {
        timedOut = true;
        this.kill(child);
      }, timeout);
      const finish = (code: number) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve({ code, log, timedOut });
      };
      child.once('error', (error) => {
        log += `\n无法启动编译工具：${error.message}\n`;
        finish(-1);
      });
      child.once('close', (code) => finish(code ?? -1));
    });
  }
  private kill(child: ChildProcess) {
    if (!child.pid) return;
    if (process.platform === 'win32')
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
    else {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    }
  }
  private async run(b: Build) {
    const state = this.running.get(b.projectId)!;
    const work = path.join(this.config.dataDir, 'builds', b.projectId),
      artifact = path.join(this.config.dataDir, 'artifacts', b.id);
    let lastPush = 0;
    try {
      if (this.config.backend === 'disabled') throw new Error('此环境已禁用编译。');
      this.store.writable();
      const p = this.store.db.prepare('SELECT * FROM projects WHERE id=?').get(b.projectId) as any;
      if (!p?.main_file_id) throw new Error('请先选择主文件。');
      const files = this.store.files(b.projectId),
        main = files.find((f) => f.id === p.main_file_id);
      if (!main) throw new Error('主文件不存在。');
      b.revision = p.revision;
      b.status = 'running';
      b.startedAt = Date.now();
      this.publish(b);
      fs.mkdirSync(work, { recursive: true });
      const fingerprint = JSON.stringify([
        this.config.backend,
        this.config.latexmk,
        this.config.extraPath,
        p.engine,
        main.path,
      ]);
      const fingerprintFile = path.join(work, '.paper-toolchain.json');
      if (
        !fs.existsSync(fingerprintFile) ||
        fs.readFileSync(fingerprintFile, 'utf8') !== fingerprint
      ) {
        fs.rmSync(path.join(work, '.out'), { recursive: true, force: true });
        fs.writeFileSync(fingerprintFile, fingerprint);
      }
      fs.mkdirSync(path.join(work, '.out'), { recursive: true });
      const manifest = path.join(work, '.paper-sources.json');
      const previous: string[] = fs.existsSync(manifest)
        ? JSON.parse(fs.readFileSync(manifest, 'utf8'))
        : [];
      for (const name of previous)
        if (!files.some((f) => f.path === name)) fs.rmSync(safeJoin(work, name), { force: true });
      const names = files.map((f) => f.path);
      for (const f of files) {
        const target = safeJoin(work, f.path),
          content = this.store.content(f.id);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        if (!fs.existsSync(target) || !fs.readFileSync(target).equals(content))
          fs.writeFileSync(target, content);
      }
      fs.writeFileSync(manifest, JSON.stringify(names));
      fs.writeFileSync(
        path.join(work, '.papereditor-build.json'),
        JSON.stringify({
          files: files.map((f) => ({ id: f.id, path: f.path })),
          main: main.path,
          revision: b.revision,
        }),
      );
      const engine = p.engine as Engine;
      const args = [
        '-norc',
        engine === 'pdflatex' ? '-pdf' : `-${engine}`,
        '-interaction=nonstopmode',
        '-halt-on-error',
        '-file-line-error',
        '-synctex=1',
        '-jobname=output',
        '-outdir=.out',
        '-latexoption=-no-shell-escape',
        `./${main.path}`,
      ];
      let command = this.config.latexmk,
        commandArgs = args;
      if (this.config.backend === 'docker') {
        command = this.config.docker;
        commandArgs = [
          ...this.dockerArgs(work),
          '--name',
          `papereditor-build-${b.id}`,
          'papereditor-tex-runtime:2026',
          'latexmk',
          ...args,
        ];
      }
      if (this.config.backend === 'macos-sandbox') {
        command = '/usr/bin/sandbox-exec';
        commandArgs = [
          ...this.sandboxArgs(work),
          '/bin/sh',
          '-c',
          'ulimit -t 120; ulimit -f 1048576; exec "$@"',
          'papereditor',
          path.join(this.config.texliveDir, 'bin/universal-darwin/latexmk'),
          ...args,
        ];
      }
      if (this.config.backend === 'native' && process.platform === 'win32')
        commandArgs.splice(commandArgs.length - 1, 0, '-latexoption=-disable-installer');
      const result = await this.execute(
        command,
        commandArgs,
        work,
        this.config.timeoutMs,
        (text) => {
          b.log = (b.log + text).slice(-1024 * 1024);
          if (Date.now() - lastPush > 700) {
            lastPush = Date.now();
            this.onBuild({ ...b });
          }
        },
        (child) => (state.child = child),
      );
      if (result.timedOut && this.config.backend === 'docker')
        await this.execute(
          this.config.docker,
          ['rm', '-f', `papereditor-build-${b.id}`],
          work,
          10000,
        );
      b.log = result.log + (result.timedOut ? '\n编译超过时间限制，已停止。' : '');
      const pdf = path.join(work, '.out', 'output.pdf');
      b.status = state.cancelled
        ? 'cancelled'
        : result.code === 0 && fs.existsSync(pdf)
          ? 'success'
          : 'error';
      if (b.status === 'success') {
        fs.mkdirSync(artifact, { recursive: true });
        for (const name of ['output.pdf', 'output.synctex.gz', 'output.log']) {
          const source = path.join(work, '.out', name);
          if (fs.existsSync(source)) fs.copyFileSync(source, path.join(artifact, name));
        }
        fs.copyFileSync(
          path.join(work, '.papereditor-build.json'),
          path.join(artifact, 'manifest.json'),
        );
        b.hasPdf = true;
      }
      const finalLog = path.join(work, '.out', 'output.log');
      b.diagnostics = parseDiagnostics(
        b.status === 'success' && fs.existsSync(finalLog)
          ? fs.readFileSync(finalLog, 'utf8')
          : b.log,
      );
      if (b.status === 'error' && !b.diagnostics.some((d) => d.severity === 'error'))
        b.diagnostics.unshift({
          file: main.path,
          line: 1,
          severity: 'error',
          message: result.timedOut
            ? '编译超时，请检查循环、图片大小或复杂绘图。'
            : '编译失败，请查看完整日志。',
        });
    } catch (error) {
      b.status = state.cancelled ? 'cancelled' : 'error';
      b.log += `\n${(error as Error).message}`;
      b.diagnostics = [{ file: '', line: 0, severity: 'error', message: (error as Error).message }];
    } finally {
      b.finishedAt = Date.now();
      b.durationMs = b.finishedAt - b.startedAt;
      try {
        this.publish(b);
        this.retain(b.projectId);
      } catch (error) {
        console.error('Cannot persist build:', (error as Error).message);
      }
    }
  }
  private retain(projectId: string) {
    const rows = this.store.db
      .prepare('SELECT id FROM builds WHERE project_id=? AND has_pdf=1 ORDER BY started_at DESC')
      .all(projectId) as any[];
    for (const r of rows.slice(10)) {
      fs.rmSync(path.join(this.config.dataDir, 'artifacts', r.id), {
        recursive: true,
        force: true,
      });
      this.store.db.prepare('UPDATE builds SET has_pdf=0 WHERE id=?').run(r.id);
    }
  }
  async cancel(projectId: string) {
    const queued = this.pending.get(projectId);
    if (queued) {
      this.pending.delete(projectId);
      queued.status = 'cancelled';
      queued.finishedAt = Date.now();
      this.publish(queued);
    }
    const state = this.running.get(projectId);
    if (state) {
      state.cancelled = true;
      if (state.child) this.kill(state.child);
      if (this.config.backend === 'docker')
        await this.execute(
          this.config.docker,
          ['rm', '-f', `papereditor-build-${state.build.id}`],
          this.config.dataDir,
          10000,
        );
    }
  }
  async syncTex(
    buildId: string,
    input: { fileId?: string; line?: number; page?: number; x?: number; y?: number },
  ) {
    const b = this.store.build(buildId);
    if (!b?.hasPdf) throw new HttpError(404, '预览文件不存在。');
    const artifact = path.join(this.config.dataDir, 'artifacts', buildId);
    if (!fs.existsSync(path.join(artifact, 'output.synctex.gz')))
      throw new HttpError(404, '此版本没有 SyncTeX 信息。');
    const manifest = JSON.parse(fs.readFileSync(path.join(artifact, 'manifest.json'), 'utf8')) as {
      files: { id: string; path: string }[];
    };
    const work = path.join(this.config.dataDir, 'builds', b.projectId);
    const file = input.fileId ? manifest.files.find((f) => f.id === input.fileId) : undefined;
    if (input.fileId && !file) throw new HttpError(404, '此文件尚未包含在预览中。');
    const output =
      this.config.backend === 'docker' ? '/preview/output.pdf' : path.join(artifact, 'output.pdf');
    const source = file
      ? this.config.backend === 'docker'
        ? `/work/${file.path}`
        : path.join(work, file.path)
      : '';
    const args = file
      ? ['view', '-i', `${input.line || 1}:0:${source}`, '-o', output]
      : ['edit', '-o', `${input.page || 1}:${input.x || 0}:${input.y || 0}:${output}`];
    let cmd = this.config.synctex,
      allArgs = args;
    if (this.config.backend === 'docker') {
      cmd = this.config.docker;
      allArgs = [
        ...this.dockerArgs(work, true),
        '--mount',
        `type=bind,src=${artifact},dst=/preview,readonly`,
        'papereditor-tex-runtime:2026',
        'synctex',
        ...args,
      ];
    }
    if (this.config.backend === 'macos-sandbox') {
      cmd = '/usr/bin/sandbox-exec';
      allArgs = [
        ...this.sandboxArgs(work, artifact),
        path.join(this.config.texliveDir, 'bin/universal-darwin/synctex'),
        ...args,
      ];
    }
    const result = await this.execute(cmd, allArgs, work, 10000);
    const blocks =
      result.log.split('SyncTeX result begin')[1]?.split('SyncTeX result end')[0] || '';
    if (file) {
      const page = Number(/^Page:(.+)$/m.exec(blocks)?.[1]),
        x = Number(/^x:(.+)$/m.exec(blocks)?.[1]),
        y = Number(/^y:(.+)$/m.exec(blocks)?.[1]);
      if (!page) throw new HttpError(404, '此处没有可定位的排版内容。');
      return { page, x, y };
    }
    const sourcePath = /^Input:(.+)$/m.exec(blocks)?.[1]?.trim().replaceAll('\\', '/') || '';
    const found = manifest.files.find(
      (f) => sourcePath.endsWith('/' + f.path) || sourcePath === f.path,
    );
    if (!found) throw new HttpError(404, '此处没有对应的源码位置。');
    return { fileId: found.id, line: Number(/^Line:(.+)$/m.exec(blocks)?.[1]) || 1 };
  }
  close() {
    for (const t of this.timers.values()) clearTimeout(t.timer);
    this.timers.clear();
    for (const id of this.running.keys()) void this.cancel(id);
    this.pending.clear();
  }
}
