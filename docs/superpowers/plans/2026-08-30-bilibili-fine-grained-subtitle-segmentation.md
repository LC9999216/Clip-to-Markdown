# Bilibili Fine-Grained Subtitle Segmentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 B 站字幕侧栏从“十几秒一大段文字”改为“约 4 秒一小段、文字与该时间范围对应”，同时保持官方字幕、AI 翻译、点击跳转、播放高亮、缓存和失败回退等现有行为不变。

**Architecture:** 只重写 `groupTranscript` 的展示分段策略：逐条处理 B 站提供的源字幕行，绝不跨源行合并；在一条较长源字幕行内部按标点、空格和确定性的字符切点拆分，再按字符偏移比例把该源行的原始时间范围分配给子段。字幕页仍只消费 `BiliTranscriptSegment[]`，无需新增设置、消息协议、网络请求、AI 调用或第二套播放器同步逻辑。

**Tech Stack:** TypeScript、Chrome Extension Manifest V3、Vitest、现有 Bilibili 字幕适配器与字幕侧栏页面。

---

## 0. 交付边界与成功标准

### 0.1 本次必须解决的问题

当前侧栏会把多条相邻字幕聚合为一大段，且单段最长可达约 20 秒。用户看到的典型结果是：

- `00:00` 一大段；
- 下一段直接跳到 `00:14`；
- 再下一段是 `00:29`；
- 当前高亮、点击跳转和阅读粒度都过粗。

本次完成后应满足：

- 正常长字幕行被拆成约 4 秒一段；
- 一段只显示一句或一小段文字，而不是一整段文章；
- 每段文字只来自它所属的原始字幕行；
- 子段时间码覆盖原字幕行的时间范围，顺序连续且不重叠；
- 点击某段仍跳到该段起始时间；
- 播放到某段时间时只高亮对应短字幕；
- 原始字幕行之间存在静音或无字幕间隔时，不生成伪字幕填满空档；
- 官方中文字幕和“中文（AI）”虚拟轨使用相同的展示切分规则；
- 翻译请求次数、翻译缓存、失败缓存、刷新重试和轨道偏好行为不变。

### 0.2 明确不做的事情

本计划不包含：

- 不新增语音识别（ASR）或音频下载；
- 不修改 B 站字幕接口、WBI 签名或登录逻辑；
- 不修改 AI 翻译提示词、分批协议、费用开关或 Provider 调用；
- 不增加“字幕长度/秒数”设置项；
- 不改侧栏布局、字号、颜色或滚动样式；
- 不重新设计播放器桥接；
- 不 merge、push、创建 PR 或改动 `main`；
- 不顺手重构相邻模块。

### 0.3 精度边界

B 站源字幕通常只提供一整行的 `from`、`to` 和 `content`，没有逐字时间码。若一条 14 秒的源字幕被拆成 4 个子段，本实现只能按各子段所占字符比例分配时间：

```text
源行：0.0s ─────────────────────────── 14.0s
文字：第 1 小段 | 第 2 小段 | 第 3 小段 | 第 4 小段
时间：0~4s      | 4~8s      | 8~12s     | 12~14s
```

这会显著改善阅读和跳转粒度，但不是逐字语音对齐。只有 ASR 或平台提供词级时间码才能进一步精确；本任务不得暗示已经实现词级对齐。

### 0.4 完成定义

实现 Agent 只有在以下各项都满足时才能报告完成：

- 新旧单元测试全部通过；
- TypeScript 类型检查通过；
- 扩展构建通过；
- `git diff --check` 通过；
- 测试覆盖官方字幕、AI 翻译字幕、点击跳转、播放高亮和真实空档；
- 没有空文字展示段、重复文字或丢字；
- 没有跨源字幕行合并；
- 对字符密度足以细分的正常源行，展示段不超过 6 秒；
- 极稀疏源行例外被测试并记录；
- 现有 3 个未提交文件保持原样，没有被提交、回退或覆盖；
- 手工 Chrome 验收已执行，或在最终报告中明确标为“未验证”并附步骤。

---

## 1. 固定规格：短字幕如何切分

实现前先把以下规则当作验收合同，不要在编码时自行改变。

### 1.1 处理单位

- 输入仍是 `BiliSubtitleLine[]`。
- 每一条非空源字幕行独立处理。
- 禁止把第 N 条源字幕的尾部与第 N+1 条的开头合成一个展示段。
- 空白源行继续忽略。
- 源行之间的时间空档保持为空档。

### 1.2 固定阈值

在 `src/adapters/bilibili/transcript.ts` 内使用模块私有常量：

```ts
const TARGET_DURATION_SECONDS = 4;
const MAX_DURATION_SECONDS = 6;

const CJK_LIMITS = {
  minCut: 6,
  target: 24,
  max: 28,
} as const;

const LATIN_LIMITS = {
  minCut: 12,
  target: 56,
  max: 72,
} as const;
```

这些值不进入设置页。本次要解决的是明确的默认体验问题，不引入用户配置和迁移成本。

### 1.3 语言判断

- 沿用/收紧现有“包含汉字即按中文限制”的判定。
- 必须支持基本汉字和 Unicode 扩展汉字，例如 `U+20000`。
- 统一通过 `Array.from(text)` 按 Unicode code point 计数，禁止直接以 UTF-16 `text.length` 作为汉字数量。

建议保留一个模块私有函数：

```ts
function containsHan(text: string): boolean {
  return /\p{Script=Han}/u.test(text);
}
```

如果当前 TypeScript/构建目标不支持该正则写法，则使用项目现有的扩展汉字范围实现；不得为了正则支持升级构建工具。

### 1.4 根据源行时长调整字符目标

设：

- `chars`：源行 code point 数量；
- `duration = max(0, to - from)`；
- `languageTarget`：中文 24，拉丁 56；
- `languageMax`：中文 28，拉丁 72。

计算：

```ts
const targetByTime = duration > 0
  ? Math.max(1, Math.floor(chars * TARGET_DURATION_SECONDS / duration))
  : languageTarget;

const maxByTime = duration > 0
  ? Math.max(targetByTime, Math.floor(chars * MAX_DURATION_SECONDS / duration))
  : languageMax;

const targetLimit = Math.min(languageTarget, targetByTime);
const hardLimit = Math.max(targetLimit, Math.min(languageMax, maxByTime));
```

含义：

- 字幕文字很密时，语言字符上限防止一行过长；
- 字幕持续时间很长时，4 秒目标会推动切成更多段；
- 6 秒上限会推动在没有标点时也进行确定性硬切；
- `targetLimit` 至少为 1，循环必须保证每次都前进。

### 1.5 切点优先级

每次从当前字符偏移 `offset` 开始，在 `hardLimit` 范围内选择一个切点。优先顺序固定为：

1. 强句末标点：`。！？”’!?；;`；
2. 拉丁句点 `.`，但只在句点后为空白或文本结尾时视为句末，避免在小数、版本号或 URL 中间切断；
3. 弱标点：`，,、：:`；
4. 拉丁文本的空白边界；
5. 都没有时，在 `targetLimit` 处硬切。

候选切点必须位于：

```text
[offset + min(minCut, remaining - 1), offset + hardLimit]
```

当剩余文字已经不超过 `hardLimit` 时，直接把全部剩余文字作为最后一段，不制造过短尾段。

在同一优先级有多个候选时，选择距离 `offset + targetLimit` 最近的候选；距离相同则选择较后的候选，让标点归入前一段。

切分后不得自动 `trim()` 删除源文字。若要避免下一段以空格开头，应把分隔空白归入前段，或者只在展示段边界上规范化一处空白，同时通过“去除边界空白后拼接”测试证明没有丢失非空白内容。中文内容必须逐 code point 完整保留。

### 1.6 时间码分配

对一条源行内每个子段，使用其累计字符偏移计算时间：

```ts
const segmentStart = from + duration * (startOffset / totalChars);
const segmentEnd = from + duration * (endOffset / totalChars);
```

必须额外保证：

- 第一个子段的 `start` 精确等于源行 `from`；
- 最后一个子段的 `end` 精确等于源行 `to`；
- 相邻子段满足 `previous.end === next.start`；
- 不对内部秒数做整数取整；UI 继续用现有格式显示整秒；
- 源行 `to < from` 时，不扩展负时长，按项目当前容错方式规范为非负区间；
- 源行 `from === to` 时仍可按文字长度切段，但所有子段时间保持该时刻，不产生负值或 `NaN`。

### 1.7 极稀疏源行例外

例如源数据只有一个字“甲”，时间却是 0~25 秒。无法把一个字拆成多个有意义字幕，也不得：

- 重复“甲”四次；
- 生成三个空文字段；
- 发明源数据中不存在的内容。

因此规则固定为：当 `duration > MAX_DURATION_SECONDS` 且 `duration / chars > MAX_DURATION_SECONDS` 时，平均一个不可再分的 code point 已经超过 6 秒，直接保留一个非空展示段和源行原始时间范围。此时允许超过 6 秒，并在测试名和进度报告中明确它是“源数据过稀的保真例外”。该判断必须在进入切分循环前完成。

### 1.8 ID 与输出不变量

- 输出 ID 继续使用全局顺序 `S0001`、`S0002`……；
- 输出顺序与源行顺序一致；
- 每个展示段 `text` 非空；
- 同一源行全部子段的文字按顺序拼接后等于源行文字；
- 不同源行的文字永不互相混合；
- 正常时间有效的子段不重叠；
- 不插入仅用于占时间的空段。

---

## 2. 文件范围与所有权

### 2.1 预计修改

- `src/adapters/bilibili/transcript.ts`
- `tests/adapters/bilibili-transcript.test.ts`
- `tests/subtitle-page.test.ts`
- `README.md`
- `docs/progress/2026-08-30-bilibili-fine-grained-subtitle-segmentation.md`

### 2.2 原则上不修改

- `src/subtitle/subtitle.ts`

原因：当前官方轨和 AI 虚拟轨都已经在 `renderReady` 中调用 `groupTranscript`，点击跳转和播放高亮也已经消费返回的 `start/end`。如果新增集成测试在不改该文件的情况下通过，就不得触碰它。

只有测试证明现有调用方无法支持新分段时，才允许对该文件做最小修复，并在进度报告中写明触发原因和具体差异。

### 2.3 明确禁止触碰的既有未提交修改

开始时预计工作树中已有以下 3 个未提交文件：

- `src/adapters/bilibili/subtitle-service.ts`
- `tests/adapters/bilibili-subtitle-service.test.ts`
- `tests/adapters/bilibili.test.ts`

它们属于此前 WBI `wbi_img` 嵌套响应和 `ai-zh` 识别修复，不属于本任务。实施 Agent 必须：

- 不回退；
- 不覆盖；
- 不格式化；
- 不暂存；
- 不提交；
- 不用 `git stash`、`git clean`、`git checkout --` 或 `git reset` 处理它们。

每次提交只使用精确 pathspec。

---

## Task 0：锁定工作树、基线和保护清单

**Files:**

- Read only: repository state
- Create later: `docs/progress/2026-08-30-bilibili-fine-grained-subtitle-segmentation.md`

- [x] **Step 1: 确认进入正确工作树**

```powershell
Set-Location -LiteralPath 'C:\Users\HP\OneDrive\桌面\example\clip2md\.worktrees\bilibili-subtitle-sidepanel'
git branch --show-current
git rev-parse --short HEAD
git status --short
```

Expected:

- branch 为 `codex/bilibili-subtitle-sidepanel`；
- 起始 HEAD 为 `2c72489`，若已前移则先确认前移提交属于用户授权的后续工作；
- 上述 3 个既有文件仍显示为未提交修改；
- 除计划文档外，没有本任务来源不明的新修改。

- [x] **Step 2: 记录保护文件的当前差异和哈希**

```powershell
git diff -- src/adapters/bilibili/subtitle-service.ts tests/adapters/bilibili-subtitle-service.test.ts tests/adapters/bilibili.test.ts
Get-FileHash -Algorithm SHA256 -LiteralPath 'src/adapters/bilibili/subtitle-service.ts','tests/adapters/bilibili-subtitle-service.test.ts','tests/adapters/bilibili.test.ts'
```

Expected: 能看到既有差异，并获得 3 个哈希。把哈希写入进度报告的“开始状态”小节，完成后再次核对。

- [x] **Step 3: 运行基线测试**

```powershell
npm test
npm run typecheck
npm run build
git diff --check
```

Expected:

- `npm test` 零失败；此前参考基线为 38 个文件、595 个测试，但若测试数量合理增加，以零失败为准；
- typecheck 退出码 0；
- build 退出码 0；
- `git diff --check` 无输出。

如果基线失败，停止功能实现：记录失败命令和完整错误，确认是否为环境问题或既有修改导致，不得把基线失败混进本任务修复。

- [x] **Step 4: 创建进度报告骨架**

新建 `docs/progress/2026-08-30-bilibili-fine-grained-subtitle-segmentation.md`，至少包含：

```md
# Bilibili 细粒度字幕分段进度报告

## 一、目标与非目标
## 二、开始状态与保护文件哈希
## 三、红灯测试证据
## 四、实现摘要
## 五、自动化验证
## 六、手工 Chrome 验收
## 七、未验证项和已知限制
## 八、提交记录与最终工作树状态
```

- [x] **Step 5: 提交仅计划/报告准备（如实现 Agent 接手时计划尚未提交）**

不要把 3 个保护文件带入提交。若本计划文件已由上游 Agent 提交，则此步只提交新建的进度报告骨架；否则使用精确路径：

```powershell
git add -- docs/superpowers/plans/2026-08-30-bilibili-fine-grained-subtitle-segmentation.md docs/progress/2026-08-30-bilibili-fine-grained-subtitle-segmentation.md
git diff --cached --check
git diff --cached --name-only
git commit -m "docs: plan fine-grained bilibili subtitle segmentation"
```

Expected staged names only包含上述计划/进度文档。

---

## Task 1：先用单元测试锁定新的分段合同

**Files:**

- Modify: `tests/adapters/bilibili-transcript.test.ts`
- Test target: `src/adapters/bilibili/transcript.ts`

- [x] **Step 1: 删除或改写只服务于旧“段落聚合”语义的断言**

旧测试中以下行为不再是正确需求：

- 多条源字幕合成 90 字或 180 字的大段；
- 允许正常展示段达到 20 秒；
- 为稀疏源行生成空文字 timing-only 段。

保留仍有效的不变量测试：空输入、过滤空白、顺序、唯一 ID、Unicode 汉字识别；把期望改为新合同。

- [x] **Step 2: 添加截图场景的确定性红灯测试**

使用 84 个中文 code point、`from: 0`、`to: 14`、无标点的单条源字幕。测试必须精确断言：

```ts
expect(segments.map(({ start, end }) => [start, end])).toEqual([
  [0, 4],
  [4, 8],
  [8, 12],
  [12, 14],
]);
expect(segments.map((segment) => Array.from(segment.text).length)).toEqual([
  24, 24, 24, 12,
]);
expect(segments.map((segment) => segment.text).join('')).toBe(sourceText);
```

构造文本时使用清晰的 84 字 fixture，不能用随机字符串。注释说明该用例复现侧栏 `00:00 → 00:14` 的粗粒度问题。

- [x] **Step 3: 添加“绝不跨源行合并”测试**

输入：

```ts
[
  { from: 0, to: 2, content: '你好' },
  { from: 2, to: 4, content: '世界' },
]
```

期望两个输出段，分别为“你好”和“世界”，而不是“你好世界”。

- [x] **Step 4: 添加“保留真实时间空档”测试**

输入：

```ts
[
  { from: 0, to: 2, content: '第一句' },
  { from: 10, to: 12, content: '第二句' },
]
```

期望只输出两个非空段，时间为 0~2 和 10~12；不得生成 2~10 的占位段。

- [x] **Step 5: 添加标点优先级测试**

分别覆盖：

- 中文强句末标点优先于弱标点；
- 逗号可作为次优切点；
- 拉丁文本优先在句末或空格切分；
- 小数 `3.14`、版本号 `v2.0` 和 URL 中的点不被当作句末。

每个测试同时断言：

- 每段文本；
- 拼接后非空白内容未丢失；
- 时间按 code point 比例分配；
- 段落顺序稳定。

- [x] **Step 6: 添加硬切和长度上限测试**

- 无标点长中文：每个非尾段不超过 28 code points；
- 无标点长拉丁：每个非尾段不超过 72 code points；
- 在同等持续时长下，中文与拉丁使用各自限制；
- 对满足 `duration / chars <= 6` 的正常源行，断言所有子段 `end - start <= 6 + Number.EPSILON`。

- [x] **Step 7: 添加极稀疏源行保真例外测试**

输入 `{ from: 0, to: 25, content: '甲' }`。

期望：

```ts
expect(segments).toEqual([
  { id: 'S0001', start: 0, end: 25, text: '甲' },
]);
```

并断言没有空文字段。这取代旧的“0~20 文本段 + 20~25 空段”期望。

- [x] **Step 8: 添加 Unicode 与退化时间测试**

覆盖：

- 扩展汉字 `𠀀` 按一个 code point 和中文限制处理；
- `from === to` 不产生 `NaN`；
- 异常 `to < from` 不产生负持续时间；
- 空白行仍被过滤；
- 所有 ID 从 `S0001` 连续递增。

- [x] **Step 9: 运行目标测试并保存红灯证据**

```powershell
npx vitest run tests/adapters/bilibili-transcript.test.ts
```

Expected: 新增的短分段用例失败，失败原因应明确指向旧实现仍在跨行聚合、20 秒切分或生成空段，而不是 fixture/导入/语法错误。

把失败测试名和关键 expected/actual 摘要写入进度报告“红灯测试证据”。

- [x] **Step 10: 提交测试合同**

```powershell
git add -- tests/adapters/bilibili-transcript.test.ts docs/progress/2026-08-30-bilibili-fine-grained-subtitle-segmentation.md
git diff --cached --check
git diff --cached --name-only
git commit -m "test: define fine-grained subtitle segmentation"
```

Expected: 暂存区不包含 3 个保护文件。

---

## Task 2：最小重写 `groupTranscript`

**Files:**

- Modify: `src/adapters/bilibili/transcript.ts`
- Test: `tests/adapters/bilibili-transcript.test.ts`

- [x] **Step 1: 删除旧段落聚合状态**

从 `groupTranscript` 中移除：

- 跨源行累积的 `current`；
- 以 20 秒/90 字/180 字为目标的 `flush`；
- timing-only 空文字块；
- 只为旧聚合策略服务的常量和辅助函数。

不要保留两套并行算法或 feature flag。

- [x] **Step 2: 实现 code point 安全的语言限制选择**

建议最小结构：

```ts
type SegmentLimits = {
  minCut: number;
  target: number;
  max: number;
};

function getSegmentLimits(text: string): SegmentLimits {
  return containsHan(text) ? CJK_LIMITS : LATIN_LIMITS;
}
```

禁止把限制导出为公共 API，除非测试只能通过公开 API 验证；优先通过 `groupTranscript` 的行为测试私有细节。

- [x] **Step 3: 实现确定性切点选择函数**

建议签名：

```ts
function findCutIndex(
  codePoints: string[],
  offset: number,
  targetLimit: number,
  hardLimit: number,
  minCut: number,
  isCjk: boolean,
): number
```

要求：

- 返回值始终大于 `offset`；
- 返回值不超过 `offset + hardLimit` 和文本结尾；
- 按 1.5 节的优先级选择；
- 句末标点归前段；
- Latin 空白边界处理不丢单词；
- 无候选时返回 `offset + targetLimit`；
- 最后剩余不超过 hard limit 时直接返回文本结尾。

如果实现超过约 40~50 行，先检查是否把候选查找写得过度抽象。只需要满足当前固定优先级。

- [x] **Step 4: 实现单条源行拆分**

建议签名：

```ts
function splitSubtitleLine(line: BiliSubtitleLine): Array<{
  start: number;
  end: number;
  text: string;
}>
```

伪代码：

```ts
const codePoints = Array.from(line.content);
if (codePoints.length === 0) return [];

const from = finite non-negative normalized start;
const to = Math.max(from, finite normalized end);
const duration = to - from;
const limits = getSegmentLimits(line.content);
const { targetLimit, hardLimit } = deriveLimits(...);

let offset = 0;
while (offset < codePoints.length) {
  const cut = findCutIndex(...);
  const start = offset === 0
    ? from
    : from + duration * (offset / codePoints.length);
  const end = cut === codePoints.length
    ? to
    : from + duration * (cut / codePoints.length);
  emit codePoints.slice(offset, cut).join('');
  offset = cut;
}
```

实现中必须防止无限循环，并确保最后一段结束时间精确使用 `to`。

- [x] **Step 5: 将 `groupTranscript` 简化为逐行展开与编号**

目标结构应接近：

```ts
export function groupTranscript(lines: BiliSubtitleLine[]): BiliTranscriptSegment[] {
  const segments = lines
    .filter((line) => line.content.trim().length > 0)
    .flatMap(splitSubtitleLine);

  return segments.map((segment, index) => ({
    id: `S${String(index + 1).padStart(4, '0')}`,
    ...segment,
  }));
}
```

如果需要保留边界空格，调整过滤/拆分细节，但不要恢复跨行聚合。

- [x] **Step 6: 运行目标测试直到全绿**

```powershell
npx vitest run tests/adapters/bilibili-transcript.test.ts
```

Expected: 该文件全部通过。

- [x] **Step 7: 运行适配器相关回归**

```powershell
npx vitest run tests/adapters/bilibili-transcript.test.ts tests/adapters/bilibili-subtitle-service.test.ts tests/adapters/bilibili.test.ts
```

Expected: 全部通过。若保护文件对应测试失败，先判断是否为本任务改变公共语义导致；不得修改保护文件来“消除”失败。

- [x] **Step 8: 审查实现是否保持最小**

检查：

- 没有新增设置、storage schema 或 message 类型；
- 没有引入依赖；
- 没有网络或 AI 调用；
- 没有保留旧聚合分支；
- 没有空文字段；
- 没有对 `subtitle.ts` 做无必要修改。

- [x] **Step 9: 提交最小实现**

```powershell
git add -- src/adapters/bilibili/transcript.ts docs/progress/2026-08-30-bilibili-fine-grained-subtitle-segmentation.md
git diff --cached --check
git diff --cached --name-only
git commit -m "feat: segment bilibili subtitles into short timed cues"
```

---

## Task 3：用字幕页集成测试证明真实交互正确

**Files:**

- Modify: `tests/subtitle-page.test.ts`
- Modify only if proven necessary: `src/subtitle/subtitle.ts`

- [x] **Step 1: 添加官方中文字幕长行集成用例**

复用现有字幕页测试 harness，让官方字幕资源返回一条 0~14 秒、84 个中文 code point 的字幕。

页面 ready 后断言：

- 渲染 4 个字幕 row；
- `data-start` 分别为 `0`、`4`、`8`、`12`；
- 可见时间分别为 `00:00`、`00:04`、`00:08`、`00:12`；
- 4 行文字按顺序拼接等于源文字；
- 轨道选择仍显示官方中文轨名称。

- [x] **Step 2: 添加 AI 中文虚拟轨的相同分段用例**

让源轨为英文，翻译 handler 返回一条 0~14 秒、84 个中文 code point 的翻译结果。

断言：

- 选择的是 `中文（AI）`/现有产品实际文案；
- 同样渲染 4 个短字幕 row；
- 翻译请求仍只发生一次；
- 分段发生在翻译结果返回之后；
- 分段不改变翻译行的时间范围和内容总和。

这个测试证明无需修改翻译协议或让 AI 返回更多时间码。

- [x] **Step 3: 添加点击第三段跳转测试**

点击 `data-start="8"` 的第三个 row，断言发给播放器桥接的 seek 时间为 8 秒，而不是原始大段的 0 秒或下一源行时间。

- [x] **Step 4: 添加播放高亮短段测试**

模拟播放时间：

- 3.9 秒：第一段高亮；
- 4.0 秒：第二段高亮；
- 8.5 秒：第三段高亮；
- 13.5 秒：第四段高亮；
- 14.0 秒后若无下一行：无当前高亮。

沿用现有半秒轮询/消息机制，不为测试引入第二套时钟。

- [x] **Step 5: 添加真实空档集成用例**

官方两条源字幕分别为 0~2 秒、10~12 秒。模拟播放 5 秒，断言没有 row 高亮；页面只显示两个 row，没有 2~10 秒的空占位行。

- [x] **Step 6: 添加轨道切换与缓存回归断言**

在现有 AI 测试中补充或复用断言：

- 切到官方英文再切回 AI 中文，不重复付费翻译；
- 切分后的行数变化不影响缓存 key；
- 刷新语义保持现有实现；
- 失败的 AI 翻译仍回退官方英文，不将英文分段冒充“中文（AI）”。

- [x] **Step 7: 运行集成测试并确认红/绿过程**

先在仅新增测试、尚未做任何可能的 `subtitle.ts` 修改时运行：

```powershell
npx vitest run tests/subtitle-page.test.ts
```

Expected: 如果 Task 2 已正确保持接口，测试应直接通过。若失败：

1. 记录失败断言；
2. 判断是 fixture 错误、分段算法错误还是调用方真实缺口；
3. 只有第三种情况才最小修改 `src/subtitle/subtitle.ts`；
4. 禁止为了测试方便复制生产逻辑到页面层。

- [x] **Step 8: 如需修改页面代码，先补精确失败测试再修复**（无需修改：测试一次通过，未触碰 `subtitle.ts`）

允许的最小修复仅限：

- row 的 `data-start` 读取精度；
- active segment 边界判断；
- 分段结果重新渲染时的引用更新。

不得重写页面状态机、轨道偏好或翻译缓存。

- [x] **Step 9: 提交字幕页集成覆盖**

如果生产页面无需修改：

```powershell
git add -- tests/subtitle-page.test.ts docs/progress/2026-08-30-bilibili-fine-grained-subtitle-segmentation.md
git commit -m "test: cover short subtitle timing interactions"
```

如果确有最小生产修复，再把 `src/subtitle/subtitle.ts` 精确加入同一提交，并在提交前检查：

```powershell
git diff --cached --name-only
git diff --cached --check
```

---

## Task 4：文档、全量门禁和独立审查

**Files:**

- Modify: `README.md`
- Modify: `docs/progress/2026-08-30-bilibili-fine-grained-subtitle-segmentation.md`

- [x] **Step 1: 更新 README 字幕侧栏说明**

在现有 B 站字幕功能段落增加简短说明：

```md
- 字幕侧栏会在单条平台字幕内部按句读拆成约 4 秒的小段，方便阅读、点击跳转和随播放高亮；不会跨平台字幕行合并。
- 平台未提供逐字时间码时，子段时间按文字位置在原字幕行内估算；这不是语音识别或逐字对齐。
```

不要扩写成 ASR 功能，也不要改变 AI 翻译的隐私/费用披露。

- [x] **Step 2: 完成进度报告**

报告必须分开列出：

- 已完成；
- 部分完成；
- 未验证；
- 已知限制；
- 保护文件最终哈希；
- 每个提交 hash；
- 自动测试的实际文件数/用例数；
- 手工 Chrome 验收证据或未验证原因。

- [x] **Step 3: 运行全量自动化门禁**

```powershell
npm test
npm run typecheck
npm run build
git diff --check
```

Expected: 全部退出码 0；`git diff --check` 无输出。

- [x] **Step 4: 做输出不变量的额外审查**

使用测试或小型本地调用确认：

- 每段 `text.trim().length > 0`；
- IDs 唯一且连续；
- 子段时间为有限数字；
- 相邻同源子段连续；
- 不同源行的真实空档仍存在；
- 拼接文本没有丢非空白字符；
- 字符密度足以细分的正常源行，其子段不超过 6 秒；
- 极稀疏例外没有空段或重复字。

- [x] **Step 5: 检查范围和敏感信息**

```powershell
git diff --name-only HEAD
git status --short
rg -n "API[_ -]?KEY|Authorization|Bearer" src/adapters/bilibili/transcript.ts tests/adapters/bilibili-transcript.test.ts tests/subtitle-page.test.ts README.md docs/progress/2026-08-30-bilibili-fine-grained-subtitle-segmentation.md
```

Expected:

- 仅出现本计划允许的文件和 3 个既有保护文件；
- 新改文件不包含密钥、Authorization header 或 Provider 正文。

- [x] **Step 6: 请求独立代码审查**

审查范围应包含从本任务首个提交到当前 HEAD 的 diff，重点询问：

- 是否仍可能跨源行合并；
- 标点选择是否可能死循环或丢字；
- Unicode code point 是否处理正确；
- 时间比例是否有 `NaN`、负数、浮点边界或尾段不闭合；
- sparse exception 是否会制造误导字幕；
- 官方轨和 AI 轨是否都覆盖；
- 是否意外改变翻译请求/缓存次数；
- 是否触碰保护文件。

所有 Critical/Important 必须修复并复跑全量门禁；Minor 要么修复，要么在报告中写明不修理由。

- [ ] **Step 7: 提交文档与审查修复**

```powershell
git add -- README.md docs/progress/2026-08-30-bilibili-fine-grained-subtitle-segmentation.md
git diff --cached --check
git commit -m "docs: document fine-grained subtitle timing"
```

如有审查修复，使用另一个精确提交，例如：

```powershell
git add -- src/adapters/bilibili/transcript.ts tests/adapters/bilibili-transcript.test.ts tests/subtitle-page.test.ts docs/progress/2026-08-30-bilibili-fine-grained-subtitle-segmentation.md
git commit -m "fix: address subtitle segmentation review"
```

---

## Task 5：真实 Chrome 手工验收

**Files:**

- Read built extension: `dist/`
- Update evidence: `docs/progress/2026-08-30-bilibili-fine-grained-subtitle-segmentation.md`

此任务需要真实 Chrome、B 站页面和用户登录/扩展设置。若执行环境无法加载扩展，必须明确标为未验证，不能以单元测试代替手工验收结论。

- [ ] **Step 1: 重新加载本工作树构建的扩展**

```powershell
npm run build
```

在 `chrome://extensions` 开启开发者模式，确认加载/重新加载的是当前工作树的 `dist`，不是其他 checkout 的构建目录。

- [ ] **Step 2: 验收截图中的官方中文字幕视频**

打开：

```text
https://www.bilibili.com/video/BV1dsut6AES4/
```

检查：

- 侧栏不再主要呈现 14~18 秒一大段；
- 正常长行被拆成约 4 秒的小段；
- 每段是一句或一小段可读文字；
- 时间显示大致呈 `00:00、00:04、00:08、00:12...` 的细粒度节奏，实际会依源字幕内容变化；
- 文字顺序与视频语音顺序一致；
- 不出现空白字幕 row；
- 不出现同一句重复多次；
- 源字幕真实空档不被伪文字填满。

- [ ] **Step 3: 验收点击跳转**

随机点击至少 5 个非首段字幕：

- 播放器跳到该段显示的起始时间附近；
- 不总是跳回一整条大字幕的起点；
- 点击后当前高亮与播放器位置一致。

- [ ] **Step 4: 验收随播放高亮**

连续播放至少 60 秒：

- 高亮约每几秒随内容推进；
- 同一大段文字不再持续高亮十几秒；
- 在明确无字幕/停顿处允许没有高亮；
- 自动滚动不应因分段增多而跳到错误位置。

- [ ] **Step 5: 验收 AI 中文轨**

打开此前 AI 翻译目标视频：

```text
https://www.bilibili.com/video/BV1Yku16CEzX/
```

在用户已明确开启并配置 AI 翻译的前提下检查：

- 轨道显示为现有“简体中文（AI 翻译）”或产品当前准确文案；
- 翻译后也被拆成短段；
- 切换英文 → AI 中文不会无故重复翻译付费；
- 官方已有中文时不触发 AI 翻译；
- 翻译失败时仍保留官方英文，不冒充中文。

不得代替用户启用费用开关或填入 API Key。

- [ ] **Step 6: 记录证据**

进度报告至少记录：

- Chrome/扩展版本；
- 视频 BV 号；
- 轨道名称；
- 观察到的前 8 个字幕起始时间；
- 点击跳转抽样结果；
- AI 请求计数是否符合预期；
- 通过、失败或未验证；
- 若失败，附截图和复现步骤。

---

## Task 6：最终保护核验与交付

**Files:**

- Update: `docs/progress/2026-08-30-bilibili-fine-grained-subtitle-segmentation.md`

- [ ] **Step 1: 复核保护文件哈希**

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath 'src/adapters/bilibili/subtitle-service.ts','tests/adapters/bilibili-subtitle-service.test.ts','tests/adapters/bilibili.test.ts'
```

Expected: 与 Task 0 记录一致。若不一致，停止交付并审查原因；不得直接回退，因为这些修改属于用户。

- [ ] **Step 2: 复核提交内容**

```powershell
git log --oneline --decorate -10
git status --short
git diff --stat 2c72489..HEAD
git diff --name-only 2c72489..HEAD
```

Expected:

- 本任务提交只包含第 2.1 节允许的文件；
- 3 个保护文件仍只以未提交状态存在，不出现在本任务 commit diff；
- 没有 merge commit、push 或 PR 副作用。

- [ ] **Step 3: 最后一次全量门禁**

在所有审查修复和文档更新后重新运行，不得引用较早结果：

```powershell
npm test
npm run typecheck
npm run build
git diff --check
```

把实际数字和退出码写进进度报告。

- [ ] **Step 4: 提交最终报告更新**

```powershell
git add -- docs/progress/2026-08-30-bilibili-fine-grained-subtitle-segmentation.md
git diff --cached --check
git diff --cached --name-only
git commit -m "docs: finalize subtitle segmentation verification"
```

- [ ] **Step 5: 给用户的最终交付摘要必须包含**

1. branch 与 HEAD；
2. 起始/最终提交范围；
3. 实际修改文件；
4. 自动化测试实际结果；
5. Chrome 手工验收结果；
6. 未验证项和精度限制；
7. 3 个保护文件仍未提交且哈希未变；
8. 明确说明没有 merge、push、PR 或修改 `main`；
9. 下一步是用户验收后决定是否合并，不得自行合并。

---

## 3. 建议提交序列

实现 Agent 应保持小提交，建议顺序：

```text
docs: plan fine-grained bilibili subtitle segmentation
test: define fine-grained subtitle segmentation
feat: segment bilibili subtitles into short timed cues
test: cover short subtitle timing interactions
docs: document fine-grained subtitle timing
fix: address subtitle segmentation review          # 仅有审查修复时
docs: finalize subtitle segmentation verification
```

每次提交前执行：

```powershell
git diff --cached --name-only
git diff --cached --check
```

严禁使用 `git add .` 或 `git add -A`，避免把保护文件带入提交。

---

## 4. 失败处理规则

### 4.1 新单元测试失败

- 先确认 fixture 的 code point 数量和持续时间；
- 再确认 expected 是按本计划固定公式计算；
- 最后才修改生产实现；
- 不降低测试阈值来迁就旧行为。

### 4.2 页面集成测试失败

- 先检查 `groupTranscript` 输出；
- 再检查 DOM fixture 和现有播放器 bridge；
- 只有确认调用方真实不兼容才修改 `subtitle.ts`；
- 不把分段逻辑复制到页面文件。

### 4.3 浮点时间断言失败

- 对非整数比例使用 `toBeCloseTo`；
- 对第一个 start、最后一个 end 和相邻边界使用精确来源值；
- 不在生产代码中为通过测试而粗暴取整。

### 4.4 真实视频仍显得过长

先检查 B 站源数据是否为极稀疏行：

- 若文字足够多但仍超过 6 秒，是算法缺陷，补回归测试并修复；
- 若只有极少文字却持续很久，是已知保真例外，记录源行证据；
- 不重复文字、不生成空段来伪装更细时间码。

### 4.5 Chrome 环境无法加载扩展

- 记录 Chrome 版本、加载方式和错误；
- 自动化结果仍可报告为通过；
- 手工验收必须报告“未验证”，不能写“已通过”；
- 附上 Task 5 的人工操作步骤供用户执行。

---

## 5. 最终审查清单

实施 Agent 在宣称完成前逐项勾选：

- [x] 每条源字幕独立切分，没有跨行合并。
- [x] 正常目标约 4 秒；当源行平均每个 code point 不超过 6 秒时，子段硬上限为 6 秒。
- [x] 中文目标 24、硬上限 28 code points。
- [x] 拉丁目标 56、硬上限 72 code points。
- [x] 强标点、弱标点、空格、硬切优先级均有测试。
- [x] 小数、版本号、URL 中的句点不会误切。
- [x] 时间按累计 code point 比例分配。
- [x] 每条源行首尾时间精确保留。
- [x] 相邻同源子段时间连续、不重叠。
- [x] 真实源行空档保持为空档。
- [x] 没有空文字段、重复文字或丢字。
- [x] 极稀疏源行保真例外有测试和文档。
- [x] 扩展汉字按一个 code point 处理。
- [x] 官方中文轨集成测试通过。
- [x] AI 中文虚拟轨集成测试通过。
- [x] 点击短字幕跳到其新起始时间。
- [x] 播放高亮按短时间段切换。
- [x] 翻译缓存/失败回退/刷新语义未改变。
- [x] 未增加设置、协议、依赖、网络调用或 ASR。
- [x] `npm test`、typecheck、build、diff check 全绿。
- [x] README 与进度报告准确说明比例估时限制。
- [x] 3 个既有未提交文件哈希未变且未进入提交。
- [x] 没有 merge、push、PR 或修改 `main`。
