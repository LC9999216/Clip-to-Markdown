import type { PlatformContentType, PlatformId } from '../core/schema';

const VISUAL_SUMMARY_STATE_KEY_PREFIX = 'clip2md.visualSummary.state.';

export function visualSummaryStateKey(tabId: number): string {
  return `${VISUAL_SUMMARY_STATE_KEY_PREFIX}${tabId}`;
}

export interface AnalysisInput {
  platform: PlatformId;
  contentType: PlatformContentType;
  title: string;
  author: string;
  sourceUrl: string;
  body: string;
  truncated: boolean;
}

export interface VisualSummaryPreview {
  title: string;
  author: string;
  body: string;
  contentType: 'tweet' | 'x-article';
  sourceUrl: string;
}

// ---------- VisualSummary（Phase 4） ----------

export type ArticleType =
  | 'opinion'
  | 'tutorial'
  | 'news'
  | 'comparison'
  | 'technical'
  | 'list'
  | 'other';

export interface VisualKeyPoint {
  title: string;
  description: string;
}

/** 简单内容结构树；不渲染 HTML、不输出 Mermaid。 */
export interface VisualTreeNode {
  label: string;
  children?: VisualTreeNode[];
}

export interface VisualSummary {
  schemaVersion: 1;
  articleType: ArticleType;
  /** 0 ~ 1 */
  confidence: number;
  classificationReason: string;
  /** 一句话总结，不超过约 80 字 */
  summary: string;
  /** 2 ~ 5 个核心观点 */
  keyPoints: VisualKeyPoint[];
  /** 深度 ≤ 3、节点 ≤ 10 */
  structure: VisualTreeNode;
  /** 1 ~ 3 条 takeaways */
  takeaways: string[];
}

interface VisualAnalysisStateBase {
  tabId: number;
  requestId: string;
  updatedAt: number;
}

export type VisualAnalysisState =
  | (VisualAnalysisStateBase & { status: 'extracting' })
  | (VisualAnalysisStateBase & { status: 'done'; preview: VisualSummaryPreview })
  | (VisualAnalysisStateBase & { status: 'error'; error: string });
