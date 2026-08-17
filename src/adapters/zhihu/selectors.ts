/**
 * 知乎页面选择器。
 * 基于多年稳定的 class 命名；若真实页面结构变化，优先调整此文件。
 * 注意：所有选择器需配合 fixture 与真实页面双重验证。
 */

export const ZHIHU_SELECTORS = {
  /** 回答类型 */
  answer: {
    /** 单个回答容器 */
    item: '.AnswerItem',
    /** 问题标题（页面级） */
    title: '.QuestionHeader-title',
    /** 作者 */
    author: '.AuthorInfo-name .UserLink-link, .AuthorInfo-name',
    /** 回答正文 */
    body: '.RichContent-inner, .RichText',
    /** 正文清洗时移除的干扰 */
    remove: [
      '.CommentsContainer',
      '.CommentList',
      '.CommentItem',
      '.ContentItem-actions',
      '.FollowButton',
      '.VoteButton',
      '.Question-sideColumn',
      '.RelatedQuestions',
      '.Recommendations',
      '.RichContent-collapsedText', // "展开阅读全文" 预览（V0.1 只取已展开部分）
      'button',
      'script',
      'style',
    ],
  },
  /** 文章类型 */
  article: {
    /** 文章容器 */
    item: '.Post-Main, .Post',
    /** 文章标题 */
    title: '.Post-Title',
    /** 作者 */
    author: '.Post-Author .AuthorInfo-name, .Post-Author .UserLink-link',
    /** 正文 */
    body: '.Post-RichTextContainer, .RichText',
    /** 正文清洗时移除的干扰 */
    remove: [
      '.CommentsContainer',
      '.CommentList',
      '.CommentItem',
      '.Post-SideActions',
      '.Recommendations',
      '.RelatedQuestions',
      'button',
      'script',
      'style',
    ],
  },
  /** 回答跳转链接（用于定位焦点回答） */
  answerIdLink: 'a[href*="/answer/"]',
  /** 发布时间 meta（可选，知乎不一定提供） */
  publishedMeta: ['meta[itemprop="datePublished"]', 'meta[property="article:published_time"]'],
  /** 登录墙 */
  loginIndicators: '.SignFlow, form[action*="signin"], [data-login-popup]',
} as const;

export const ANSWER_RE = /\/question\/(\d+)\/answer\/(\d+)/;
export const ARTICLE_RE = /\/p\/(\d+)/;
