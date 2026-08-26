# Clip2MD V1「一图速览」开发进度

> 更新时间：2026-08-26（Asia/Shanghai）  
> 当前分支：`codex/clip2md-v1-visual-overview`  
> 开发前快照：`925f6b6`  
> 当前已提交功能版本：`f81ed9f`  
> 当前阶段：Phase 2 审查修复中

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
| 2 | 快捷键触发 `EXTRACT`，复用 `ContentDocument`，侧栏预览标题/作者/正文前 300 字 | 主体已完成；竞态修复在途，尚未验证提交 |
| 3 | AI Settings V3、Endpoint 校验、API Key、Model、运行时 Host 权限、测试连接 | 未开始 |
| 4 | AnalysisInput、Prompt、AI Client、JSON Schema、手写校验与一次 repair | `AnalysisInput` 已提前完成；其余未开始 |
| 5 | ContentDocument → AI → VisualSummary 的 Background 完整编排 | 未开始 |
| 6 | 正式 Side Panel：Summary、KeyPoints、Tree、Takeaways | 未开始 |
| 7 | Session Cache、重新生成、错误映射、完整 requestId 竞态保护 | requestId 基础修复在途；其余未开始 |
| 8 | Side Panel 保存 Markdown，复用现有 `runSave` | 未开始 |
| 9 | 完整测试、隐私政策、README、手工 Chrome 验证和最终审查 | 未开始 |

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

该提交把任务目标、架构、安全边界、九项实施任务、测试与最终验收写入仓库。

### 3. Phase 1：Side Panel 与快捷键

已提交：

- `1531192 feat(visual-summary): add side panel shortcut shell`
- `dd56b6d fix(visual-summary): wire shortcut in background`

已完成：

- manifest 增加 `sidePanel` 权限；
- 增加 `minimum_chrome_version: 116`；
- 增加 Side Panel 默认页面；
- 增加 `visual-summary` 快捷键及中英文 i18n；
- 增加运行时 AI Host 可选权限范围；
- build 增加 Side Panel IIFE 与 HTML/CSS 静态资源；
- 增加响应式浅色/暗色 Side Panel 壳，支持窄宽和 reduced motion；
- 快捷键优先使用命令回调提供的 tab，缺失时才查询活动标签页；
- 将快捷键注册放回真实 Background 模块，Side Panel 脚本保持 UI 专用；
- 保留原有 `save-clip` 和 `save-to-obsidian` 监听行为。

Phase 1 验证与审查：

- 针对性测试：8/8；
- 全量测试：240/240；
- `npm run typecheck`：通过；
- `npm run build`：通过；
- 规格审查：通过；
- 代码质量复审：Critical 0、Important 0、Minor 0。

### 4. Phase 2 主体：提取与预览

已提交：

- `f81ed9f feat(visual-summary): preview extracted X content`

已完成：

- 快捷键开栏后调用现有 Content Script 的 `EXTRACT`；
- 每次触发都重新提取当前 DOM，未缓存 X SPA DOM；
- 支持 Tweet 与 X Article；
- 使用 `chrome.storage.session` 按 tab 保存提取状态和预览，避免侧栏加载时丢消息；
- Side Panel 初始化时先注册变更监听，再读取当前状态，避免初始化竞态；
- 预览显示标题、作者、内容类型、来源 URL 和正文前 300 字；
- 非 X、提取失败、页面未加载完成时显示可操作中文提示；
- 新增平台无关 `buildAnalysisInput(document)`；
- 通过现有 `renderBody` 生成正文，不发送 DOM 或原始 AST；
- 正文不超过 16000 字时完整保留；超长时保留前 12000、指定省略标记和后 4000 字。

Phase 2 主提交验证：

- 全量测试：253/253；
- `npm run typecheck`：通过；
- `npm run build`：通过；
- 未进行真实 Chrome 手工测试。

## 五、现在准确停在哪里

Phase 2 的独立规格审查发现一个未完成问题：

```text
同一标签页快速触发文章 A 和文章 B
  ↓
B 先提取完成并写入最新预览
  ↓
A 后提取完成
  ↓
旧的 A 可能覆盖新的 B
```

审查要求增加 `requestId` / generation guard，并用“B 先完成、A 后完成”的乱序测试证明旧成功或旧错误都不能覆盖最新状态。

当前工作区已有尚未提交的在途修复：

- `src/analysis/types.ts`：状态增加 `requestId`；
- `src/background/visual-summary.ts`：记录每个 tab 的最新请求并拒绝旧请求写入；
- `tests/visual-summary.test.ts`：增加旧成功、旧错误晚到的两个乱序测试。

重要说明：

- 上述 3 个文件当前仍是未提交修改；
- `git diff --check` 当前没有空白错误；
- 因执行代理额度中断，尚未取得这组修改的最新 targeted/full/typecheck/build 结果；
- 因此不能把 Phase 2 标记为完成，也不能直接开始 Phase 3。

## 六、下一步从哪里继续

恢复开发时必须从以下顺序继续：

1. 检查当前 3 个未提交文件，确认 requestId 实现与最终 `VisualAnalysisState` 兼容；
2. 运行新增乱序测试，确认旧实现时失败、当前实现时通过；
3. 运行 Phase 2 针对性测试；
4. 运行 `npm test`；
5. 运行 `npm run typecheck`；
6. 运行 `npm run build`；
7. 提交 Phase 2 竞态修复；
8. 重新进行 Phase 2 规格审查；
9. 规格通过后进行代码质量审查；
10. 两道审查均通过后，才进入 Phase 3 AI Settings。

建议的下一提交信息：

```text
fix(visual-summary): ignore stale extraction results
```

## 七、当前 Git 状态

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
```

当前未提交：

```text
M src/analysis/types.ts
M src/background/visual-summary.ts
M tests/visual-summary.test.ts
```

本进度文档只记录事实，不把上述在途代码标记为已验证完成。

## 八、最终验收仍需完成

最终交付前至少还需要：

- AI Settings V2 → V3 无损迁移；
- Endpoint 与运行时 Host 权限安全校验；
- AI Client、超时、HTTP 错误映射、一次 repair；
- `VisualSummary` 严格 Schema 校验；
- Session Cache、force regenerate、完整 requestId 防竞态；
- 安全 DOM/CSS 结构树与正式结果 UI；
- Side Panel 保存复用现有完整保存链路；
- Privacy Policy 和 README 更新；
- 全套 typecheck/test/build；
- Chrome 中对 Tweet、X Article、非 X、未配置、缓存、重新生成、SPA、保存、暗色和 300px 宽度进行手工验证；
- 最终完整 diff、安全和代码质量审查。
