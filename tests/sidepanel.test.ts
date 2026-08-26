import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeSidePanel } from '../src/sidepanel/sidepanel';
import {
  dispatchStorageChange,
  dispatchTabActivated,
  mockSessionStorage,
  sessionGetMock,
  tabsQueryMock,
} from './setup';

function mountPanel(): void {
  document.body.innerHTML = `
    <main>
      <p id="status-label"></p>
      <p id="status-copy"></p>
      <section id="preview" hidden>
        <span id="preview-type"></span>
        <h1 id="preview-title"></h1>
        <p id="preview-author"></p>
        <p id="preview-body"></p>
        <a id="preview-link"></a>
      </section>
    </main>`;
}

function doneState(title: string, summary: string) {
  return {
    status: 'done' as const,
    tabId: 7,
    requestId: 'req-1',
    updatedAt: 1,
    source: {
      url: 'https://x.com/alice/status/123',
      title,
      author: 'Alice (@alice)',
    },
    result: {
      schemaVersion: 1 as const,
      articleType: 'opinion' as const,
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

describe('Side Panel phase 2 preview', () => {
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
