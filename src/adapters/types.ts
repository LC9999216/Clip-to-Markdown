/**
 * PlatformAdapter 接口：每个平台的适配器必须实现。
 * adapter 只负责"解析网站 DOM → ContentDocument"，不接触 Markdown 渲染。
 */

import type { ContentDocument, PlatformContentType, PlatformId } from '../core/schema';

export interface PlatformAdapter {
  platform: PlatformId;

  /** 域名级判断：本平台是否覆盖该 URL */
  matches(url: URL): boolean;

  /**
   * 判断当前页面内容类型（如 tweet / zhihu-answer / zhihu-article / heybox-post）。
   * 返回 null 表示该页面是本平台域名但不是受支持的内容页。
   */
  detectType(url: URL, doc: Document): PlatformContentType | null;

  /** 提取为统一 ContentDocument。失败抛 ExtractionError（中文 message）。 */
  extract(doc: Document, url: URL): ContentDocument;

  /** 可选：轻量探测标题（popup 在提取前展示用）。失败应返回 undefined 而非抛出。 */
  detectTitle?(url: URL, doc: Document, contentType: PlatformContentType): string | undefined;
}
