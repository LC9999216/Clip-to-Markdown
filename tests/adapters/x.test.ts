import { describe, it, expect } from 'vitest';
import { xAdapter } from '../../src/adapters/x';
import { renderDocument } from '../../src/core/markdown-renderer';
import { checkJsonRoundTrip, validateDocument, type ContentDocument } from '../../src/core/schema';
import { mountFixture, readExpectedMd } from '../helpers';

const URLS: Record<string, string> = {
  normal: 'https://x.com/alice/status/123456',
  image: 'https://x.com/alice/status/222',
  quote: 'https://x.com/alice/status/777',
  promoted: 'https://x.com/alice/status/456',
  translation: 'https://x.com/OfficialLoganK/status/2087948481721962669',
};

function extract(name: string): ContentDocument {
  mountFixture('x', name);
  return xAdapter.extract(document, new URL(URLS[name]!));
}

describe.each(['normal', 'image', 'quote', 'promoted', 'translation'] as const)('X adapter fixture: %s', (name) => {
  it('提取 + 渲染与期望一致，且通过结构校验与 JSON round-trip', () => {
    const doc = extract(name);
    expect(validateDocument(doc)).toEqual([]);
    expect(checkJsonRoundTrip(doc)).toBeNull();
    expect(renderDocument(doc).trim()).toBe(readExpectedMd('x', name));
  });
});

describe('X adapter 负向断言', () => {
  it('评论（不同作者回复）绝不混入', () => {
    const md = renderDocument(extract('normal'));
    expect(md).not.toContain('回复评论');
    expect(md).not.toContain('Bob');
    expect(md).not.toContain('999');
  });

  it('互动按钮（点赞/转发数）被剔除', () => {
    const md = renderDocument(extract('normal'));
    expect(md).not.toContain('👍');
    expect(md).not.toContain('100');
    expect(md).not.toContain('🔁');
  });

  it('推广内容绝不混入', () => {
    const md = renderDocument(extract('promoted'));
    expect(md).not.toContain('推广内容');
    expect(md).not.toContain('广告');
    expect(md).not.toContain('adsponsor');
  });

  it('浏览器插件注入的翻译文本被原样保留（用户需求）', () => {
    const md = renderDocument(extract('translation'));
    expect(md).toContain('Introducing Gemini 3.7 Flash');
    expect(md).toContain('隆重推出 Gemini 3.7 闪光灯');
    expect(md).toContain('速度很快');
  });

  it('引用推文作为 blockquote 渲染，而非混入正文', () => {
    const md = renderDocument(extract('quote'));
    expect(md).toContain('> **Carol (@carol)**');
    expect(md).toContain('> 被引用的推文内容');
    // 正文不含引用内容
    expect(md.split('> 被引用的推文内容')[0]).not.toContain('被引用的推文内容');
  });
});

describe('X adapter 路由与错误', () => {
  it('matches 仅命中 x.com / twitter.com', () => {
    expect(xAdapter.matches(new URL('https://x.com/a'))).toBe(true);
    expect(xAdapter.matches(new URL('https://twitter.com/a'))).toBe(true);
    expect(xAdapter.matches(new URL('https://zhihu.com/a'))).toBe(false);
  });

  it('detectType：仅 /status/{数字} 识别为 tweet', () => {
    expect(xAdapter.detectType(new URL('https://x.com/alice/status/123'), document)).toBe('tweet');
    expect(xAdapter.detectType(new URL('https://x.com/home'), document)).toBeNull();
    expect(xAdapter.detectType(new URL('https://x.com/alice/status/abc'), document)).toBeNull();
  });

  it('找不到正文抛 NOT_FOUND_BODY', () => {
    document.body.innerHTML = '<div>空页面</div>';
    expect(() => xAdapter.extract(document, new URL('https://x.com/a/status/1'))).toThrow('未找到正文');
  });

  it('缺时间优雅降级：published 为 "" 而不阻断（M4）', () => {
    document.body.innerHTML = `
      <article role="article">
        <div data-testid="User-Name"><a href="/alice">Alice</a><span>@alice</span></div>
        <div data-testid="tweetText"><span>无时间推文</span></div>
        <a href="/alice/status/1"></a>
      </article>`;
    const doc = xAdapter.extract(document, new URL('https://x.com/a/status/1'));
    expect(doc.metadata.published).toBe('');
    expect(renderDocument(doc)).toContain('无时间推文');
  });

  it('detectTitle 返回正文前 50 字符', () => {
    mountFixture('x', 'normal');
    expect(xAdapter.detectTitle?.(new URL(URLS.normal!), document, 'tweet')).toBe(
      '今天天气不错，分享一张照片，#test。',
    );
  });
});
