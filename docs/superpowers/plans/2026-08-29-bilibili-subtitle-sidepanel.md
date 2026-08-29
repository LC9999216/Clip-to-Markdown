# Clip2MD B站独立字幕侧栏 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有一图速览侧栏之外增加只面向 B 站视频的独立字幕 HTML 页面，可靠读取官方字幕并实现轨道切换、时间跳转和播放跟随。

**Architecture:** `sidepanel.html` 保持默认入口，只增加按页面类型显示的字幕链接；新增 `subtitle.html` 及独立控制器。B站字幕能力拆成 WBI 签名、官方字幕服务、中文分段、会话缓存和播放器桥接五个小模块，通过已有受限 JSON 代理与内容脚本消息通信。

**Tech Stack:** TypeScript、Chrome MV3 Side Panel、原生 DOM、Vitest/jsdom、esbuild、`chrome.storage.session`、`@noble/hashes`（仅用于 B 站 WBI 协议要求的 MD5）。

---

## 文件结构

新增：

- `src/adapters/bilibili/wbi.ts`：WBI 密钥提取、mixin key 与签名 URL。
- `src/adapters/bilibili/subtitle-types.ts`：字幕轨、字幕行、分段、资源和错误类型。
- `src/adapters/bilibili/transcript.ts`：中文/拉丁文字确定性分段。
- `src/adapters/bilibili/subtitle-service.ts`：视频信息、签名 player 请求、轨道选择及字幕下载。
- `src/adapters/bilibili/playback.ts`：读取和跳转 B 站播放器，不改变播放状态。
- `src/subtitle/subtitle.html`：独立字幕页结构。
- `src/subtitle/subtitle.css`：字幕页独立样式。
- `src/subtitle/subtitle.ts`：字幕页加载、缓存、渲染、轨道切换与播放跟随。
- `tests/adapters/bilibili-wbi.test.ts`
- `tests/adapters/bilibili-transcript.test.ts`
- `tests/adapters/bilibili-subtitle-service.test.ts`
- `tests/bilibili-playback.test.ts`
- `tests/subtitle-page.test.ts`
- `THIRD_PARTY_NOTICES.md`

修改：

- `package.json`、`package-lock.json`：锁定 MD5 实现依赖。
- `src/types/messages.ts`：JSON 凭据策略与播放器消息协议、类型守卫。
- `src/background/background.ts`：按请求选择 `include`/`omit`，继续执行域名白名单。
- `src/adapters/bilibili/extractor.ts`：复用可靠字幕服务，删除未签名 player 请求重复实现。
- `src/content/content-script.ts`：处理播放状态读取与时间跳转。
- `src/sidepanel/sidepanel.html`、`sidepanel.css`、`sidepanel.ts`：增加仅 B 站显示的字幕入口。
- `build.mjs`：构建字幕脚本并复制字幕 HTML/CSS。
- `tests/setup.ts`、`tests/background.test.ts`、`tests/content-script.test.ts`、`tests/sidepanel.test.ts`、`tests/visual-summary.test.ts`、`tests/adapters/bilibili.test.ts`：扩充 mock 与回归覆盖。
- `README.md`：记录独立字幕页、范围及参考来源。

## Task 0：创建隔离工作树并确认基线

**Files:**
- Verify: `.gitignore`
- Verify: `package.json`

- [ ] **Step 1: 确认实现工作树目录已被忽略**

Run: `git check-ignore -v .worktrees`

Expected: 输出 `.gitignore:5:.worktrees/`。

- [ ] **Step 2: 从已包含设计和计划的 main 创建实现工作树**

Run: `git worktree add .worktrees/bilibili-subtitle-sidepanel -b codex/bilibili-subtitle-sidepanel main`

Expected: 创建分支 `codex/bilibili-subtitle-sidepanel`，不改动主工作树。

- [ ] **Step 3: 在新工作树运行基线门禁**

Run: `npm test`

Expected: 所有现有 Vitest 测试通过。

Run: `npm run typecheck`

Expected: 退出码 0，无 TypeScript 错误。

Run: `npm run build`

Expected: 输出 `构建完成 → dist/`。

## Task 1：实现可验证的 WBI 签名

**Files:**
- Create: `src/adapters/bilibili/wbi.ts`
- Create: `tests/adapters/bilibili-wbi.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: 安装并锁定 MD5 依赖**

Run: `npm install --save-exact @noble/hashes@2.3.0`

Expected: `dependencies` 出现 `"@noble/hashes": "2.3.0"`，锁文件同步更新。

- [ ] **Step 2: 写 WBI 固定向量失败测试**

```ts
import { describe, expect, it } from 'vitest';
import { extractWbiKeys, signWbiParams } from '../../src/adapters/bilibili/wbi';

describe('B站 WBI 签名', () => {
  it('从 nav 图片 URL 提取密钥', () => {
    expect(extractWbiKeys({
      img_url: 'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png',
      sub_url: 'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png',
    })).toEqual({
      imgKey: '7cd084941338484aae1ad9425b84077c',
      subKey: '4932caff0ff746eab6f01bf08b70ac45',
    });
  });

  it('匹配公开 WBI 签名向量', () => {
    expect(signWbiParams(
      { foo: '114', bar: '514', zab: 1919810 },
      {
        imgKey: '7cd084941338484aae1ad9425b84077c',
        subKey: '4932caff0ff746eab6f01bf08b70ac45',
      },
      1702204169,
    )).toBe('bar=514&foo=114&wts=1702204169&zab=1919810&w_rid=8f6f2b5b3d485fe1886cec6a0be8c5d4');
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npm test -- tests/adapters/bilibili-wbi.test.ts`

Expected: FAIL，原因是 `wbi.ts` 尚不存在。

- [ ] **Step 4: 实现最小签名模块**

```ts
import { md5 } from '@noble/hashes/legacy.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

const MIXIN_KEY_ENC_TAB = [46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52] as const;

export interface WbiKeys { imgKey: string; subKey: string }

export function extractWbiKeys(value: { img_url?: string; sub_url?: string }): WbiKeys {
  const key = (url = '') => url.slice(url.lastIndexOf('/') + 1, url.lastIndexOf('.'));
  const result = { imgKey: key(value.img_url), subKey: key(value.sub_url) };
  if (!result.imgKey || !result.subKey) throw new Error('无法取得 WBI 密钥');
  return result;
}

export function signWbiParams(
  params: Record<string, string | number>,
  keys: WbiKeys,
  wts = Math.floor(Date.now() / 1000),
): string {
  const source = keys.imgKey + keys.subKey;
  const mixinKey = MIXIN_KEY_ENC_TAB.map((index) => source[index] ?? '').join('').slice(0, 32);
  const entries = Object.entries({ ...params, wts }).sort(([a], [b]) => a.localeCompare(b));
  const query = entries.map(([name, raw]) => {
    const value = String(raw).replace(/[!'()*]/g, '');
    return `${encodeURIComponent(name)}=${encodeURIComponent(value)}`;
  }).join('&');
  const wRid = bytesToHex(md5(utf8ToBytes(query + mixinKey)));
  return `${query}&w_rid=${wRid}`;
}
```

- [ ] **Step 5: 运行目标测试和类型检查**

Run: `npm test -- tests/adapters/bilibili-wbi.test.ts`

Expected: PASS（2 tests）。

Run: `npm run typecheck`

Expected: 退出码 0。

- [ ] **Step 6: 提交**

```powershell
git add package.json package-lock.json src/adapters/bilibili/wbi.ts tests/adapters/bilibili-wbi.test.ts
git commit -m "feat(bilibili): add WBI signing"
```

## Task 2：建立字幕类型与中文分段

**Files:**
- Create: `src/adapters/bilibili/subtitle-types.ts`
- Create: `src/adapters/bilibili/transcript.ts`
- Create: `tests/adapters/bilibili-transcript.test.ts`

- [ ] **Step 1: 写分段失败测试**

测试必须断言：空行被移除；中文在自然句末形成短段；任何段落不超过 20 秒；输出顺序、首尾时间与全文字符均保持；超长单行会按比例拆分而不丢字。

```ts
import { describe, expect, it } from 'vitest';
import { groupTranscript } from '../../src/adapters/bilibili/transcript';

describe('B站字幕分段', () => {
  it('按中文句末和时长分段且不丢字', () => {
    const raw = [
      { from: 0, to: 4, content: '这是第一句。' },
      { from: 4, to: 9, content: '这是第二句，继续说明。' },
      { from: 25, to: 29, content: '新的时间段。' },
    ];
    const result = groupTranscript(raw);
    expect(result.map((item) => item.text).join('')).toBe(raw.map((item) => item.content).join(''));
    expect(result.every((item) => item.end - item.start <= 20)).toBe(true);
    expect(result[0]).toMatchObject({ start: 0 });
    expect(result.at(-1)).toMatchObject({ end: 29 });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- tests/adapters/bilibili-transcript.test.ts`

Expected: FAIL，原因是字幕类型和分段模块不存在。

- [ ] **Step 3: 定义稳定的公共类型**

```ts
export interface BiliSubtitleLine { from: number; to: number; content: string }
export interface BiliTranscriptSegment { id: string; start: number; end: number; text: string }
export interface BiliSubtitleTrack {
  id: string;
  language: string;
  label: string;
  url: string;
  isAi: boolean;
}
export type BiliSubtitleErrorCode = 'NEED_LOGIN' | 'NO_SUBTITLE' | 'EMPTY_TRANSCRIPT' | 'FETCH_FAILED';
export class BiliSubtitleError extends Error {
  constructor(public readonly code: BiliSubtitleErrorCode, message: string) { super(message); }
}
```

- [ ] **Step 4: 实现确定性分段**

实现规则固定为：中文 `min=30/ideal=90/max=160` 字，拉丁文字 `min=60/ideal=180/max=320` 字符，最大 20 秒；硬上限前优先句末标点，其次原字幕行边界，超长单行按字符比例切片并按原时长插值。段落 ID 使用 `S0001`、`S0002`，不得改变文字顺序。

- [ ] **Step 5: 运行目标测试**

Run: `npm test -- tests/adapters/bilibili-transcript.test.ts`

Expected: PASS，且测试包含中文、拉丁文字、空行和超长单行四组案例。

- [ ] **Step 6: 提交**

```powershell
git add src/adapters/bilibili/subtitle-types.ts src/adapters/bilibili/transcript.ts tests/adapters/bilibili-transcript.test.ts
git commit -m "feat(bilibili): group subtitle transcript"
```

## Task 3：让 JSON 代理显式控制 Cookie

**Files:**
- Modify: `src/types/messages.ts:28-37,198-204`
- Modify: `src/background/background.ts:97-106,208-246`
- Modify: `src/adapters/bilibili/extractor.ts:140-154,259-261`
- Modify: `tests/background.test.ts`

- [ ] **Step 1: 写失败测试**

新增测试发送 `{ type: 'FETCH_JSON', url: 'https://aisubtitle.hdslb.com/a.json', credentials: 'omit' }`，断言 background 的 `fetch` 使用 `credentials: 'omit'`；API URL 未提供字段时仍为 `include`；非法值 `same-origin` 被类型守卫拒绝。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- tests/background.test.ts -t "B站 JSON"`

Expected: FAIL，因为现有代理固定使用 `credentials: 'include'`。

- [ ] **Step 3: 扩展消息协议和守卫**

```ts
export type FetchJsonCredentials = 'include' | 'omit';
export type FetchJsonRequest = {
  type: 'FETCH_JSON';
  url: string;
  credentials?: FetchJsonCredentials;
};

export function isFetchJsonRequest(m: unknown): m is FetchJsonRequest {
  if (!isRecord(m) || m.type !== 'FETCH_JSON' || typeof m.url !== 'string' || m.url === '') return false;
  return m.credentials === undefined || m.credentials === 'include' || m.credentials === 'omit';
}
```

- [ ] **Step 4: 把凭据策略传给受限 fetch**

`handleFetchJson(url, credentials = 'include')` 继续执行现有协议、主机和 sender 校验，只把 `fetch` 选项改成 `credentials`。字幕 CDN 调用传 `omit`，view/nav/player 调用保持 `include`。

- [ ] **Step 5: 运行回归**

Run: `npm test -- tests/background.test.ts tests/adapters/bilibili.test.ts`

Expected: PASS。

- [ ] **Step 6: 提交**

```powershell
git add src/types/messages.ts src/background/background.ts src/adapters/bilibili/extractor.ts tests/background.test.ts tests/adapters/bilibili.test.ts
git commit -m "fix(bilibili): isolate subtitle CDN credentials"
```

## Task 4：集中实现官方字幕服务并接回现有提取器

**Files:**
- Create: `src/adapters/bilibili/subtitle-service.ts`
- Create: `tests/adapters/bilibili-subtitle-service.test.ts`
- Modify: `src/adapters/bilibili/extractor.ts:15-260,383-435`
- Modify: `tests/adapters/bilibili.test.ts`

- [ ] **Step 1: 写服务失败测试**

使用注入的 `requestJson` 依次模拟 `view → nav → signed player/wbi/v2 → subtitle CDN`，断言：player URL 含 `wts/w_rid`；API 请求为 `include`、CDN 为 `omit`；轨道优先级是人工中文、AI中文、其他人工、其他AI；未登录且无轨道为 `NEED_LOGIN`；已登录无轨道为 `NO_SUBTITLE`；空 body 为 `EMPTY_TRANSCRIPT`；`-412` 为 `FETCH_FAILED`。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- tests/adapters/bilibili-subtitle-service.test.ts`

Expected: FAIL，原因是服务不存在。

- [ ] **Step 3: 定义服务边界**

```ts
export type BiliJsonRequest = (
  url: string,
  credentials?: 'include' | 'omit',
) => Promise<unknown>;

export interface BiliSubtitleResource {
  identity: { bvid: string; pageIndex: number; cid: number };
  title: string;
  author: string;
  part: string;
  description: string;
  publishedAt: number;
  tracks: BiliSubtitleTrack[];
  selectedTrackId: string | null;
  lines: BiliSubtitleLine[];
  chapters: Array<{ title: string; from: number; to: number }>;
}

export async function fetchBilibiliSubtitleResource(args: {
  url: URL;
  requestJson: BiliJsonRequest;
  preferredTrackId?: string;
  nowSeconds?: number;
  allowEmpty?: boolean;
}): Promise<BiliSubtitleResource>;
```

- [ ] **Step 4: 实现四步官方接口流程**

实现必须只使用：`x/web-interface/view`、`x/web-interface/nav`、签名后的 `x/player/wbi/v2` 和选中轨道的字幕 URL。规范化 `ai_status/ai_type/lan`，字幕 URL 仅接受 HTTPS 且主机属于 `hdslb.com`。没有轨道时结合 nav 的 `isLogin` 选择 `NEED_LOGIN` 或 `NO_SUBTITLE`；只有 `allowEmpty: true` 时返回带元数据但 `tracks/lines` 为空的资源。

- [ ] **Step 5: 让现有 extractor 复用服务**

保留 `buildBodyMarkdown`、DOM 兜底和现有 60 秒一图速览来源窗口；只替换重复的 view/player/track/body 请求。提取器调用服务时传 `allowEmpty: true`，使无字幕视频仍生成标题、简介、章节和“暂无字幕”。从 `extractor.ts` 继续导出兼容别名 `export type BiliSubtitleBodyItem = BiliSubtitleLine`，避免现有 Markdown 与测试调用方破坏。

- [ ] **Step 6: 运行目标与回归测试**

Run: `npm test -- tests/adapters/bilibili-subtitle-service.test.ts tests/adapters/bilibili.test.ts`

Expected: PASS。

Run: `npm run typecheck`

Expected: 退出码 0。

- [ ] **Step 7: 提交**

```powershell
git add src/adapters/bilibili/subtitle-service.ts src/adapters/bilibili/extractor.ts tests/adapters/bilibili-subtitle-service.test.ts tests/adapters/bilibili.test.ts
git commit -m "feat(bilibili): centralize official subtitles"
```

## Task 5：增加播放器读取与安全跳转协议

**Files:**
- Create: `src/adapters/bilibili/playback.ts`
- Create: `tests/bilibili-playback.test.ts`
- Modify: `src/types/messages.ts`
- Modify: `src/content/content-script.ts:6-171`
- Modify: `tests/content-script.test.ts`

- [ ] **Step 1: 写播放桥接失败测试**

覆盖：返回 BV/分P、`currentTime`、`paused`；身份不匹配时拒绝跳转；暂停视频跳转后不调用 `play()`；播放中的视频跳转后恢复播放；无 `<video>` 时返回 `PLAYER_NOT_READY`。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- tests/bilibili-playback.test.ts tests/content-script.test.ts -t "B站播放器"`

Expected: FAIL，因为新消息协议尚不存在。

- [ ] **Step 3: 增加严格消息类型**

```ts
export type GetBilibiliPlaybackStateRequest = { type: 'GET_BILIBILI_PLAYBACK_STATE' };
export type GetBilibiliPlaybackStateResponse =
  | { success: true; identity: string; currentTime: number; paused: boolean }
  | { success: false; error: { code: 'UNSUPPORTED_PAGE' | 'PLAYER_NOT_READY'; message: string } };

export type SeekBilibiliVideoRequest = {
  type: 'SEEK_BILIBILI_VIDEO';
  payload: { expectedIdentity: string; seconds: number };
};
```

守卫要求 `expectedIdentity` 匹配 `/^BV[0-9A-Za-z]+:p[1-9]\d*$/`，`seconds` 为 `0 <= seconds <= 86400` 的有限数。

- [ ] **Step 4: 实现播放器纯函数并接入 content script**

`readBilibiliPlaybackState(doc, url)` 和 `seekBilibiliVideo(doc, url, payload)` 只查询当前 `<video>`。跳转前保存 `paused`，设置 `currentTime` 后仅在原来播放时调用 `play()`；不滚动页面、不猜测其他视频元素。

- [ ] **Step 5: 运行测试并提交**

Run: `npm test -- tests/bilibili-playback.test.ts tests/content-script.test.ts`

Expected: PASS。

```powershell
git add src/adapters/bilibili/playback.ts src/types/messages.ts src/content/content-script.ts tests/bilibili-playback.test.ts tests/content-script.test.ts
git commit -m "feat(bilibili): add subtitle playback bridge"
```

## Task 6：在原侧栏增加独立字幕页入口并接入构建

**Files:**
- Modify: `src/sidepanel/sidepanel.html:11-22`
- Modify: `src/sidepanel/sidepanel.css:55-93`
- Modify: `src/sidepanel/sidepanel.ts:16-30,178-181,285-335`
- Modify: `build.mjs:35-61`
- Modify: `tests/sidepanel.test.ts`
- Modify: `tests/visual-summary.test.ts`
- Create: `src/subtitle/subtitle.html`
- Create: `src/subtitle/subtitle.css`
- Create: `src/subtitle/subtitle.ts`

- [ ] **Step 1: 写入口和构建失败测试**

断言：品牌栏存在 `#action-subtitles[href="subtitle.html"]` 且默认 hidden；B站 `GET_STATUS` 响应后显示；非B站、无响应和标签切换后隐藏；`build.mjs` 生成 `dist/subtitle.js` 并复制 HTML/CSS；manifest 的默认路径仍是 `sidepanel.html`。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- tests/sidepanel.test.ts tests/visual-summary.test.ts`

Expected: FAIL，因为字幕入口和构建项不存在。

- [ ] **Step 3: 增加真实链接而非单页路由**

```html
<a class="text-icon-button" id="action-subtitles" href="subtitle.html" hidden>字幕</a>
```

把该链接与现有 `#action-settings` 原样放入新的 `.brand-actions` 容器；设置按钮及 SVG 不作任何改写。

初始化和标签切换时向活动 tab 发送 `GET_STATUS`；仅当 `supported === true`、`platform === 'bilibili'`、`contentType === 'bilibili-video'` 时移除 hidden。使用代次检查，旧标签响应不能改变新标签按钮。

- [ ] **Step 4: 建立最小独立字幕页外壳**

`subtitle.html` 必须包含 `action-back`（`href="sidepanel.html"`）、`action-refresh`、`action-settings`、`subtitle-title`、`subtitle-track`、`subtitle-status`、`subtitle-list` 和 `return-current`；不得包含搜索、段数、复制或导出控件。

- [ ] **Step 5: 更新 build.mjs**

新增 `src/subtitle/subtitle.ts → dist/subtitle.js` IIFE，并复制 `subtitle.html`、`subtitle.css`。不要修改 manifest 的 `side_panel.default_path`。

- [ ] **Step 6: 运行测试、构建并提交**

Run: `npm test -- tests/sidepanel.test.ts tests/visual-summary.test.ts`

Expected: PASS。

Run: `npm run build`

Expected: `dist/subtitle.html`、`dist/subtitle.css`、`dist/subtitle.js` 存在。

```powershell
git add src/sidepanel src/subtitle build.mjs tests/sidepanel.test.ts tests/visual-summary.test.ts
git commit -m "feat(sidepanel): add Bilibili subtitle page entry"
```

## Task 7：实现字幕页加载、轨道切换、缓存和错误状态

**Files:**
- Modify: `src/subtitle/subtitle.ts`
- Modify: `src/subtitle/subtitle.html`
- Modify: `src/subtitle/subtitle.css`
- Modify: `tests/setup.ts:14-27,86-115,228-254,316-350`
- Create: `tests/subtitle-page.test.ts`

- [ ] **Step 1: 扩充 chrome mock 并写页面失败测试**

测试活动 tab 状态探测、首次进入才请求、人工中文默认选择、轨道切换、同一 BV+分P+轨道缓存命中、刷新绕过缓存、切换 tab 丢弃旧响应，以及六种已确认错误文案。测试还必须断言字幕文本 `<img src=x onerror=alert(1)>` 只出现在 `textContent`，DOM 中没有新增 `img`。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- tests/subtitle-page.test.ts`

Expected: FAIL，因为字幕控制器尚未实现。

- [ ] **Step 3: 定义页面会话键和状态**

```ts
const CACHE_PREFIX = 'clip2md.bilibiliSubtitle.cache.v1.';
const UI_PREFIX = 'clip2md.bilibiliSubtitle.ui.v1.';
type SubtitlePageState =
  | { kind: 'loading' }
  | { kind: 'ready'; resource: BiliSubtitleResource; segments: BiliTranscriptSegment[] }
  | { kind: 'error'; message: string };
```

缓存键为 `${CACHE_PREFIX}${bvid}:p${pageIndex}:${trackId}`，UI 键为 `${UI_PREFIX}${bvid}:p${pageIndex}`。会话值只保存规范化纯数据、轨道选择和 `scrollTop`。

- [ ] **Step 4: 实现一次加载的控制器**

`initializeSubtitlePage()` 查询活动 tab，发送 `GET_STATUS`，校验 B 站视频身份，然后调用字幕服务。每次加载递增 request generation；只有 generation 和 tabId 都仍匹配时才能渲染。轨道切换先查对应缓存，再请求；刷新忽略所有同身份缓存并重新获取索引与正文。

- [ ] **Step 5: 实现最小安全渲染**

每行用 `document.createElement('button')` 生成 `.subtitle-row`，以 `row.dataset.start = String(segment.start)` 写入时间；内部两个 `span` 分别以 `textContent` 设置时间戳和正文。状态只允许设计中的中文文案；错误状态仍保留返回、刷新和设置按钮。

- [ ] **Step 6: 运行测试并提交**

Run: `npm test -- tests/subtitle-page.test.ts`

Expected: PASS，且测试明确断言页面不存在搜索、段数、复制和导出控件。

Run: `npm run typecheck`

Expected: 退出码 0。

```powershell
git add src/subtitle tests/setup.ts tests/subtitle-page.test.ts
git commit -m "feat(subtitles): render official Bilibili tracks"
```

## Task 8：实现当前句高亮、跟随与时间跳转

**Files:**
- Modify: `src/subtitle/subtitle.ts`
- Modify: `src/subtitle/subtitle.css`
- Modify: `tests/subtitle-page.test.ts`

- [ ] **Step 1: 写播放联动失败测试**

使用 fake timers 断言：页面可见时每 500ms 读取一次播放状态；隐藏时停止；当前时间只切换前后两个高亮元素；点击行发送 `SEEK_BILIBILI_VIDEO`；手动 wheel/touch/scroll 后暂停自动 `scrollIntoView` 并显示“回到当前句”；点击后恢复跟随；播放器未加载只显示轻量提示。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- tests/subtitle-page.test.ts -t "播放|跟随|跳转"`

Expected: FAIL，因为轮询和跟随尚未实现。

- [ ] **Step 3: 实现可释放的播放循环**

`startPlaybackSync(tabId, identity, segments)` 返回 disposer。仅当 `document.visibilityState === 'visible'` 时发送状态请求；用二分查找定位 `start <= currentTime < end` 的段落；记录 `activeIndex` 并只更新变化的两个 DOM 节点。

- [ ] **Step 4: 实现用户滚动优先级**

wheel、touchmove 和非程序触发的 scroll 将 `followEnabled` 设为 false 并显示 `#return-current`。点击按钮调用当前行 `scrollIntoView({ block: 'center' })`、重新启用跟随并保存新的滚动状态。disposer 清除 interval 和所有监听器。

- [ ] **Step 5: 运行测试并提交**

Run: `npm test -- tests/subtitle-page.test.ts tests/bilibili-playback.test.ts tests/content-script.test.ts`

Expected: PASS。

```powershell
git add src/subtitle/subtitle.ts src/subtitle/subtitle.css tests/subtitle-page.test.ts
git commit -m "feat(subtitles): follow Bilibili playback"
```

## Task 9：文档、许可、全量回归与真实页面验收

**Files:**
- Create: `THIRD_PARTY_NOTICES.md`
- Modify: `README.md:13-17,83-90,127-148,182-186,241-244`
- Modify: `build.mjs`
- Verify: all changed source and test files

- [ ] **Step 1: 写文档/许可失败测试或静态断言**

在 `tests/visual-summary.test.ts` 增加断言：构建复制 `THIRD_PARTY_NOTICES.md`；README 明确“B站独立字幕页”“仅官方字幕”“无ASR”；参考来源链接是 `https://github.com/biuworks/bilibili-digest`。

- [ ] **Step 2: 写许可和用户文档**

`THIRD_PARTY_NOTICES.md` 包含 `@noble/hashes` 的名称、版本、项目 URL、MIT 许可证和完整版权/许可文本。README 只描述已实现功能，不宣传搜索、复制、导出、翻译、双语、顺句或 ASR。

- [ ] **Step 3: 运行完整自动化门禁**

Run: `npm test`

Expected: 全部测试通过。

Run: `npm run typecheck`

Expected: 退出码 0。

Run: `npm run build`

Expected: 构建成功，`dist` 包含两个独立侧栏页面和 `THIRD_PARTY_NOTICES.md`。

- [ ] **Step 4: 检查构建产物与越界功能**

Run: `rg -n "搜索|复制|导出|翻译|双语|顺句|语音识别|ASR" src/subtitle dist/subtitle.html README.md`

Expected: 字幕页面源码和产物不出现被排除的控件；README 中只允许出现在“暂不支持/不进行”说明里。

- [ ] **Step 5: 真实 B 站人工验收**

重新加载 `dist` 扩展。至少使用用户提供的 `BV1xH8R6rEoJ` 验证 AI 中文字幕，再选择实际接口已确认的人工字幕、多字幕轨、无字幕和多分 P 视频各一个。逐项验证：一图速览仍默认打开；字幕入口仅 B 站显示；两个 HTML 往返；刷新；轨道恢复；高亮跟随；手动滚动；“回到当前句”；点击跳转不改变暂停状态。记录测试 URL 和结果，不把未验证项写成通过。

- [ ] **Step 6: 最终提交**

```powershell
git add README.md THIRD_PARTY_NOTICES.md build.mjs tests/visual-summary.test.ts
git commit -m "docs: document Bilibili subtitle side panel"
```

- [ ] **Step 7: 最终状态检查**

Run: `git status --short --branch`

Expected: `codex/bilibili-subtitle-sidepanel` 工作树干净；不执行 merge、push 或创建 PR，除非用户另行明确授权。
