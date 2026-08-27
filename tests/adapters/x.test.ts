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
  article: 'https://x.com/deepseek_ai/status/8888',
  rich: 'https://x.com/alice/status/3333',
  embed: 'https://x.com/alice/status/4444',
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

describe.each(['article', 'rich', 'embed'] as const)('X 长文章 fixture: %s', (name) => {
  it('提取 + 渲染与期望一致，正文为 ArticleNode，且通过结构校验与 JSON round-trip', () => {
    const doc = extract(name);
    expect(doc.metadata.contentType).toBe('x-article');
    expect(doc.metadata.title).toBeTruthy();
    expect(doc.body.type).toBe('article');
    if (doc.body.type === 'article') {
      expect(doc.body.children.length).toBeGreaterThan(0);
    }
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

describe('X 长文章负向断言', () => {
  it('评论/回复、推广、侧栏与嵌套重复正文绝不含在输出中', () => {
    const md = renderDocument(extract('article'));
    expect(md).not.toContain('回复评论');
    expect(md).not.toContain('推广内容');
    expect(md).not.toContain('adsponsor');
    expect(md).not.toContain('侧栏推荐');
    expect(md).not.toContain('嵌套重复正文');
  });

  it('互动数字、头像、emoji、hashflag 与 SVG 图标不进入输出', () => {
    const md = renderDocument(extract('article'));
    expect(md).not.toContain('1234');
    expect(md).not.toContain('avatar');
    expect(md).not.toContain('😀');
    expect(md).not.toContain('#DeepSeek');
    expect(md).not.toContain('icon.svg');
  });

  it('危险链接只保留可见文字；重复图片按规范化 URL 只保留第一次出现', () => {
    const md = renderDocument(extract('rich'));
    expect(md).toContain('点我');
    expect(md).not.toContain('javascript:');
    const dupUrl = 'https://pbs.twimg.com/media/fig1.jpg?name=large';
    expect(md.split(`![示意图](${dupUrl})`).length - 1).toBe(1);
    expect(md).not.toContain('重复图');
  });

  it('嵌入推文的互动按钮不进入输出，卡片/视频结构完整', () => {
    const md = renderDocument(extract('embed'));
    expect(md).not.toContain('❤️ 50');
    // 作者行经行内转义渲染为转义括号形式（与 renderer 全量转义一致）
    expect(md).toContain('> **Carol \\(@carol\\)**');
    expect(md).toContain('[卡片标题](https://x.com/deepseek_ai/status/9999)');
    expect(md).toContain('[查看视频]');
  });
});

describe('X adapter 路由与错误', () => {
  it('matches 仅命中 x.com / twitter.com', () => {
    expect(xAdapter.matches(new URL('https://x.com/a'))).toBe(true);
    expect(xAdapter.matches(new URL('https://twitter.com/a'))).toBe(true);
    expect(xAdapter.matches(new URL('https://zhihu.com/a'))).toBe(false);
  });

  it('detectType：仅 /status/{数字} 识别为 tweet（无长文章标记时）', () => {
    mountFixture('x', 'normal');
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

describe('X 长文章路由与错误', () => {
  it('普通长文章中的 placementTracking 不会被误判为推广内容', () => {
    document.body.innerHTML = `
      <article role="article">
        <div data-testid="User-Name"><a href="/alice">Alice</a><span>@alice</span></div>
        <a href="/alice/status/1"><time datetime="2026-08-27T00:00:00Z"></time></a>
        <div data-testid="twitter-article-title">普通长文章</div>
        <div data-testid="twitterArticleRichTextView">
          <div data-testid="longformRichTextComponent">
            <div data-contents="true">
              <div data-block="true"><span>这是真实正文。</span></div>
              <div data-testid="placementTracking"></div>
            </div>
          </div>
        </div>
      </article>`;

    const doc = xAdapter.extract(document, new URL('https://x.com/alice/status/1'));

    expect(doc.metadata.contentType).toBe('x-article');
    expect(renderDocument(doc)).toContain('这是真实正文。');
  });

  it('同一 /status/ URL 根据 DOM 区分 tweet 与 x-article', () => {
    mountFixture('x', 'article');
    expect(xAdapter.detectType(new URL(URLS.article!), document)).toBe('x-article');
    mountFixture('x', 'normal');
    expect(xAdapter.detectType(new URL(URLS.normal!), document)).toBe('tweet');
  });

  it('EXTRACT 按 DOM 路由：长文章返回 ArticleNode，普通推文返回 TweetNode', () => {
    mountFixture('x', 'article');
    expect(xAdapter.extract(document, new URL(URLS.article!)).body.type).toBe('article');
    mountFixture('x', 'normal');
    expect(xAdapter.extract(document, new URL(URLS.normal!)).body.type).toBe('tweet');
  });

  it('detectTitle 对长文章读取正式标题', () => {
    mountFixture('x', 'article');
    expect(xAdapter.detectTitle?.(new URL(URLS.article!), document, 'x-article')).toBe(
      '从0到1带你速通DeepSeek-Harness',
    );
  });

  it('长文章缺正文抛 NOT_FOUND_BODY（登录墙优先 LOGIN_REQUIRED）', () => {
    document.body.innerHTML = `
      <article role="article">
        <div data-testid="User-Name"><a href="/a">A</a><span>@a</span></div>
        <div data-testid="twitter-article-title"><h1>只有标题</h1></div>
        <div data-testid="twitterArticleRichTextView"></div>
      </article>`;
    expect(() => xAdapter.extract(document, new URL('https://x.com/a/status/1'))).toThrow('未找到正文');

    document.body.innerHTML = `
      <div data-testid="twitter-article-title"><h1>标题</h1></div>
      <div data-testid="loginButton"></div>`;
    expect(() => xAdapter.extract(document, new URL('https://x.com/a/status/1'))).toThrow('需要登录');
  });
});
