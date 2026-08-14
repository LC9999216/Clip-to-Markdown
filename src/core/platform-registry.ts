/**
 * PlatformRegistry：把 URL 路由到对应 PlatformAdapter。
 * 单例，各 adapter 在加载时通过 register() 注册。
 */

import type { PlatformAdapter } from '../adapters/types';
import type { PlatformContentType } from './schema';

export class PlatformRegistry {
  private adapters: PlatformAdapter[] = [];

  register(adapter: PlatformAdapter): void {
    if (this.adapters.some((a) => a.platform === adapter.platform)) {
      throw new Error(`Platform adapter 已注册: ${adapter.platform}`);
    }
    this.adapters.push(adapter);
  }

  /** 按注册顺序返回首个匹配的 adapter，无则 null */
  match(url: URL): PlatformAdapter | null {
    return this.adapters.find((a) => a.matches(url)) ?? null;
  }

  detectType(url: URL, doc: Document): PlatformContentType | null {
    return this.match(url)?.detectType(url, doc) ?? null;
  }

  get platforms(): string[] {
    return this.adapters.map((a) => a.platform);
  }
}

export const registry = new PlatformRegistry();
