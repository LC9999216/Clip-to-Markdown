/**
 * B 站视频提取器。
 * 字幕不在 DOM 中，必须异步调用 B 站 API：
 *   view 接口拿元数据 → player 接口拿字幕轨列表 → 下载字幕 JSON → 拼 Markdown。
 * 网络请求统一通过 background 代理（FETCH_JSON），带用户 cookie + referer。
 */

import { ExtractionError, ERROR_MESSAGES } from '../../core/error';
import { BVID_RE } from './selectors';
import type { ContentDocument } from '../../core/schema';
import { sourceBlockId, splitLongBlockText } from '../../analysis/source-blocks';
import type { AnalysisSourceBlock } from '../../analysis/types';
import type { FetchJsonCredentials, FetchJsonResponse } from '../../types/messages';
import { fetchBilibiliSubtitleResource, type BiliSubtitleResource } from './subtitle-service';
import { BiliSubtitleError } from './subtitle-types';
import type { BiliSubtitleLine } from './subtitle-types';

export type BiliSubtitleBodyItem = BiliSubtitleLine;

export interface BiliChapter {
  title: string;
  from: number;
  to: number;
}

export interface BilibiliSourceEntry {
  block: AnalysisSourceBlock;
  start: number;
  end: number;
}

/** Build source-linked timeline blocks without depending on the B 站 DOM. */
export function buildBilibiliSourceBlocks(args: {
  description: string;
  chapters: BiliChapter[];
  body: BiliSubtitleBodyItem[];
}): BilibiliSourceEntry[] {
  const body = (args.body || []).filter((item) => String(item?.content ?? '').trim());
  const chapters = (args.chapters || []).filter((chapter) => chapter.title && chapter.from >= 0).sort((a, b) => a.from - b.from);
  const entries: BilibiliSourceEntry[] = [];
  let index = 0;
  const push = (kind: AnalysisSourceBlock['kind'], text: string, start: number, end: number) => {
    for (const chunk of splitLongBlockText(text)) {
      entries.push({ block: { id: sourceBlockId(index++), kind, text: chunk }, start, end });
    }
  };

  if (chapters.length > 0) {
    if (body.length === 0 && String(args.description || '').trim()) {
      push('paragraph', String(args.description).trim(), -1, -1);
    }
    chapters.forEach((chapter, chapterIndex) => {
      const next = chapters[chapterIndex + 1];
      const end = next && next.from > chapter.from ? next.from : chapter.to > chapter.from ? chapter.to : Infinity;
      const transcript = body
        .filter((item) => Number(item.from) >= chapter.from && (end === Infinity || Number(item.from) < end))
        .map((item) => String(item.content).trim())
        .join(' ');
      push('heading', [chapter.title, transcript].filter(Boolean).join(' '), chapter.from, end);
    });
    return entries;
  }

  if (body.length > 0) {
    const windows = new Map<number, BiliSubtitleBodyItem[]>();
    body.forEach((item) => {
      const bucket = Math.floor(Math.max(0, Number(item.from) || 0) / 60);
      const current = windows.get(bucket) ?? [];
      current.push(item);
      windows.set(bucket, current);
    });
    for (const [, items] of windows) {
      push('paragraph', items.map((item) => String(item.content).trim()).join(' '), Number(items[0]!.from) || 0, Number(items[items.length - 1]!.to) || Number(items[0]!.from) || 0);
    }
    return entries;
  }

  if (String(args.description || '').trim()) push('paragraph', String(args.description).trim(), -1, -1);
  return entries;
}

// ---------- URL 解析 ----------

export function extractBvid(url: URL): string {
  return BVID_RE.exec(url.pathname)?.[1] ?? '';
}

export function extractPageIndex(url: URL): number {
  const page = Number(url.searchParams.get('p') || '1');
  return Number.isFinite(page) && page > 0 ? page : 1;
}

function canonicalVideoUrl(bvid: string, pageIndex: number): string {
  const base = `https://www.bilibili.com/video/${bvid}/`;
  return pageIndex > 1 ? `${base}?p=${pageIndex}` : base;
}

// ---------- runtime 代理请求 ----------

function sendRuntimeMessage<T>(msg: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg as object, (resp: T) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(resp);
    });
  });
}

async function fetchJson(url: string, credentials?: FetchJsonCredentials): Promise<unknown> {
  const message = credentials === undefined
    ? { type: 'FETCH_JSON' as const, url }
    : { type: 'FETCH_JSON' as const, url, credentials };
  const resp = await sendRuntimeMessage<FetchJsonResponse>(message);
  if (!resp.success) throw new ExtractionError('UNKNOWN', resp.error);
  return resp.data;
}

// ---------- Markdown 拼装 ----------

function formatTimestamp(seconds: number, withHours: boolean): string {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (withHours) {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function shouldShowHours(body: BiliSubtitleBodyItem[], chapters: BiliChapter[]): boolean {
  const subtitleMax = body.reduce((max, it) => Math.max(max, Number(it?.to) || 0, Number(it?.from) || 0), 0);
  const chapterMax = chapters.reduce((max, c) => Math.max(max, c.from, c.to), 0);
  return Math.max(subtitleMax, chapterMax) >= 3600;
}

/**
 * 把「简介 + 章节 + 字幕」拼成一段 Markdown（作为单个 MarkdownBlockNode 输出）。
 * 纯函数，便于单测。
 */
export function buildBodyMarkdown(args: {
  description: string;
  chapters: BiliChapter[];
  body: BiliSubtitleBodyItem[];
  includeTimestamp?: boolean;
}): string {
  const { description, chapters, body } = args;
  const includeTimestamp = args.includeTimestamp !== false;
  const withHours = shouldShowHours(body, chapters);
  const lines: string[] = [];

  const intro = String(description || '').trim();
  if (intro) {
    lines.push('## 简介', '', intro, '');
  }

  // chapters 已由 normalizeChapters 规范化（title/from/to，按 from 升序、去重），这里直接使用
  const safeChapters = chapters.filter((c) => c.title && c.from >= 0).sort((a, b) => a.from - b.from);
  if (safeChapters.length > 0) {
    lines.push('## 章节', '');
    for (const c of safeChapters) {
      const stamp = includeTimestamp ? `\`${formatTimestamp(c.from, withHours)}\` ` : '';
      lines.push(`- ${stamp}${c.title}`);
    }
    lines.push('');
  }

  lines.push('## 字幕', '');

  const items = (body || []).filter((it) => String(it?.content ?? '').trim());
  if (items.length === 0) {
    lines.push('（暂无字幕）');
    return trimTrailingBlank(lines);
  }

  if (safeChapters.length === 0) {
    for (const it of items) {
      lines.push(formatSubtitleLine(it, includeTimestamp, withHours));
    }
    return trimTrailingBlank(lines);
  }

  // 按章节分组
  const indexed = items.map((it, i) => ({ ...it, _i: i }));
  const assigned = new Set<number>();
  safeChapters.forEach((c, idx) => {
    const start = c.from;
    const next = safeChapters[idx + 1];
    let end = Infinity;
    if (next && next.from > start) end = next.from;
    else if (c.to > start) end = c.to;
    const section = indexed.filter((it) => {
      const from = Number(it.from) || 0;
      return from + 0.001 >= start && (end === Infinity ? true : from < end) && !assigned.has(it._i);
    });
    if (section.length === 0) return;
    const stamp = includeTimestamp ? ` \`${formatTimestamp(start, withHours)}\`` : '';
    lines.push(`### ${c.title}${stamp}`, '');
    for (const it of section) {
      assigned.add(it._i);
      lines.push(formatSubtitleLine(it, includeTimestamp, withHours));
    }
    lines.push('');
  });

  const remaining = indexed.filter((it) => !assigned.has(it._i));
  if (remaining.length > 0) {
    lines.push('### 其他片段', '');
    for (const it of remaining) {
      lines.push(formatSubtitleLine(it, includeTimestamp, withHours));
    }
    lines.push('');
  }

  return trimTrailingBlank(lines);
}

function formatSubtitleLine(item: BiliSubtitleBodyItem, includeTimestamp: boolean, withHours: boolean): string {
  const text = String(item?.content ?? '').trim();
  if (!text) return '';
  if (!includeTimestamp) return text;
  return `\`${formatTimestamp(item.from, withHours)}\` ${text}`;
}

function trimTrailingBlank(lines: string[]): string {
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n');
}

// ---------- 主入口 ----------

export interface BilibiliVisualExtraction {
  document: ContentDocument;
  sourceEntries: BilibiliSourceEntry[];
}

interface BiliSubtitleErrorContext {
  phase?: 'cdn';
  resource?: BiliSubtitleResource;
}

function mapBiliSubtitleError(error: BiliSubtitleError): ExtractionError {
  return new ExtractionError(
    error.code === 'NEED_LOGIN' ? 'LOGIN_REQUIRED' : 'UNKNOWN',
    error.message,
  );
}

export async function extractBilibiliVisualSourceAsync(doc: Document, url: URL): Promise<BilibiliVisualExtraction> {
  const bvid = extractBvid(url);
  if (!bvid) {
    throw new ExtractionError('UNSUPPORTED_PAGE', ERROR_MESSAGES.UNSUPPORTED_PAGE);
  }

  let resource: BiliSubtitleResource;
  try {
    resource = await fetchBilibiliSubtitleResource({
      url,
      requestJson: fetchJson,
      allowEmpty: true,
    });
  } catch (error) {
    if (!(error instanceof BiliSubtitleError)) throw error;
    const context = error as BiliSubtitleError & BiliSubtitleErrorContext;
    if ((error.code === 'EMPTY_TRANSCRIPT' || error.code === 'FETCH_FAILED')
      && context.phase === 'cdn'
      && context.resource) {
      resource = context.resource;
    } else {
      throw mapBiliSubtitleError(error);
    }
  }
  const { identity, chapters, lines: body } = resource;
  const published = resource.publishedAt > 0 ? formatLocalDate(resource.publishedAt * 1000) : '';
  const author = resource.author || readAuthorFromDom(doc) || '未知 UP 主';
  const title = resource.title || readTitleFromDom(doc) || bvid;
  const description = resource.description || readDescriptionFromDom(doc);
  const bodyMarkdown = buildBodyMarkdown({
    description,
    chapters,
    body,
    includeTimestamp: true,
  });

  const document: ContentDocument = {
    version: 1,
    metadata: {
      platform: 'bilibili',
      contentType: 'bilibili-video',
      sourceUrl: canonicalVideoUrl(identity.bvid, identity.pageIndex),
      author: { name: author },
      published,
      title,
      id: identity.bvid,
    },
    body: {
      type: 'article',
      children: [{ type: 'markdown', value: bodyMarkdown }],
    },
  };
  return { document, sourceEntries: buildBilibiliSourceBlocks({ description, chapters, body }) };
}

export async function extractBilibiliAsync(doc: Document, url: URL): Promise<ContentDocument> {
  return (await extractBilibiliVisualSourceAsync(doc, url)).document;
}

// ---------- DOM 兜底读取（B 站 API 取不到时用） ----------

function readTitleFromDom(doc: Document): string {
  return doc.querySelector('h1.video-title')?.textContent?.trim()
    ?? doc.querySelector('meta[property="og:title"]')?.getAttribute('content')?.trim()
    ?? '';
}

function readAuthorFromDom(doc: Document): string {
  return doc.querySelector('.up-name')?.textContent?.trim()
    ?? doc.querySelector('meta[name="author"]')?.getAttribute('content')?.trim()
    ?? '';
}

function readDescriptionFromDom(doc: Document): string {
  return doc.querySelector('.desc-info-text, .basic-desc-info, .video-info-detail .text')?.textContent?.trim() ?? '';
}

function formatLocalDate(value: number): string {
  const d = new Date(value);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** detectTitle：从 DOM 兜底读标题（popup 预展示用，失败返回 undefined） */
export function detectBilibiliTitle(doc: Document): string | undefined {
  const text = readTitleFromDom(doc);
  return text ? text.replace(/_哔哩哔哩_bilibili/i, '').trim() || undefined : undefined;
}
