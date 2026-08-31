import type { VideoEntry } from '../../domain/library';

const ERROR_NAMES: Record<number, string> = {
  1: 'MEDIA_ERR_ABORTED',
  2: 'MEDIA_ERR_NETWORK',
  3: 'MEDIA_ERR_DECODE',
  4: 'MEDIA_ERR_SRC_NOT_SUPPORTED',
};
const NETWORK_NAMES = [
  'NETWORK_EMPTY',
  'NETWORK_IDLE',
  'NETWORK_LOADING',
  'NETWORK_NO_SOURCE',
];
const READY_NAMES = [
  'HAVE_NOTHING',
  'HAVE_METADATA',
  'HAVE_CURRENT_DATA',
  'HAVE_FUTURE_DATA',
  'HAVE_ENOUGH_DATA',
];
const PRIVATE_SOURCE = '[非公開のファイル情報]';

/** Keep native error text useful without sharing the video's name, path, or URL. */
export function redactMediaMessage(message: string, sources: readonly string[]): string {
  const privateValues = new Set<string>();
  for (const source of sources.filter(Boolean)) {
    const filename = source.split(/[\\/]/u).at(-1) ?? '';
    for (const value of [source, filename]) {
      for (const normalized of [value.normalize('NFC'), value.normalize('NFD')]) {
        privateValues.add(normalized);
        privateValues.add(encodeURI(normalized));
        privateValues.add(encodeURIComponent(normalized));
      }
    }
  }
  let result = message;
  for (const value of [...privateValues]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)) {
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    result = result.replace(new RegExp(escaped, 'giu'), PRIVATE_SOURCE);
  }
  return result
    .replace(/\b(?:asset|file|https?|blob|data):[^\s"'<>]+/giu, PRIVATE_SOURCE)
    .replace(/\/(?:Users|Volumes|private|var|tmp|home)\/[^"'<>;\r\n]*/gu, PRIVATE_SOURCE);
}

function namedState(value: number, names: Record<number, string>) {
  return `${value} (${names[value] ?? 'UNKNOWN'})`;
}

function seconds(value: number) {
  return Number.isFinite(value) ? String(Math.round(value * 1000) / 1000) : String(value);
}

export function mediaDiagnostics(
  video: HTMLVideoElement,
  source: Pick<VideoEntry, 'path' | 'byteLen'>,
  initialPositionApplied: boolean,
  events: readonly string[],
): string {
  const error = video.error;
  const message = error?.message?.trim();
  const scheme = /^(asset|file|https?|blob|data):/iu.exec(
    video.currentSrc || video.src,
  )?.[0];
  return [
    'Shiori playback diagnostics v2',
    `error.code: ${error ? namedState(error.code, ERROR_NAMES) : 'none (MediaErrorなし)'}`,
    `error.message: ${
      message
        ? redactMediaMessage(message, [source.path, video.currentSrc, video.src])
        : '（WebViewから詳細メッセージは提供されていません）'
    }`,
    `networkState: ${namedState(video.networkState, NETWORK_NAMES)}`,
    `readyState: ${namedState(video.readyState, READY_NAMES)}`,
    `currentTime: ${seconds(video.currentTime)}`,
    `duration: ${seconds(video.duration)}`,
    `videoSize: ${video.videoWidth}x${video.videoHeight}`,
    `paused: ${video.paused}; seeking: ${video.seeking}; ended: ${video.ended}`,
    `playbackRate: ${video.playbackRate}`,
    `sourceScheme: ${scheme ?? 'unknown'}`,
    `registeredBytes: ${source.byteLen}`,
    `initialPositionApplied: ${initialPositionApplied}`,
    'recentEvents (elapsed since first event):',
    ...events.map((event) => `  ${event}`),
  ].join('\n');
}
