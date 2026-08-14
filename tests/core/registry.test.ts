import { describe, it, expect, beforeEach } from 'vitest';
import { PlatformRegistry } from '../../src/core/platform-registry';
import type { PlatformAdapter } from '../../src/adapters/types';
import type { ContentDocument, PlatformContentType } from '../../src/core/schema';

function fakeAdapter(platform: 'x' | 'zhihu', matcher: (url: URL) => boolean): PlatformAdapter {
  return {
    platform,
    matches: matcher,
    detectType: (url, _doc) => {
      if (url.pathname.includes('/status/')) return 'tweet';
      if (url.pathname.includes('/answer/')) return 'zhihu-answer';
      return null;
    },
    extract: (): ContentDocument => {
      throw new Error('not implemented');
    },
    detectTitle: (_url: URL, _doc: Document, contentType: PlatformContentType) =>
      contentType === 'tweet' ? '推文标题' : undefined,
  };
}

let registry: PlatformRegistry;

beforeEach(() => {
  registry = new PlatformRegistry();
});

describe('PlatformRegistry', () => {
  it('按注册顺序匹配首个 adapter', () => {
    registry.register(fakeAdapter('x', (u) => u.hostname === 'x.com'));
    registry.register(fakeAdapter('zhihu', (u) => u.hostname.endsWith('zhihu.com')));

    expect(registry.match(new URL('https://x.com/alice/status/1'))?.platform).toBe('x');
    expect(registry.match(new URL('https://www.zhihu.com/question/1/answer/2'))?.platform).toBe('zhihu');
    expect(registry.match(new URL('https://example.com/'))).toBeNull();
  });

  it('重复注册同平台抛错', () => {
    registry.register(fakeAdapter('x', () => false));
    expect(() => registry.register(fakeAdapter('x', () => false))).toThrow();
  });

  it('detectType 返回具体内容类型', () => {
    registry.register(fakeAdapter('x', (u) => u.hostname === 'x.com'));
    expect(registry.detectType(new URL('https://x.com/a/status/1'), document)).toBe('tweet');
    expect(registry.detectType(new URL('https://x.com/home'), document)).toBeNull();
  });

  it('未匹配返回 null（detectType）', () => {
    expect(registry.detectType(new URL('https://nope.com/'), document)).toBeNull();
  });
});
