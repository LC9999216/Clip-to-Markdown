# Clip2MD「一图速览 V2」UI 重构与原文定位实施计划

> **执行要求：**实施时使用 `superpowers:executing-plans`，逐阶段完成测试、实现、验证和绿色提交；禁止提交故意失败的中间状态。

**目标：**在不修改 `ContentDocument` 保存协议、不新增浏览器权限的前提下，完成 Side Panel V2，并让 X Article 的内容结构能够保守、准确地定位原文。

**架构：**Content Script 从真实 X Article DOM 生成独立的 `AnalysisSourceBlock[]`，与 `ContentDocument` 一同交给 Background。AI 只能引用实际输入的 Block；Content Script 导航时重新生成同一套 Block，使用 `sourceBlockId + sourceQuote` 双重校验，任何歧义均拒绝跳转。

**技术栈：**Chrome MV3、TypeScript、原生 DOM、Vitest、esbuild；不引入 React、Vue、Schema 库或运行时依赖。

---

## 一、锁定的数据协议与行为

### 1. VisualSummary V2

在 `src/analysis/types.ts` 中替换 V1 结果协议：

```ts
export interface AnalysisSourceBlock {
  id: string;
  kind: 'heading' | 'paragraph' | 'list-item' | 'quote' | 'code' | 'table';
  text: string;
}

export type VisualStructureItem =
  | {
      title: string;
      sourceBlockId: string;
      sourceQuote: string;
    }
  | {
      title: string;
      sourceBlockId?: never;
      sourceQuote?: never;
    };

export interface VisualSummary {
  schemaVersion: 2;
  summary: [string, string];
  keyPoints: VisualKeyPoint[];
  structure: VisualStructureItem[];
}

export interface VisualAnalysisSource {
  url: string;
  title: string;
  author: {
    name: string;
    handle?: string;
  };
  platform: PlatformId;
  contentType: PlatformContentType;
}
```

约束固定为：

- `summary` 恰好两条，每条非空且不超过 90 字。
- `keyPoints` 为 2～5 条，沿用现有 title 20 字、description 80 字限制。
- `structure` 为 1～10 条，title 非空且不超过 40 字。
- `sourceBlockId` 符合 `^B\d{3,}$`。
- `sourceQuote` 非空且不超过 140 字。
- X Article 的每个 Structure Item 必须同时拥有 ID 和 Quote。
- Tweet 的 Structure Item 必须同时缺少 ID 和 Quote。
- 删除 `articleType`、`classificationReason`、`confidence`、`takeaways`。

Tweet 的 UI 标题从正文纯文本前 50 个 Unicode 字符生成；为空时使用"当前推文"。这只写入 `VisualAnalysisSource.title`，不修改 Markdown 标题规则。

### 2. 新消息协议

在 `src/types/messages.ts` 增加：

```ts
export type ExtractVisualSourceRequest = {
  type: 'EXTRACT_VISUAL_SOURCE';
};

export type ExtractVisualSourceResponse =
  | {
      success: true;
      document: ContentDocument;
      sourceBlocks: AnalysisSourceBlock[];
    }
  | {
      success: false;
      error: { code: string; message: string };
    };

export type NavigateToSourceRequest = {
  type: 'NAVIGATE_TO_SOURCE';
  payload: {
    expectedSourceUrl: string;
    sourceBlockId: string;
    sourceQuote: string;
  };
};

export type NavigationErrorCode =
  | 'SOURCE_CHANGED'
  | 'UNSUPPORTED_PAGE'
  | 'TARGET_NOT_FOUND'
  | 'AMBIGUOUS_TARGET'
  | 'INVALID_REQUEST';

export type NavigateToSourceResponse =
  | { success: true }
  | {
      success: false;
      error: {
        code: NavigationErrorCode;
        message: string;
      };
    };
```

为两个请求增加严格类型守卫；校验 URL、ID 格式、Quote 类型及长度。Side Panel 发送失败或 Content Script 不存在时，在发送端映射为 `CONTENT_SCRIPT_UNAVAILABLE`。

### 3. DOM Source Block 规则

新建：

- `src/adapters/x/article-source.ts`
- `src/analysis/source-blocks.ts`

规则锁定为：

1. 复用当前 `findArticleContainer()`，并导出共享的正文容器解析函数；提取器和导航器不能各自猜正文根节点。
2. 搜索范围仅限焦点 Article 的 `[data-contents="true"]`。
3. 候选为 `h1-h6`、`p`、`li`、`blockquote`、`pre`、`table`、`[data-block="true"]`。
4. 候选互相嵌套时保留最深、最具体的文本元素，避免把整个正文容器作为一个 Block。
5. 文本统一执行 NFKC、NBSP 替换、零宽字符删除、连续空白合并和 trim。
6. 空文本、纯装饰文本、图片和合成媒体替代文案不生成 Block。
7. 单个候选超过 2,000 个 Unicode 字符时，优先在句号、问号、感叹号或换行处分段；找不到边界时在 2,000 字处切分。每段仍指向同一个 DOM 元素。
8. 按 DOM 顺序分配 `B001`、`B002`……；算法在分析和导航时完全复用。
9. Source Block 不写入 `ContentDocument`，不写入网页属性，也不持久修改 X DOM。

### 4. 导航匹配规则

新建 `src/adapters/x/navigation.ts`：

1. 从当前 URL 与 `expectedSourceUrl` 提取 `/status/{id}`；ID 不同立即返回 `SOURCE_CHANGED`。`x.com` 与 `twitter.com` 的同一 status ID 视为同一来源。
2. 重新生成当前页面的 Source Blocks。
3. 首先按 `sourceBlockId` 找 Block，并验证规范化后的 Block 文本包含规范化 Quote。
4. ID 校验失败时，才在全部 Block 中执行完整 Quote 匹配。
5. 唯一候选才允许跳转；0 个返回 `TARGET_NOT_FOUND`，多个返回 `AMBIGUOUS_TARGET`。
6. 不忽略标点、不做相似度搜索、不使用非唯一短片段 fallback。
7. 成功后执行 `scrollIntoView({block: 'center'})`；普通模式使用 `smooth`，reduced-motion 使用 `auto`。
8. 高亮持续 1,800ms。新请求先取消旧定时器并清理旧目标；结束后同时移除 class 和注入的 style，避免永久污染 DOM。
9. Content Script 返回响应后，Side Panel 通过 `aria-live="polite"` 显示成功或稳定错误信息。

---

## 二、分阶段实施

### Phase 0：安全基线与设计输入

- [x] 从当前 `codex/clip2md-v1-visual-overview` 的 `d2d194d` 创建 `codex/visual-summary-v2-navigation`；若执行时 HEAD 已变化，只记录现状，不 reset、restore 或覆盖工作区。
- [ ] 用户提供原计划引用的设计图，原样保存到 `docs/design/visual-summary-v2-reference.png`。
- [ ] 运行 `npm test`、`npm run typecheck`、`npm run build`，确认基线为绿色。
- [x] 将本计划保存到 `docs/superpowers/plans/2026-08-26-visual-summary-v2-navigation.md`。
- [ ] 提交：`docs: add visual summary v2 navigation plan`

设计图尚未提供，因此 UI Phase 在该资产到位前不得开始；数据与导航测试可以先进行。

### Phase 1：DOM Source Snapshot

涉及：

- `src/adapters/x/article-source.ts`
- `src/adapters/x/extractor.ts`
- `src/adapters/x/selectors.ts`
- `src/content/content-script.ts`

- [ ] 先在现有 Article fixture 上写失败测试：正确正文根、嵌套重复正文排除、span 拆分、重复段落、长段落分片和稳定 B 编号。
- [ ] 增加 `EXTRACT_VISUAL_SOURCE` 路由：一次读取中返回 `ContentDocument + sourceBlocks`。
- [ ] X Article 返回 DOM Blocks；Tweet 返回原 ContentDocument 和空 Blocks。
- [ ] 保留原 `EXTRACT` 路径，确保普通保存、Obsidian 和其他平台不受影响。
- [ ] 运行 `npm test -- tests/adapters/x.test.ts tests/content-script.test.ts tests/x-article-source.test.ts`。
- [ ] 提交：`feat(x): add deterministic article source snapshot`

### Phase 2：Analysis V2、截断与修复链

涉及：

- `src/analysis/types.ts`
- `src/analysis/input.ts`
- `src/analysis/schema.ts`
- `src/analysis/client.ts`
- `src/analysis/prompt.ts`

- [ ] 先写 V2 Schema、两句摘要、Anchor 成对规则和 Article/Tweet 上下文测试。
- [ ] Article AI 正文格式改为 `[Bxxx]\n文本`；Tweet 继续使用现有纯正文格式。
- [ ] Article 截断按完整 Source Block 处理：头部预算 12,000 字符、尾部预算 4,000 字符；保留原 ID，中间插入无 ID 的省略提示，禁止重编号。
- [ ] `AnalysisInput.sourceBlocks` 只保留实际发送给 AI 的 Block，语义校验不得接受被截断掉的 ID。
- [ ] Prompt 强制 V2 JSON，并明确 Tweet 不生成 Anchor。
- [ ] `parseVisualSummary()` 只做结构校验；随后运行 `validateVisualSummaryAnchors(summary, input)`：
  - ID 必须存在；
  - Quote 必须属于该 Block；
  - Quote 在本次输入 Blocks 中必须唯一；
  - Article 全部有 Anchor，Tweet 全部无 Anchor。
- [ ] repair 请求必须携带具体错误列表和上次输出；仍只允许一次 repair，第二次失败返回 `AI_INVALID_RESPONSE`。
- [ ] 运行 `npm test -- tests/analysis-input.test.ts tests/analysis-schema.test.ts tests/ai-client.test.ts`。
- [ ] 提交：`feat(analysis): add source-linked visual summary v2`

### Phase 3：缓存和 Background 编排

涉及：

- `src/analysis/cache.ts`
- `src/background/visual-summary.ts`

- [ ] 缓存前缀改为 `clip2md.visualSummary.v2.cache.`。
- [ ] Cache Key 覆盖 schema version、source URL、实际 AI body、model 和 endpoint；禁止包含 API Key。
- [ ] 缓存读取后重新执行 V2 结构校验，不能继续直接类型断言。
- [ ] Background 改用 `EXTRACT_VISUAL_SOURCE`，并把结构化作者、平台、类型和 Tweet UI 标题写入 `VisualAnalysisSource`。
- [ ] 读取到非 V2 done state 时不渲染旧结果，显示"结果版本已更新，请重新生成"。
- [ ] 保留现有 requestId 守卫；旧请求不得覆盖新请求或新页面状态。
- [ ] 运行 `npm test -- tests/visual-summary.test.ts tests/background.test.ts`。
- [ ] 提交：`feat(background): orchestrate visual summary v2`

### Phase 4：Navigation Engine 与消息接线

涉及：

- `src/adapters/x/navigation.ts`
- `src/types/messages.ts`
- `src/content/content-script.ts`

- [ ] 先写失败测试：正确 ID、ID 漂移但 Quote 唯一、0 候选、重复候选、SPA status 变化、分 span、连续高亮和 reduced-motion。
- [ ] 实现 `NAVIGATE_TO_SOURCE` 类型守卫及 Content Script 路由。
- [ ] 复用 Phase 1 的 Source Block 收集器，不新增第二套选择器算法。
- [ ] 所有异常转换为稳定响应，Content Script listener 不抛出未处理错误。
- [ ] 运行 `npm test -- tests/x-navigation.test.ts tests/content-script.test.ts`。
- [ ] 提交：`feat(x): add conservative article source navigation`

### Phase 5：Side Panel V2

涉及：

- `src/sidepanel/sidepanel.html`
- `src/sidepanel/sidepanel.css`
- `src/sidepanel/sidepanel.ts`
- `src/sidepanel/structure-renderer.ts`

固定信息顺序：

```text
品牌栏与设置
文章标题、作者、@handle、平台
两句话看懂
核心观点
内容结构
查看原文 / 重新生成 / 保存 Markdown
```

- [ ] 删除地图文案、orbit、confidence、article type、takeaways、旧 Tree 和底部快捷键区。
- [ ] 有 Anchor 的 Structure Item 使用 `<button type="button">`；Tweet 的无 Anchor Item 使用静态 `<span>`，不得伪装可点击。
- [ ] Structure 点击直接调用 `chrome.tabs.sendMessage()`，兼容 callback 的 `runtime.lastError` 与 Promise rejection。[Chrome 消息规范](https://developer.chrome.com/docs/extensions/develop/concepts/messaging)
- [ ] "查看原文"使用 `chrome.tabs.create({url: source.url, active: true})` 新开 canonical URL，不替换当前标签页。
- [ ] 设置齿轮调用 `chrome.runtime.openOptionsPage()`。
- [ ] 导航和保存分别使用独立的 `aria-live` 状态区域。
- [ ] 所有 AI 与 Quote 内容继续通过 `textContent` 渲染。
- [ ] 保留 Light/Dark Mode；280～420px 单列，600px 两列，无横向滚动。
- [ ] 在 320px、420px、600px 使用固定示例数据截图，与设计图逐项核对品牌栏、字号、颜色、留白、分割线、按钮和信息顺序；未经用户确认不得标记 UI Phase 完成。
- [ ] 新 Renderer 测试通过后删除旧 `tree-renderer.ts`。
- [ ] 运行 `npm test -- tests/sidepanel.test.ts`。
- [ ] 提交：`feat(sidepanel): redesign visual summary reading view`

Side Panel 是扩展页面，可直接使用 Chrome API；现有 Manifest 权限足够，不修改 `manifest.json`。[Chrome Side Panel](https://developer.chrome.com/docs/extensions/reference/api/sidePanel) [Chrome Tabs](https://developer.chrome.com/docs/extensions/reference/api/tabs)

### Phase 6：回归、真实 Chrome 验收与文档

- [ ] 运行完整门禁：

```powershell
npm test
npm run typecheck
npm run build
git diff --check
```

- [ ] 确认现有 X Article fixture 的 Markdown 输出逐字不变。
- [ ] 回归普通保存、快捷键保存、自定义目录、Obsidian、Tweet、知乎、小黑盒、ChatGPT 和 Bilibili。
- [ ] 在至少 5 篇真实 X Article 上记录至少 40 个已人工标注章节：
  - 错误跳转必须为 0；
  - 正确定位率至少 95%；
  - 剩余最多 5% 只能是明确的保守失败；
  - 不允许把"未跳转"统计成成功。
- [ ] 覆盖有标题、无标题、长文章、重复文本、跨 span、列表、文章末段和 SPA A→B 场景。
- [ ] 连续点击不同章节，确认旧定时器不会清除新高亮。
- [ ] reduced-motion 下无平滑滚动，但仍保留无动画的短暂静态高亮。
- [ ] 更新 `README.md` 和 `privacy/index.md`，说明短原文 Quote 只用于当前会话定位。
- [ ] 在 `docs/reports/2026-08-26-visual-summary-v2-navigation-report.md` 记录自动测试、40 项定位矩阵、UI 截图和真实 Chrome 结果。
- [ ] 提交：`test(visual-summary): cover v2 navigation regressions`
- [ ] 提交：`docs: document source-linked visual summaries`

---

## 三、完成标准

只有以下全部满足才可标记 DONE：

- Side Panel 与设计图在规定宽度下通过人工视觉确认。
- 标题、结构化作者、handle、平台、两句摘要、核心观点和内容结构显示正确。
- X Article 每个 Structure Item 都经过 Schema 与语义 Anchor 校验。
- ID 漂移时只有唯一 Quote 候选才能 fallback。
- 重复或模糊内容绝不跳转。
- SPA 页面变化得到 `SOURCE_CHANGED`。
- 高亮居中、1.8 秒清理、连续点击无竞态、DOM 无残留。
- Tweet 可生成 V2 速览，但 Structure 不伪装可导航。
- V1 Cache 不再读取，force 重新生成正确绕过 V2 Cache。
- Markdown、Obsidian 和其他平台保存结果不变。
- 完整测试、类型检查、构建和 `git diff --check` 全部通过。
- 真实 Chrome 40 项定位：错误跳转为 0，正确率不低于 95%。

## 四、明确边界与默认值

- 只实现 X Article 原文定位；Tweet 只保留分析。
- 不修改 `ContentDocument`、Markdown Renderer 或保存协议。
- 不新增权限、远程脚本、框架、后端、账号、云同步、RAG 或其他平台导航。
- `storage.session` 仍作为会话状态与缓存；Chrome 会在扩展更新、重载或浏览器重启时清除它，V2 前缀作为额外隔离。[Chrome Storage](https://developer.chrome.com/docs/extensions/reference/api/storage)
- 每个正式 Git 提交必须是绿色提交；TDD 的失败测试只存在于本地开发步骤中，不形成可见的红色提交。
- 当前请求仅生成计划，不修改仓库；设计图是开始 UI Phase 前唯一仍需提供的外部资产。
