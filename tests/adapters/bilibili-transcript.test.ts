import { describe, expect, it } from 'vitest';
import { groupTranscript } from '../../src/adapters/bilibili/transcript';
import type { BiliSubtitleLine } from '../../src/adapters/bilibili/subtitle-types';

describe('B站字幕分段', () => {
  it('按中文句末优先分段并保留顺序、首尾时间和全部字符', () => {
    const raw: BiliSubtitleLine[] = [
      { from: 0, to: 4, content: '甲'.repeat(29) + '。' },
      { from: 4, to: 8, content: '乙'.repeat(29) + '！' },
      { from: 8, to: 12, content: '丙'.repeat(29) + '？' },
    ];

    const result = groupTranscript(raw);

    expect(result.map((item) => item.text).join('')).toBe(raw.map((item) => item.content).join(''));
    expect(result[0]).toMatchObject({ id: 'S0001', start: 0, text: raw[0]!.content });
    expect(result.at(-1)).toMatchObject({ end: 12 });
    expect(result.every((item) => item.text.endsWith('。') || item.text.endsWith('！') || item.text.endsWith('？'))).toBe(true);
  });

  it('中文无标点时按原字幕行边界接近理想长度', () => {
    const raw: BiliSubtitleLine[] = Array.from({ length: 4 }, (_, index) => ({
      from: index * 2,
      to: index * 2 + 2,
      content: String.fromCharCode(0x4e00 + index).repeat(30),
    }));

    const result = groupTranscript(raw);

    expect(result.map((item) => item.text)).toEqual([
      raw.slice(0, 3).map((item) => item.content).join(''),
      raw[3]!.content,
    ]);
    expect(result.map((item) => item.id)).toEqual(['S0001', 'S0002']);
  });

  it('拉丁文字使用较大的长度阈值并保持字符', () => {
    const raw: BiliSubtitleLine[] = Array.from({ length: 4 }, (_, index) => ({
      from: index * 3,
      to: index * 3 + 3,
      content: String.fromCharCode(65 + index).repeat(60),
    }));

    const result = groupTranscript(raw);

    expect(result.map((item) => item.text).join('')).toBe(raw.map((item) => item.content).join(''));
    expect(result).toHaveLength(2);
    expect(result[0]!.text).toHaveLength(180);
    expect(result.every((item) => item.text.length <= 320)).toBe(true);
  });

  it('移除空白字幕行但保留有效行的时间端点', () => {
    const raw: BiliSubtitleLine[] = [
      { from: 0, to: 1, content: '   ' },
      { from: 1, to: 2, content: '你好' },
      { from: 2, to: 3, content: '\n\t' },
      { from: 3, to: 4, content: '世界' },
    ];

    const result = groupTranscript(raw);

    expect(result.map((item) => item.text).join('')).toBe('你好世界');
    expect(result[0]).toMatchObject({ start: 1 });
    expect(result.at(-1)).toMatchObject({ end: 4 });
  });

  it('超长中文单行按字符比例切片并插值原始时长', () => {
    const content = '长'.repeat(350);
    const result = groupTranscript([{ from: 10, to: 30, content }]);

    expect(result.length).toBeGreaterThan(1);
    expect(result.map((item) => item.text).join('')).toBe(content);
    expect(result.every((item) => item.text.length <= 160)).toBe(true);
    expect(result.every((item) => item.end - item.start <= 20)).toBe(true);
    expect(result[0]).toMatchObject({ id: 'S0001', start: 10 });
    expect(result[0]!.end).toBeCloseTo(10 + (160 / 350) * 20, 10);
    expect(result.at(-1)).toMatchObject({ end: 30 });
  });

  it('超长拉丁单行不丢字符且不超过拉丁长度上限', () => {
    const content = 'word '.repeat(140);
    const result = groupTranscript([{ from: 2, to: 18, content }]);

    expect(result.map((item) => item.text).join('')).toBe(content);
    expect(result.length).toBeGreaterThan(1);
    expect(result.every((item) => item.text.length <= 320)).toBe(true);
    expect(result.at(-1)).toMatchObject({ end: 18 });
  });

  it('任何分段都不超过 20 秒并按时间顺序编号', () => {
    const result = groupTranscript([{ from: 0, to: 45, content: '时'.repeat(90) }]);

    expect(result.every((item) => item.end - item.start <= 20)).toBe(true);
    expect(result[0]!.start).toBe(0);
    expect(result.at(-1)!.end).toBe(45);
    expect(result.map((item) => item.id)).toEqual(['S0001', 'S0002', 'S0003']);
    expect(result.every((item, index) => index === 0 || item.start >= result[index - 1]!.end)).toBe(true);
  });
});
