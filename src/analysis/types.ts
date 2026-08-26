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

interface VisualAnalysisStateBase {
  tabId: number;
  requestId: string;
  updatedAt: number;
}

export type VisualAnalysisState =
  | (VisualAnalysisStateBase & { status: 'extracting' })
  | (VisualAnalysisStateBase & { status: 'done'; preview: VisualSummaryPreview })
  | (VisualAnalysisStateBase & { status: 'error'; error: string });
