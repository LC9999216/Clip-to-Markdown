import { describe, it, expect } from 'vitest';
import {
  collectArticleSourceBlocks,
  collectArticleSourceBlocksWithElements,
  findArticleBodyContainer,
} from '../src/adapters/x/article-source';
import { normalizeBlockText, sourceBlockId, splitLongBlockText } from '../src/analysis/source-blocks';
import { mountFixture } from './helpers';

/** 构造一个最小但完整的 X Article DOM（含作者区与富文本正文容器） */
function articleDoc(contentsInner: string): void {
  document.open();
  document.write(`<!DOCTYPE html><html lang="zh-CN"><body>
    <article role="article">
      <div data-testid="User-Name">
        <div class="user"><a href="/a"><span><span>Alice</span></span></a><span>@alice</span></div>
      </div>
      <div data-testid="twitterArticleRichTextView">
        <div data-testid="longformRichTextComponent">
          <div data-contents="true">${contentsInner}</div>
        </div>
      </div>
    </article>
  </body></html>`);
  document.close();
}

describe('normalizeBlockText', () => {
  it('NBSP + 零宽字符 + 空白合并 + trim；保留全角 CJK 标点', () => {
    expect(normalizeBlockText('  ａｂｃ\u00A0\u200B x\u200D\uFEFF y  ')).toBe('ａｂｃ x y');
    expect(normalizeBlockText('\n\t spaced \n\n out \t ')).toBe('spaced out');
    expect(normalizeBlockText('作者在 这里 首发，安装依赖：。')).toBe('作者在 这里 首发，安装依赖：。');
  });

  it('空串与纯空白返回空串', () => {
    expect(normalizeBlockText('')).toBe('');
    expect(normalizeBlockText('   \u00A0\u200B ')).toBe('');
  });
});

describe('splitLongBlockText', () => {
  it('短文本不切分', () => {
    expect(splitLongBlockText('hello world')).toEqual(['hello world']);
  });

  it('超长文本在句末边界处切分（中文句号）', () => {
    const sentence = '这是一句很长的话。'.repeat(400); // 9 * 400 = 3600 字符
    const chunks = splitLongBlockText(sentence);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect([...c].length).toBeLessThanOrEqual(2000);
      expect(c.endsWith('。')).toBe(true);
    }
    expect(chunks.join('')).toBe('这是一句很长的话。'.repeat(400));
  });

  it('无句末边界时在 2000 字处硬切', () => {
    const long = 'x'.repeat(4500);
    const chunks = splitLongBlockText(long);
    expect(chunks).toEqual(['x'.repeat(2000), 'x'.repeat(2000), 'x'.repeat(500)]);
  });

  it('空文本返回空数组', () => {
    expect(splitLongBlockText('   ')).toEqual([]);
  });
});

describe('sourceBlockId', () => {
  it('B001 起，三位填充', () => {
    expect(sourceBlockId(0)).toBe('B001');
    expect(sourceBlockId(1)).toBe('B002');
    expect(sourceBlockId(9)).toBe('B010');
    expect(sourceBlockId(999)).toBe('B1000');
  });
});

describe('collectArticleSourceBlocks（现有 article fixture）', () => {
  it('正文根指向外层 [data-contents]，排除嵌套重复正文容器', () => {
    mountFixture('x', 'article');
    const container = findArticleBodyContainer(document);
    expect(container).not.toBeNull();
    // 焦点容器内的文本应包含正文而非嵌套重复正文
    expect(container?.textContent).toContain('这是一篇介绍');
    expect(container?.textContent).not.toContain('嵌套重复正文');
  });

  it('输出 B001~B005：段落/标题/代码/段落，DOM 序稳定编号，纯媒体不生成 Block', () => {
    mountFixture('x', 'article');
    const blocks = collectArticleSourceBlocks(document);
    expect(blocks.map((b) => b.id)).toEqual(['B001', 'B002', 'B003', 'B004', 'B005']);
    expect(blocks.map((b) => b.kind)).toEqual([
      'paragraph',
      'heading',
      'paragraph',
      'code',
      'paragraph',
    ]);
    expect(blocks[0]!.text).toBe('这是一篇介绍 DeepSeek-Harness 的长文章，作者在 这里 首发。');
    expect(blocks[1]!.text).toBe('快速上手');
    expect(blocks[2]!.text).toBe('安装依赖：');
    expect(blocks[3]!.text).toBe('npm install deepseek-harness');
    expect(blocks[4]!.text).toBe('更多细节请看下图。');
    // 图片（figure/img）不生成 Block
    expect(blocks.some((b) => b.text.includes('架构图'))).toBe(false);
    expect(blocks.some((b) => b.text.includes('😀'))).toBe(false);
  });

  it('同一 DOM 重复收集得到完全相同的 Blocks（确定性）', () => {
    mountFixture('x', 'article');
    const a = collectArticleSourceBlocks(document);
    const b = collectArticleSourceBlocks(document);
    expect(a).toEqual(b);
  });

  it('带元素引用的收集器：每个 block 指向 DOM 内真实元素', () => {
    mountFixture('x', 'article');
    const entries = collectArticleSourceBlocksWithElements(document);
    expect(entries.length).toBe(5);
    for (const { block, element } of entries) {
      expect(block.id).toMatch(/^B\d{3,}$/);
      expect(document.contains(element)).toBe(true);
      expect(element.textContent).toContain(block.text.slice(0, 5));
    }
  });
});

describe('collectArticleSourceBlocks（嵌套候选最深层保留）', () => {
  it('blockquote 内 p 保留最深层，blockquote 不生成独立 Block', () => {
    articleDoc('<blockquote><p>被引用的段落内容。</p></blockquote>');
    const blocks = collectArticleSourceBlocks(document);
    expect(blocks).toEqual([
      { id: 'B001', kind: 'paragraph', text: '被引用的段落内容。' },
    ]);
  });

  it('[data-block=true] 包裹多个 p：每个 p 独立成块，外层不生成', () => {
    articleDoc(
      '<div data-block="true"><p>第一段。</p><p>第二段。</p></div>',
    );
    const blocks = collectArticleSourceBlocks(document);
    expect(blocks.map((b) => b.id)).toEqual(['B001', 'B002']);
    expect(blocks.map((b) => b.kind)).toEqual(['paragraph', 'paragraph']);
    expect(blocks.map((b) => b.text)).toEqual(['第一段。', '第二段。']);
  });
});

describe('collectArticleSourceBlocks（跨 span 合并与重复段落）', () => {
  it('段落内多 span 合并为单个 Block', () => {
    articleDoc('<p><span>前半句</span><span>后半句</span></p>');
    const blocks = collectArticleSourceBlocks(document);
    expect(blocks).toEqual([{ id: 'B001', kind: 'paragraph', text: '前半句后半句' }]);
  });

  it('重复段落各自保留为独立 Block，编号连续', () => {
    articleDoc('<p>相同的句子。</p><p>相同的句子。</p>');
    const blocks = collectArticleSourceBlocks(document);
    expect(blocks).toEqual([
      { id: 'B001', kind: 'paragraph', text: '相同的句子。' },
      { id: 'B002', kind: 'paragraph', text: '相同的句子。' },
    ]);
  });

  it('空段落与纯媒体段落不生成 Block', () => {
    articleDoc('<p></p><p><img src="https://pbs.twimg.com/media/x.jpg" alt="图"></p><p>正文。</p>');
    const blocks = collectArticleSourceBlocks(document);
    expect(blocks).toEqual([{ id: 'B001', kind: 'paragraph', text: '正文。' }]);
  });
});

describe('collectArticleSourceBlocks（长段落分片）', () => {
  it('超长段落按句末边界分片，ID 连续，每片指向同一元素', () => {
    const long = '很长的一句话。'.repeat(300); // 7 * 300 = 2100 字符
    articleDoc(`<p>${long}</p>`);
    const entries = collectArticleSourceBlocksWithElements(document);
    expect(entries.length).toBeGreaterThan(1);
    expect(entries.every((e) => e.element.tagName.toLowerCase() === 'p')).toBe(true);
    // 每片都是同一元素（同一个 <p>）
    expect(new Set(entries.map((e) => e.element)).size).toBe(1);
    // ID 连续 B001...
    const ids = entries.map((e) => e.block.id);
    for (let i = 0; i < ids.length; i++) {
      expect(ids[i]).toBe(sourceBlockId(i));
    }
    // 全部文本拼回 == 原始（归一化后）
    expect(entries.map((e) => e.block.text).join('')).toBe('很长的一句话。'.repeat(300));
    // 每片 ≤ 2000 字
    for (const e of entries) {
      expect([...e.block.text].length).toBeLessThanOrEqual(2000);
    }
  });
});
