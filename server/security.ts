import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import path from 'node:path';
export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}
export function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
export function verifyPassword(password: string, hash: string) {
  const [salt, digest] = hash.split(':');
  if (!salt || !digest) return false;
  const expected = Buffer.from(digest, 'hex');
  const actual = scryptSync(password, salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
export function tokenHash(token: string) {
  return createHash('sha256').update(token).digest('hex');
}
const textExtensions = new Set([
  '.tex',
  '.bib',
  '.sty',
  '.cls',
  '.bst',
  '.bbx',
  '.cbx',
  '.cfg',
  '.def',
  '.clo',
  '.fd',
  '.txt',
  '.md',
  '.csv',
  '.tsv',
  '.ist',
  '.glsdefs',
]);
const binaryExtensions = new Set(['.png', '.jpg', '.jpeg', '.pdf', '.eps']);
export function normalizeFilePath(input: string): string {
  const name = input.normalize('NFC');
  if (
    !name ||
    name.length > 240 ||
    /[^\p{L}\p{N}\p{M} _./-]/u.test(name) ||
    name.startsWith('/') ||
    name
      .split('/')
      .some(
        (p) =>
          !p ||
          p.startsWith('.') ||
          p.startsWith('-') ||
          /[. ]$/.test(p) ||
          /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(p),
      )
  )
    throw new HttpError(
      400,
      '文件路径无效；请使用字母、数字、中文、空格、下划线和项目内的相对路径。',
    );
  if (
    !textExtensions.has(path.posix.extname(name).toLowerCase()) &&
    !binaryExtensions.has(path.posix.extname(name).toLowerCase())
  )
    throw new HttpError(400, '不支持此文件类型。');
  return name;
}
export function fileKind(name: string): 'text' | 'binary' {
  return textExtensions.has(path.posix.extname(name).toLowerCase()) ? 'text' : 'binary';
}
export function safeJoin(root: string, name: string) {
  const full = path.resolve(root, name);
  if (!full.startsWith(path.resolve(root) + path.sep))
    throw new HttpError(400, '文件路径超出项目范围。');
  return full;
}
export function assertSize(size: number, max = 20 * 1024 * 1024) {
  if (size > max) throw new HttpError(413, '文件过大；单文件上限 20 MB。');
}
