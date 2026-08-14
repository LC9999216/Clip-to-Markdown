/**
 * 小黑盒（www.xiaoheihe.cn）选择器。
 *
 * 已覆盖两类文章页（真实页面另存为 HTML 后用 scripts/analyze-page.mjs 校准）：
 *
 * 1) 长文（.hb-bbs-post）
 *    .hb-bbs-post > .post__container
 *      ├─ .link-section-title
 *      ├─ .link-section-user
 *      ├─ .link-section-tags            ← 主题标签（不保存）
 *      ├─ .post__content > .hb-article  ← 正文
 *      └─ .link-comment / .link-reply   ← 评论/操作栏（不保存）
 *
 * 2) 图文帖（.hb-bbs-image-text）
 *    .hb-bbs-image-text
 *      ├─ .image-text__header-image     ← 头部图片轮播（正文图片，需并入输出）
 *      └─ .image-text__container
 *           ├─ .link-section-user
 *           ├─ .link-section-title
 *           ├─ .image-text__content     ← 正文文本
 *           ├─ .image-text__games       ← 游戏挂件（不保存）
 *           └─ .link-section-tags
 */
export const HEYBOX_SELECTORS = {
  /** 文章容器候选：图文帖 / 长文 */
  item: ['.hb-bbs-image-text', '.hb-bbs-post', '.post__container'],
  /** 标题候选 */
  title: ['.link-section-title', '.section-title__content', 'h1'],
  /** 作者候选（.link-user__username 为干净的用户名） */
  author: ['.link-user__username'],
  /** 时间候选：小黑盒无 ISO 时间戳（仅显示 "14小时前"），published 留空 */
  time: ['time[datetime]', '.link-data__time'],
  /** 正文文本容器候选 */
  body: ['.image-text__content', '.post__content', '.hb-article'],
  /** 图文帖头部图片轮播：作为正文图片并入输出（DOM 中位于文本之前） */
  heroImages: ['.image-text__header-image'],
  /** 干扰节点：评论/操作栏/标签/链接数据/轮播控件/导航 */
  remove: [
    '.link-comment', // 评论区
    '.link-comment__list',
    '.link-reply', // 底部操作栏（评论数/收藏/点赞）
    '.link-section-tags', // 主题标签
    '.link-section-link-data',
    '.header-image__hover-container', // 轮播悬浮控制层（含左右按钮与计数）
    '.header-image__indicator', // 轮播 "1/5" 计数
    '.header-image-pagination', // 轮播分页圆点
    '.image-text__games', // 游戏挂件
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

/** 明确非内容页的路径前缀 */
export const CONTENT_PATH_BLOCKLIST = [
  /^\/(login|register|search|download|settings|index\.html)/,
  /^\/app\/user\//, // 个人主页
] as const;
