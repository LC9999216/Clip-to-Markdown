import { describe, expect, it, vi, afterEach } from 'vitest';
import { mountFixture } from './helpers';
import { navigateToSource } from '../src/adapters/x/navigation';
import { isNavigateToSourceRequest } from '../src/types/messages';
import type { NavigateToSourceResponse } from '../src/types/messages';

function setLocation(url: string): void {
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: new URL(url),
  });
}

function payload(overrides: Partial<{
  expectedSourceUrl: string;
  sourceBlockId: string;
  sourceQuote: string;
}> = {}) {
  return {
    expectedSourceUrl: 'https://x.com/deepseek_ai/status/8888',
    sourceBlockId: 'B001',
    sourceQuote: '这是一篇介绍 DeepSeek-Harness 的长文章，作者在 这里 首发。',
    ...overrides,
  };
}

describe('X Article conservative source navigation', () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('navigates by matching the source block ID and quote', () => {
    setLocation('https://x.com/deepseek_ai/status/8888');
    mountFixture('x', 'article');
    const target = document.querySelector('[data-contents="true"] p') as HTMLElement;
    target.scrollIntoView = vi.fn();

    const response = navigateToSource(payload());

    expect(response).toEqual({ success: true });
    expect(target.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
    expect(target.classList.contains('clip2md-source-highlight')).toBe(true);
  });

  it('falls back to a unique quote when the source block ID drifted', () => {
    setLocation('https://x.com/deepseek_ai/status/8888');
    mountFixture('x', 'article');
    const target = [...document.querySelectorAll('[data-contents="true"] h1, [data-contents="true"] h2, [data-contents="true"] h3, [data-contents="true"] h4, [data-contents="true"] h5, [data-contents="true"] h6, [data-contents="true"] p')]
      .find((el) => el.textContent?.includes('快速上手')) as HTMLElement;
    target.scrollIntoView = vi.fn();

    const response = navigateToSource(payload({ sourceBlockId: 'B999', sourceQuote: '快速上手' }));

    expect(response).toEqual({ success: true });
    expect(target.scrollIntoView).toHaveBeenCalled();
  });

  it('rejects zero and duplicate quote candidates conservatively', () => {
    setLocation('https://x.com/deepseek_ai/status/8888');
    mountFixture('x', 'article');

    expect(navigateToSource(payload({ sourceBlockId: 'B999', sourceQuote: '不存在的原文' }))).toEqual({
      success: false,
      error: { code: 'TARGET_NOT_FOUND', message: expect.any(String) },
    });

    document.querySelector('[data-contents="true"]')!.innerHTML = '<p>重复段落。</p><p>重复段落。</p>';
    expect(navigateToSource(payload({ sourceBlockId: 'B999', sourceQuote: '重复段落。' }))).toEqual({
      success: false,
      error: { code: 'AMBIGUOUS_TARGET', message: expect.any(String) },
    });
  });

  it('rejects a changed status before inspecting page content', () => {
    setLocation('https://x.com/deepseek_ai/status/9999');
    mountFixture('x', 'article');

    expect(navigateToSource(payload())).toEqual({
      success: false,
      error: { code: 'SOURCE_CHANGED', message: expect.any(String) },
    });
  });

  it('treats x.com and twitter.com as the same status source', () => {
    setLocation('https://twitter.com/deepseek_ai/status/8888');
    mountFixture('x', 'article');
    const target = document.querySelector('[data-contents="true"] p') as HTMLElement;
    target.scrollIntoView = vi.fn();

    expect(navigateToSource(payload())).toEqual({ success: true });
  });

  it('cancels the previous highlight when a new navigation succeeds', () => {
    vi.useFakeTimers();
    setLocation('https://x.com/deepseek_ai/status/8888');
    mountFixture('x', 'article');
    const targets = [
      document.querySelector('[data-contents="true"] p') as HTMLElement,
      document.querySelector('[data-contents="true"] h2') as HTMLElement,
    ];
    targets.forEach((el) => { el.scrollIntoView = vi.fn(); });

    expect(navigateToSource(payload())).toEqual({ success: true });
    expect(navigateToSource(payload({ sourceBlockId: 'B002', sourceQuote: '快速上手' }))).toEqual({ success: true });
    expect(targets[0]!.classList.contains('clip2md-source-highlight')).toBe(false);
    expect(targets[1]!.classList.contains('clip2md-source-highlight')).toBe(true);
    vi.advanceTimersByTime(1800);
    expect(targets[1]!.classList.contains('clip2md-source-highlight')).toBe(false);
  });

  it('validates navigation request shape and limits quote length', () => {
    expect(isNavigateToSourceRequest({ type: 'NAVIGATE_TO_SOURCE', payload: payload() })).toBe(true);
    expect(isNavigateToSourceRequest({ type: 'NAVIGATE_TO_SOURCE', payload: payload({ sourceBlockId: 'bad' }) })).toBe(false);
    expect(isNavigateToSourceRequest({ type: 'NAVIGATE_TO_SOURCE', payload: payload({ sourceQuote: 'x'.repeat(141) }) })).toBe(false);
    expect(isNavigateToSourceRequest({ type: 'NAVIGATE_TO_SOURCE', payload: payload({ expectedSourceUrl: 'https://evil.example/status/1' }) })).toBe(false);
  });

  it('returns stable unsupported-page and reduced-motion behavior', () => {
    setLocation('https://example.com/page');
    document.body.innerHTML = '<p>正文</p>';
    expect(navigateToSource(payload({ sourceQuote: '正文' }))).toEqual({
      success: false,
      error: { code: 'UNSUPPORTED_PAGE', message: expect.any(String) },
    });

    setLocation('https://x.com/deepseek_ai/status/8888');
    mountFixture('x', 'article');
    const target = document.querySelector('[data-contents="true"] p') as HTMLElement;
    target.scrollIntoView = vi.fn();
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    const response = navigateToSource(payload()) as NavigateToSourceResponse;
    expect(response).toEqual({ success: true });
    expect(target.scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'center' });
  });
});
