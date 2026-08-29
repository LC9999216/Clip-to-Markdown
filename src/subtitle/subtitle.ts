/**
 * 字幕页控制器：加载 B 站官方字幕、轨道切换、会话缓存、错误状态与播放跟随。
 */

import { parseBilibiliVideoIdentity } from '../adapters/bilibili/playback';
import { fetchBilibiliSubtitleResource } from '../adapters/bilibili/subtitle-service';
import type { BiliSubtitleResource } from '../adapters/bilibili/subtitle-service';
import { BiliSubtitleError } from '../adapters/bilibili/subtitle-types';
import type {
  BiliJsonRequest,
} from '../adapters/bilibili/subtitle-service';
import { groupTranscript } from '../adapters/bilibili/transcript';
import type { BiliTranscriptSegment } from '../adapters/bilibili/subtitle-types';
import type {
  FetchJsonCredentials,
  GetBilibiliPlaybackStateResponse,
  SeekBilibiliVideoResponse,
  StatusResponse,
} from '../types/messages';

const CACHE_PREFIX = 'clip2md.bilibiliSubtitle.cache.v1.';
const UI_PREFIX = 'clip2md.bilibiliSubtitle.ui.v1.';

const POLL_INTERVAL_MS = 500;
/** scrollIntoView 触发的滚动事件在该时间窗内视为程序滚动 */
const PROGRAMMATIC_SCROLL_WINDOW_MS = 150;

const MSG_UNSUPPORTED = '字幕功能仅支持B站视频页';
const MSG_FETCH_FAILED = '字幕获取失败，请稍后刷新';
const MSG_LOADING = '正在加载字幕…';
const MSG_PLAYER_NOT_READY = '播放器尚未加载，请稍后重试';

interface SubtitlePageUiState {
  trackId: string | null;
  scrollTop: number;
}

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`字幕页缺少元素 #${id}`);
  return value as T;
}

function queryActiveTabId(): Promise<number | undefined> {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(chrome.runtime.lastError ? undefined : tabs[0]?.id);
    });
  });
}

function isBilibiliVideoStatus(status: StatusResponse | undefined): status is StatusResponse {
  return status?.supported === true
    && status.platform === 'bilibili'
    && status.contentType === 'bilibili-video';
}

function sendTabMessage<T>(tabId: number, message: unknown): Promise<T | undefined> {
  return new Promise((resolve) => {
    const sendMessage = chrome.tabs.sendMessage as unknown as (
      tab: number,
      msg: unknown,
      callback?: (response: unknown) => void,
    ) => unknown;
    const finish = (response: unknown): void => {
      resolve(chrome.runtime.lastError ? undefined : response as T | undefined);
    };
    try {
      const result = sendMessage(tabId, message, finish);
      if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
        void Promise.resolve(result).then(finish, () => resolve(undefined));
      }
    } catch {
      resolve(undefined);
    }
  });
}

function readTabStatus(tabId: number): Promise<StatusResponse | undefined> {
  return sendTabMessage<StatusResponse>(tabId, { type: 'GET_STATUS' });
}

/** 二分查找 start <= t < end 的段落下标，间隙返回 -1 */
function findActiveSegment(segments: BiliTranscriptSegment[], t: number): number {
  let lo = 0;
  let hi = segments.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const segment = segments[mid];
    if (!segment) return -1;
    if (t < segment.start) hi = mid - 1;
    else if (t >= segment.end) lo = mid + 1;
    else return mid;
  }
  return -1;
}

const requestJson: BiliJsonRequest = (url, credentials) =>
  new Promise((resolve, reject) => {
    const message: { type: 'FETCH_JSON'; url: string; credentials?: FetchJsonCredentials } = {
      type: 'FETCH_JSON',
      url,
    };
    if (credentials !== undefined) message.credentials = credentials;
    chrome.runtime.sendMessage(message, (response: unknown) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message));
        return;
      }
      const result = response as { success?: boolean; data?: unknown; error?: string } | undefined;
      if (result?.success === true) resolve(result.data);
      else reject(new Error(result?.error ?? 'FETCH_JSON_FAILED'));
    });
  });

function pageErrorMessage(error: unknown): string {
  if (error instanceof BiliSubtitleError) {
    switch (error.code) {
      case 'NEED_LOGIN': return '请登录B站后刷新字幕';
      case 'NO_SUBTITLE': return '该视频暂无可用字幕';
      case 'EMPTY_TRANSCRIPT': return '该字幕轨暂无内容';
      case 'FETCH_FAILED': return MSG_FETCH_FAILED;
    }
  }
  return MSG_FETCH_FAILED;
}

function splitIdentity(identity: string): { bvid: string; pageIndex: number } | null {
  const match = /^(BV[0-9A-Za-z]+):p([1-9]\d*)$/.exec(identity);
  if (!match) return null;
  return { bvid: match[1] ?? '', pageIndex: Number(match[2] ?? '1') };
}

function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  if (h > 0) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function renderSegments(
  list: HTMLElement,
  segments: BiliTranscriptSegment[],
  onSeek: (seconds: number) => void,
): void {
  const fragment = document.createDocumentFragment();
  for (const segment of segments) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'subtitle-row';
    row.dataset.start = String(segment.start);
    const time = document.createElement('span');
    time.className = 'subtitle-time';
    time.textContent = formatTime(segment.start);
    const text = document.createElement('span');
    text.className = 'subtitle-text';
    text.textContent = segment.text;
    row.onclick = () => onSeek(segment.start);
    row.append(time, text);
    fragment.appendChild(row);
  }
  list.replaceChildren(fragment);
}

function renderTrackOptions(select: HTMLSelectElement, resource: BiliSubtitleResource): void {
  const fragment = document.createDocumentFragment();
  for (const track of resource.tracks) {
    const option = document.createElement('option');
    option.value = track.id;
    option.textContent = track.isAi ? `${track.label}（AI）` : track.label;
    fragment.appendChild(option);
  }
  select.replaceChildren(fragment);
  select.disabled = resource.tracks.length === 0;
  select.value = resource.selectedTrackId ?? '';
}

export async function initializeSubtitlePage(): Promise<() => void> {
  const title = element<HTMLElement>('subtitle-title');
  const select = element<HTMLSelectElement>('subtitle-track');
  const status = element<HTMLElement>('subtitle-status');
  const list = element<HTMLElement>('subtitle-list');
  const refresh = element<HTMLButtonElement>('action-refresh');
  const settings = element<HTMLButtonElement>('action-settings');
  const returnCurrent = element<HTMLButtonElement>('return-current');

  let disposed = false;
  let generation = 0;
  let currentTabId: number | undefined;
  let currentUrl: URL | undefined;
  let currentIdentity: string | null = null;
  let currentResource: BiliSubtitleResource | null = null;
  let uiState: SubtitlePageUiState = { trackId: null, scrollTop: 0 };

  // 播放同步状态
  let stopPlaybackSync: (() => void) | null = null;
  let syncSegments: BiliTranscriptSegment[] = [];
  let activeIndex = -1;
  let followEnabled = true;
  let lastProgrammaticScrollAt = 0;

  const identityKeyOf = (identity: string): string | null => {
    const parts = splitIdentity(identity);
    return parts ? `${parts.bvid}:p${parts.pageIndex}` : null;
  };

  function sessionGet(key: string): Promise<unknown> {
    return new Promise((resolve) => {
      chrome.storage.session.get(key, (items) => {
        resolve(chrome.runtime.lastError ? undefined : (items as Record<string, unknown>)[key]);
      });
    });
  }

  async function loadUiState(identityKey: string): Promise<void> {
    const value = await sessionGet(`${UI_PREFIX}${identityKey}`);
    if (!value || typeof value !== 'object') {
      uiState = { trackId: null, scrollTop: 0 };
      return;
    }
    const record = value as Record<string, unknown>;
    uiState = {
      trackId: typeof record.trackId === 'string' ? record.trackId : null,
      scrollTop: typeof record.scrollTop === 'number' && Number.isFinite(record.scrollTop) ? record.scrollTop : 0,
    };
  }

  function writeUiState(patch: Partial<SubtitlePageUiState>): void {
    uiState = { ...uiState, ...patch };
    void chrome.storage.session.set({ [`${UI_PREFIX}${currentIdentity ?? ''}`]: uiState });
  }

  function writeCache(identityKey: string, resource: BiliSubtitleResource): void {
    if (!resource.selectedTrackId) return;
    const payload = { savedAt: Date.now(), resource };
    void chrome.storage.session.set({ [`${CACHE_PREFIX}${identityKey}:${resource.selectedTrackId}`]: payload });
  }

  async function readCache(identityKey: string, trackId: string): Promise<BiliSubtitleResource | undefined> {
    const key = `${CACHE_PREFIX}${identityKey}:${trackId}`;
    const result = await sessionGet(key);
    if (!result || typeof result !== 'object') return undefined;
    const resource = (result as { resource?: unknown }).resource;
    if (!resource || typeof resource !== 'object') return undefined;
    return resource as BiliSubtitleResource;
  }

  function markProgrammaticScroll(): void {
    lastProgrammaticScrollAt = Date.now();
  }

  function enableFollow(): void {
    followEnabled = true;
    returnCurrent.hidden = true;
  }

  function disableFollow(): void {
    if (!followEnabled) return;
    followEnabled = false;
    returnCurrent.hidden = false;
  }

  function stopSync(): void {
    stopPlaybackSync?.();
    stopPlaybackSync = null;
    syncSegments = [];
    activeIndex = -1;
    enableFollow();
  }

  /** 只更新变化的前后两个高亮节点，跟随启用时滚动到当前句 */
  function applyPlaybackTime(currentTime: number): void {
    const next = findActiveSegment(syncSegments, currentTime);
    if (next === activeIndex) return;
    const rows = list.querySelectorAll('.subtitle-row');
    const previous = activeIndex >= 0 ? rows[activeIndex] : null;
    const current = next >= 0 ? rows[next] : null;
    previous?.classList.remove('active');
    current?.classList.add('active');
    activeIndex = next;
    if (current && followEnabled) {
      markProgrammaticScroll();
      (current as HTMLElement).scrollIntoView({ block: 'center' });
    }
  }

  /** 可释放的播放循环：仅页面可见时按 500ms 读取播放状态 */
  function startPlaybackSync(tabId: number, identity: string, segments: BiliTranscriptSegment[]): () => void {
    syncSegments = segments;
    activeIndex = -1;
    const tick = async (): Promise<void> => {
      if (disposed || document.visibilityState !== 'visible') return;
      const response = await sendTabMessage<GetBilibiliPlaybackStateResponse>(
        tabId,
        { type: 'GET_BILIBILI_PLAYBACK_STATE' },
      );
      if (disposed || identity !== currentIdentity || tabId !== currentTabId) return;
      if (!response || !response.success) return;
      applyPlaybackTime(response.currentTime);
    };
    void tick();
    const timer = window.setInterval(() => { void tick(); }, POLL_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
    };
  }

  async function seekTo(seconds: number): Promise<void> {
    if (disposed || currentTabId === undefined || !currentIdentity) return;
    const tabId = currentTabId;
    const identity = currentIdentity;
    const response = await sendTabMessage<SeekBilibiliVideoResponse>(tabId, {
      type: 'SEEK_BILIBILI_VIDEO',
      payload: { expectedIdentity: identity, seconds },
    });
    if (disposed || identity !== currentIdentity || tabId !== currentTabId) return;
    if (!response || response.success) return;
    if (response.error.code === 'PLAYER_NOT_READY') {
      status.textContent = MSG_PLAYER_NOT_READY;
      return;
    }
    // 身份已变化（如用户在同一标签页切换了视频）：重新探测恢复
    void probeTabId(tabId);
  }

  function renderLoading(): void {
    stopSync();
    status.textContent = MSG_LOADING;
    list.replaceChildren();
  }

  function renderError(message: string): void {
    stopSync();
    status.textContent = message;
    list.replaceChildren();
    select.replaceChildren();
    select.disabled = true;
  }

  function renderReady(resource: BiliSubtitleResource): void {
    currentResource = resource;
    status.textContent = '';
    title.textContent = resource.title;
    renderTrackOptions(select, resource);
    const segments = groupTranscript(resource.lines);
    renderSegments(list, segments, (seconds) => { void seekTo(seconds); });
    if (uiState.scrollTop > 0) list.scrollTop = uiState.scrollTop;
    stopPlaybackSync?.();
    enableFollow();
    if (currentTabId !== undefined && currentIdentity) {
      stopPlaybackSync = startPlaybackSync(currentTabId, currentIdentity, segments);
    }
  }

  async function loadFor(args: {
    identity: string;
    pageUrl: URL;
    tabId: number;
    gen: number;
    forceRefresh: boolean;
    preferredTrackId?: string;
  }): Promise<void> {
    const identityKey = identityKeyOf(args.identity);
    const preferred = args.preferredTrackId ?? uiState.trackId ?? undefined;

    if (!args.forceRefresh && preferred && identityKey) {
      const cached = await readCache(identityKey, preferred);
      if (cached && !disposed && args.gen === generation && args.tabId === currentTabId) {
        renderReady(cached);
        return;
      }
    }

    try {
      const resource = await fetchBilibiliSubtitleResource({
        url: args.pageUrl,
        requestJson,
        preferredTrackId: preferred,
      });
      if (disposed || args.gen !== generation || args.tabId !== currentTabId) return;
      if (identityKey) {
        writeCache(identityKey, resource);
        writeUiState({ trackId: resource.selectedTrackId, scrollTop: 0 });
      }
      renderReady(resource);
    } catch (error) {
      if (disposed || args.gen !== generation || args.tabId !== currentTabId) return;
      renderError(pageErrorMessage(error));
    }
  }

  async function probeTabId(tabId: number): Promise<void> {
    generation += 1;
    const gen = generation;
    currentTabId = tabId;
    currentIdentity = null;
    currentResource = null;
    renderLoading();

    const statusResponse = await readTabStatus(tabId);
    if (disposed || gen !== generation || tabId !== currentTabId) return;
    if (!isBilibiliVideoStatus(statusResponse)) {
      renderError(MSG_UNSUPPORTED);
      return;
    }
    let pageUrl: URL;
    try {
      pageUrl = new URL(statusResponse.url);
    } catch {
      renderError(MSG_UNSUPPORTED);
      return;
    }
    const identity = parseBilibiliVideoIdentity(pageUrl);
    if (!identity) {
      renderError(MSG_UNSUPPORTED);
      return;
    }
    currentIdentity = identity;
    currentUrl = pageUrl;
    title.textContent = '';
    const identityKey = identityKeyOf(identity);
    if (identityKey) await loadUiState(identityKey);
    await loadFor({ identity, pageUrl, tabId, gen, forceRefresh: false });
  }

  settings.onclick = () => chrome.runtime.openOptionsPage();

  refresh.onclick = () => {
    if (disposed || !currentIdentity || !currentUrl || currentTabId === undefined) return;
    generation += 1;
    const gen = generation;
    renderLoading();
    void loadFor({
      identity: currentIdentity,
      pageUrl: currentUrl,
      tabId: currentTabId,
      gen,
      forceRefresh: true,
      preferredTrackId: select.value || undefined,
    });
  };

  select.onchange = () => {
    if (disposed || !currentIdentity || !currentUrl || currentTabId === undefined) return;
    generation += 1;
    const gen = generation;
    renderLoading();
    void loadFor({
      identity: currentIdentity,
      pageUrl: currentUrl,
      tabId: currentTabId,
      gen,
      forceRefresh: false,
      preferredTrackId: select.value || undefined,
    });
  };

  const onUserScroll = (): void => {
    if (Date.now() - lastProgrammaticScrollAt < PROGRAMMATIC_SCROLL_WINDOW_MS) return;
    disableFollow();
    if (disposed || !currentIdentity) return;
    writeUiState({ scrollTop: list.scrollTop });
  };
  const onWheel = (): void => { disableFollow(); };
  const onTouchMove = (): void => { disableFollow(); };
  const onReturnCurrent = (): void => {
    const rows = list.querySelectorAll<HTMLElement>('.subtitle-row');
    const current = activeIndex >= 0 ? rows[activeIndex] : undefined;
    if (current) {
      markProgrammaticScroll();
      current.scrollIntoView({ block: 'center' });
    }
    enableFollow();
    if (currentIdentity) writeUiState({ scrollTop: list.scrollTop });
  };
  list.addEventListener('scroll', onUserScroll);
  list.addEventListener('wheel', onWheel, { passive: true });
  list.addEventListener('touchmove', onTouchMove, { passive: true });
  returnCurrent.addEventListener('click', onReturnCurrent);

  const onTabActivated = ({ tabId }: chrome.tabs.OnActivatedInfo): void => {
    void probeTabId(tabId);
  };
  chrome.tabs.onActivated.addListener(onTabActivated);

  const initialTabId = await queryActiveTabId();
  if (disposed) {
    chrome.tabs.onActivated.removeListener(onTabActivated);
    return () => {};
  }
  if (initialTabId === undefined) {
    renderError(MSG_UNSUPPORTED);
  } else {
    await probeTabId(initialTabId);
  }

  return () => {
    disposed = true;
    stopSync();
    chrome.tabs.onActivated.removeListener(onTabActivated);
    list.removeEventListener('scroll', onUserScroll);
    list.removeEventListener('wheel', onWheel);
    list.removeEventListener('touchmove', onTouchMove);
    returnCurrent.removeEventListener('click', onReturnCurrent);
  };
}

function boot(): void {
  if (!document.getElementById('subtitle-list')) return;
  void initializeSubtitlePage();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
