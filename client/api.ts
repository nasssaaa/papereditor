const appRoot = new URL('./', window.location.href);
export const assetUrl = (relative: string) => {
  const url = new URL(relative.replace(/^\//, ''), appRoot);
  return url.pathname + url.search;
};
export const apiUrl = (path: string) => assetUrl('api' + path);
export async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(apiUrl(url), {
    ...options,
    headers: {
      ...(options.body && !(options.body instanceof FormData)
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...options.headers,
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: `请求失败 (${response.status})` }));
    throw new Error(body.error || '请求失败。');
  }
  return response.json();
}
export const post = <T>(url: string, body: unknown = {}) =>
  api<T>(url, { method: 'POST', body: JSON.stringify(body) });
export const patch = <T>(url: string, body: unknown) =>
  api<T>(url, { method: 'PATCH', body: JSON.stringify(body) });
export function websocketUrl(path: string) {
  return `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}${assetUrl(path)}`;
}
