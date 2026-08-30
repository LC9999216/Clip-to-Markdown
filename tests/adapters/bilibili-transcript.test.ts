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
    // 非整数比例按计划使用 toBeCloseTo；相邻子段边界必须精确相等
    expect(result[0]!.start).toBe(0);
    expect(result[0]!.end).toBeCloseTo(2.4, 10);
    expect(result[1]!.start).toBe(result[0]!.end);
    expect(result[1]!.end).toBeCloseTo(4.8, 10);
    expect(result[2]!.start).toBe(result[1]!.end);
    expect(result[2]!.end).toBeCloseTo(7.2, 10);
    expect(result[3]!.start).toBe(result[2]!.end);
    expect(result.at(-1)!.end).toBe(10);
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

    // target 8 / hardLimit 12：前 10 段各 8 字（4 秒），剩余 10 字 ≤ hardLimit 作为末段（5 秒）
    expect(result).toHaveLength(11);
    expect(result.map((segment) => Array.from(segment.text).length)).toEqual([
      8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 10,
    ]);
    expect(result.every((segment) => segment.end - segment.start <= 6 + EPSILON)).toBe(true);
    expect(result[0]!.start).toBe(0);
    expect(result.at(-1)!.end).toBe(45);
    expect(result.every((segment, index) =>
      index === 0 || result[index - 1]!.end === segment.start)).toBe(true);
    expect(result.map((segment) => segment.id)).toEqual(
      Array.from({ length: 11 }, (_, index) => `S${String(index + 1).padStart(4, '0')}`),
    );
    expect(result.map((segment) => segment.text).join('')).toBe(content);
  });

  it('长空白串归前段时受硬上限约束，不使子段超过 6 秒', () => {
    // 23 code points / 8 秒（正常密度）；空白候选切点 12..17、target 11
    const content = 'a'.repeat(10) + ' '.repeat(10) + 'b'.repeat(3);
    const result = groupTranscript([{ from: 0, to: 8, content }]);

    expect(result.map((segment) => Array.from(segment.text).length)).toEqual([17, 6]);
    expect(result.every((segment) => segment.end - segment.start <= 6 + EPSILON)).toBe(true);
    expect(result.map((segment) => segment.text).join('')).toBe(content);
    expect(result[0]!.end).toBeCloseTo(8 * 17 / 23, 10);
  });

  it('hardLimit 小于 minCut 时切点窗口为空仍稳步前进（每段恰好 6 秒）', () => {
    // 7 字 / 42 秒：duration/chars = 6 不触发稀疏例外；targetByTime=max(1,0)=1 → hardLimit=1 < minCut=6
    const content = '甲乙丙丁戊己庚';
    const result = groupTranscript([{ from: 0, to: 42, content }]);

    expect(result).toHaveLength(7);
    expect(result.map((segment) => Array.from(segment.text).length)).toEqual([1, 1, 1, 1, 1, 1, 1]);
    expect(result.every((segment) => segment.end - segment.start <= 6 + EPSILON)).toBe(true);
    expect(result[0]).toMatchObject({ start: 0, end: 6 });
    expect(result.at(-1)).toMatchObject({ start: 36, end: 42 });
    expect(result.map((segment) => segment.text).join('')).toBe(content);
  });

  it('行中长空白串并入下一个含内容子段，绝不产生纯空白展示段', () => {
    // 35 code points / 20 秒：hardLimit 10 < minCut 12（窗口倒置）且空白串 30 > hardLimit
    const content = 'ab' + ' '.repeat(30) + 'ccc';
    const result = groupTranscript([{ from: 0, to: 20, content }]);

    expect(result.every((segment) => segment.text.trim().length > 0)).toBe(true);
    expect(result.map((segment) => segment.text).join('')).toBe(content);
    expect(result).toHaveLength(2);
    expect(result.map((segment) => Array.from(segment.text).length)).toEqual([10, 25]);
    expect(result[0]!.text).toBe('ab' + ' '.repeat(8));
    expect(result[1]!.text).toBe(' '.repeat(22) + 'ccc');
    // 空白块时间归入下一段：相邻端点仍精确相等
    expect(result[0]!.end).toBe(result[1]!.start);
    expect(result[0]!.end).toBeCloseTo(20 * 10 / 35, 10);
    expect(result[1]!.end).toBe(20);
    // 有意取舍：合并段因吸收纯空白时间而超过 6 秒（"无空文字段"优先）
    expect(result[1]!.end - result[1]!.start).toBeGreaterThan(6 + EPSILON);
  });

  it('拉丁句点后跟空白被选为切点（正例）', () => {
    const content = 'x'.repeat(13) + '. ' + 'y'.repeat(15);
    const result = groupTranscript([{ from: 0, to: 10, content }]);

    expect(result).toHaveLength(2);
    expect(result[0]!.text).toBe('x'.repeat(13) + '. ');
    expect(result[1]!.text).toBe('y'.repeat(15));
    expect(result[0]!.end).toBe(result[1]!.start);
    expect(result[0]!.end).toBeCloseTo(5, 10);
    expect(result.map((segment) => segment.text).join('')).toBe(content);
  });

  it('强标点同距并列时取较后者（标点归前段）', () => {
    // '。' 在 10 和 12，候选切点 11/13 距 idealCut=12 等距 → 取 13
    const content = '甲'.repeat(10) + '。乙。' + '丙'.repeat(8);
    const result = groupTranscript([{ from: 0, to: 7, content }]);

    expect(result).toHaveLength(2);
    expect(result[0]!.text).toBe('甲'.repeat(10) + '。乙。');
    expect(result[1]!.text).toBe('丙'.repeat(8));
    expect(result[0]!.end).toBe(result[1]!.start);
    expect(result[0]!.end).toBeCloseTo(7 * 13 / 21, 10);
  });

  it('from/to 为 NaN 或 ±Infinity 时折叠为非负有限区间', () => {
    expect(groupTranscript([{ from: Number.NaN, to: Number.POSITIVE_INFINITY, content: '测试' }])).toEqual([
      { id: 'S0001', start: 0, end: 0, text: '测试' },
    ]);
    expect(groupTranscript([{ from: 5, to: Number.NEGATIVE_INFINITY, content: '你好' }])).toEqual([
      { id: 'S0001', start: 5, end: 5, text: '你好' },
    ]);
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

  it('空输入与空白字幕行仍被过滤', () => {
    expect(groupTranscript([])).toEqual([]);
    expect(groupTranscript(null as unknown as BiliSubtitleLine[])).toEqual([]);
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
