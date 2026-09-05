import type {
  BookmarkColor,
  LibraryListing,
  NewBookmark,
  PlaybackSession,
  Progress,
  VideoEntry,
} from '../domain/library';

export interface LibraryGateway {
  readonly isNative: boolean;
  readonly isDevelopment: boolean;
  initialize(): Promise<void>;
  list(): Promise<LibraryListing>;
  chooseVideos(relink?: boolean): Promise<string[]>;
  importVideo(path: string): Promise<VideoEntry>;
  openVideo(id: string): Promise<PlaybackSession>;
  relinkVideo(id: string, path: string): Promise<VideoEntry>;
  saveProgress(sessionId: string, revision: number, progress: Progress): Promise<void>;
  addBookmark(id: string, input: NewBookmark): Promise<VideoEntry>;
  editBookmark(
    id: string,
    bookmarkId: string,
    note: string,
    color: BookmarkColor,
    endSeconds?: number | null,
  ): Promise<VideoEntry>;
  removeBookmark(id: string, bookmarkId: string): Promise<VideoEntry>;
  saveCover(id: string, dataUrl: string): Promise<VideoEntry>;
  renameVideo(id: string, title: string): Promise<VideoEntry>;
  removeVideo(id: string): Promise<void>;
  videoUrl(video: VideoEntry): string;
  thumbnailUrl(id: string): string;
  onDrop(
    callback: (paths: string[]) => void,
    hover: (hovering: boolean) => void,
  ): Promise<() => void>;
  onQuitRequested(callback: () => void): Promise<() => void>;
  takeStartupPaths(): Promise<string[]>;
  finishQuit(): Promise<void>;
  toggleFullscreen(): Promise<void>;
}
