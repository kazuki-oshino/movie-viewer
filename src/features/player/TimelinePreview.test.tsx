import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TimelinePreview } from './TimelinePreview';
import { ORIGINAL_COLORS } from '../../domain/visual';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const props = {
  sourceUrl: '/demo/demo-0.mp4',
  seconds: 10,
  duration: 90,
  percent: 11,
  colors: ORIGINAL_COLORS,
};
it('操作の停止を待って別の無音デコーダを読み込み、最新時刻だけ表示し、離れると解放する', async () => {
  const { container, rerender, unmount } = render(<TimelinePreview {...props} />);
  expect(container.querySelector('video')).toBeNull();
  await act(async () => vi.advanceTimersByTime(150));
  const video = container.querySelector('video')!;
  const callbacks: VideoFrameRequestCallback[] = [];
  video.requestVideoFrameCallback = vi.fn((cb) => {
    callbacks.push(cb);
    return callbacks.length;
  });
  video.cancelVideoFrameCallback = vi.fn();
  Object.defineProperties(video, {
    duration: { value: 90 },
    readyState: { configurable: true, value: 4 },
    seeking: { value: false },
  });
  fireEvent.loadedMetadata(video);
  fireEvent.loadedData(video);
  expect(video.currentTime).toBe(10);
  expect(video.muted).toBe(true);
  expect(screen.getByText('読み込み中…')).toBeVisible();
  rerender(<TimelinePreview {...props} seconds={50} percent={55} />);
  await act(async () => vi.advanceTimersByTime(150));
  expect(video.currentTime).toBe(50);
  act(() => callbacks[0](0, {} as VideoFrameCallbackMetadata));
  expect(screen.getByText('読み込み中…')).toBeVisible();
  act(() => callbacks.at(-1)!(0, {} as VideoFrameCallbackMetadata));
  expect(screen.queryByText('読み込み中…')).toBeNull();
  expect(screen.getByText('0:50')).toBeVisible();
  expect(video.paused).toBe(true);
  unmount();
  expect(video.getAttribute('src')).toBeNull();
  expect(video.load).toHaveBeenCalled();
});
it('末尾を越えず、デコード失敗とタイムアウトを表示して停止する', async () => {
  const { container, rerender } = render(<TimelinePreview {...props} seconds={90} />);
  await act(async () => vi.advanceTimersByTime(150));
  const video = container.querySelector('video')!;
  Object.defineProperties(video, {
    readyState: { configurable: true, value: 4 },
    seeking: { value: false },
  });
  fireEvent.loadedMetadata(video);
  fireEvent.loadedData(video);
  expect(video.currentTime).toBe(89.95);
  fireEvent.error(video);
  expect(screen.getByText('プレビューを取得できません')).toBeVisible();
  expect(video.paused).toBe(true);
  Object.defineProperty(video, 'readyState', { value: 0 });
  rerender(<TimelinePreview {...props} seconds={30} />);
  await act(async () => vi.advanceTimersByTime(150));
  await act(async () => vi.advanceTimersByTime(6000));
  expect(screen.getByText('プレビューを取得できません')).toBeVisible();
  expect(video.paused).toBe(true);
});
