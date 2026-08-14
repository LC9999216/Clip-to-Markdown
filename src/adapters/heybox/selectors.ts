/**
 * 小黑盒（www.xiaoheihe.cn）选择器。
 *
 * 重要：小黑盒真实 DOM 结构未知，本文件按"可配置对象"设计——
 * 开发时必须先打开真实文章页（或用 scripts/capture-structure.mjs 抓取结构），
 * 再按实际情况调整各候选数组，不要凭猜测写死。
 */

export const HEYBOX_SELECTORS = {
  /** 文章容器候选 */
  item: ['article', '.post-detail', '.article-detail', '.content-wrap'],
  /** 标题候选 */
  title: ['h1', '.post-title', '.article-title', '.title'],
  /** 作者候选 */
  author: ['.author-name', '.user-name', '.post-author', '.author'],
  /** 发布时间候选（优先 time[datetime] 的 datetime 属性） */
  time: ['time[datetime]', '.post-time', '.publish-time', '.time'],
  /** 正文容器候选 */
  body: ['.post-content', '.article-content', '.rich-content', '.content', '.editor-content'],
  /** 干扰节点：评论/推荐/操作栏/导航（在正文克隆内移除） */
  remove: [
    '.comment-list',
    '.comments',
    '.comment-item',
    '.hot-comment',
    '.recommend-list',
    '.related-post',
    '.related-posts',
    '.post-actions',
    '.action-bar',
    '.follow-btn',
    '.share-bar',
    'button',
    'script',
    'style',
    'nav',
    'footer',
    'aside',
  ],
  /** 登录墙 */
  loginIndicators: ['.login-modal', '[data-testid="login-modal"]'],
} as const;

/** 明确非内容页的路径前缀（开发时补充） */
export const CONTENT_PATH_BLOCKLIST = [
  /^\/(login|register|search|download|settings|index\.html)/,
] as const;
