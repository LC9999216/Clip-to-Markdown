import { afterEach, describe, expect, it, vi } from 'vitest';
import { analyzeContent } from '../src/analysis/client';
import { buildAnalysisPrompt } from '../src/analysis/prompt';
import type { AnalysisInput, VisualSummary } from '../src/analysis/types';
import type { AiSettings } from '../src/core/ai-settings';

const SETTINGS: AiSettings = {
  enabled: true,
  endpoint: 'https://api.deepseek.com/chat/completions',
  apiKey: 'sk-test',
  model: 'deepseek-chat',
  outputLanguage: 'zh-CN',
};

const INPUT: AnalysisInput = {
  platform: 'x',
  contentType: 'x-article',
  title: '两种 AI 开发环境对比',
  author: '作者 (@handle)',
  sourceUrl: 'https://x.com/handle/status/123',
  body: '这是正文内容。',
  truncated: false,
};

const VALID: VisualSummary = {
  schemaVersion: 1,
  articleType: 'comparison',
  confidence: 0.93,
  classificationReason: '文章主要比较两个 AI 工具在功能、成本和使用体验方面的差异。',
  summary: '文章比较了两种 AI 开发环境。',
  keyPoints: [
    { title: '完成度', description: 'DeepSeek Harness 完成度更高。' },
    { title: '成本', description: 'DeepSeek Harness 调用成本更低。' },
  ],
  structure: { label: '对比', children: [{ label: 'DeepSeek Harness' }, { label: 'Claude Code' }] },
  takeaways: ['看重成本选 DeepSeek Harness。'],
};

function jsonResponse(payload: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => payload } as unknown as Response;
}

function okContent(content: string): Response {
  return jsonResponse({ choices: [{ message: { content } }] });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('buildAnalysisPrompt', () => {
  it('system 约束文章分析角色、简体中文与纯 JSON 输出', () => {
    const { system } = buildAnalysisPrompt(INPUT);
    expect(system).toContain('Clip2MD');
    expect(system).toContain('简体中文');
    expect(system).toContain('合法 JSON');
    expect(system).toContain('禁止 Markdown');
  });

  it('user prompt 携带平台、类型、标题、作者、来源与正文', () => {
    const { user } = buildAnalysisPrompt(INPUT);
    expect(user).toContain('平台：x');
    expect(user).toContain('类型：x-article');
    expect(user).toContain('标题：两种 AI 开发环境对比');
    expect(user).toContain('作者：作者 (@handle)');
    expect(user).toContain('来源：https://x.com/handle/status/123');
    expect(user).toContain('这是正文内容。');
  });

  it('truncated 时提示 AI 不要假装看到省略内容', () => {
    const { user } = buildAnalysisPrompt({ ...INPUT, truncated: true });
    expect(user).toContain('省略');
  });
});

describe('analyzeContent 成功路径', () => {
  it('200 合法 JSON 返回 VisualSummary', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okContent(JSON.stringify(VALID))));
    const result = await analyzeContent(INPUT, SETTINGS);
    expect(result).toEqual(VALID);
  });

  it('请求携带 Bearer、model、temperature 0.2、max_tokens 1400 与双消息', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okContent(JSON.stringify(VALID)));
    vi.stubGlobal('fetch', fetchMock);
    await analyzeContent(INPUT, SETTINGS);

    const [, init] = fetchMock.mock.calls[0]!;
    expect(init?.headers).toMatchObject({
      'Content-Type': 'application/json',
      Authorization: 'Bearer sk-test',
    });
    const body = JSON.parse(init?.body as string);
    expect(body.model).toBe('deepseek-chat');
    expect(body.temperature).toBe(0.2);
    expect(body.max_tokens).toBe(1400);
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[1].role).toBe('user');
  });

  it('兼容 ```json 代码块围栏', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okContent(`\`\`\`json\n${JSON.stringify(VALID)}\n\`\`\``)));
    const result = await analyzeContent(INPUT, SETTINGS);
    expect(result).toEqual(VALID);
  });
});

describe('analyzeContent 错误映射', () => {
  it.each([
    [401, 'AI_AUTH_FAILED'],
    [403, 'AI_AUTH_FAILED'],
    [404, 'AI_ENDPOINT_OR_MODEL_NOT_FOUND'],
    [429, 'AI_RATE_LIMITED'],
    [500, 'AI_PROVIDER_ERROR'],
    [503, 'AI_PROVIDER_ERROR'],
  ])('HTTP %s → %s', async (status, code) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'x' }, status)));
    await expect(analyzeContent(INPUT, SETTINGS)).rejects.toMatchObject({ code });
  });

  it('请求中止（AbortError）→ AI_TIMEOUT', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError')));
    await expect(analyzeContent(INPUT, SETTINGS)).rejects.toMatchObject({ code: 'AI_TIMEOUT' });
  });

  it('网络失败（TypeError）→ AI_NETWORK_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(analyzeContent(INPUT, SETTINGS)).rejects.toMatchObject({ code: 'AI_NETWORK_ERROR' });
  });

  it('30 秒超时后中止并返回 AI_TIMEOUT', async () => {
    vi.useFakeTimers();
    let capturedSignal: AbortSignal | undefined;
    const fetchMock = vi.fn((_url: string, init?: { signal?: AbortSignal }) => {
      capturedSignal = init?.signal;
      return new Promise((_resolve, reject) => {
        capturedSignal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const promise = analyzeContent(INPUT, SETTINGS);
    // 先挂 rejection 断言，再推进时钟，避免 unhandled rejection
    const assertion = expect(promise).rejects.toMatchObject({ code: 'AI_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(30_000 + 50);

    await assertion;
    expect(capturedSignal?.aborted).toBe(true);
  });

  it('无 choices 或内容为空 → AI_INVALID_RESPONSE', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ choices: [] })));
    await expect(analyzeContent(INPUT, SETTINGS)).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' });
    vi.unstubAllGlobals();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ choices: [{ message: { content: '' } }] })));
    await expect(analyzeContent(INPUT, SETTINGS)).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' });
  });
});

describe('analyzeContent 一次 repair', () => {
  it('非法 JSON 时自动 repair 一次并成功', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(okContent('这不是 JSON {'))
      .mockResolvedValueOnce(okContent(JSON.stringify(VALID)));
    vi.stubGlobal('fetch', fetchMock);
    const result = await analyzeContent(INPUT, SETTINGS);
    expect(result).toEqual(VALID);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('Schema 校验失败时自动 repair 一次并成功', async () => {
    const badShape = { ...VALID, articleType: 'unknown-type' };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(okContent(JSON.stringify(badShape)))
      .mockResolvedValueOnce(okContent(JSON.stringify(VALID)));
    vi.stubGlobal('fetch', fetchMock);
    const result = await analyzeContent(INPUT, SETTINGS);
    expect(result).toEqual(VALID);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('repair 也失败时返回 AI_INVALID_RESPONSE，且最多两次请求', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okContent('仍然坏 {'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(analyzeContent(INPUT, SETTINGS)).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('repair 请求的 system 提示要求修复格式', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(okContent('坏 {'))
      .mockResolvedValueOnce(okContent(JSON.stringify(VALID)));
    vi.stubGlobal('fetch', fetchMock);
    await analyzeContent(INPUT, SETTINGS);
    const repairBody = JSON.parse(fetchMock.mock.calls[1]![1]!.body as string);
    expect(repairBody.messages[0].content).toContain('修复');
  });
});
