import { describe, it, expect } from 'vitest';
import { heyboxAdapter } from '../../src/adapters/heybox';
import { renderDocument } from '../../src/core/markdown-renderer';
import { checkJsonRoundTrip, validateDocument, type ContentDocument } from '../../src/core/schema';
import { mountFixture, readExpectedMd } from '../helpers';

const POST_URL = 'https://www.xiaoheihe.cn/article/1001';

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

  it('元数据正确', () => {
    const doc = extract();
    expect(doc.metadata.title).toBe('小黑盒文章标题示例');
    expect(doc.metadata.author.name).toBe('盒友小明');
    expect(doc.metadata.published).toBe('2024-07-01T09:00:00+08:00');
    expect(doc.metadata.id).toBe('1001');
  });

  it('评论/推荐/操作栏绝不混入', () => {
    const md = renderDocument(extract());
    expect(md).not.toContain('评论区内容');
    expect(md).not.toContain('推荐帖子');
    expect(md).not.toContain('点赞');
    expect(md).not.toContain('article/2');
  });

  it('matches 仅命中 xiaoheihe.cn', () => {
    expect(heyboxAdapter.matches(new URL('https://www.xiaoheihe.cn/a'))).toBe(true);
    expect(heyboxAdapter.matches(new URL('https://xiaoheihe.cn/a'))).toBe(true);
    expect(heyboxAdapter.matches(new URL('https://zhihu.com/a'))).toBe(false);
  });

  it('detectType：非内容路径返回 null', () => {
    expect(heyboxAdapter.detectType(new URL('https://www.xiaoheihe.cn/article/1'), document)).toBe('heybox-post');
    expect(heyboxAdapter.detectType(new URL('https://www.xiaoheihe.cn/'), document)).toBeNull();
    expect(heyboxAdapter.detectType(new URL('https://www.xiaoheihe.cn/login'), document)).toBeNull();
  });

  it('找不到正文抛 NOT_FOUND_BODY', () => {
    document.body.innerHTML = '<div class="page"><p>空页面</p></div>';
    expect(() => heyboxAdapter.extract(document, new URL(POST_URL))).toThrow('未找到');
  });

  it('detectTitle 返回标题', () => {
    mountFixture('heybox', 'normal-post');
    expect(heyboxAdapter.detectTitle?.(new URL(POST_URL), document, 'heybox-post')).toBe('小黑盒文章标题示例');
  });
});
