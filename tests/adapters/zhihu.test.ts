import { describe, it, expect } from 'vitest';
import { zhihuAdapter } from '../../src/adapters/zhihu';
import { renderDocument } from '../../src/core/markdown-renderer';
import { checkJsonRoundTrip, validateDocument, type ContentDocument } from '../../src/core/schema';
import { mountFixture, readExpectedMd } from '../helpers';

const URLS: Record<string, string> = {
  answer: 'https://www.zhihu.com/question/1/answer/456',
  article: 'https://zhuanlan.zhihu.com/p/889',
};

function extract(name: string): ContentDocument {
  mountFixture('zhihu', name);
  return zhihuAdapter.extract(document, new URL(URLS[name]!));
}

describe.each(['answer', 'article'] as const)('知乎 adapter fixture: %s', (name) => {
  it('提取 + 渲染与期望一致，且通过结构校验与 JSON round-trip', () => {
    const doc = extract(name);
    expect(validateDocument(doc)).toEqual([]);
    expect(checkJsonRoundTrip(doc)).toBeNull();
    expect(renderDocument(doc).trim()).toBe(readExpectedMd('zhihu', name));
  });
});

describe('知乎 adapter 负向断言', () => {
  it('回答：评论/其他回答/推荐绝不混入', () => {
    const md = renderDocument(extract('answer'));
    expect(md).not.toContain('评论');
    expect(md).not.toContain('另一个回答');
    expect(md).not.toContain('李四');
    expect(md).not.toContain('相关问题');
    expect(md).not.toContain('推荐内容');
  });

  it('回答：互动按钮（赞同数）被剔除', () => {
    const md = renderDocument(extract('answer'));
    expect(md).not.toContain('赞同');
    expect(md).not.toContain('100');
  });

  it('文章：评论/推荐绝不混入', () => {
    const md = renderDocument(extract('article'));
    expect(md).not.toContain('评论区内容');
    expect(md).not.toContain('相关推荐');
  });

  it('回答 URL 定位到正确的 author', () => {
    const doc = extract('answer');
    expect(doc.metadata.author.name).toBe('张三');
    expect(doc.metadata.id).toBe('456');
  });

  it('文章元数据（标题/作者/时间）正确', () => {
    const doc = extract('article');
    expect(doc.metadata.title).toBe('深入理解 React 的渲染机制');
    expect(doc.metadata.author.name).toBe('李四');
    expect(doc.metadata.published).toBe('2024-06-01T10:00:00+08:00');
    expect(doc.metadata.id).toBe('889');
  });
});

describe('知乎 adapter 路由与错误', () => {
  it('matches 仅命中 zhihu.com 域名', () => {
    expect(zhihuAdapter.matches(new URL('https://www.zhihu.com/a'))).toBe(true);
    expect(zhihuAdapter.matches(new URL('https://zhuanlan.zhihu.com/p/1'))).toBe(true);
    expect(zhihuAdapter.matches(new URL('https://x.com/a'))).toBe(false);
  });

  it('detectType：answer / article / 未知', () => {
    expect(zhihuAdapter.detectType(new URL('https://www.zhihu.com/question/1/answer/2'), document)).toBe('zhihu-answer');
    expect(zhihuAdapter.detectType(new URL('https://zhuanlan.zhihu.com/p/3'), document)).toBe('zhihu-article');
    expect(zhihuAdapter.detectType(new URL('https://www.zhihu.com/question/1'), document)).toBeNull();
  });

  it('找不到正文抛 NOT_FOUND_BODY', () => {
    document.body.innerHTML = '<div class="QuestionHeader"><h1 class="QuestionHeader-title">无回答</h1></div>';
    expect(() => zhihuAdapter.extract(document, new URL('https://www.zhihu.com/question/1/answer/2'))).toThrow(
      '未找到正文',
    );
  });

  it('登录墙抛 LOGIN_REQUIRED', () => {
    document.body.innerHTML = '<div class="SignFlow"><input type="password"></div>';
    expect(() => zhihuAdapter.extract(document, new URL('https://www.zhihu.com/question/1/answer/2'))).toThrow('登录');
  });

  it('detectTitle 返回问题标题 / 文章标题', () => {
    mountFixture('zhihu', 'answer');
    expect(zhihuAdapter.detectTitle?.(new URL(URLS.answer!), document, 'zhihu-answer')).toBe('如何评价一部电影？');
    mountFixture('zhihu', 'article');
    expect(zhihuAdapter.detectTitle?.(new URL(URLS.article!), document, 'zhihu-article')).toBe('深入理解 React 的渲染机制');
  });
});
