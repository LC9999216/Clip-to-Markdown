export interface BiliSubtitleLine { from: number; to: number; content: string }

export interface BiliTranscriptSegment { id: string; start: number; end: number; text: string }

export interface BiliSubtitleTrack {
  id: string;
  language: string;
  label: string;
  url: string;
  isAi: boolean;
}

export type BiliSubtitleErrorCode = 'NEED_LOGIN' | 'NO_SUBTITLE' | 'EMPTY_TRANSCRIPT' | 'FETCH_FAILED';

export class BiliSubtitleError extends Error {
  constructor(public readonly code: BiliSubtitleErrorCode, message: string) {
    super(message);
    this.name = 'BiliSubtitleError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
