import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { createApp } from './app.js';
const system = await createApp();
if (!(system.store.db.prepare('SELECT count(*) AS n FROM users').get() as { n: number }).n) {
  const password = randomBytes(18).toString('base64url');
  const user = system.store.addUser('admin', '管理员', password, true);
  system.store.createProject(user.id, '我的第一篇论文', 'chinese');
  system.store.createProject(user.id, 'English Research Paper', 'english');
  fs.writeFileSync(
    path.join(system.config.dataDir, 'bootstrap-admin.json'),
    JSON.stringify({ username: 'admin', password }, null, 2),
    { mode: 0o600 },
  );
  console.log('Initial administrator credentials written to the private data directory.');
}
await system.app.listen({ port: system.config.port, host: system.config.host });
console.log(`Paper Editor listening at http://${system.config.host}:${system.config.port}`);
let closing = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, async () => {
    if (closing) return;
    closing = true;
    await system.app.close();
    process.exit(0);
  });
