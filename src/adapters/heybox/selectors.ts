/**
 * 小黑盒（www.xiaoheihe.cn）选择器。
 *
 * 基于真实页面（/app/bbs/link/{id} 文章页）验证过的结构，2026-08 确认：
 *   .hb-bbs-link__content > .hb-bbs-post > .post__container
 *     ├─ .link-section-title            ← 标题
 *     ├─ .link-section-user             ← 作者区
 *     ├─ .link-section-tags             ← 主题标签（不保存）
 *     ├─ .post__content > .hb-article   ← 正文
 *     └─ .link-comment / .link-reply    ← 评论区/操作栏（不保存）
 * 若真实页面变化，用 scripts/analyze-page.mjs 校准后再改这里。
 */

export const HEYBOX_SELECTORS = {
  /** 文章容器候选（验证：.hb-bbs-post 唯一） */
  item: ['.hb-bbs-post', '.post__container'],
  /** 标题候选 */
  title: ['.link-section-title', '.section-title__content', 'h1'],
  /** 作者候选（.link-user__username 为干净的用户名） */
  author: ['.link-user__username'],
  /** 时间候选：小黑盒无 ISO 时间戳（仅显示 "08-07"），published 留空 */
  time: ['time[datetime]', '.link-data__time'],
  /** 正文容器候选 */
  body: ['.post__content', '.hb-article'],
  /** 干扰节点：评论/操作栏/标签/链接数据/导航 */
  remove: [
    '.link-comment', // 评论区
    '.link-comment__list',
    '.link-reply', // 底部操作栏（评论数/收藏/点赞）
    '.link-section-tags', // 主题标签
    '.link-section-link-data',
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
