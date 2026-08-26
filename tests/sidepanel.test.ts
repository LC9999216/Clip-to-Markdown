import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeSidePanel } from '../src/sidepanel/sidepanel';
import type { VisualAnalysisState, VisualSummary } from '../src/analysis/types';

type DoneState = Omit<VisualAnalysisState, 'status' | 'result'> & {
  status: 'done';
  result: VisualSummary;
};
import {
  dispatchStorageChange,
  dispatchTabActivated,
  mockSessionStorage,
  openOptionsPageMock,
  runtimeSendMessageMock,
  sessionGetMock,
  tabsQueryMock,
} from './setup';

function mountPanel(): void {
  document.body.innerHTML = `
    <main>
      <p id="status-label"></p>
      <p id="status-copy"></p>
      <div id="status-actions" hidden>
        <button id="status-action" type="button"></button>
      </div>
      <section id="preview" hidden>
        <div class="preview-meta">
          <span id="preview-type"></span>
          <span id="preview-confidence"></span>
          <a id="preview-link"></a>
        </div>
        <h1 id="preview-title"></h1>
        <p id="preview-author"></p>
        <p id="preview-body"></p>
        <ul id="keypoints"></ul>
        <div id="structure"></div>
        <ul id="takeaways"></ul>
        <button id="action-regenerate" type="button">重新生成</button>
        <button id="action-settings" type="button">AI 设置</button>
      </section>
    </main>`;
}

function doneState(title: string, summary: string): DoneState {
  return {
    status: 'done',
    tabId: 7,
    requestId: 'req-1',
    updatedAt: 1,
    source: {
      url: 'https://x.com/alice/status/123',
      title,
      author: 'Alice (@alice)',
    },
    result: {
      schemaVersion: 1,
      articleType: 'opinion',
      confidence: 0.92,
      classificationReason: '判断理由',
      summary,
      keyPoints: [
        { title: '观点一', description: '说明一' },
        { title: '观点二', description: '说明二' },
      ],
      structure: { label: '核心主题', children: [{ label: '子主题' }] },
      takeaways: ['值得记住的结论'],
    },
  };
}

describe('Side Panel phase 6 result rendering', () => {
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    mountPanel();
    tabsQueryMock.mockImplementation((_query, callback) => {
      callback?.([{ id: 7, active: true }] as chrome.tabs.Tab[]);
    });
  });

  afterEach(() => dispose?.());

  it('reads the current tab state from session storage on initialization', async () => {
    mockSessionStorage['clip2md.visualSummary.state.7'] = doneState('当前推文', '正文预览');

    dispose = await initializeSidePanel();

    expect(document.querySelector('#status-label')?.textContent).toBe('内容已分析');
    expect(document.querySelector('#preview-title')?.textContent).toBe('当前推文');
    expect(document.querySelector('#preview-author')?.textContent).toBe('Alice (@alice)');
    expect(document.querySelector('#preview-body')?.textContent).toBe('正文预览');
  });

  it('renders article type, confidence, key points, structure tree, and takeaways', async () => {
    mockSessionStorage['clip2md.visualSummary.state.7'] = doneState('当前推文', '一句话总结');

    dispose = await initializeSidePanel();

    expect(document.querySelector('#preview-type')?.textContent).toBe('观点');
    expect(document.querySelector('#preview-confidence')?.textContent).toBe('92%');
    expect(
      [...document.querySelectorAll('.keypoint-title')].map((el) => el.textContent),
    ).toEqual(['观点一', '观点二']);
    expect(
      [...document.querySelectorAll('.keypoint-desc')].map((el) => el.textContent),
    ).toEqual(['说明一', '说明二']);
    expect(
      [...document.querySelectorAll('#structure .tree-node')].map((el) => el.textContent),
    ).toEqual(['核心主题', '子主题']);
    expect(
      [...document.querySelectorAll('#takeaways li')].map((el) => el.textContent),
    ).toEqual(['值得记住的结论']);
    expect(document.querySelector('#preview-link')?.getAttribute('href')).toBe(
      'https://x.com/alice/status/123',
    );
  });

  it('renders a nested 10-node tree without interpreting markup', async () => {
    const state = doneState('深层结构', '摘要');
    state.result.structure = {
      label: '<img src=x onerror=alert(1)>',
      children: [
        {
          label: '一',
          children: [
            {
              label: '1.1',
              children: [{ label: '1.1.1' }, { label: '1.1.2' }],
            },
            { label: '1.2' },
          ],
        },
        {
          label: '二',
          children: [{ label: '2.1' }, { label: '2.2' }],
        },
        { label: '三' },
      ],
    };
    state.result.takeaways = ['<strong>不要被标签欺骗</strong>'];
    mockSessionStorage['clip2md.visualSummary.state.7'] = state;

    dispose = await initializeSidePanel();

    const labels = [...document.querySelectorAll('#structure .tree-node')].map((el) => el.textContent);
    expect(labels).toHaveLength(10);
    expect(labels[0]).toBe('<img src=x onerror=alert(1)>');
    expect(document.querySelector('#structure img')).toBeNull();
    expect(document.querySelector('#structure b')).toBeNull();
    expect(document.querySelector('#takeaways strong')).toBeNull();
    expect(document.querySelector('#takeaways li')?.textContent).toBe('<strong>不要被标签欺骗</strong>');
  });

  it('listens for session changes and renders text without interpreting markup', async () => {
    dispose = await initializeSidePanel();
    const state = doneState('<img src=x onerror=alert(1)>', '<strong>正文</strong>');

    dispatchStorageChange({
      'clip2md.visualSummary.state.7': { newValue: state },
    });

    expect(document.querySelector('#preview-title')?.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(document.querySelector('#preview-body')?.textContent).toBe('<strong>正文</strong>');
    expect(document.querySelector('#preview img')).toBeNull();
    expect(document.querySelector('#preview strong')).toBeNull();
  });

  it('regenerate button requests a forced analysis for the current tab', async () => {
    mockSessionStorage['clip2md.visualSummary.state.7'] = doneState('当前推文', '摘要');

    dispose = await initializeSidePanel();
    (document.querySelector('#action-regenerate') as HTMLButtonElement).click();

    expect(runtimeSendMessageMock).toHaveBeenCalledWith({
      type: 'START_VISUAL_ANALYSIS',
      payload: { tabId: 7, force: true },
    });
  });

  it('settings button opens the options page', async () => {
    mockSessionStorage['clip2md.visualSummary.state.7'] = doneState('当前推文', '摘要');

    dispose = await initializeSidePanel();
    (document.querySelector('#action-settings') as HTMLButtonElement).click();

    expect(openOptionsPageMock).toHaveBeenCalledTimes(1);
  });

  it('shows actionable errors and clears stale preview content', async () => {
    mockSessionStorage['clip2md.visualSummary.state.7'] = doneState('旧页面', '旧正文');
    dispose = await initializeSidePanel();

    dispatchStorageChange({
      'clip2md.visualSummary.state.7': {
        newValue: {
          status: 'error',
          tabId: 7,
          requestId: 'req-error',
          updatedAt: 2,
          error: {
            code: 'UNSUPPORTED_VISUAL_PLATFORM',
            message: '当前版本仅支持 X 推文和 X Article。请切换到受支持的 X 内容后重试。',
          },
        },
      },
    });

    expect(document.querySelector('#status-label')?.textContent).toBe('暂时无法生成一图速览');
    expect(document.querySelector('#status-copy')?.textContent).toMatch(/X 推文/);
    expect((document.querySelector('#preview') as HTMLElement).hidden).toBe(true);
  });

  it('config errors offer settings navigation; other errors offer regenerate', async () => {
    mockSessionStorage['clip2md.visualSummary.state.7'] = {
      status: 'error',
      tabId: 7,
      requestId: 'r1',
      updatedAt: 1,
      error: { code: 'AI_NOT_CONFIGURED', message: '还没有配置 AI。' },
    };

    dispose = await initializeSidePanel();
    const action = document.querySelector('#status-action') as HTMLButtonElement;

    expect(action.hidden).toBe(false);
    expect(action.textContent).toContain('设置');
    action.click();
    expect(openOptionsPageMock).toHaveBeenCalledTimes(1);

    dispatchStorageChange({
      'clip2md.visualSummary.state.7': {
        newValue: {
          status: 'error',
          tabId: 7,
          requestId: 'r2',
          updatedAt: 2,
          error: { code: 'AI_TIMEOUT', message: '请求超时，请稍后重试。' },
        },
      },
    });

    expect(action.textContent).toContain('重新生成');
    action.click();
    expect(runtimeSendMessageMock).toHaveBeenCalledWith({
      type: 'START_VISUAL_ANALYSIS',
      payload: { tabId: 7, force: true },
    });
  });

  it('switches to the activated tab and reads only that tab state', async () => {
    mockSessionStorage['clip2md.visualSummary.state.7'] = doneState('标签页 7', '正文 7');
    mockSessionStorage['clip2md.visualSummary.state.8'] = {
      ...doneState('标签页 8', '正文 8'),
      tabId: 8,
    };
    dispose = await initializeSidePanel();

    dispatchTabActivated(8);
    await vi.waitFor(() => expect(document.querySelector('#preview-title')?.textContent).toBe('标签页 8'));
  });

  it('does not miss a session update while the initial state read is pending', async () => {
    let finishInitialRead: ((items: Record<string, unknown>) => void) | undefined;
    sessionGetMock.mockImplementationOnce((_keys, callback) => {
      finishInitialRead = callback;
    });

    const initialization = initializeSidePanel();
    await vi.waitFor(() => expect(finishInitialRead).toBeTypeOf('function'));

    const completed = doneState('最新页面', '最新正文');
    dispatchStorageChange({
      'clip2md.visualSummary.state.7': { newValue: completed },
    });
    finishInitialRead?.({
      'clip2md.visualSummary.state.7': {
        status: 'extracting',
        tabId: 7,
        updatedAt: 1,
      },
    });
    dispose = await initialization;

    expect(document.querySelector('#preview-title')?.textContent).toBe('最新页面');
  });
});
