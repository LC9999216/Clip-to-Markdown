/**
 * B 站视频页选择器。
 * B 站 DOM 会随改版变化——所有选择器集中在此文件，结构变动时只改这里。
 * 注意：B 站字幕本身不在 DOM 中，必须调用 B 站 API 获取；DOM 选择器仅用于兜底读取标题/作者/简介/时间。
 */

export const BILIBILI_SELECTORS = {
  /** 视频标题（新版视频页 h1.video-title） */
  title: 'h1.video-title',
  /** og:title meta 兜底 */
  metaTitle: 'meta[property="og:title"]',
  /** UP 主名 */
  author: '.up-name, a.up-name, .video-info-detail .up-name',
  /** meta author 兜底 */
  metaAuthor: 'meta[name="author"]',
  /** 视频简介 */
  description: '.desc-info-text, .video-desc .desc-info-text, .basic-desc-info, .video-info-detail .text',
  /** 发布时间 */
  uploadDate: 'meta[itemprop="uploadDate"], .pubdate-ip-text',
} as const;

/** BV 号：/video/BV... */
export const BVID_RE = /\/video\/(BV[0-9A-Za-z]+)/;
