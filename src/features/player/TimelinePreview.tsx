import { useCallback, useEffect, useRef, useState } from 'react';
import { formatTime } from '../../domain/library';
import { colorFilter, type ColorAdjustments } from '../../domain/visual';

/** Own decoder: hovering never seeks, pauses, or changes the main player's session. */
export function TimelinePreview({
  sourceUrl,
  seconds,
  duration,
  percent,
  colors,
}: {
  sourceUrl: string;
  seconds: number;
  duration: number;
  percent: number;
  colors: ColorAdjustments;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const attachVideo = useCallback((node: HTMLVideoElement | null) => {
    if (!node && videoRef.current) {
      videoRef.current.pause();
      videoRef.current.removeAttribute('src');
      videoRef.current.load();
    }
    videoRef.current = node;
  }, []);
  const [target, setTarget] = useState<number | null>(null);
  const [ready, setReady] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(
      () => setTarget(Math.min(Math.max(0, seconds), Math.max(0, duration - 0.05))),
      150,
    );
    return () => window.clearTimeout(timer);
  }, [seconds, duration]);
  useEffect(() => {
    const video = videoRef.current;
    if (!video || target === null) return;
    let cancelled = false;
    let frame: number | undefined;
    let paint: number | undefined;
    let initializing = video.readyState < 2;
    let requested = false;
    let presenting = false;
    setFailed(false);
    setReady(null);
    const cleanupFrame = () => {
      if (frame !== undefined) video.cancelVideoFrameCallback(frame);
      if (paint !== undefined) cancelAnimationFrame(paint);
      frame = undefined;
      paint = undefined;
    };
    const finish = () => {
      if (cancelled) return;
      video.pause();
      cleanupFrame();
      window.clearTimeout(timeout);
      setReady(target);
    };
    const fail = () => {
      if (cancelled) return;
      video.pause();
      cleanupFrame();
      window.clearTimeout(timeout);
      setFailed(true);
    };
    const present = () => {
      if (cancelled || !requested || video.seeking || video.readyState < 2 || presenting)
        return;
      presenting = true;
      // An actual presented frame prevents black previews after paused WebKit seeks.
      if (typeof video.requestVideoFrameCallback === 'function') {
        frame = video.requestVideoFrameCallback(finish);
        void video.play().catch(fail);
      } else {
        void video
          .play()
          .then(() => {
            if (cancelled) return;
            paint = requestAnimationFrame(() => {
              paint = requestAnimationFrame(finish);
            });
          })
          .catch(fail);
      }
    };
    const request = () => {
      if (cancelled || requested) return;
      initializing = false;
      requested = true;
      video.currentTime = target;
      present();
    };
    const metadata = () => {
      if (initializing) video.currentTime = 0;
    };
    const data = () => {
      if (initializing) request();
      else present();
    };
    const timeout = window.setTimeout(fail, 6000);
    video.addEventListener('loadedmetadata', metadata);
    video.addEventListener('loadeddata', data);
    video.addEventListener('seeked', present);
    video.addEventListener('canplay', present);
    video.addEventListener('error', fail);
    video.muted = true;
    if (video.readyState >= 2) request();
    else if (video.readyState >= 1) metadata();
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      cleanupFrame();
      video.pause();
      video.removeEventListener('loadedmetadata', metadata);
      video.removeEventListener('loadeddata', data);
      video.removeEventListener('seeked', present);
      video.removeEventListener('canplay', present);
      video.removeEventListener('error', fail);
    };
  }, [sourceUrl, target]);
  const waiting = target === null || ready !== target || Math.abs(seconds - target) > 0.2;
  return (
    <div
      className="timeline-preview"
      role="tooltip"
      aria-label="タイムラインのプレビュー"
      style={{ left: `clamp(90px, ${percent}%, calc(100% - 90px))` }}
    >
      {target !== null && (
        <video
          ref={attachVideo}
          src={sourceUrl}
          preload="metadata"
          muted
          playsInline
          crossOrigin="anonymous"
          aria-hidden="true"
          style={{ filter: colorFilter(colors) }}
        />
      )}
      {(waiting || failed) && (
        <div className="preview-loading">
          {failed ? 'プレビューを取得できません' : '読み込み中…'}
        </div>
      )}
      <span>{formatTime(seconds)}</span>
    </div>
  );
}
