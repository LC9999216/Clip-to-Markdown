import { describe, expect, it } from 'vitest';
import { buildAnalysisInput, MAX_ANALYSIS_CHARS } from '../src/analysis/input';
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

describe('buildAnalysisInput', () => {
  it('maps a Tweet ContentDocument without leaking its AST', () => {
    expect(buildAnalysisInput(tweetDocument('第一段正文'))).toEqual({
      platform: 'x',
      contentType: 'tweet',
      title: '',
      author: 'Alice (@alice)',
      sourceUrl: 'https://x.com/alice/status/123',
      body: '第一段正文',
      truncated: false,
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
    });
  });

  it('keeps an exactly 16000-character rendered body unchanged', () => {
    const body = '甲'.repeat(MAX_ANALYSIS_CHARS);
    expect(buildAnalysisInput(articleDocument(body))).toMatchObject({ body, truncated: false });
  });

  it('keeps the first 12000 and last 4000 characters when over the limit', () => {
    const body = `${'前'.repeat(12_000)}${'中'.repeat(321)}${'后'.repeat(4_000)}`;
    const input = buildAnalysisInput(articleDocument(body));

    expect(input.body).toBe(`${'前'.repeat(12_000)}[内容过长，中间部分已省略]${'后'.repeat(4_000)}`);
    expect(input.truncated).toBe(true);
  });
});
