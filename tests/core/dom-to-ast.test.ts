import { describe, it, expect, beforeEach } from 'vitest';
import {
  createDomToAstContext,
  elementToBlocks,
  elementToInline,
  type DomToAstContext,
} from '../../src/core/dom-to-ast';

const BASE = 'https://example.com/article/1';

let ctx: DomToAstContext;

beforeEach(() => {
  ctx = createDomToAstContext(BASE);
});

function el(html: string): HTMLElement {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div;
}

describe('elementToBlocks', () => {
  it('段落 + 加粗（保留边界空格）', () => {
    const e = el('<p>Hello <strong>world</strong>!</p>');
    expect(elementToBlocks(e, ctx)).toEqual([
      {
        type: 'paragraph',
        children: [
          { type: 'text', value: 'Hello ' },
          { type: 'strong', children: [{ type: 'text', value: 'world' }] },
          { type: 'text', value: '!' },
        ],
      },
    ]);
  });

  it('标题/列表/引用/分隔线/代码块', () => {
    const e = el(`
      <h2>小节</h2>
      <ul><li>甲</li><li>乙</li></ul>
      <blockquote><p>引用</p></blockquote>
      <hr />
      <pre><code class="language-ts">const a = 1</code></pre>
    `);
    expect(elementToBlocks(e, ctx)).toEqual([
      { type: 'heading', depth: 2, children: [{ type: 'text', value: '小节' }] },
      {
        type: 'list',
        ordered: false,
        children: [
          { type: 'listItem', children: [{ type: 'paragraph', children: [{ type: 'text', value: '甲' }] }] },
          { type: 'listItem', children: [{ type: 'paragraph', children: [{ type: 'text', value: '乙' }] }] },
        ],
      },
      { type: 'blockquote', children: [{ type: 'paragraph', children: [{ type: 'text', value: '引用' }] }] },
      { type: 'thematicBreak' },
      { type: 'code', lang: 'ts', value: 'const a = 1' },
    ]);
  });

  it('链接绝对化，javascript: 链接被丢弃', () => {
    const e = el('<p><a href="/rel">相对</a> <a href="javascript:void(0)">危险</a></p>');
    const blocks = elementToBlocks(e, ctx);
    expect(blocks[0]).toEqual({
      type: 'paragraph',
      children: [
        { type: 'link', url: 'https://example.com/rel', children: [{ type: 'text', value: '相对' }] },
        { type: 'text', value: '危险' },
      ],
    });
  });

  it('懒加载图片取 data-src 并绝对化', () => {
    const e = el('<img data-src="https://cdn.example.com/a.jpg" alt="图" />');
    expect(elementToBlocks(e, ctx)).toEqual([
      { type: 'image', url: 'https://cdn.example.com/a.jpg', alt: '图' },
    ]);
  });

  it('figure 包裹的图片被提取为 image', () => {
    const e = el('<figure><img data-original="https://cdn.example.com/b.jpg" alt="配图"></figure>');
    expect(elementToBlocks(e, ctx)).toEqual([
      { type: 'image', url: 'https://cdn.example.com/b.jpg', alt: '配图' },
    ]);
  });

  it('段落内嵌图片被提升为块级 image（M2）', () => {
    const e = el('<p>文字 <img src="https://x/1.jpg" alt="图"> 更多</p>');
    expect(elementToBlocks(e, ctx)).toEqual([
      { type: 'paragraph', children: [{ type: 'text', value: '文字' }] },
      { type: 'image', url: 'https://x/1.jpg', alt: '图' },
      { type: 'paragraph', children: [{ type: 'text', value: '更多' }] },
    ]);
  });

  it('透明容器（.RichText）展开子块而非折叠', () => {
    const e = el('<div class="RichText"><p>第一段</p><h2>小标题</h2><ul><li>项</li></ul></div>');
    expect(elementToBlocks(e, ctx)).toEqual([
      { type: 'paragraph', children: [{ type: 'text', value: '第一段' }] },
      { type: 'heading', depth: 2, children: [{ type: 'text', value: '小标题' }] },
      {
        type: 'list',
        ordered: false,
        children: [{ type: 'listItem', children: [{ type: 'paragraph', children: [{ type: 'text', value: '项' }] }] }],
      },
    ]);
  });

  it('表格：thead 作表头', () => {
    const e = el(`
      <table>
        <thead><tr><th>名称</th><th>值</th></tr></thead>
        <tbody><tr><td>甲</td><td>1</td></tr></tbody>
      </table>
    `);
    const blocks = elementToBlocks(e, ctx);
    expect(blocks[0]?.type).toBe('table');
    const t = blocks[0] as unknown as { header: unknown; children: unknown[] };
    expect(t.header).toEqual({
      type: 'tableRow',
      children: [
        { type: 'tableCell', children: [{ type: 'text', value: '名称' }] },
        { type: 'tableCell', children: [{ type: 'text', value: '值' }] },
      ],
    });
    expect(t.children).toEqual([
      {
        type: 'tableRow',
        children: [
          { type: 'tableCell', children: [{ type: 'text', value: '甲' }] },
          { type: 'tableCell', children: [{ type: 'text', value: '1' }] },
        ],
      },
    ]);
  });
});

describe('elementToInline', () => {
  it('br → break；文本 \n → break', () => {
    const e = el('<p>a<br>b</p>');
    expect(elementToInline(e, ctx)).toEqual([
      { type: 'text', value: 'a' },
      { type: 'break' },
      { type: 'text', value: 'b' },
    ]);
  });

  it('行内代码与斜体（保留边界空格）', () => {
    const e = el('<p>使用 <code>npm i</code> 与 <em>斜体</em></p>');
    expect(elementToInline(e, ctx)).toEqual([
      { type: 'text', value: '使用 ' },
      { type: 'inlineCode', value: 'npm i' },
      { type: 'text', value: ' 与 ' },
      { type: 'emphasis', children: [{ type: 'text', value: '斜体' }] },
    ]);
  });

  it('空白文本被忽略', () => {
    const e = el('<p>   <span>   </span> 文本</p>');
    expect(elementToInline(e, ctx)).toEqual([{ type: 'text', value: '文本' }]);
  });
});
