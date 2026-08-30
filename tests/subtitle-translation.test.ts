import { describe, expect, it, vi } from 'vitest';
import {
  MAX_TRANSLATION_BATCH_CHARS,
  MAX_TRANSLATION_BATCH_LINES,
  translateBilibiliSubtitleLines,
} from '../src/analysis/subtitle-translation';
import type { AiSettings } from '../src/core/ai-settings';

const SETTINGS: AiSettings = {
  enabled: true,
  endpoint: 'https://api.deepseek.com/chat/completions',
  apiKey: 'sk-test',
  model: 'deepseek-chat',
  outputLanguage: 'zh-CN',
  translateBilibiliSubtitles: true,
};

const SOURCE = [
  { from: 0, to: 2.5, content: 'Have you noticed it?' },
  { from: 2.5, to: 5, content: 'The methods make the difference.' },
];

function userPayload(complete: ReturnType<typeof vi.fn>, callIndex: number): {
  lines: Array<{ id: string; text: string }>;
} {
  const messages = complete.mock.calls[callIndex]?.[1] as Array<{ role: string; content: string }>;
  const user = messages.find((message) => message.role === 'user');
  return JSON.parse(user!.content) as { lines: Array<{ id: string; text: string }> };
}

describe('translateBilibiliSubtitleLines', () => {
  it('按 ID 回填简中并逐行保留时间码和顺序', async () => {
    const complete = vi.fn().mockResolvedValue(JSON.stringify({
      translations: [
        { id: 'L0001', text: '你有没有注意到？' },
        { id: 'L0002', text: '真正拉开差距的是方法。' },
      ],
    }));

    const result = await translateBilibiliSubtitleLines(SOURCE, SETTINGS, complete);

    expect(result).toEqual([
      { from: 0, to: 2.5, content: '你有没有注意到？' },
      { from: 2.5, to: 5, content: '真正拉开差距的是方法。' },
    ]);
    expect(complete).toHaveBeenCalledTimes(1);
    const sentMessages = complete.mock.calls[0]?.[1];
    expect(JSON.stringify(sentMessages)).not.toContain('BV1');

    // 请求 JSON 只包含行 ID 和英文文本，不含时间码
    const payload = userPayload(complete, 0);
    expect(payload.lines).toEqual([
      { id: 'L0001', text: 'Have you noticed it?' },
      { id: 'L0002', text: 'The methods make the difference.' },
    ]);
  });

  it.each([
    [{ translations: [{ id: 'L0001', text: '只有一行' }] }, '缺少 ID'],
    [{ translations: [{ id: 'L0001', text: '一' }, { id: 'L0001', text: '重复' }] }, '重复 ID'],
    [{ translations: [{ id: 'L9999', text: '越界' }, { id: 'L0002', text: '二' }] }, '未知 ID'],
    [{ translations: [{ id: 'L0001', text: '' }, { id: 'L0002', text: '二' }] }, '空文本'],
  ])('非法响应（%s）触发一次修复，第二次仍非法则失败', async (body) => {
    const complete = vi.fn().mockResolvedValue(JSON.stringify(body));
    await expect(translateBilibiliSubtitleLines(SOURCE, SETTINGS, complete))
      .rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' });
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it('非法响应经一次修复成功后返回正确译文', async () => {
    const complete = vi.fn()
      .mockResolvedValueOnce(JSON.stringify({ translations: [{ id: 'L0001', text: '只有一行' }] }))
      .mockResolvedValueOnce(JSON.stringify({
        translations: [
          { id: 'L0001', text: '你有没有注意到？' },
          { id: 'L0002', text: '真正拉开差距的是方法。' },
        ],
      }));

    const result = await translateBilibiliSubtitleLines(SOURCE, SETTINGS, complete);

    expect(result).toEqual([
      { from: 0, to: 2.5, content: '你有没有注意到？' },
      { from: 2.5, to: 5, content: '真正拉开差距的是方法。' },
    ]);
    expect(complete).toHaveBeenCalledTimes(2);
    // 修复提示使用同一源批次
    expect(userPayload(complete, 1)).toEqual(userPayload(complete, 0));
  });

  it('非法 JSON（非 JSON 文本）也只修复一次', async () => {
    const complete = vi.fn()
      .mockResolvedValueOnce('这不是 JSON')
      .mockResolvedValueOnce(JSON.stringify({
        translations: [
          { id: 'L0001', text: '你有没有注意到？' },
          { id: 'L0002', text: '真正拉开差距的是方法。' },
        ],
      }));

    await expect(translateBilibiliSubtitleLines(SOURCE, SETTINGS, complete)).resolves.toHaveLength(2);
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it('Markdown 代码块围栏可被有限清除', async () => {
    const complete = vi.fn().mockResolvedValue(
      '```json\n'
      + JSON.stringify({
        translations: [
          { id: 'L0001', text: '你有没有注意到？' },
          { id: 'L0002', text: '真正拉开差距的是方法。' },
        ],
      })
      + '\n```',
    );

    const result = await translateBilibiliSubtitleLines(SOURCE, SETTINGS, complete);

    expect(result.map((line) => line.content)).toEqual(['你有没有注意到？', '真正拉开差距的是方法。']);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it(`超过 ${MAX_TRANSLATION_BATCH_LINES} 行时分批且批次顺序稳定`, async () => {
    const source = Array.from({ length: 120 }, (_, index) => ({
      from: index * 2,
      to: index * 2 + 2,
      content: `Sentence number ${index + 1}.`,
    }));
    const complete = vi.fn().mockImplementation((_settings: unknown, messages: Array<{ role: string; content: string }>) => {
      const user = messages.find((message) => message.role === 'user');
      const payload = JSON.parse(user!.content) as { lines: Array<{ id: string; text: string }> };
      return Promise.resolve(JSON.stringify({
        translations: payload.lines.map((line) => ({ id: line.id, text: `译文-${line.id}` })),
      }));
    });

    const result = await translateBilibiliSubtitleLines(source, SETTINGS, complete);

    expect(complete).toHaveBeenCalledTimes(2);
    expect(userPayload(complete, 0).lines).toHaveLength(60);
    expect(userPayload(complete, 1).lines).toHaveLength(60);
    expect(result).toHaveLength(120);
    // 顺序与时间码保持；行 ID 按批次从 L0001 重新编号（与固定请求格式一致）
    expect(result[0]).toEqual({ from: 0, to: 2, content: '译文-L0001' });
    expect(result[59]).toEqual({ from: 118, to: 120, content: '译文-L0060' });
    expect(result[60]).toEqual({ from: 120, to: 122, content: '译文-L0001' });
    expect(result[119]).toEqual({ from: 238, to: 240, content: '译文-L0060' });
  });

  it(`批次总字符超过 ${MAX_TRANSLATION_BATCH_CHARS} 时分批`, async () => {
    const longText = 'a'.repeat(2000);
    const source = Array.from({ length: 4 }, (_, index) => ({
      from: index,
      to: index + 1,
      content: longText,
    }));
    const complete = vi.fn().mockImplementation((_settings: unknown, messages: Array<{ role: string; content: string }>) => {
      const user = messages.find((message) => message.role === 'user');
      const payload = JSON.parse(user!.content) as { lines: Array<{ id: string; text: string }> };
      return Promise.resolve(JSON.stringify({
        translations: payload.lines.map((line) => ({ id: line.id, text: `译文-${line.id}` })),
      }));
    });

    const result = await translateBilibiliSubtitleLines(source, SETTINGS, complete);

    expect(complete).toHaveBeenCalledTimes(2);
    expect(userPayload(complete, 0).lines).toHaveLength(3);
    expect(userPayload(complete, 1).lines).toHaveLength(1);
    expect(result.map((line) => line.from)).toEqual([0, 1, 2, 3]);
  });

  it('空输入直接返回空数组且不调用 AI', async () => {
    const complete = vi.fn();

    await expect(translateBilibiliSubtitleLines([], SETTINGS, complete)).resolves.toEqual([]);
    expect(complete).not.toHaveBeenCalled();
  });
});
