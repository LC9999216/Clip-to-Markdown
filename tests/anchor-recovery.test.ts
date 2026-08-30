import { describe, expect, it } from 'vitest';
import { recoverVisualSummaryAnchors } from '../src/analysis/anchor-recovery';
import { validateVisualSummaryAnchors } from '../src/analysis/schema';
import type { AnalysisInput, VisualSummaryV2 } from '../src/analysis/types';

const INPUT: AnalysisInput = {
  platform: 'x',
  contentType: 'x-article',
  title: '如何判断下一个风口',
  author: '作者',
  sourceUrl: 'https://x.com/example/status/1',
  body: '[B015]\n当你发现一个风口时，先验证真实需求，再决定是否投入。\n\n[B017]\n不要只看短期热度，要观察用户是否持续付费。',
  truncated: false,
  sourceBlocks: [
    { id: 'B015', kind: 'paragraph', text: '当你发现一个风口时，先验证真实需求，再决定是否投入。' },
    { id: 'B017', kind: 'paragraph', text: '不要只看短期热度，要观察用户是否持续付费。' },
  ],
};

function summary(structure: VisualSummaryV2['structure']): VisualSummaryV2 {
  return {
    schemaVersion: 2,
    summary: ['总结一', '总结二'],
    keyPoints: [
      { title: '判断', description: '先验证需求。' },
      { title: '持续性', description: '观察持续付费。' },
    ],
    structure,
  };
}

describe('recoverVisualSummaryAnchors 保守重匹配', () => {
  it('在对应 block 内高置信度重匹配被轻微改写的 sourceQuote', () => {
    const original = summary([
      { title: '验证需求', sourceBlockId: 'B015', sourceQuote: '当你发现一个风口时，先验证真实的需求，再决定是否投入。' },
      { title: '观察付费', sourceBlockId: 'B017', sourceQuote: '不要只看短期热度，需要观察用户能否持续付费' },
    ]);

    const recovered = recoverVisualSummaryAnchors(original, INPUT);

    expect(recovered.structure).toEqual([
      { title: '验证需求', sourceBlockId: 'B015', sourceQuote: '当你发现一个风口时，先验证真实需求，再决定是否投入。' },
      { title: '观察付费', sourceBlockId: 'B017', sourceQuote: '不要只看短期热度，要观察用户是否持续付费。' },
    ]);
    expect(validateVisualSummaryAnchors(recovered, INPUT)).toEqual([]);
  });

  it('已经合法的 summary 原样返回，不重写 anchor', () => {
    const original = summary([
      { title: '验证需求', sourceBlockId: 'B015', sourceQuote: '先验证真实需求' },
    ]);

    expect(recoverVisualSummaryAnchors(original, INPUT)).toBe(original);
  });

  it.each([
    ['当你发现一个风口时 先验证真实需求 再决定是否投入'],
    ['当你发现一个风口时，先验证真实需求,再决定是否投入'],
    ['当你发现一个风口时，先验证真实需求，再决定是否投入!'],
  ])('空白、全半角标点差异可恢复：%s', (badQuote) => {
    const recovered = recoverVisualSummaryAnchors(
      summary([{ title: '验证需求', sourceBlockId: 'B015', sourceQuote: badQuote }]),
      INPUT,
    );
    expect(recovered.structure[0]).toMatchObject({
      sourceBlockId: 'B015',
      sourceQuote: '当你发现一个风口时，先验证真实需求，再决定是否投入。',
    });
  });

  it('不存在的 block id 不会被改成另一个 block', () => {
    const original = summary([
      { title: '未知', sourceBlockId: 'B999', sourceQuote: '先验证真实需求' },
    ]);
    const recovered = recoverVisualSummaryAnchors(original, INPUT);
    expect(recovered).toBe(original);
    expect(validateVisualSummaryAnchors(recovered, INPUT)).toEqual([
      'structure[0].sourceBlockId B999 not present in sent blocks',
    ]);
  });

  it('低相似度 quote 不会被替换成 block 第一段', () => {
    const original = summary([
      { title: '无关', sourceBlockId: 'B015', sourceQuote: '完全无关的天气预报内容' },
    ]);
    const recovered = recoverVisualSummaryAnchors(original, INPUT);
    expect(recovered).toBe(original);
    expect(validateVisualSummaryAnchors(recovered, INPUT)).toEqual([
      'structure[0].sourceQuote not found in block B015',
    ]);
  });

  it('最高分与第二名差距小于 0.08 时保持失败', () => {
    const ambiguousInput: AnalysisInput = {
      ...INPUT,
      body: '[B001]\n先验证真实需求，再决定投入。先验证实际需求，再决定投入。',
      sourceBlocks: [{
        id: 'B001',
        kind: 'paragraph',
        text: '先验证真实需求，再决定投入。先验证实际需求，再决定投入。',
      }],
    };
    const original = summary([
      { title: '验证', sourceBlockId: 'B001', sourceQuote: '先验证需求，再决定投入' },
    ]);
    const recovered = recoverVisualSummaryAnchors(original, ambiguousInput);
    expect(recovered).toBe(original);
    expect(validateVisualSummaryAnchors(recovered, ambiguousInput)).toEqual([
      'structure[0].sourceQuote not found in block B001',
    ]);
  });

  it('候选同时出现在两个 sent blocks 时保持失败', () => {
    const duplicateInput: AnalysisInput = {
      ...INPUT,
      body: '[B001]\n共同内容用于判断。\n\n[B002]\n共同内容用于判断。',
      sourceBlocks: [
        { id: 'B001', kind: 'paragraph', text: '共同内容用于判断。' },
        { id: 'B002', kind: 'paragraph', text: '共同内容用于判断。' },
      ],
    };
    const original = summary([
      { title: '共同内容', sourceBlockId: 'B001', sourceQuote: '共同内容用于判断!' },
    ]);
    const recovered = recoverVisualSummaryAnchors(original, duplicateInput);
    expect(recovered).toBe(original);
    expect(validateVisualSummaryAnchors(recovered, duplicateInput)).toEqual([
      'structure[0].sourceQuote not found in block B001',
    ]);
  });

  it('归一化后少于 6 code points 的 quote 不做模糊恢复', () => {
    const original = summary([
      { title: '太短', sourceBlockId: 'B015', sourceQuote: '短期热度要' },
    ]);
    const recovered = recoverVisualSummaryAnchors(original, INPUT);
    expect(recovered).toBe(original);
    expect(validateVisualSummaryAnchors(recovered, INPUT)).toEqual([
      'structure[0].sourceQuote not found in block B015',
    ]);
  });

  it('超过 140 code points 的长句产生 140 code points 的精确子串候选', () => {
    const distinct = Array.from({ length: 300 }, (_, i) => String.fromCharCode(0x4e00 + i)).join('');
    const longInput: AnalysisInput = {
      ...INPUT,
      body: `[B002]\n${distinct}`,
      sourceBlocks: [{ id: 'B002', kind: 'paragraph', text: distinct }],
    };
    // 第二个 140 窗口删去 1 个字符 → 与第二窗口高相似、与第一/三窗口零重叠
    const second = Array.from({ length: 140 }, (_, i) => String.fromCharCode(0x4e00 + 140 + i));
    const perturbed = [...second.slice(0, 70), ...second.slice(71)].join('');
    const original = summary([
      { title: '长句', sourceBlockId: 'B002', sourceQuote: perturbed },
    ]);

    const recovered = recoverVisualSummaryAnchors(original, longInput);

    expect(recovered).not.toBe(original);
    expect(recovered.structure[0]).toMatchObject({
      sourceBlockId: 'B002',
      sourceQuote: second.join(''),
    });
    expect(Array.from(recovered.structure[0]!.sourceQuote!)).toHaveLength(140);
    expect(validateVisualSummaryAnchors(recovered, longInput)).toEqual([]);
  });

  it('扩展汉字按 code point 计数，强句末候选保留标点且为精确子串', () => {
    const blockText = `𠀀${'𠀀'.repeat(39)}。${'𠁁'.repeat(40)}。`;
    const hanInput: AnalysisInput = {
      ...INPUT,
      body: `[B003]\n${blockText}`,
      sourceBlocks: [{ id: 'B003', kind: 'paragraph', text: blockText }],
    };
    const original = summary([
      { title: '扩展汉字', sourceBlockId: 'B003', sourceQuote: '𠁁'.repeat(35) },
    ]);

    const recovered = recoverVisualSummaryAnchors(original, hanInput);

    expect(recovered.structure[0]).toMatchObject({
      sourceBlockId: 'B003',
      sourceQuote: `${'𠁁'.repeat(40)}。`,
    });
    expect(Array.from(recovered.structure[0]!.sourceQuote!)).toHaveLength(41);
    expect(validateVisualSummaryAnchors(recovered, hanInput)).toEqual([]);
  });

  it('恢复时不原地修改 summary、input 或 sourceBlocks', () => {
    const original = summary([
      { title: '验证需求', sourceBlockId: 'B015', sourceQuote: '当你发现一个风口时，先验证真实的需求，再决定是否投入。' },
    ]);
    const originalItem = original.structure[0];
    const inputBlocks = INPUT.sourceBlocks.map((block) => ({ ...block }));

    const recovered = recoverVisualSummaryAnchors(original, INPUT);

    expect(recovered).not.toBe(original);
    expect(recovered.summary).toBe(original.summary);
    expect(recovered.keyPoints).toBe(original.keyPoints);
    expect(originalItem).toEqual(original.structure[0]);
    expect(recovered.structure[0]).not.toBe(originalItem);
    expect(INPUT.sourceBlocks[0]).toEqual(inputBlocks[0]);
    expect(INPUT.sourceBlocks[0]!.text).toBe(inputBlocks[0]!.text);
  });

  it('无 sourceBlocks 时返回原对象', () => {
    const noBlocksInput: AnalysisInput = { ...INPUT, sourceBlocks: [] };
    const original = summary([{ title: '无锚点' }]);
    expect(recoverVisualSummaryAnchors(original, noBlocksInput)).toBe(original);
  });

  it('结构条目无 anchor 时原样保留', () => {
    const original = summary([
      { title: '验证需求', sourceBlockId: 'B015', sourceQuote: '当你发现一个风口时，先验证真实的需求，再决定是否投入。' },
      { title: '无锚点条目' },
    ]);

    const recovered = recoverVisualSummaryAnchors(original, INPUT);

    expect(recovered).not.toBe(original);
    expect(recovered.structure[1]).toBe(original.structure[1]);
    expect(recovered.structure[0]!.sourceQuote).toBe('当你发现一个风口时，先验证真实需求，再决定是否投入。');
  });

  it('一条恢复成功另一条失败时只替换成功项，整体仍被 Validator 拒绝', () => {
    const original = summary([
      { title: '可恢复', sourceBlockId: 'B015', sourceQuote: '当你发现一个风口时，先验证真实的需求，再决定是否投入。' },
      { title: '不可恢复', sourceBlockId: 'B015', sourceQuote: '完全无关的天气预报内容' },
    ]);

    const recovered = recoverVisualSummaryAnchors(original, INPUT);

    expect(recovered).not.toBe(original);
    expect(recovered.structure[0]!.sourceQuote).toBe('当你发现一个风口时，先验证真实需求，再决定是否投入。');
    expect(recovered.structure[1]).toBe(original.structure[1]);
    expect(validateVisualSummaryAnchors(recovered, INPUT)).toEqual([
      'structure[1].sourceQuote not found in block B015',
    ]);
  });
});
