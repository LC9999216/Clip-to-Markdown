/**
 * 开发辅助脚本：分析真实页面 HTML 的 DOM 结构，帮助校准 selectors.ts。
 * 两种用法：
 *   1) 带关键词：找到含关键词的最小元素，打印其祖先链（定位正文容器）
 *      node scripts/analyze-page.mjs <页面.html> <关键词>
 *   2) 不带关键词：打印 body 下前 200 个元素
 *      node scripts/analyze-page.mjs <页面.html>
 */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const [, , target, keyword = ''] = process.argv;
if (!target) {
  console.error('用法: node scripts/analyze-page.mjs <页面.html> [关键词]');
  process.exit(1);
}

const dom = new JSDOM(readFileSync(target, 'utf-8'));
const doc = dom.window.document;

function describe(el) {
  const cls =
    typeof el.className === 'string' && el.className.trim()
      ? '.' + el.className.trim().split(/\s+/).join('.')
      : '';
  const id = el.id ? '#' + el.id : '';
  const testid = el.getAttribute('data-testid') ? `[data-testid="${el.getAttribute('data-testid')}"]` : '';
  const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  return `${el.tagName.toLowerCase()}${id}${testid}${cls}${text ? `  → ${text}` : ''}`;
}

if (keyword) {
  const candidates = Array.from(doc.body.querySelectorAll('*'))
    .filter((el) => (el.textContent || '').includes(keyword))
    .filter((el) => el.children.length <= 20)
    .sort((a, b) => (a.textContent?.length ?? 0) - (b.textContent?.length ?? 0));
  const smallest = candidates[0];
  if (!smallest) {
    console.log(`未找到含「${keyword}」的元素`);
    process.exit(0);
  }
  console.log(`=== 含「${keyword}」的最小元素及其祖先链 ===`);
  const chain = [];
  let el = smallest;
  while (el && el !== doc.body) {
    chain.unshift(el);
    el = el.parentElement;
  }
  chain.forEach((c, i) => console.log('  '.repeat(i) + describe(c)));
} else {
  let count = 0;
  function walk(node, depth) {
    if (depth > 8 || count > 200) return;
    for (const c of node.children) {
      if (count > 200) return;
      count += 1;
      console.log('  '.repeat(depth) + describe(c));
      walk(c, depth + 1);
    }
  }
  walk(doc.body, 0);
  console.log(`\n共打印 ${count} 个元素。`);
}
