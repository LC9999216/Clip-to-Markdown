import { describe, expect, it } from 'vitest';
import {
  readCachedSummary,
  stableHash,
  visualSummaryCacheKey,
  writeCachedSummary,
} from '../src/analysis/cache';
import { mockSessionStorage } from './setup';
import type { VisualSummaryV2 } from '../src/analysis/types';

const SUMMARY: VisualSummaryV2 = {
  schemaVersion: 2,
  summary: ['第一句', '第二句'],
  keyPoints: [
    { title: '观点一', description: '说明一' },
    { title: '观点二', description: '说明二' },
  ],
  structure: [{ title: '正文', sourceBlockId: 'B001', sourceQuote: '正文' }],
};

describe('visual summary v2 cache', () => {
  it('includes endpoint, model, source URL, and actual AI body in the key', () => {
    const base = visualSummaryCacheKey(
      'https://x.com/a/status/1',
      '[B001]\n正文',
      'deepseek-chat',
      'https://api.deepseek.com/chat/completions',
    );

    expect(base).toContain('clip2md.visualSummary.v2.cache.');
    expect(base).not.toContain('sk-secret');
    expect(base).not.toContain('正文');
    expect(base).not.toBe(visualSummaryCacheKey(
      'https://x.com/a/status/1',
      '[B001]\n正文',
      'deepseek-chat',
      'https://api.example.com/chat/completions',
    ));
    expect(base).not.toBe(visualSummaryCacheKey(
      'https://x.com/a/status/1',
      '[B001]\n不同正文',
      'deepseek-chat',
      'https://api.deepseek.com/chat/completions',
    ));
  });

  it('reads and writes only structurally valid v2 summaries', async () => {
    const key = visualSummaryCacheKey(
      'https://x.com/a/status/1',
      '[B001]\n正文',
      'deepseek-chat',
      'https://api.deepseek.com/chat/completions',
    );

    await writeCachedSummary(key, SUMMARY);
    await expect(readCachedSummary(key)).resolves.toEqual(SUMMARY);

    mockSessionStorage[key] = { schemaVersion: 1, summary: '旧结果' };
    await expect(readCachedSummary(key)).resolves.toBeUndefined();
  });

  it('keeps the stable hash deterministic', () => {
    expect(stableHash('same input')).toBe(stableHash('same input'));
    expect(stableHash('same input')).not.toBe(stableHash('different input'));
  });
});
