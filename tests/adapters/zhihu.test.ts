import { describe, it, expect } from 'vitest';
import { zhihuAdapter } from '../../src/adapters/zhihu';
import { collectZhihuSourceBlocks, navigateZhihuSource } from '../../src/adapters/zhihu/source';
import { renderDocument } from '../../src/core/markdown-renderer';
import { checkJsonRoundTrip, validateDocument, type ContentDocument } from '../../src/core/schema';
import { mountFixture, readExpectedMd } from '../helpers';

const URLS: Record<string, string> = {
  answer: 'https://www.zhihu.com/question/1/answer/456',
  article: 'https://zhuanlan.zhihu.com/p/889',
  articlePostMain: 'https://zhuanlan.zhihu.com/p/990001',
};

const FIXTURE_NAMES: Record<string, string> = {
  articlePostMain: 'article-post-main',
};

function extract(name: string): ContentDocument {
  mountFixture('zhihu', FIXTURE_NAMES[name] ?? name);
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

  it('新版 .Post-Main 文章即使存在登录表单也能提取', () => {
    const doc = extract('articlePostMain');
    expect(validateDocument(doc)).toEqual([]);
    expect(checkJsonRoundTrip(doc)).toBeNull();
    expect(doc.metadata.contentType).toBe('zhihu-article');
    expect(doc.metadata.title).toBe('新版知乎文章标题');
    expect(doc.metadata.author.name).toBe('示例作者');

    const md = renderDocument(doc);
    expect(md.trim()).toBe(readExpectedMd('zhihu', 'article-post-main'));
    expect(md).not.toContain('这段评论文本应该被排除。');
    expect(md).not.toContain('这段推荐文本应该被排除。');
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

  it('没有正文且存在登录表单时仍提示需要登录', () => {
    document.body.innerHTML = '<form class="SignFlow Login-content"><input type="text"></form>';
    expect(() => zhihuAdapter.extract(document, new URL('https://zhuanlan.zhihu.com/p/990002'))).toThrow('需要登录');
  });

  it('回答目标无正文但其他回答有正文时仍提示需要登录', () => {
    document.body.innerHTML = `
      <form class="SignFlow Login-content"><input type="text"></form>
      <div class="AnswerItem" data-zop='{"itemId":"456"}'></div>
      <div class="AnswerItem"><div class="RichContent-inner">另一个回答正文</div></div>
    `;
    expect(() => zhihuAdapter.extract(document, new URL('https://www.zhihu.com/question/1/answer/456'))).toThrow('需要登录');
  });

  it('detectTitle 返回问题标题 / 文章标题', () => {
    mountFixture('zhihu', 'answer');
    expect(zhihuAdapter.detectTitle?.(new URL(URLS.answer!), document, 'zhihu-answer')).toBe('如何评价一部电影？');
    mountFixture('zhihu', 'article');
    expect(zhihuAdapter.detectTitle?.(new URL(URLS.article!), document, 'zhihu-article')).toBe('深入理解 React 的渲染机制');
  });
});

describe('知乎视觉来源块', () => {
  it('只收集焦点文章正文并排除评论/推荐', () => {
    mountFixture('zhihu', 'article');
    const blocks = collectZhihuSourceBlocks(document, new URL(URLS.article!));
    expect(blocks.map((b) => b.text)).toEqual([
      '这是一篇关于 React 渲染机制的文章。',
      '引言',
      '虚拟 DOM',
      '协调算法',
    ]);
    expect(blocks.map((b) => b.id)).toEqual(['B001', 'B002', 'B003', 'B004']);
  });

  it('回答只收集焦点回答正文', () => {
    mountFixture('zhihu', 'answer');
    const blocks = collectZhihuSourceBlocks(document, new URL(URLS.answer!));
    expect(blocks.map((b) => b.text)).toEqual([
      '这是我的回答正文。',
      '第二段引用：参考资料',
      '引用内容',
    ]);
    expect(blocks.map((b) => b.id)).toEqual(['B001', 'B002', 'B003']);
  });

  it('页面 ID 变化时拒绝定位', () => {
    mountFixture('zhihu', 'article');
    expect(navigateZhihuSource(document, new URL(URLS.article!), {
      expectedSourceUrl: 'https://zhuanlan.zhihu.com/p/other',
      sourceBlockId: 'B001',
      sourceQuote: '这是一篇关于 React 渲染机制的文章。',
    })).toMatchObject({ success: false, error: { code: 'SOURCE_CHANGED' } });
  });
});
