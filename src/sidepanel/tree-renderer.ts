/**
 * 原生 DOM 结构树渲染器（Side Panel）。
 *
 * 约束：
 * - 只用 createElement / textContent，绝不使用 innerHTML（AI 文本不可信）；
 * - 递归深度防御上限 3（Schema 已保证深度 ≤ 3、节点 ≤ 10，此处双保险）；
 * - 节点标签按纯文本渲染，不解释为 HTML。
 */

import type { VisualTreeNode } from '../analysis/types';

const MAX_DEPTH = 3;

/** 将内容结构树渲染为 <ul class="tree">。 */
export function renderTree(node: VisualTreeNode): HTMLUListElement {
  const list = document.createElement('ul');
  list.className = 'tree';
  appendLevel(list, node, 0);
  return list;
}

function appendLevel(container: HTMLElement, node: VisualTreeNode, depth: number): void {
  if (depth > MAX_DEPTH) return;
  const item = document.createElement('li');
  const label = document.createElement('span');
  label.className = 'tree-node';
  label.textContent = node.label;
  item.appendChild(label);
  if (node.children && node.children.length > 0) {
    const childList = document.createElement('ul');
    for (const child of node.children) appendLevel(childList, child, depth + 1);
    item.appendChild(childList);
  }
  container.appendChild(item);
}
