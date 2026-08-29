import { BVID_RE } from './selectors';
import { extractWbiKeys, signWbiParams } from './wbi';
import type { BiliSubtitleLine, BiliSubtitleTrack } from './subtitle-types';
import { BiliSubtitleError } from './subtitle-types';

export type BiliJsonRequest = (
  url: string,
  credentials?: 'include' | 'omit',
) => Promise<unknown>;

export interface BiliSubtitleResource {
  identity: { bvid: string; pageIndex: number; cid: number };
  title: string;
  author: string;
  part: string;
  description: string;
  publishedAt: number;
  tracks: BiliSubtitleTrack[];
  selectedTrackId: string | null;
  lines: BiliSubtitleLine[];
  chapters: Array<{ title: string; from: number; to: number }>;
}

interface BiliApiResponse<T = unknown> {
  code: number;
  message?: string;
  data: T;
}

interface BiliViewData {
  aid?: unknown;
  title?: unknown;
  desc?: unknown;
  pubdate?: unknown;
  owner?: { name?: unknown };
  cid?: unknown;
  pages?: unknown;
}

interface BiliNavData {
  isLogin?: unknown;
  img_url?: unknown;
  sub_url?: unknown;
}

interface BiliSubtitleRawTrack {
  id?: unknown;
  id_str?: unknown;
  lan?: unknown;
  lan_doc?: unknown;
  subtitle_url?: unknown;
  ai_status?: unknown;
  ai_type?: unknown;
}

interface BiliPlayerData {
  subtitle?: { subtitles?: unknown };
  view_points?: unknown;
}

interface BiliViewPage {
  cid?: unknown;
  page?: unknown;
  part?: unknown;
}

type SubtitleMetadata = Omit<BiliSubtitleResource, 'tracks' | 'selectedTrackId' | 'lines'>;

interface BiliSubtitleErrorContext {
  phase?: 'cdn';
  resource?: BiliSubtitleResource;
}

const API_BASE = 'https://api.bilibili.com';

function fail(message: string): never {
  throw new BiliSubtitleError('FETCH_FAILED', message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readApi<T>(value: unknown, label: string): BiliApiResponse<T> {
  if (!isRecord(value) || typeof value.code !== 'number') fail(`${label} 响应格式错误`);
  if (value.code !== 0) fail(String(value.message || `${label} 请求失败（${value.code}）`));
  if (!('data' in value)) fail(`${label} 响应缺少 data`);
  return value as unknown as BiliApiResponse<T>;
}

async function requestApi<T>(requestJson: BiliJsonRequest, url: string, label: string): Promise<BiliApiResponse<T>> {
  try {
    // B 站 API 通过 background 的默认 include 携带当前登录态。
    return readApi<T>(await requestJson(url), label);
  } catch (error) {
    if (error instanceof BiliSubtitleError) throw error;
    fail(error instanceof Error ? error.message : `${label} 请求失败`);
  }
}

function numberOr(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positiveInteger(value: unknown, fallback: number): number {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function nonNegativeInteger(value: unknown, fallback: number): number {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function bvidFromUrl(url: URL): string {
  return BVID_RE.exec(url.pathname)?.[1] ?? '';
}

function pageIndexFromUrl(url: URL): number {
  return positiveInteger(url.searchParams.get('p'), 1);
}

function choosePage(pages: unknown, pageIndex: number, fallbackCid: number): { cid: number; part: string } {
  const list = Array.isArray(pages) ? pages.filter(isRecord) as BiliViewPage[] : [];
  const byPage = list.find((page) => Number(page.page) === pageIndex) ?? list[pageIndex - 1] ?? list[0];
  const cid = positiveInteger(byPage?.cid, fallbackCid);
  return { cid, part: String(byPage?.part ?? '') };
}

function normalizeLanguage(value: unknown): string {
  return String(value ?? '').trim().replace(/_/g, '-').toLowerCase();
}

function normalizeFlag(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) && value > 0;
  const text = String(value ?? '').trim().toLowerCase();
  if (!text || text === '0' || text === 'false' || text === 'no' || text === 'off') return false;
  const number = Number(text);
  return Number.isFinite(number) ? number > 0 : true;
}

function isAiTrack(track: BiliSubtitleRawTrack): boolean {
  return normalizeFlag(track.ai_type) || normalizeFlag(track.ai_status);
}

function isChineseTrack(language: string, label: string): boolean {
  return language === 'zh' || language.startsWith('zh-') || label.includes('中文') || label.includes('汉语');
}

function subtitlePriority(track: BiliSubtitleTrack): number {
  const chinese = isChineseTrack(track.language, track.label);
  if (chinese) return track.isAi ? 1 : 0;
  return track.isAi ? 3 : 2;
}

function normalizeSubtitleUrl(value: unknown): string | null {
  let text = String(value ?? '').trim();
  if (!text) return null;
  if (text.startsWith('//')) text = `https:${text}`;
  try {
    const url = new URL(text);
    const hostname = url.hostname.toLowerCase();
    const isHdslbHost = hostname === 'hdslb.com' || hostname.endsWith('.hdslb.com');
    if (url.protocol !== 'https:' || !isHdslbHost) return null;
    return url.href;
  } catch {
    return null;
  }
}

function normalizeTracks(value: unknown): BiliSubtitleTrack[] {
  if (!Array.isArray(value)) fail('字幕轨列表格式错误');
  const normalized: BiliSubtitleTrack[] = [];
  value.forEach((raw, index) => {
    if (!isRecord(raw)) return;
    const track = raw as BiliSubtitleRawTrack;
    const url = normalizeSubtitleUrl(track.subtitle_url);
    if (!url) return;
    const language = normalizeLanguage(track.lan);
    const label = String(track.lan_doc ?? '').trim() || language || `字幕 ${index + 1}`;
    const rawId = String(track.id_str ?? track.id ?? '').trim();
    const id = rawId || `track-${index + 1}`;
    normalized.push({ id, language, label, url, isAi: isAiTrack(track) });
  });
  return normalized.sort((left, right) => subtitlePriority(left) - subtitlePriority(right));
}

function normalizeTime(value: unknown): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return 0;
  return number > 60 * 60 * 24 ? number / 1000 : number;
}

function normalizeChapters(value: unknown): Array<{ title: string; from: number; to: number }> {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) fail('章节响应格式错误');
  return value
    .filter(isRecord)
    .map((point) => ({
      title: String(point.content ?? '').trim(),
      from: normalizeTime(point.from),
      to: normalizeTime(point.to),
    }))
    .filter((chapter) => chapter.title)
    .sort((left, right) => left.from - right.from);
}

function normalizeBody(value: unknown): BiliSubtitleLine[] {
  if (!isRecord(value) || !Array.isArray(value.body)) fail('字幕正文格式错误');
  return value.body
    .filter(isRecord)
    .map((line) => ({
      from: normalizeTime(line.from),
      to: normalizeTime(line.to),
      content: String(line.content ?? '').trim(),
    }))
    .filter((line) => line.content.length > 0);
}

function emptyResource(metadata: SubtitleMetadata): BiliSubtitleResource {
  return { ...metadata, tracks: [], selectedTrackId: null, lines: [] };
}

function markCdnFailure(error: unknown, metadata: SubtitleMetadata): BiliSubtitleError {
  const failure = error instanceof BiliSubtitleError
    ? error
    : new BiliSubtitleError('FETCH_FAILED', error instanceof Error ? error.message : '字幕正文请求失败');
  Object.assign(failure as BiliSubtitleError & BiliSubtitleErrorContext, {
    phase: 'cdn',
    resource: emptyResource(metadata),
  });
  return failure;
}

export async function fetchBilibiliSubtitleResource(args: {
  url: URL;
  requestJson: BiliJsonRequest;
  preferredTrackId?: string;
  nowSeconds?: number;
  allowEmpty?: boolean;
}): Promise<BiliSubtitleResource> {
  const bvid = bvidFromUrl(args.url);
  if (!bvid) fail('无法从 URL 取得 BV 号');
  const pageIndex = pageIndexFromUrl(args.url);

  const view = await requestApi<BiliViewData>(
    args.requestJson,
    `${API_BASE}/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`,
    '视频信息',
  );
  if (!isRecord(view.data)) fail('视频信息响应格式错误');
  const viewData = view.data as BiliViewData;
  const fallbackCid = positiveInteger(viewData.cid, 0);
  const page = choosePage(viewData.pages, pageIndex, fallbackCid);
  if (!page.cid) fail('视频信息缺少 cid');

  const nav = await requestApi<BiliNavData>(args.requestJson, `${API_BASE}/x/web-interface/nav`, '登录信息');
  if (!isRecord(nav.data) || !('isLogin' in nav.data)) fail('登录信息响应格式错误');
  const navData = nav.data as BiliNavData;
  const isLogin = normalizeFlag(navData.isLogin);

  let player: BiliApiResponse<BiliPlayerData>;
  try {
    const keys = extractWbiKeys({
      img_url: String(navData.img_url ?? ''),
      sub_url: String(navData.sub_url ?? ''),
    });
    const signedQuery = signWbiParams(
      { aid: positiveInteger(viewData.aid, 0), cid: page.cid, bvid },
      keys,
      nonNegativeInteger(args.nowSeconds, Math.floor(Date.now() / 1000)),
    );
    player = await requestApi<BiliPlayerData>(args.requestJson, `${API_BASE}/x/player/wbi/v2?${signedQuery}`, '字幕轨列表');
  } catch (error) {
    if (error instanceof BiliSubtitleError) throw error;
    fail(error instanceof Error ? error.message : '字幕轨列表请求失败');
  }
  if (!isRecord(player.data)) fail('字幕轨列表响应格式错误');
  const subtitle = player.data.subtitle;
  if (subtitle !== undefined && subtitle !== null && !isRecord(subtitle)) fail('字幕轨列表响应格式错误');
  const tracks = subtitle === undefined || subtitle === null
    ? []
    : normalizeTracks(subtitle.subtitles);
  const chapters = normalizeChapters(player.data.view_points);
  const metadata = {
    identity: { bvid, pageIndex, cid: page.cid },
    title: String(viewData.title ?? '').trim(),
    author: String(viewData.owner?.name ?? '').trim(),
    part: page.part,
    description: String(viewData.desc ?? '').trim(),
    publishedAt: Math.max(0, numberOr(viewData.pubdate, 0)),
    chapters,
  };

  if (tracks.length === 0) {
    if (args.allowEmpty) return emptyResource(metadata);
    throw new BiliSubtitleError(isLogin ? 'NO_SUBTITLE' : 'NEED_LOGIN', isLogin ? '当前视频没有可用字幕' : '请登录 B 站后查看字幕');
  }

  const preferred = args.preferredTrackId
    ? tracks.find((track) => track.id === args.preferredTrackId)
    : undefined;
  const selected = preferred ?? tracks[0]!;
  let lines: BiliSubtitleLine[];
  try {
    lines = normalizeBody(await args.requestJson(selected.url, 'omit'));
  } catch (error) {
    throw markCdnFailure(error, metadata);
  }
  if (lines.length === 0) {
    throw markCdnFailure(new BiliSubtitleError('EMPTY_TRANSCRIPT', '字幕正文为空'), metadata);
  }
  return { ...metadata, tracks, selectedTrackId: selected.id, lines };
}
