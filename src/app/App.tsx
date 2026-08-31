import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bookmark,
  Check,
  ChevronRight,
  CircleAlert,
  Clock3,
  Film,
  FolderInput,
  HelpCircle,
  Keyboard,
  Library,
  LockKeyhole,
  Plus,
  Search,
  ShieldCheck,
  X,
} from 'lucide-react';
import {
  errorMessage,
  formatTime,
  isTypingTarget,
  type Bookmark as BookmarkType,
  type LibraryListing,
  type PlaybackSession,
  type ShelfItem,
  type VideoEntry,
} from '../domain/library';
import type { CapturedFrame } from '../application/captureFrame';
import type { LibraryGateway } from '../platform/gateway';
import { Button, IconButton } from '../components/Button';
import { Modal } from '../components/Modal';
import { HelpDialog } from '../components/HelpDialog';
import { LibraryView } from '../features/library/LibraryView';
import { DeleteDialog, VideoInfoDialog } from '../features/library/VideoInfoDialog';
import { BookmarkEditor, type BookmarkDraft } from '../features/bookmarks/BookmarkEditor';
import { Player, type PlayerHandle } from '../features/player/Player';

type View = 'shelf' | 'videos' | 'recent' | 'player';
interface Opened {
  session: PlaybackSession;
  initialSeconds?: number;
  autoplay: boolean;
}
interface SourceError {
  video: VideoEntry;
  message: string;
  seconds?: number;
}

export function App({ gateway }: { gateway: LibraryGateway }) {
  const [videos, setVideos] = useState<VideoEntry[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [view, setView] = useState<View>('shelf');
  const [opened, setOpened] = useState<Opened | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState('');
  const [dragging, setDragging] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; error: boolean } | null>(null);
  const [help, setHelp] = useState(false);
  const [editor, setEditor] = useState<BookmarkDraft | null>(null);
  const [info, setInfo] = useState<VideoEntry | null>(null);
  const [deleting, setDeleting] = useState<{
    video: VideoEntry;
    bookmark?: BookmarkType;
  } | null>(null);
  const [sourceError, setSourceError] = useState<SourceError | null>(null);
  const player = useRef<PlayerHandle>(null);
  const search = useRef<HTMLInputElement>(null);
  const actionLock = useRef(false);
  const quitting = useRef(false);
  const operations = useRef(new Set<Promise<unknown>>());
  const actions = useRef({
    importPaths: async (_paths: string[]) => {},
    quit: async () => {},
  });
  const totalMarks = videos.reduce((count, video) => count + video.bookmarks.length, 0);
  const activeVideo = opened
    ? (videos.find((video) => video.id === opened.session.video.id) ?? opened.session.video)
    : null;

  const notify = useCallback(
    (text: string, error = false) => setFeedback({ text, error }),
    [],
  );
  const report = useCallback((message: string) => notify(message, true), [notify]);
  const mergeVideo = useCallback(
    (entry: VideoEntry) =>
      setVideos((current) =>
        current.some((video) => video.id === entry.id)
          ? current.map((video) => (video.id === entry.id ? entry : video))
          : [entry, ...current],
      ),
    [],
  );
  const applyListing = useCallback((listing: LibraryListing) => {
    setVideos(listing.videos);
    setWarnings(listing.warnings);
  }, []);

  useEffect(() => {
    if (!feedback || feedback.error) return;
    const timer = window.setTimeout(() => setFeedback(null), 4_000);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  useEffect(() => {
    let disposed = false;
    const cleanups: (() => void)[] = [];
    async function connect() {
      try {
        const quit = await gateway.onQuitRequested(() => void actions.current.quit());
        if (disposed) {
          quit();
          return;
        }
        cleanups.push(quit);
        // Keep native quit available even if initialization or library loading fails.
        await gateway.initialize();
        const listing = await gateway.list();
        if (disposed) return;
        applyListing(listing);
        setLoading(false);
        const drop = await gateway.onDrop(
          (paths) => void actions.current.importPaths(paths),
          setDragging,
        );
        if (disposed) {
          drop();
          return;
        }
        cleanups.push(drop);
        const paths = await gateway.takeStartupPaths();
        if (!disposed && paths.length) await actions.current.importPaths(paths);
      } catch (error) {
        if (!disposed) {
          setLoadError(errorMessage(error));
          setLoading(false);
        }
      }
    }
    void connect();
    return () => {
      disposed = true;
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [gateway, applyListing]);

  function tracked<T>(operation: Promise<T>): Promise<T> {
    operations.current.add(operation);
    void operation.finally(() => operations.current.delete(operation)).catch(() => {});
    return operation;
  }

  async function refresh() {
    const listing = await gateway.list();
    applyListing(listing);
  }

  async function navigate(next: Exclude<View, 'player'>) {
    if (actionLock.current || quitting.current) return;
    actionLock.current = true;
    try {
      player.current?.pause();
      await player.current?.flush();
      await Promise.all([...operations.current]);
      await refresh();
      setOpened(null);
      setView(next);
    } catch (error) {
      notify(errorMessage(error), true);
    } finally {
      actionLock.current = false;
    }
  }

  async function openVideo(video: VideoEntry, seconds?: number) {
    if (actionLock.current || quitting.current) return;
    if (
      opened?.session.video.id === video.id &&
      view === 'player' &&
      seconds !== undefined &&
      player.current
    ) {
      player.current.seek(seconds, true);
      return;
    }
    actionLock.current = true;
    setBusy('動画を確認しています…');
    let openingSource = false;
    try {
      player.current?.pause();
      await player.current?.flush();
      await Promise.all([...operations.current]);
      openingSource = true;
      const session = await gateway.openVideo(video.id);
      mergeVideo(session.video);
      setOpened({ session, initialSeconds: seconds, autoplay: seconds !== undefined });
      setView('player');
      setSourceError(null);
    } catch (error) {
      if (openingSource) setSourceError({ video, message: errorMessage(error), seconds });
      else notify(errorMessage(error), true);
    } finally {
      actionLock.current = false;
      setBusy('');
    }
  }

  async function importPaths(paths: string[]) {
    if (!paths.length || actionLock.current || quitting.current) return;
    if (editor || info || deleting || help || sourceError) {
      notify('開いているダイアログを閉じてから、動画を追加してください。', true);
      return;
    }
    actionLock.current = true;
    setDragging(false);
    const imported: VideoEntry[] = [];
    const failures: string[] = [];
    try {
      player.current?.pause();
      await player.current?.flush();
      await Promise.all([...operations.current]);
      for (const [index, path] of paths.entries()) {
        setBusy(`動画を追加しています (${index + 1} / ${paths.length})`);
        try {
          const video = await gateway.importVideo(path);
          imported.push(video);
          mergeVideo(video);
        } catch (error) {
          failures.push(`${path.split('/').pop()}: ${errorMessage(error)}`);
        }
      }
      await refresh();
      if (imported.length) {
        setOpened(null);
        setView(gateway.isNative ? 'videos' : 'shelf');
      }
      if (failures.length) notify(failures.join('\n'), true);
      else if (imported.length)
        notify(
          gateway.isNative
            ? '動画をライブラリに追加しました。'
            : 'デモライブラリを読み込みました。変更はこのプレビュー内だけに反映されます。',
        );
    } catch (error) {
      notify(errorMessage(error), true);
    } finally {
      setBusy('');
      actionLock.current = false;
    }
    if (imported.length === 1 && !failures.length) await openVideo(imported[0]);
  }

  async function chooseImport() {
    if (actionLock.current || quitting.current) return;
    try {
      const paths = await gateway.chooseVideos();
      await importPaths(paths);
    } catch (error) {
      notify(errorMessage(error), true);
    }
  }

  async function relink(video: VideoEntry, seconds?: number) {
    if (actionLock.current || quitting.current) return;
    if (!gateway.isNative) {
      notify('ファイルの再指定はmacOSアプリ版で利用できます。');
      return;
    }
    actionLock.current = true;
    let updated: VideoEntry | null = null;
    let choosingSource = false;
    try {
      player.current?.pause();
      await player.current?.flush();
      choosingSource = true;
      const paths = await gateway.chooseVideos(true);
      if (!paths[0]) return;
      setBusy('元の動画と内容を照合しています…');
      updated = await gateway.relinkVideo(video.id, paths[0]);
      mergeVideo(updated);
      setInfo(null);
      setSourceError(null);
      setOpened(null);
      setView('videos');
      notify('新しい場所に接続しました。しおりと再生位置はそのままです。');
    } catch (error) {
      if (choosingSource) {
        setInfo(null);
        setSourceError({ video, message: errorMessage(error), seconds });
      } else notify(errorMessage(error), true);
    } finally {
      setBusy('');
      actionLock.current = false;
    }
    if (updated) await openVideo(updated, seconds);
  }

  function beginNewBookmark(frame: CapturedFrame) {
    if (!activeVideo || quitting.current) return;
    setEditor({
      kind: 'new',
      id: crypto.randomUUID(),
      videoId: activeVideo.id,
      videoTitle: activeVideo.title,
      seconds: frame.seconds,
      thumbnail: frame.dataUrl,
      note: '',
      color: 'sage',
    });
  }

  function beginEdit({ video, bookmark }: ShelfItem) {
    player.current?.pause();
    setEditor({
      kind: 'edit',
      id: bookmark.id,
      videoId: video.id,
      videoTitle: video.title,
      seconds: bookmark.seconds,
      thumbnail: gateway.thumbnailUrl(bookmark.thumbnailId),
      note: bookmark.note,
      color: bookmark.color,
    });
  }

  async function quit() {
    if (quitting.current) return;
    if (editor || info || deleting || help || sourceError) {
      notify(
        '開いているダイアログを保存または閉じてから、もう一度終了してください。',
        true,
      );
      return;
    }
    if (actionLock.current) {
      notify('処理の完了を待ってから、もう一度終了してください。');
      return;
    }
    quitting.current = true;
    setBusy('記録を保存して終了しています…');
    try {
      player.current?.pause();
      await player.current?.flush();
      await Promise.all([...operations.current]);
      await gateway.finishQuit();
    } catch (error) {
      notify(`終了を中止しました。${errorMessage(error)}`, true);
    } finally {
      quitting.current = false;
      setBusy('');
    }
  }

  actions.current = { importPaths, quit };

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        busy ||
        loading ||
        document.querySelector('dialog[open]')
      )
        return;
      const key = event.key.toLowerCase();
      const command = event.metaKey || event.ctrlKey;
      if (command && key === 'o') {
        event.preventDefault();
        void chooseImport();
        return;
      }
      if (command && key === 'k') {
        event.preventDefault();
        void navigate('shelf').then(() =>
          window.setTimeout(() => search.current?.focus(), 0),
        );
        return;
      }
      if (command && key === 'l') {
        event.preventDefault();
        void navigate('shelf');
        return;
      }
      if (command && key === 's') {
        event.preventDefault();
        void player.current
          ?.flush()
          .then(() => notify('再生位置を保存しました。'))
          .catch((error: unknown) => notify(errorMessage(error), true));
        return;
      }
      if (command || isTypingTarget(event.target)) return;
      if (event.key === '?') {
        event.preventDefault();
        setHelp(true);
        return;
      }
      if (view !== 'player' || !player.current) return;
      if (
        event.code === 'Space' &&
        !(event.target instanceof HTMLElement && event.target.closest('button'))
      ) {
        event.preventDefault();
        if (!event.repeat) player.current.togglePlay();
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        player.current.skip(
          (event.key === 'ArrowLeft' ? -1 : 1) *
            (event.altKey ? 60 : event.shiftKey ? 30 : 10),
        );
      }
      if (key === 'b' && !event.repeat) {
        event.preventDefault();
        void player.current.bookmark();
      }
      if (key === 'f' && !event.repeat) {
        event.preventDefault();
        void gateway
          .toggleFullscreen()
          .catch((error: unknown) => notify(errorMessage(error), true));
      }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  });

  return (
    <div className={`app ${!gateway.isNative ? 'is-preview' : ''}`}>
      <div className="titlebar" data-tauri-drag-region>
        {!gateway.isNative && (
          <div className="traffic-lights" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
        )}
        <span data-tauri-drag-region>
          SHIORI <span>—</span>{' '}
          {gateway.isDevelopment
            ? 'DEV · ISOLATED LIBRARY'
            : gateway.isNative
              ? 'YOUR PERSONAL VIDEO SHELF'
              : 'BROWSER PREVIEW'}
        </span>
        <LockKeyhole size={11} />
      </div>
      <div className="app-body">
        <aside className="sidebar">
          <div className="brand">
            <div className="brand-icon">
              <Bookmark size={23} strokeWidth={1.4} />
            </div>
            <div>
              <strong>
                shiori<span>.</span>
              </strong>
              <p>見たい瞬間を、手元に。</p>
            </div>
          </div>
          <div className="sidebar-label">ライブラリ</div>
          <nav aria-label="メインナビゲーション">
            <button
              className={view === 'shelf' ? 'is-active' : ''}
              aria-current={view === 'shelf' ? 'page' : undefined}
              onClick={() => void navigate('shelf')}
            >
              <Bookmark size={17} />
              しおり棚<span>{totalMarks}</span>
            </button>
            <button
              className={view === 'videos' ? 'is-active' : ''}
              aria-current={view === 'videos' ? 'page' : undefined}
              onClick={() => void navigate('videos')}
            >
              <Library size={17} />
              すべての動画<span>{videos.length}</span>
            </button>
            <button
              className={view === 'recent' ? 'is-active' : ''}
              aria-current={view === 'recent' ? 'page' : undefined}
              onClick={() => void navigate('recent')}
            >
              <Clock3 size={17} />
              最近見た動画
            </button>
          </nav>
          <div className="sidebar-divider" />
          <div className="sidebar-label sidebar-videos-heading">
            動画
            <IconButton
              label="動画を追加"
              onClick={() => void chooseImport()}
              disabled={loading || !!busy}
            >
              <Plus size={14} />
            </IconButton>
          </div>
          {videos.length > 0 ? (
            <div className="sidebar-videos">
              {videos.slice(0, 7).map((video) => (
                <button
                  key={video.id}
                  className={
                    activeVideo?.id === video.id && view === 'player' ? 'is-active' : ''
                  }
                  onClick={() => void openVideo(video)}
                  title={video.title}
                >
                  <Film size={15} />
                  <span>{video.title}</span>
                  {video.availability !== 'available' && (
                    <CircleAlert size={12} className="missing-label" />
                  )}
                </button>
              ))}
              {videos.length > 7 && (
                <button className="sidebar-more" onClick={() => void navigate('videos')}>
                  すべて見る
                  <ChevronRight size={13} />
                </button>
              )}
            </div>
          ) : (
            <p className="sidebar-empty">
              追加した動画が
              <br />
              ここに並びます。
            </p>
          )}
          <div className="sidebar-bottom">
            <div className="local-note">
              <span className="local-icon">
                <LockKeyhole size={16} />
              </span>
              <div>
                <strong>
                  {gateway.isNative ? 'ローカルに、しっかり。' : 'デモだけのプレビュー'}
                </strong>
                <p>
                  {gateway.isNative
                    ? 'クラウドへのアップロードなし'
                    : '再読み込みで初期状態に戻ります'}
                </p>
              </div>
            </div>
            <button
              className="help-button"
              onClick={() => {
                player.current?.pause();
                setHelp(true);
              }}
            >
              <HelpCircle size={16} />
              使い方とショートカット<kbd>?</kbd>
            </button>
            <div className="sidebar-version">
              <span>SHIORI</span>
              <span>0.1.0</span>
            </div>
          </div>
        </aside>
        <main className="main-area">
          <header className="topbar">
            <div className="breadcrumb">
              <span>ライブラリ</span>
              <ChevronRight size={13} />
              <strong>
                {view === 'shelf'
                  ? 'しおり棚'
                  : view === 'videos'
                    ? 'すべての動画'
                    : view === 'recent'
                      ? '最近見た動画'
                      : '動画を再生'}
              </strong>
            </div>
            <div className="topbar-actions">
              <div className="search-field">
                <Search size={16} />
                <input
                  ref={search}
                  aria-label="しおり・動画を検索"
                  placeholder="メモや動画を検索…"
                  value={query}
                  disabled={view === 'player'}
                  onChange={(event) => setQuery(event.target.value)}
                />
                {query ? (
                  <IconButton label="検索をクリア" onClick={() => setQuery('')}>
                    <X size={14} />
                  </IconButton>
                ) : (
                  <kbd>⌘ K</kbd>
                )}
              </div>
              <Button
                variant="primary"
                onClick={() => void chooseImport()}
                disabled={loading || !!busy || !!loadError}
              >
                <Plus size={16} />
                {gateway.isNative ? '動画を追加' : 'デモを追加'}
              </Button>
            </div>
          </header>
          {warnings.length > 0 && (
            <details className="library-warning">
              <summary>
                <CircleAlert size={14} />
                読み込めない保存データが{warnings.length}
                件あります（元の記録は保持しています）
              </summary>
              <ul>
                {warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </details>
          )}
          {loading ? (
            <div className="app-loading">
              <span className="spinner" />
              <p>しおり棚を読み込んでいます…</p>
            </div>
          ) : loadError ? (
            <div className="load-error" role="alert">
              <CircleAlert size={35} strokeWidth={1.3} />
              <h1>ライブラリを読み込めませんでした</h1>
              <p>{loadError}</p>
              <Button onClick={() => window.location.reload()}>もう一度読み込む</Button>
            </div>
          ) : opened && activeVideo && view === 'player' ? (
            <Player
              key={opened.session.sessionId}
              ref={player}
              session={opened.session}
              video={activeVideo}
              gateway={gateway}
              initialSeconds={opened.initialSeconds}
              autoplay={opened.autoplay}
              onBack={() => void navigate('shelf')}
              onInfo={() => {
                player.current?.pause();
                setInfo(activeVideo);
              }}
              onRelink={() => void relink(activeVideo)}
              onBookmark={beginNewBookmark}
              onEdit={(bookmark) => beginEdit({ video: activeVideo, bookmark })}
              onUpdated={mergeVideo}
              onNotice={report}
            />
          ) : (
            <LibraryView
              view={view === 'player' ? 'shelf' : view}
              videos={videos}
              gateway={gateway}
              query={query}
              onOpen={(video, seconds) => void openVideo(video, seconds)}
              onEdit={beginEdit}
              onDelete={({ video, bookmark }) => setDeleting({ video, bookmark })}
              onInfo={setInfo}
              onImport={() => void chooseImport()}
              onClearSearch={() => setQuery('')}
            />
          )}
        </main>
      </div>
      {(busy || dragging) && (
        <div className="busy-overlay" role="status">
          <div className="busy-card">
            {dragging ? (
              <FolderInput size={35} strokeWidth={1.4} />
            ) : (
              <span className="spinner" />
            )}
            <h2>{dragging ? '動画をドロップして追加' : busy}</h2>
            <p>{dragging ? 'MP4 / MOV / M4V' : '元の動画は移動・変更しません。'}</p>
          </div>
        </div>
      )}
      {feedback && (
        <div
          className={`toast ${feedback.error ? 'toast-error' : ''}`}
          role={feedback.error ? 'alert' : 'status'}
        >
          {feedback.error ? <CircleAlert size={17} /> : <Check size={17} />}
          <p>{feedback.text}</p>
          <IconButton label="通知を閉じる" onClick={() => setFeedback(null)}>
            <X size={15} />
          </IconButton>
        </div>
      )}
      {help && <HelpDialog onClose={() => setHelp(false)} />}
      {editor && (
        <BookmarkEditor
          draft={editor}
          onClose={() => setEditor(null)}
          onSave={async (note, color) => {
            const updated = await tracked(
              editor.kind === 'new'
                ? gateway.addBookmark(editor.videoId, {
                    id: editor.id,
                    seconds: editor.seconds,
                    note,
                    color,
                    thumbnailDataUrl: editor.thumbnail,
                  })
                : gateway.editBookmark(editor.videoId, editor.id, note, color),
            );
            mergeVideo(updated);
            setEditor(null);
            notify(
              editor.kind === 'new'
                ? 'この瞬間を、しおり棚に保存しました。'
                : 'メモを更新しました。',
            );
          }}
          onDelete={
            editor.kind === 'edit'
              ? () => {
                  const video = videos.find((item) => item.id === editor.videoId);
                  const bookmark = video?.bookmarks.find((item) => item.id === editor.id);
                  if (video && bookmark) {
                    setEditor(null);
                    setDeleting({ video, bookmark });
                  }
                }
              : undefined
          }
        />
      )}
      {info && (
        <VideoInfoDialog
          video={info}
          isNative={gateway.isNative}
          onClose={() => setInfo(null)}
          onSave={async (title) => {
            mergeVideo(await tracked(gateway.renameVideo(info.id, title)));
            setInfo(null);
            notify('動画の表示名を変更しました。');
          }}
          onRelink={() => void relink(info)}
          onRemove={() => {
            setDeleting({ video: info });
            setInfo(null);
          }}
        />
      )}
      {deleting && (
        <DeleteDialog
          title={
            deleting.bookmark ? 'しおりを削除しますか？' : '動画の登録を削除しますか？'
          }
          target={
            deleting.bookmark
              ? `${formatTime(deleting.bookmark.seconds)} — ${deleting.bookmark.note}`
              : deleting.video.title
          }
          description={
            deleting.bookmark
              ? 'このしおりとメモを棚から取り除きます。この操作は取り消せません。'
              : `この動画の登録と、${deleting.video.bookmarks.length}か所のしおり・再生位置を削除します。この操作は取り消せません。`
          }
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            if (deleting.bookmark)
              mergeVideo(
                await tracked(
                  gateway.removeBookmark(deleting.video.id, deleting.bookmark.id),
                ),
              );
            else {
              player.current?.pause();
              await player.current?.flush();
              await tracked(gateway.removeVideo(deleting.video.id));
              setVideos((current) =>
                current.filter((video) => video.id !== deleting.video.id),
              );
              if (opened?.session.video.id === deleting.video.id) {
                setOpened(null);
                setView('videos');
              }
            }
            setDeleting(null);
            notify(
              deleting.bookmark
                ? 'しおりを削除しました。元動画はそのままです。'
                : '動画の登録を削除しました。元動画はそのままです。',
            );
          }}
        />
      )}
      {sourceError && (
        <Modal
          title="動画のファイルを確認してください"
          onClose={() => setSourceError(null)}
          busy={!!busy}
          className="source-error"
        >
          <div className="source-error-icon">
            <FolderInput size={29} strokeWidth={1.4} />
          </div>
          <h3>{sourceError.video.title}</h3>
          <p role="alert">{sourceError.message}</p>
          <p className="source-error-path">{sourceError.video.path}</p>
          <div className="safety-note">
            <ShieldCheck size={17} />
            保存したしおりとメモは、そのまま残っています。
          </div>
          <div className="modal-actions">
            <Button onClick={() => setSourceError(null)} disabled={!!busy}>
              閉じる
            </Button>
            <Button
              variant="primary"
              disabled={!!busy || !gateway.isNative}
              onClick={() => void relink(sourceError.video, sourceError.seconds)}
            >
              <FolderInput size={16} />
              移動後の動画を選択
            </Button>
          </div>
        </Modal>
      )}
      <div className="sr-only">
        <Keyboard />
        動画のしおり棚
      </div>
    </div>
  );
}
