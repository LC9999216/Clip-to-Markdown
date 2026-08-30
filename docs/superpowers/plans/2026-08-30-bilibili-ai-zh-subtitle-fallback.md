# Clip2MD B站简体中文 AI 翻译兜底 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 当 B 站官方字幕列表没有中文、但存在英文轨时，在用户明确开启功能后，通过其已配置的 OpenAI-Compatible 服务把英文字幕按原时间码翻译为简体中文，并默认显示“简体中文（AI 翻译）”。

**Architecture:** 官方字幕服务仍是唯一字幕来源，优先级仍为人工中文、AI 中文、其他人工、其他 AI。字幕页只在“没有官方中文 + 存在英文源轨”时请求 Background 翻译；Background 独占 API Key、校验用户开关和运行时主机权限、分批调用 AI，并返回严格校验的等长字幕行。翻译结果仅缓存在 `chrome.storage.session`，不下载视频、不做 ASR、不向 AI 发送音频、视频 URL、BV 号、标题或作者。

**Tech Stack:** TypeScript、Chrome Manifest V3 Side Panel / Service Worker、OpenAI-Compatible Chat Completions、原生 DOM、`chrome.storage.local`、`chrome.storage.session`、Vitest/jsdom、esbuild。

---

## 一、已确认事实与根因

目标验收视频：

- URL：`https://www.bilibili.com/video/BV1Yku16CEzX/`
- 页面标题：`AI Agent 的正确打开方式:Skill、插件、模板库到底怎么玩？`
- 登录态下真实轨道：`English (AI)`、`日本語 (AI)`
- 不存在官方简体中文轨；画面中的中文字属于烧录字幕，不能由官方字幕 API 读取。

因此，修复 `ai-zh` 识别或调整轨道排序无法让该视频出现中文。必须新增“英文字幕文本 → 简体中文文本”的受控 AI 翻译兜底。

## 二、范围、非目标与安全约束

### 必须实现

1. 官方中文存在时，绝不请求 AI，继续默认选择官方中文。
2. 官方中文不存在、英文轨存在、用户已开启翻译时，默认显示“简体中文（AI 翻译）”。
3. 翻译逐行对应，严格保留每行 `from`、`to` 和顺序，不允许 AI 改时间码、合并行或增删行。
4. 用户可在下拉框切回原始 `English (AI)` / `日本語 (AI)`；手动选择要在当前会话恢复。
5. 同一浏览器会话内复用翻译缓存；点击刷新绕过官方字幕缓存和翻译缓存，重新获取并重新翻译。
6. AI 未配置、未授权、超时、限流、返回格式错误时显示可操作的中文提示，保留原始官方轨可读。
7. 设置页明确披露：字幕文本会发送给用户配置的 AI 服务，可能产生费用。

### 明确不实现

- 不下载视频或音频。
- 不做本地或云端 ASR。
- 不 OCR 画面烧录字幕。
- 不把日语作为自动翻译源；V1 只使用英文轨。
- 不提供双语对照、搜索、复制、导出或顺句。
- 不持久保存翻译正文到 `storage.local`。
- 不新增第三方 SDK、服务器或静态主机权限。
- 不修改 B 站 WBI、播放跳转、时间跟随、Markdown 提取和一图速览的既有行为。

### 隐私与费用语义

- 新开关默认 `false`。升级后不能因为用户曾启用“一图速览”就自动外发字幕。
- 只有 `ai.enabled === true` 且 `ai.translateBilibiliSubtitles === true` 才允许 Background 发出翻译请求。
- 发送给 AI 的内容只包含批次内的行 ID 和英文文本；时间码、BV 号、页面 URL、标题、作者不进入提示词。
- API Key 仍只由 Background 读取，不能进入字幕页 DOM、runtime message 响应、日志或缓存。

## 三、文件结构与职责

### 新增

- `src/analysis/subtitle-translation.ts`：翻译分批、提示词、严格 JSON 校验、一次修复和时间码回填。
- `tests/subtitle-translation.test.ts`：翻译纯逻辑、批次边界、格式校验和时间码保持测试。

### 修改

- `src/core/ai-settings.ts`：新增显式翻译开关。
- `src/core/settings.ts`：设置版本升至 V4，并迁移 V0/V2/V3。
- `src/options/options.html`：增加翻译开关和数据外发/费用说明。
- `src/options/options.ts`：加载、编辑、保存翻译开关。
- `src/analysis/client.ts`：为翻译模块暴露受控文本 completion；复用现有超时和错误映射。
- `src/types/messages.ts`：新增翻译请求、响应、错误码和严格类型守卫。
- `src/background/background.ts`：新增受信任扩展页翻译 handler；检查设置和主机权限。
- `src/subtitle/subtitle.ts`：虚拟简中轨、自动翻译、会话缓存、手动轨恢复和错误回退。
- `src/subtitle/subtitle.html`：不增加新主控件；复用 `#subtitle-status` 与设置按钮。
- `src/subtitle/subtitle.css`：仅在确有需要时增加错误/提示状态颜色；不重排页面。
- `tests/core/settings.test.ts`、`tests/options.test.ts`、`tests/ai-client.test.ts`、`tests/background.test.ts`、`tests/subtitle-page.test.ts`、`tests/visual-summary.test.ts`：回归覆盖。
- `README.md`：更新“仅官方字幕/不翻译”的旧说明，记录可选 AI 兜底和隐私边界。
- `docs/progress/2026-08-30-bilibili-ai-zh-subtitle-fallback.md`：执行完成后由实施 Agent 写实际结果、命令和未验证项。

## 四、固定接口与命名

所有任务必须使用以下名称，避免 Agent 间接口漂移：

```ts
// src/core/ai-settings.ts
interface AiSettings {
  enabled: boolean;
  endpoint: string;
  apiKey: string;
  model: string;
  outputLanguage: 'zh-CN';
  translateBilibiliSubtitles: boolean;
}

// src/types/messages.ts
type TranslateBilibiliSubtitlesRequest = {
  type: 'TRANSLATE_BILIBILI_SUBTITLES';
  payload: {
    sourceTrackId: string;
    lines: BiliSubtitleLine[];
  };
};

type SubtitleTranslationErrorCode =
  | 'AI_TRANSLATION_DISABLED'
  | 'AI_NOT_CONFIGURED'
  | 'AI_HOST_NOT_GRANTED'
  | 'AI_AUTH_FAILED'
  | 'AI_ENDPOINT_OR_MODEL_NOT_FOUND'
  | 'AI_RATE_LIMITED'
  | 'AI_PROVIDER_ERROR'
  | 'AI_TIMEOUT'
  | 'AI_NETWORK_ERROR'
  | 'AI_INVALID_RESPONSE';

type TranslateBilibiliSubtitlesResponse =
  | { success: true; lines: BiliSubtitleLine[] }
  | { success: false; code: SubtitleTranslationErrorCode; error: string };
```

虚拟轨道 ID 固定为：

```ts
const TRANSLATED_TRACK_PREFIX = 'clip2md-ai-zh:';
const translatedTrackId = (sourceTrackId: string): string =>
  `${TRANSLATED_TRACK_PREFIX}${sourceTrackId}`;
```

会话键固定为：

```text
clip2md.bilibiliSubtitle.ui.v2.<BV>:p<P>
clip2md.bilibiliSubtitle.translation.v1.<BV>:p<P>:<sourceTrackId>
```

`ui.v2` 是有意升级：旧 `ui.v1` 会把此前自动选中的英文误当作用户偏好，必须忽略。V2 只持久化用户主动切换的轨道，不持久化自动选择。

---

### Task 0：接管现有工作树并建立可回退基线

**Files:**
- Verify: `src/adapters/bilibili/subtitle-service.ts`
- Verify: `tests/adapters/bilibili-subtitle-service.test.ts`
- Verify: `tests/adapters/bilibili.test.ts`
- Verify: `tests/subtitle-page.test.ts`
- Verify: `docs/superpowers/plans/2026-08-30-bilibili-ai-zh-subtitle-fallback.md`

- [ ] **Step 1: 在正确工作树确认分支和路径**

Run:

```powershell
git rev-parse --show-toplevel
git branch --show-current
git status --short
```

Expected:

```text
C:/Users/HP/OneDrive/桌面/example/clip2md/.worktrees/bilibili-subtitle-sidepanel
codex/bilibili-subtitle-sidepanel
```

状态中允许且预期存在此前尚未提交的四个修复文件，以及本计划文件。不得执行 `git reset --hard`、`git checkout --`、`git clean` 或 stash 覆盖它们。

- [ ] **Step 2: 审阅既有差异，确认只包含 WBI 嵌套字段和 `ai-zh` 识别修复**

Run:

```powershell
git diff -- src/adapters/bilibili/subtitle-service.ts tests/adapters/bilibili-subtitle-service.test.ts tests/adapters/bilibili.test.ts tests/subtitle-page.test.ts
```

Expected: 生产差异只读取 `navData.wbi_img.img_url/sub_url`，并让 `ai-zh` 被识别为中文；测试差异只同步 fixture 和回归用例。

- [ ] **Step 3: 运行基线门禁**

Run:

```powershell
npm test
npm run typecheck
npm run build
git diff --check
```

Expected: 当前基线 37 个测试文件、529 个测试全部通过；typecheck/build 退出码 0；`git diff --check` 无 whitespace error。若测试数量因并行工作变化，以“零失败”为准并记录实际数量。

- [ ] **Step 4: 记录执行前快照**

Run:

```powershell
git rev-parse HEAD
git status --short
```

Expected: HEAD 为 `b1968f1` 或用户已明确接受的后续 checkpoint；把实际 HEAD 和 dirty 文件列表写入最终进度报告，不把现有修改归为本功能新改动。

### Task 1：设置 V4 与显式翻译开关

**Files:**
- Modify: `src/core/ai-settings.ts`
- Modify: `src/core/settings.ts`
- Modify: `src/options/options.html`
- Modify: `src/options/options.ts`
- Test: `tests/core/settings.test.ts`
- Test: `tests/options.test.ts`

- [ ] **Step 1: 先写 V3 → V4 迁移失败测试**

在 `tests/core/settings.test.ts` 增加：

```ts
it('V3 迁移到 V4 时字幕翻译默认关闭且其他 AI 字段无损', () => {
  const migrated = migrateSettings({
    settingsVersion: 3,
    ai: {
      enabled: true,
      endpoint: 'https://api.deepseek.com/chat/completions',
      apiKey: 'sk-test',
      model: 'deepseek-chat',
      outputLanguage: 'zh-CN',
    },
  });

  expect(migrated.settingsVersion).toBe(4);
  expect(migrated.ai).toMatchObject({
    enabled: true,
    endpoint: 'https://api.deepseek.com/chat/completions',
    apiKey: 'sk-test',
    model: 'deepseek-chat',
    outputLanguage: 'zh-CN',
    translateBilibiliSubtitles: false,
  });
});

it('V4 保存并读取字幕翻译开关', async () => {
  await saveSettings({
    ...DEFAULT_SETTINGS,
    ai: { ...DEFAULT_SETTINGS.ai, translateBilibiliSubtitles: true },
  });
  expect((await loadSettings()).ai.translateBilibiliSubtitles).toBe(true);
});
```

- [ ] **Step 2: 写 Options 结构与保存失败测试**

在 `tests/options.test.ts` 的必需 ID 列表加入 `ai-bilibili-subtitle-translation`，并新增：

```ts
it('明确告知字幕会外发且保存用户的自动翻译选择', async () => {
  mockStoredSettings['clip2md.settings'] = {
    settingsVersion: 4,
    ai: {
      enabled: true,
      endpoint: 'https://api.deepseek.com/chat/completions',
      apiKey: 'sk-test',
      model: 'deepseek-chat',
      outputLanguage: 'zh-CN',
      translateBilibiliSubtitles: false,
    },
  };
  await bootOptions();

  const input = document.getElementById('ai-bilibili-subtitle-translation') as HTMLInputElement;
  expect(input.checked).toBe(false);
  expect(input.closest('label')?.textContent).toContain('B站无简中轨时自动翻译');
  expect(document.getElementById('ai-settings')?.textContent).toContain('可能产生费用');

  input.checked = true;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  (document.getElementById('save-btn') as HTMLButtonElement).click();

  await vi.waitFor(() => {
    const saved = mockStoredSettings['clip2md.settings'] as { ai: { translateBilibiliSubtitles: boolean } };
    expect(saved.ai.translateBilibiliSubtitles).toBe(true);
  });
});
```

- [ ] **Step 3: 运行红灯测试**

Run:

```powershell
npm test -- tests/core/settings.test.ts tests/options.test.ts
```

Expected: FAIL，原因是设置版本仍为 3、AI 设置缺少字段、Options 控件不存在。

- [ ] **Step 4: 最小实现设置字段和迁移**

在 `AiSettings` 与默认值中加入：

```ts
/** B站没有官方中文轨时，是否允许把英文字幕发送到 AI 服务翻译 */
translateBilibiliSubtitles: boolean;
```

```ts
translateBilibiliSubtitles: false,
```

在 `src/core/settings.ts`：

```ts
export const SETTINGS_VERSION = 4 as const;
```

`normalizeAiSettings` 必须使用严格布尔值，不接受字符串真值：

```ts
translateBilibiliSubtitles: typeof value.translateBilibiliSubtitles === 'boolean'
  ? value.translateBilibiliSubtitles
  : false,
```

- [ ] **Step 5: 最小实现 Options 控件**

在 AI 卡片、模型字段之后加入：

```html
<label class="checkbox">
  <input
    id="ai-bilibili-subtitle-translation"
    name="ai-bilibili-subtitle-translation"
    type="checkbox"
  />
  <span>B站无简中轨时自动翻译为简体中文</span>
</label>
<p class="hint">
开启后，英文字幕文本会发送到上方配置的 AI 服务，可能产生费用；不会发送音频或视频。
</p>
```

在 `options.ts` 绑定：

```ts
const aiBilibiliSubtitleTranslationInput = document.getElementById(
  'ai-bilibili-subtitle-translation',
) as HTMLInputElement;
```

`readFormSettings().ai` 加入：

```ts
translateBilibiliSubtitles: aiBilibiliSubtitleTranslationInput.checked,
```

`init()` 加入：

```ts
aiBilibiliSubtitleTranslationInput.checked = currentSettings.ai.translateBilibiliSubtitles;
```

同时把原 `启用一图速览` 标签改为 `启用 AI 功能（一图速览与字幕翻译）`；不改字段 ID `ai-enabled`，避免现有控制器和测试失效。翻译子开关不能绕过总开关。

- [ ] **Step 6: 运行绿灯与回归**

Run:

```powershell
npm test -- tests/core/settings.test.ts tests/options.test.ts
npm run typecheck
```

Expected: 两个测试文件全部通过，typecheck 退出码 0。

- [ ] **Step 7: 建立阶段 checkpoint**

```powershell
git add src/core/ai-settings.ts src/core/settings.ts src/options/options.html src/options/options.ts tests/core/settings.test.ts tests/options.test.ts
git commit -m "feat(settings): add Bilibili subtitle translation consent"
```

只提交本 Task 路径；不得把 Task 0 的既有 dirty 文件顺带提交。

### Task 2：实现严格、可分批的字幕翻译模块

**Files:**
- Create: `src/analysis/subtitle-translation.ts`
- Modify: `src/analysis/client.ts`
- Create: `tests/subtitle-translation.test.ts`
- Modify: `tests/ai-client.test.ts`

- [ ] **Step 1: 写时间码与 ID 对齐失败测试**

`tests/subtitle-translation.test.ts` 至少包含：

```ts
const SOURCE = [
  { from: 0, to: 2.5, content: 'Have you noticed it?' },
  { from: 2.5, to: 5, content: 'The methods make the difference.' },
];

it('按 ID 回填简中并逐行保留时间码和顺序', async () => {
  const complete = vi.fn().mockResolvedValue(JSON.stringify({
    translations: [
      { id: 'L0001', text: '你有没有注意到？' },
      { id: 'L0002', text: '真正拉开差距的是方法。' },
    ],
  }));

  const result = await translateBilibiliSubtitleLines(SOURCE, SETTINGS, complete);

  expect(result).toEqual([
    { from: 0, to: 2.5, content: '你有没有注意到？' },
    { from: 2.5, to: 5, content: '真正拉开差距的是方法。' },
  ]);
  expect(complete).toHaveBeenCalledTimes(1);
  const sentMessages = complete.mock.calls[0]?.[1];
  expect(JSON.stringify(sentMessages)).not.toContain('BV1');
});
```

- [ ] **Step 2: 写严格校验与一次修复失败测试**

覆盖以下独立用例：

```ts
it.each([
  [{ translations: [{ id: 'L0001', text: '只有一行' }] }, '缺少 ID'],
  [{ translations: [{ id: 'L0001', text: '一' }, { id: 'L0001', text: '重复' }] }, '重复 ID'],
  [{ translations: [{ id: 'L9999', text: '越界' }, { id: 'L0002', text: '二' }] }, '未知 ID'],
  [{ translations: [{ id: 'L0001', text: '' }, { id: 'L0002', text: '二' }] }, '空文本'],
])('非法响应 %s 触发一次修复，第二次仍非法则失败', async (body) => {
  const complete = vi.fn().mockResolvedValue(JSON.stringify(body));
  await expect(translateBilibiliSubtitleLines(SOURCE, SETTINGS, complete))
    .rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' });
  expect(complete).toHaveBeenCalledTimes(2);
});
```

再覆盖：合法修复成功；Markdown 围栏可有限清除；超过 60 行或 6000 字符会分批且批次顺序稳定；空输入直接返回 `[]` 且不调用 AI。

- [ ] **Step 3: 运行红灯测试**

Run:

```powershell
npm test -- tests/subtitle-translation.test.ts
```

Expected: FAIL，原因是翻译模块不存在。

- [ ] **Step 4: 在 AI client 暴露受控 completion**

不要复制 HTTP 请求实现。把现有消息类型改为导出，并增加窄接口：

```ts
export interface AiChatMessage {
  role: 'system' | 'user';
  content: string;
}

export interface TextCompletionOptions {
  structuredOutput?: boolean;
  temperature?: number;
  maxTokens?: number;
}

export async function completeText(
  settings: AiSettings,
  messages: AiChatMessage[],
  options: TextCompletionOptions = {},
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  try {
    return await requestCompletion(settings, messages, controller.signal, options);
  } finally {
    clearTimeout(timer);
  }
}
```

`requestCompletion` 请求体使用：

```ts
temperature: options.temperature ?? 0.2,
max_tokens: options.maxTokens ?? (useDeepSeekJsonMode ? 4096 : 1400),
```

现有 `analyzeContent` / `analyzeContentV2` 行为和测试快照必须保持不变。

- [ ] **Step 5: 实现翻译模块**

固定边界：

```ts
export const MAX_TRANSLATION_BATCH_LINES = 60;
export const MAX_TRANSLATION_BATCH_CHARS = 6000;
```

提示词必须明确：只翻译、简体中文、自然口语、保留专有名词、不得增删 ID、只返回 JSON。请求 JSON 只含：

```json
{"lines":[{"id":"L0001","text":"Have you noticed it?"}]}
```

模型响应只接受：

```json
{"translations":[{"id":"L0001","text":"你有没有注意到？"}]}
```

入口签名固定：

```ts
export type SubtitleCompletion = (
  settings: AiSettings,
  messages: AiChatMessage[],
  options: TextCompletionOptions,
) => Promise<string>;

export async function translateBilibiliSubtitleLines(
  lines: BiliSubtitleLine[],
  settings: AiSettings,
  complete: SubtitleCompletion = completeText,
): Promise<BiliSubtitleLine[]>;
```

每个批次第一次解析/校验失败时，用同一源批次加“上次输出不合法”的 system 提示修复一次；第二次失败抛 `VisualAnalysisRequestError('AI_INVALID_RESPONSE', 'AI 返回的字幕翻译格式无效，请重试。')`。不得把完整非法响应写入错误消息。

- [ ] **Step 6: 运行模块和 AI client 回归**

Run:

```powershell
npm test -- tests/subtitle-translation.test.ts tests/ai-client.test.ts
npm run typecheck
```

Expected: 全部通过；原分析请求仍保持温度、token 上限、DeepSeek JSON mode、超时和错误映射。

- [ ] **Step 7: 建立阶段 checkpoint**

```powershell
git add src/analysis/client.ts src/analysis/subtitle-translation.ts tests/ai-client.test.ts tests/subtitle-translation.test.ts
git commit -m "feat(ai): add validated subtitle translation pipeline"
```

### Task 3：增加安全的 Background 翻译消息

**Files:**
- Modify: `src/types/messages.ts`
- Modify: `src/background/background.ts`
- Modify: `tests/background.test.ts`

- [ ] **Step 1: 写消息守卫失败测试**

在 `tests/background.test.ts` 增加：

```ts
const TRANSLATE = {
  type: 'TRANSLATE_BILIBILI_SUBTITLES',
  payload: {
    sourceTrackId: 'ai-en',
    lines: [{ from: 0, to: 2, content: 'Hello' }],
  },
};

it.each([
  { sourceTrackId: '', lines: [{ from: 0, to: 2, content: 'Hello' }] },
  { sourceTrackId: 'ai-en', lines: [] },
  { sourceTrackId: 'ai-en', lines: [{ from: -1, to: 2, content: 'Hello' }] },
  { sourceTrackId: 'ai-en', lines: [{ from: 0, to: 2, content: '' }] },
])('拒绝非法字幕翻译载荷 %#', (payload) => {
  expect(isTranslateBilibiliSubtitlesRequest({
    type: 'TRANSLATE_BILIBILI_SUBTITLES',
    payload,
  })).toBe(false);
});
```

守卫上限固定为：最多 5000 行、单行最多 2000 Unicode 字符、总文本最多 400000 Unicode 字符、时间 `0 <= from <= to <= 86400`、`sourceTrackId` 1–128 字符。

- [ ] **Step 2: 写 Background 授权矩阵失败测试**

必须分别断言：

1. 非扩展 sender 被拒绝，且 `fetch` 未调用。
2. `translateBilibiliSubtitles=false` 返回 `AI_TRANSLATION_DISABLED`，且 `fetch` 未调用。
3. AI 字段不完整返回 `AI_NOT_CONFIGURED`。
4. Endpoint host permission 未授予返回 `AI_HOST_NOT_GRANTED`。
5. 已开启、已配置、已授权时只调用一次 AI 并返回保留时间码的中文行。
6. 401/404/429/5xx/timeout/network/invalid response 映射到稳定错误码，不返回 provider 原始正文。

成功测试的设置 fixture 必须升级为 V4：

```ts
ai: {
  enabled: true,
  endpoint: 'https://api.deepseek.com/chat/completions',
  apiKey: 'sk-test',
  model: 'deepseek-chat',
  outputLanguage: 'zh-CN',
  translateBilibiliSubtitles: true,
}
```

- [ ] **Step 3: 运行红灯测试**

Run:

```powershell
npm test -- tests/background.test.ts
```

Expected: FAIL，原因是消息类型、守卫和 handler 不存在。

- [ ] **Step 4: 实现消息类型和严格守卫**

把请求加入 `RuntimeMessage`。守卫必须 `hasExactKeys` 校验请求和 payload，不接受额外字段；逐行只读取 `from/to/content`，不接收 URL、标题或身份字段。

- [ ] **Step 5: 实现 Background handler**

处理顺序固定：

```text
粗匹配 type
→ 正式 payload 守卫
→ sender 必须是 chrome-extension:// 当前扩展页
→ loadSettings()
→ enabled + translateBilibiliSubtitles
→ endpoint/apiKey/model 完整
→ getAiOriginPattern(endpoint)
→ chrome.permissions.contains({ origins: [pattern] })
→ translateBilibiliSubtitleLines(lines, settings.ai)
→ 返回 success/lines
```

此 handler 不能调用 `permissions.request`；权限申请只能由 Options 页用户手势触发。增加小函数：

```ts
function hasOriginPermission(pattern: string): Promise<boolean> {
  return new Promise((resolve) => {
    chrome.permissions.contains({ origins: [pattern] }, (granted) => {
      resolve(!chrome.runtime.lastError && granted === true);
    });
  });
}
```

只有当前扩展自身页面可发起翻译；不要复用允许网页 content script 的宽松 sender 判定。检查必须同时满足：

```ts
const url = new URL(sender.url ?? '');
const trusted = url.protocol === 'chrome-extension:' && url.hostname === chrome.runtime.id;
```

测试必须包含另一个扩展 ID `chrome-extension://evil-extension/subtitle.html`，预期拒绝且 AI `fetch` 为 0 次。

- [ ] **Step 6: 运行安全回归**

Run:

```powershell
npm test -- tests/background.test.ts tests/ai-client.test.ts tests/subtitle-translation.test.ts
npm run typecheck
```

Expected: 全部通过；非法 sender、关闭开关和缺权限用例的 `fetch` 调用数均为 0。

- [ ] **Step 7: 建立阶段 checkpoint**

```powershell
git add src/types/messages.ts src/background/background.ts tests/background.test.ts
git commit -m "feat(background): proxy opted-in subtitle translations"
```

### Task 4：在字幕页加入虚拟简中轨、自动选择和会话缓存

**Files:**
- Modify: `src/subtitle/subtitle.ts`
- Modify: `tests/subtitle-page.test.ts`
- Modify: `tests/setup.ts`（仅当现有 storage/message mock 不足）

- [ ] **Step 1: 写目标视频轨道形态的失败测试 fixture**

在 `tests/subtitle-page.test.ts` 增加只含英文和日语的 player fixture：

```ts
function makeEnglishJapanesePlayer() {
  return {
    code: 0,
    data: {
      subtitle: {
        subtitles: [
          { id_str: 'ai-en', lan: 'ai-en', lan_doc: 'English', subtitle_url: EN_URL, ai_status: 1 },
          { id_str: 'ai-jp', lan: 'ai-jp', lan_doc: '日本語', subtitle_url: JP_URL, ai_status: 1 },
        ],
      },
      view_points: [],
    },
  };
}
```

runtime mock 遇到 `TRANSLATE_BILIBILI_SUBTITLES` 时返回：

```ts
{
  success: true,
  lines: [{ from: 0, to: 4, content: '你有没有发现，现在大家使用 AI 的方式都差不多？' }],
}
```

- [ ] **Step 2: 写自动简中主路径失败测试**

```ts
it('无官方中文但有英文时默认显示简体中文 AI 翻译', async () => {
  respondGetStatus(BILIBILI_STATUS);
  respondEnglishJapaneseWithTranslation();

  dispose = await initializeSubtitlePage();

  await vi.waitFor(() => {
    expect((document.querySelector('#subtitle-track') as HTMLSelectElement).value)
      .toBe('clip2md-ai-zh:ai-en');
  });
  expect([...document.querySelectorAll('#subtitle-track option')].map((item) => item.textContent))
    .toEqual(['简体中文（AI 翻译）', 'English（AI）', '日本語（AI）']);
  expect(document.querySelector('#subtitle-list .subtitle-text')?.textContent)
    .toContain('你有没有发现');
  expect(runtimeSendMessageMock).toHaveBeenCalledWith({
    type: 'TRANSLATE_BILIBILI_SUBTITLES',
    payload: {
      sourceTrackId: 'ai-en',
      lines: [{ from: 0, to: 4, content: expect.any(String) }],
    },
  }, expect.any(Function));
});
```

- [ ] **Step 3: 写官方中文零调用和手动选择失败测试**

分别断言：

- 现有人工中文 fixture 不出现虚拟轨，且没有翻译消息。
- 自动翻译后手动选 `ai-en`，正文恢复英文，`ui.v2` 保存 `preferredTrackId: 'ai-en'`。
- 重新打开同一视频恢复手动英文，不自动翻译。
- 手动选择虚拟简中后恢复虚拟轨，并命中翻译缓存。
- `ui.v1` 中旧英文选择被忽略，不覆盖新的自动简中默认行为。

- [ ] **Step 4: 写缓存与刷新失败测试**

断言：

1. 同一会话第二次进入，翻译消息调用数不增加。
2. 缓存键为 `clip2md.bilibiliSubtitle.translation.v1.BV1xx411c7mD:p2:ai-en`。
3. 点击刷新后官方请求和翻译消息都各增加，缓存正文被新结果替换。
4. Tab/视频切换时，旧视频迟到的翻译响应被 generation + tabId 丢弃。

- [ ] **Step 5: 运行红灯测试**

Run:

```powershell
npm test -- tests/subtitle-page.test.ts -t "翻译|官方中文|缓存|刷新|旧英文"
```

Expected: FAIL，原因是虚拟轨和翻译流程不存在。

- [ ] **Step 6: 最小实现 UI 模型**

新增纯 helpers：

```ts
function isChineseTrack(track: BiliSubtitleTrack): boolean {
  return track.language.split('-').includes('zh')
    || track.label.includes('中文')
    || track.label.includes('汉语');
}

function isEnglishTrack(track: BiliSubtitleTrack): boolean {
  return track.language.split('-').includes('en')
    || /english/i.test(track.label);
}

function translationSource(resource: BiliSubtitleResource): BiliSubtitleTrack | undefined {
  if (resource.tracks.some(isChineseTrack)) return undefined;
  return resource.tracks.find(isEnglishTrack);
}
```

把 UI state 改为：

```ts
interface SubtitlePageUiState {
  preferredTrackId: string | null;
  scrollTop: number;
}
```

`UI_PREFIX` 升为 `clip2md.bilibiliSubtitle.ui.v2.`；只有 `select.onchange` 写 `preferredTrackId`，自动加载成功不得写轨道偏好。

- [ ] **Step 7: 最小实现翻译请求与缓存**

新增 `requestTranslation(sourceTrackId, lines)`，通过 `chrome.runtime.sendMessage` 返回 `TranslateBilibiliSubtitlesResponse`。翻译缓存值至少包含：

```ts
interface TranslationCacheEntry {
  sourceTrackId: string;
  lines: BiliSubtitleLine[];
}
```

缓存读取必须重新校验 `sourceTrackId`、数组、有限非负时间码和非空文本；不可信 storage 数据不能直接渲染。

- [ ] **Step 8: 固定加载决策表**

`loadFor` 必须按下表执行，不能在多个分支各自猜测：

| 场景 | 官方请求 preferredTrackId | 是否翻译 | 最终选择 |
|---|---:|---:|---|
| 有官方中文、无手动偏好 | 无 | 否 | 官方中文第一轨 |
| 无中文、有英文、无手动偏好 | 英文源轨或无 | 是 | 虚拟简中 |
| 手动偏好官方英文/日语 | 对应官方 ID | 否 | 手动官方轨 |
| 手动偏好虚拟简中 | 从虚拟 ID 解析英文源 ID | 是/缓存 | 虚拟简中 |
| 无中文且无英文 | 无 | 否 | 官方优先级第一轨 |
| force refresh + 当前虚拟简中 | 英文源 ID | 强制重译 | 虚拟简中 |

生成虚拟 option 时不得把它加入 `BiliSubtitleResource.tracks` 或伪造 CDN URL；它只存在于字幕页展示层。

- [ ] **Step 9: 运行字幕页完整回归**

Run:

```powershell
npm test -- tests/subtitle-page.test.ts
npm test -- tests/adapters/bilibili-subtitle-service.test.ts tests/adapters/bilibili.test.ts
npm run typecheck
```

Expected: 新旧字幕页、官方轨服务与提取器测试全部通过。

- [ ] **Step 10: 建立阶段 checkpoint**

```powershell
git add src/subtitle/subtitle.ts tests/subtitle-page.test.ts tests/setup.ts
git commit -m "feat(subtitles): default to cached Simplified Chinese translation"
```

若 `tests/setup.ts` 实际未改，不得为了匹配命令制造无意义差异。

### Task 5：翻译失败时保留可用官方字幕并给出精确提示

**Files:**
- Modify: `src/subtitle/subtitle.ts`
- Modify: `src/subtitle/subtitle.css`（只有需要错误色时）
- Test: `tests/subtitle-page.test.ts`

- [ ] **Step 1: 写错误映射失败测试**

错误文案固定如下：

| code | 用户文案 |
|---|---|
| `AI_TRANSLATION_DISABLED` | `该视频没有简体中文字幕；请在设置中开启B站字幕自动翻译` |
| `AI_NOT_CONFIGURED` | `字幕翻译需要先配置并启用AI服务` |
| `AI_HOST_NOT_GRANTED` | `AI接口尚未授权，请在设置中授权并测试` |
| `AI_AUTH_FAILED` | `AI服务认证失败，请检查API Key` |
| `AI_ENDPOINT_OR_MODEL_NOT_FOUND` | `AI接口或模型不存在，请检查设置` |
| `AI_RATE_LIMITED` | `AI字幕翻译请求过于频繁或额度不足` |
| `AI_PROVIDER_ERROR` | `AI字幕翻译服务暂时不可用` |
| `AI_TIMEOUT` | `AI字幕翻译超时，请稍后刷新` |
| `AI_NETWORK_ERROR` | `无法连接AI字幕翻译服务` |
| `AI_INVALID_RESPONSE` | `AI返回的字幕翻译格式无效，请刷新重试` |

每个用例都必须断言：原始 English 正文仍被渲染；下拉框仍可操作；设置和刷新按钮仍存在；不得把 `sk-` 或 provider 原始响应写进 DOM。

- [ ] **Step 2: 写并发与销毁失败测试**

覆盖：翻译期间切换到另一个 tab、切回一图速览导致页面 dispose、快速连续刷新。所有迟到响应都不能覆盖当前页面；同一 generation 只能提交一次渲染和缓存。

- [ ] **Step 3: 运行红灯测试**

Run:

```powershell
npm test -- tests/subtitle-page.test.ts -t "AI_|翻译失败|迟到|连续刷新"
```

Expected: FAIL，直到错误映射和 generation 防护完整。

- [ ] **Step 4: 实现单点错误映射和回退**

新增：

```ts
function translationErrorMessage(code: SubtitleTranslationErrorCode): string {
  switch (code) {
    // 严格返回上表文案；default 返回“AI字幕翻译失败，请稍后刷新”
  }
}
```

翻译失败流程必须：先用源英文 `resource.lines` 调用 `renderReady`，再设置状态文案；不能调用现有 `renderError`，因为 `renderError` 会清空轨道与正文。

- [ ] **Step 5: 运行完整字幕页回归**

Run:

```powershell
npm test -- tests/subtitle-page.test.ts tests/bilibili-playback.test.ts tests/content-script.test.ts
npm run typecheck
```

Expected: 全部通过；播放同步、点击跳转、手动滚动和回到当前句无回归。

- [ ] **Step 6: 建立阶段 checkpoint**

```powershell
git add src/subtitle/subtitle.ts src/subtitle/subtitle.css tests/subtitle-page.test.ts
git commit -m "fix(subtitles): keep official tracks when AI translation fails"
```

若 CSS 无实际修改，不得提交该文件。

### Task 6：文档、隐私断言与全量门禁

**Files:**
- Modify: `README.md`
- Modify: `tests/visual-summary.test.ts`
- Create: `docs/progress/2026-08-30-bilibili-ai-zh-subtitle-fallback.md`

- [ ] **Step 1: 先改文档回归测试**

把原来禁止“翻译”一词的断言缩小为禁止字幕页出现额外的复制/导出/搜索/ASR 控件；新增断言：

```ts
expect(readme).toContain('简体中文（AI 翻译）');
expect(readme).toContain('不会发送音频或视频');
expect(readme).toContain('可能产生费用');
expect(readme).toContain('无ASR');
expect(subtitleHtml).not.toMatch(/复制|导出|搜索|语音识别|ASR/);
```

- [ ] **Step 2: 更新 README 的能力边界**

必须删除或改写这些已不再准确的句子：

- `字幕页不提供……翻译……`
- `B站独立字幕页仅官方字幕（无ASR），不做翻译……`

替换为准确说明：官方中文优先；用户显式开启后，只有缺中文且有英文时才调用其自选 AI 服务；只发送英文字幕文本；不发送音视频；会话缓存；可能产生费用；仍无 ASR/OCR。

- [ ] **Step 3: 运行静态隐私扫描**

Run:

```powershell
rg -n "apiKey|Authorization|TRANSLATE_BILIBILI_SUBTITLES|translateBilibiliSubtitles" src tests
rg -n "翻译|ASR|语音识别|音频|视频|费用" README.md src/options src/subtitle tests/visual-summary.test.ts
```

Expected:

- API Key 只在 core/options/background/analysis 的既有安全路径出现，不在 `src/subtitle`。
- 翻译 runtime payload 只有 `sourceTrackId` 和 `lines`。
- README 与 Options 同时包含数据外发和费用提示。

- [ ] **Step 4: 全量自动化门禁**

Run:

```powershell
npm test
npm run typecheck
npm run build
git diff --check
```

Expected: 所有测试通过；typecheck/build 退出码 0；`dist/subtitle.js`、`dist/options.js`、`dist/background.js` 构建成功；无 whitespace error。

- [ ] **Step 5: 执行独立代码审查**

必须使用 code-reviewer；如果审查发现 Critical/Important/Minor，逐项修复并重跑受影响测试。审查重点：

1. 是否存在升级后默认外发字幕。
2. API Key 是否泄露到页面或响应。
3. runtime payload 是否允许任意 URL/超大输入。
4. AI 输出是否可能改变时间码、行数或顺序。
5. 翻译失败是否误标为简体中文。
6. 手动官方轨选择是否被自动翻译覆盖。
7. refresh 是否重复收费且无明显用户动作；预期只有用户点击刷新时才重译。

- [ ] **Step 6: 写执行进度报告**

`docs/progress/2026-08-30-bilibili-ai-zh-subtitle-fallback.md` 必须包含：

- 分支、HEAD、工作树绝对路径。
- 每个 Task 的完成/部分/未完成状态。
- 实际测试数量和命令结果。
- 实际改动文件清单。
- 安全审查结论。
- 真实 Chrome 验收结果；未执行的项目必须写“未验证”，不得写通过。
- 未 merge、未 push、未创建 PR 的明确说明。

- [ ] **Step 7: 建立文档 checkpoint**

```powershell
git add README.md tests/visual-summary.test.ts docs/progress/2026-08-30-bilibili-ai-zh-subtitle-fallback.md
git commit -m "docs: document Bilibili AI subtitle translation fallback"
```

### Task 7：真实 Chrome 验收

**Files:**
- Verify: `dist/`
- Update: `docs/progress/2026-08-30-bilibili-ai-zh-subtitle-fallback.md`

- [ ] **Step 1: 加载正确构建目录**

Chrome 扩展管理页重新加载：

```text
C:\Users\HP\OneDrive\桌面\example\clip2md\.worktrees\bilibili-subtitle-sidepanel\dist
```

确认加载的不是主工作树 `dist`，版本页面无报错。

- [ ] **Step 2: 在设置页显式开启并授权**

1. 开启“启用 AI 功能”。
2. 填写用户自己的 Endpoint、API Key、模型。
3. 勾选“B站无简中轨时自动翻译为简体中文”。
4. 点击“授权并测试”，确认连接成功。
5. 保存设置。

验收证据不得记录 API Key；只记录 Endpoint host、模型名和成功/失败状态。

- [ ] **Step 3: 验收目标视频**

打开 `https://www.bilibili.com/video/BV1Yku16CEzX/`，进入字幕页。

Expected:

- 下拉顺序为 `简体中文（AI 翻译）`、`English (AI)`、`日本語 (AI)`（页面格式允许全角括号，但语义必须一致）。
- 默认选中简体中文虚拟轨。
- 正文为简体中文，不再是英文。
- 点击任一字幕行仍跳转正确时间，不改变播放/暂停状态。
- 播放时高亮继续跟随。
- 切换英文/日语后显示对应官方正文；切回简中不重新请求 AI。
- 关闭并重新进入字幕页，当前会话内命中缓存。
- 点击刷新后重新翻译，正文更新且 UI 保持可用。

- [ ] **Step 4: 验收隐私开关关闭路径**

关闭“B站无简中轨时自动翻译”，重新打开目标视频。

Expected: 不发生 AI 网络请求；显示官方英文，并提示在设置中开启翻译；下拉仍含官方 English / 日本語，不冒充简中。

- [ ] **Step 5: 验收官方中文零调用路径**

使用一个已确认存在人工中文或 AI 中文的 B 站视频。

Expected: 默认官方中文；下拉没有虚拟“简体中文（AI 翻译）”；AI Endpoint 无翻译请求。

- [ ] **Step 6: 验收错误回退**

临时使用无效模型名或撤销 Endpoint 权限，再打开目标视频。

Expected: 显示精确中文错误提示；官方英文仍可阅读和切换；API Key 不出现在页面、控制台或错误提示。恢复配置后刷新可成功翻译。

- [ ] **Step 7: 更新报告并完成最终门禁**

Run:

```powershell
npm test
npm run typecheck
npm run build
git status --short
git log --oneline --decorate -8
```

把真实 Chrome 的 URL、开关状态、轨道列表、成功/失败结果写入进度报告。不得执行 merge、push 或创建 PR，除非用户另行明确授权。

---

## 五、最终验收矩阵

| 场景 | 默认正文 | AI 请求 | 轨道菜单 | 结果 |
|---|---|---:|---|---|
| 官方人工中文存在 | 官方人工中文 | 0 | 官方轨 | 必须通过 |
| 官方 AI 中文存在 | 官方 AI 中文 | 0 | 官方轨 | 必须通过 |
| 无中文、有英文、翻译已开启 | 简体中文 AI 翻译 | 1 或缓存 0 | 虚拟简中 + 官方轨 | 必须通过 |
| 无中文、有英文、翻译关闭 | 官方英文 + 引导 | 0 | 官方轨 | 必须通过 |
| 无中文、无英文、仅日语 | 官方日语 + 无英文提示 | 0 | 官方轨 | 必须通过 |
| AI 未配置/未授权 | 官方英文 + 精确提示 | 0 | 官方轨 | 必须通过 |
| AI 401/429/超时/格式错 | 官方英文 + 精确提示 | 1/批次 | 官方轨 | 必须通过 |
| 手动选英文/日语 | 手动官方轨 | 0 | 保留全部轨 | 必须通过 |
| 手动选虚拟简中 | 翻译或缓存 | 必要时 1 | 保留全部轨 | 必须通过 |
| 刷新虚拟简中 | 新翻译 | 重新请求 | 保留全部轨 | 必须通过 |
| Tab 快速切换 | 当前 Tab 内容 | 迟到结果丢弃 | 当前 Tab 轨 | 必须通过 |

## 六、禁止操作

- 禁止删除或覆盖 Task 0 中现有四个未提交修复。
- 禁止把 `requestCompletion` 复制成第二套 HTTP client。
- 禁止把 API Key 传入 `src/subtitle` 或 runtime response。
- 禁止为了翻译扩大 manifest 静态 `host_permissions`。
- 禁止默认开启翻译开关。
- 禁止在翻译失败时仍把英文轨标成“简体中文”。
- 禁止对官方中文再次翻译。
- 禁止为本功能加入 ASR/OCR/音视频下载依赖。
- 禁止顺手重构一图速览、Options 布局或 B 站提取器。
- 禁止未经授权 merge、push、创建 PR 或改动 `main`。

## 七、交接完成定义

只有同时满足下列条件才能声称完成：

1. 目标视频真实 Chrome 验收默认显示简体中文。
2. 官方中文视频确认零 AI 翻译请求。
3. 关闭翻译开关确认零外部 AI 请求。
4. 时间码、点击跳转、播放跟随、手动轨切换和会话缓存全部通过。
5. 全量测试、typecheck、build、diff-check 全绿。
6. 独立代码审查无未处理 Critical/Important/Minor。
7. 进度报告把完成、部分和未验证项分开写清楚。
8. Git 状态、提交和未授权的远程操作边界清楚记录。
