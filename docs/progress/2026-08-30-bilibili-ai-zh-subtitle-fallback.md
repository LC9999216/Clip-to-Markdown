# B站简体中文 AI 翻译兜底 执行进度报告

日期：2026-08-30（执行日）
计划文件：`docs/superpowers/plans/2026-08-30-bilibili-ai-zh-subtitle-fallback.md`

## 一、基础信息

- 分支：`codex/bilibili-subtitle-sidepanel`
- 工作树绝对路径：`C:\Users\HP\OneDrive\桌面\example\clip2md\.worktrees\bilibili-subtitle-sidepanel`
- 执行前基线 HEAD：`b1968f1`（计划预期一致）
- 最终 HEAD：见「六、Git 状态」
- 基线快照（Task 0 记录）：基线时工作树存在 4 个未提交修复文件（`src/adapters/bilibili/subtitle-service.ts`、`tests/adapters/bilibili-subtitle-service.test.ts`、`tests/adapters/bilibili.test.ts`、`tests/subtitle-page.test.ts`）与未跟踪的计划文件。执行全程未 reset / checkout / clean / stash / 覆盖这些修改；其中 `tests/subtitle-page.test.ts` 在 Task 4/5 中按计划追加本功能的测试（既有 WBI/ai-zh 修复内容原样保留在后续提交中），其余 3 个文件至今仍保持未提交状态。

## 二、任务完成状态

| Task | 内容 | 状态 |
|---|---|---|
| Task 0 | 接管工作树、审阅既有差异、基线门禁、快照 | ✅ 完成 |
| Task 1 | 设置 V4 与显式翻译开关 | ✅ 完成 |
| Task 2 | 严格、可分批的字幕翻译模块 | ✅ 完成 |
| Task 3 | 安全的 Background 翻译消息 | ✅ 完成 |
| Task 4 | 字幕页虚拟简中轨、自动选择、会话缓存 | ✅ 完成 |
| Task 5 | 翻译失败保留官方字幕 + 精确提示 | ✅ 完成 |
| Task 6 | 文档、隐私断言、全量门禁、独立审查 | ✅ 完成（审查结论见「四」） |
| Task 7 | 真实 Chrome 验收 | ⚠️ 部分完成（构建冒烟受环境限制；目标视频等需登录态与用户 API Key 的项目未验证，见「五」） |

## 三、TDD 执行记录（每阶段红灯 → 最小实现 → 绿灯）

- Task 1：先在 `tests/core/settings.test.ts` 增加 V3→V4 迁移、V4 保存读取、严格布尔规范化 3 个失败测试；`tests/options.test.ts` 增加 `ai-bilibili-subtitle-translation` 必需 ID 与外发告知/保存用例。红灯确认（5 failed）→ 实现 → 绿灯（settings 18 + options 23 全过）。
- Task 2：新建 `tests/subtitle-translation.test.ts`（时间码保持、非法响应一次修复、围栏清除、60 行/6000 字符分批、空输入零调用，共 11 用例）。红灯（模块不存在）→ 导出 `completeText`/`AiChatMessage`/`TextCompletionOptions`/`stripJsonFence` 并实现 `src/analysis/subtitle-translation.ts` → 绿灯（11 + ai-client 33 全过）。
- Task 3：`tests/background.test.ts` 新增守卫边界（行数/字符/时间/ID 上限、精确键）与授权矩阵（非本扩展 sender、开关关闭、字段缺失、权限未授予 → fetch 0 次；401/404/429/5xx/超时/网络/非法输出映射稳定错误码且不回传 provider 正文；成功路径仅 1 次 AI 调用）。红灯（20 failed）→ 实现消息守卫与 handler → 绿灯（background 44 全过）。
- Task 4：`tests/subtitle-page.test.ts` 新增 en+jp fixture 与 10 个用例（自动简中主路径、官方中文零调用、手动英文恢复 + ui.v2、重开不重译、虚拟轨命中缓存、ui.v1 忽略、翻译缓存键 `clip2md.bilibiliSubtitle.translation.v1.BV1xx411c7mD:p2:ai-en`、刷新重译替换正文、迟到响应按 generation+tabId 丢弃）。红灯（10 failed）→ 实现虚拟轨/决策表/缓存 → 绿灯（字幕页 30 全过）。
- Task 5：新增 10 个错误码精确文案用例（每例断言英文正文保留、下拉可用、设置/刷新存在、无 `sk-`/provider 正文进 DOM）+ dispose 迟到响应 + 快速连续刷新仅当前 generation 生效。红灯（12 failed）→ 实现单点 `translationErrorMessage` 映射 → 绿灯（字幕页 42 + playback + content-script 共 82 全过）。
- Task 6：`tests/visual-summary.test.ts` 缩小字幕页越界词断言（仅禁复制/导出/搜索/双语/顺句/段数/ASR，不再禁"翻译"）+ 新增 README 断言。红灯 → 更新 README → 绿灯。

## 四、命令结果与测试数量

| 命令 | 结果 |
|---|---|
| Task 0 基线 `npm test` | 37 文件 / 529 测试全过 |
| 各阶段分段测试 | 全过（见上节） |
| 最终 `npm test` | **38 文件 / 595 测试全过**（0 失败；含审查修复后复跑） |
| 最终 `npm run typecheck` | 退出码 0 |
| 最终 `npm run build` | 退出码 0；`dist/subtitle.js`、`dist/options.js`、`dist/background.js` 均构建成功 |
| 最终 `git diff --check` | 无 whitespace error |
| 静态隐私扫描 | `src/subtitle` 中无 `apiKey`/`Authorization`/`translateBilibiliSubtitles`；翻译 runtime payload 仅 `sourceTrackId` 与 `lines`；README 与 Options 均含数据外发与费用提示 |

## 五、独立代码审查结论

（由独立 code-reviewer 子代理完成，重点覆盖计划 Task 6 Step 5 的 7 项）

审查结论：见文末「审查补充结论」。

## 六、真实 Chrome 验收结果

### 已执行（自动化冒烟，非计划完整验收）

- `npm run build` 产物完整（dist 含 manifest.json、background.js、options.html、subtitle.html 等）。
- 尝试用 Playwright 加载 `dist` 于真实 Chromium/Chrome 做扩展冒烟：
  - 系统 Chrome 为 v151（≥137），品牌版 Chrome 已移除 `--load-extension` 命令行支持，命令行虽出现该参数但扩展列表为空；
  - Playwright 默认 chromium 在加载 `chrome://extensions` WebUI 时进程崩溃，扩展 SW 未注册；
  - 因此"加载 dist → 打开设置页/字幕页"的浏览器内冒烟在本自动化环境无法完成，已停止尝试（未对仓库做任何改动）。

### 未验证项（按计划 Task 7 逐条如实标注）

以下均**未验证**，原因：需要真实用户 Chrome 配置（B 站登录态）与用户自己的 AI Endpoint / API Key（涉及外部费用），代理环境无法也不应代替用户提供：

1. 加载 `dist` 后设置页开启「启用 AI 功能」、填写 Endpoint/Key/模型、勾选「B站无简中轨时自动翻译为简体中文」、授权并测试、保存 —— **未验证**。
2. 目标视频 `https://www.bilibili.com/video/BV1Yku16CEzX/` 的下拉顺序（简体中文（AI 翻译）/ English（AI）/ 日本語（AI））、默认简中正文、点击跳转、高亮跟随、切轨、会话缓存、刷新重译 —— **未验证**。
3. 关闭翻译开关后无 AI 请求、显示官方英文 + 引导提示 —— **未验证**。
4. 官方中文视频零翻译请求路径 —— **未验证**。
5. 无效模型 / 撤销授权时的错误回退（页面、控制台、错误提示中不出现 API Key）—— **未验证**。

建议的手工验收步骤（在用户 Chrome 中执行）：

1. `chrome://extensions` → 加载已解压 → 选择 `C:\Users\HP\OneDrive\桌面\example\clip2md\.worktrees\bilibili-subtitle-sidepanel\dist`（注意不要选主工作树 dist）→ 重载扩展。
2. 打开扩展设置页：开启 AI 功能 → 填 Endpoint/Key/模型 → 勾选字幕翻译 → 「授权并测试」→ 保存。
3. 登录 B 站后打开目标视频 → 打开字幕页，按计划 Task 7 Step 3 逐项核对。
4. 关闭翻译开关重开视频核对 Step 4；换官方中文视频核对 Step 5；改无效模型核对 Step 6。

## 七、实际改动文件清单（本功能提交，b1968f1..HEAD）

生产代码：

- `src/core/ai-settings.ts`（+`translateBilibiliSubtitles`，默认 false）
- `src/core/settings.ts`（SETTINGS_VERSION 3→4，严格布尔规范化）
- `src/options/options.html`（翻译开关 + 外发/费用说明；总开关文案改为「启用 AI 功能（一图速览与字幕翻译）」）
- `src/options/options.ts`（加载/读取/保存翻译开关）
- `src/analysis/client.ts`（导出 `AiChatMessage`/`TextCompletionOptions`/`completeText`/`stripJsonFence`；temperature/max_tokens 改由 options 控制，默认行为不变）
- `src/analysis/subtitle-translation.ts`（新增：分批 60 行/6000 字符、严格 JSON 校验、一次修复、按 ID 回填保持时间码与顺序）
- `src/types/messages.ts`（`TRANSLATE_BILIBILI_SUBTITLES` 请求/响应/错误码与严格守卫）
- `src/background/background.ts`（受信任扩展页翻译 handler：守卫 → sender → 设置 → 主机权限 → 翻译；不调用 permissions.request）
- `src/subtitle/subtitle.ts`（虚拟简中轨 `clip2md-ai-zh:<sourceTrackId>`、ui.v2 偏好语义、翻译会话缓存、决策表 loadFor、错误映射、generation/tabId 防护）

测试：

- `tests/core/settings.test.ts`、`tests/core/ai-settings.test.ts`、`tests/options.test.ts`、`tests/ai-client.test.ts`、`tests/subtitle-translation.test.ts`（新增）、`tests/background.test.ts`、`tests/subtitle-page.test.ts`、`tests/visual-summary.test.ts`

文档：

- `README.md`（能力边界更新：官方中文优先；显式开启后仅"无中文+有英文"调用用户自选 AI；只发送英文字幕文本；不发送音视频；会话缓存；可能产生费用；仍无 ASR/OCR）
- `docs/progress/2026-08-30-bilibili-ai-zh-subtitle-fallback.md`（本报告）

未改动：`src/subtitle/subtitle.css`（无错误色新增需求）、`tests/setup.ts`（既有 mock 足够）、`src/subtitle/subtitle.html`（无新控件，符合计划）。

## 八、安全边界自评（对应计划审查重点）

1. 默认外发：`DEFAULT_AI_SETTINGS.translateBilibiliSubtitles = false`；V3/V0/V2 迁移补 false；Background 双开关（`enabled && translateBilibiliSubtitles`）校验 —— 无升级后默认外发路径。
2. API Key：仅 Background 的 `requestCompletion` 读取 `settings.ai.apiKey`；`src/subtitle` 无任何 Key 引用（grep 验证）；Background 错误响应只返回固定中文文案/稳定错误码，不透传 provider 正文。
3. 载荷限制：请求守卫精确键 + ≤5000 行 + 单行 ≤2000 Unicode 字符 + 总量 ≤400000 字符 + 0≤from≤to≤86400 + sourceTrackId 1–128 字符；不接受 URL/标题/身份字段。
4. 时间码/行数/顺序：模块按 ID 回填、缺 ID/重复/未知/空文本均判非法；渲染行只使用 `{from,to,content}`（缓存读取重新校验）。
5. 失败不冒充：失败路径 `renderReady(resource)`（官方轨）+ 状态文案；虚拟 option 不渲染。
6. 手动偏好：`select.onchange` 才写 `ui.v2.preferredTrackId`；自动加载不写；手动官方轨优先于翻译。
7. 刷新收费：仅刷新按钮 force 重译；其余路径命中会话缓存；重开页面翻译消息数不增加（有测试断言）。

## 九、Git 状态与操作边界

- 本功能提交（b1968f1 之后，按 Task 顺序）：
  - `23816ac` feat(settings): add Bilibili subtitle translation consent
  - `8b1a0d9` feat(ai): add validated subtitle translation pipeline
  - `3392745` feat(background): proxy opted-in subtitle translations
  - `15116ca` feat(subtitles): default to cached Simplified Chinese translation
  - `6bc29ad` fix(subtitles): keep official tracks when AI translation fails
  - `994547d` fix(subtitles): address review findings on retry and limits
  - （Task 6 文档 checkpoint 提交见 git log：docs: document Bilibili AI subtitle translation fallback）
- 未 merge、未 push、未创建 PR、未改动 `main`。
- Task 0 的既有未提交修复（`src/adapters/bilibili/subtitle-service.ts`、`tests/adapters/bilibili-subtitle-service.test.ts`、`tests/adapters/bilibili.test.ts`）仍保持未提交、内容未回退。

## 十、审查补充结论（已回填）

独立 code-reviewer 于 6bc29ad 版本完成审查，7 项审查重点全部通过（无默认外发、无 Key 泄漏、载荷受严格守卫、时间码/行数/顺序不可被 AI 篡改、失败不冒充简中、手动偏好不被覆盖、刷新必须显式动作）。发现 0 Critical、1 Important、6 Minor，全部已修复并回归（commit `994547d`）：

- I-1（已修复）：翻译失败回退官方轨后，刷新按钮会把 select 当前值（官方轨）当作手动偏好而跳过重试。修复：刷新改用持久化偏好 `uiState.preferredTrackId`；新增用例"翻译失败后点击刷新会重新尝试翻译"。
- M-1（已修复）：请求顶层增加精确键校验（`['type','payload']`）；新增顶层多余字段拒绝用例。
- M-2（已修复）：超限载荷不再以"请刷新重试"回应。导出 `canTranslateSubtitleLines` 供字幕页预检，超限时保留官方正文并提示"字幕行数或长度超出自动翻译上限"；新增用例。
- M-3（已修复）：新增失败标记会话缓存（TTL 10 分钟）。自动重开同一视频不再重复付费请求，显示精确错误；刷新/手动切轨立即重试；新增用例。
- M-4（已修复）：翻译模块新增可选批次级 hooks（loadBatch/saveBatch），Background 以"源轨 ID + 批次指纹"维护 SW 生命周期内备忘，重试跳过已翻译批次；新增模块与 handler 用例（含脏缓存忽略）。
- M-5（已修复）：新增整批回显启发式（源行含字母且全部译文无 CJK → 判未翻译，触发一次修复，仍失败则 AI_INVALID_RESPONSE）；个别专有名词行保留英文不受影响；新增两个用例。
- M-6（已修复）：移除自动路径的无条件滚动位置重置；滚动位置按 ui.v2（分视频）持久化，同视频重新探测可恢复；新增用例。

修复后全量门禁复跑：`npm test` 38 文件 / **595 测试**全过，`npm run typecheck` 0，`npm run build` 0，`git diff --check` 0。
