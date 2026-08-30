# Bilibili 细粒度字幕分段进度报告

## 一、目标与非目标

**目标：** 将 B 站字幕侧栏从"十几秒一大段"改为"约 4 秒一小段、文字与该时间范围对应"。只重写 `groupTranscript` 的展示分段策略：逐条处理源字幕行、绝不跨源行合并；行内按标点/空格/确定性切点拆分，按字符偏移比例分配该源行的原始时间范围。官方字幕与"简体中文（AI 翻译）"虚拟轨使用同一套规则；点击跳转、播放高亮、翻译缓存、失败回退、刷新语义保持不变。

**非目标：** 不新增 ASR/音频下载、不改字幕接口与 WBI、不改 AI 翻译协议/提示词/费用开关、不加设置项、不改布局样式、不加依赖/网络/AI 请求、不 merge/push/PR/改 main。

**精度边界：** B 站源字幕只有整行 `from/to`，子段时间按 code point 比例估算，不是逐字语音对齐（需 ASR 或词级时间码才能更精确）。

**执行方式说明：** 计划要求使用 superpowers:executing-plans 或 superpowers:subagent-driven-development 技能；当前会话技能目录中不存在这两个技能（目录已更换为不含 superpowers 前缀的版本）。按计划自带的任务分解（Task 0–6、checkbox、TDD、小提交）直接执行，效果等同。

## 二、开始状态与保护文件哈希

- 分支：`codex/bilibili-subtitle-sidepanel`；起始 HEAD：`2c72489`
- 基线门禁：`npm test` 38 文件 / 595 测试全过（退出码 0）；`npm run typecheck` 0；`npm run build` 0；`git diff --check` 无输出
- 工作树：仅 3 个既有未提交保护文件 + 本计划文档（未跟踪），无来源不明修改

保护文件 SHA256（开始时）：

| 文件 | SHA256 |
|---|---|
| `src/adapters/bilibili/subtitle-service.ts` | `D13CE7BB7C8070D8EA29FB96F3F26FCFF0EB5A4DEC1EB0040BA37FED07B2FBBE` |
| `tests/adapters/bilibili-subtitle-service.test.ts` | `D3002CB2E7429CD9BDEC2FABFFFEF2E8B632ECF2C5853021796975A6B762E21E` |
| `tests/adapters/bilibili.test.ts` | `96E0DB754D987834D62103AEDD2BDE387CB57117A0F74A821D8245E0EB308CA7` |

承诺：不回退/不覆盖/不格式化/不暂存/不提交这 3 个文件；不使用 stash/clean/checkout --/reset 处理它们。

## 三、红灯测试证据

重写 `tests/adapters/bilibili-transcript.test.ts`（15 个用例锁定新合同）后运行 `npx vitest run tests/adapters/bilibili-transcript.test.ts`：**15 failed (15)**，全部为语义失败（非 fixture/导入/语法错误），关键 expected/actual：

- `84 字无标点中文源行…`：actual `[ [0, 14] ]`（旧实现整行一段 14 秒）≠ expected `[ [0,4],[4,8],[8,12],[12,14] ]`
- `绝不跨源字幕行合并…`：actual `['你好世界']`（跨行合并）≠ expected `['你好','世界']`
- `保留源字幕之间的真实时间空档…`：actual `['第一句第二句']`（合并后 [0,12]）≠ expected `['第一句','第二句']`
- `强句末标点优先…`/`逗号作为次优切点…`：actual 单段（旧 min 30 字阈值内不切）
- `拉丁文本在空白边界切分…`：actual 字数 `[60]` ≠ expected `[30, 30]`
- `小数、版本号与 URL 中的句点…`：actual 1 段 ≠ ≥2 段（旧实现不切）
- `无标点长中文…`：actual `[100]` ≠ expected `[24,24,24,28]`；`无标点长拉丁…`：actual `[100]` ≠ expected `[55,45]`
- `正常字符密度…`：actual 3 段（20 秒窗口）≠ expected 12 段（≤6 秒）
- `极稀疏源行保真例外…`：actual 含 `{text: ''}` 的 timing-only 空段 ≠ expected 单段 `'甲'`
- `扩展汉字…`：actual 2 段（每行 100 字）≠ expected 8 段（[24,24,24,28]×2）
- `from === to…`/`to < from…`：旧实现对退化时间产生 `end: 3 < start: 8` 等异常

## 四、实现摘要

`src/adapters/bilibili/transcript.ts` 全量重写（净减约 40 行），删除旧的跨行聚合状态（`current`/`flush`/20 秒窗口/90–320 字阈值/timing-only 空段），替换为：

- **固定常量**：`TARGET_DURATION_SECONDS = 4`、`MAX_DURATION_SECONDS = 6`；中文 `{minCut:6, target:24, max:28}`、拉丁 `{minCut:12, target:56, max:72}`（模块私有，不进设置页）。
- **语言判定**：`/\p{Script=Han}/u`（支持扩展汉字），全部按 `Array.from` 的 code point 计数。
- **按时长调整**：`targetByTime = max(1, floor(chars×4/duration))`、`maxByTime = max(targetByTime, floor(chars×6/duration))`；`targetLimit = min(languageTarget, targetByTime)`、`hardLimit = max(targetLimit, min(languageMax, maxByTime))`。
- **切点优先级**（`findCutIndex`）：强句末 `。！？”’!?；;` → 后跟空白的拉丁句点（保护小数/版本号/URL）→ 弱标点 `，,、：:` → 拉丁空白边界 → `targetLimit` 硬切；候选位于 `[offset+min(minCut, remaining−1), offset+hardLimit]`，同优先级取距 `offset+targetLimit` 最近、同距取较后（标点归前段）；剩余 ≤ hardLimit 直接收尾。
- **空白处理**（`advanceCut` + 切分循环）：正常分隔空白归入前段，且吸收以本段硬上限为界（避免病态长空白串使子段超过 6 秒）；被截断产生的纯空白块**不单独成段**，挂起后并入下一个含内容子段（行尾则并入最后一段），起点取块首、时间仍按 code point 比例——"无空文字段"（计划 §0.4 硬性要求）优先于"子段 ≤ 6 秒"（后者在病态输入下不可两全，已在 §七 说明）。
- **极稀疏例外**：`duration > 6 且 duration/chars > 6` 时保留单个非空展示段与原始时间范围（进入切分循环前判断）。
- **时间分配**：`from + duration×(offset/chars)`；首段 start 精确等于 `from`、末段 end 精确等于 `to`、相邻子段共享同一表达式（IEEE 精确相等）；`to < from` 规范为非负区间，`from === to` 不产生 NaN。
- **`groupTranscript`**：过滤空白行 → 逐行 `flatMap(splitSubtitleLine)` → 全局顺序编号 `S0001…`。

**未修改** `src/subtitle/subtitle.ts`：官方轨与 AI 虚拟轨在 `renderReady` 中调用同一 `groupTranscript`（subtitle.ts:499），点击跳转/播放高亮消费返回的 `start/end`，接口未变；全量测试 38 文件 / 600 用例零失败证明无调用方缺陷。未新增设置、消息协议、依赖、网络或 AI 请求。

## 五、自动化验证

- **Task 2 后**：`npx vitest run tests/adapters/bilibili-transcript.test.ts tests/adapters/bilibili-subtitle-service.test.ts tests/adapters/bilibili.test.ts` → 45/45 通过（含 3 个保护文件对应测试）。
- **Task 3 后**：`npx vitest run tests/subtitle-page.test.ts` → 52/52 一次通过（新增 6 个细粒度分段集成用例，未改 `subtitle.ts`）。
- **全量**：`npm test` 38 文件 / **606 测试**全过（0 失败）。
- **最终（独立审查修复后，全新运行）**：`npm test` 38 文件 / **610 测试**全过；typecheck 0；build 0；`git diff --check` 干净。

集成覆盖点：官方中文长行 4 段（data-start 0/4/8/12、显示 00:00/00:04/00:08/00:12、拼接不丢字）；AI 虚拟轨同规则 4 段且翻译请求仅 1 次（请求载荷仍为原始英文 1 行 0~4 秒——分段发生在翻译返回之后）；切官方英文再切回虚拟轨命中翻译缓存（key 只依赖源轨）；点击第三段 seek 8 秒；播放 3.9/4.0/8.5/13.5/14.0 秒高亮按短段切换、无下一行无高亮；0~2 与 10~12 真实空档无占位行、空档处无高亮。

## 六、手工 Chrome 验收

**结论：未验证（环境无法加载扩展，非功能判负）。**

- 环境：Windows + 系统 Chrome `151.0.7922.174`（`C:\Program Files\Google\Chrome\Application\chrome.exe`）。
- 加载方式与错误（本会话与上一任务实测，结论一致）：
  1. branded Chrome 自 137 起移除了 `--load-extension` 命令行支持——命令行中出现该 flag 但 `chrome://extensions` 扩展列表为空；
  2. Playwright 自带 chromium 打开 `chrome://extensions` WebUI 会触发整个浏览器崩溃；
  3. Playwright persistent context + 扩展 flag 组合注册不出任何扩展 Service Worker。
- 因此 Task 5 的全部检查项（BV1dsut6AES4 官方中文轨细粒度节奏、点击跳转抽样、60 秒随播高亮、BV1Yku16CEzX AI 中文轨、翻译计数）**均未执行**，不能以单元测试代替手工验收结论。

### 用户手工验收步骤

1. 在 `chrome://extensions` 开启开发者模式 →「加载已解压的扩展程序」→ 选择本工作树的 `dist` 目录（先在仓库根运行 `npm run build` 确认产物最新），确认加载的是本 checkout 而非其他目录。
2. 打开 `https://www.bilibili.com/video/BV1dsut6AES4/`，从侧栏右上角进入「字幕」页，检查：不再出现 14~18 秒一大段；长行被拆成约 4 秒小段（如 00:00、00:04、00:08、00:12…，实际节奏依源数据而变）；每段是一句可读文字；无空白行、无重复句；源字幕空档处无伪文字。
3. 随机点击至少 5 个非首段字幕：播放器跳到该段显示的起始时间附近，不再总是跳回大段起点；高亮与播放位置一致。
4. 连续播放 60 秒：高亮约每几秒随内容推进，同一大段不再持续高亮十几秒；无字幕停顿处允许无高亮；自动滚动不错位。
5. 在已开启 AI 翻译且已配置的前提下打开 `https://www.bilibili.com/video/BV1Yku16CEzX/`：轨道显示"简体中文（AI 翻译）"；翻译结果同样被拆成短段；英文 ↔ AI 中文来回切换不重复发起翻译；翻译失败时保留官方英文。
6. 把观察结果（前 8 个字幕起始时间、点击抽样、AI 请求次数）记录到本报告或反馈给开发者。

## 七、未验证项和已知限制

**已知限制（比例估时精度）：** B 站源字幕只提供整行 `from/to`，没有逐字时间码。一条长源行被拆成多个子段时，子段时间按各子段累计 code point 占该行总 code point 的比例线性分配。因此子段时间是"文字位置估算"而非语音对齐：语速变化、停顿、专有名词读音长短都会造成偏差。只有 ASR 或平台词级时间码才能进一步精确；本任务不暗示已实现词级对齐。

**极稀疏源行保真例外：** 当 `duration > 6 且 duration/chars > 6`（平均一个不可再分的 code point 已超过 6 秒）时，保留单个非空展示段与源行原始时间范围，允许超过 6 秒。这是源数据过稀的保真选择，不重复文字、不生成空段、不发明内容（单元测试"极稀疏源行保真例外"覆盖）。

**其他不变量核验（小型本地调用，混合语料 9 类源行 → 22 段）：** 无空文字段、ID 唯一连续、时间有限且 end ≥ start、全局有序、逐源行去空白拼接无丢字、同源行相邻子段时间连续、子段落在源行范围内且首尾精确、真实空档无占位段、正常密度子段 ≤ 6 秒、稀疏例外单段原文——全部 PASS。

**范围与敏感信息检查：** `git status` 仅含本任务允许文件与 3 个保护文件；`rg "API[_ -]?KEY|Authorization|Bearer"` 在新增/修改文件中的命中仅为既有良性文案（测试错误提示与用户文档），分段代码零命中，无密钥、Authorization header 或 Provider 正文。

## 八、独立代码审查结论与处置

独立审查（子代理，快照 HEAD `c03f01c`，自行复跑单元/全量测试与 typecheck，另用 node 直载 transcript.ts 实测边界）结论：**0 Critical、1 Important、2 Minor**；8 个专项问题（跨行合并、死循环/丢字、code point、时间数学、稀疏例外、双轨集成、翻译语义、保护文件）全部通过；确认窗口倒置（hardLimit < minCut）回退行为可接受、`subtitle.ts` 未触碰、diff 范围合规。

处置记录：

| 发现 | 级别 | 处置 |
|---|---|---|
| 纯空白展示段：行内空白串长于 hardLimit 时，fix-up 分支吞掉整个剩余空白，产出可点击/高亮的"看不见的文字"段（实测 30 空格/20 秒 → 22 空白段约 12.9 秒） | Important | **已修复**（`fix: merge long whitespace runs…`）：TDD 红灯先行；吸收仍以硬上限封顶，纯空白块不再单独成段——挂起并入下一个含内容子段（行尾并入最后一段），时间仍按比例、相邻端点仍精确相等、拼接仍无损；新增"行中长空白串"测试（19 用例） |
| 句点后"空白或文本结尾"：实现只判空白 | Minor | **已处理**：审查已证明文本结尾句点永远进不了候选窗口（整段收尾分支 + `last < total-1`），行为完全等价；在 `dotCut` 处补等价性注释防未来重构产生真实差异 |
| 文档未同步空白归属语义；§九待回填 | Minor | **已修复**：§四"空白处理"按新语义重写并明确"无空段"优先于"≤6 秒"；§九提交清单已回填（审查快照为 c03f01c，其时 §九 尚未提交）。计划文档 §1.5"固定规格"正文未改动——计划文档仅按约定做 checkbox 勾选，正文差异以本报告为准 |

审查修复后复跑：`npx vitest run tests/adapters/bilibili-transcript.test.ts` 19/19；`npm test` 38 文件 / **610 测试**全过；typecheck 0。

## 九、提交记录与最终工作树状态

提交范围 `2c72489..HEAD`（分支 `codex/bilibili-subtitle-sidepanel`，未 merge/push/PR/改 main）：

| 提交 | 内容 |
|---|---|
| `45f1279` | docs: plan fine-grained bilibili subtitle segmentation（计划+报告骨架） |
| `75b8063` | test: define fine-grained subtitle segmentation（15 用例红灯合同） |
| `92e9499` | feat: segment bilibili subtitles into short timed cues（groupTranscript 重写） |
| `bf4f5fc` | test: use close-to boundaries in segmentation expectations（计划 4.3 浮点断言） |
| `66e085b` | test: cover short subtitle timing interactions（6 个页面集成用例） |
| `7263a61` | docs: document fine-grained subtitle timing（README+报告） |
| `9aac37c` | docs: record chrome acceptance as unverified（验收未验证记录） |
| `1e2405d` | fix: bound whitespace absorption by segment hard limit（自查修复+红灯测试） |
| `f7730cd` | test: keep empty-input invariant in segmentation suite |
| `c03f01c` | test: lock degenerate cut-window progress invariant |
| `d5393d2` | docs: record segmentation commit log in progress report |
| `9783665` | docs: tick verified items in segmentation checklist |
| `83b56cf` | fix: merge long whitespace runs into adjacent content segments（审查 Important 1 修复） |

最终工作树：仅 3 个既有未提交保护文件（哈希与开始时一致，未进入任何提交）。
