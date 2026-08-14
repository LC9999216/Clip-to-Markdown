import { describe, it, expect } from 'vitest';
import { uniquifyAsync } from '../../src/core/custom-folder';

function taken(...names: string[]): (name: string) => Promise<boolean> {
  const set = new Set(names);
  return (n) => Promise.resolve(set.has(n));
}

describe('uniquifyAsync', () => {
  it('无冲突时返回原名', async () => {
    expect(await uniquifyAsync('a.md', taken())).toBe('a.md');
  });

  it('冲突时加 (1) 后缀', async () => {
    expect(await uniquifyAsync('a.md', taken('a.md'))).toBe('a (1).md');
  });

  it('连续冲突时递增', async () => {
    expect(await uniquifyAsync('a.md', taken('a.md', 'a (1).md', 'a (2).md'))).toBe('a (3).md');
  });

  it('无扩展名文件也能加后缀', async () => {
    expect(await uniquifyAsync('readme', taken('readme'))).toBe('readme (1)');
  });

  it('多点文件名只拆最后一个扩展名', async () => {
    expect(await uniquifyAsync('a.b.md', taken('a.b.md'))).toBe('a.b (1).md');
  });
});
