import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeSidePanel } from '../src/sidepanel/sidepanel';
import type { VisualAnalysisState, VisualSummaryV2 } from '../src/analysis/types';
import {
  chromeCalls,
  dispatchStorageChange,
  dispatchTabActivated,
  mockSessionStorage,
  openOptionsPageMock,
  runtimeSendMessageMock,
  sessionGetMock,
  setRuntimeLastError,
  tabsCreateMock,
  tabsQueryMock,
  tabsSendMessageMock,
} from './setup';

type DoneState = Omit<VisualAnalysisState, 'status' | 'result'> & {
  status: 'done';
  result: VisualSummaryV2;
};

function mountPanel(): void {
  document.body.innerHTML = `
    <main class="shell">
      <header class="brand-bar">
        <div class="brand-lockup"><span class="brand-name">Clip to Markdown</span></div>
        <div class="brand-actions">
          <a id="action-subtitles" href="subtitle.html" hidden>字幕</a>
          <button id="action-settings" type="button" aria-label="打开设置"></button>
        </div>
      </header>
      <section id="status-card" aria-live="polite">
        <p id="status-label"></p>
        <p id="status-copy"></p>
        <div id="status-actions" hidden><button id="status-action" type="button"></button></div>
      </section>
      <article id="preview" hidden>
        <div class="source-header">
          <h1 id="preview-title"></h1>
          <p id="preview-author"></p>
          <p id="preview-handle"></p>
          <span id="preview-platform"></span>
        </div>
        <section><div id="summary-lines"></div></section>
        <section><div id="keypoints"></div></section>
        <section><div id="structure"></div></section>
        <div class="result-actions">
          <button id="action-open-source" type="button">查看原文</button>
          <button id="action-regenerate" type="button">重新生成</button>
          <button id="action-save" type="button">保存 Markdown</button>
        </div>
        <p id="navigation-status" role="status" aria-live="polite"></p>
        <p id="save-status" role="status" aria-live="polite"></p>
      </article>
    </main>`;
}

function doneState(title: string, summary: [string, string] = ['正文预览', '第二句总结']): DoneState {
  return {
    status: 'done',
    tabId: 7,
    requestId: 'req-1',
    updatedAt: 1,
    source: {
      url: 'https://x.com/alice/status/123',
      title,
      author: { name: 'Alice', handle: 'alice' },
      platform: 'x',
      contentType: 'tweet',
    },
    result: {
      schemaVersion: 2,
      summary,
      keyPoints: [
        { title: '观点一', description: '说明一' },
        { title: '观点二', description: '说明二' },
      ],
      structure: [
        { title: '可定位章节', sourceBlockId: 'B001', sourceQuote: '原文片段' },
        { title: '静态章节' },
      ],
    },
  };
}

describe('Side Panel V2 result rendering', () => {
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    mountPanel();
    tabsQueryMock.mockImplementation((_query, callback) => {
      callback?.([{ id: 7, active: true }] as chrome.tabs.Tab[]);
    });
  });

  afterEach(() => dispose?.());

  it('reads the current tab state and renders the fixed information order', async () => {
    mockSessionStorage['clip2md.visualSummary.state.7'] = doneState('当前推文');

    dispose = await initializeSidePanel();

    expect(document.querySelector('#status-label')?.textContent).toBe('内容已分析');
    expect(document.querySelector('#preview-title')?.textContent).toBe('当前推文');
    expect(document.querySelector('#preview-author')?.textContent).toBe('Alice');
    expect(document.querySelector('#preview-handle')?.textContent).toBe('@alice');
    expect(document.querySelector('#preview-platform')?.textContent).toBe('X / Twitter');
    expect([...document.querySelectorAll('.summary-line')].map((el) => el.textContent)).toEqual([
      '正文预览',
      '第二句总结',
    ]);
    expect(document.querySelector('#preview')?.hasAttribute('hidden')).toBe(false);
  });

  it('renders key points and keeps unanchored Tweet structure items static', async () => {
    mockSessionStorage['clip2md.visualSummary.state.7'] = doneState('当前推文');

    dispose = await initializeSidePanel();

    expect([...document.querySelectorAll('.keypoint-title')].map((el) => el.textContent)).toEqual(['观点一', '观点二']);
    expect([...document.querySelectorAll('.keypoint-desc')].map((el) => el.textContent)).toEqual(['说明一', '说明二']);
    expect(document.querySelectorAll('#structure button.structure-item')).toHaveLength(1);
    expect(document.querySelectorAll('#structure span.structure-item')).toHaveLength(1);
    expect(document.querySelectorAll('#structure .structure-index')[0]?.textContent).toBe('01');
  });

  it('renders all AI and Quote content as text', async () => {
    const state = doneState('<img src=x onerror=alert(1)>', ['<strong>摘要一</strong>', '<script>alert(1)</script>']);
    state.result.keyPoints[0] = { title: '<b>标题</b>', description: '<i>说明</i>' };
    state.result.structure[0] = { title: '<img src=x>', sourceBlockId: 'B001', sourceQuote: '<svg>' };
    mockSessionStorage['clip2md.visualSummary.state.7'] = state;

    dispose = await initializeSidePanel();

    expect(document.querySelector('#preview img')).toBeNull();
    expect(document.querySelector('#preview strong')).toBeNull();
    expect(document.querySelector('#preview script')).toBeNull();
    expect(document.querySelector('.summary-line')?.textContent).toBe('<strong>摘要一</strong>');
    expect(document.querySelector('.structure-title')?.textContent).toBe('<img src=x>');
  });

  it('opens the canonical source URL in a new active tab', async () => {
    mockSessionStorage['clip2md.visualSummary.state.7'] = doneState('当前推文');
    dispose = await initializeSidePanel();

    (document.querySelector('#action-open-source') as HTMLButtonElement).click();

    expect(tabsCreateMock).toHaveBeenCalledWith(
      { url: 'https://x.com/alice/status/123', active: true },
      expect.any(Function),
    );
    expect(chromeCalls.tabsCreated).toEqual([{ url: 'https://x.com/alice/status/123' }]);
  });

  it('navigates to an anchored structure item through the content script', async () => {
    mockSessionStorage['clip2md.visualSummary.state.7'] = doneState('当前文章');
    tabsSendMessageMock.mockImplementation((_tabId, _message, callback) => callback?.({ success: true }));
    dispose = await initializeSidePanel();

    (document.querySelector('button.structure-item') as HTMLButtonElement).click();

    expect(tabsSendMessageMock).toHaveBeenCalledWith(
      7,
      {
        type: 'NAVIGATE_TO_SOURCE',
        payload: {
          expectedSourceUrl: 'https://x.com/alice/status/123',
          sourceBlockId: 'B001',
          sourceQuote: '原文片段',
        },
      },
      expect.any(Function),
    );
    expect(document.querySelector('#navigation-status')?.textContent).toContain('已定位');
  });

  it('maps callback runtime.lastError and Promise rejection to navigation status', async () => {
    mockSessionStorage['clip2md.visualSummary.state.7'] = doneState('当前文章');
    tabsSendMessageMock.mockImplementation((_tabId, _message, callback) => {
      setRuntimeLastError('Receiving end does not exist.');
      callback?.(undefined);
    });
    dispose = await initializeSidePanel();
    (document.querySelector('button.structure-item') as HTMLButtonElement).click();
    expect(document.querySelector('#navigation-status')?.textContent).toContain('无法定位');

    tabsSendMessageMock.mockImplementation(() => Promise.reject(new Error('channel closed')) as unknown as void);
    (document.querySelector('button.structure-item') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(document.querySelector('#navigation-status')?.textContent).toContain('无法定位'));
  });

  it('keeps navigation and save feedback in independent live regions', async () => {
    mockSessionStorage['clip2md.visualSummary.state.7'] = doneState('当前推文');
    runtimeSendMessageMock.mockImplementation((msg: unknown, cb?: (resp: unknown) => void) => {
      if ((msg as { type?: string }).type === 'SAVE_CURRENT_TAB') cb?.({ success: true, filename: 'notes/a.md' });
    });
    dispose = await initializeSidePanel();
    (document.querySelector('#action-save') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(document.querySelector('#save-status')?.textContent).toContain('已保存'));
    expect(document.querySelector('#navigation-status')?.textContent).toBe('');
    expect(document.querySelector('#navigation-status')?.getAttribute('aria-live')).toBe('polite');
    expect(document.querySelector('#save-status')?.getAttribute('aria-live')).toBe('polite');
  });

  it('ignores stale navigation and save callbacks after switching tabs', async () => {
    mockSessionStorage['clip2md.visualSummary.state.7'] = doneState('标签页 7');
    mockSessionStorage['clip2md.visualSummary.state.8'] = { ...doneState('标签页 8'), tabId: 8 };
    let finishNavigation: ((response: unknown) => void) | undefined;
    let finishSave: ((response: unknown) => void) | undefined;
    tabsSendMessageMock.mockImplementation((_tabId, _message, callback) => { finishNavigation = callback; });
    runtimeSendMessageMock.mockImplementation((msg: unknown, callback?: (response: unknown) => void) => {
      if ((msg as { type?: string }).type === 'SAVE_CURRENT_TAB') finishSave = callback;
    });
    dispose = await initializeSidePanel();

    (document.querySelector('button.structure-item') as HTMLButtonElement).click();
    (document.querySelector('#action-save') as HTMLButtonElement).click();
    dispatchTabActivated(8);
    finishNavigation?.({ success: true });
    finishSave?.({ success: true, filename: 'notes/stale.md' });

    expect(document.querySelector('#navigation-status')?.textContent).toBe('');
    expect(document.querySelector('#save-status')?.textContent).toBe('');
    expect((document.querySelector('#action-save') as HTMLButtonElement).disabled).toBe(false);
  });

  it('opens settings from the gear and regenerates from the result action', async () => {
    mockSessionStorage['clip2md.visualSummary.state.7'] = doneState('当前推文');
    dispose = await initializeSidePanel();
    (document.querySelector('#action-settings') as HTMLButtonElement).click();
    expect(openOptionsPageMock).toHaveBeenCalledTimes(1);
    (document.querySelector('#action-regenerate') as HTMLButtonElement).click();
    expect(runtimeSendMessageMock).toHaveBeenCalledWith({
      type: 'START_VISUAL_ANALYSIS',
      payload: { tabId: 7, force: true },
    });
  });

  it('does not render a legacy v1 done state', async () => {
    mockSessionStorage['clip2md.visualSummary.state.7'] = {
      ...doneState('旧结果'),
      result: {
        schemaVersion: 1,
        articleType: 'opinion',
        confidence: 0.9,
        classificationReason: '旧格式',
        summary: '旧正文',
        keyPoints: [],
        structure: { label: '旧结构' },
        takeaways: ['旧结论'],
      },
    } as unknown as DoneState;
    dispose = await initializeSidePanel();
    expect(document.querySelector('#status-label')?.textContent).toBe('结果版本已更新');
    expect(document.querySelector('#preview')?.hasAttribute('hidden')).toBe(true);
    expect(document.querySelector('#status-action')?.textContent).toBe('重新生成');
  });

  it('shows actionable errors and clears stale preview content', async () => {
    mockSessionStorage['clip2md.visualSummary.state.7'] = doneState('旧页面');
    dispose = await initializeSidePanel();
    dispatchStorageChange({
      'clip2md.visualSummary.state.7': {
        newValue: {
          status: 'error',
          tabId: 7,
          requestId: 'req-error',
          updatedAt: 2,
          error: { code: 'UNSUPPORTED_VISUAL_PLATFORM', message: '当前版本仅支持 X 推文和 X Article。' },
        },
      },
    });
    expect(document.querySelector('#status-label')?.textContent).toBe('暂时无法生成一图速览');
    expect(document.querySelector('#preview')?.hasAttribute('hidden')).toBe(true);
    expect(document.querySelector('#status-copy')?.textContent).toContain('X 推文');
  });

  it('switches to the activated tab and reads only that tab state', async () => {
    mockSessionStorage['clip2md.visualSummary.state.7'] = doneState('标签页 7', ['正文 7', '第二句']);
    mockSessionStorage['clip2md.visualSummary.state.8'] = { ...doneState('标签页 8', ['正文 8', '第二句']), tabId: 8 };
    dispose = await initializeSidePanel();
    dispatchTabActivated(8);
    await vi.waitFor(() => expect(document.querySelector('#preview-title')?.textContent).toBe('标签页 8'));
  });

  it('does not miss a session update while the initial state read is pending', async () => {
    let finishInitialRead: ((items: Record<string, unknown>) => void) | undefined;
    sessionGetMock.mockImplementationOnce((_keys, callback) => { finishInitialRead = callback; });
    const initialization = initializeSidePanel();
    await vi.waitFor(() => expect(finishInitialRead).toBeTypeOf('function'));
    const completed = doneState('最新页面', ['最新正文', '第二句']);
    dispatchStorageChange({ 'clip2md.visualSummary.state.7': { newValue: completed } });
    finishInitialRead?.({ 'clip2md.visualSummary.state.7': { status: 'extracting', tabId: 7, updatedAt: 1 } });
    dispose = await initialization;
    expect(document.querySelector('#preview-title')?.textContent).toBe('最新页面');
  });
});

describe('B站字幕入口', () => {
  let dispose: (() => void) | undefined;
  const link = (): HTMLAnchorElement => document.querySelector('#action-subtitles') as HTMLAnchorElement;

  function respondGetStatus(status: unknown): void {
    tabsSendMessageMock.mockImplementation((_tabId, message, callback) => {
      if ((message as { type?: string }).type === 'GET_STATUS') callback?.(status);
    });
  }

  beforeEach(() => {
    mountPanel();
    tabsQueryMock.mockImplementation((_query, callback) => {
      callback?.([{ id: 7, active: true }] as chrome.tabs.Tab[]);
    });
  });

  afterEach(() => dispose?.());

  it('入口默认隐藏且指向独立字幕页', async () => {
    respondGetStatus({ supported: true, platform: 'bilibili', contentType: 'bilibili-video', url: 'https://www.bilibili.com/video/BV1xx411c7mD/' });
    dispose = await initializeSidePanel();
    expect(link().getAttribute('href')).toBe('subtitle.html');
    await vi.waitFor(() => expect(link().hidden).toBe(false));
  });

  it('非 B 站页面字幕入口保持隐藏', async () => {
    respondGetStatus({ supported: true, platform: 'x', contentType: 'tweet', url: 'https://x.com/alice/status/123' });
    dispose = await initializeSidePanel();
    await vi.waitFor(() => expect(tabsSendMessageMock).toHaveBeenCalled());
    expect(link().hidden).toBe(true);
  });

  it('GET_STATUS 无响应时字幕入口保持隐藏', async () => {
    // 不配置 responder：默认 tabs.sendMessage 走「Receiving end does not exist」路径
    dispose = await initializeSidePanel();
    await vi.waitFor(() => expect(tabsSendMessageMock).toHaveBeenCalled());
    expect(link().hidden).toBe(true);
  });

  it('切换标签后入口先隐藏，旧标签迟到响应不得复活', async () => {
    const pending: Array<(status: unknown) => void> = [];
    tabsSendMessageMock.mockImplementation((_tabId, message, callback) => {
      if ((message as { type?: string }).type === 'GET_STATUS') {
        pending.push((status) => callback?.(status));
      }
    });
    const bilibili = { supported: true, platform: 'bilibili', contentType: 'bilibili-video', url: 'https://www.bilibili.com/video/BV1xx411c7mD/' };
    const tweet = { supported: true, platform: 'x', contentType: 'tweet', url: 'https://x.com/alice/status/1' };

    dispose = await initializeSidePanel();
    expect(pending).toHaveLength(1);
    pending[0]?.(bilibili);
    await vi.waitFor(() => expect(link().hidden).toBe(false));

    dispatchTabActivated(8);
    expect(link().hidden).toBe(true);
    pending[1]?.(tweet);
    await vi.waitFor(() => expect(tabsSendMessageMock).toHaveBeenCalledTimes(2));
    pending[0]?.(bilibili);
    await Promise.resolve();
    expect(link().hidden).toBe(true);
  });
});
