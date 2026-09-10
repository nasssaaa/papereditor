import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
export interface Config {
  dataDir: string;
  host: string;
  port: number;
  backend: 'native' | 'docker' | 'macos-sandbox' | 'disabled';
  latexmk: string;
  synctex: string;
  docker: string;
  texliveDir: string;
  extraPath: string;
  timeoutMs: number;
  concurrency: number;
  secureCookie: boolean;
  requiredVolume?: string;
}
export function getConfig(overrides: Partial<Config> = {}): Config {
  const c: Config = {
    dataDir: path.resolve(process.env.DATA_DIR || '.data'),
    host: process.env.HOST || '127.0.0.1',
    port: Number(process.env.PORT || 18080),
    backend: (process.env.COMPILE_BACKEND || 'native') as Config['backend'],
    latexmk: process.env.LATEXMK_BIN || 'latexmk',
    synctex: process.env.SYNCTEX_BIN || 'synctex',
    docker: process.env.DOCKER_BIN || 'docker',
    texliveDir: process.env.TEXLIVE_DIR || '',
    extraPath:
      process.env.TEX_EXTRA_PATH ||
      (process.platform === 'win32' &&
      fs.existsSync(path.resolve('.local/strawberry/perl/bin/perl.exe'))
        ? path.resolve('.local/strawberry/perl/bin')
        : ''),
    timeoutMs: Number(process.env.COMPILE_TIMEOUT_MS || 120000),
    concurrency: Number(process.env.COMPILE_CONCURRENCY || 1),
    secureCookie: process.env.COOKIE_SECURE === 'true',
    requiredVolume: process.env.REQUIRED_VOLUME,
    ...overrides,
  };
  if (!['native', 'docker', 'macos-sandbox', 'disabled'].includes(c.backend))
    throw new Error('Unknown compile backend');
  assertStorage(c);
  return c;
}
export function assertStorage(c: Config) {
  if (
    c.requiredVolume &&
    (!fs.existsSync(c.requiredVolume) ||
      !fs.statSync(c.requiredVolume).isDirectory() ||
      fs.statSync(c.requiredVolume).dev === fs.statSync(path.dirname(c.requiredVolume)).dev)
  ) {
    throw new Error('论文数据盘未挂载，已暂停写入。');
  }
}
