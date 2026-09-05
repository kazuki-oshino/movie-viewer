import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { App } from '../../app/App';
import { PreviewGateway } from '../../platform/previewGateway';
import { zoomLimits } from './useVideoZoom';

function ready(video: HTMLVideoElement) {
  Object.defineProperties(video, {
    duration: { configurable: true, value: 90 },
    readyState: { configurable: true, value: 4 },
    videoWidth: { configurable: true, value: 1280 },
    videoHeight: { configurable: true, value: 720 },
    seeking: { configurable: true, value: false },
  });
  fireEvent.loadedMetadata(video);
  fireEvent.loadedData(video);
}
async function setup() {
  const gateway = new PreviewGateway();
  await gateway.importVideo('demo-0');
  const user = userEvent.setup();
  const view = render(<App gateway={gateway} />);
  await user.click(
    await screen.findByRole('button', { name: '余白から考える、伝わるデザイン' }),
  );
  const video = view.container.querySelector('video')!;
  ready(video);
  return { gateway, user, video, ...view };
}
it('色調と拡大を再生を止めずに変更し、動画を開き直すと色調を復元する', async () => {
  const { gateway, user, video, container } = await setup();
  await user.click(screen.getByRole('button', { name: '再生' }));
  video.currentTime = 23;
  fireEvent.timeUpdate(video);
  await user.click(screen.getByRole('button', { name: '映像の調整' }));
  fireEvent.change(screen.getByRole('slider', { name: '明るさ' }), {
    target: { value: 1.2 },
  });
  fireEvent.change(screen.getByRole('slider', { name: '彩度' }), {
    target: { value: 0.75 },
  });
  expect(video.style.filter).toBe('brightness(1.2) contrast(1) saturate(0.75)');
  await user.click(screen.getByRole('button', { name: '2×' }));
  expect(video.style.transform).toContain('scale(2)');
  expect(video.currentTime).toBe(23);
  expect(video.paused).toBe(false);
  await user.click(screen.getByRole('button', { name: '元の色で比較' }));
  expect(video.style.filter).toBe('none');
  await user.click(screen.getByRole('button', { name: '調整した色に戻す' }));
  await user.click(screen.getByRole('button', { name: 'しおり棚に戻る' }));
  expect((await gateway.list()).videos[0].colorAdjustments).toEqual({
    brightness: 1.2,
    contrast: 1,
    saturation: 0.75,
  });
  await user.click(screen.getByRole('button', { name: '余白から考える、伝わるデザイン' }));
  const reopened = container.querySelector('video')!;
  ready(reopened);
  expect(reopened.style.filter).toBe('brightness(1.2) contrast(1) saturate(0.75)');
  expect(reopened.style.transform).toContain('scale(1)');
});
it('しおりに色調を保存し、編集・棚・同じ動画のジャンプで復元し、旧しおりでは元の色に戻す', async () => {
  const { gateway, user, video, container } = await setup();
  await user.click(screen.getByRole('button', { name: '映像の調整' }));
  await user.click(screen.getByRole('button', { name: '少し明るく' }));
  video.currentTime = 24;
  fireEvent.timeUpdate(video);
  await user.click(screen.getByRole('button', { name: /しおりを追加\s*B/ }));
  await user.type(
    await screen.findByRole('textbox', { name: 'あとで見返したいこと' }),
    '明るく見る場面',
  );
  await user.click(screen.getByRole('button', { name: /しおりを保存/ }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  const bookmark = (await gateway.list()).videos[0].bookmarks.find(
    (b) => b.note === '明るく見る場面',
  )!;
  expect(bookmark.colorAdjustments).toEqual({
    brightness: 1.2,
    contrast: 1.05,
    saturation: 1,
  });
  await user.click(screen.getByRole('button', { name: 'メモを編集: 明るく見る場面' }));
  await user.click(screen.getByText('このしおりに保存する色調'));
  fireEvent.change(screen.getByRole('slider', { name: '彩度' }), {
    target: { value: 0.5 },
  });
  expect(screen.getByRole('dialog').querySelector('img')!.style.filter).toContain(
    'saturate(0.5)',
  );
  await user.click(screen.getByRole('button', { name: /変更を保存/ }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await user.click(screen.getByRole('button', { name: '0:24から再生: 明るく見る場面' }));
  expect(video.style.filter).toContain('saturate(0.5)');
  await user.click(
    screen.getByRole('button', { name: '0:14から再生: 余白は、情報の優先順位をつくる。' }),
  );
  expect(video.style.filter).toBe('none');
  await user.click(screen.getByRole('button', { name: 'しおり棚に戻る' }));
  await user.click(
    await screen.findByRole('button', { name: '0:24から再生: 明るく見る場面' }),
  );
  const reopened = container.querySelector('video')!;
  ready(reopened);
  expect(reopened.currentTime).toBe(24);
  expect(reopened.paused).toBe(false);
  expect(reopened.style.filter).toContain('saturate(0.5)');
});
it('縦横比を保ち、拡大後に映像の端を越えてパンしない範囲を算出する', () => {
  expect(zoomLimits(800, 600, 16 / 9, 1)).toEqual({ x: 0, y: 0 });
  expect(zoomLimits(800, 600, 16 / 9, 2)).toEqual({ x: 400, y: 150 });
  expect(zoomLimits(800, 600, 9 / 16, 2)).toEqual({ x: 0, y: 300 });
});

it('タイムラインをなぞっても再生位置・再生状態・保存する位置は変えない', async () => {
  const { user, video, gateway, container } = await setup();
  await user.click(screen.getByRole('button', { name: '再生' }));
  video.currentTime = 22;
  fireEvent.timeUpdate(video);
  // Keyboard focus also offers a preview without moving the seek control.
  fireEvent.focus(screen.getByRole('slider', { name: '再生位置' }));
  await waitFor(() => expect(container.querySelectorAll('video')).toHaveLength(2));
  expect(video.currentTime).toBe(22);
  expect(video.paused).toBe(false);
  fireEvent.blur(screen.getByRole('slider', { name: '再生位置' }));
  await waitFor(() => expect(container.querySelectorAll('video')).toHaveLength(1));
  await user.click(screen.getByRole('button', { name: 'しおり棚に戻る' }));
  expect((await gateway.list()).videos[0].position).toBe(22);
});
