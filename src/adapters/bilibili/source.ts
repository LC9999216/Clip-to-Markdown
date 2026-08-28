import { extractBvid, extractPageIndex, type BilibiliSourceEntry } from './extractor';
import type { VisualNavigationResult, VisualSourceAnchor } from '../../types/visual-source';

const timelineCache = new Map<string, BilibiliSourceEntry[]>();

function identity(url: URL): string | null {
  const bvid = extractBvid(url);
  return bvid ? `${bvid}:p${extractPageIndex(url)}` : null;
}

export function rememberBilibiliSource(url: URL, entries: BilibiliSourceEntry[]): void {
  const key = identity(url);
  if (key) timelineCache.set(key, entries);
}

function waitForMetadata(video: HTMLMediaElement, timeoutMs: number): Promise<void> {
  if (video.readyState >= 1) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      video.removeEventListener('loadedmetadata', finish);
      resolve();
    };
    const timer = window.setTimeout(finish, timeoutMs);
    video.addEventListener('loadedmetadata', finish, { once: true });
  });
}

export async function navigateBilibiliSource(doc: Document, url: URL, anchor: VisualSourceAnchor): Promise<VisualNavigationResult> {
  const current = identity(url);
  let expected: string | null = null;
  try { expected = identity(new URL(anchor.expectedSourceUrl)); } catch { /* invalid request is filtered earlier */ }
  if (!current) return { success: false, error: { code: 'UNSUPPORTED_PAGE', message: '当前页面不是可定位的 B 站视频页。' } };
  if (!expected || expected !== current) return { success: false, error: { code: 'SOURCE_CHANGED', message: '当前视频或分 P 已变化，请重新生成一图速览。' } };

  const entries = timelineCache.get(current) ?? [];
  const byId = entries.filter((entry) => entry.block.id === anchor.sourceBlockId && entry.block.text.includes(anchor.sourceQuote));
  const matches = byId.length === 1 ? byId : entries.filter((entry) => entry.block.text.includes(anchor.sourceQuote));
  if (matches.length === 0) return { success: false, error: { code: 'TARGET_NOT_FOUND', message: '当前页面找不到对应的字幕或章节。请重新生成一图速览。' } };
  if (matches.length > 1) return { success: false, error: { code: 'AMBIGUOUS_TARGET', message: '原文片段对应多个时间点，已停止跳转。' } };

  const video = doc.querySelector('video') as HTMLMediaElement | null;
  if (!video) return { success: false, error: { code: 'TARGET_NOT_FOUND', message: '当前页面尚未找到视频播放器。' } };
  const wasPaused = video.paused;
  await waitForMetadata(video, 3000);
  const target = matches[0]!;
  try {
    video.currentTime = Math.max(0, target.start);
    if (!wasPaused && typeof video.play === 'function') {
      await video.play().catch(() => undefined);
    }
  } catch {
    return { success: false, error: { code: 'TARGET_NOT_FOUND', message: '播放器暂时无法跳转到目标时间。' } };
  }
  if (typeof (video as HTMLElement).scrollIntoView === 'function') {
    (video as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  return { success: true };
}
