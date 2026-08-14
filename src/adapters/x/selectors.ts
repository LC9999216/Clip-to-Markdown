/**
 * X / Twitter 页面选择器。
 * X 的 DOM 频繁变化——所有选择器集中在此文件，结构变动时只改这里。
 */

export const X_SELECTORS = {
  /** 每条推文的根元素 */
  article: 'article[role="article"]',
  /** 作者区（显示名 + @handle） */
  userName: '[data-testid="User-Name"]',
  /** 推文正文 */
  tweetText: '[data-testid="tweetText"]',
  /** 图片容器 */
  tweetPhoto: '[data-testid="tweetPhoto"]',
  /** 时间 */
  time: 'time[datetime]',
  /** 推文链接（含 /status/{id}） */
  statusLink: 'a[href*="/status/"]',
  /** 引用推文容器（多版本兜底） */
  quoteSelectors: [
    '[data-testid="tweetQuote"]',
    '[data-testid="tweet-quoted-tweet"]',
    '[data-testid="quote-tweet"]',
  ],
  /** 推广标记 */
  promotedIndicators: '[data-testid="promotedIndicator"], [data-testid="placementTracking"]',
  /** 登录墙提示 */
  loginIndicators: '[data-testid="loginButton"], [href="/login"], [data-testid="signupButton"]',
  /** 正文清洗时移除的干扰节点 */
  removeSelectors: [
    '[role="group"]', // 互动按钮条（点赞/转发等）
    '[data-testid="socialContext"]', // "转发了 / 关注的人" 上下文
    '[data-testid="caret"]',
    '[data-testid="tweet-edit"]',
    '[data-testid="tweet-text-show-more-link"]',
    '[data-testid$="-follow"]', // 关注按钮
    '[data-testid="bookmarkButton"]',
    '[data-testid="unbookmark"]',
    '[data-testid="placementTracking"]',
    'svg',
    'script',
    'style',
  ],
} as const;

export const STATUS_ID_RE = /\/status\/(\d+)/;
