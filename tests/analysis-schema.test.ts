import { describe, expect, it } from 'vitest';
import { parseVisualSummary, validateVisualSummary } from '../src/analysis/schema';
import type { VisualSummary } from '../src/analysis/types';

const VALID: VisualSummary = {
  schemaVersion: 1,
  articleType: 'comparison',
  confidence: 0.93,
  classificationReason: '文章主要比较两个 AI 工具在功能、成本和使用体验方面的差异。',
  summary: '文章比较了两种 AI 开发环境，并认为成本和执行效率是二者最大的区别。',
  keyPoints: [
    { title: '完成度', description: 'DeepSeek Harness 的最终项目完成度更高。' },
    { title: '玩法', description: 'Claude Code 生成的游戏玩法更加丰富。' },
    { title: '成本', description: 'DeepSeek Harness 的整体调用成本更低。' },
  ],
  structure: {
    label: '两种 AI 开发环境对比',
    children: [
      { label: 'DeepSeek Harness', children: [{ label: '完成度更高' }, { label: '成本更低' }] },
      { label: 'Claude Code', children: [{ label: '玩法更多' }] },
    ],
  },
  takeaways: [
    '如果更看重成本和完成度，DeepSeek Harness 更有优势。',
    '如果更重视玩法丰富程度，Claude Code 仍有价值。',
  ],
};

describe('validateVisualSummary', () => {
  it('接受合法完整示例', () => {
    expect(validateVisualSummary(VALID)).toEqual([]);
  });

  it('拒绝未知 articleType', () => {
    const errors = validateVisualSummary({ ...VALID, articleType: 'story' });
    expect(errors.some((e) => e.includes('articleType'))).toBe(true);
  });

  it('拒绝越界或非数字 confidence', () => {
    for (const confidence of [1.5, -0.1, 'high', null]) {
      const errors = validateVisualSummary({ ...VALID, confidence });
      expect(errors.some((e) => e.includes('confidence'))).toBe(true);
    }
  });

  it('拒绝非字符串或空 summary', () => {
    for (const summary of [42, '', '   ']) {
      const errors = validateVisualSummary({ ...VALID, summary });
      expect(errors.some((e) => e.includes('summary'))).toBe(true);
    }
  });

  it('拒绝缺失 classificationReason', () => {
    const { classificationReason: _omit, ...rest } = VALID;
    const errors = validateVisualSummary(rest);
    expect(errors.some((e) => e.includes('classificationReason'))).toBe(true);
  });

  it('拒绝 keyPoints 数量越界（1 或 6）', () => {
    const one = validateVisualSummary({ ...VALID, keyPoints: VALID.keyPoints.slice(0, 1) });
    expect(one.some((e) => e.includes('keyPoints'))).toBe(true);
    const six = [
      ...VALID.keyPoints,
      { title: 'a', description: 'b' },
      { title: 'c', description: 'd' },
      { title: 'e', description: 'f' },
    ];
    const errors = validateVisualSummary({ ...VALID, keyPoints: six });
    expect(errors.some((e) => e.includes('keyPoints'))).toBe(true);
  });

  it('拒绝 keyPoint 的 title / description 非字符串', () => {
    const badTitle = validateVisualSummary({
      ...VALID,
      keyPoints: [{ title: 42, description: 'x' }, ...VALID.keyPoints.slice(1)],
    });
    expect(badTitle.some((e) => e.includes('title'))).toBe(true);
    const badDescription = validateVisualSummary({
      ...VALID,
      keyPoints: [{ title: 'x', description: false }, ...VALID.keyPoints.slice(1)],
    });
    expect(badDescription.some((e) => e.includes('description'))).toBe(true);
  });

  it('拒绝 takeaways 数量越界（0 或 4）', () => {
    expect(validateVisualSummary({ ...VALID, takeaways: [] }).some((e) => e.includes('takeaways'))).toBe(true);
    expect(
      validateVisualSummary({ ...VALID, takeaways: ['a', 'b', 'c', 'd'] }).some((e) => e.includes('takeaways')),
    ).toBe(true);
  });

  it('拒绝第 4 层结构树', () => {
    const depth4 = {
      ...VALID,
      structure: {
        label: '1',
        children: [{ label: '2', children: [{ label: '3', children: [{ label: '4' }] }] }],
      },
    };
    const errors = validateVisualSummary(depth4);
    expect(errors.some((e) => e.includes('depth'))).toBe(true);
  });

  it('接受第 3 层结构树', () => {
    const depth3 = {
      ...VALID,
      structure: {
        label: '1',
        children: [{ label: '2', children: [{ label: '3' }] }],
      },
    };
    expect(validateVisualSummary(depth3)).toEqual([]);
  });

  it('拒绝超过 10 个节点的结构树', () => {
    const children = Array.from({ length: 11 }, (_, i) => ({ label: `n${i}` }));
    const errors = validateVisualSummary({ ...VALID, structure: { label: 'root', children } });
    expect(errors.some((e) => e.includes('node'))).toBe(true);
  });

  it('接受恰好 10 个节点的结构树（根 + 9 个子节点）', () => {
    const children = Array.from({ length: 9 }, (_, i) => ({ label: `n${i}` }));
    expect(validateVisualSummary({ ...VALID, structure: { label: 'root', children } })).toEqual([]);
  });

  it('拒绝非对象输入', () => {
    for (const raw of [null, undefined, 'text', 42, []]) {
      expect(validateVisualSummary(raw).length).toBeGreaterThan(0);
    }
  });

  it('拒绝缺失或错误的 schemaVersion', () => {
    const { schemaVersion: _omit, ...rest } = VALID;
    expect(validateVisualSummary(rest).some((e) => e.includes('schemaVersion'))).toBe(true);
    expect(validateVisualSummary({ ...VALID, schemaVersion: 2 }).some((e) => e.includes('schemaVersion'))).toBe(true);
  });

  it('拒绝 structure 缺失或 label 非字符串', () => {
    const { structure: _omit, ...rest } = VALID;
    expect(validateVisualSummary(rest).some((e) => e.includes('structure'))).toBe(true);
    expect(
      validateVisualSummary({ ...VALID, structure: { label: 42 } }).some((e) => e.includes('label')),
    ).toBe(true);
  });
});

describe('parseVisualSummary', () => {
  it('原样返回合法输入', () => {
    expect(parseVisualSummary(VALID)).toEqual(VALID);
  });

  it('结构错误时抛错，不静默修复', () => {
    expect(() => parseVisualSummary({ ...VALID, articleType: 'story' })).toThrow();
    expect(() => parseVisualSummary({ ...VALID, confidence: 2 })).toThrow();
    expect(() => parseVisualSummary({ ...VALID, keyPoints: [] })).toThrow();
    expect(() => parseVisualSummary(null)).toThrow();
  });

  it('summary 超过 80 字时截断', () => {
    const long = '长'.repeat(100);
    const parsed = parseVisualSummary({ ...VALID, summary: long });
    expect(parsed.summary.length).toBe(80);
  });

  it('keyPoint title 超过 20 字、description 超过 80 字时分别截断', () => {
    const parsed = parseVisualSummary({
      ...VALID,
      keyPoints: [
        { title: '题'.repeat(30), description: '述'.repeat(100) },
        ...VALID.keyPoints.slice(1),
      ],
    });
    expect(parsed.keyPoints[0]!.title.length).toBe(20);
    expect(parsed.keyPoints[0]!.description.length).toBe(80);
  });

  it('takeaway 超过 80 字时截断', () => {
    const parsed = parseVisualSummary({ ...VALID, takeaways: ['结'.repeat(100), '二'] });
    expect(parsed.takeaways[0]!.length).toBe(80);
    expect(parsed.takeaways[1]).toBe('二');
  });

  it('tree label 超长时截断到安全长度', () => {
    const parsed = parseVisualSummary({
      ...VALID,
      structure: { label: '标'.repeat(200) },
    });
    expect(parsed.structure.label.length).toBeLessThanOrEqual(100);
  });
});
