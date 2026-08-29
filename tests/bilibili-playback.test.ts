import { describe, expect, it, vi } from 'vitest';
import {
  isGetBilibiliPlaybackStateRequest,
  isSeekBilibiliVideoRequest,
} from '../src/types/messages';
import {
  readBilibiliPlaybackState,
  seekBilibiliVideo,
} from '../src/adapters/bilibili/playback';

const VIDEO_URL = new URL('https://www.bilibili.com/video/BV1xx411c7mD/?p=2');

function mountVideo(args: { currentTime?: number; paused?: boolean } = {}): HTMLVideoElement {
  document.body.innerHTML = '<video></video>';
  const video = document.querySelector('video') as HTMLVideoElement;
  video.currentTime = args.currentTime ?? 0;
  Object.defineProperty(video, 'paused', {
    configurable: true,
    value: args.paused ?? true,
  });
  Object.defineProperty(video, 'play', {
    configurable: true,
    value: vi.fn(() => Promise.resolve()),
  });
  return video;
}

describe('B站播放器桥接', () => {
  it('读取 BV、分 P、当前时间与暂停状态', () => {
    mountVideo({ currentTime: 42.5, paused: false });

    expect(readBilibiliPlaybackState(document, VIDEO_URL)).toEqual({
      success: true,
      identity: 'BV1xx411c7mD:p2',
      currentTime: 42.5,
      paused: false,
    });
  });

  it('无 video 元素时返回 PLAYER_NOT_READY', () => {
    document.body.innerHTML = '<main></main>';

    expect(readBilibiliPlaybackState(document, VIDEO_URL)).toMatchObject({
      success: false,
      error: { code: 'PLAYER_NOT_READY' },
    });
  });

  it('非 B 站视频页时返回 UNSUPPORTED_PAGE', () => {
    mountVideo();

    expect(readBilibiliPlaybackState(document, new URL('https://example.com/video/BV1xx411c7mD/'))).toMatchObject({
      success: false,
      error: { code: 'UNSUPPORTED_PAGE' },
    });
  });

  it('身份不匹配时拒绝跳转', () => {
    const video = mountVideo({ currentTime: 12, paused: false });

    expect(seekBilibiliVideo(document, VIDEO_URL, {
      expectedIdentity: 'BV2yy411c7mD:p2',
      seconds: 60,
    })).toMatchObject({
      success: false,
      error: { code: 'SOURCE_CHANGED' },
    });
    expect(video.currentTime).toBe(12);
    expect(video.play).not.toHaveBeenCalled();
  });

  it('暂停时跳转不调用 play', () => {
    const video = mountVideo({ paused: true });

    expect(seekBilibiliVideo(document, VIDEO_URL, {
      expectedIdentity: 'BV1xx411c7mD:p2',
      seconds: 65.25,
    })).toEqual({ success: true });
    expect(video.currentTime).toBe(65.25);
    expect(video.play).not.toHaveBeenCalled();
  });

  it('播放中跳转后调用 play 恢复播放', () => {
    const video = mountVideo({ paused: false });

    expect(seekBilibiliVideo(document, VIDEO_URL, {
      expectedIdentity: 'BV1xx411c7mD:p2',
      seconds: 90,
    })).toEqual({ success: true });
    expect(video.currentTime).toBe(90);
    expect(video.play).toHaveBeenCalledOnce();
  });

  it('安全处理 play 拒绝的 Promise', async () => {
    const video = mountVideo({ paused: false });
    vi.mocked(video.play).mockRejectedValueOnce(new Error('autoplay blocked'));

    expect(seekBilibiliVideo(document, VIDEO_URL, {
      expectedIdentity: 'BV1xx411c7mD:p2',
      seconds: 30,
    })).toEqual({ success: true });
    await Promise.resolve();
    expect(video.play).toHaveBeenCalledOnce();
  });
});

describe('B站播放器消息守卫', () => {
  it('GET 只接受精确的无载荷请求', () => {
    expect(isGetBilibiliPlaybackStateRequest({ type: 'GET_BILIBILI_PLAYBACK_STATE' })).toBe(true);
    expect(isGetBilibiliPlaybackStateRequest({ type: 'GET_BILIBILI_PLAYBACK_STATE', payload: {} })).toBe(false);
    expect(isGetBilibiliPlaybackStateRequest({ type: 'GET_BILIBILI_PLAYBACK_STATE', extra: true })).toBe(false);
  });

  it('拒绝非法身份与非有限或越界秒数', () => {
    expect(isSeekBilibiliVideoRequest({
      type: 'SEEK_BILIBILI_VIDEO',
      payload: { expectedIdentity: 'BV1xx411c7mD:p2', seconds: 86400 },
    })).toBe(true);

    for (const expectedIdentity of ['av123:p1', 'BV1xx411c7mD:p0', 'BV1xx411c7mD:p01', 'BV1xx411c7mD:p']) {
      expect(isSeekBilibiliVideoRequest({
        type: 'SEEK_BILIBILI_VIDEO',
        payload: { expectedIdentity, seconds: 10 },
      })).toBe(false);
    }
    for (const seconds of [Number.NaN, Number.POSITIVE_INFINITY, -1, 86400.01]) {
      expect(isSeekBilibiliVideoRequest({
        type: 'SEEK_BILIBILI_VIDEO',
        payload: { expectedIdentity: 'BV1xx411c7mD:p1', seconds },
      })).toBe(false);
    }
  });
});
