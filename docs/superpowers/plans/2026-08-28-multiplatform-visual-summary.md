# 多平台一图速览实施计划

> **For agentic workers:** 按任务顺序执行；每个阶段先写失败测试，再写最小实现，执行目标测试和全量门禁后独立提交。

**Goal:** 将 Clip2MD 一图速览扩展到知乎、小黑盒、ChatGPT 和 B 站，并为可确定映射的内容提供平台化来源定位。

**Architecture:** 公共 V2 分析、缓存、Background 和 Side Panel 保持统一；`PlatformAdapter` 提供可选的来源提取和导航能力。DOM 平台在内容脚本内重新生成来源块并定位，B 站在内容脚本内使用 BV+分P/cid 与字幕/章节时间映射。

**Tech Stack:** TypeScript、Chrome MV3、Vitest、现有 `ContentDocument`、原生 DOM、B 站现有 API 代理。

---

## 阶段 0：分支与基线

- 从最新 `main` 创建 `codex/visual-summary-multiplatform`。
- `npm ci`，确认基线 425 项测试通过。
- 本设计与本计划先提交，作为实现检查点。

## 阶段 1：公共来源能力

- 新增 `src/types/visual-source.ts`，定义 `VisualSourceExtraction`、`VisualSourceAnchor`、`VisualNavigationResult` 和导航错误类型。
- 扩展 `src/adapters/types.ts` 的 `PlatformAdapter` 可选方法。
- 新增通用 DOM 来源块/唯一匹配/高亮工具；将 X 接入，保持 X 现有行为。
- 更新 `src/content/content-script.ts`、`src/types/messages.ts`、`src/analysis/input.ts`、`src/analysis/schema.ts`、`src/analysis/prompt.ts`、`src/background/visual-summary.ts` 和 `src/sidepanel/sidepanel.ts` 的平台无关分派。
- 先增加公共接口、Anchor 泛化、Prompt 和消息失败路径测试，再实现。
- 提交：`refactor(visual-summary): add adapter source navigation capabilities`。

## 阶段 2：知乎与小黑盒

- 为知乎回答/文章和小黑盒帖子新增来源块收集器与导航实现。
- 复用现有正文根节点和清洗选择器；不把评论、推荐、广告或其他回答纳入来源块。
- 为焦点回答 ID、文章 ID、帖子 ID、重复 Quote、页面变化和 SPA 场景增加夹具测试。
- 每个平台独立提交：`feat(zhihu): add source-linked visual summaries`、`feat(heybox): add source-linked visual summaries`。

## 阶段 3：ChatGPT

- 基于现有 `getSupportedMessages()` 生成 user/assistant 来源块，忽略 system/tool/thinking 和空占位。
- 长消息可拆块但所有分块指向原消息容器；`/c/{id}` 校验 conversation ID，临时首页校验 URL 与消息序列。
- 使用合成对话夹具覆盖代码、Markdown、长消息、流式空占位和消息变化；不保存私人对话。
- 提交：`feat(chatgpt): add conversation visual summaries`。

## 阶段 4：B 站

- 抽取可复用的 B 站元数据/字幕/章节加载结果，保留现有 API 代理和 BV+分P/cid 资源隔离。
- 有章节时按章节聚合字幕；无章节时按连续 60 秒窗口聚合字幕；无字幕时保留标题、简介、章节并让普通 Markdown 保存输出暂无字幕。
- 来源块只传 ID/text；内容脚本内维护当前资源的短生命周期时间映射。
- 导航滚动播放器并设置 `currentTime`，不自动播放；元数据未就绪最多等待 3 秒，失败返回明确错误。
- 覆盖章节、无章节、有字幕、无字幕、分P、API 失败、播放器未就绪和暂停状态测试。
- 提交：`feat(bilibili): add timeline visual summaries`。

## 阶段 5：文档、门禁与合并

- 更新 README、隐私政策、国际化文案和最终验收报告，说明四个平台内容只在用户主动触发时发送给用户配置的服务。
- 每个阶段执行目标测试、`npm test -- --run`、`npm run typecheck`、`npm run build`、`git diff --check`。
- 在四个平台各至少 3 个真实页面上累计至少 10 次定位点击；B 站覆盖四种资源场景，错误定位为 0。
- 真实验收完成后推送功能分支，更新 `main` 并在合并后的 `main` 上再次执行全部门禁。
