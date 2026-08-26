import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AI_SETTINGS,
  getAiOriginPattern,
  normalizeAiEndpoint,
  type AiSettings,
} from '../../src/core/ai-settings';

describe('AiSettings 默认值', () => {
  it('提供完整且禁用的默认值', () => {
    expect(DEFAULT_AI_SETTINGS).toEqual({
      enabled: false,
      endpoint: '',
      apiKey: '',
      model: '',
      outputLanguage: 'zh-CN',
    });
  });

  it('outputLanguage 固定为 zh-CN', () => {
    const settings: AiSettings = { ...DEFAULT_AI_SETTINGS };
    expect(settings.outputLanguage).toBe('zh-CN');
  });
});

describe('normalizeAiEndpoint', () => {
  it('接受常见 HTTPS endpoint 并去除首尾空白', () => {
    expect(normalizeAiEndpoint('  https://api.deepseek.com/chat/completions  '))
      .toBe('https://api.deepseek.com/chat/completions');
    expect(normalizeAiEndpoint('https://api.openai.com/v1/chat/completions'))
      .toBe('https://api.openai.com/v1/chat/completions');
  });

  it('接受 localhost / 127.0.0.1 的 HTTP endpoint', () => {
    expect(normalizeAiEndpoint('http://localhost:11434/v1/chat/completions'))
      .toBe('http://localhost:11434/v1/chat/completions');
    expect(normalizeAiEndpoint('http://127.0.0.1:11434/v1/chat/completions'))
      .toBe('http://127.0.0.1:11434/v1/chat/completions');
  });

  it('拒绝普通远程 HTTP endpoint', () => {
    expect(normalizeAiEndpoint('http://example.com/chat/completions')).toBeNull();
  });

  it('拒绝危险协议：javascript / file / ftp / data / chrome-extension', () => {
    expect(normalizeAiEndpoint('javascript:alert(1)')).toBeNull();
    expect(normalizeAiEndpoint('file:///etc/passwd')).toBeNull();
    expect(normalizeAiEndpoint('ftp://example.com/x')).toBeNull();
    expect(normalizeAiEndpoint('data:text/plain,hi')).toBeNull();
    expect(normalizeAiEndpoint('chrome-extension://abc/x')).toBeNull();
  });

  it('拒绝空串与不可解析内容', () => {
    expect(normalizeAiEndpoint('')).toBeNull();
    expect(normalizeAiEndpoint('   ')).toBeNull();
    expect(normalizeAiEndpoint('not a url')).toBeNull();
  });
});

describe('getAiOriginPattern', () => {
  it('由 HTTPS endpoint 生成 origin 匹配模式（不含端口）', () => {
    expect(getAiOriginPattern('https://api.deepseek.com/chat/completions'))
      .toBe('https://api.deepseek.com/*');
    expect(getAiOriginPattern('https://api.openai.com/v1/chat/completions'))
      .toBe('https://api.openai.com/*');
  });

  it('由 localhost HTTP endpoint 生成 host 匹配模式（省略端口）', () => {
    expect(getAiOriginPattern('http://localhost:11434/v1/chat/completions'))
      .toBe('http://localhost/*');
    expect(getAiOriginPattern('http://127.0.0.1:11434/'))
      .toBe('http://127.0.0.1/*');
  });

  it('endpoint 非法时返回 null', () => {
    expect(getAiOriginPattern('http://example.com/x')).toBeNull();
    expect(getAiOriginPattern('not a url')).toBeNull();
    expect(getAiOriginPattern('')).toBeNull();
  });
});
