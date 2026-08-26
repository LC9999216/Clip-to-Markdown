/**
 * 「一图速览」AI 配置模型与 Endpoint 安全校验。
 *
 * 安全约束：
 * - API Key 只存 chrome.storage.local，且只有 Background 能读取；
 * - 远程 Endpoint 必须 HTTPS；HTTP 仅允许 localhost / 127.0.0.1；
 * - 第三方 API 域名使用运行时可选权限，不进入静态 host_permissions。
 */

export interface AiSettings {
  /** 是否启用一图速览 */
  enabled: boolean;
  /** OpenAI-Compatible Chat Completions 完整 URL */
  endpoint: string;
  /** API Key（仅 Background 读取） */
  apiKey: string;
  /** 模型名，例如 deepseek-chat */
  model: string;
  /** 输出语言，V1 固定为简体中文 */
  outputLanguage: 'zh-CN';
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  enabled: false,
  endpoint: '',
  apiKey: '',
  model: '',
  outputLanguage: 'zh-CN',
};

const ALLOWED_INSECURE_HOSTS = new Set(['localhost', '127.0.0.1']);

/**
 * 校验并规范化 AI Endpoint：
 * - 去掉首尾空白；
 * - HTTPS 任意远程地址可用；
 * - HTTP 仅允许 localhost / 127.0.0.1；
 * - 其余协议（javascript:/file:/ftp:/data:/chrome-extension:）一律拒绝。
 * 返回规范化后的完整 URL，非法返回 null。
 */
export function normalizeAiEndpoint(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol === 'https:') return value;
  if (url.protocol === 'http:' && ALLOWED_INSECURE_HOSTS.has(url.hostname.toLowerCase())) {
    return value;
  }
  return null;
}

/**
 * 由合法 Endpoint 生成运行时主机权限的 origin 匹配模式。
 * 例如 https://api.deepseek.com/chat/completions → https://api.deepseek.com/*
 * 非法 Endpoint 返回 null。
 */
export function getAiOriginPattern(raw: string): string | null {
  const normalized = normalizeAiEndpoint(raw);
  if (normalized === null) return null;
  const url = new URL(normalized);
  return `${url.protocol}//${url.hostname}/*`;
}
