import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ArrowLeft,
  BookmarkPlus,
  Check,
  CircleAlert,
  Gauge,
  Info,
  Maximize,
  PanelLeftClose,
  PanelLeftOpen,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { SaveQueue, type SaveStatus } from '../../application/saveQueue';
import { captureFrame, type CapturedFrame } from '../../application/captureFrame';
import {
  clampTime,
  errorMessage,
  formatTime,
  PLAYBACK_RATES,
  type Bookmark,
  type PlaybackSession,
  type Progress,
  type VideoEntry,
} from '../../domain/library';
import type { LibraryGateway } from '../../platform/gateway';
import { Button, IconButton } from '../../components/Button';
import { Thumbnail } from '../../components/Thumbnail';
import { MediaErrorDetails } from './MediaErrorDetails';
import { mediaDiagnostics } from './mediaDiagnostics';

export interface PlayerHandle {
  flush(): Promise<void>;
  pause(): void;
  togglePlay(): void;
  skip(seconds: number): void;
  seek(seconds: number, autoplay?: boolean): void;
  bookmark(): Promise<void>;
}

interface Props {
  session: PlaybackSession;
  video: VideoEntry;
  gateway: LibraryGateway;
  initialSeconds?: number;
  autoplay?: boolean;
  focused: boolean;
  onToggleFocus(): void;
  onBack(): void;
  onInfo(): void;
  onRelink(): void;
  onBookmark(frame: CapturedFrame): void;
  onEdit(bookmark: Bookmark): void;
  onUpdated(video: VideoEntry): void;
  onNotice(message: string): void;
}

export const Player = forwardRef<PlayerHandle, Props>(function Player(
  {
    session,
    video: entry,
    gateway,
    initialSeconds,
    autoplay = false,
    focused,
    onToggleFocus,
    onBack,
    onInfo,
    onRelink,
    onBookmark,
    onEdit,
    onUpdated,
    onNotice,
  },
  ref,
) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(entry.duration);
  const [rate, setRate] = useState(session.video.playbackRate);
  const [volume, setVolume] = useState(0.8);
  const [muted, setMuted] = useState(false);
  const [mediaError, setMediaError] = useState('');
  const [diagnostics, setDiagnostics] = useState('');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [saveError, setSaveError] = useState('');
  const [capturing, setCapturing] = useState(false);
  const [visibleBookmarks, setVisibleBookmarks] = useState(40);
  const lastSavedAt = useRef(0);
  const capturingRef = useRef(false);
  const coverStarted = useRef(false);
  const jobs = useRef(new Set<Promise<void>>());
  const wantsPlay = useRef(autoplay);
  const initialPositionApplied = useRef(false);
  const mediaEvents = useRef<{ startedAt: number | null; recent: string[] }>({
    startedAt: null,
    recent: [],
  });

  function recordMediaEvent(name: string) {
    const now = performance.now();
    const log = mediaEvents.current;
    log.startedAt ??= now;
    log.recent.push(`${Math.round(now - log.startedAt)}ms ${name}`);
    if (log.recent.length > 16) log.recent.shift();
  }

  function recordMediaError(video: HTMLVideoElement) {
    const snapshot = mediaDiagnostics(
      video,
      session.video,
      initialPositionApplied.current,
      mediaEvents.current.recent,
    );
    // Keep the first failure and run its transport probes only once per session.
    setDiagnostics((previous) => previous || snapshot);
  }

  const queue = useMemo(
    () =>
      new SaveQueue<Progress>(
        (value, revision) => gateway.saveProgress(session.sessionId, revision, value),
        (status, error) => {
          setSaveStatus(status);
          setSaveError(error ? errorMessage(error) : '');
        },
      ),
    [gateway, session.sessionId],
  );

  const saveSnapshot = useCallback(
    (force = false) => {
      const video = videoRef.current;
      if (
        !video ||
        !initialPositionApplied.current ||
        !Number.isFinite(video.duration) ||
        video.duration <= 0 ||
        video.readyState < 1
      )
        return;
      if (!force && performance.now() - lastSavedAt.current < 5_000) return;
      lastSavedAt.current = performance.now();
      queue.enqueue({
        position: clampTime(video.currentTime, video.duration),
        duration: video.duration,
        playbackRate: video.playbackRate,
      });
    },
    [queue],
  );

  const flush = useCallback(async () => {
    saveSnapshot(true);
    await queue.flush();
    await Promise.all([...jobs.current]);
  }, [queue, saveSnapshot]);

  const play = useCallback(() => {
    const video = videoRef.current;
    if (!video || mediaError) return;
    if (!initialPositionApplied.current || video.readyState < 2 || video.seeking) {
      wantsPlay.current = true;
      return;
    }
    wantsPlay.current = false;
    if (video.ended || video.currentTime >= video.duration) video.currentTime = 0;
    void video.play().catch((error: unknown) => {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      onNotice('しおりの位置へ移動しました。再生ボタンを押してください。');
    });
  }, [mediaError, onNotice]);

  const pause = useCallback(() => {
    wantsPlay.current = false;
    videoRef.current?.pause();
  }, []);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused && !wantsPlay.current) play();
    else pause();
  }, [play, pause]);

  const seek = useCallback(
    (seconds: number, startPlaying = false) => {
      const video = videoRef.current;
      if (!video || !loaded || mediaError) return;
      const next = clampTime(seconds, video.duration);
      video.currentTime = next;
      setPosition(next);
      if (startPlaying) play();
    },
    [loaded, mediaError, play],
  );

  const skip = useCallback(
    (seconds: number) => {
      const video = videoRef.current;
      if (video) seek(video.currentTime + seconds);
    },
    [seek],
  );

  const addBookmark = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !loaded || mediaError || capturingRef.current) return;
    capturingRef.current = true;
    wantsPlay.current = false;
    setCapturing(true);
    try {
      const frame = await captureFrame(video);
      await flush(); // Persist duration before the bookmark is committed.
      onBookmark(frame);
    } catch (error) {
      onNotice(errorMessage(error));
    } finally {
      capturingRef.current = false;
      setCapturing(false);
    }
  }, [flush, loaded, mediaError, onBookmark, onNotice]);

  useImperativeHandle(
    ref,
    () => ({
      flush,
      pause,
      togglePlay,
      skip,
      seek,
      bookmark: addBookmark,
    }),
    [flush, pause, togglePlay, skip, seek, addBookmark],
  );

  useEffect(() => {
    const onHidden = () => {
      if (document.hidden) saveSnapshot(true);
    };
    document.addEventListener('visibilitychange', onHidden);
    return () => document.removeEventListener('visibilitychange', onHidden);
  }, [saveSnapshot]);

  function loadedMetadata() {
    recordMediaEvent('loadedmetadata');
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0) {
      recordMediaEvent('invalid-duration');
      if (video) recordMediaError(video);
      setMediaError('動画の長さを読み取れません。この形式は再生できない可能性があります。');
      return;
    }
    setDuration(video.duration);
    video.playbackRate = rate;
    video.volume = volume;
    // With preload=metadata, WebKit needs an explicit zero seek to request
    // its first video frame before the saved-position seek can be applied.
    video.currentTime = 0;
  }

  function loadedData() {
    recordMediaEvent('loadeddata');
    const video = videoRef.current;
    if (!video) return;
    // WebKit can advance audio while rendering black if a custom-protocol video
    // is initially sought during loadedmetadata, before its first decoded frame.
    // Restore the saved position only after loadeddata has initialized that frame.
    if (!initialPositionApplied.current) {
      const requested = initialSeconds ?? session.video.position;
      const next = clampTime(
        initialSeconds === undefined && requested >= video.duration ? 0 : requested,
        video.duration,
      );
      initialPositionApplied.current = true;
      if (next !== video.currentTime) video.currentTime = next;
      setPosition(next);
      saveSnapshot(true);
    }
    setLoaded(true);
    if (wantsPlay.current) play();
    if (!entry.coverId && !coverStarted.current && videoRef.current) {
      coverStarted.current = true;
      const job = captureFrame(videoRef.current, false)
        .then((frame) => gateway.saveCover(entry.id, frame.dataUrl))
        .then(onUpdated)
        .catch(() => {
          /* A missing cover never prevents playback or bookmarking. */
        });
      jobs.current.add(job);
      void job.finally(() => jobs.current.delete(job));
    }
  }

  const marks = [...entry.bookmarks].sort((a, b) => a.seconds - b.seconds);
  const activeMark = [...marks].reverse().find((mark) => mark.seconds <= position + 0.3);
  const progress = duration > 0 ? (position / duration) * 100 : 0;

  return (
    <div className={`player-view ${focused ? 'is-focused' : ''}`}>
      <header className="player-heading">
        <div className="player-heading-main">
          <IconButton label="しおり棚に戻る" onClick={onBack}>
            <ArrowLeft size={19} />
          </IconButton>
          <div>
            <h1 title={entry.title}>{entry.title}</h1>
          </div>
        </div>
        <div className="player-heading-actions">
          {focused && (
            <IconButton
              label="しおりを追加 (B)"
              onClick={() => void addBookmark()}
              disabled={!loaded || !!mediaError || capturing}
            >
              <BookmarkPlus size={18} />
            </IconButton>
          )}
          <Button
            variant="ghost"
            className="focus-toggle"
            title={focused ? '集中モードを終了 (T / Esc)' : '集中モード (T)'}
            aria-pressed={focused}
            onClick={onToggleFocus}
          >
            {focused ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
            <span>{focused ? '元の表示に戻す' : '集中モード'}</span>
            <kbd>T</kbd>
          </Button>
          <IconButton label="動画の情報と保存場所" onClick={onInfo}>
            <Info size={19} />
          </IconButton>
        </div>
      </header>
      <div className="player-columns">
        <section className="watch-area" aria-label="動画プレイヤー">
          <div className="video-stage">
            <video
              ref={videoRef}
              src={gateway.videoUrl(session.video)}
              preload="metadata"
              playsInline
              crossOrigin="anonymous"
              aria-label={entry.title}
              onLoadStart={() => recordMediaEvent('loadstart')}
              onSuspend={() => recordMediaEvent('suspend')}
              onStalled={() => recordMediaEvent('stalled')}
              onAbort={() => recordMediaEvent('abort')}
              onWaiting={() => recordMediaEvent('waiting')}
              onSeeking={() => recordMediaEvent('seeking')}
              onLoadedMetadata={loadedMetadata}
              onLoadedData={loadedData}
              onCanPlay={() => {
                recordMediaEvent('canplay');
                if (wantsPlay.current) play();
              }}
              onTimeUpdate={(event) => {
                setPosition(event.currentTarget.currentTime);
                saveSnapshot();
              }}
              onSeeked={() => {
                recordMediaEvent('seeked');
                saveSnapshot(true);
                if (wantsPlay.current) play();
              }}
              onPlay={() => setPlaying(true)}
              onPause={() => {
                setPlaying(false);
                saveSnapshot(true);
              }}
              onEnded={() => {
                setPlaying(false);
                saveSnapshot(true);
              }}
              onError={(event) => {
                recordMediaEvent('error');
                recordMediaError(event.currentTarget);
                setPlaying(false);
                setMediaError(
                  '動画を再生できません。ファイルの場所と、映像・音声の形式を確認してください。',
                );
              }}
              onClick={togglePlay}
            />
            {!loaded && !mediaError && (
              <div className="video-loading">
                <span className="spinner" />
                動画を読み込んでいます
              </div>
            )}
            {loaded && !playing && !mediaError && (
              <button className="stage-play" aria-label="動画を再生" onClick={play}>
                <Play size={30} fill="currentColor" />
              </button>
            )}
            {mediaError && (
              <div className="video-error">
                <CircleAlert size={32} strokeWidth={1.3} />
                <h2>この動画を開けませんでした</h2>
                <p>{mediaError}</p>
                {diagnostics && (
                  <MediaErrorDetails
                    diagnostics={diagnostics}
                    sourceUrl={gateway.videoUrl(session.video)}
                    sourcePath={session.video.path}
                    isNative={gateway.isNative}
                    onNotice={onNotice}
                  />
                )}
                <Button onClick={onRelink}>ファイルの場所を再指定</Button>
                <small>MP4 / MOV / M4V・macOS標準の対応コーデック</small>
              </div>
            )}
          </div>
          <div className="playback-controls">
            <div className="timeline">
              <div
                className="timeline-bar"
                style={{ '--progress': `${progress}%` } as React.CSSProperties}
              >
                <input
                  type="range"
                  aria-label="再生位置"
                  aria-valuetext={`${formatTime(position)} / ${formatTime(duration)}`}
                  min="0"
                  max={duration || 1}
                  step="0.1"
                  value={clampTime(position, duration)}
                  disabled={!loaded || !!mediaError}
                  onChange={(event) => seek(Number(event.target.value))}
                />
                <div className="timeline-marks" aria-hidden="true">
                  {marks.map((mark) => (
                    <i
                      key={mark.id}
                      className={`mark-${mark.color}`}
                      style={{
                        left: `${Math.min(100, (mark.seconds / (duration || 1)) * 100)}%`,
                      }}
                    />
                  ))}
                </div>
              </div>
              <div className="timeline-times">
                <span>
                  <strong>{formatTime(position)}</strong>
                  <span> / </span>
                  {formatTime(duration)}
                </span>
                <span className={`save-status ${saveStatus}`} role="status">
                  {saveStatus === 'saved' ? (
                    <>
                      <Check size={13} />
                      再生位置を保存済み
                    </>
                  ) : saveStatus === 'saving' ? (
                    '保存中…'
                  ) : (
                    '再生位置を保存できません'
                  )}
                </span>
              </div>
            </div>
            <div className="player-toolbar">
              <div className="transport" aria-label="再生コントロール">
                {[-60, -30, -10].map((seconds) => (
                  <button
                    key={seconds}
                    className="skip-button"
                    disabled={!loaded || !!mediaError}
                    title={`${-seconds}秒戻る`}
                    aria-label={`${-seconds}秒戻る`}
                    onClick={() => skip(seconds)}
                  >
                    <RotateCcw size={20} strokeWidth={1.6} />
                    <span>{seconds === -60 ? '1分' : `${-seconds}秒`}</span>
                  </button>
                ))}
                <button
                  className="play-button"
                  disabled={!loaded || !!mediaError}
                  aria-label={playing ? '一時停止' : '再生'}
                  title="再生 / 一時停止 (Space)"
                  onClick={togglePlay}
                >
                  <span className="play-icon-swap">
                    <Play
                      className={!playing ? 'is-visible' : ''}
                      size={22}
                      fill="currentColor"
                    />
                    <Pause
                      className={playing ? 'is-visible' : ''}
                      size={22}
                      fill="currentColor"
                    />
                  </span>
                </button>
                {[10, 30, 60].map((seconds) => (
                  <button
                    key={seconds}
                    className="skip-button"
                    disabled={!loaded || !!mediaError}
                    title={`${seconds}秒進む`}
                    aria-label={`${seconds}秒進む`}
                    onClick={() => skip(seconds)}
                  >
                    <RotateCw size={20} strokeWidth={1.6} />
                    <span>{seconds === 60 ? '1分' : `${seconds}秒`}</span>
                  </button>
                ))}
              </div>
              <div className="volume-control">
                <IconButton
                  label={muted ? 'ミュートを解除' : 'ミュート'}
                  onClick={() => {
                    const value = !muted;
                    setMuted(value);
                    if (videoRef.current) videoRef.current.muted = value;
                  }}
                >
                  {muted || volume === 0 ? <VolumeX size={17} /> : <Volume2 size={17} />}
                </IconButton>
                <input
                  aria-label="音量"
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={volume}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    setVolume(value);
                    setMuted(false);
                    if (videoRef.current) {
                      videoRef.current.volume = value;
                      videoRef.current.muted = false;
                    }
                  }}
                />
              </div>
              <div className="player-options">
                <div className="speed-control">
                  <Gauge size={16} />
                  <label htmlFor="playback-rate">再生速度</label>
                  <select
                    id="playback-rate"
                    value={rate}
                    disabled={!!mediaError}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      if (videoRef.current) videoRef.current.playbackRate = value;
                      setRate(value);
                      saveSnapshot(true);
                    }}
                  >
                    {PLAYBACK_RATES.map((value) => (
                      <option key={value} value={value}>
                        {value.toFixed(1)}×{value === 1 ? ' 標準' : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <IconButton
                  label="フルスクリーン (F)"
                  onClick={() =>
                    void gateway
                      .toggleFullscreen()
                      .catch((error: unknown) => onNotice(errorMessage(error)))
                  }
                >
                  <Maximize size={17} />
                </IconButton>
              </div>
            </div>
          </div>
          {saveStatus === 'failed' && (
            <div className="inline-error" role="alert">
              <CircleAlert size={17} />
              <span>{saveError}</span>
              <Button
                onClick={() =>
                  void flush().catch((error: unknown) => onNotice(errorMessage(error)))
                }
              >
                再試行
              </Button>
            </div>
          )}
        </section>
        <aside className="bookmark-panel" aria-label="この動画のしおり" hidden={focused}>
          <div className="bookmark-panel-heading">
            <h2>
              この動画のしおり <span>{marks.length}</span>
            </h2>
            <p>気になる瞬間を、残しておこう。</p>
          </div>
          <Button
            variant="primary"
            className="add-bookmark"
            onClick={() => void addBookmark()}
            disabled={!loaded || !!mediaError || capturing}
          >
            <BookmarkPlus size={17} />
            {capturing ? '映像を取得中…' : 'しおりを追加'}
            <kbd>B</kbd>
          </Button>
          {marks.length ? (
            <div className="player-bookmarks">
              {marks.slice(0, visibleBookmarks).map((bookmark) => (
                <article
                  key={bookmark.id}
                  className={`player-bookmark ${activeMark?.id === bookmark.id ? 'is-current' : ''}`}
                >
                  <button
                    className="player-bookmark-open"
                    aria-label={`${formatTime(bookmark.seconds)}から再生: ${bookmark.note}`}
                    onClick={() => seek(bookmark.seconds, true)}
                  >
                    <Thumbnail src={gateway.thumbnailUrl(bookmark.thumbnailId)} />
                    <span className="player-bookmark-text">
                      <span className={`bookmark-time color-${bookmark.color}`}>
                        <Play size={10} fill="currentColor" />
                        {formatTime(bookmark.seconds)}
                      </span>
                      <span className="player-bookmark-note">{bookmark.note}</span>
                    </span>
                  </button>
                  <button
                    className="text-action"
                    onClick={() => onEdit(bookmark)}
                    aria-label={`メモを編集: ${bookmark.note}`}
                  >
                    メモを編集
                  </button>
                </article>
              ))}
              {marks.length > visibleBookmarks && (
                <Button onClick={() => setVisibleBookmarks((count) => count + 40)}>
                  さらに表示
                </Button>
              )}
            </div>
          ) : (
            <div className="empty-bookmarks">
              <BookmarkPlus size={30} strokeWidth={1.1} />
              <p>
                ここだ、と思ったら
                <br />
                しおりをひとつ。
              </p>
              <span>
                その瞬間のサムネイルと
                <br />
                あなたのメモを保存します。
              </span>
            </div>
          )}
          <div className="bookmark-panel-footer">
            <span className="tiny-dot" />
            しおりを押すと、その時間から再生
          </div>
        </aside>
      </div>
    </div>
  );
});
