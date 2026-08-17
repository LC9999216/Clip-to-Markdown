/**
 * Obsidian Local REST API 集成。
 * 通过 PUT /vault/{path} 写入笔记；可选 exists 预检避免无感覆盖。
 * 仅在 background（service worker）运行，可跨域 fetch 127.0.0.1。
 */

import { loadSettings, sanitizeSubfolder } from '../core/settings';

interface ObsidianWriteArgs {
  markdown: string;
  filename: string;
  /** true 时跳过「已存在」拦截直接覆盖 */
  overwrite?: boolean;
}

/** 把 noteFolder + filename 编码为 Local REST API 的 /vault/{path} */
function encodeVaultPath(segments: string[]): string {
  return segments
    .filter((s) => s !== '')
    .map((s) => encodeURIComponent(s))
    .join('/');
}

function authHeaders(apiKey: string, extra: Record<string, string> = {}): Record<string, string> {
  return { Authorization: `Bearer ${apiKey}`, ...extra };
}

async function readErrorDetail(resp: Response): Promise<string> {
  const text = await resp.text().catch(() => '');
  return text ? ` ${text.slice(0, 200)}` : '';
}

/** 保存笔记到 Obsidian。返回最终写入的 vault 相对路径。已存在且未 overwrite 时抛带 exists 标记的错。 */
export async function saveToObsidian(args: ObsidianWriteArgs): Promise<string> {
  const settings = await loadSettings();
  const baseUrl = settings.obsidian.apiUrl;
  const apiKey = settings.obsidian.apiKey;
  if (!baseUrl) {
    throw new Error('请先在设置中填写 Obsidian Local REST API 地址。');
  }
  if (!apiKey) {
    throw new Error('请先在设置中填写 Obsidian Local REST API 的 API Key。');
  }

  const folder = sanitizeSubfolder(settings.obsidian.noteDirectory);
  const segments = [...(folder ? folder.split('/') : []), args.filename];
  const filepath = segments.join('/');
  const endpoint = `${baseUrl}/vault/${encodeVaultPath(segments)}`;

  if (args.overwrite !== true) {
    const exists = await noteExists(endpoint, apiKey);
    if (exists) {
      const err = new Error(`笔记已存在：${filepath}`) as Error & { exists?: boolean };
      err.exists = true;
      throw err;
    }
  }

  let resp: Response;
  try {
    resp = await fetch(endpoint, {
      method: 'PUT',
      headers: authHeaders(apiKey, { 'Content-Type': 'text/markdown; charset=utf-8' }),
      body: args.markdown,
    });
  } catch (e) {
    throw new Error(`无法连接 Local REST API：${(e as Error)?.message ?? String(e)}`);
  }

  if (!resp.ok) {
    throw new Error(`写入失败：HTTP ${resp.status}${await readErrorDetail(resp)}`);
  }
  return filepath;
}

/** 预检笔记是否存在（404 视为不存在）。 */
async function noteExists(endpoint: string, apiKey: string): Promise<boolean> {
  let resp: Response;
  try {
    resp = await fetch(endpoint, {
      method: 'GET',
      headers: authHeaders(apiKey, { Accept: 'text/markdown, text/plain, application/json, */*' }),
      cache: 'no-store',
    });
  } catch {
    throw new Error('无法连接 Local REST API，请确认 Obsidian 与插件已启动。');
  }
  if (resp.status === 404) return false;
  if (!resp.ok) {
    throw new Error(`检查笔记失败：HTTP ${resp.status}${await readErrorDetail(resp)}`);
  }
  return true;
}

/** 测试连接：GET baseUrl/，验证 API Key 有效性。 */
export async function testObsidian(): Promise<string> {
  const settings = await loadSettings();
  const baseUrl = settings.obsidian.apiUrl;
  const apiKey = settings.obsidian.apiKey;
  if (!baseUrl) {
    throw new Error('请先填写 Local REST API 地址。');
  }
  if (!apiKey) {
    throw new Error('请先填写 API Key。');
  }

  let resp: Response;
  try {
    resp = await fetch(`${baseUrl}/`, {
      method: 'GET',
      headers: authHeaders(apiKey, { Accept: 'application/json, text/plain, */*' }),
      cache: 'no-store',
    });
  } catch {
    throw new Error('无法连接 Local REST API。请检查地址、HTTP/HTTPS 模式与 Obsidian 插件是否已启用 HTTP 服务。');
  }

  const bodyText = await resp.text().catch(() => '');
  let data: { authenticated?: boolean; service?: string } | null = null;
  try {
    data = bodyText ? (JSON.parse(bodyText) as { authenticated?: boolean; service?: string }) : null;
  } catch {
    data = null;
  }

  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}${bodyText ? ` ${bodyText.slice(0, 200)}` : ''}`);
  }
  if (data && data.authenticated === false) {
    throw new Error('API Key 无效或未授权。');
  }
  return typeof data?.service === 'string' && data.service ? data.service : 'Obsidian Local REST API';
}
