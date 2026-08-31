import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open } from '@tauri-apps/plugin-dialog';
import type {
  BookmarkColor,
  LibraryListing,
  NewBookmark,
  PlaybackSession,
  Progress,
  VideoEntry,
} from '../domain/library';
import type { LibraryGateway } from './gateway';

export class TauriGateway implements LibraryGateway {
  readonly isNative = true;
  isDevelopment = import.meta.env.MODE === 'isolated';
  private thumbnailDirectory = '';

  async initialize() {
    const info = await invoke<{ thumbnailDirectory: string; isDevelopment: boolean }>(
      'app_info',
    );
    this.thumbnailDirectory = info.thumbnailDirectory;
    this.isDevelopment = info.isDevelopment;
  }
  list() {
    return invoke<LibraryListing>('list_videos');
  }
  async chooseVideos(relink = false) {
    const paths = await open({
      directory: false,
      multiple: !relink,
      title: relink ? '移動後の動画ファイルを選択' : 'しおり棚に動画を追加',
      filters: [{ name: '動画', extensions: ['mp4', 'mov', 'm4v'] }],
    });
    return paths === null ? [] : Array.isArray(paths) ? paths : [paths];
  }
  importVideo(path: string) {
    return invoke<VideoEntry>('import_video', { path });
  }
  openVideo(id: string) {
    return invoke<PlaybackSession>('open_video', { id });
  }
  relinkVideo(id: string, path: string) {
    return invoke<VideoEntry>('relink_video', { id, path });
  }
  saveProgress(sessionId: string, revision: number, progress: Progress) {
    return invoke<void>('save_progress', { sessionId, revision, progress });
  }
  addBookmark(id: string, input: NewBookmark) {
    return invoke<VideoEntry>('add_bookmark', { id, input });
  }
  editBookmark(id: string, bookmarkId: string, note: string, color: BookmarkColor) {
    return invoke<VideoEntry>('edit_bookmark', { id, bookmarkId, note, color });
  }
  removeBookmark(id: string, bookmarkId: string) {
    return invoke<VideoEntry>('remove_bookmark', { id, bookmarkId });
  }
  saveCover(id: string, dataUrl: string) {
    return invoke<VideoEntry>('save_cover', { id, dataUrl });
  }
  renameVideo(id: string, title: string) {
    return invoke<VideoEntry>('rename_video', { id, title });
  }
  removeVideo(id: string) {
    return invoke<void>('remove_video', { id });
  }
  videoUrl(video: VideoEntry) {
    return convertFileSrc(video.path);
  }
  thumbnailUrl(id: string) {
    return convertFileSrc(`${this.thumbnailDirectory}/${id}.jpg`);
  }
  onDrop(callback: (paths: string[]) => void, hover: (hovering: boolean) => void) {
    return getCurrentWebview().onDragDropEvent(({ payload }) => {
      hover(payload.type === 'enter' || payload.type === 'over');
      if (payload.type === 'drop') callback(payload.paths);
    });
  }
  onQuitRequested(callback: () => void) {
    return listen('request-quit', callback);
  }
  takeStartupPaths() {
    return invoke<string[]>('take_startup_paths');
  }
  finishQuit() {
    return invoke<void>('finish_quit');
  }
  async toggleFullscreen() {
    const window = getCurrentWindow();
    await window.setFullscreen(!(await window.isFullscreen()));
  }
}
