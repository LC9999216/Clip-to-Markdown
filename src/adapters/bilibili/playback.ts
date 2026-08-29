import type {
  GetBilibiliPlaybackStateResponse,
  SeekBilibiliVideoRequest,
  SeekBilibiliVideoResponse,
} from '../../types/messages';
import { BVID_RE } from './selectors';

function playbackIdentity(url: URL): string | null {
  if (url.hostname !== 'www.bilibili.com') return null;
  const bvid = BVID_RE.exec(url.pathname)?.[1];
  if (!bvid) return null;
  // 与 subtitle-service 的 positiveInteger 语义一致：非数值/非正数回退 1，小数截断，
  // 保证同一 URL 在播放桥接与字幕资源两侧派生出相同身份。
  const requestedPage = Math.floor(Number(url.searchParams.get('p') ?? '1'));
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  return `${bvid}:p${page}`;
}

/** 字幕页与播放桥接共用的 B 站视频身份解析（BV 号 + 分 P）。 */
export function parseBilibiliVideoIdentity(url: URL): string | null {
  return playbackIdentity(url);
}

function unsupportedPage(): GetBilibiliPlaybackStateResponse {
  return {
    success: false,
    error: { code: 'UNSUPPORTED_PAGE', message: '当前页面不是 B 站视频页。' },
  };
}

function playerNotReady(): GetBilibiliPlaybackStateResponse {
  return {
    success: false,
    error: { code: 'PLAYER_NOT_READY', message: '播放器尚未加载，请稍后重试。' },
  };
}

export function readBilibiliPlaybackState(
  doc: Document,
  url: URL,
): GetBilibiliPlaybackStateResponse {
  const identity = playbackIdentity(url);
  if (!identity) return unsupportedPage();
  const video = doc.querySelector('video') as HTMLVideoElement | null;
  if (!video) return playerNotReady();
  return {
    success: true,
    identity,
    currentTime: video.currentTime,
    paused: video.paused,
  };
}

export function seekBilibiliVideo(
  doc: Document,
  url: URL,
  payload: SeekBilibiliVideoRequest['payload'],
): SeekBilibiliVideoResponse {
  const identity = playbackIdentity(url);
  if (!identity) return unsupportedPage();
  if (identity !== payload.expectedIdentity) {
    return {
      success: false,
      error: { code: 'SOURCE_CHANGED', message: '当前视频或分 P 已变化，请重新加载字幕。' },
    };
  }

  const video = doc.querySelector('video') as HTMLVideoElement | null;
  if (!video) return playerNotReady();
  const wasPaused = video.paused;
  try {
    video.currentTime = payload.seconds;
  } catch {
    return playerNotReady();
  }

  if (!wasPaused) {
    try {
      void video.play().catch(() => undefined);
    } catch {
      // The seek already succeeded; a synchronous play failure must not leak.
    }
  }
  return { success: true };
}
