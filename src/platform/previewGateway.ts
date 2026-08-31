import type {
  BookmarkColor,
  LibraryListing,
  NewBookmark,
  PlaybackSession,
  Progress,
  VideoEntry,
} from '../domain/library';
import type { LibraryGateway } from './gateway';

const demoNames = ['余白から考える、伝わるデザイン', '日常を切り取る、映像のつくり方'];
const demoNotes = [
  [
    '余白は、情報の優先順位をつくる。',
    '文字の大きさだけでなく、行間にもリズムを。',
    '色数を絞ると、伝えたいことが残る。',
  ],
  [
    '光がいちばん柔らかくなる時間帯。',
    '視点を少し下げて、いつもの景色を撮る。',
    'カットのつなぎ目は、動きの途中に。',
  ],
];

/** Explicit, memory-only demo. Never reads a user's files or native library. */
export class PreviewGateway implements LibraryGateway {
  readonly isNative = false;
  readonly isDevelopment = false;
  private videos: VideoEntry[] = [];
  private thumbnails = new Map<string, string>();
  private sessions = new Map<string, { videoId: string; revision: number }>();

  async initialize() {}
  async list(): Promise<LibraryListing> {
    return structuredClone({ videos: this.videos, warnings: [] });
  }
  async chooseVideos(relink = false) {
    return relink ? [] : ['demo-0', 'demo-1'];
  }
  private get(id: string) {
    const video = this.videos.find((item) => item.id === id);
    if (!video) throw new Error('動画が見つかりません。');
    return video;
  }
  async importVideo(path: string) {
    if (!/^demo-[01]$/.test(path))
      throw new Error('ブラウザプレビューではデモ動画のみ利用できます。');
    const existing = this.videos.find((video) => video.path === path);
    if (existing) return structuredClone(existing);
    const index = Number(path.slice(-1));
    const stamp = Date.now() - (1 - index) * 86_400_000;
    const colors: BookmarkColor[] =
      index === 0 ? ['sage', 'amber', 'blue'] : ['amber', 'rose', 'sage'];
    const video: VideoEntry = {
      schemaVersion: 1,
      id: crypto.randomUUID(),
      title: demoNames[index],
      path,
      fingerprint: '0'.repeat(64),
      byteLen: 2_460_000,
      modifiedAtMs: stamp,
      duration: 90,
      position: index === 0 ? 42 : 14,
      playbackRate: 1,
      coverId: `demo-${index}-0`,
      bookmarks: demoNotes[index].map((note, mark) => ({
        id: crypto.randomUUID(),
        seconds: [14, 42, 71][mark],
        note,
        color: colors[mark],
        thumbnailId: `demo-${index}-${mark}`,
        createdAtMs: stamp + mark * 600_000,
      })),
      createdAtMs: stamp,
      updatedAtMs: stamp,
      lastOpenedAtMs: stamp,
      availability: 'available',
    };
    this.videos.push(video);
    return structuredClone(video);
  }
  async openVideo(id: string): Promise<PlaybackSession> {
    const video = this.get(id);
    video.lastOpenedAtMs = Date.now();
    const sessionId = crypto.randomUUID();
    this.sessions.set(sessionId, { videoId: id, revision: 0 });
    return { video: structuredClone(video), sessionId };
  }
  async relinkVideo(_id: string, _path: string): Promise<VideoEntry> {
    throw new Error('ファイルの再指定はmacOSアプリ版で利用できます。');
  }
  async saveProgress(sessionId: string, revision: number, progress: Progress) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('再生セッションが見つかりません。');
    if (revision <= session.revision) return;
    Object.assign(this.get(session.videoId), progress);
    session.revision = revision;
  }
  async addBookmark(id: string, input: NewBookmark) {
    const video = this.get(id);
    if (!video.bookmarks.some((bookmark) => bookmark.id === input.id)) {
      video.bookmarks.push({
        id: input.id,
        note: input.note.trim(),
        seconds: input.seconds,
        color: input.color,
        thumbnailId: input.id,
        createdAtMs: Date.now(),
      });
      this.thumbnails.set(input.id, input.thumbnailDataUrl);
    }
    return structuredClone(video);
  }
  async editBookmark(id: string, bookmarkId: string, note: string, color: BookmarkColor) {
    const video = this.get(id);
    const bookmark = video.bookmarks.find((item) => item.id === bookmarkId);
    if (!bookmark) throw new Error('しおりが見つかりません。');
    Object.assign(bookmark, { note: note.trim(), color });
    return structuredClone(video);
  }
  async removeBookmark(id: string, bookmarkId: string) {
    const video = this.get(id);
    video.bookmarks = video.bookmarks.filter((item) => item.id !== bookmarkId);
    return structuredClone(video);
  }
  async saveCover(id: string, dataUrl: string) {
    const video = this.get(id);
    if (!video.coverId) {
      video.coverId = crypto.randomUUID();
      this.thumbnails.set(video.coverId, dataUrl);
    }
    return structuredClone(video);
  }
  async renameVideo(id: string, title: string) {
    this.get(id).title = title.trim();
    return structuredClone(this.get(id));
  }
  async removeVideo(id: string) {
    this.videos = this.videos.filter((item) => item.id !== id);
  }
  videoUrl(video: VideoEntry) {
    return `/demo/${video.path}.mp4`;
  }
  thumbnailUrl(id: string) {
    return this.thumbnails.get(id) ?? `/demo/${id}.jpg`;
  }
  async onDrop(_callback: (paths: string[]) => void, _hover: (hovering: boolean) => void) {
    return () => {};
  }
  async onQuitRequested(_callback: () => void) {
    return () => {};
  }
  async takeStartupPaths() {
    return [];
  }
  async finishQuit() {}
  async toggleFullscreen() {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  }
}
