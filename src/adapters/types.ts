/**
 * PlatformAdapter 接口：每个平台的适配器必须实现。
 * adapter 只负责"解析网站 DOM → ContentDocument"，不接触 Markdown 渲染。
 */

import type { ContentDocument, PlatformContentType, PlatformId } from '../core/schema';
import type {
  VisualNavigationResult,
  VisualSourceAnchor,
  VisualSourceExtraction,
} from '../types/visual-source';

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

  /**
   * 可选：异步提取（用于需要网络请求的平台，如 B 站字幕需调用其 API）。
   * 存在时 content-script 优先走异步路径；extract 仍需实现（可抛 UNSUPPORTED_PAGE 占位）。
   */
  extractAsync?(doc: Document, url: URL): Promise<ContentDocument>;

  /** Optional source blocks used by V2 analysis and deterministic platform navigation. */
  extractVisualSource?(doc: Document, url: URL): VisualSourceExtraction | Promise<VisualSourceExtraction>;

  /** Optional platform-specific execution for a validated source anchor. */
  navigateToVisualSource?(
    doc: Document,
    url: URL,
    anchor: VisualSourceAnchor,
  ): VisualNavigationResult | Promise<VisualNavigationResult>;

  /** 可选：轻量探测标题（popup 在提取前展示用）。失败应返回 undefined 而非抛出。 */
  detectTitle?(url: URL, doc: Document, contentType: PlatformContentType): string | undefined;
}
