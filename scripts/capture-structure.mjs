/**
 * 开发辅助脚本（仅开发期，不进 dist）：
 * 抓取一个 HTML 文件（真实页面另存为）的容器结构，帮助快速编写/校准 selectors.ts。
 *
 * 用法：
 *   node scripts/capture-structure.mjs <页面.html>
 */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const [, , target] = process.argv;
if (!target) {
  console.error('用法: node scripts/capture-structure.mjs <页面.html>');
  process.exit(1);
}

const html = readFileSync(target, 'utf-8');
const dom = new JSDOM(html);
const doc = dom.window.document;

let count = 0;
const MAX = 400;

function walk(node, depth) {
  if (depth > 6 || count > MAX) return;
  for (const el of node.children) {
    if (count > MAX) return;
    count += 1;
    const cls =
      typeof el.className === 'string' && el.className.trim()
        ? '.' + el.className.trim().split(/\s+/).join('.')
        : '';
    const id = el.id ? '#' + el.id : '';
    const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24);
    console.log(`${'  '.repeat(depth)}${el.tagName.toLowerCase()}${id}${cls}${text ? `  → ${text}` : ''}`);
    walk(el, depth + 1);
  }
}

walk(doc.body, 0);
console.log(`\n共打印 ${Math.min(count, MAX)} 个元素（截断 ${MAX}）。`);
