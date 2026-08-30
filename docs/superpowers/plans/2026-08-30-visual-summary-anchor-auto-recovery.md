# Visual Summary Anchor Auto-Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 当“一图速览”因 `sourceQuote` 与对应 Source Block 不一致而校验失败时，先在本地高置信度重匹配真实原句；现有 AI repair 仍失败时自动完整重生成一次，只有三阶段都失败才要求用户手动点击“重新生成”。

**Architecture:** 新增纯函数模块负责保守的 Anchor 重匹配，只修改 `sourceQuote`，不猜测或改写 `sourceBlockId`；`analyzeContentV2` 将“解析 → 本地恢复 → 严格 Anchor 校验”作为每个阶段的统一验收门。一次用户操作最多依次执行初次生成、一次 repair、一次 fresh generation，共最多 3 次 Provider 请求；缓存、Background 状态机和 Side Panel 继续只接收最终通过严格校验的结果。

**Tech Stack:** TypeScript、Chrome Extension Manifest V3、OpenAI-Compatible Chat Completions、Vitest、现有手写 Schema/Anchor Validator。

---

## 0. 已批准设计与范围边界

### 0.1 当前问题

当前 `analyzeContentV2` 的行为是：

```text
初次生成
  ↓ 解析 / Schema / Anchor 校验失败
一次 AI repair
  ↓ 仍失败
AI_INVALID_RESPONSE → Side Panel 显示“请重新生成”
```

截图中的错误：

```text
structure[8].sourceQuote not found in block B015
structure[9].sourceQuote not found in block B017
```

说明 AI 给出了存在于输入中的 Block ID，但 `sourceQuote` 不是该 Block 的精确子串。用户手动重新生成后成功，证明一次全新的模型输出可以恢复，但当前产品把这一步留给了用户。

### 0.2 方案比较

| 方案 | 优点 | 风险 | 结论 |
|---|---|---|---|
| 只再调用一次 AI repair | 改动最少 | 与现有失败模式相同，模型可能继续修补错误输出 | 不采用 |
| 无条件把 Quote 换成对应 Block 的开头 | 几乎总能通过 Validator | 可能把错误 Block ID“洗白”，造成错误导航 | 不采用 |
| 高置信度本地重匹配 + 一次 repair + 一次全新生成 | 能零费用修复轻微改写；不确定时保持严格；最终自动替代一次人工点击 | 单次主动操作最坏增加到 3 次 AI 请求 | **采用** |

用户已经明确批准第三种方案。本计划不得把本地重匹配改成“随便取 Block 中任意一句”。

### 0.3 固定请求状态机

```text
Stage 1: INITIAL
  Provider 请求 #1（原始 system + user prompt）
  → parseVisualSummaryV2
  → recoverVisualSummaryAnchors（仅高置信度本地修复）
  → validateVisualSummaryAnchors
  → 通过：返回并缓存
  → 校验失败：进入 Stage 2

Stage 2: REPAIR
  Provider 请求 #2（原 prompt + 具体问题 + 上次输出）
  → 同一套 parse → local recovery → validate
  → 通过：返回并缓存
  → 校验失败：进入 Stage 3

Stage 3: FRESH
  Provider 请求 #3（重新使用原始 system + user prompt，不携带旧输出）
  → 同一套 parse → local recovery → validate
  → 通过：返回并缓存
  → 校验失败：AI_INVALID_RESPONSE，显示最终诊断和“重新生成”
```

### 0.4 请求和费用边界

- 初次输出合法：1 次 Provider 请求。
- 初次 Quote 仅有轻微改写且本地成功恢复：仍为 1 次。
- 初次无法本地恢复、repair 成功：2 次。
- repair 仍失败：最多 3 次。
- 第三次请求必须是完整 fresh generation，不携带 repair 错误列表或旧输出。
- 不允许第四次请求，不允许递归重试，不允许无限循环。
- HTTP 401/403/404/429/5xx、网络失败或超时不触发本功能的额外重试，继续使用现有稳定错误码。
- 三个阶段继续共享当前一次分析的 30 秒 `AbortController` 总时间预算；本任务不把最坏等待时间扩展为 90 秒。
- README 必须披露：一次用户主动生成在输出不合规时可能触发最多 3 次 AI 请求并产生相应费用。

### 0.5 本地 Quote 重匹配的安全合同

只在以下条件全部满足时替换 `sourceQuote`：

1. `sourceBlockId` 存在于本次 `input.sourceBlocks`；
2. 原 `sourceQuote` 不是该 Block 的精确子串；
3. 原 Quote 归一化后至少 6 个 code points，过短 Quote 不做模糊恢复；
4. 候选是对应 Block 中的精确原文子串，最长 140 code points；
5. 相似度最高候选分数 `>= 0.72`；
6. 最高候选领先第二名至少 `0.08`，避免歧义；
7. 候选 Quote 只出现在一个 sent Source Block 中，仍满足现有唯一性校验；
8. 替换后必须重新运行 `validateVisualSummaryAnchors`，本地恢复不能绕过 Validator。

本地恢复只能修改 `structure[i].sourceQuote`，不得修改：

- `sourceBlockId`；
- structure title；
- summary；
- keyPoints；
- Source Block 文本；
- 输入对象。

### 0.6 比较归一化与候选生成

比较文本允许以下归一化，但返回的 Quote 必须仍是原 Block 中的精确子串：

```ts
function comparisonText(raw: string): string {
  return normalizeBlockText(raw)
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, '');
}
```

候选按以下顺序从对应 Block 生成并去重：

1. 强句末切分：`。！？!?；;`，标点保留在候选内；
2. 对仍超过 140 code points 的长句按弱标点 `，,、：:` 切分；
3. 对仍超过 140 的片段按 140 code points 固定窗口切分；
4. 丢弃归一化后少于 6 code points 的候选；
5. 所有候选必须能由 `block.text.includes(candidate)` 证明是精确原文。

相似度使用 Unicode code point bigram Sørensen–Dice：

```text
score = 2 × multisetIntersection(bigrams(a), bigrams(b))
        / (bigramCount(a) + bigramCount(b))
```

单字符或空比较文本不做模糊匹配。不得引入第三方 fuzzy-search 依赖。

### 0.7 明确不做

- 不降低或删除严格 Anchor 校验；
- 不在多个 Block 之间猜测新的 `sourceBlockId`；
- 不用 structure title 反向猜 Block；
- 不把任意 Block 开头作为兜底 Quote；
- 不缓存未通过校验的结果；
- 不在 Side Panel 自动重新触发新的 Background 任务；
- 不修改页面抓取、Source Block 编号或原文导航算法；
- 不修改字幕功能、AI 字幕翻译或 B 站 WBI；
- 不新增 npm 依赖；
- 不 merge、push、创建 PR 或修改 `main`。

### 0.8 完成定义

- 轻微标点、空格、全半角差异可在本地恢复，且不增加 AI 请求；
- 低相似度、歧义、错误 Block ID 不会被本地“强行修好”；
- repair 失败后自动 fresh generation 一次；
- fresh 成功后用户不再看到错误卡；
- fresh 仍失败时才显示最终错误和“重新生成”；
- 一次分析 Provider 请求数严格 `<= 3`；
- Provider/网络错误不被错误重试；
- 成功结果才写缓存；
- 旧 V1 `analyzeContent` 行为不变；
- 自动化门禁全绿；
- 三个既有保护文件哈希不变且不进入提交；
- 真实 Chrome/API 验收已完成，或如实标为未验证。

---

## 1. 文件结构与责任边界

### 1.1 新建文件

- `src/analysis/anchor-recovery.ts`
  - 只负责纯本地、确定性、无副作用的 Quote 候选生成、相似度计算和高置信度恢复。
  - 不发网络请求、不写缓存、不抛 Provider 错误。

- `tests/anchor-recovery.test.ts`
  - 独立锁定恢复安全合同，不依赖 fetch 或 Background。

- `docs/progress/2026-08-30-visual-summary-anchor-auto-recovery.md`
  - 保存红灯、请求次数、门禁、审查和人工验收证据。

### 1.2 修改文件

- `src/analysis/schema.ts`
  - 将既有 `MAX_SOURCE_QUOTE_CHARS = 140` 导出，恢复模块与 Schema 共用一个上限。

- `src/analysis/client.ts`
  - 接入统一 parse/recover/validate 门；把 V2 两阶段循环改为最多三阶段状态机；更新安全诊断。

- `tests/ai-client.test.ts`
  - 锁定 1/2/3 次请求路径、fresh request 内容、最终错误和非校验错误不重试。

- `tests/background.test.ts`
  - 锁定 Background 只有最终 done/error、成功才缓存、force 行为不变。

- `tests/sidepanel.test.ts`
  - 只补最终三阶段失败后仍显示现有“重新生成”的回归测试；原则上不改生产 Side Panel。

- `README.md`
  - 披露本地恢复、最多三次请求和费用边界。

### 1.3 原则上不修改

- `src/background/visual-summary.ts`
- `src/sidepanel/sidepanel.ts`
- `src/analysis/cache.ts`
- `src/analysis/prompt.ts`
- `src/analysis/source-blocks.ts`
- 所有 `src/adapters/**/source.ts`
- 所有字幕相关文件

新增测试如果在不改这些文件时通过，就保持零修改。只有测试证明真实调用方缺口时才允许最小改动，并在进度报告中解释。

### 1.4 必须保护的既有未提交文件

当前工作树预计仍有：

- `src/adapters/bilibili/subtitle-service.ts`
- `tests/adapters/bilibili-subtitle-service.test.ts`
- `tests/adapters/bilibili.test.ts`

它们属于此前 B 站 WBI/字幕任务。本任务不得回退、覆盖、格式化、暂存或提交它们；不得使用 `git stash`、`git clean`、`git checkout --` 或 `git reset`。每次提交必须使用精确 pathspec，禁止 `git add .` 和 `git add -A`。

---

## Task 0：确认工作树、基线和保护证据

**Files:**

- Read only: Git state and current implementation
- Create: `docs/progress/2026-08-30-visual-summary-anchor-auto-recovery.md`

- [x] **Step 1: 进入正确工作树并核对分支**

```powershell
Set-Location -LiteralPath 'C:\Users\HP\OneDrive\桌面\example\clip2md\.worktrees\bilibili-subtitle-sidepanel'
git branch --show-current
git rev-parse --short HEAD
git status --short
```

Expected:

- branch 为 `codex/bilibili-subtitle-sidepanel`；
- 计划编写时 HEAD 为 `36d11f9`，若已前移则先审查新增提交；
- 只有第 1.4 节三个保护文件和本计划/本任务文档修改；
- 无来源不明修改。

- [x] **Step 2: 记录保护文件 SHA256 与 diff**

```powershell
git diff -- src/adapters/bilibili/subtitle-service.ts tests/adapters/bilibili-subtitle-service.test.ts tests/adapters/bilibili.test.ts
Get-FileHash -Algorithm SHA256 -LiteralPath 'src/adapters/bilibili/subtitle-service.ts','tests/adapters/bilibili-subtitle-service.test.ts','tests/adapters/bilibili.test.ts'
```

计划编写时参考哈希：

```text
D13CE7BB7C8070D8EA29FB96F3F26FCFF0EB5A4DEC1EB0040BA37FED07B2FBBE  src/adapters/bilibili/subtitle-service.ts
D3002CB2E7429CD9BDEC2FABFFFEF2E8B632ECF2C5853021796975A6B762E21E  tests/adapters/bilibili-subtitle-service.test.ts
96E0DB754D987834D62103AEDD2BDE387CB57117A0F74A821D8245E0EB308CA7  tests/adapters/bilibili.test.ts
```

若实际开始哈希不同，不要回退；以开始时实际哈希为保护基线，并记录原因。

- [x] **Step 3: 运行完整基线**

```powershell
npm test
npm run typecheck
npm run build
git diff --check
```

Expected：计划编写时参考基线为 38 文件、613 测试全过；typecheck/build/diff-check 退出码 0。若 Vitest/esbuild 在沙箱内报 `spawn EPERM`，在获得执行权限后原样重跑，不得把环境启动失败当成产品测试失败。

- [x] **Step 4: 创建进度报告骨架**

创建：

```md
# 一图速览 Anchor 自动恢复进度报告

## 一、目标与非目标
## 二、开始状态与保护文件哈希
## 三、设计合同与请求上限
## 四、TDD 红灯证据
## 五、实现摘要
## 六、自动化门禁
## 七、独立审查与处置
## 八、Chrome/API 验收
## 九、未验证项与已知限制
## 十、提交记录和最终状态
```

- [x] **Step 5: 如需提交计划与报告骨架，只暂存精确文件**

```powershell
git add -- docs/superpowers/plans/2026-08-30-visual-summary-anchor-auto-recovery.md docs/progress/2026-08-30-visual-summary-anchor-auto-recovery.md
git diff --cached --name-only
git diff --cached --check
git commit -m "docs: plan visual summary anchor auto recovery"
```

Expected：暂存区只有两个文档，绝不包含保护文件。

---

## Task 1：用纯函数测试锁定保守重匹配合同

**Files:**

- Create: `tests/anchor-recovery.test.ts`
- Create later: `src/analysis/anchor-recovery.ts`
- Modify later: `src/analysis/schema.ts`

- [x] **Step 1: 写测试 fixture 与导入**

```ts
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
```

- [x] **Step 2: 写“两个错误 Quote 均恢复为对应 Block 原句”的失败测试**

```ts
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
```

- [x] **Step 3: 写“合法 Quote 零修改”的失败测试**

```ts
it('已经合法的 summary 原样返回，不重写 anchor', () => {
  const original = summary([
    { title: '验证需求', sourceBlockId: 'B015', sourceQuote: '先验证真实需求' },
  ]);

  expect(recoverVisualSummaryAnchors(original, INPUT)).toBe(original);
});
```

- [x] **Step 4: 写归一化差异测试**

至少使用三个独立用例：

```ts
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
```

- [x] **Step 5: 写四个必须拒绝猜测的测试**

分别断言返回对象/条目未被更改，并且 Validator 仍能看见问题：

```ts
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
```

这些测试必须写出完整 fixture 和精确 expected，不能只检查 truthy/falsy。

- [x] **Step 6: 写短 Quote、长 Block 与不可变性测试**

覆盖：

- 归一化后少于 6 code points：不做 fuzzy recovery；
- 强句末候选保留标点且为 Block 精确子串；
- 超过 140 codepoints 的长句会产生不超过 140 的候选；
- Unicode 扩展字符按 code point 计数；
- `summary`、`input`、`sourceBlocks` 不被原地修改；
- 无 sourceBlocks、无 anchors 时返回原对象；
- 一条恢复成功、另一条失败时只替换成功项，最终 Validator 仍拒绝整体结果。

- [x] **Step 7: 运行测试并保存红灯**

```powershell
npx vitest run tests/anchor-recovery.test.ts
```

Expected：FAIL，原因是 `src/analysis/anchor-recovery.ts` 尚不存在，而不是测试语法或 fixture 错误。把命令、失败原因和时间写入进度报告。

- [x] **Step 8: 提交测试合同**

```powershell
git add -- tests/anchor-recovery.test.ts docs/progress/2026-08-30-visual-summary-anchor-auto-recovery.md
git diff --cached --name-only
git diff --cached --check
git commit -m "test: define conservative visual anchor recovery"
```

---

## Task 2：实现确定性 Anchor 恢复模块

**Files:**

- Create: `src/analysis/anchor-recovery.ts`
- Modify: `src/analysis/schema.ts`
- Test: `tests/anchor-recovery.test.ts`

- [x] **Step 1: 从 Schema 导出唯一 Quote 上限**

将：

```ts
const MAX_SOURCE_QUOTE_CHARS = 140;
```

改为：

```ts
export const MAX_SOURCE_QUOTE_CHARS = 140;
```

不得改变 `parseVisualSummaryV2` 的截断行为。

- [x] **Step 2: 建立模块类型和比较归一化**

```ts
import { normalizeBlockText } from './source-blocks';
import { MAX_SOURCE_QUOTE_CHARS } from './schema';
import type {
  AnalysisInput,
  AnalysisSourceBlock,
  VisualStructureItem,
  VisualSummaryV2,
} from './types';

const MIN_COMPARISON_CHARS = 6;
const MIN_RECOVERY_SCORE = 0.72;
const MIN_SCORE_MARGIN = 0.08;
const STRONG_END = new Set(['。', '！', '？', '!', '?', '；', ';']);
const WEAK_END = new Set(['，', ',', '、', '：', ':']);

function comparisonText(raw: string): string {
  return normalizeBlockText(raw)
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, '');
}
```

`NFKC` 只用于比较，绝不能作为返回给 UI/导航的 Quote。

- [x] **Step 3: 实现 code point 安全的候选生成**

实现私有函数：

```ts
function splitAtBoundaries(text: string, boundaries: ReadonlySet<string>): string[] {
  const chars = Array.from(text);
  const pieces: string[] = [];
  let start = 0;
  for (let i = 0; i < chars.length; i += 1) {
    if (!boundaries.has(chars[i]!)) continue;
    const piece = chars.slice(start, i + 1).join('').trim();
    if (piece) pieces.push(piece);
    start = i + 1;
  }
  const tail = chars.slice(start).join('').trim();
  if (tail) pieces.push(tail);
  return pieces;
}

function hardChunks(text: string): string[] {
  const chars = Array.from(text);
  const chunks: string[] = [];
  for (let start = 0; start < chars.length; start += MAX_SOURCE_QUOTE_CHARS) {
    const chunk = chars.slice(start, start + MAX_SOURCE_QUOTE_CHARS).join('').trim();
    if (chunk) chunks.push(chunk);
  }
  return chunks;
}

function collectQuoteCandidates(blockText: string): string[] {
  const candidates: string[] = [];
  const strongPieces = splitAtBoundaries(blockText, STRONG_END);
  for (const strongPiece of strongPieces.length > 0 ? strongPieces : [blockText.trim()]) {
    if (Array.from(strongPiece).length <= MAX_SOURCE_QUOTE_CHARS) {
      candidates.push(strongPiece);
      continue;
    }
    const weakPieces = splitAtBoundaries(strongPiece, WEAK_END);
    for (const weakPiece of weakPieces.length > 0 ? weakPieces : [strongPiece]) {
      if (Array.from(weakPiece).length <= MAX_SOURCE_QUOTE_CHARS) {
        candidates.push(weakPiece);
      } else {
        candidates.push(...hardChunks(weakPiece));
      }
    }
  }

  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (seen.has(candidate)) return false;
    seen.add(candidate);
    return Array.from(comparisonText(candidate)).length >= MIN_COMPARISON_CHARS
      && Array.from(candidate).length <= MAX_SOURCE_QUOTE_CHARS
      && blockText.includes(candidate);
  });
}
```

固定要求：

- 使用 `Array.from` 计算和切分；
- 先在强句末处分段并保留结束标点；
- 超长候选再尝试弱标点；
- 仍超长时从左到右按 140 codepoints 切分；
- `trim()` 只移除候选边界空白；
- 过滤空候选和归一化后少于 6 codepoints 的候选；
- 通过 `Set<string>` 稳定去重，保持首次出现顺序；
- 最后使用 `blockText.includes(candidate)` 过滤，保证每个候选都是原文精确子串。

不得生成跨 Block 候选。

- [x] **Step 4: 实现 bigram Dice**

```ts
function bigramCounts(value: string): Map<string, number> {
  const chars = Array.from(value);
  const counts = new Map<string, number>();
  for (let i = 0; i < chars.length - 1; i += 1) {
    const gram = `${chars[i]}${chars[i + 1]}`;
    counts.set(gram, (counts.get(gram) ?? 0) + 1);
  }
  return counts;
}

function diceSimilarity(left: string, right: string): number {
  const a = comparisonText(left);
  const b = comparisonText(right);
  if (a === b && Array.from(a).length >= MIN_COMPARISON_CHARS) return 1;
  if (Array.from(a).length < 2 || Array.from(b).length < 2) return 0;

  const aCounts = bigramCounts(a);
  const bCounts = bigramCounts(b);
  let intersection = 0;
  for (const [gram, count] of aCounts) {
    intersection += Math.min(count, bCounts.get(gram) ?? 0);
  }
  const aTotal = [...aCounts.values()].reduce((sum, count) => sum + count, 0);
  const bTotal = [...bCounts.values()].reduce((sum, count) => sum + count, 0);
  return (2 * intersection) / (aTotal + bTotal);
}
```

测试不得通过把阈值降低到容易误配的水平。

- [x] **Step 5: 实现唯一高置信度候选选择**

```ts
function findReplacementQuote(
  quote: string,
  block: AnalysisSourceBlock,
  allBlocks: AnalysisSourceBlock[],
): string | null {
  if (Array.from(comparisonText(quote)).length < MIN_COMPARISON_CHARS) return null;

  const ranked = collectQuoteCandidates(block.text)
    .map((candidate, order) => ({ candidate, order, score: diceSimilarity(quote, candidate) }))
    .sort((a, b) => b.score - a.score || a.order - b.order);

  const best = ranked[0];
  const second = ranked[1];
  if (!best || best.score < MIN_RECOVERY_SCORE) return null;
  if (second && best.score - second.score < MIN_SCORE_MARGIN) return null;
  if (allBlocks.filter((item) => item.text.includes(best.candidate)).length !== 1) return null;
  return best.candidate;
}
```

排序相同分数时必须保持候选原文顺序，不得随机。

- [x] **Step 6: 实现公开纯函数**

```ts
function hasAnchor(
  item: VisualStructureItem,
): item is Extract<VisualStructureItem, { sourceBlockId: string; sourceQuote: string }> {
  return item.sourceBlockId !== undefined && item.sourceQuote !== undefined;
}

export function recoverVisualSummaryAnchors(
  summary: VisualSummaryV2,
  input: AnalysisInput,
): VisualSummaryV2 {
  if (input.sourceBlocks.length === 0) return summary;
  const byId = new Map(input.sourceBlocks.map((block) => [block.id, block]));
  let changed = false;

  const structure = summary.structure.map((item) => {
    if (!hasAnchor(item)) return item;
    const block = byId.get(item.sourceBlockId);
    if (!block || block.text.includes(item.sourceQuote)) return item;
    const replacement = findReplacementQuote(item.sourceQuote, block, input.sourceBlocks);
    if (!replacement) return item;
    changed = true;
    return { ...item, sourceQuote: replacement };
  });

  return changed ? { ...summary, structure } : summary;
}
```

- [x] **Step 7: 运行恢复模块与 Schema 测试**

```powershell
npx vitest run tests/anchor-recovery.test.ts tests/analysis-schema.test.ts
```

Expected：全部通过，原 Schema 严格性测试不回退。

- [x] **Step 8: 提交恢复模块**

```powershell
git add -- src/analysis/anchor-recovery.ts src/analysis/schema.ts tests/anchor-recovery.test.ts docs/progress/2026-08-30-visual-summary-anchor-auto-recovery.md
git diff --cached --name-only
git diff --cached --check
git commit -m "feat: recover visual summary quotes from source blocks"
```

---

## Task 3：以 TDD 把 V2 Client 扩展为三阶段状态机

**Files:**

- Modify: `tests/ai-client.test.ts`
- Modify later: `src/analysis/client.ts`

- [x] **Step 1: 添加“初次输出本地恢复，仅一次请求”测试**

构造初次 JSON：Block ID 正确，但 Quote 只有标点/空白轻微差异。断言：

```ts
const result = await analyzeContentV2(V2_INPUT, SETTINGS);
expect(result.structure[0]?.sourceQuote).toBe('这是第一段正文。');
expect(fetchMock).toHaveBeenCalledTimes(1);
expect(validateVisualSummaryAnchors(result, V2_INPUT)).toEqual([]);
```

- [x] **Step 2: 保留“首次失败、repair 成功，两次请求”测试**

沿用 `B999` 初次输出和合法 repair 输出。断言仍为 2 次，证明本地恢复不猜 Block ID。

- [x] **Step 3: 将旧“repair 失败最多两次”测试改成“fresh 成功三次”红灯**

Mock 顺序：

1. 初次：`B999`；
2. repair：`B001` 但 Quote 为“仍然不存在”；
3. fresh：`V2_VALID`。

断言：

```ts
expect(await analyzeContentV2(V2_INPUT, SETTINGS)).toEqual(V2_VALID);
expect(fetchMock).toHaveBeenCalledTimes(3);
```

当前实现应在第二次后抛错，因此测试必须先红。

- [x] **Step 4: 添加“第三次是全新原始请求”测试**

解析三个 fetch body：

```ts
const bodies = fetchMock.mock.calls.map(([, init]) => JSON.parse(init?.body as string));
expect(bodies[2].messages).toEqual(bodies[0].messages);
expect(bodies[2].messages[0].content).not.toContain('你上次的输出');
expect(bodies[2].messages[0].content).not.toContain('具体错误如下');
```

DeepSeek V4 下三个请求都必须保持：

```ts
expect(body.response_format).toEqual({ type: 'json_object' });
expect(body.max_tokens).toBe(4096);
```

- [x] **Step 5: 添加“repair 输出可被本地恢复，无第三次请求”测试**

初次使用不可修复 `B999`；repair 使用正确 `B001` 但轻微改写 Quote。期望本地恢复后成功，fetch 恰好 2 次。

- [x] **Step 6: 添加“fresh 输出也经过本地恢复”测试**

前两次不可修复；第三次 Block ID 正确、Quote 有轻微差异。期望第三阶段本地恢复后返回严格合法结果。

- [x] **Step 7: 添加“三次均失败才最终报错”测试**

Mock 三个不同的非法输出，断言：

```ts
expect(error).toMatchObject({ code: 'AI_INVALID_RESPONSE' });
expect(error.message).toContain('首次校验');
expect(error.message).toContain('自动修复后');
expect(error.message).toContain('全新生成后');
expect(error.message).toContain('请重新生成');
expect(fetchMock).toHaveBeenCalledTimes(3);
```

错误不得包含完整 Provider 响应正文、API Key 或超长不受信任 Block ID。

- [x] **Step 8: 添加 Provider 错误不自动重试测试**

至少覆盖：

- 初次 401：1 次请求，`AI_AUTH_FAILED`；
- 初次 429：1 次请求，`AI_RATE_LIMITED`；
- repair 阶段网络失败：总计 2 次，不进入 fresh；
- fresh 阶段 5xx：总计 3 次，`AI_PROVIDER_ERROR`；
- 共享 AbortController 超时：不突破 30 秒总预算。

- [x] **Step 9: 运行目标测试并记录红灯**

```powershell
npx vitest run tests/ai-client.test.ts
```

Expected：新增本地恢复/第三阶段用例失败；现有合法、HTTP、V1 repair 测试继续通过。

- [x] **Step 10: 提交 Client 红灯测试**

```powershell
git add -- tests/ai-client.test.ts docs/progress/2026-08-30-visual-summary-anchor-auto-recovery.md
git diff --cached --name-only
git diff --cached --check
git commit -m "test: define three-stage visual summary recovery"
```

---

## Task 4：实现统一验收门和最多一次 fresh generation

**Files:**

- Modify: `src/analysis/client.ts`
- Test: `tests/ai-client.test.ts`

- [x] **Step 1: 更新文件头约束**

把“最多一次 repair”说明改成：

```ts
 * - V1 最多一次 repair；V2 先本地恢复，再允许一次 repair 和一次 fresh generation；
 * - V2 单次主动分析最多三次 Provider 请求，三阶段共享 30 秒总超时；
```

- [x] **Step 2: 导入恢复函数并建立统一验收门**

```ts
import { recoverVisualSummaryAnchors } from './anchor-recovery';

function parseRecoverAndValidateV2(content: string, input: AnalysisInput): VisualSummaryV2 {
  const parsed = parseContentV2(content);
  const recovered = recoverVisualSummaryAnchors(parsed, input);
  const problems = validateVisualSummaryAnchors(recovered, input);
  if (problems.length > 0) throw new VisualSummaryValidationError(problems);
  return recovered;
}
```

三个阶段必须调用同一个函数，禁止第三阶段绕过本地恢复或 Validator。

- [x] **Step 3: 将安全诊断扩展为三个阶段**

将两参数 `invalidResponseMessage` 改为明确三阶段：

```ts
function invalidResponseMessage(
  firstProblems: string[],
  repairedProblems: string[],
  freshProblems: string[],
): string {
  const format = (problems: string[]) => problems.map(safeDiagnosticProblem).join('；');
  return `AI 返回的分析结果未通过校验。首次校验：${format(firstProblems)}。`
    + `自动修复后：${format(repairedProblems)}。`
    + `全新生成后：${format(freshProblems)}。请重新生成。`;
}
```

保留现有单条诊断 240 codepoints 截断和 Block ID 脱敏。

- [x] **Step 4: 用明确阶段变量替代两次循环**

实现结构应保持线性：

```ts
export async function analyzeContentV2(
  input: AnalysisInput,
  settings: AiSettings,
): Promise<VisualSummaryV2> {
  const prompt = buildAnalysisPromptV2(input);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  const initialMessages: AiChatMessage[] = [
    { role: 'system', content: prompt.system },
    { role: 'user', content: prompt.user },
  ];

  try {
    const firstContent = await requestCompletion(
      settings,
      initialMessages,
      controller.signal,
      { structuredOutput: true },
    );
    try {
      return parseRecoverAndValidateV2(firstContent, input);
    } catch (firstError) {
      const firstProblems = validationProblems(firstError);
      if (!firstProblems) throw invalidV2Response();

      const repairMessages: AiChatMessage[] = [
        { role: 'system', content: `${prompt.system}\n\n${buildRepairPromptV2(firstProblems, firstContent)}` },
        { role: 'user', content: prompt.user },
      ];
      const repairedContent = await requestCompletion(
        settings,
        repairMessages,
        controller.signal,
        { structuredOutput: true },
      );
      try {
        return parseRecoverAndValidateV2(repairedContent, input);
      } catch (repairedError) {
        const repairedProblems = validationProblems(repairedError);
        if (!repairedProblems) throw invalidV2Response();

        const freshContent = await requestCompletion(
          settings,
          initialMessages,
          controller.signal,
          { structuredOutput: true },
        );
        try {
          return parseRecoverAndValidateV2(freshContent, input);
        } catch (freshError) {
          const freshProblems = validationProblems(freshError);
          if (!freshProblems) throw invalidV2Response();
          throw new VisualAnalysisRequestError(
            'AI_INVALID_RESPONSE',
            invalidResponseMessage(firstProblems, repairedProblems, freshProblems),
          );
        }
      }
    }
  } finally {
    clearTimeout(timer);
  }
}
```

其中：

```ts
function invalidV2Response(): VisualAnalysisRequestError {
  return new VisualAnalysisRequestError(
    'AI_INVALID_RESPONSE',
    'AI 返回的分析结果无法解析或原文引用不符，请重新生成。',
  );
}
```

不要用递归调用 `analyzeContentV2`，否则请求上限和超时难以证明。

- [x] **Step 5: 运行 Client 测试至全绿**

```powershell
npx vitest run tests/ai-client.test.ts tests/anchor-recovery.test.ts tests/analysis-schema.test.ts
```

Expected：全部通过；成功路径请求数分别精确为 1、2、3；最终失败精确为 3。

- [x] **Step 6: 检查 V1 未变化**

在 `tests/ai-client.test.ts` 保留/补充：V1 初次非法、repair 仍非法时仍最多 2 次，不启用 anchor recovery 或 fresh generation。

- [x] **Step 7: 提交 Client 实现**

```powershell
git add -- src/analysis/client.ts tests/ai-client.test.ts docs/progress/2026-08-30-visual-summary-anchor-auto-recovery.md
git diff --cached --name-only
git diff --cached --check
git commit -m "feat: retry invalid visual summaries with fresh generation"
```

---

## Task 5：锁定 Background、缓存和 Side Panel 回归

**Files:**

- Modify: `tests/background.test.ts`
- Modify: `tests/sidepanel.test.ts`
- Modify only if a failing test proves necessary: `src/background/visual-summary.ts`, `src/sidepanel/sidepanel.ts`

- [x] **Step 1: 添加 Background 本地恢复成功测试**

让提取结果提供 `B001: 正文内容。`，Provider 首次返回 `sourceQuote: "正文 内容!"`。通过 `START_VISUAL_ANALYSIS` 后断言：

- fetch 1 次；
- session state 最终为 `done`；
- state.result 中 Quote 是 `正文内容。`；
- 缓存写入的是恢复后的严格合法结果；
- 状态序列仍为 `extracting → analyzing → done`。

- [x] **Step 2: 添加 repair 失败、fresh 成功的 Background 测试**

Mock 三次输出：初次 `B999`、repair `B998`、fresh 合法。断言：

- fetch 恰好 3 次；
- 不写中间 `error` state；
- 最终只有一个 `done`；
- 最终结果被缓存；
- 再次非 force 启动命中缓存，不产生第 4 次请求。

- [x] **Step 3: 添加三次失败不缓存测试**

三次均返回非法 Anchor，断言：

- 最终 state 为 `error`、code 为 `AI_INVALID_RESPONSE`；
- message 含三阶段诊断；
- 缓存没有 done result；
- fetch 恰好 3 次。

- [x] **Step 4: 保持 force 与请求隔离**

补充断言：

- `force: true` 仍只表示绕过已有缓存，不能突破单次三请求上限；
- 两次独立用户点击各自拥有自己的 1~3 请求预算；
- requestId/标签页变化的既有竞态测试继续通过；
- 自动 fresh 不创建第二个 Background requestId。

- [x] **Step 5: 添加 Side Panel 最终错误按钮回归**

给 Side Panel 一个最终 `AI_INVALID_RESPONSE` state，断言：

```ts
expect(document.querySelector('#status-action')?.textContent).toBe('重新生成');
```

中间 repair/fresh 不会写 error state，因此不得新增中间按钮或 UI 状态。

- [x] **Step 6: 运行集成回归**

```powershell
npx vitest run tests/background.test.ts tests/sidepanel.test.ts tests/visual-summary.test.ts tests/analysis-cache.test.ts
```

Expected：全部通过。如果无需修改生产 Background/Side Panel，则保持它们零修改。

- [x] **Step 7: 提交集成测试**

```powershell
git add -- tests/background.test.ts tests/sidepanel.test.ts docs/progress/2026-08-30-visual-summary-anchor-auto-recovery.md
git diff --cached --name-only
git diff --cached --check
git commit -m "test: cover visual summary recovery integration"
```

若生产文件确有最小修复，使用精确 pathspec 加入，并在报告中解释测试证据。

---

## Task 6：文档、隐私费用检查和独立审查

**Files:**

- Modify: `README.md`
- Modify: `docs/progress/2026-08-30-visual-summary-anchor-auto-recovery.md`

- [x] **Step 1: 更新 README 使用与费用披露**

在一图速览“使用要点”增加：

```md
- **失败自动恢复**：如果 AI 返回的原文短引用只有轻微标点或空格差异，扩展会先在本地 Source Block 中保守重匹配；输出仍不合规时会自动 repair，并最多再完整生成一次。正常成功只请求一次，单次主动生成最多可能产生 3 次 AI 请求及相应费用。
```

保留“只有用户主动触发才发送正文”的语义：三阶段都属于同一次用户主动操作，不得改写成后台自动分析页面。

- [x] **Step 2: 完成进度报告**

必须记录：

- 1/2/3 请求路径对应测试；
- 本地匹配阈值和拒绝猜测用例；
- repair/fresh request body 差异；
- 30 秒共享总超时；
- 成功/失败缓存行为；
- Provider 错误不重试；
- 保护文件前后哈希；
- 自动化门禁实际数量；
- Chrome/API 验收或未验证原因。

- [x] **Step 3: 运行全量门禁**

```powershell
npm test
npm run typecheck
npm run build
git diff --check
```

Expected：全部退出码 0。记录实际文件数和测试数，不沿用旧的 38/613。

- [x] **Step 4: 做请求上限与敏感信息专项检查**

通过测试和 diff 确认：

- 任一单次 `analyzeContentV2` 最多 3 次 fetch；
- 初次合法/本地恢复成功为 1 次；
- API Key 不进入 diagnostics、cache、state、DOM、日志；
- Provider 原始响应正文不进入最终错误；
- 只有通过 `validateVisualSummaryAnchors` 的结果可写缓存；
- fresh request 不携带上次输出；
- 不存在递归重试。

执行：

```powershell
rg -n "apiKey|Authorization|lastOutput|requestCompletion|analyzeContentV2" src/analysis src/background tests/ai-client.test.ts tests/background.test.ts
```

逐项人工判读，不能只以“有/无命中”代替审查。

- [x] **Step 5: 请求独立代码审查**

审查重点：

1. fuzzy recovery 是否可能把错误 Block ID 洗白；
2. 短 Quote、重复 Quote、跨 Block 重复是否保守失败；
3. Unicode、NFKC、标点删除是否只用于比较；
4. 返回 Quote 是否始终是原文精确子串且不超过 140 codepoints；
5. 所有阶段是否重新走严格 Validator；
6. 是否存在第 4 次请求、递归或超时泄漏；
7. 网络/鉴权/限流是否被不当重试；
8. fresh 是否真的不带旧输出；
9. 缓存和 requestId 竞态是否保持；
10. 三个保护文件是否未进入提交。

所有 Critical/Important 必须修复并复跑全量门禁；Minor 要么修复，要么在报告中写明理由。

执行结果（2026-08-30）：已由独立 Codex 任务完成只读代码审查，结论为 0 Critical、0 Important，无需修改生产代码。审查确认 anchor 只改 `sourceQuote`、候选和相似度门槛、INITIAL/REPAIR/FRESH 共用验收门、最多 3 次线性请求、Provider 错误不进入 FRESH、以及 Background/SidePanel/Cache 生产代码未改动。审查时自动门禁为 39 个测试文件 / 643 个测试通过，typecheck、build、`git diff --check` 均通过。此前代理运行时阻塞的尝试仅作为历史记录保留，详见进度报告 §七。

- [x] **Step 6: 文档收尾提交**

```powershell
git add -- docs/superpowers/plans/2026-08-30-visual-summary-anchor-auto-recovery.md docs/progress/2026-08-30-visual-summary-anchor-auto-recovery.md
git diff --cached --name-only
git diff --cached --check
git commit -m "docs: close visual recovery independent review"
```

本次独立审查没有 Critical/Important 发现，也没有审查修复代码；因此只提交上述两份文档，不暂存 README、生产代码、测试或三个保护文件。

---

## Task 7：真实验收与最终交付

**最终执行结果（2026-08-30）：Step 1–4 已由用户在真实 Chrome/API 环境完成人工验收并确认全部通过、无异常。** 用户的确认同时构成费用相关步骤已由用户自行授权并执行的证据；当前对话未附原始截图、Network 导出、Provider/model 名称或逐次请求数，进度报告 §八如实记录该证据边界。Step 5–8 亦已完成。

**Files:**

- Read built extension: `dist/`
- Modify: `docs/progress/2026-08-30-visual-summary-anchor-auto-recovery.md`

- [x] **Step 1: 构建并重新加载扩展**

```powershell
npm run build
```

在 `chrome://extensions` 重新加载当前工作树的 `dist`。确认没有加载主工作树或旧构建。

- [x] **Step 2: 使用截图视频做正常用户验收**

打开：

```text
https://www.bilibili.com/video/BV1eUhM6hEdn/
```

点击一次生成并观察：

- 若首次输出合法，正常显示且无额外可见错误；
- 若再次发生 Quote 校验差异，页面保持分析中并自动恢复，而不是第二阶段后立即显示错误卡；
- 最终成功时结构条目可正常定位；
- 只有三阶段都失败才出现“重新生成”。

真实 Provider 输出具有随机性，无法稳定触发三阶段，因此此步骤不能替代自动化请求次数测试。

- [x] **Step 3: 在明确授权费用后检查 Provider 请求数**

通过 DevTools Network 或用户 Provider 控制台记录一次主动操作的请求数。不得为了制造失败反复消耗用户额度。若没有费用授权，将此项标为未验证。

- [x] **Step 4: 记录人工证据**

报告记录：

- Chrome/扩展版本；
- 视频 BV；
- Provider/model；
- 是否首次成功；
- 实际请求数；
- 是否出现错误卡；
- 结构定位是否成功；
- 通过/失败/未验证及原因。

- [x] **Step 5: 最终保护文件哈希复核**

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath 'src/adapters/bilibili/subtitle-service.ts','tests/adapters/bilibili-subtitle-service.test.ts','tests/adapters/bilibili.test.ts'
```

必须与 Task 0 开始时一致。不同则停止交付并调查，不得直接回退用户修改。

- [x] **Step 6: 最后一次全量门禁**

在所有审查修复和文档更新后重新运行：

```powershell
npm test
npm run typecheck
npm run build
git diff --check
```

- [x] **Step 7: 核对范围和提交**

```powershell
git status --short
git log --oneline --decorate 36d11f9..HEAD
git diff --name-status 36d11f9..HEAD
git log --merges --oneline 36d11f9..HEAD
```

Expected：

- 只包含第 1 节允许的本任务文件；
- 三个保护文件仍仅为未提交修改；
- 无 merge commit；
- 未 push、未创建 PR、未修改 main。

- [x] **Step 8: 提交最终报告**

```powershell
git add -- docs/progress/2026-08-30-visual-summary-anchor-auto-recovery.md
git diff --cached --name-only
git diff --cached --check
git commit -m "docs: finalize visual anchor recovery verification"
```

- [x] **Step 9: 最终交付摘要必须包含**

1. branch、起始 HEAD、最终 HEAD；
2. 提交数量和逐提交说明；
3. 实际修改文件；
4. 1/2/3 请求路径验证结果；
5. 全量测试、typecheck、build、diff-check 实际结果；
6. 独立审查发现及处置；
7. Chrome/API 验收或未验证原因；
8. 本地 fuzzy recovery 的阈值和保守失败限制；
9. 最多 3 请求、共享 30 秒和费用披露；
10. 保护文件哈希前后一致；
11. 明确说明没有 merge、push、PR 或修改 main。

---

## 2. 建议提交序列

```text
docs: plan visual summary anchor auto recovery
test: define conservative visual anchor recovery
feat: recover visual summary quotes from source blocks
test: define three-stage visual summary recovery
feat: retry invalid visual summaries with fresh generation
test: cover visual summary recovery integration
docs: explain visual summary automatic recovery
fix: address visual anchor recovery review        # 仅有审查修复时
docs: finalize visual anchor recovery verification
```

每次提交前必须运行：

```powershell
git diff --cached --name-only
git diff --cached --check
```

禁止使用 `git add .`、`git add -A`。

---

## 3. 失败处理规则

### 3.1 本地匹配测试不稳定

- 检查候选顺序是否稳定；
- 相同分数以原文顺序排序；
- 不使用随机数、时间或 Provider；
- 不通过降低 `0.72`/`0.08` 阈值让 fixture 勉强通过；
- 调整 fixture 时必须保留一个明确成功和一个明确拒绝案例。

### 3.2 Quote 仍无法恢复

这是允许的保守失败：保持原结果进入 AI repair。不得为了提升恢复率猜新 Block ID、使用 title 匹配或取 Block 开头。

### 3.3 第三次请求未发生

确认第二次失败属于 JSON/Schema/Anchor 校验错误。若第二次是 401、429、5xx、网络或超时，按规格必须直接传播，不应 fresh。

### 3.4 三次请求超过 30 秒

共享 AbortController 会终止当前阶段并返回 `AI_TIMEOUT`。本任务不扩大超时；若产品后续决定为每阶段提供独立 30 秒，需要单独的 UX/费用设计，不在本计划中顺带修改。

### 3.5 Background 测试失败

先证明 `analyzeContentV2` 的 Promise、结果或错误是否符合合同。若 Background 已正确等待同一 Promise，就只改测试，不修改状态机。

### 3.6 真实 Provider 无法复现

随机输出不能作为自动恢复未完成的证据。以确定性单元/集成测试证明三阶段；人工验收只确认扩展真实加载与用户体验，并如实记录未触发路径。

---

## 4. 最终审查清单

- [x] 合法首次输出只请求一次。
- [x] 初次 Quote 本地恢复成功仍只请求一次。
- [x] 本地恢复只修改 Quote，不修改 Block ID 或分析内容。
- [x] 返回 Quote 是对应 Block 的精确子串。
- [x] 返回 Quote 不超过 140 codepoints。
- [x] 低相似度、过短、歧义和跨 Block 重复均保守失败。
- [x] 本地恢复后仍运行严格 Anchor Validator。
- [x] 初次校验失败后只有一次 repair。
- [x] repair 校验失败后只有一次 fresh generation。
- [x] fresh request 不携带旧输出或 repair 错误。
- [x] fresh 输出也运行本地恢复和严格 Validator。
- [x] 单次分析最多 3 次 Provider 请求。
- [x] HTTP/网络/鉴权/限流/超时不被本功能自动重试。
- [x] 三阶段共享现有 30 秒总时间预算。
- [x] 三阶段失败后错误诊断安全、有限且不泄露 Provider 正文/API Key。
- [x] 只有合法结果进入 session cache。
- [x] Background 不产生中间 error state 或第二 requestId。
- [x] Side Panel 最终仍提供“重新生成”。
- [x] V1 analyzeContent 仍最多一次 repair，不启用 fresh。
- [x] README 披露最多 3 次请求和费用。
- [x] 未修改 Source Block 提取、导航、字幕和 WBI。
- [x] 未增加依赖。
- [x] 全量测试、typecheck、build、diff-check 全绿。
- [x] 独立审查 Critical/Important 全部处置（0 Critical、0 Important，无需生产代码修复）。
- [x] 三个保护文件哈希未变且未进入提交。
- [x] Chrome/API 验收已记录或明确未验证。
- [x] 未 merge、push、PR 或修改 main。
