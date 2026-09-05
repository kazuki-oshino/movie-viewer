export type BookmarkColor = 'sage' | 'amber' | 'blue' | 'rose';
export type Availability = 'available' | 'missing' | 'changed' | 'inaccessible';

export interface Bookmark {
  id: string;
  seconds: number;
  endSeconds?: number | null;
  note: string;
  color: BookmarkColor;
  thumbnailId: string;
  createdAtMs: number;
}

export interface VideoEntry {
  schemaVersion: number;
  id: string;
  title: string;
  path: string;
  fingerprint: string;
  byteLen: number;
  modifiedAtMs: number | null;
  duration: number;
  position: number;
  playbackRate: number;
  coverId: string | null;
  bookmarks: Bookmark[];
  createdAtMs: number;
  updatedAtMs: number;
  lastOpenedAtMs: number | null;
  availability: Availability;
}

export interface LibraryListing {
  videos: VideoEntry[];
  warnings: string[];
}

export interface PlaybackSession {
  video: VideoEntry;
  sessionId: string;
}

export interface Progress {
  position: number;
  duration: number;
  playbackRate: number;
}

export interface NewBookmark {
  id: string;
  seconds: number;
  endSeconds?: number | null;
  note: string;
  color: BookmarkColor;
  thumbnailDataUrl: string;
}

export interface ShelfItem {
  video: VideoEntry;
  bookmark: Bookmark;
}

export const COLORS: { value: BookmarkColor; label: string }[] = [
  { value: 'sage', label: 'セージ' },
  { value: 'amber', label: 'アンバー' },
  { value: 'blue', label: 'ブルー' },
  { value: 'rose', label: 'ローズ' },
];

export const PLAYBACK_RATES = Array.from({ length: 20 }, (_, index) => (index + 1) / 10);

export function clampTime(time: number, duration: number) {
  if (!Number.isFinite(time) || !Number.isFinite(duration) || duration <= 0) return 0;
  return Math.min(Math.max(time, 0), duration);
}

export function formatTime(seconds: number) {
  const value = Math.floor(Math.max(0, Number.isFinite(seconds) ? seconds : 0));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const rest = String(value % 60).padStart(2, '0');
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}`
    : `${minutes}:${rest}`;
}

export function formatRepeatTime(seconds: number) {
  return `${formatTime(seconds)}.${Math.floor((seconds + 0.00001) * 10) % 10}`;
}

export function bookmarkTime(bookmark: Pick<Bookmark, 'seconds' | 'endSeconds'>) {
  return bookmark.endSeconds == null
    ? formatTime(bookmark.seconds)
    : `${formatRepeatTime(bookmark.seconds)}–${formatRepeatTime(bookmark.endSeconds)}`;
}

export function bookmarkAction(bookmark: Pick<Bookmark, 'seconds' | 'endSeconds'>) {
  return `${bookmarkTime(bookmark)}${bookmark.endSeconds == null ? 'から再生' : 'をリピート'}`;
}

export function formatSize(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

export function normalizeSearch(query: string) {
  return query.normalize('NFKC').toLocaleLowerCase('ja').trim();
}

export function matchesSearch(query: string, ...values: string[]) {
  const haystack = normalizeSearch(values.join(' '));
  return normalizeSearch(query)
    .split(/\s+/u)
    .every((word) => haystack.includes(word));
}

export function shelfItems(
  videos: VideoEntry[],
  query: string,
  videoId: string,
  color: BookmarkColor | 'all',
  sort: 'newest' | 'timeline',
): ShelfItem[] {
  return videos
    .flatMap((video) => video.bookmarks.map((bookmark) => ({ video, bookmark })))
    .filter(
      ({ video, bookmark }) =>
        (videoId === 'all' || video.id === videoId) &&
        (color === 'all' || bookmark.color === color) &&
        matchesSearch(query, video.title, bookmark.note, bookmarkTime(bookmark)),
    )
    .sort((a, b) =>
      sort === 'newest'
        ? b.bookmark.createdAtMs - a.bookmark.createdAtMs ||
          a.bookmark.id.localeCompare(b.bookmark.id)
        : a.video.title.localeCompare(b.video.title, 'ja') ||
          a.bookmark.seconds - b.bookmark.seconds ||
          a.bookmark.id.localeCompare(b.bookmark.id),
    );
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error)
    return String(error.message);
  return typeof error === 'string'
    ? error
    : '処理を完了できませんでした。もう一度お試しください。';
}

export function isTypingTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    Boolean(target.closest('input, textarea, select, [contenteditable="true"], dialog'))
  );
}
