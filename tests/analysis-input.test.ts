import { describe, expect, it } from 'vitest';
import { buildAnalysisInput, buildAnalysisInputV2, MAX_ANALYSIS_CHARS } from '../src/analysis/input';
import type { AnalysisSourceBlock } from '../src/analysis/types';
import type { ContentDocument } from '../src/core/schema';

function tweetDocument(text: string): ContentDocument {
  return {
    version: 1,
    metadata: {
      platform: 'x',
      contentType: 'tweet',
      sourceUrl: 'https://x.com/alice/status/123',
      author: { name: 'Alice', handle: 'alice' },
      published: '2026-08-25T08:00:00.000Z',
    },
    body: {
      type: 'tweet',
      author: { name: 'Alice', handle: 'alice' },
      published: '2026-08-25T08:00:00.000Z',
      id: '123',
      content: [{ type: 'paragraph', children: [{ type: 'text', value: text }] }],
      media: [],
    },
  };
}

function articleDocument(text: string): ContentDocument {
  return {
    version: 1,
    metadata: {
      platform: 'x',
      contentType: 'x-article',
      sourceUrl: 'https://x.com/deepseek_ai/status/8888',
      author: { name: 'DeepSeek', handle: 'deepseek_ai' },
      published: '',
      title: '从 0 到 1 构建 Harness',
    },
    body: {
      type: 'article',
      children: [{ type: 'paragraph', children: [{ type: 'text', value: text }] }],
    },
  };
}

const BLOCKS: AnalysisSourceBlock[] = [
  { id: 'B001', kind: 'paragraph', text: '第一段正文内容。' },
  { id: 'B002', kind: 'heading', text: '第二部分' },
  { id: 'B003', kind: 'paragraph', text: '第三段详细论述。' },
];

describe('buildAnalysisInput (V1)', () => {
  it('maps a Tweet ContentDocument without leaking its AST', () => {
    expect(buildAnalysisInput(tweetDocument('第一段正文'))).toEqual({
      platform: 'x',
      contentType: 'tweet',
      title: '',
      author: 'Alice (@alice)',
      sourceUrl: 'https://x.com/alice/status/123',
      body: '第一段正文',
      truncated: false,
      sourceBlocks: [],
    });
  });

  it('maps an X Article title, author, URL, and rendered body', () => {
    expect(buildAnalysisInput(articleDocument('文章正文'))).toEqual({
      platform: 'x',
      contentType: 'x-article',
      title: '从 0 到 1 构建 Harness',
      author: 'DeepSeek (@deepseek_ai)',
      sourceUrl: 'https://x.com/deepseek_ai/status/8888',
      body: '文章正文',
      truncated: false,
      sourceBlocks: [],
    });
  });

  it('keeps an exactly 16000-character rendered body unchanged', () => {
    const body = '甲'.repeat(MAX_ANALYSIS_CHARS);
    expect(buildAnalysisInput(articleDocument(body))).toMatchObject({ body, truncated: false });
  });

  it('keeps the first 12000 and last 4000 characters when over the limit', () => {
    const body = '前'.repeat(12_000) + '中'.repeat(321) + '后'.repeat(4_000);
    const input = buildAnalysisInput(articleDocument(body));
    expect(input.body).toBe('前'.repeat(12_000) + '[内容过长，中间部分已省略]' + '后'.repeat(4_000));
    expect(input.truncated).toBe(true);
  });
});

describe('buildAnalysisInputV2', () => {
  it('Article: 格式化为 [Bxxx]\\n文本 拼接', () => {
    const input = buildAnalysisInputV2(articleDocument('忽略'), BLOCKS);
    const expected = '[B001]\n第一段正文内容。\n\n[B002]\n第二部分\n\n[B003]\n第三段详细论述。';
    expect(input.body).toBe(expected);
    expect(input.sourceBlocks).toEqual(BLOCKS);
    expect(input.truncated).toBe(false);
  });

  it('Article: 头部超长时截断，保留原 ID，中间插入省略标记', () => {
    // 每个块约 486 字符；50 块约 24300 字符，head(12000)+tail(4000) 预算不足以覆盖全部块，必然截断
    const long = '很长的句子用于测试截断。'.repeat(40);
    const manyBlocks: AnalysisSourceBlock[] = Array.from({ length: 50 }, (_, i) => ({
      id: 'B' + String(i + 1).padStart(3, '0'),
      kind: 'paragraph' as const,
      text: long,
    }));
    const input = buildAnalysisInputV2(articleDocument('忽略'), manyBlocks);
    expect(input.truncated).toBe(true);
    expect(input.body).toContain('[内容过长，中间部分已省略]');
    expect(input.body).toContain('[B001]');
    expect(input.sourceBlocks.length).toBeLessThan(manyBlocks.length);
    for (const block of input.sourceBlocks) {
      expect(input.body).toContain('[' + block.id + ']');
    }
    expect(input.sourceBlocks[0]!.id).toBe('B001');
  });

  it('Article: 短文章不截断', () => {
    const input = buildAnalysisInputV2(articleDocument('忽略'), BLOCKS);
    expect(input.truncated).toBe(false);
    expect(input.sourceBlocks).toEqual(BLOCKS);
  });

  it('Tweet: 沿用纯正文格式，sourceBlocks 为空', () => {
    const input = buildAnalysisInputV2(tweetDocument('简单的推文内容。'), []);
    expect(input.body).toBe('简单的推文内容。');
    expect(input.sourceBlocks).toEqual([]);
    expect(input.truncated).toBe(false);
  });

  it('Tweet: 超长时沿用字符级截断，sourceBlocks 为空', () => {
    const body = '前'.repeat(12_000) + '中'.repeat(321) + '后'.repeat(4_000);
    const input = buildAnalysisInputV2(tweetDocument(body), []);
    expect(input.body).toBe('前'.repeat(12_000) + '[内容过长，中间部分已省略]' + '后'.repeat(4_000));
    expect(input.sourceBlocks).toEqual([]);
    expect(input.truncated).toBe(true);
  });
});