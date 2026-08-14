import { describe, it, expect } from 'vitest';
import { heyboxAdapter } from '../../src/adapters/heybox';
import { renderDocument } from '../../src/core/markdown-renderer';
import { checkJsonRoundTrip, validateDocument, type ContentDocument } from '../../src/core/schema';
import { mountFixture, readExpectedMd } from '../helpers';

const POST_URL = 'https://www.xiaoheihe.cn/app/bbs/link/187550351';

function extract(): ContentDocument {
  mountFixture('heybox', 'normal-post');
  return heyboxAdapter.extract(document, new URL(POST_URL));
}

describe('小黑盒 adapter', () => {
  it('提取 + 渲染与期望一致，且通过结构校验与 JSON round-trip', () => {
    const doc = extract();
    expect(validateDocument(doc)).toEqual([]);
    expect(checkJsonRoundTrip(doc)).toBeNull();
    expect(renderDocument(doc).trim()).toBe(readExpectedMd('heybox', 'normal-post'));
  });

  it('元数据正确（真实页面结构）', () => {
    const doc = extract();
    expect(doc.metadata.title).toBe('大二大模型实习，独立开发招聘agent过程');
    expect(doc.metadata.author.name).toBe('含含光光');
    expect(doc.metadata.published).toBe(''); // 小黑盒无 ISO 时间戳
    expect(doc.metadata.id).toBe('187550351');
    expect(doc.metadata.sourceUrl).toBe(POST_URL);
  });

  it('评论/操作栏/标签/链接数据绝不混入', () => {
    const md = renderDocument(extract());
    expect(md).not.toContain('这是评论');
    expect(md).not.toContain('全部评论');
    expect(md).not.toContain('已收藏');
    expect(md).not.toContain('关注');
    expect(md).not.toContain('职场工作');
    expect(md).not.toContain('链接数据');
    expect(md).not.toContain('Lv.15');
  });

  it('matches 仅命中 xiaoheihe.cn', () => {
    expect(heyboxAdapter.matches(new URL('https://www.xiaoheihe.cn/a'))).toBe(true);
    expect(heyboxAdapter.matches(new URL('https://xiaoheihe.cn/a'))).toBe(true);
    expect(heyboxAdapter.matches(new URL('https://zhihu.com/a'))).toBe(false);
  });

  it('detectType：内容页识别，主页/登录/个人主页返回 null', () => {
    expect(heyboxAdapter.detectType(new URL('https://www.xiaoheihe.cn/app/bbs/link/187550351'), document)).toBe('heybox-post');
    expect(heyboxAdapter.detectType(new URL('https://www.xiaoheihe.cn/'), document)).toBeNull();
    expect(heyboxAdapter.detectType(new URL('https://www.xiaoheihe.cn/login'), document)).toBeNull();
    expect(heyboxAdapter.detectType(new URL('https://www.xiaoheihe.cn/app/user/profile/1'), document)).toBeNull();
  });

  it('找不到正文抛 NOT_FOUND_BODY', () => {
    document.body.innerHTML = '<div class="page"><p>空页面</p></div>';
    expect(() => heyboxAdapter.extract(document, new URL(POST_URL))).toThrow('未找到');
  });

  it('detectTitle 返回标题', () => {
    mountFixture('heybox', 'normal-post');
    expect(heyboxAdapter.detectTitle?.(new URL(POST_URL), document, 'heybox-post')).toBe(
      '大二大模型实习，独立开发招聘agent过程',
    );
  });
});
