/**
 * 「一图速览」会话缓存：chrome.storage.session 中按来源/正文/模型做稳定哈希。
 *
 * 约束：
 * - 不持久化到 storage.local（仅浏览器会话期间有效，避免隐私与过期内容）；
 * - 无 crypto 依赖，使用非加密的 FNV-1a 稳定哈希；
 * - 缓存键至少覆盖 source URL、正文与 model（任务书 §26）。
 */

import { parseVisualSummaryV2 } from './schema';
import type { VisualSummaryV2 } from './types';

const CACHE_KEY_PREFIX = 'clip2md.visualSummary.v2.cache.';

/** FNV-1a 32 位稳定哈希，返回 36 进制字符串；非加密用途。 */
export function stableHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/** 由 V2 schema、sourceUrl、实际 AI 正文、model 和 endpoint 生成缓存键。 */
export function visualSummaryCacheKey(
  sourceUrl: string,
  body: string,
  model: string,
  endpoint: string,
): string {
  return `${CACHE_KEY_PREFIX}${stableHash(`2\n${sourceUrl}\n${body}\n${model}\n${endpoint}`)}`;
}

/** 读取会话缓存；非 V2 或结构非法的旧值视为缓存缺失。 */
export function readCachedSummary(cacheKey: string): Promise<VisualSummaryV2 | undefined> {
  return new Promise((resolve) => {
    try {
      chrome.storage.session.get(cacheKey, (items) => {
        if (chrome.runtime.lastError) {
          resolve(undefined);
          return;
        }
        const raw = items?.[cacheKey];
        if (raw === undefined) {
          resolve(undefined);
          return;
        }
        try {
          resolve(parseVisualSummaryV2(raw));
        } catch {
          resolve(undefined);
        }
      });
    } catch {
      resolve(undefined);
    }
  });
}

/** 写入会话缓存；失败静默（写缓存失败不影响主流程结果返回）。 */
export function writeCachedSummary(cacheKey: string, summary: VisualSummaryV2): Promise<void> {
  return new Promise((resolve) => {
    try {
      chrome.storage.session.set({ [cacheKey]: summary }, () => resolve());
    } catch {
      resolve();
    }
  });
}
