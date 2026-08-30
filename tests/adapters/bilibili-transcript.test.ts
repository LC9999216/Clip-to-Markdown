import { describe, expect, it } from 'vitest';
import { groupTranscript } from '../../src/adapters/bilibili/transcript';
import type { BiliSubtitleLine } from '../../src/adapters/bilibili/subtitle-types';

const EPSILON = Number.EPSILON;

describe('B站字幕细粒度分段', () => {
  it('84 字无标点中文源行按约 4 秒切成 [0,4][4,8][8,12][12,14]', () => {
    // 复现侧栏 00:00 → 00:14 一大段的粗粒度问题：84 个中文 code point、14 秒
    const sourceText = '一二三四五六七八九十'.repeat(8) + '甲乙丙丁';
    expect(Array.from(sourceText).length).toBe(84);
    const result = groupTranscript([{ from: 0, to: 14, content: sourceText }]);

    expect(result.map(({ start, end }) => [start, end])).toEqual([
      [0, 4],
      [4, 8],
      [8, 12],
      [12, 14],
    ]);
    expect(result.map((segment) => Array.from(segment.text).length)).toEqual([
      24, 24, 24, 12,
    ]);
    expect(result.map((segment) => segment.text).join('')).toBe(sourceText);
    expect(result.map((segment) => segment.id)).toEqual(['S0001', 'S0002', 'S0003', 'S0004']);
  });

  it('绝不跨源字幕行合并：两条短行保持两个展示段', () => {
    const result = groupTranscript([
      { from: 0, to: 2, content: '你好' },
      { from: 2, to: 4, content: '世界' },
    ]);

    expect(result.map((segment) => segment.text)).toEqual(['你好', '世界']);
    expect(result.map(({ start, end }) => [start, end])).toEqual([[0, 2], [2, 4]]);
  });

  it('保留源字幕之间的真实时间空档，不生成占位段', () => {
    const result = groupTranscript([
      { from: 0, to: 2, content: '第一句' },
      { from: 10, to: 12, content: '第二句' },
    ]);

    expect(result.map((segment) => segment.text)).toEqual(['第一句', '第二句']);
    expect(result.map(({ start, end }) => [start, end])).toEqual([[0, 2], [10, 12]]);
    expect(result.every((segment) => segment.text.trim().length > 0)).toBe(true);
  });

  it('强句末标点优先于更近的弱标点', () => {
    // 40 字 / 8 秒：target 20、硬上限 28；'，' 切点 19（距 target 1），
    // '。' 切点 22（距 target 2）——强标点必须胜出
    const content = '甲'.repeat(18) + '，' + '乙'.repeat(2) + '。' + '丙'.repeat(18);
    const result = groupTranscript([{ from: 0, to: 8, content }]);

    expect(result.map((segment) => segment.text)).toEqual([
      '甲'.repeat(18) + '，' + '乙'.repeat(2) + '。',
      '丙'.repeat(18),
    ]);
    expect(result[0]!.end).toBeCloseTo(8 * 22 / 40, 10);
    expect(result[1]!.start).toBeCloseTo(8 * 22 / 40, 10);
    expect(result.map((segment) => segment.text).join('')).toBe(content);
  });

  it('逗号可作为次优切点并归入前段', () => {
    const content = '甲'.repeat(18) + '，' + '乙'.repeat(21);
    const result = groupTranscript([{ from: 0, to: 8, content }]);

    expect(result.map((segment) => segment.text)).toEqual([
      '甲'.repeat(18) + '，',
      '乙'.repeat(21),
    ]);
    expect(result[0]!.end).toBeCloseTo(8 * 19 / 40, 10);
    expect(result[1]!.start).toBeCloseTo(8 * 19 / 40, 10);
    expect(result.at(-1)!.end).toBe(8);
  });

  it('拉丁文本在空白边界切分，分隔空白归入前段且不丢字符', () => {
    const content = 'word '.repeat(12);
    const result = groupTranscript([{ from: 0, to: 8, content }]);

    expect(result.map((segment) => Array.from(segment.text).length)).toEqual([30, 30]);
    expect(result.map(({ start, end }) => [start, end])).toEqual([[0, 4], [4, 8]]);
    expect(result.map((segment) => segment.text).join('')).toBe(content);
    expect(result[0]!.text.endsWith(' ')).toBe(true);
    expect(result[1]!.text.startsWith(' ')).toBe(false);
  });

  it('小数、版本号与 URL 中的句点不会被当作句末切点', () => {
    const content = ['Pi is 3.14', 'x is v2.0', 'get example.com/a.b', 'now'].join(' ');
    const result = groupTranscript([{ from: 0, to: 12, content }]);

    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result.map((segment) => segment.text).join('')).toBe(content);
    // 每个含点 token 必须完整出现在某一个展示段内，而不是被切开
    for (const token of ['3.14', 'v2.0', 'example.com/a.b']) {
      expect(result.some((segment) => segment.text.includes(token))).toBe(true);
    }
    expect(result.every((segment) => segment.text.trim().length > 0)).toBe(true);
    expect(result.every((segment) => Number.isFinite(segment.start) && Number.isFinite(segment.end))).toBe(true);
  });

  it('无标点长中文按硬上限 28 code points 硬切并按比例分配时间', () => {
    const content = '字'.repeat(100);
    const result = groupTranscript([{ from: 0, to: 10, content }]);

    expect(result.map((segment) => Array.from(segment.text).length)).toEqual([24, 24, 24, 28]);
    expect(result.map(({ start, end }) => [start, end])).toEqual([
      [0, 2.4],
      [2.4, 4.8],
      [4.8, 7.2],
      [7.2, 10],
    ]);
    expect(result.map((segment) => segment.text).join('')).toBe(content);
  });

  it('无标点长拉丁按硬上限 72 code points 硬切', () => {
    const content = 'word '.repeat(20);
    const result = groupTranscript([{ from: 0, to: 7, content }]);

    expect(result.map((segment) => Array.from(segment.text).length)).toEqual([55, 45]);
    expect(result.every((segment) => Array.from(segment.text).length <= 72)).toBe(true);
    expect(result.map((segment) => segment.text).join('')).toBe(content);
    expect(result[0]!.end).toBeCloseTo(7 * 55 / 100, 10);
  });

  it('正常字符密度（duration/chars ≤ 6）时所有子段不超过 6 秒', () => {
    const content = '时'.repeat(90);
    const result = groupTranscript([{ from: 0, to: 45, content }]);

    expect(result).toHaveLength(12);
    expect(result.every((segment) => segment.end - segment.start <= 6 + EPSILON)).toBe(true);
    expect(result[0]!.start).toBe(0);
    expect(result.at(-1)!.end).toBe(45);
    expect(result.map((segment) => segment.id)).toEqual(
      Array.from({ length: 12 }, (_, index) => `S${String(index + 1).padStart(4, '0')}`),
    );
    expect(result.map((segment) => segment.text).join('')).toBe(content);
  });

  it('极稀疏源行保真例外：单字 25 秒保留原始时间范围（源数据过稀，非算法缺陷）', () => {
    const result = groupTranscript([{ from: 0, to: 25, content: '甲' }]);

    expect(result).toEqual([
      { id: 'S0001', start: 0, end: 25, text: '甲' },
    ]);

    const twoChars = groupTranscript([{ from: 0, to: 25, content: '甲乙' }]);
    expect(twoChars).toEqual([
      { id: 'S0001', start: 0, end: 25, text: '甲乙' },
    ]);
  });

  it('扩展汉字按一个 code point 处理并使用中文限制', () => {
    const han = String.fromCodePoint(0x20000);
    const raw: BiliSubtitleLine[] = [
      { from: 0, to: 1, content: han.repeat(100) },
      { from: 1, to: 2, content: han.repeat(100) },
    ];

    const result = groupTranscript(raw);

    expect(result).toHaveLength(8);
    expect(result.slice(0, 4).map((segment) => Array.from(segment.text).length)).toEqual([24, 24, 24, 28]);
    expect(result[0]!.end).toBeCloseTo(0.24, 10);
    expect(result[3]!.end).toBe(1);
    expect(result[4]!.start).toBe(1);
    expect(result.at(-1)!.end).toBe(2);
    expect(result.map((segment) => segment.text).join('')).toBe(raw.map((line) => line.content).join(''));
  });

  it('from === to 不产生 NaN，且仍可按文字长度切段', () => {
    const moment = groupTranscript([{ from: 5, to: 5, content: '你好' }]);
    expect(moment).toEqual([{ id: 'S0001', start: 5, end: 5, text: '你好' }]);

    const longMoment = groupTranscript([{ from: 5, to: 5, content: '字'.repeat(40) }]);
    expect(longMoment.map((segment) => Array.from(segment.text).length)).toEqual([24, 16]);
    expect(longMoment.every((segment) => segment.start === 5 && segment.end === 5)).toBe(true);
    expect(longMoment.every((segment) => Number.isFinite(segment.start) && Number.isFinite(segment.end))).toBe(true);
  });

  it('异常 to < from 不产生负持续时间', () => {
    const result = groupTranscript([{ from: 8, to: 3, content: '你好世界' }]);

    expect(result).toEqual([{ id: 'S0001', start: 8, end: 8, text: '你好世界' }]);
    expect(result.every((segment) => segment.end >= segment.start)).toBe(true);
  });

  it('空白字幕行仍被过滤，有效行时间端点保留', () => {
    const result = groupTranscript([
      { from: 0, to: 1, content: '   ' },
      { from: 1, to: 2, content: '你好' },
      { from: 2, to: 3, content: '\n\t' },
      { from: 3, to: 4, content: '世界' },
    ]);

    expect(result.map((segment) => segment.text)).toEqual(['你好', '世界']);
    expect(result[0]!.start).toBe(1);
    expect(result.at(-1)!.end).toBe(4);
  });
});
