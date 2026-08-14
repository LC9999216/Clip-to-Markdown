/**
 * 提取错误：adapter 只抛 ExtractionError，content-script 统一捕获转消息响应。
 * 绝不静默失败。
 */

export type ExtractionErrorCode =
  | 'UNSUPPORTED_PAGE'
  | 'NOT_FOUND_BODY'
  | 'NOT_FOUND_AUTHOR'
  | 'NOT_FOUND_METADATA'
  | 'LOGIN_REQUIRED'
  | 'UNKNOWN';

export class ExtractionError extends Error {
  readonly code: ExtractionErrorCode;

  constructor(code: ExtractionErrorCode, message: string) {
    super(message);
    this.name = 'ExtractionError';
    this.code = code;
  }
}

export const ERROR_MESSAGES: Record<ExtractionErrorCode, string> = {
  UNSUPPORTED_PAGE: '当前页面不是受支持的帖子/文章页面。',
  NOT_FOUND_BODY: '未找到正文内容，可能是页面结构变化或需要登录。',
  NOT_FOUND_AUTHOR: '未找到作者信息。',
  NOT_FOUND_METADATA: '未找到发布时间。',
  LOGIN_REQUIRED: '当前内容需要登录后才能查看，请先登录。',
  UNKNOWN: '发生未知错误。',
};
