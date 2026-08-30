# 一图速览 Anchor 自动恢复进度报告

## 一、目标与非目标

**目标：** 当"一图速览"因 `sourceQuote` 与对应 Source Block 不一致而校验失败时，先在本地高置信度重匹配真实原句（只改 `sourceQuote`，绝不猜测或更改 `sourceBlockId`）；现有 AI repair 仍失败时自动完整重生成一次（fresh，使用原始 prompt）；只有三阶段都失败才显示最终错误和"重新生成"。一次用户主动生成最多 3 次 Provider 请求，三阶段共享现有 30 秒总超时，HTTP/鉴权/限流/网络/超时错误不触发额外重试，只有严格校验通过的结果才进入缓存和 done state。

**非目标：** 不降低或删除严格 Anchor 校验；不跨 Block 猜测 Block ID；不用 title 反向猜 Block；不取 Block 开头兜底；不缓存未通过校验的结果；不在 Side Panel 自动重新触发任务；不修改页面抓取/Source Block 编号/导航算法/字幕/WBI；不新增 npm 依赖；不 merge/push/PR/改 main。

**执行方式说明：** 计划要求使用 superpowers:subagent-driven-development 或 superpowers:executing-plans 技能；当前会话技能目录中不存在这两个技能（目录已更换为不含 superpowers 前缀的版本）。按计划自带的任务分解（Task 0–7、checkbox、TDD、小提交）直接执行，效果等同。

## 二、开始状态与保护文件哈希

- 分支：`codex/bilibili-subtitle-sidepanel`；起始 HEAD：`36d11f9`（与计划编写时一致，无前移）
- 基线门禁：`npm test` 38 文件 / 613 测试全过；typecheck 0；build 0；`git diff --check` 0
- 工作树：仅 3 个保护文件（未提交修改）+ 本计划文档（未跟踪），无来源不明修改

保护文件 SHA256（开始时，与计划参考值逐一相同）：

| 文件 | SHA256 |
|---|---|
| `src/adapters/bilibili/subtitle-service.ts` | `D13CE7BB7C8070D8EA29FB96F3F26FCFF0EB5A4DEC1EB0040BA37FED07B2FBBE` |
| `tests/adapters/bilibili-subtitle-service.test.ts` | `D3002CB2E7429CD9BDEC2FABFFFEF2E8B632ECF2C5853021796975A6B762E21E` |
| `tests/adapters/bilibili.test.ts` | `96E0DB754D987834D62103AEDD2BDE387CB57117A0F74A821D8245E0EB308CA7` |

承诺：不回退/不覆盖/不格式化/不暂存/不提交这 3 个文件；不使用 stash/clean/checkout --/reset 处理它们。

## 三、设计合同与请求上限

- 本地恢复合同：相似度 ≥ 0.72；第一名领先第二名 ≥ 0.08；归一化后 < 6 code points 不做模糊恢复；返回 Quote 必须是对应 Block 的精确原文子串且 ≤ 140 code points；跨 Block 重复、低相似度、歧义、错误 Block ID 保守失败；只修改 `sourceQuote`。
- 请求状态机：Stage 1 INITIAL（原始 prompt）→ Stage 2 REPAIR（一次）→ Stage 3 FRESH（原始 prompt、不带旧输出/repair 错误）；最多 3 次；非校验错误直接传播；三阶段共享 30 秒 AbortController。
- 校验门：parse → 本地恢复 → `validateVisualSummaryAnchors` 三阶段统一；只有通过者可写缓存/done。

## 四、TDD 红灯证据

**Task 1（恢复模块合同，2026-08-30 16:32:25）：**

```text
npx vitest run tests/anchor-recovery.test.ts
→ Test Files 1 failed (1) / no tests
Error: Failed to resolve import "../src/analysis/anchor-recovery" from "tests/anchor-recovery.test.ts". Does the file exist?
```

失败原因 = `src/analysis/anchor-recovery.ts` 尚不存在（计划预期的红灯形态），非测试语法或 fixture 错误。测试合同共 15 个用例：轻微改写恢复、合法零修改（toBe 同一性）、空白/全半角标点归一化恢复 ×3、不存在 Block ID 拒绝、低相似度拒绝、歧义（margin < 0.08）拒绝、跨 Block 重复拒绝、短 Quote（<6 code points）拒绝、300 字长句 140 窗口候选、扩展汉字（U+20000 区）强句末候选保留标点、不可变性（summary/keyPoints 引用、sourceBlocks 不变）、无 sourceBlocks 返回原对象、无 anchor 条目原样保留、部分成功只替换成功项且整体仍被 Validator 拒绝。

**Task 3（三阶段状态机合同，2026-08-30）：**

```text
npx vitest run tests/ai-client.test.ts
→ Test Files 1 failed (1) / Tests 7 failed | 36 passed (43)
```

7 个红灯（当前两阶段实现无法满足）：
1. 初次与 repair 均失败时第三次 fresh 成功（当前第 2 次后即抛错）；
2. 初次输出 Quote 轻微差异本地恢复成功仅 1 次请求（当前触发 repair 共 2 次后失败）；
3. repair 输出可本地恢复时不发起第 3 次请求（当前失败抛错）；
4. fresh 输出也经本地恢复（当前无第三阶段）；
5. 第三次请求为全新原始 prompt（当前无第三阶段）；
6. 三阶段全败返回含"首次校验/自动修复后/全新生成后"三段诊断（当前仅两段）；
7. fresh 阶段 5xx 总计恰好 3 次（当前无第 3 次）。

36 个现有用例继续通过：V1 全部（成功/HTTP/超时/一次 repair）、V2 合法路径、repair 请求内容、超长 BlockId 脱敏、240 截断、401/429 单次直传、repair 网络失败传播、共享 30 秒 AbortController 预算。

## 五、实现摘要

**`src/analysis/anchor-recovery.ts`（新建，纯函数模块）：** `comparisonText`（normalizeBlockText → NFKC → 小写 → 删除 `\p{P}\p{S}\s`，仅用于比较）；`collectQuoteCandidates`（强句末 `。！？!?；;` 分段保留标点 → 超长再按弱标点 `，,、：:` → 仍超长按 140 code points 固定窗口；去重、过滤 <6 code points、`blockText.includes` 证明精确子串）；`diceSimilarity`（code point bigram Sørensen–Dice，相同比较文本直接 1，<2 code points 返回 0）；`findReplacementQuote`（最高分 ≥ 0.72、领先第二名 ≥ 0.08、同分按原文顺序稳定排序、候选仅出现在一个 sent Block）；`recoverVisualSummaryAnchors`（逐条目：Block ID 不存在 / Quote 已是精确子串 / 无高置信度候选 → 原样保留；有替换才返回新对象，否则返回原对象引用）。阈值常量 0.72/0.08/6 与计划一致，未新增依赖。

**`src/analysis/schema.ts`：** 仅将 `MAX_SOURCE_QUOTE_CHARS = 140` 导出（`parseVisualSummaryV2` 截断行为未变）。

**`src/analysis/client.ts`（Task 4）：** `parseRecoverAndValidateV2` 统一验收门（parse → recover → validate，三阶段共用同一函数，任何阶段不得绕过）；`analyzeContentV2` 从两阶段循环重写为线性三阶段状态机（INITIAL 原始 prompt → REPAIR 一次（原 prompt + buildRepairPromptV2 问题列表与上次输出）→ FRESH 一次（复用 initialMessages，物理上不可能携带旧输出）；非校验错误（HTTP/网络/超时）在各自阶段直接传播；三阶段共享同一 AbortController 30 秒总预算；三次校验失败才抛 AI_INVALID_RESPONSE，`invalidResponseMessage` 扩展为三段（保留 240 code point 截断与 Block ID 脱敏）；无递归调用。V1 `analyzeContent` 零改动（全部 V1 测试原样通过）。

**Task 5（Background / Side Panel 集成，测试证明生产行为已正确）：** `src/background/visual-summary.ts`、`src/sidepanel/sidepanel.ts`、`src/analysis/cache.ts` **零修改**——Background 的 try/catch 只在 `analyzeContentV2`（内含三阶段）完整结束后写终态，天然不产生中间 error state；缓存只写成功返回值。新增测试锁定：初次本地恢复成功 = 1 次 fetch + done + 状态序列 extracting→analyzing→done + 缓存恢复后结果；repair 失败 fresh 成功 = 恰好 3 次 fetch + 无中间 error + 缓存 + 非 force 重启命中缓存零请求；三次全败 = 最终 error AI_INVALID_RESPONSE（三段诊断）+ 无缓存 + 3 次 fetch；Side Panel 最终失败显示"重新生成"按钮。

## 六、自动化门禁

- **Task 2 后**：`npx vitest run tests/anchor-recovery.test.ts tests/analysis-schema.test.ts` → 59/59 通过。
- **Task 4 后**：`npx vitest run tests/ai-client.test.ts tests/anchor-recovery.test.ts tests/analysis-schema.test.ts` → 102/102 通过（7 个红灯全部转绿，36 个既有用例零回归）；typecheck 0。
- **Task 5 后**：`npx vitest run tests/background.test.ts tests/sidepanel.test.ts tests/visual-summary.test.ts tests/analysis-cache.test.ts` → 103/103 通过。
- **Task 6 全量（全新运行）**：`npm test` 39 文件 / **643 测试**全过；typecheck 0；build 0；`git diff --check` 0。

## 七、独立审查与处置

**结论：独立审查未能完成——代理运行时环境阻塞（非代码判负）。** 计划 Task 6 Step 5 要求的独立代码审查经过了 6 次尝试，全部在完成前因代理运行时崩溃而失败：

| # | 机制 | 配置 | 失败点 |
|---|---|---|---|
| 1 | 新建深度审查代理 (1912cc2e) | 全量许可：读文件+只读 git+vitest+typecheck | 独立执行测试已通过（其结言"v3 全部通过"），死于最后的安全检查与报告交付 |
| 2 | 新建聚焦静态代理 (73a2be61) | 静态+单测试文件 | 中途夭折 |
| 3 | 新建紧凑代理 (c329b093) | 结论先行、≤600 字、最多 1 个测试文件 | 无声失败 |
| 4 | subagent_fork（继承会话上下文，零命令） | 纯读代码对抗审查 | 立即失败，无输出 |
| 5 | 新建最小代理 (3ff9e5a6) | 单文件、≤150 字、零命令 | 无声失败 |
| 6 | send_message 恢复上一任务已成功交付审查的代理 (0868073f) | 复用已验证可靠的代理会话 | 无声失败 |

六次失败横跨三种机制（新建代理×4、fork、旧代理恢复回合）与多轮目标回合，连"读一个文件回 150 字"的最小任务也失败——判定为代理运行时环境阻塞，而非审查内容问题。**部分独立证据**：第 1 任审查员在死亡前独立执行过测试验证并确认全部通过（"v3 全部通过"）；但其正式发现清单未能交付，不计为完成。

**替代证据（明确标注：非独立审查）**：实现者在本会话中执行的对抗性自查，覆盖候选生成边界（空串/纯标点/连续标点/trim 后子串性/140 窗口）、dice 相同短路跨 Block 滥用不可行（块内搜索+跨 Block 唯一性兜底）、同分排序与 margin 语义（真同分必拒）、不可变性与引用保持、异常路径（repair fetch 抛错直接传播、finally clearTimeout 全覆盖、SyntaxError 区分）、V1 零改动机械化确认（diff 仅 3 个 hunk，均不在 V1 函数内）、`MAX_SOURCE_QUOTE_CHARS` 导出影响面（仅 schema 内部原用途+anchor-recovery 导入）。全部结论有对应测试锁定。

**环境恢复后补做步骤**：任一机制重发独立审查 → 处置 Critical/Important（修复+复跑全量门禁）或记录 Minor 理由 → 勾选计划 §4"独立审查"项 → 若有代码修复则更新本报告。

## 八、Chrome/API 验收

**结论：未验证（双重环境限制，非功能判负）。**

1. **扩展加载受限**：本机系统 Chrome `151.0.7922.174`（branded Chrome ≥137 已移除 `--load-extension` 命令行支持；Playwright chromium 打开 `chrome://extensions` WebUI 触发整体崩溃；persistent context + 扩展 flag 注册不出扩展 Service Worker——本会话与上一任务实测一致）。
2. **费用授权缺失**：真实验收需调用用户配置的付费 Provider。未经明确费用授权不擅自反复调用，避免意外扣费。

因此 Task 7 的检查项（本地恢复/repair/fresh 的真实 Provider 行为、请求计数核对）**均未执行**；自动化测试（643 用例，含三阶段请求计数、fresh 请求体、共享超时、缓存行为）是当前唯一的行为证据，但不能替代真实验收。

### 用户手工验收步骤（需自担 AI 费用）

1. `npm run build` 后在 `chrome://extensions`（开发者模式）加载本工作树的 `dist` 目录，确认加载的是本 checkout。
2. 配置并启用 AI 服务后，打开一篇受支持的长文章，按 `Ctrl + Shift + Y` 生成一图速览。**正常情况：Provider 收到且仅收到 1 次请求**。
3. 构造本地恢复场景（可选，需能改写模型输出或使用易改写模型）：让模型返回带轻微标点/空格差异的 `sourceQuote` → 扩展应仍显示结果，Provider 仍只有 1 次请求（本地恢复不产生新请求）。
4. 构造校验失败场景：观察 Network 面板中 AI endpoint 的请求数——初次失败自动 repair（第 2 次）、repair 仍失败自动 fresh（第 3 次）、此后**绝不出现第 4 次**；每次请求间隔与 30 秒总超时一致。
5. 三次都失败时，侧栏显示最终错误（含"首次校验/自动修复后/全新生成后"三段诊断）与"重新生成"按钮；点击"重新生成"才发起新一轮请求。
6. HTTP 401/429/网络断开场景：请求次数不增加（直接报错），错误码稳定（AI_AUTH_FAILED / AI_RATE_LIMITED / AI_NETWORK_ERROR）。
7. 成功后刷新侧栏不重复请求（缓存命中）；点击"重新生成"（force）才重新请求。

## 九、未验证项与已知限制

**请求与敏感信息专项检查（Task 6 Step 4）：**

- 单次 `analyzeContentV2` 内 `requestCompletion` 恰好 3 处调用点（initial/repair/fresh），无递归（`analyzeContentV2` 定义仅 1 处）；Provider 错误在各自阶段直接传播，有专用测试锁定。
- fresh 请求复用 `initialMessages` 对象，物理上不可能携带旧输出或 repair 错误（专用测试断言第 3 个请求的 messages 与第 1 个逐字相等，且不含"你上次的输出/具体错误如下"）。
- `apiKey` 仅用于 Bearer 请求头与配置存在性检查；诊断消息只包含校验 problem 字符串（240 code point 截断 + Block ID 脱敏），不包含 API Key、Provider 正文；缓存只写入通过三阶段校验的 summary（Background 在 `analyzeContentV2` resolve 后才写缓存）。

**已知限制（保守失败的边界）：** 本地恢复只在对应 Block 内部匹配——若 AI 把内容张冠李戴到错误 Block（Block ID 本身合法但引用的是其他 Block 的句子），恢复会因相似度低或跨 Block 唯一性失败而保守拒绝，这可能导致后续 repair/fresh 请求。该行为是 §0.5 安全合同（不猜测 Block ID）的直接结果。Quote 过短（归一化 <6 code points）同样不做模糊恢复。返回的 Quote 一定是 Block 原文精确子串，永远不会是"改写后的句子"。

## 十、提交记录和最终状态

**分支**：`codex/bilibili-subtitle-sidepanel`（工作树 `C:\Users\HP\OneDrive\桌面\example\clip2md\.worktrees\bilibili-subtitle-sidepanel`）
**基线**：`36d11f9`（上一任务完成态；开始时核对无前移）

**提交列表（按序）**：

| 提交 | 内容 |
|---|---|
| `e7e1b41` | 计划 + 报告骨架（Task 0：基线核对、保护哈希记录、613 测试基线全绿） |
| `064af94` | Task 1 红灯合同：anchor-recovery 16 用例（模块不存在导入失败） |
| `ea2ac89` | Task 2 实现：`src/analysis/anchor-recovery.ts` + schema 导出 `MAX_SOURCE_QUOTE_CHARS`（绿灯 59/59） |
| `466806d` | Task 3 红灯合同：三阶段 7 用例失败、36 既有用例零回归 |
| `e08d881` | Task 4 实现：`analyzeContentV2` 三阶段状态机 + `parseRecoverAndValidateV2` 统一验收门 |
| `1b25b72` | Task 5：Background 集成 3 测试 + Side Panel"重新生成"回归（生产 Background/SidePanel/Cache 零修改） |
| `b9e94f0` | Task 6：README 费用披露 + 全量门禁记录 + 请求上限/敏感信息专项检查 |
| `e6ae1e7` | Task 7：Chrome/API 验收如实标记未验证 + 手工验收步骤 |
| `1c814ae` | §4 最终清单 25/26 勾选（唯一未勾：独立审查处置） |
| （本提交） | 最终报告回填（§七审查阻塞记录、§十提交列表）+ Task 7 Step 5-9 勾选 |

**最终状态**：

- 自动化门禁（全新运行）：`npm test` 39 文件 / **643 测试**全过；`npm run typecheck` 0；`npm run build` 0；`git diff --check` 0。
- 提交范围 `36d11f9..HEAD`：恰好 10 个文件——README.md、2 份 docs、3 个 `src/analysis` 文件、4 个测试文件；**未触碰** `visual-summary.ts`、`sidepanel.ts`、`cache.ts`、`prompt.ts`、`source-blocks.ts`、`subtitle.ts`、平台适配器、字幕/WBI 文件；未新增依赖。
- 保护文件（始终未提交，哈希前后一致）：`D13CE7BB…FBBE` / `D3002CB2…21E` / `96E0DB75…8CA7`；工作树最终状态仅这 3 个 M 文件。
- 未 merge、未 push、未 PR、未改 main。
- **唯一未完成交付物**：计划 §4"独立审查 Critical/Important 全部处置"——因代理运行时环境阻塞未完成（详见 §七），清单对应项保持未勾选。
