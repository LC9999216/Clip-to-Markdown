/**
 * 「一图速览」会话缓存：chrome.storage.session 中按来源/正文/模型做稳定哈希。
 *
 * 约束：
 * - 不持久化到 storage.local（仅浏览器会话期间有效，避免隐私与过期内容）；
 * - 无 crypto 依赖，使用非加密的 FNV-1a 稳定哈希；
 * - 缓存键至少覆盖 source URL、正文与 model（任务书 §26）。
 */

import type { VisualSummary } from './types';

const CACHE_KEY_PREFIX = 'clip2md.visualSummary.cache.';

/** FNV-1a 32 位稳定哈希，返回 36 进制字符串；非加密用途。 */
export function stableHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/** 由 sourceUrl + 正文 + model 生成稳定的会话缓存键。 */
export function visualSummaryCacheKey(sourceUrl: string, body: string, model: string): string {
  return `${CACHE_KEY_PREFIX}${stableHash(`${sourceUrl}\n${body}\n${model}`)}`;
}

/** 读取会话缓存；不存在或读取失败返回 undefined（缓存缺失不应阻断分析）。 */
export function readCachedSummary(cacheKey: string): Promise<VisualSummary | undefined> {
  return new Promise((resolve) => {
    try {
      chrome.storage.session.get(cacheKey, (items) => {
        if (chrome.runtime.lastError) {
          resolve(undefined);
          return;
        }
        resolve(items?.[cacheKey] as VisualSummary | undefined);
      });
    } catch {
      resolve(undefined);
    }
  });
}

/** 写入会话缓存；失败静默（写缓存失败不影响主流程结果返回）。 */
export function writeCachedSummary(cacheKey: string, summary: VisualSummary): Promise<void> {
  return new Promise((resolve) => {
    try {
      chrome.storage.session.set({ [cacheKey]: summary }, () => resolve());
    } catch {
      resolve();
    }
  });
}
