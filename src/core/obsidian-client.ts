/**
 * Obsidian Local REST API 客户端。
 * 所有请求集中在这里，调用方不直接接触 fetch 或 API Key。
 */

import type { ObsidianSettings } from './obsidian-settings';

export type ObsidianErrorCode =
  | 'invalid-url'
  | 'missing-api-key'
  | 'unauthorized'
  | 'connection'
  | 'timeout'
  | 'http'
  | 'invalid-path'
  | 'note-exists';

export class ObsidianClientError extends Error {
  constructor(
    public readonly code: ObsidianErrorCode,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'ObsidianClientError';
  }
}

export interface ObsidianTestResult {
  service: string;
}

export interface ObsidianClient {
  testConnection(): Promise<ObsidianTestResult>;
  writeNote(args: { path: string; markdown: string; overwrite?: boolean }): Promise<void>;
}

export interface ObsidianClientOptions {
  apiUrl: string;
  apiKey: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 5000;

export function createObsidianClient(settings: Pick<ObsidianSettings, 'apiUrl' | 'apiKey'> | ObsidianClientOptions): ObsidianClient {
  const options = settings as ObsidianClientOptions;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  function baseUrl(): string {
    const value = typeof options.apiUrl === 'string' ? options.apiUrl.trim().replace(/\/+$/, '') : '';
    if (!value) throw new ObsidianClientError('invalid-url', '地址格式错误');
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new ObsidianClientError('invalid-url', '地址格式错误');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new ObsidianClientError('invalid-url', '地址格式错误');
    }
    return value;
  }

  function apiKey(): string {
    const value = typeof options.apiKey === 'string' ? options.apiKey.trim() : '';
    if (!value) throw new ObsidianClientError('missing-api-key', '请先填写 API Key');
    return value;
  }

  function headers(extra: Record<string, string> = {}): Record<string, string> {
    return { Authorization: `Bearer ${apiKey()}`, ...extra };
  }

  function endpoint(path: string): string {
    const segments = path.split('/');
    if (!path || segments.some((segment) => !segment || segment === '.' || segment === '..')) {
      throw new ObsidianClientError('invalid-path', '笔记路径格式错误');
    }
    return `${baseUrl()}/vault/${segments.map((segment) => encodeURIComponent(segment)).join('/')}`;
  }

  async function request(input: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchImpl(input, { ...init, signal: controller.signal });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new ObsidianClientError('timeout', '请求超时');
      }
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ObsidianClientError('timeout', '请求超时');
      }
      throw new ObsidianClientError('connection', '无法连接 Obsidian');
    } finally {
      clearTimeout(timer);
    }
  }

  async function readDetail(response: Response): Promise<string> {
    const text = await response.text().catch(() => '');
    return text ? `：${text.slice(0, 120)}` : '';
  }

  function throwForStatus(response: Response, detail = ''): void {
    if (response.status === 401 || response.status === 403) {
      throw new ObsidianClientError('unauthorized', 'API Key 无效', response.status);
    }
    if (!response.ok) {
      throw new ObsidianClientError('http', `请求失败（HTTP ${response.status}）${detail}`, response.status);
    }
  }

  async function testConnection(): Promise<ObsidianTestResult> {
    const response = await request(`${baseUrl()}/`, {
      method: 'GET',
      headers: headers({ Accept: 'application/json, text/plain, */*' }),
      cache: 'no-store',
    });
    const body = await response.text().catch(() => '');
    throwForStatus(response, body ? `：${body.slice(0, 120)}` : '');

    let data: { service?: string } = {};
    try {
      data = body ? (JSON.parse(body) as { service?: string }) : {};
    } catch {
      // Some compatible servers return an empty/non-JSON success body.
    }
    return { service: data.service || 'Obsidian Local REST API' };
  }

  async function noteExists(url: string): Promise<boolean> {
    const response = await request(url, {
      method: 'GET',
      headers: headers({ Accept: 'text/markdown, text/plain, application/json, */*' }),
      cache: 'no-store',
    });
    if (response.status === 404) return false;
    throwForStatus(response, await readDetail(response));
    return true;
  }

  async function writeNote(args: { path: string; markdown: string; overwrite?: boolean }): Promise<void> {
    const url = endpoint(args.path);
    if (args.overwrite !== true && await noteExists(url)) {
      throw new ObsidianClientError('note-exists', `笔记已存在：${args.path}`);
    }

    const response = await request(url, {
      method: 'PUT',
      headers: headers({ 'Content-Type': 'text/markdown; charset=utf-8' }),
      body: args.markdown,
    });
    throwForStatus(response, await readDetail(response));
  }

  return { testConnection, writeNote };
}
