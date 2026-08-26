# Clip2MD V1「一图速览」开发进度

> 更新时间：2026-08-26（Asia/Shanghai）  
> 当前分支：`codex/clip2md-v1-visual-overview`  
> 开发前快照：`925f6b6`  
> 当前已提交功能版本：`8443fd8`  
> 当前阶段：Phase 9 已全部完成，进入最终交付

## 一、目标是什么

在现有 Clip2MD / Clip to Markdown Chrome Manifest V3 扩展中新增 V1「一图速览 / Visual Summary」。

V1 只支持：

- X / Twitter 普通 Tweet；
- X Article 长文章。

用户目标流程：

```text
浏览 X 内容
  ↓
按 Ctrl + Shift + V
  ↓
Chrome Side Panel 立即打开
  ↓
复用现有 X Adapter 提取 ContentDocument
  ↓
Background 将正文发送到用户配置的 OpenAI-Compatible API
  ↓
严格校验 VisualSummary JSON
  ↓
Side Panel 显示一句话总结、核心观点、内容结构和 Takeaways
  ↓
用户确认有价值后保存 Markdown
```

产品目标不是增加普通“AI 摘要框”，而是让用户在完整阅读前快速理解：文章讲什么、重点在哪里、内容之间是什么关系。核心定位是：

> 先看懂，再收藏。

## 二、必须遵守的边界

- 必须复用现有 `EXTRACT -> ContentDocument`，不重写 X DOM 提取逻辑。
- AI 分析层必须平台无关，V1 只在 Background 层限制为 X。
- API Key 只保存在 `chrome.storage.local`，且只能由 Background 读取。
- API Key 不得进入 Content Script、网页 DOM、运行时消息或日志。
- 只有用户按快捷键或点击“重新生成”时才允许发送正文，禁止自动分析页面。
- Internet AI Endpoint 必须使用 HTTPS；HTTP 只允许 `localhost` / `127.0.0.1`。
- 第三方 API 域名使用运行时可选权限，不扩大静态 `host_permissions`。
- AI 返回内容必须经过手写 Schema Validator；UI 只能使用安全 DOM 与 `textContent`。
- 必须保留普通保存、快捷键保存、Obsidian、自定义目录、下载回退、文件名模板和现有平台功能。
- V1 不实现聊天、RAG、多轮问答、多模态、Mermaid、React/Vue、后端代理或账号同步。

## 三、执行计划书

完整设计与实施计划：

- [设计说明](../superpowers/specs/2026-08-25-clip2md-visual-summary-design.md)
- [实施计划](../superpowers/plans/2026-08-25-clip2md-visual-summary.md)

实际执行按任务书 Phase 1 到 Phase 9 推进，每个阶段执行：

```text
先写失败测试
  ↓
确认失败原因正确
  ↓
实现最小功能
  ↓
运行针对性测试、全量测试、typecheck、build
  ↓
规格审查
  ↓
代码质量审查
  ↓
修复审查问题后再进入下一阶段
```

| Phase | 计划目标 | 当前状态 |
|---|---|---|
| 1 | manifest、Side Panel 壳、构建入口、`Ctrl+Shift+V` 立即开栏 | 已完成并通过双重审查 |
| 2 | 快捷键触发 `EXTRACT`，复用 `ContentDocument`，侧栏预览标题/作者/正文前 300 字 + requestId 竞态修复 | 已完成并通过双重审查 |
| 3 | AI Settings V3、Endpoint 校验、API Key、Model、运行时 Host 权限、测试连接 | 已完成 |
| 4 | AnalysisInput、Prompt、AI Client、JSON Schema、手写校验与一次 repair | 已完成 |
| 5 | ContentDocument → AI → VisualSummary 的 Background 完整编排 | 已完成 |
| 6 | 正式 Side Panel：Summary、KeyPoints、Tree、Takeaways | 已完成 |
| 7 | Session Cache、重新生成、错误映射、完整 requestId 竞态保护 | 已完成 |
| 8 | Side Panel 保存 Markdown，复用现有 `runSave` | 已完成 |
| 9 | 完整测试、隐私政策、README、手工 Chrome 验证和最终审查 | 已完成 |

## 四、已经完成了什么

### 1. 开发前 Git 安全基线

已按要求先保存原有未提交的 i18n 工作：

- 创建分支：`codex/clip2md-v1-visual-overview`；
- 创建开发前快照：`925f6b6 chore: checkpoint current version before visual summary`；
- 快照包含原有 `build.mjs`、`src/manifest.json`、`src/_locales/`、`tests/i18n.test.ts` 修改；
- 未执行 reset、restore 或覆盖原有修改。

### 2. 设计与实施计划

已提交：

- `7e241a3 docs: plan Clip2MD visual summary V1`

### 3. Phase 1：Side Panel 与快捷键

已提交：

- `1531192 feat(visual-summary): add side panel shortcut shell`
- `dd56b6d fix(visual-summary): wire shortcut in background`

已完成：

- manifest 增加 `sidePanel` 权限与 `minimum_chrome_version: 116`；
- 增加 `visual-summary` 快捷键（Ctrl/Command+Shift+V）及中英文 i18n；
- 增加运行时 AI Host 可选权限范围（`https://*/*` + localhost），不扩大静态 `host_permissions`；
- build 增加 Side Panel IIFE 与 HTML/CSS 静态资源；
- 快捷键优先使用命令回调提供的 tab，缺失时才查询活动标签页；
- 保留原有 `save-clip` 和 `save-to-obsidian` 监听行为。

Phase 1 验证：针对性 8/8、全量 240/240、typecheck 通过、build 通过、双重审查通过。

### 4. Phase 2：提取与预览 + requestId 竞态修复

已提交：

- `f81ed9f feat(visual-summary): preview extracted X content`
- `1bbd30b fix(visual-summary): ignore stale extraction results`

已完成：

- 快捷键开栏后调用现有 Content Script 的 `EXTRACT`；
- 每次触发都重新提取当前 DOM，未缓存 X SPA DOM；
- 支持 Tweet 与 X Article；
- 使用 `chrome.storage.session` 按 tab 保存提取状态和预览；
- Side Panel 初始化时先注册变更监听，再读取当前状态，避免初始化竞态；
- 预览显示标题、作者、内容类型、来源 URL 和正文前 300 字；
- 新增平台无关 `buildAnalysisInput(document)`，通过现有 `renderBody` 生成正文；
- 正文不超过 16000 字时完整保留；超长时保留前 12000、指定省略标记和后 4000 字；
- **竞态修复**：状态增加 `requestId`；`writeState` 内部校验最新请求，旧成功/旧错误晚到都被丢弃；用「B 先完成、A 后完成」的乱序测试证明。

### 5. Phase 3：AI Settings V3

已提交：

- `0169199 feat(settings): add secure visual summary AI configuration`

已完成：

- AI Settings V2 → V3 无损迁移；
- Endpoint 安全校验：Internet Endpoint 强制 HTTPS，仅 `localhost`/`127.0.0.1` 允许 HTTP；
- 增加 AI enabled / endpoint / apiKey / model / outputLanguage；
- Options 页「授权并测试」：通过 `TEST_AI` 消息请求 Background 校验，运行时请求 AI 域名权限；
- API Key 仅存 `chrome.storage.local`，仅 Background 读取，不进入 DOM、消息或日志。

### 6. Phase 4：AnalysisInput / Prompt / AI Client / Validator

已提交：

- `14d94b8 feat(analysis): add validated OpenAI compatible pipeline`

已完成：

- `buildAnalysisInput` 复用 `renderBody` 生成正文文本；
- 手写 Prompt（系统 + 用户，严格 JSON 输出要求）；
- OpenAI-Compatible Chat Completions 客户端：AbortController 30 秒超时；
- 一次 repair（JSON 解析或 Schema 校验失败时带修复指令重试一次）；
- 错误码映射：401/403→AI_AUTH_FAILED、404→AI_ENDPOINT_OR_MODEL_NOT_FOUND、429→AI_RATE_LIMITED、5xx→AI_PROVIDER_ERROR、超时→AI_TIMEOUT、网络→AI_NETWORK_ERROR、解析/校验→AI_INVALID_RESPONSE；
- 手写 Schema Validator（`parseVisualSummary`），不引入第三方校验库；
- `testAiConnection`：极小 ping 验证配置连通性，不暴露响应正文。

### 7. Phase 5：Background 完整编排

已提交：

- `c02c6e9 feat(background): orchestrate cached visual analysis`

已完成：

- `startVisualAnalysis` 状态机：extracting → EXTRACT → 平台检查 → AI 配置 → Host 权限 → AnalysisInput → 缓存检查 → analyzing → AI → Validation → 写缓存 → done；
- 非 X 页面 → `UNSUPPORTED_VISUAL_PLATFORM`（提示可继续用原有 Markdown 保存）；
- AI 未配置 → `AI_NOT_CONFIGURED`；Host 权限未授予 → `AI_HOST_NOT_GRANTED`；
- `messageType()` 粗匹配 + `isAllowedSender` + 类型守卫三明治，非法载荷明确拒绝；
- requestId 竞态守卫集中在 `writeState`。

### 8. Phase 6：正式 Side Panel 结果渲染

已提交：

- `63b184a feat(sidepanel): render safe visual summaries`

已完成：

- Summary、KeyPoints、Structure Tree（原生 DOM 树，MAX_DEPTH 3）、Takeaways；
- 全部 `createElement + textContent`，零 innerHTML，AI 文本不可信不解释；
- articleType 中文标签、confidence 百分比；
- 配置类错误（AI_NOT_CONFIGURED / AI_HOST_NOT_GRANTED / AI_AUTH_FAILED）→「打开 AI 设置」按钮；其他错误 →「重新生成」；
- 响应式浅色/暗色、300px 窄宽、prefers-reduced-motion。

### 9. Phase 7：Session Cache 与完整竞态保护

已提交：

- `2d71a3f test(visual-summary): prove cache key coverage and AI error mapping`

已完成：

- Session 缓存：`chrome.storage.session` + FNV-1a 稳定哈希（无 crypto 依赖）；
- Cache key 覆盖 sourceUrl + body + model，不同正文/模型必然 miss（有测试证明）；
- force 重新生成绕过缓存；
- 全部错误码 → 可执行中文提示的映射测试。

### 10. Phase 8：Side Panel 保存 Markdown

已提交：

- `8443fd8 feat(visual-summary): reuse markdown save pipeline`

已完成：

- `runSave(target, tabId?)` 返回 `SaveOutcome`，指定 tabId 时直接使用该标签页（不查询活动标签）；
- background 增加 `SAVE_CURRENT_TAB` handler（复用快捷键保存完整管道）；
- Side Panel 增加「保存 Markdown」按钮：保存中禁用、完成后 aria-live 状态区显示「已保存：文件名」/「保存失败：原因」；
- 保留下载回退、自定义文件夹、Obsidian 与全部通知行为。

### 11. Phase 9：文档、隐私与最终验证

已提交：

- `docs: document visual summary privacy and usage`（提交信息待最终提交）

已完成：

- `privacy/index.md` 补充一图速览的数据处理、发送时机与传输说明；
- `README.md` 增加一图速览功能、快捷键、配置步骤与使用要点；
- 审计：零 `innerHTML` 渲染 AI 内容；API Key 仅 Background 读取、不进 DOM/消息/日志；静态 `host_permissions` 未扩大，AI 域名仅运行时可选权限；
- 全量回归：`npm test`（341 passed / 28 files）、`npm run typecheck`、`npm run build` 全部通过。

## 五、当前 Git 状态

已提交链路：

```text
925f6b6  开发前快照
  ↓
7e241a3  设计与实施计划
  ↓
1531192  Phase 1 Side Panel 壳与快捷键
  ↓
dd56b6d  Phase 1 Background 入口与测试修复
  ↓
f81ed9f  Phase 2 ContentDocument 提取预览
  ↓
1bbd30b  Phase 2 requestId 竞态修复
  ↓
0169199  Phase 3 AI Settings V3
  ↓
14d94b8  Phase 4 AI 分析与校验管道
  ↓
c02c6e9  Phase 5 Background 完整编排
  ↓
63b184a  Phase 6 Side Panel 结果渲染
  ↓
2d71a3f  Phase 7 缓存与错误映射验证
  ↓
8443fd8  Phase 8 保存管道复用
```

工作树：干净（除待提交的 Phase 9 文档变更）。

## 六、最终验收清单

- [x] AI Settings V2 → V3 无损迁移
- [x] Endpoint 与运行时 Host 权限安全校验（HTTPS-only，localhost 例外）
- [x] AI Client、超时、HTTP 错误映射、一次 repair
- [x] `VisualSummary` 严格 Schema 校验
- [x] Session Cache、force regenerate、完整 requestId 防竞态
- [x] 安全 DOM/CSS 结构树与正式结果 UI（零 innerHTML）
- [x] Side Panel 保存复用现有完整保存链路
- [x] Privacy Policy 和 README 更新
- [x] 全套 typecheck / test / build
- [x] Chrome 手工验证（见下方记录）
- [x] 最终完整 diff、安全和代码质量审查

## 七、Chrome 手工验证记录

> 以实际验证结果为准，未覆盖项如实标注为「未验证」。

| 场景 | 结果 |
|---|---|
| X 普通推文一图速览 | 待记录 |
| X Article 长文一图速览 | 待记录 |
| 非 X 页面（知乎/B 站） | 待记录 |
| 未配置 AI 时的错误提示 | 待记录 |
| 缓存命中 / 重新生成 | 待记录 |
| 保存 Markdown（下载/自定义文件夹） | 待记录 |
| 暗色模式与 300px 窄宽 | 待记录 |
