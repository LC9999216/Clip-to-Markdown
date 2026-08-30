import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeSubtitlePage } from '../src/subtitle/subtitle';
import {
  dispatchTabActivated,
  mockSessionStorage,
  runtimeSendMessageMock,
  tabsQueryMock,
  tabsSendMessageMock,
} from './setup';

function makeView() {
  return {
    code: 0,
    data: {
      aid: 123,
      title: '测试视频',
      desc: '视频简介',
      pubdate: 1700000000,
      owner: { name: '测试 UP' },
      cid: 111,
      pages: [
        { cid: 111, page: 1, part: '第一 P', duration: 30 },
        { cid: 456, page: 2, part: '第二 P', duration: 60 },
      ],
    },
  };
}

function makeNav(isLogin = true) {
  return {
    code: 0,
    data: {
      isLogin,
      wbi_img: {
        img_url: 'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png',
        sub_url: 'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png',
      },
    },
  };
}

const tracks = [
  { id: 4, id_str: 'other-ai', lan: 'ja-JP', lan_doc: '日本語', ai_type: '1', ai_status: '1', subtitle_url: 'https://subtitle.hdslb.com/other-ai.json' },
  { id: 3, id_str: 'other-human', lan: 'en-US', lan_doc: 'English', ai_type: 0, ai_status: 0, subtitle_url: 'https://subtitle.hdslb.com/other-human.json' },
  { id: 2, id_str: 'ai-zh', lan: 'zh-CN', lan_doc: '中文（AI）', ai_type: 1, ai_status: 1, subtitle_url: 'https://subtitle.hdslb.com/ai-zh.json' },
  { id: 1, id_str: 'human-zh', lan: 'ZH_cn', lan_doc: '中文', ai_type: '0', ai_status: '0', subtitle_url: 'https://subtitle.hdslb.com/human-zh.json' },
];

function makePlayer() {
  return {
    code: 0,
    data: { subtitle: { subtitles: tracks }, view_points: [{ content: '开场', from: 0, to: 12 }] },
  };
}

const HUMAN_ZH_URL = 'https://subtitle.hdslb.com/human-zh.json';
const AI_ZH_URL = 'https://subtitle.hdslb.com/ai-zh.json';

const BILIBILI_STATUS = {
  supported: true,
  platform: 'bilibili',
  contentType: 'bilibili-video',
  url: 'https://www.bilibili.com/video/BV1xx411c7mD/?p=2',
};

function mountSubtitlePage(): void {
  document.body.innerHTML = `
    <main class="shell">
      <header class="brand-bar">
        <a id="action-back" href="sidepanel.html"></a>
        <div class="brand-actions">
          <button id="action-refresh" type="button"></button>
          <button id="action-settings" type="button"></button>
        </div>
      </header>
      <h1 id="subtitle-title"></h1>
      <select id="subtitle-track" disabled></select>
      <p id="subtitle-status" role="status" aria-live="polite"></p>
      <div id="subtitle-list"></div>
      <button id="return-current" type="button" hidden>回到当前句</button>
    </main>`;
}

function respondGetStatus(status: unknown): void {
  tabsSendMessageMock.mockImplementation((_tabId, message, callback) => {
    if ((message as { type?: string }).type === 'GET_STATUS') callback?.(status);
  });
}

interface FetchFixture {
  nav?: unknown;
  player?: unknown;
  cdn?: Record<string, unknown>;
  fail?: boolean;
  translate?: unknown;
}

function respondFetchJson(fixture: FetchFixture = {}): void {
  runtimeSendMessageMock.mockImplementation((msg: unknown, cb?: (resp: unknown) => void) => {
    const message = msg as { type?: string; url?: string };
    if (message.type === 'TRANSLATE_BILIBILI_SUBTITLES') {
      cb?.(fixture.translate ?? {
        success: true,
        lines: [{ from: 0, to: 4, content: '你有没有发现，现在大家使用 AI 的方式都差不多？' }],
      });
      return;
    }
    if (message.type !== 'FETCH_JSON') return;
    const url = message.url ?? '';
    let payload: unknown;
    if (url.includes('/x/web-interface/view')) payload = makeView();
    else if (url.includes('/x/web-interface/nav')) payload = fixture.nav ?? makeNav();
    else if (url.includes('/x/player/wbi/v2')) payload = fixture.player ?? makePlayer();
    else payload = fixture.cdn?.[url] ?? { body: [{ from: 0, to: 2, content: '字幕正文' }] };
    cb?.(fixture.fail ? { success: false, error: 'HTTP 412' } : { success: true, data: payload });
  });
}

function defaultCdn(): Record<string, unknown> {
  return {
    [HUMAN_ZH_URL]: { body: [{ from: 0, to: 2, content: '人工中文第一句' }] },
    [AI_ZH_URL]: { body: [{ from: 0, to: 2, content: 'AI 字幕' }] },
  };
}

describe('字幕页加载、缓存与轨道', () => {
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    mountSubtitlePage();
    tabsQueryMock.mockImplementation((_query, callback) => {
      callback?.([{ id: 7, active: true }] as chrome.tabs.Tab[]);
    });
  });

  afterEach(() => dispose?.());

  it('首次打开探测活动 tab 并按优先级渲染人工中文字幕', async () => {
    respondGetStatus(BILIBILI_STATUS);
    respondFetchJson({ cdn: defaultCdn() });

    dispose = await initializeSubtitlePage();

    await vi.waitFor(() => expect(document.querySelector('#subtitle-title')?.textContent).toBe('测试视频'));
    const select = document.querySelector('#subtitle-track') as HTMLSelectElement;
    expect(select.disabled).toBe(false);
    expect(select.value).toBe('human-zh');
    expect([...select.options].map((option) => option.value)).toEqual(['human-zh', 'ai-zh', 'other-human', 'other-ai']);
    const rows = document.querySelectorAll('#subtitle-list .subtitle-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.querySelector('.subtitle-text')?.textContent).toBe('人工中文第一句');
    expect(rows[0]?.querySelector('.subtitle-time')?.textContent).toBe('00:00');
    expect(rows[0]?.getAttribute('data-start')).toBe('0');
    expect(document.querySelector('#subtitle-status')?.textContent).toBe('');
    // 字幕 CDN 请求不带凭据
    expect(runtimeSendMessageMock).toHaveBeenCalledWith(
      { type: 'FETCH_JSON', url: HUMAN_ZH_URL, credentials: 'omit' },
      expect.any(Function),
    );
  });

  it('同一 BV+分P+轨道再次打开命中会话缓存且不发新请求', async () => {
    respondGetStatus(BILIBILI_STATUS);
    respondFetchJson({ cdn: defaultCdn() });

    dispose = await initializeSubtitlePage();
    await vi.waitFor(() => expect(document.querySelectorAll('#subtitle-list .subtitle-row')).toHaveLength(1));
    expect(Object.keys(mockSessionStorage)).toContain('clip2md.bilibiliSubtitle.cache.v1.BV1xx411c7mD:p2:human-zh');
    // ui.v2 只持久化用户主动切换的轨道：自动选择不落盘
    expect(Object.keys(mockSessionStorage)).not.toContain('clip2md.bilibiliSubtitle.ui.v2.BV1xx411c7mD:p2');

    // 用户显式选择当前轨道写入偏好后，重新打开才直接命中缓存
    const select = document.querySelector('#subtitle-track') as HTMLSelectElement;
    select.value = 'human-zh';
    select.dispatchEvent(new Event('change'));
    await vi.waitFor(() => {
      expect(mockSessionStorage['clip2md.bilibiliSubtitle.ui.v2.BV1xx411c7mD:p2'])
        .toMatchObject({ preferredTrackId: 'human-zh' });
    });

    const callsAfterSelection = runtimeSendMessageMock.mock.calls.length;
    const firstDispose = dispose;
    dispose = await initializeSubtitlePage();
    firstDispose?.();

    expect(runtimeSendMessageMock.mock.calls.length).toBe(callsAfterSelection);
    expect(document.querySelectorAll('#subtitle-list .subtitle-row')).toHaveLength(1);
    expect(document.querySelector('#subtitle-list .subtitle-text')?.textContent).toBe('人工中文第一句');
  });

  it('切换轨道请求目标轨道，切回时命中缓存', async () => {
    respondGetStatus(BILIBILI_STATUS);
    respondFetchJson({ cdn: defaultCdn() });

    dispose = await initializeSubtitlePage();
    await vi.waitFor(() => expect((document.querySelector('#subtitle-track') as HTMLSelectElement).value).toBe('human-zh'));
    const callsBefore = runtimeSendMessageMock.mock.calls.length;

    const select = document.querySelector('#subtitle-track') as HTMLSelectElement;
    select.value = 'ai-zh';
    select.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(document.querySelector('#subtitle-list .subtitle-text')?.textContent).toBe('AI 字幕'));
    expect(runtimeSendMessageMock.mock.calls.length).toBeGreaterThan(callsBefore);
    expect((document.querySelector('#subtitle-track') as HTMLSelectElement).value).toBe('ai-zh');

    const callsAfterSwitch = runtimeSendMessageMock.mock.calls.length;
    select.value = 'human-zh';
    select.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(document.querySelector('#subtitle-list .subtitle-text')?.textContent).toBe('人工中文第一句'));
    expect(runtimeSendMessageMock.mock.calls.length).toBe(callsAfterSwitch);
  });

  it('重新打开时恢复上次的轨道选择', async () => {
    respondGetStatus(BILIBILI_STATUS);
    respondFetchJson({ cdn: defaultCdn() });

    const firstDispose = await initializeSubtitlePage();
    await vi.waitFor(() => expect((document.querySelector('#subtitle-track') as HTMLSelectElement).value).toBe('human-zh'));
    const select = document.querySelector('#subtitle-track') as HTMLSelectElement;
    select.value = 'ai-zh';
    select.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(document.querySelector('#subtitle-list .subtitle-text')?.textContent).toBe('AI 字幕'));
    const callsBeforeReopen = runtimeSendMessageMock.mock.calls.length;
    firstDispose();

    dispose = await initializeSubtitlePage();

    await vi.waitFor(() => expect((document.querySelector('#subtitle-track') as HTMLSelectElement).value).toBe('ai-zh'));
    expect(document.querySelector('#subtitle-list .subtitle-text')?.textContent).toBe('AI 字幕');
    expect(runtimeSendMessageMock.mock.calls.length).toBe(callsBeforeReopen);
  });

  it('点击刷新绕过缓存并重新获取正文', async () => {
    respondGetStatus(BILIBILI_STATUS);
    let cdnBody: unknown = { body: [{ from: 0, to: 2, content: '第一版字幕' }] };
    runtimeSendMessageMock.mockImplementation((msg: unknown, cb?: (resp: unknown) => void) => {
      const message = msg as { type?: string; url?: string };
      if (message.type !== 'FETCH_JSON') return;
      const url = message.url ?? '';
      let payload: unknown;
      if (url.includes('/x/web-interface/view')) payload = makeView();
      else if (url.includes('/x/web-interface/nav')) payload = makeNav();
      else if (url.includes('/x/player/wbi/v2')) payload = makePlayer();
      else payload = cdnBody;
      cb?.({ success: true, data: payload });
    });

    dispose = await initializeSubtitlePage();
    await vi.waitFor(() => expect(document.querySelector('#subtitle-list .subtitle-text')?.textContent).toBe('第一版字幕'));
    const callsBefore = runtimeSendMessageMock.mock.calls.length;

    cdnBody = { body: [{ from: 0, to: 3, content: '刷新后的字幕' }] };
    (document.querySelector('#action-refresh') as HTMLButtonElement).click();

    await vi.waitFor(() => expect(document.querySelector('#subtitle-list .subtitle-text')?.textContent).toBe('刷新后的字幕'));
    expect(runtimeSendMessageMock.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it('切换标签后丢弃旧标签响应并为新标签重新探测', async () => {
    const pending: Array<(status: unknown) => void> = [];
    tabsSendMessageMock.mockImplementation((_tabId, message, callback) => {
      if ((message as { type?: string }).type === 'GET_STATUS') {
        pending.push((status) => callback?.(status));
      }
    });
    respondFetchJson({ cdn: defaultCdn() });

    const initialization = initializeSubtitlePage();
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    pending[0]?.(BILIBILI_STATUS);
    dispose = await initialization;
    await vi.waitFor(() => expect(document.querySelectorAll('#subtitle-list .subtitle-row')).toHaveLength(1));
    const callsBefore = runtimeSendMessageMock.mock.calls.length;

    // 连续切换到 tab 8、tab 9：tab 8 的探测被 tab 9 作废
    dispatchTabActivated(8);
    dispatchTabActivated(9);
    pending[1]?.(BILIBILI_STATUS);
    await Promise.resolve();
    // tab 8 的迟到响应被丢弃：不发字幕请求，也不渲染
    expect(runtimeSendMessageMock.mock.calls.length).toBe(callsBefore);
    expect(document.querySelectorAll('#subtitle-list .subtitle-row')).toHaveLength(0);

    // tab 9 是不同的分 P：新身份缓存未命中，应发起一次完整请求链
    pending[2]?.({ ...BILIBILI_STATUS, url: 'https://www.bilibili.com/video/BV1xx411c7mD/?p=3' });
    await vi.waitFor(() => expect(document.querySelectorAll('#subtitle-list .subtitle-row')).toHaveLength(1));
    expect(document.querySelector('#subtitle-list .subtitle-text')?.textContent).toBe('人工中文第一句');
    expect(runtimeSendMessageMock.mock.calls.length).toBe(callsBefore + 4);
  });
});

describe('字幕页错误状态', () => {
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    mountSubtitlePage();
    tabsQueryMock.mockImplementation((_query, callback) => {
      callback?.([{ id: 7, active: true }] as chrome.tabs.Tab[]);
    });
  });

  afterEach(() => dispose?.());

  it('非 B 站视频页：字幕功能仅支持B站视频页', async () => {
    respondGetStatus({ supported: false, url: 'https://example.com/page' });
    dispose = await initializeSubtitlePage();
    await vi.waitFor(() => expect(document.querySelector('#subtitle-status')?.textContent).toBe('字幕功能仅支持B站视频页'));
  });

  it('未登录且无轨道：请登录B站后刷新字幕', async () => {
    respondGetStatus(BILIBILI_STATUS);
    respondFetchJson({
      nav: makeNav(false),
      player: { code: 0, data: { subtitle: { subtitles: [] }, view_points: [] } },
    });
    dispose = await initializeSubtitlePage();
    await vi.waitFor(() => expect(document.querySelector('#subtitle-status')?.textContent).toBe('请登录B站后刷新字幕'));
  });

  it('已登录且无轨道：该视频暂无可用字幕', async () => {
    respondGetStatus(BILIBILI_STATUS);
    respondFetchJson({
      player: { code: 0, data: { subtitle: { subtitles: [] }, view_points: [] } },
    });
    dispose = await initializeSubtitlePage();
    await vi.waitFor(() => expect(document.querySelector('#subtitle-status')?.textContent).toBe('该视频暂无可用字幕'));
  });

  it('字幕轨内容为空：该字幕轨暂无内容', async () => {
    respondGetStatus(BILIBILI_STATUS);
    respondFetchJson({ cdn: { [HUMAN_ZH_URL]: { body: [] } } });
    dispose = await initializeSubtitlePage();
    await vi.waitFor(() => expect(document.querySelector('#subtitle-status')?.textContent).toBe('该字幕轨暂无内容'));
  });

  it('网络或风控失败：字幕获取失败，请稍后刷新', async () => {
    respondGetStatus(BILIBILI_STATUS);
    respondFetchJson({ fail: true });
    dispose = await initializeSubtitlePage();
    await vi.waitFor(() => expect(document.querySelector('#subtitle-status')?.textContent).toBe('字幕获取失败，请稍后刷新'));
  });

  it('错误状态仍保留返回、刷新与设置入口', async () => {
    respondGetStatus({ supported: false, url: 'https://example.com/page' });
    dispose = await initializeSubtitlePage();
    await vi.waitFor(() => expect(document.querySelector('#subtitle-status')?.textContent).toBe('字幕功能仅支持B站视频页'));
    expect(document.querySelector('#action-back')).not.toBeNull();
    expect((document.querySelector('#action-refresh') as HTMLButtonElement).disabled).toBe(false);
    expect((document.querySelector('#action-settings') as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('字幕页安全渲染', () => {
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    mountSubtitlePage();
    tabsQueryMock.mockImplementation((_query, callback) => {
      callback?.([{ id: 7, active: true }] as chrome.tabs.Tab[]);
    });
  });

  afterEach(() => dispose?.());

  it('字幕文本只出现在 textContent，DOM 中没有新增 img', async () => {
    respondGetStatus(BILIBILI_STATUS);
    respondFetchJson({
      cdn: { [HUMAN_ZH_URL]: { body: [{ from: 0, to: 2, content: '<img src=x onerror=alert(1)>' }] } },
    });

    dispose = await initializeSubtitlePage();

    await vi.waitFor(() => expect(document.querySelectorAll('#subtitle-list .subtitle-row')).toHaveLength(1));
    expect(document.querySelector('#subtitle-list .subtitle-text')?.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(document.querySelector('#subtitle-list img')).toBeNull();
    expect(document.querySelector('#subtitle-list script')).toBeNull();
  });
});

describe('字幕页播放联动', () => {
  let dispose: (() => void) | undefined;
  const scrollIntoViewMock = Element.prototype.scrollIntoView as unknown as ReturnType<typeof vi.fn>;

  const MULTI_SEGMENT_CDN: Record<string, unknown> = {
    [HUMAN_ZH_URL]: {
      body: [
        { from: 0, to: 2, content: '第一句。' },
        { from: 30, to: 32, content: '第二句。' },
        { from: 60, to: 62, content: '第三句。' },
      ],
    },
  };

  function setVisibility(value: 'visible' | 'hidden'): void {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value });
  }

  function countPlaybackCalls(): number {
    return tabsSendMessageMock.mock.calls.filter((call) => (call[1] as { type?: string }).type === 'GET_BILIBILI_PLAYBACK_STATE').length;
  }

  function seekMessages(): Array<{ payload: { expectedIdentity: string; seconds: number } }> {
    return tabsSendMessageMock.mock.calls
      .filter((call) => (call[1] as { type?: string }).type === 'SEEK_BILIBILI_VIDEO')
      .map((call) => call[1] as { payload: { expectedIdentity: string; seconds: number } });
  }

  function activeRow(): Element | null {
    return document.querySelector('#subtitle-list .subtitle-row.active');
  }

  interface PlaybackControls {
    setTime: (value: number) => void;
    setSeekResponse: (value: unknown) => void;
  }

  function mountPlaybackPage(options: { currentTime: number; paused?: boolean }): PlaybackControls {
    let currentTime = options.currentTime;
    let paused = options.paused ?? false;
    let seekResponse: unknown = { success: true };
    tabsSendMessageMock.mockImplementation((_tabId, message, callback) => {
      const type = (message as { type?: string }).type;
      if (type === 'GET_STATUS') {
        callback?.(BILIBILI_STATUS);
        return;
      }
      if (type === 'GET_BILIBILI_PLAYBACK_STATE') {
        callback?.({ success: true, identity: 'BV1xx411c7mD:p2', currentTime, paused });
        return;
      }
      if (type === 'SEEK_BILIBILI_VIDEO') {
        callback?.(seekResponse);
        return;
      }
    });
    respondFetchJson({ cdn: MULTI_SEGMENT_CDN });
    return {
      setTime: (value) => { currentTime = value; },
      setSeekResponse: (value) => { seekResponse = value; },
    };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    setVisibility('visible');
    scrollIntoViewMock.mockClear();
    mountSubtitlePage();
    tabsQueryMock.mockImplementation((_query, callback) => {
      callback?.([{ id: 7, active: true }] as chrome.tabs.Tab[]);
    });
  });

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    vi.useRealTimers();
  });

  it('页面可见时每 500ms 读取一次播放状态', async () => {
    mountPlaybackPage({ currentTime: 1 });
    dispose = await initializeSubtitlePage();
    await vi.advanceTimersByTimeAsync(0);
    const afterStart = countPlaybackCalls();
    expect(afterStart).toBeGreaterThanOrEqual(1);

    await vi.advanceTimersByTimeAsync(500);
    expect(countPlaybackCalls()).toBe(afterStart + 1);
    await vi.advanceTimersByTimeAsync(500);
    expect(countPlaybackCalls()).toBe(afterStart + 2);
  });

  it('页面隐藏时停止读取播放状态', async () => {
    setVisibility('hidden');
    mountPlaybackPage({ currentTime: 1 });
    dispose = await initializeSubtitlePage();
    await vi.advanceTimersByTimeAsync(0);
    expect(countPlaybackCalls()).toBe(0);
    await vi.advanceTimersByTimeAsync(1500);
    expect(countPlaybackCalls()).toBe(0);
  });

  it('当前时间只切换前后两个高亮元素且不重建列表', async () => {
    const playback = mountPlaybackPage({ currentTime: 1 });
    dispose = await initializeSubtitlePage();
    await vi.advanceTimersByTimeAsync(0);

    expect(activeRow()?.getAttribute('data-start')).toBe('0');
    const activeNode = activeRow();

    playback.setTime(31);
    await vi.advanceTimersByTimeAsync(500);
    expect(activeRow()?.getAttribute('data-start')).toBe('30');
    expect(activeRow()).not.toBe(activeNode);
    // 列表未被重建：旧行元素仍然在 DOM 中
    expect(activeNode?.parentElement).toBe(document.querySelector('#subtitle-list'));

    playback.setTime(61);
    await vi.advanceTimersByTimeAsync(500);
    expect(activeRow()?.getAttribute('data-start')).toBe('60');

    // 时间落在段落间隙时不显示高亮
    playback.setTime(10);
    await vi.advanceTimersByTimeAsync(500);
    expect(activeRow()).toBeNull();
  });

  it('点击行发送 SEEK_BILIBILI_VIDEO 并携带当前身份', async () => {
    mountPlaybackPage({ currentTime: 1 });
    dispose = await initializeSubtitlePage();
    await vi.advanceTimersByTimeAsync(0);

    const row = document.querySelectorAll('#subtitle-list .subtitle-row')[1] as HTMLButtonElement;
    row.click();

    expect(seekMessages()).toEqual([
      { type: 'SEEK_BILIBILI_VIDEO', payload: { expectedIdentity: 'BV1xx411c7mD:p2', seconds: 30 } },
    ]);
    expect(document.querySelector('#subtitle-status')?.textContent).toBe('');
  });

  it('播放器未加载时点击行只显示轻量提示', async () => {
    const playback = mountPlaybackPage({ currentTime: 1 });
    dispose = await initializeSubtitlePage();
    await vi.advanceTimersByTimeAsync(0);

    playback.setSeekResponse({ success: false, error: { code: 'PLAYER_NOT_READY', message: '播放器尚未加载' } });
    const row = document.querySelectorAll('#subtitle-list .subtitle-row')[0] as HTMLButtonElement;
    row.click();
    await Promise.resolve();

    expect(document.querySelector('#subtitle-status')?.textContent).toBe('播放器尚未加载，请稍后重试');
    // 字幕列表保持可读
    expect(document.querySelectorAll('#subtitle-list .subtitle-row')).toHaveLength(3);
  });

  it('手动滚动暂停自动跟随并显示回到当前句，点击后恢复', async () => {
    const playback = mountPlaybackPage({ currentTime: 1 });
    dispose = await initializeSubtitlePage();
    await vi.advanceTimersByTimeAsync(0);
    expect(activeRow()?.getAttribute('data-start')).toBe('0');
    scrollIntoViewMock.mockClear(); // 丢弃页面打开时初次定位的调用
    const returnCurrent = document.querySelector('#return-current') as HTMLButtonElement;
    expect(returnCurrent.hidden).toBe(true);

    // 用户滚轮：暂停跟随并显示按钮
    (document.querySelector('#subtitle-list') as HTMLElement).dispatchEvent(new WheelEvent('wheel'));
    expect(returnCurrent.hidden).toBe(false);

    // 播放推进到第二句：高亮切换，但不自动滚动
    playback.setTime(31);
    await vi.advanceTimersByTimeAsync(500);
    expect(activeRow()?.getAttribute('data-start')).toBe('30');
    expect(scrollIntoViewMock).not.toHaveBeenCalled();

    // 点击「回到当前句」：滚动到当前行并恢复跟随
    returnCurrent.click();
    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
    expect(scrollIntoViewMock).toHaveBeenCalledWith({ block: 'center' });
    expect(returnCurrent.hidden).toBe(true);

    playback.setTime(61);
    await vi.advanceTimersByTimeAsync(500);
    expect(activeRow()?.getAttribute('data-start')).toBe('60');
    expect(scrollIntoViewMock).toHaveBeenCalledTimes(2);
  });

  it('触摸滚动同样暂停跟随', async () => {
    const playback = mountPlaybackPage({ currentTime: 1 });
    dispose = await initializeSubtitlePage();
    await vi.advanceTimersByTimeAsync(0);
    scrollIntoViewMock.mockClear(); // 丢弃页面打开时初次定位的调用
    const returnCurrent = document.querySelector('#return-current') as HTMLButtonElement;

    (document.querySelector('#subtitle-list') as HTMLElement).dispatchEvent(new Event('touchmove'));
    expect(returnCurrent.hidden).toBe(false);

    playback.setTime(31);
    await vi.advanceTimersByTimeAsync(500);
    expect(activeRow()?.getAttribute('data-start')).toBe('30');
    expect(scrollIntoViewMock).not.toHaveBeenCalled();
  });
});

// ---- AI 简中翻译兜底 ----

const EN_URL = 'https://subtitle.hdslb.com/ai-en.json';
const JP_URL = 'https://subtitle.hdslb.com/ai-jp.json';
const VIRTUAL_ID = 'clip2md-ai-zh:ai-en';
const ENGLISH_BODY = 'You may have noticed that everyone uses AI in similar ways.';
const TRANSLATED_BODY = '你有没有发现，现在大家使用 AI 的方式都差不多？';

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

const ENGLISH_JAPANESE_CDN: Record<string, unknown> = {
  [EN_URL]: { body: [{ from: 0, to: 4, content: ENGLISH_BODY }] },
  [JP_URL]: { body: [{ from: 0, to: 4, content: '日本語の字幕。' }] },
};

function respondEnglishJapanese(translate?: unknown): void {
  respondFetchJson({
    player: makeEnglishJapanesePlayer(),
    cdn: ENGLISH_JAPANESE_CDN,
    ...(translate !== undefined ? { translate } : {}),
  });
}

function translationCalls(): number {
  return runtimeSendMessageMock.mock.calls.filter(
    (call) => (call[0] as { type?: string }).type === 'TRANSLATE_BILIBILI_SUBTITLES',
  ).length;
}

function trackSelect(): HTMLSelectElement {
  return document.querySelector('#subtitle-track') as HTMLSelectElement;
}

describe('字幕页 AI 简中翻译', () => {
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    mountSubtitlePage();
    tabsQueryMock.mockImplementation((_query, callback) => {
      callback?.([{ id: 7, active: true }] as chrome.tabs.Tab[]);
    });
  });

  afterEach(() => dispose?.());

  it('无官方中文但有英文时默认显示简体中文 AI 翻译', async () => {
    respondGetStatus(BILIBILI_STATUS);
    respondEnglishJapanese();

    dispose = await initializeSubtitlePage();

    await vi.waitFor(() => {
      expect(trackSelect().value).toBe('clip2md-ai-zh:ai-en');
    });
    expect([...trackSelect().options].map((item) => item.textContent))
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

  it('存在官方中文时不出现虚拟轨且零翻译请求', async () => {
    respondGetStatus(BILIBILI_STATUS);
    respondFetchJson({ cdn: defaultCdn() });

    dispose = await initializeSubtitlePage();

    await vi.waitFor(() => expect(trackSelect().value).toBe('human-zh'));
    expect([...trackSelect().options].map((item) => item.textContent)).not.toContain('简体中文（AI 翻译）');
    expect(translationCalls()).toBe(0);
  });

  it('自动翻译后手动选英文恢复官方正文并把偏好写入 ui.v2', async () => {
    respondGetStatus(BILIBILI_STATUS);
    respondEnglishJapanese();

    dispose = await initializeSubtitlePage();
    await vi.waitFor(() => expect(trackSelect().value).toBe(VIRTUAL_ID));

    trackSelect().value = 'ai-en';
    trackSelect().dispatchEvent(new Event('change'));

    await vi.waitFor(() => {
      expect(document.querySelector('#subtitle-list .subtitle-text')?.textContent).toBe(ENGLISH_BODY);
    });
    expect(mockSessionStorage['clip2md.bilibiliSubtitle.ui.v2.BV1xx411c7mD:p2'])
      .toMatchObject({ preferredTrackId: 'ai-en' });
  });

  it('重新打开恢复手动英文偏好且不自动翻译', async () => {
    respondGetStatus(BILIBILI_STATUS);
    respondEnglishJapanese();

    dispose = await initializeSubtitlePage();
    await vi.waitFor(() => expect(trackSelect().value).toBe(VIRTUAL_ID));
    trackSelect().value = 'ai-en';
    trackSelect().dispatchEvent(new Event('change'));
    await vi.waitFor(() => {
      expect(document.querySelector('#subtitle-list .subtitle-text')?.textContent).toBe(ENGLISH_BODY);
    });
    const callsBeforeReopen = translationCalls();

    const firstDispose = dispose;
    dispose = await initializeSubtitlePage();
    firstDispose?.();

    await vi.waitFor(() => expect(trackSelect().value).toBe('ai-en'));
    expect(document.querySelector('#subtitle-list .subtitle-text')?.textContent).toBe(ENGLISH_BODY);
    expect(translationCalls()).toBe(callsBeforeReopen);
  });

  it('手动选回虚拟简中命中翻译缓存', async () => {
    respondGetStatus(BILIBILI_STATUS);
    respondEnglishJapanese();

    dispose = await initializeSubtitlePage();
    await vi.waitFor(() => expect(trackSelect().value).toBe(VIRTUAL_ID));
    trackSelect().value = 'ai-en';
    trackSelect().dispatchEvent(new Event('change'));
    await vi.waitFor(() => {
      expect(document.querySelector('#subtitle-list .subtitle-text')?.textContent).toBe(ENGLISH_BODY);
    });

    trackSelect().value = VIRTUAL_ID;
    trackSelect().dispatchEvent(new Event('change'));

    await vi.waitFor(() => {
      expect(document.querySelector('#subtitle-list .subtitle-text')?.textContent).toContain('你有没有发现');
    });
    expect(trackSelect().value).toBe(VIRTUAL_ID);
    expect(translationCalls()).toBe(1);
  });

  it('ui.v1 的旧轨道选择被忽略，不阻止自动简中默认', async () => {
    mockSessionStorage['clip2md.bilibiliSubtitle.ui.v1.BV1xx411c7mD:p2'] = { trackId: 'ai-en', scrollTop: 0 };
    respondGetStatus(BILIBILI_STATUS);
    respondEnglishJapanese();

    dispose = await initializeSubtitlePage();

    await vi.waitFor(() => expect(trackSelect().value).toBe(VIRTUAL_ID));
    expect(translationCalls()).toBe(1);
  });

  it('同一会话第二次进入命中翻译缓存，翻译消息不增加', async () => {
    respondGetStatus(BILIBILI_STATUS);
    respondEnglishJapanese();

    dispose = await initializeSubtitlePage();
    await vi.waitFor(() => expect(trackSelect().value).toBe(VIRTUAL_ID));
    expect(translationCalls()).toBe(1);

    const firstDispose = dispose;
    dispose = await initializeSubtitlePage();
    firstDispose?.();

    await vi.waitFor(() => expect(trackSelect().value).toBe(VIRTUAL_ID));
    expect(document.querySelector('#subtitle-list .subtitle-text')?.textContent).toContain('你有没有发现');
    expect(translationCalls()).toBe(1);
  });

  it('翻译缓存使用固定会话键并记录源轨 ID 与译文行', async () => {
    respondGetStatus(BILIBILI_STATUS);
    respondEnglishJapanese();

    dispose = await initializeSubtitlePage();
    await vi.waitFor(() => expect(trackSelect().value).toBe(VIRTUAL_ID));

    const key = 'clip2md.bilibiliSubtitle.translation.v1.BV1xx411c7mD:p2:ai-en';
    expect(Object.keys(mockSessionStorage)).toContain(key);
    expect(mockSessionStorage[key]).toMatchObject({
      sourceTrackId: 'ai-en',
      lines: [{ from: 0, to: 4, content: TRANSLATED_BODY }],
    });
  });

  it('点击刷新绕过官方缓存与翻译缓存并替换正文', async () => {
    respondGetStatus(BILIBILI_STATUS);
    const cdn: Record<string, unknown> = {
      [EN_URL]: { body: [{ from: 0, to: 4, content: ENGLISH_BODY }] },
      [JP_URL]: { body: [{ from: 0, to: 4, content: '日本語の字幕。' }] },
    };
    let translate: unknown = { success: true, lines: [{ from: 0, to: 4, content: TRANSLATED_BODY }] };
    runtimeSendMessageMock.mockImplementation((msg: unknown, cb?: (resp: unknown) => void) => {
      const message = msg as { type?: string; url?: string };
      if (message.type === 'TRANSLATE_BILIBILI_SUBTITLES') {
        cb?.(translate);
        return;
      }
      if (message.type !== 'FETCH_JSON') return;
      const url = message.url ?? '';
      let payload: unknown;
      if (url.includes('/x/web-interface/view')) payload = makeView();
      else if (url.includes('/x/web-interface/nav')) payload = makeNav();
      else if (url.includes('/x/player/wbi/v2')) payload = makeEnglishJapanesePlayer();
      else payload = cdn[url];
      cb?.({ success: true, data: payload });
    });

    dispose = await initializeSubtitlePage();
    await vi.waitFor(() => expect(trackSelect().value).toBe(VIRTUAL_ID));
    const officialCallsBefore = runtimeSendMessageMock.mock.calls.length;
    const translateCallsBefore = translationCalls();

    cdn[EN_URL] = { body: [{ from: 0, to: 4, content: 'Updated English line.' }] };
    translate = { success: true, lines: [{ from: 0, to: 4, content: '刷新后的简中正文' }] };
    (document.querySelector('#action-refresh') as HTMLButtonElement).click();

    await vi.waitFor(() => {
      expect(document.querySelector('#subtitle-list .subtitle-text')?.textContent).toBe('刷新后的简中正文');
    });
    expect(trackSelect().value).toBe(VIRTUAL_ID);
    expect(runtimeSendMessageMock.mock.calls.length).toBeGreaterThan(officialCallsBefore);
    expect(translationCalls()).toBe(translateCallsBefore + 1);
  });

  it('切换标签后旧视频迟到的翻译响应被 generation 丢弃', async () => {
    const statusPending: Array<(status: unknown) => void> = [];
    const translatePending: Array<(resp: unknown) => void> = [];
    tabsSendMessageMock.mockImplementation((_tabId, message, callback) => {
      if ((message as { type?: string }).type === 'GET_STATUS') {
        statusPending.push((status) => callback?.(status));
      }
    });
    runtimeSendMessageMock.mockImplementation((msg: unknown, cb?: (resp: unknown) => void) => {
      const message = msg as { type?: string; url?: string };
      if (message.type === 'TRANSLATE_BILIBILI_SUBTITLES') {
        translatePending.push((resp) => cb?.(resp));
        return;
      }
      if (message.type !== 'FETCH_JSON') return;
      const url = message.url ?? '';
      let payload: unknown;
      if (url.includes('/x/web-interface/view')) payload = makeView();
      else if (url.includes('/x/web-interface/nav')) payload = makeNav();
      else if (url.includes('/x/player/wbi/v2')) payload = makeEnglishJapanesePlayer();
      else payload = ENGLISH_JAPANESE_CDN[url];
      cb?.({ success: true, data: payload });
    });

    const initialization = initializeSubtitlePage();
    await vi.waitFor(() => expect(statusPending).toHaveLength(1));
    statusPending[0]?.(BILIBILI_STATUS);
    await vi.waitFor(() => expect(translatePending).toHaveLength(1));

    dispatchTabActivated(9);
    await vi.waitFor(() => expect(statusPending).toHaveLength(2));
    statusPending[1]?.({ ...BILIBILI_STATUS, url: 'https://www.bilibili.com/video/BV1xx411c7mD/?p=3' });
    await vi.waitFor(() => expect(translatePending).toHaveLength(2));

    // 旧视频（tab 7 / p2）的迟到翻译响应：必须被丢弃，不得渲染或写入缓存
    translatePending[0]?.({ success: true, lines: [{ from: 0, to: 4, content: '旧视频的迟到翻译' }] });
    dispose = await initialization;
    expect(Object.keys(mockSessionStorage).some((key) => key.includes('translation.v1.BV1xx411c7mD:p2')))
      .toBe(false);

    // 当前视频（tab 9 / p3）的翻译正常渲染
    translatePending[1]?.({ success: true, lines: [{ from: 0, to: 4, content: '当前视频的翻译' }] });
    await vi.waitFor(() => {
      expect(document.querySelector('#subtitle-list .subtitle-text')?.textContent).toBe('当前视频的翻译');
    });
    expect(trackSelect().value).toBe(VIRTUAL_ID);
    expect(translationCalls()).toBe(2);
  });
});

describe('字幕页翻译失败与并发', () => {
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    mountSubtitlePage();
    tabsQueryMock.mockImplementation((_query, callback) => {
      callback?.([{ id: 7, active: true }] as chrome.tabs.Tab[]);
    });
  });

  afterEach(() => dispose?.());

  const ERROR_COPY: Array<[string, string]> = [
    ['AI_TRANSLATION_DISABLED', '该视频没有简体中文字幕；请在设置中开启B站字幕自动翻译'],
    ['AI_NOT_CONFIGURED', '字幕翻译需要先配置并启用AI服务'],
    ['AI_HOST_NOT_GRANTED', 'AI接口尚未授权，请在设置中授权并测试'],
    ['AI_AUTH_FAILED', 'AI服务认证失败，请检查API Key'],
    ['AI_ENDPOINT_OR_MODEL_NOT_FOUND', 'AI接口或模型不存在，请检查设置'],
    ['AI_RATE_LIMITED', 'AI字幕翻译请求过于频繁或额度不足'],
    ['AI_PROVIDER_ERROR', 'AI字幕翻译服务暂时不可用'],
    ['AI_TIMEOUT', 'AI字幕翻译超时，请稍后刷新'],
    ['AI_NETWORK_ERROR', '无法连接AI字幕翻译服务'],
    ['AI_INVALID_RESPONSE', 'AI返回的字幕翻译格式无效，请刷新重试'],
  ];

  it.each(ERROR_COPY)('翻译失败 %s 显示精确文案并保留官方英文', async (code, copy) => {
    respondGetStatus(BILIBILI_STATUS);
    respondEnglishJapanese({ success: false, code, error: `provider detail sk-secret-${code}` });

    dispose = await initializeSubtitlePage();

    await vi.waitFor(() => expect(document.querySelector('#subtitle-status')?.textContent).toBe(copy));
    // 原始 English 正文仍被渲染
    expect(document.querySelector('#subtitle-list .subtitle-text')?.textContent).toBe(ENGLISH_BODY);
    // 下拉框仍可操作，只含官方轨，不冒充简中
    const select = trackSelect();
    expect(select.disabled).toBe(false);
    expect(select.value).toBe('ai-en');
    expect([...select.options].map((item) => item.textContent)).toEqual(['English（AI）', '日本語（AI）']);
    // 设置和刷新按钮仍存在
    expect(document.querySelector('#action-settings')).not.toBeNull();
    expect((document.querySelector('#action-refresh') as HTMLButtonElement).disabled).toBe(false);
    // 不得把 sk- 或 provider 原始响应写进 DOM
    expect(document.body.textContent).not.toContain('sk-secret');
    expect(document.body.textContent).not.toContain('provider detail');
  });

  function respondEnglishJapaneseManual(): Array<(resp: unknown) => void> {
    const translatePending: Array<(resp: unknown) => void> = [];
    runtimeSendMessageMock.mockImplementation((msg: unknown, cb?: (resp: unknown) => void) => {
      const message = msg as { type?: string; url?: string };
      if (message.type === 'TRANSLATE_BILIBILI_SUBTITLES') {
        translatePending.push((resp) => cb?.(resp));
        return;
      }
      if (message.type !== 'FETCH_JSON') return;
      const url = message.url ?? '';
      let payload: unknown;
      if (url.includes('/x/web-interface/view')) payload = makeView();
      else if (url.includes('/x/web-interface/nav')) payload = makeNav();
      else if (url.includes('/x/player/wbi/v2')) payload = makeEnglishJapanesePlayer();
      else payload = ENGLISH_JAPANESE_CDN[url];
      cb?.({ success: true, data: payload });
    });
    return translatePending;
  }

  it('翻译期间 dispose，迟到的翻译响应不再渲染', async () => {
    respondGetStatus(BILIBILI_STATUS);
    const translatePending = respondEnglishJapaneseManual();

    const initialization = initializeSubtitlePage();
    await vi.waitFor(() => expect(translatePending).toHaveLength(1));
    translatePending[0]?.({ success: true, lines: [{ from: 0, to: 4, content: TRANSLATED_BODY }] });
    dispose = await initialization;
    await vi.waitFor(() => expect(trackSelect().value).toBe(VIRTUAL_ID));

    // 触发第二次翻译（刷新），在响应返回前销毁页面
    (document.querySelector('#action-refresh') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(translatePending).toHaveLength(2));
    const disposeFn = dispose;
    dispose = undefined;
    disposeFn?.();

    translatePending[1]?.({ success: true, lines: [{ from: 0, to: 4, content: 'dispose 后的迟到翻译' }] });
    await Promise.resolve();
    expect(document.body.textContent).not.toContain('dispose 后的迟到翻译');
  });

  it('快速连续刷新：只有当前 generation 的翻译被渲染和缓存', async () => {
    respondGetStatus(BILIBILI_STATUS);
    const translatePending = respondEnglishJapaneseManual();

    const initialization = initializeSubtitlePage();
    await vi.waitFor(() => expect(translatePending).toHaveLength(1));
    translatePending[0]?.({ success: true, lines: [{ from: 0, to: 4, content: TRANSLATED_BODY }] });
    dispose = await initialization;
    await vi.waitFor(() => expect(trackSelect().value).toBe(VIRTUAL_ID));
    expect(translationCalls()).toBe(1);

    (document.querySelector('#action-refresh') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(translatePending).toHaveLength(2));
    (document.querySelector('#action-refresh') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(translatePending).toHaveLength(3));

    // 旧 generation 的响应被丢弃：不渲染、不写缓存
    translatePending[1]?.({ success: true, lines: [{ from: 0, to: 4, content: '过期的刷新翻译' }] });
    await Promise.resolve();
    expect(document.body.textContent).not.toContain('过期的刷新翻译');

    translatePending[2]?.({ success: true, lines: [{ from: 0, to: 4, content: '最新刷新的翻译' }] });
    await vi.waitFor(() => {
      expect(document.querySelector('#subtitle-list .subtitle-text')?.textContent).toBe('最新刷新的翻译');
    });
    expect(trackSelect().value).toBe(VIRTUAL_ID);
    expect(mockSessionStorage['clip2md.bilibiliSubtitle.translation.v1.BV1xx411c7mD:p2:ai-en'])
      .toMatchObject({ lines: [{ content: '最新刷新的翻译' }] });
  });
});
