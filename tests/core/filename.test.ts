import { describe, it, expect } from 'vitest';
import { buildFilename, sanitizeFilenamePart, slugify } from '../../src/core/filename';
import type { ContentDocument } from '../../src/core/schema';

function tweetDoc(partial: { id?: string; handle?: string; body?: string }): ContentDocument {
  return {
    version: 1,
    metadata: {
      platform: 'x',
      contentType: 'tweet',
      sourceUrl: 'https://x.com/a/status/1',
      author: { name: 'A', handle: partial.handle ?? 'a' },
      published: '',
    },
    body: {
      type: 'tweet',
      author: { name: 'A', handle: partial.handle ?? 'a' },
      published: '',
      id: partial.id ?? '',
      content: [
        { type: 'paragraph', children: [{ type: 'text', value: partial.body ?? '今天天气不错' }] },
      ],
      media: [],
    },
  };
}

function articleDoc(over: Partial<ContentDocument['metadata']> = {}): ContentDocument {
  return {
    version: 1,
    metadata: {
      platform: 'zhihu',
      contentType: 'zhihu-answer',
      sourceUrl: 'https://www.zhihu.com/question/1/answer/2',
      author: { name: '张三' },
      published: '',
      ...over,
    },
    body: { type: 'article', children: [] },
  };
}

describe('buildFilename', () => {
  it('X tweet 带 id：@handle-tweetId', () => {
    expect(buildFilename(tweetDoc({ id: '123456', handle: 'alice' }))).toBe('@alice-123456.md');
  });

  it('X tweet 无 id：用正文 slug 兜底', () => {
    expect(buildFilename(tweetDoc({ handle: 'alice', body: '这是一个很长的推文内容用来测试文件名' }))).toBe(
      '@alice-这是一个很长的推文内容用来测试文件名.md',
    );
  });

  it('知乎回答：用标题 slug', () => {
    const doc = articleDoc({ title: '《沙丘》到底好看吗？' });
    expect(buildFilename(doc)).toBe('沙丘-到底好看吗.md');
  });

  it('知乎回答无标题但带 id：{type}-{id}', () => {
    expect(buildFilename(articleDoc({ id: '2' }))).toBe('zhihu-answer-2.md');
  });

  it('知乎回答无标题无 id：{type} 兜底', () => {
    expect(buildFilename(articleDoc())).toBe('zhihu-answer.md');
  });
});

describe('slugify', () => {
  it('保留 CJK 字母数字，其余转 -', () => {
    expect(slugify('《星际穿越》观后感！')).toBe('星际穿越-观后感');
    expect(slugify('Hello, 世界 2024!')).toBe('Hello-世界-2024');
  });

  it('限长与去首尾 -', () => {
    expect(slugify('一二三四五六七八九十', 5)).toBe('一二三四五');
    expect(slugify('---a---', 10)).toBe('a');
  });
});

describe('sanitizeFilenamePart', () => {
  it('移除 Windows 非法字符', () => {
    expect(sanitizeFilenamePart('a<b>:c/"\\d|e?f*g')).toBe('abcdefg');
  });

  it('保留名规避', () => {
    expect(sanitizeFilenamePart('CON')).toBe('_CON');
    expect(sanitizeFilenamePart('lpt1.txt')).toBe('_lpt1.txt');
  });

  it('去掉首尾空白与点', () => {
    expect(sanitizeFilenamePart('  file.  ')).toBe('file');
  });

  it('限长 80', () => {
    expect(sanitizeFilenamePart('x'.repeat(200))).toHaveLength(80);
  });
});
