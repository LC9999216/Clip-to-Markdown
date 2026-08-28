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
import type { FetchJsonResponse } from '../../types/messages';

// ---------- B 站 API 返回结构（仅声明用到的字段） ----------

interface BiliApiResponse<T = unknown> {
  code: number;
  message?: string;
  data: T;
}

interface BiliPage {
  cid: number;
  page: number;
  part: string;
  duration: number;
}

interface BiliVideoMeta {
  aid: number;
  title: string;
  desc: string;
  pubdate: number;
  cid: number;
  duration: number;
  owner: { name: string };
  pages: BiliPage[];
}

interface BiliSubtitleTrack {
  id: number;
  lan: string;
  lan_doc: string;
  subtitle_url: string;
}

interface BiliPlayerData {
  subtitle?: { subtitles?: BiliSubtitleTrack[] };
  view_points?: Array<{ content?: string; from?: number; to?: number }>;
}

export interface BiliSubtitleBodyItem {
  from: number;
  to: number;
  content: string;
}

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

async function fetchJson(url: string): Promise<unknown> {
  const resp = await sendRuntimeMessage<FetchJsonResponse>({ type: 'FETCH_JSON', url });
  if (!resp.success) throw new ExtractionError('UNKNOWN', resp.error);
  return resp.data;
}

// ---------- B 站 API 调用 ----------

async function fetchBiliVideoMeta(bvid: string): Promise<BiliVideoMeta> {
  const payload = (await fetchJson(
    `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`,
  )) as BiliApiResponse<BiliVideoMeta>;
  if (payload.code !== 0) {
    throw new ExtractionError('NOT_FOUND_METADATA', payload.message || '无法获取视频信息');
  }
  return payload.data;
}

function pickPage(pages: BiliPage[], pageIndex: number, fallbackCid: number): { cid: number; part: string; duration: number } {
  const list = Array.isArray(pages) ? pages : [];
  const byIndex = list[pageIndex - 1];
  if (byIndex?.cid) return { cid: byIndex.cid, part: byIndex.part ?? '', duration: byIndex.duration ?? 0 };
  const byNo = list.find((p) => Number(p.page) === pageIndex);
  if (byNo?.cid) return { cid: byNo.cid, part: byNo.part ?? '', duration: byNo.duration ?? 0 };
  const first = list[0];
  if (first?.cid) return { cid: first.cid, part: first.part ?? '', duration: first.duration ?? 0 };
  return { cid: fallbackCid, part: '', duration: 0 };
}

interface SubtitleBundle {
  tracks: BiliSubtitleTrack[];
  chapters: BiliChapter[];
}

async function fetchSubtitleBundle(bvid: string, cid: number, aid: number): Promise<SubtitleBundle> {
  const requests: Array<{ source: string; url: string }> = [];
  if (aid) {
    requests.push({
      source: 'player-wbi-v2',
      url: `https://api.bilibili.com/x/player/wbi/v2?aid=${aid}&cid=${cid}&bvid=${encodeURIComponent(bvid)}`,
    });
  }
  requests.push({
    source: 'player-v2',
    url: `https://api.bilibili.com/x/player/v2?bvid=${encodeURIComponent(bvid)}&cid=${cid}${aid ? `&aid=${aid}` : ''}`,
  });

  for (const req of requests) {
    let payload: BiliApiResponse<BiliPlayerData>;
    try {
      payload = (await fetchJson(req.url)) as BiliApiResponse<BiliPlayerData>;
    } catch {
      continue;
    }
    if (payload.code !== 0) continue;
    const tracks = normalizeTracks(payload.data?.subtitle?.subtitles ?? []);
    if (tracks.length > 0) {
      return { tracks, chapters: normalizeChapters(payload.data?.view_points ?? []) };
    }
    // 该来源成功但无字幕：直接返回空，不再跨源兜底（与源插件对齐）
    return { tracks: [], chapters: normalizeChapters(payload.data?.view_points ?? []) };
  }
  throw new ExtractionError('UNKNOWN', '无法获取字幕列表');
}

function normalizeSubtitleUrl(url: string): string {
  const text = String(url || '').trim();
  if (!text) return '';
  return text.startsWith('//') ? `https:${text}` : text;
}

function normalizeTracks(tracks: BiliSubtitleTrack[]): BiliSubtitleTrack[] {
  return (tracks || [])
    .map((t) => ({ ...t, subtitle_url: normalizeSubtitleUrl(t.subtitle_url ?? '') }))
    .filter((t) => t.subtitle_url)
    .sort((a, b) => subtitlePriority(a) - subtitlePriority(b));
}

/** 中文优先（含 AI 中文），其次英文，再次其他 */
function subtitlePriority(track: BiliSubtitleTrack): number {
  const lan = String(track.lan || '').toLowerCase();
  const label = String(track.lan_doc || '').toLowerCase();
  if (lan === 'zh-cn' || lan === 'zh-hans') return 0;
  if (lan === 'zh') return 1;
  if (lan.includes('zh')) return 2;
  if (label.includes('中文')) return 3;
  if (lan === 'en' || lan === 'en-us' || lan === 'en-gb') return 10;
  if (lan.includes('en')) return 11;
  if (label.includes('英文') || label.includes('英语') || label.includes('english')) return 12;
  return 50;
}

function normalizeChapterTime(value: unknown): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return 0;
  // 毫秒时间戳统一转秒
  return num > 60 * 60 * 24 ? num / 1000 : num;
}

function normalizeChapters(points: Array<{ content?: string; from?: number; to?: number }>): BiliChapter[] {
  return (points || [])
    .map((p) => ({
      title: String(p?.content ?? '').trim(),
      from: normalizeChapterTime(p?.from),
      to: normalizeChapterTime(p?.to),
    }))
    .filter((c) => c.title && c.from >= 0)
    .sort((a, b) => a.from - b.from);
}

async function fetchSubtitleBody(url: string): Promise<BiliSubtitleBodyItem[]> {
  const payload = (await fetchJson(url)) as { body?: BiliSubtitleBodyItem[] };
  return Array.isArray(payload?.body) ? payload.body : [];
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

export async function extractBilibiliVisualSourceAsync(doc: Document, url: URL): Promise<BilibiliVisualExtraction> {
  const bvid = extractBvid(url);
  if (!bvid) {
    throw new ExtractionError('UNSUPPORTED_PAGE', ERROR_MESSAGES.UNSUPPORTED_PAGE);
  }

  const meta = await fetchBiliVideoMeta(bvid);
  const pageIndex = extractPageIndex(url);
  const page = pickPage(meta.pages, pageIndex, meta.cid);
  if (!page.cid) {
    throw new ExtractionError('NOT_FOUND_METADATA', '无法定位当前视频分 P');
  }

  const bundle = await fetchSubtitleBundle(bvid, page.cid, meta.aid);
  let body: BiliSubtitleBodyItem[] = [];
  const track = bundle.tracks[0];
  if (track) {
    try {
      body = await fetchSubtitleBody(track.subtitle_url);
    } catch {
      body = [];
    }
  }

  const published = meta.pubdate > 0 ? formatLocalDate(meta.pubdate * 1000) : '';
  const author = String(meta.owner?.name ?? readAuthorFromDom(doc)).trim() || '未知 UP 主';
  const title = String(meta.title ?? readTitleFromDom(doc)).trim() || bvid;

  const description = String(meta.desc ?? readDescriptionFromDom(doc)).trim();
  const bodyMarkdown = buildBodyMarkdown({
    description,
    chapters: bundle.chapters,
    body,
    includeTimestamp: true,
  });

  const document: ContentDocument = {
    version: 1,
    metadata: {
      platform: 'bilibili',
      contentType: 'bilibili-video',
      sourceUrl: canonicalVideoUrl(bvid, pageIndex),
      author: { name: author },
      published,
      title,
      id: bvid,
    },
    body: {
      type: 'article',
      children: [{ type: 'markdown', value: bodyMarkdown }],
    },
  };
  return { document, sourceEntries: buildBilibiliSourceBlocks({ description, chapters: bundle.chapters, body }) };
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
