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

// ---------- Source Blocks（V2 原文定位） ----------

/** 单个原文来源块：从真实 DOM 提取，供分析引用与导航定位。 */
export interface AnalysisSourceBlock {
  id: string;
  kind: 'heading' | 'paragraph' | 'list-item' | 'quote' | 'code' | 'table';
  text: string;
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

export type VisualAnalysisStatus = 'idle' | 'extracting' | 'analyzing' | 'done' | 'error';

/** 文章来源（用于结果 UI 与错误上下文，不含正文内容）。 */
export interface VisualAnalysisSource {
  url: string;
  title?: string;
  author?: string;
}

export interface VisualAnalysisError {
  code: string;
  message: string;
}

export interface VisualAnalysisState {
  tabId: number;
  requestId: string;
  status: VisualAnalysisStatus;
  source?: VisualAnalysisSource;
  result?: VisualSummary;
  error?: VisualAnalysisError;
  updatedAt: number;
}
