/** 测试辅助：fixture 读写、DOM 挂载、易变字段归一。 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PlatformId } from '../src/core/schema';

const FIXTURES_ROOT = join(process.cwd(), 'tests', 'fixtures');

export function readFixture(platform: string, name: string): string {
  return readFileSync(join(FIXTURES_ROOT, platform, name, 'index.html'), 'utf-8');
}

/** 读取期望输出；去除行尾 \r（Windows）与首尾空白，便于与渲染结果比较 */
export function readExpectedMd(platform: string, name: string): string {
  return readFileSync(join(FIXTURES_ROOT, platform, name, 'expected.md'), 'utf-8')
    .replace(/\r\n/g, '\n')
    .trim();
}

/** 把 fixture HTML 写入当前 jsdom document（含 head/body 解析） */
export function mountFixture(platform: PlatformId | string, name: string): void {
  document.open();
  document.write(readFixture(platform, name));
  document.close();
}
