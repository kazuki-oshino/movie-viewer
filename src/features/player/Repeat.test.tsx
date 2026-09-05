import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../../app/App';
import { PreviewGateway } from '../../platform/previewGateway';

async function playerApp() {
  const gateway = new PreviewGateway();
  await gateway.importVideo('demo-0');
  await gateway.importVideo('demo-1');
  const user = userEvent.setup();
  const { container } = render(<App gateway={gateway} />);
  await user.click(
    await screen.findByRole('button', { name: '余白から考える、伝わるデザイン' }),
  );
  const video = container.querySelector('video')!;
  Object.defineProperties(video, {
    duration: { configurable: true, value: 90 },
    readyState: { configurable: true, value: 4 },
    videoWidth: { configurable: true, value: 1280 },
    videoHeight: { configurable: true, value: 720 },
    seeking: { configurable: true, value: false },
  });
  fireEvent.loadedMetadata(video);
  fireEvent.loadedData(video);
  await user.click(screen.getByRole('button', { name: '区間リピートを設定' }));
  return { user, video, gateway, container };
}

function at(video: HTMLVideoElement, seconds: number) {
  video.currentTime = seconds;
  fireEvent.timeUpdate(video);
}

describe('区間リピート', () => {
  it('B点でA点へ戻り、一時停止中は動かさず、しおりへの移動は区間外なら解除する', async () => {
    const { user, video } = await playerApp();
    at(video, 10.2);
    await user.click(screen.getByRole('button', { name: /A\s*始点を設定/u }));
    at(video, 12.7);
    await user.click(screen.getByRole('button', { name: /B\s*終点を設定/u }));
    expect(video.currentTime).toBe(10.2);
    expect(screen.getByRole('button', { name: 'リピート中' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(screen.getByRole('button', { name: '再生' }));
    at(video, 12.8);
    expect(video.currentTime).toBe(10.2);
    expect(video.paused).toBe(false);
    await user.click(screen.getByRole('button', { name: '一時停止' }));
    at(video, 12.8);
    expect(video.currentTime).toBe(12.8);
    await user.click(
      screen.getByRole('button', {
        name: '0:42から再生: 文字の大きさだけでなく、行間にもリズムを。',
      }),
    );
    expect(video.currentTime).toBe(42);
    expect(video.paused).toBe(false);
    expect(screen.queryByRole('group', { name: '区間リピート' })).toBeNull();
    at(video, 43);
    expect(video.currentTime).toBe(43);
  });

  it('不正な区間を拒否し、0.5秒の区間を許可し、クリアすると通常再生に戻る', async () => {
    const { user, video } = await playerApp();
    expect(screen.getByRole('button', { name: /B\s*終点を設定/u })).toBeDisabled();
    at(video, 0.2);
    await user.click(screen.getByRole('button', { name: /A\s*始点を設定/u }));
    at(video, 0.1);
    await user.click(screen.getByRole('button', { name: /B\s*終点を設定/u }));
    expect(screen.getByRole('alert')).toHaveTextContent('0.5秒以上');
    expect(screen.getByRole('button', { name: '繰り返す' })).toBeDisabled();
    at(video, 0.7);
    await user.click(screen.getByRole('button', { name: /B\s*終点を設定/u }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: /B\s*0:00\.7/u })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'リピート区間をクリア' }));
    expect(screen.getByRole('button', { name: /A\s*始点を設定/u })).toBeEnabled();
    expect(screen.getByRole('button', { name: '繰り返す' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '再生' }));
    at(video, 1);
    expect(video.currentTime).toBe(1);
  });

  it('動画末尾をB点にした場合も再開し、再開待ちの一時停止を尊重する', async () => {
    const { user, video } = await playerApp();
    at(video, 88);
    await user.click(screen.getByRole('button', { name: /A\s*始点を設定/u }));
    at(video, 90);
    await user.click(screen.getByRole('button', { name: /B\s*終点を設定/u }));
    await user.click(screen.getByRole('button', { name: '再生' }));
    video.currentTime = 90;
    Object.defineProperty(video, 'paused', { configurable: true, value: true });
    fireEvent.ended(video);
    expect(video.currentTime).toBe(88);
    expect(video.paused).toBe(false);
    await user.click(screen.getByRole('button', { name: '一時停止' }));
    Object.defineProperty(video, 'seeking', { configurable: true, value: true });
    await user.click(screen.getByRole('button', { name: '再生' }));
    // A second request cancels the pending play while a seek is in flight.
    await user.click(screen.getByRole('button', { name: '再生' }));
    Object.defineProperty(video, 'seeking', { configurable: true, value: false });
    fireEvent.seeked(video);
    expect(video.paused).toBe(true);
  });

  it('設定を閉じてもリピートし、別の動画に設定を引き継がず、通常の保存を続ける', async () => {
    const { user, video, gateway } = await playerApp();
    at(video, 10);
    await user.click(screen.getByRole('button', { name: /A\s*始点を設定/u }));
    at(video, 20);
    await user.click(screen.getByRole('button', { name: /B\s*終点を設定/u }));
    await user.click(screen.getByRole('button', { name: '区間リピートの設定を閉じる' }));
    expect(screen.queryByRole('group', { name: '区間リピート' })).toBeNull();
    await user.click(screen.getByRole('button', { name: '再生' }));
    at(video, 21);
    expect(video.currentTime).toBe(10);
    await user.click(
      screen.getByRole('button', { name: '日常を切り取る、映像のつくり方' }),
    );
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('日常を切り取る'),
    );
    await user.click(screen.getByRole('button', { name: '区間リピートを設定' }));
    expect(screen.getByRole('button', { name: /A\s*始点を設定/u })).toBeVisible();
    expect(screen.getByRole('button', { name: '繰り返す' })).toBeDisabled();
    expect((await gateway.list()).videos[0].position).toBe(10);
  });
});

it('A–Bを保存し、棚から再び開くと区間リピートになり、地点しおりでは区間内でも解除する', async () => {
  const { user, video, gateway, container } = await playerApp();
  at(video, 10);
  await user.click(screen.getByRole('button', { name: /A\s*始点を設定/u }));
  at(video, 50);
  await user.click(screen.getByRole('button', { name: /B\s*終点を設定/u }));
  at(video, 25);
  let presented: VideoFrameRequestCallback | undefined;
  video.requestVideoFrameCallback = vi.fn((callback) => {
    presented = callback;
    return 1;
  });
  video.cancelVideoFrameCallback = vi.fn();
  await user.click(screen.getByRole('button', { name: '区間をしおりに保存' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(video.muted).toBe(true);
  await act(async () => {
    presented!(0, {} as VideoFrameCallbackMetadata);
  });
  expect(video.muted).toBe(false);
  expect(await screen.findByRole('radio', { name: 'A–B区間リピート' })).toBeChecked();
  expect(video.currentTime).toBe(10);
  expect(video.paused).toBe(true);
  expect(screen.getByRole('spinbutton', { name: 'B（終点・秒）' })).toHaveValue(50);
  await user.type(
    screen.getByRole('textbox', { name: 'あとで見返したいこと' }),
    '保存した練習区間',
  );
  await user.click(screen.getByRole('button', { name: /しおりを保存/ }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  const saved = (await gateway.list()).videos[0].bookmarks.find(
    (b) => b.note === '保存した練習区間',
  )!;
  expect(saved).toMatchObject({ seconds: 10, endSeconds: 50 });
  await user.click(screen.getByRole('button', { name: 'しおり棚に戻る' }));
  await user.click(
    await screen.findByRole('button', {
      name: '0:10.0–0:50.0をリピート: 保存した練習区間',
    }),
  );
  const reopened = container.querySelector('video')!;
  Object.defineProperties(reopened, {
    duration: { configurable: true, value: 90 },
    readyState: { configurable: true, value: 4 },
    seeking: { configurable: true, value: false },
  });
  fireEvent.loadedMetadata(reopened);
  fireEvent.loadedData(reopened);
  expect(reopened.currentTime).toBe(10);
  expect(reopened.paused).toBe(false);
  at(reopened, 50.1);
  expect(reopened.currentTime).toBe(10);
  await user.click(
    screen.getByRole('button', {
      name: '0:42から再生: 文字の大きさだけでなく、行間にもリズムを。',
    }),
  );
  at(reopened, 51);
  expect(reopened.currentTime).toBe(51);
  await user.click(
    screen.getByRole('button', { name: '0:10.0–0:50.0をリピート: 保存した練習区間' }),
  );
  expect(reopened.currentTime).toBe(10);
  at(reopened, 50.1);
  expect(reopened.currentTime).toBe(10);
});
