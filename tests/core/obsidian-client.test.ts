import { describe, expect, it, vi } from 'vitest';
import {
  createObsidianClient,
  ObsidianClientError,
} from '../../src/core/obsidian-client';

function response(status: number, body = ''): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: vi.fn(async () => body),
  } as unknown as Response;
}

describe('ObsidianClient', () => {
  it('非法 URL 返回可分类错误', async () => {
    const client = createObsidianClient({ apiUrl: 'not a url', apiKey: 'key' });

    await expect(client.testConnection()).rejects.toMatchObject({
      code: 'invalid-url',
      message: '地址格式错误',
    });
  });

  it('缺少 API Key 不发起请求', async () => {
    const fetchImpl = vi.fn();
    const client = createObsidianClient({
      apiUrl: 'http://127.0.0.1:27123',
      apiKey: '',
      fetchImpl,
    });

    await expect(client.testConnection()).rejects.toMatchObject({ code: 'missing-api-key' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('连接成功返回服务名称并携带 Authorization', async () => {
    const fetchImpl = vi.fn(async () => response(200, '{"service":"Obsidian Local REST API"}'));
    const client = createObsidianClient({
      apiUrl: 'http://127.0.0.1:27123/',
      apiKey: 'secret-key',
      fetchImpl,
    });

    await expect(client.testConnection()).resolves.toEqual({ service: 'Obsidian Local REST API' });
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:27123/',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: 'Bearer secret-key' }),
      }),
    );
  });

  it('401 分类为 API Key 无效且不回显密钥', async () => {
    const fetchImpl = vi.fn(async () => response(401, 'unauthorized'));
    const client = createObsidianClient({
      apiUrl: 'http://127.0.0.1:27123',
      apiKey: 'secret-key',
      fetchImpl,
    });

    const error = await client.testConnection().then(
      () => new Error('expected testConnection to fail'),
      (value: unknown) => value,
    );
    expect(error).toMatchObject({ code: 'unauthorized', status: 401 });
    expect((error as Error).message).not.toContain('secret-key');
  });

  it('网络错误与超时分别分类', async () => {
    const networkClient = createObsidianClient({
      apiUrl: 'http://127.0.0.1:27123',
      apiKey: 'key',
      fetchImpl: vi.fn(async () => { throw new Error('offline'); }),
    });
    await expect(networkClient.testConnection()).rejects.toMatchObject({ code: 'connection' });

    const timeoutClient = createObsidianClient({
      apiUrl: 'http://127.0.0.1:27123',
      apiKey: 'key',
      timeoutMs: 1,
      fetchImpl: vi.fn((_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      })),
    });
    await expect(timeoutClient.testConnection()).rejects.toMatchObject({ code: 'timeout' });
  });

  it('写入成功，正确编码目录和中文文件名', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response(404))
      .mockResolvedValueOnce(response(204));
    const client = createObsidianClient({
      apiUrl: 'http://127.0.0.1:27123',
      apiKey: 'key',
      fetchImpl,
    });

    await expect(client.writeNote({
      path: 'Clippings/Inbox/中文 文件.md',
      markdown: '# 标题',
    })).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'http://127.0.0.1:27123/vault/Clippings/Inbox/%E4%B8%AD%E6%96%87%20%E6%96%87%E4%BB%B6.md',
      expect.objectContaining({ method: 'PUT', body: '# 标题' }),
    );
  });

  it('写入失败返回 HTTP 错误，已存在返回 note-exists', async () => {
    const failedClient = createObsidianClient({
      apiUrl: 'http://127.0.0.1:27123',
      apiKey: 'key',
      fetchImpl: vi.fn()
        .mockResolvedValueOnce(response(404))
        .mockResolvedValueOnce(response(500, 'server error')),
    });
    await expect(failedClient.writeNote({ path: 'Inbox/fail.md', markdown: 'x' }))
      .rejects.toMatchObject({ code: 'http', status: 500 });

    const existingClient = createObsidianClient({
      apiUrl: 'http://127.0.0.1:27123',
      apiKey: 'key',
      fetchImpl: vi.fn(async () => response(200)),
    });
    await expect(existingClient.writeNote({ path: 'Inbox/existing.md', markdown: 'x' }))
      .rejects.toMatchObject({ code: 'note-exists' });
  });

  it('拒绝路径穿越', async () => {
    const client = createObsidianClient({ apiUrl: 'http://127.0.0.1:27123', apiKey: 'key' });
    await expect(client.writeNote({ path: '../secret.md', markdown: 'x' }))
      .rejects.toMatchObject({ code: 'invalid-path' });
  });
});
