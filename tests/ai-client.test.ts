import { afterEach, describe, expect, it, vi } from 'vitest';
import { analyzeContent, testAiConnection } from '../src/analysis/client';
import { buildAnalysisPrompt } from '../src/analysis/prompt';
import type { AnalysisInput, VisualSummary } from '../src/analysis/types';
import type { AiSettings } from '../src/core/ai-settings';

const SETTINGS: AiSettings = {
  enabled: true,
  endpoint: 'https://api.deepseek.com/chat/completions',
  apiKey: 'sk-test',
  model: 'deepseek-chat',
  outputLanguage: 'zh-CN',
  translateBilibiliSubtitles: false,
};

const INPUT: AnalysisInput = {
  platform: 'x',
  contentType: 'x-article',
  title: '两种 AI 开发环境对比',
  author: '作者 (@handle)',
  sourceUrl: 'https://x.com/handle/status/123',
  body: '这是正文内容。',
  truncated: false,
  sourceBlocks: [],
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

  it.each(['deepseek-v4-flash', 'deepseek-v4-pro'] as const)(
    '官方 DeepSeek V4 模型 %s 使用非思考 JSON 模式与充足输出额度',
    async (model) => {
      const fetchMock = vi.fn().mockResolvedValue(okContent(JSON.stringify(VALID)));
      vi.stubGlobal('fetch', fetchMock);
      await analyzeContent(INPUT, { ...SETTINGS, model });

      const [, init] = fetchMock.mock.calls[0]!;
      const body = JSON.parse(init?.body as string);
      expect(body.thinking).toEqual({ type: 'disabled' });
      expect(body.response_format).toEqual({ type: 'json_object' });
      expect(body.max_tokens).toBe(4096);
    },
  );

  it('其他 OpenAI 兼容服务不携带 DeepSeek 专用参数', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okContent(JSON.stringify(VALID)));
    vi.stubGlobal('fetch', fetchMock);
    await analyzeContent(INPUT, {
      ...SETTINGS,
      endpoint: 'https://api.example.com/chat/completions',
      model: 'deepseek-v4-flash',
    });

    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(init?.body as string);
    expect(body).not.toHaveProperty('thinking');
    expect(body).not.toHaveProperty('response_format');
    expect(body.max_tokens).toBe(1400);
  });

  it('DeepSeek V4 连接测试保持轻量文本请求', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okContent('OK'));
    vi.stubGlobal('fetch', fetchMock);
    await testAiConnection({ ...SETTINGS, model: 'deepseek-v4-flash' });

    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(init?.body as string);
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(body).not.toHaveProperty('response_format');
    expect(body.max_tokens).toBe(1400);
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

// ============================================================
// V2：source-linked Visual Summary
// ============================================================

import { analyzeContentV2 } from '../src/analysis/client';
import { buildAnalysisPromptV2 } from '../src/analysis/prompt';
import { validateVisualSummaryAnchors } from '../src/analysis/schema';
import type { AnalysisSourceBlock, VisualSummaryV2 } from '../src/analysis/types';

const V2_INPUT: AnalysisInput = {
  platform: 'x',
  contentType: 'x-article',
  title: '两种 AI 开发环境对比',
  author: '作者 (@handle)',
  sourceUrl: 'https://x.com/handle/status/123',
  body: '[B001]\n这是第一段正文。\n\n[B002]\n第二部分内容。',
  truncated: false,
  sourceBlocks: [
    { id: 'B001', kind: 'paragraph', text: '这是第一段正文。' },
    { id: 'B002', kind: 'heading', text: '第二部分内容。' },
  ],
};

const V2_VALID: VisualSummaryV2 = {
  schemaVersion: 2,
  summary: ['这是第一句总结。', '这是第二句总结。'],
  keyPoints: [
    { title: '完成度', description: 'DeepSeek Harness 完成度更高。' },
    { title: '成本', description: 'DeepSeek Harness 调用成本更低。' },
  ],
  structure: [
    { title: '引言', sourceBlockId: 'B001', sourceQuote: '这是第一段正文。' },
    { title: '第二章', sourceBlockId: 'B002', sourceQuote: '第二部分内容。' },
  ],
};

describe('buildAnalysisPromptV2', () => {
  it('system 强制 schemaVersion 2 与引用锚点规则', () => {
    const { system } = buildAnalysisPromptV2(V2_INPUT);
    expect(system).toContain('schemaVersion');
    expect(system).toContain('sourceBlockId');
    expect(system).toContain('sourceQuote');
    expect(system).toContain('合法 JSON');
  });

  it('user prompt 携带正文（含 [Bxxx] 块标记）', () => {
    const { user } = buildAnalysisPromptV2(V2_INPUT);
    expect(user).toContain('[B001]');
    expect(user).toContain('这是第一段正文。');
  });
});

describe('analyzeContentV2 成功路径', () => {
  it('200 合法 V2 JSON 且 anchor 匹配时返回', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okContent(JSON.stringify(V2_VALID))));
    const result = await analyzeContentV2(V2_INPUT, SETTINGS);
    expect(result).toEqual(V2_VALID);
  });

  it('anchor 校验失败时触发一次 repair 后成功', async () => {
    const badAnchor = {
      ...V2_VALID,
      structure: [{ title: 'x', sourceBlockId: 'B999', sourceQuote: '不存在' }],
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(okContent(JSON.stringify(badAnchor)))
      .mockResolvedValueOnce(okContent(JSON.stringify(V2_VALID)));
    vi.stubGlobal('fetch', fetchMock);
    const result = await analyzeContentV2(V2_INPUT, SETTINGS);
    expect(result).toEqual(V2_VALID);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('DeepSeek V4 的 V2 首次与 repair 请求都使用 JSON 模式和 4096 输出额度', async () => {
    const badAnchor = {
      ...V2_VALID,
      structure: [{ title: 'x', sourceBlockId: 'B999', sourceQuote: '不存在' }],
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(okContent(JSON.stringify(badAnchor)))
      .mockResolvedValueOnce(okContent(JSON.stringify(V2_VALID)));
    vi.stubGlobal('fetch', fetchMock);

    await analyzeContentV2(V2_INPUT, { ...SETTINGS, model: 'deepseek-v4-flash' });

    const bodies = fetchMock.mock.calls.map(([, init]) => JSON.parse(init?.body as string));
    expect(bodies).toHaveLength(2);
    for (const body of bodies) {
      expect(body.response_format).toEqual({ type: 'json_object' });
      expect(body.max_tokens).toBe(4096);
    }
  });

  it('repair 请求携带具体错误列表与上次输出', async () => {
    const badAnchor = {
      ...V2_VALID,
      structure: [{ title: 'x', sourceBlockId: 'B999', sourceQuote: '不存在' }],
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(okContent(JSON.stringify(badAnchor)))
      .mockResolvedValueOnce(okContent(JSON.stringify(V2_VALID)));
    vi.stubGlobal('fetch', fetchMock);
    await analyzeContentV2(V2_INPUT, SETTINGS);
    const repairBody = JSON.parse(fetchMock.mock.calls[1]![1]!.body as string);
    expect(repairBody.messages[0].content).toContain('B999');
    expect(repairBody.messages[0].content).toContain('不存在');
  });

  it('初次与 repair 均校验失败时，第三次 fresh generation 成功', async () => {
    const firstBadAnchor = {
      ...V2_VALID,
      structure: [{ title: 'x', sourceBlockId: 'B999', sourceQuote: '不存在' }],
    };
    const repairedBadAnchor = {
      ...V2_VALID,
      structure: [{ title: 'x', sourceBlockId: 'B001', sourceQuote: '仍然不存在' }],
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(okContent(JSON.stringify(firstBadAnchor)))
      .mockResolvedValueOnce(okContent(JSON.stringify(repairedBadAnchor)))
      .mockResolvedValueOnce(okContent(JSON.stringify(V2_VALID)));
    vi.stubGlobal('fetch', fetchMock);
    const result = await analyzeContentV2(V2_INPUT, SETTINGS);

    expect(result).toEqual(V2_VALID);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('精确诊断不会原样展示模型生成的超长 sourceBlockId', async () => {
    const untrustedBlockId = `B${'9'.repeat(1000)}`;
    const badAnchor = {
      ...V2_VALID,
      structure: [{ title: 'x', sourceBlockId: untrustedBlockId, sourceQuote: '不存在' }],
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okContent(JSON.stringify(badAnchor))));

    const error = await analyzeContentV2(V2_INPUT, SETTINGS).then(
      () => null,
      (reason: unknown) => reason,
    );

    expect((error as Error).message).toContain('structure[0].sourceBlockId not present in sent blocks');
    expect((error as Error).message).not.toContain(untrustedBlockId);
    expect((error as Error).message.length).toBeLessThan(1000);
  });

  it('单条精确诊断截断后严格不超过 240 个字符', async () => {
    const longKnownBlockId = `B${'8'.repeat(300)}`;
    const input = {
      ...V2_INPUT,
      body: `[${longKnownBlockId}]\n真实原文`,
      sourceBlocks: [{ id: longKnownBlockId, kind: 'paragraph' as const, text: '真实原文' }],
    };
    const badQuote = {
      ...V2_VALID,
      structure: [{ title: 'x', sourceBlockId: longKnownBlockId, sourceQuote: '不存在' }],
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okContent(JSON.stringify(badQuote))));

    const error = await analyzeContentV2(input, SETTINGS).then(
      () => null,
      (reason: unknown) => reason,
    );
    const message = (error as Error).message;
    const firstDiagnostic = message.match(/首次校验：(.*?)。自动修复后：/)?.[1] ?? '';

    expect(firstDiagnostic.endsWith('…')).toBe(true);
    expect(Array.from(firstDiagnostic)).toHaveLength(240);
  });

  it('初次输出 Quote 轻微差异时本地恢复成功，仅一次请求', async () => {
    const slightlyOff = {
      ...V2_VALID,
      structure: [
        { title: '引言', sourceBlockId: 'B001', sourceQuote: '这是第一段 正文。' },
        { title: '第二章', sourceBlockId: 'B002', sourceQuote: '第二部分内容。' },
      ],
    };
    const fetchMock = vi.fn().mockResolvedValue(okContent(JSON.stringify(slightlyOff)));
    vi.stubGlobal('fetch', fetchMock);

    const result = await analyzeContentV2(V2_INPUT, SETTINGS);

    expect(result).toEqual(V2_VALID);
    expect(result.structure[0]?.sourceQuote).toBe('这是第一段正文。');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(validateVisualSummaryAnchors(result, V2_INPUT)).toEqual([]);
  });

  it('repair 输出可被本地恢复时不发起第三次请求', async () => {
    const firstBadAnchor = {
      ...V2_VALID,
      structure: [{ title: 'x', sourceBlockId: 'B999', sourceQuote: '不存在' }],
    };
    const repairRecoverable = {
      ...V2_VALID,
      structure: [
        { title: '引言', sourceBlockId: 'B001', sourceQuote: '这是第一段 正文。' },
        { title: '第二章', sourceBlockId: 'B002', sourceQuote: '第二部分内容。' },
      ],
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(okContent(JSON.stringify(firstBadAnchor)))
      .mockResolvedValueOnce(okContent(JSON.stringify(repairRecoverable)));
    vi.stubGlobal('fetch', fetchMock);

    const result = await analyzeContentV2(V2_INPUT, SETTINGS);

    expect(result).toEqual(V2_VALID);
    expect(result.structure[0]?.sourceQuote).toBe('这是第一段正文。');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('fresh 输出也经过本地恢复后再进入严格校验', async () => {
    const firstBadAnchor = {
      ...V2_VALID,
      structure: [{ title: 'x', sourceBlockId: 'B999', sourceQuote: '不存在' }],
    };
    const repairedBadAnchor = {
      ...V2_VALID,
      structure: [{ title: 'x', sourceBlockId: 'B998', sourceQuote: '仍然不存在' }],
    };
    const freshRecoverable = {
      ...V2_VALID,
      structure: [
        { title: '引言', sourceBlockId: 'B001', sourceQuote: '这是第一段 正文。' },
        { title: '第二章', sourceBlockId: 'B002', sourceQuote: '第二部分内容。' },
      ],
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(okContent(JSON.stringify(firstBadAnchor)))
      .mockResolvedValueOnce(okContent(JSON.stringify(repairedBadAnchor)))
      .mockResolvedValueOnce(okContent(JSON.stringify(freshRecoverable)));
    vi.stubGlobal('fetch', fetchMock);

    const result = await analyzeContentV2(V2_INPUT, SETTINGS);

    expect(result).toEqual(V2_VALID);
    expect(result.structure[0]?.sourceQuote).toBe('这是第一段正文。');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('第三次请求是全新原始 prompt，不携带旧输出或 repair 错误', async () => {
    const firstBadAnchor = {
      ...V2_VALID,
      structure: [{ title: 'x', sourceBlockId: 'B999', sourceQuote: '不存在' }],
    };
    const repairedBadAnchor = {
      ...V2_VALID,
      structure: [{ title: 'x', sourceBlockId: 'B001', sourceQuote: '仍然不存在' }],
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(okContent(JSON.stringify(firstBadAnchor)))
      .mockResolvedValueOnce(okContent(JSON.stringify(repairedBadAnchor)))
      .mockResolvedValueOnce(okContent(JSON.stringify(V2_VALID)));
    vi.stubGlobal('fetch', fetchMock);

    await analyzeContentV2(V2_INPUT, { ...SETTINGS, model: 'deepseek-v4-flash' });

    const bodies = fetchMock.mock.calls.map(([, init]) => JSON.parse(init?.body as string));
    expect(bodies).toHaveLength(3);
    expect(bodies[2]!.messages).toEqual(bodies[0]!.messages);
    expect(bodies[2]!.messages[0]!.content).not.toContain('你上次的输出');
    expect(bodies[2]!.messages[0]!.content).not.toContain('具体错误如下');
    for (const body of bodies) {
      expect(body.response_format).toEqual({ type: 'json_object' });
      expect(body.max_tokens).toBe(4096);
    }
    expect(JSON.stringify(bodies[1]!.messages)).toContain('你上次的输出');
  });

  it('三阶段全部校验失败才返回带三段诊断的最终错误', async () => {
    const firstBadAnchor = {
      ...V2_VALID,
      structure: [{ title: 'x', sourceBlockId: 'B999', sourceQuote: '不存在' }],
    };
    const repairedBadAnchor = {
      ...V2_VALID,
      structure: [{ title: 'x', sourceBlockId: 'B001', sourceQuote: '仍然不存在' }],
    };
    const freshBadAnchor = {
      ...V2_VALID,
      structure: [{ title: 'x', sourceBlockId: 'B001', sourceQuote: '完全不同的错误引用' }],
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(okContent(JSON.stringify(firstBadAnchor)))
      .mockResolvedValueOnce(okContent(JSON.stringify(repairedBadAnchor)))
      .mockResolvedValueOnce(okContent(JSON.stringify(freshBadAnchor)));
    vi.stubGlobal('fetch', fetchMock);

    const error = await analyzeContentV2(V2_INPUT, SETTINGS).then(
      () => null,
      (reason: unknown) => reason,
    );

    expect(error).toMatchObject({ code: 'AI_INVALID_RESPONSE' });
    expect((error as Error).message).toContain('首次校验');
    expect((error as Error).message).toContain('自动修复后');
    expect((error as Error).message).toContain('全新生成后');
    expect((error as Error).message).toContain('请重新生成');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('初次 401 只请求一次并直接返回 AI_AUTH_FAILED', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: 'x' }, 401));
    vi.stubGlobal('fetch', fetchMock);
    await expect(analyzeContentV2(V2_INPUT, SETTINGS)).rejects.toMatchObject({ code: 'AI_AUTH_FAILED' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('初次 429 只请求一次并直接返回 AI_RATE_LIMITED', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: 'x' }, 429));
    vi.stubGlobal('fetch', fetchMock);
    await expect(analyzeContentV2(V2_INPUT, SETTINGS)).rejects.toMatchObject({ code: 'AI_RATE_LIMITED' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('repair 阶段网络失败直接传播，不进入 fresh', async () => {
    const firstBadAnchor = {
      ...V2_VALID,
      structure: [{ title: 'x', sourceBlockId: 'B999', sourceQuote: '不存在' }],
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(okContent(JSON.stringify(firstBadAnchor)))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(analyzeContentV2(V2_INPUT, SETTINGS)).rejects.toMatchObject({ code: 'AI_NETWORK_ERROR' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('fresh 阶段 5xx 直接返回 AI_PROVIDER_ERROR，总计恰好 3 次请求', async () => {
    const firstBadAnchor = {
      ...V2_VALID,
      structure: [{ title: 'x', sourceBlockId: 'B999', sourceQuote: '不存在' }],
    };
    const repairedBadAnchor = {
      ...V2_VALID,
      structure: [{ title: 'x', sourceBlockId: 'B001', sourceQuote: '仍然不存在' }],
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(okContent(JSON.stringify(firstBadAnchor)))
      .mockResolvedValueOnce(okContent(JSON.stringify(repairedBadAnchor)))
      .mockResolvedValueOnce(jsonResponse({ error: 'x' }, 503));
    vi.stubGlobal('fetch', fetchMock);

    await expect(analyzeContentV2(V2_INPUT, SETTINGS)).rejects.toMatchObject({ code: 'AI_PROVIDER_ERROR' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('三阶段共享同一 30 秒 AbortController 总预算，不扩展为每阶段 30 秒', async () => {
    vi.useFakeTimers();
    const firstBadAnchor = {
      ...V2_VALID,
      structure: [{ title: 'x', sourceBlockId: 'B999', sourceQuote: '不存在' }],
    };
    const signals: AbortSignal[] = [];
    const fetchMock = vi.fn((_url: string, init?: { signal?: AbortSignal }) => {
      if (init?.signal) signals.push(init.signal);
      if (signals.length === 1) {
        return Promise.resolve(okContent(JSON.stringify(firstBadAnchor)));
      }
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const promise = analyzeContentV2(V2_INPUT, SETTINGS);
    const assertion = expect(promise).rejects.toMatchObject({ code: 'AI_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(30_000 + 50);

    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(signals).toHaveLength(2);
    expect(signals[0]).toBe(signals[1]);
    expect(signals[0]!.aborted).toBe(true);
  });
});
