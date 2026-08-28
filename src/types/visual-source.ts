import type { AnalysisSourceBlock } from '../analysis/types';
import type { ContentDocument } from '../core/schema';

export type VisualSourceExtraction = {
  document: ContentDocument;
  sourceBlocks: AnalysisSourceBlock[];
};

export type VisualSourceAnchor = {
  expectedSourceUrl: string;
  sourceBlockId: string;
  sourceQuote: string;
};

export type VisualNavigationErrorCode =
  | 'SOURCE_CHANGED'
  | 'UNSUPPORTED_PAGE'
  | 'TARGET_NOT_FOUND'
  | 'AMBIGUOUS_TARGET'
  | 'INVALID_REQUEST';

export type VisualNavigationResult =
  | { success: true }
  | { success: false; error: { code: VisualNavigationErrorCode; message: string } };
