# Clip2MD V1 一图速览设计

## 目标与范围

在现有 Chrome MV3 扩展中增加用户主动触发的 X/Twitter 内容分析。快捷键 `Ctrl+Shift+Y` 立即打开 Side Panel，后台复用现有 `EXTRACT -> ContentDocument` 流程，将正文发送到用户配置的 OpenAI-Compatible Chat Completions API，并把严格校验后的 `VisualSummary` 渲染为一句话总结、核心观点、三层以内结构树与最多三条结论。用户可从 Side Panel 复用现有保存链路保存当前标签页的 Markdown。

V1 只支持普通 Tweet 与 X Article；不增加聊天、RAG、多模态、自动分析、远程后端、第三方图表或框架。

## 架构

```text
快捷键 / Side Panel 重新生成
  -> Background startVisualAnalysis(tabId, { force })
  -> Content Script EXTRACT（即时读取当前 SPA DOM）
  -> ContentDocument
  -> AnalysisInput（Markdown 正文，最多 16000 字）
  -> Background fetch 用户配置的 AI Endpoint
  -> JSON.parse + 手写 Schema Validator
  -> chrome.storage.session（按 tab 保存状态与会话缓存）
  -> Side Panel 读取并监听状态
```

保存操作发送 `SAVE_CURRENT_TAB`，Background 调用扩展后的 `runSave('default', tabId)`，继续沿用自定义目录、下载回退、文件名模板、首次设置与通知行为。

## 组件边界

- `src/core/ai-settings.ts`：Endpoint 规范化、可授权 origin pattern、默认 AI 设置。
- `src/analysis/types.ts`：`AnalysisInput`、`VisualSummary`、结构树和运行状态类型。
- `src/analysis/input.ts`：平台无关的 `ContentDocument -> AnalysisInput`，只使用 `renderBody`，不发送 DOM/AST。
- `src/analysis/prompt.ts`：简体中文分析 Prompt 与一次格式修复 Prompt。
- `src/analysis/schema.ts`：手写校验与安全文本截断；严重结构错误拒绝。
- `src/analysis/client.ts`：30 秒超时、错误映射、有限 fence 清除、最多一次 repair。
- `src/analysis/cache.ts`：稳定哈希、session cache 与按 tab 状态读写。
- `src/background/visual-summary.ts`：配置/权限/平台检查、缓存、请求竞态保护和状态机。
- `src/sidepanel/*`：状态呈现、响应式 DOM 树、保存/重试/打开设置；所有 AI 文本使用 `textContent`。

## 数据与安全

- Settings 从 V2 迁移至 V3，只新增 `ai`，保留 save/filename/obsidian 值。
- API Key 只存于 `chrome.storage.local`，只由 Background 读取；消息协议不包含 API Key。
- Internet Endpoint 仅允许 HTTPS；`http` 只允许 `localhost` 与 `127.0.0.1`。
- Host 权限通过 Options 用户按钮调用 `chrome.permissions.request` 获取；不加入广泛静态 `host_permissions`。
- 只有快捷键或“重新生成”会发送文章；打开页面、打开设置或切换标签页都不自动调用 AI。
- AI 内容禁止 `innerHTML`，返回值必须 Schema Validate，第三方错误正文不直接展示。

## 状态、缓存与竞态

每个标签页使用 `clip2md.visualSummary.state.<tabId>`，状态为 `idle | extracting | analyzing | done | error`。每次分析生成新的 `requestId`；写入后续状态前确认它仍是当前请求，防止旧请求覆盖新请求。

缓存键至少覆盖 source URL、正文和 model。普通重复触发优先命中 `chrome.storage.session`；`force: true` 绕过缓存。缓存不持久化到浏览器重启后的 local storage。

## UI

Options 在快捷键与 Obsidian 之间增加“AI 一图速览”卡片，包含启用、Endpoint、密码输入、显示/隐藏、Model、授权并测试与就近状态提示。

Side Panel 使用与现有设置页一致的浅色卡片体系并支持暗色模式、300px 窄宽与 reduced motion。打开后立即显示提取/分析 skeleton；完成后显示类型与置信度、一句话、2–5 个观点、原生 DOM/CSS 树、1–3 条 takeaways、保存和重新生成。错误必须映射为可执行中文提示。

## 验证

- 单元测试：AI 设置迁移与 Endpoint、安全 Schema、输入截断、客户端响应/错误/repair、缓存和后台状态机、Options、Side Panel 树与现有保存回归。
- 构建检查：`npm run typecheck`、`npm test`、`npm run build`。
- 浏览器检查：加载 `dist`，验证快捷键立即开栏、Tweet/X Article、未配置/未授权/非 X 错误、缓存/force、SPA 切换和保存。
