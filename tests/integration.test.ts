import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import WebSocket from 'ws';
import { zipSync } from 'fflate';
import { createApp } from '../server/app.js';
import { getConfig } from '../server/config.js';
import { normalizeFilePath, verifyPassword, hashPassword } from '../server/security.js';
import { parseDiagnostics } from '../server/compiler.js';
let system: Awaited<ReturnType<typeof createApp>>, base: string, folder: string;
const password = 'integration-password-4927';
let alice: any,
  bob: any,
  viewer: any,
  outsider: any,
  project: any,
  cookies: Record<string, string> = {};
async function request(method: string, url: string, user = 'alice', body?: unknown) {
  const response = await fetch(base + '/api' + url, {
    method,
    headers: {
      Cookie: cookies[user] || '',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, json: await response.json() };
}
const eventually = async (predicate: () => boolean, timeout = 6000) => {
  const end = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > end) throw new Error('Timed out waiting for collaborative convergence');
    await new Promise((r) => setTimeout(r, 25));
  }
};
before(async () => {
  folder = fs.mkdtempSync(path.join(os.tmpdir(), 'papereditor-test-'));
  system = await createApp(
    getConfig({ dataDir: folder, backend: 'disabled', requiredVolume: undefined }),
  );
  alice = system.store.addUser('alice', 'Alice', password, true);
  bob = system.store.addUser('bob', 'Bob', password);
  viewer = system.store.addUser('viewer', 'Viewer', password);
  outsider = system.store.addUser('outsider', 'Outsider', password);
  await system.app.listen({ port: 0, host: '127.0.0.1' });
  base = 'http://127.0.0.1:' + (system.app.server.address() as any).port;
  for (const name of ['alice', 'bob', 'viewer', 'outsider']) {
    const r = await fetch(base + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: name, password }),
    });
    assert.equal(r.status, 200);
    cookies[name] = r.headers.get('set-cookie')!.split(';')[0];
  }
  project = (
    await request('POST', '/projects', 'alice', {
      title: 'Collaboration test',
      template: 'english',
    })
  ).json;
  await request('POST', `/projects/${project.id}/members`, 'alice', {
    username: 'bob',
    role: 'editor',
  });
  await request('POST', `/projects/${project.id}/members`, 'alice', {
    username: 'viewer',
    role: 'viewer',
  });
});
after(async () => {
  await system?.app.close();
  if (folder) fs.rmSync(folder, { recursive: true, force: true });
});
function connect(user: string, id: string) {
  const doc = new Y.Doc();
  class AuthSocket extends WebSocket {
    constructor(url: string) {
      super(url, { headers: { Cookie: cookies[user] } });
    }
  }
  const provider = new WebsocketProvider(base.replace('http:', 'ws:') + '/collab', id, doc, {
    WebSocketPolyfill: AuthSocket as any,
    disableBc: true,
  });
  provider.messageHandlers[4] = () => {};
  return {
    doc,
    provider,
    text: doc.getText('content'),
    close: () => {
      provider.destroy();
      doc.destroy();
    },
  };
}
test('path validation protects imports, Windows paths, and compiler arguments', () => {
  assert.equal(normalizeFilePath('章节/实验方法.tex'), '章节/实验方法.tex');
  for (const bad of [
    '../private.tex',
    '/etc/passwd.tex',
    'C:/secret.tex',
    'a\\b.tex',
    'a/../b.tex',
    'file;whoami.tex',
    '$(id).tex',
    '-flag.tex',
    '.latexmkrc',
    'aux.tex',
    'script.sh',
  ])
    assert.throws(() => normalizeFilePath(bad), bad);
});
test('password hashing uses unique salt and verification', () => {
  const a = hashPassword('one password'),
    b = hashPassword('one password');
  assert.notEqual(a, b);
  assert(verifyPassword('one password', a));
  assert(!verifyPassword('other', a));
});
test('login and project permissions are enforced by HTTP', async () => {
  assert.equal((await request('GET', `/projects/${project.id}`, 'outsider')).status, 403);
  assert.equal(
    (await request('POST', `/projects/${project.id}/files`, 'viewer', { path: 'bad.tex' })).status,
    403,
  );
  assert.equal(
    (await request('POST', '/users', 'bob', { username: 'newuser', displayName: 'New', password }))
      .status,
    403,
  );
  const r = await fetch(base + '/api/projects', {
    method: 'POST',
    headers: {
      Cookie: cookies.alice,
      Origin: 'http://evil.invalid',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title: 'CSRF' }),
  });
  assert.equal(r.status, 403);
});
test('two simultaneous editors converge, persist, and merge disconnected changes', async () => {
  const a = connect('alice', project.mainFileId),
    b = connect('bob', project.mainFileId);
  try {
    await eventually(() => a.provider.synced && b.provider.synced);
    a.text.insert(0, '% Alice concurrent\n');
    b.text.insert(0, '% Bob concurrent\n');
    await eventually(
      () =>
        a.text.toString() === b.text.toString() &&
        a.text.toString().includes('Alice concurrent') &&
        a.text.toString().includes('Bob concurrent'),
    );
    assert.equal(system.store.content(project.mainFileId).toString(), a.text.toString());
    a.provider.disconnect();
    a.text.insert(0, '% Offline edit\n');
    b.text.insert(0, '% Online edit\n');
    a.provider.connect();
    await eventually(() => a.provider.synced && a.text.toString() === b.text.toString());
    assert(a.text.toString().includes('Offline edit'));
    assert(a.text.toString().includes('Online edit'));
    const file = await request('PATCH', `/files/${project.mainFileId}`, 'alice', {
      path: 'renamed.tex',
    });
    assert.equal(file.status, 200);
    a.text.insert(0, '% Renamed but stable\n');
    await eventually(() =>
      system.store.content(project.mainFileId).toString().includes('Renamed but stable'),
    );
  } finally {
    a.close();
    b.close();
  }
});
test('a read-only websocket cannot mutate a document', async () => {
  const c = connect('viewer', project.mainFileId);
  try {
    await eventually(() => c.provider.synced);
    const original = system.store.content(project.mainFileId).toString();
    c.text.insert(0, 'UNAUTHORIZED CHANGE');
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(system.store.content(project.mainFileId).toString(), original);
  } finally {
    c.close();
  }
});
test('snapshots recover a new project and preserve the main file', async () => {
  const created = await request('POST', `/projects/${project.id}/snapshots`, 'alice', {
    name: 'Checkpoint',
  });
  assert.equal(created.status, 200);
  const restored = await request('POST', `/snapshots/${created.json.id}/restore`);
  assert.equal(restored.status, 200);
  assert.notEqual(restored.json.id, project.id);
  assert.equal(system.store.file(restored.json.mainFileId).path, 'renamed.tex');
  assert.equal(
    system.store.content(restored.json.mainFileId).toString(),
    system.store.content(project.mainFileId).toString(),
  );
  assert.equal(
    (await request('POST', `/snapshots/${created.json.id}/restore`, 'outsider')).status,
    403,
  );
});
test('source ZIP exports import cleanly and reject traversal', async () => {
  const exported = await fetch(base + `/api/projects/${project.id}/export`, {
    headers: { Cookie: cookies.alice },
  });
  const data = await exported.arrayBuffer();
  const form = new FormData();
  form.append('file', new Blob([data]), 'roundtrip.zip');
  const r = await fetch(base + '/api/projects/import', {
    method: 'POST',
    headers: { Cookie: cookies.alice },
    body: form,
  });
  assert.equal(r.status, 200);
  const bad = new FormData();
  bad.append(
    'file',
    new Blob([Buffer.from(zipSync({ '../escape.tex': Buffer.from('bad') }))]),
    'bad.zip',
  );
  const result = await fetch(base + '/api/projects/import', {
    method: 'POST',
    headers: { Cookie: cookies.alice },
    body: bad,
  });
  assert.equal(result.status, 400);
});
test('membership revocation closes collaboration access', async () => {
  const c = connect('bob', project.mainFileId);
  try {
    await eventually(() => c.provider.synced);
    await request('DELETE', `/projects/${project.id}/members/${bob.id}`);
    await eventually(() => !c.provider.wsconnected);
    assert.equal((await request('GET', `/projects/${project.id}`, 'bob')).status, 403);
  } finally {
    c.close();
  }
});
test('file diagnostics contain source line and message', () => {
  const result = parseDiagnostics(
    './sections/method.tex:18: Undefined control sequence.\nLaTeX Warning: Reference `x` undefined.',
  );
  assert.equal(result[0].file, 'sections/method.tex');
  assert.equal(result[0].line, 18);
  assert.equal(result[0].severity, 'error');
  assert.equal(result[1].severity, 'warning');
});
