import { describe, it, expect } from 'vitest';
import {
  buildFilename,
  buildFilenameContext,
  cleanupTemplateResult,
  renderFilenameTemplate,
  sanitizeFilenamePart,
  slugify,
  validateFilenameTemplate,
} from '../../src/core/filename';
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
      id: partial.id,
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
  const now = new Date(2026, 7, 17, 12, 34, 56);

  it('默认使用剪藏日期和标题', () => {
    expect(buildFilename(articleDoc({ title: '如何使用 DeepSeek？' }), { now })).toBe(
      '2026-08-17-如何使用-DeepSeek.md',
    );
  });

  it('支持全部 V0.2 模板变量', () => {
    const doc = articleDoc({
      title: '如何使用 DeepSeek？',
      id: 'answer-2',
      author: { name: '作者' },
    });
    expect(buildFilename(doc, {
      template: '{date}-{platform}-{author}-{id}-{title}',
      now,
    })).toBe('2026-08-17-知乎-作者-answer-2-如何使用-DeepSeek.md');
  });

  it('X 无标题时使用正文作为 title，author 使用 metadata.author.name', () => {
    const doc = tweetDoc({ id: '123456', handle: 'alice', body: '这是一个推文标题' });
    expect(buildFilename(doc, { template: '{author}-{id}-{title}', now })).toBe(
      'A-123456-这是一个推文标题.md',
    );
  });

  it('缺少 author 时清理多余分隔符', () => {
    const doc = articleDoc({ title: '标题', author: { name: '' } });
    expect(buildFilename(doc, { template: '{author}-{title}', now })).toBe('标题.md');
  });

  it('缺少标题时回退到内容类型', () => {
    expect(buildFilename(articleDoc({ id: '2' }), { template: '{title}', now })).toBe('zhihu-answer.md');
  });

  it('未知变量回退默认模板，不保存未知变量文本', () => {
    expect(buildFilename(articleDoc({ title: '标题' }), { template: '{hello}-{title}', now })).toBe(
      '2026-08-17-标题.md',
    );
  });

  it('模板结果为空时使用稳定的 title 兜底', () => {
    const doc = articleDoc({ title: '' });
    expect(buildFilename(doc, { template: '{author}-{id}', now })).toBe('张三.md');
  });
});

describe('filename template helpers', () => {
  it('校验未知变量并去重', () => {
    expect(validateFilenameTemplate('{hello}-{title}-{hello}')).toEqual({
      valid: false,
      unsupportedVariables: ['{hello}'],
    });
    expect(validateFilenameTemplate('{date}-{title}')).toEqual({
      valid: true,
      unsupportedVariables: [],
    });
  });

  it('渲染模板并清理连续分隔符', () => {
    const context = buildFilenameContext(articleDoc({ title: '标题' }));
    expect(renderFilenameTemplate('{author}-{title}-{id}', context)).toBe('张三-标题-');
    expect(cleanupTemplateResult('---标题__')).toBe('标题');
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
