import { describe, it, expect } from 'vitest';

describe('测试基建 smoke', () => {
  it('jsdom 环境可用', () => {
    expect(window).toBeDefined();
    expect(document).toBeDefined();
  });

  it('chrome shim 已注入', () => {
    const chrome = (globalThis as { chrome?: unknown }).chrome;
    expect(chrome).toBeDefined();
  });

  it('window.scrollTo 已 stub', () => {
    expect(() => window.scrollTo(0, 0)).not.toThrow();
  });
});
