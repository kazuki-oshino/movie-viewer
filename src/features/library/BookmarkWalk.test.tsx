import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../../app/App';
import { PreviewGateway } from '../../platform/previewGateway';

async function libraryApp(unavailable = false) {
  const gateway = new PreviewGateway();
  await gateway.importVideo('demo-0');
  await gateway.importVideo('demo-1');
  if (unavailable) {
    const listing = await gateway.list();
    listing.videos[0].availability = 'missing';
    vi.spyOn(gateway, 'list').mockResolvedValue(listing);
  }
  const before = await gateway.list();
  const user = userEvent.setup();
  const result = render(<App gateway={gateway} />);
  await screen.findByRole('button', { name: 'しおり散歩' });
  return { user, gateway, before, ...result };
}

describe('しおり散歩', () => {
  it('一巡するまで重複せず、戻る・もう一巡に対応し、保存済みの棚は変えない', async () => {
    const { user, gateway, before } = await libraryApp();
    await user.click(screen.getByRole('button', { name: 'しおり散歩' }));
    const dialog = screen.getByRole('dialog', { name: 'しおり散歩' });
    const note = () => dialog.querySelector('.walk-note')!.textContent!;
    const first = note();
    expect(within(dialog).getByRole('button', { name: '戻る' })).toBeDisabled();
    await user.click(within(dialog).getByRole('button', { name: '次のしおり' }));
    const second = note();
    expect(second).not.toBe(first);
    await user.click(within(dialog).getByRole('button', { name: '戻る' }));
    expect(note()).toBe(first);
    const seen = [first];
    for (let index = 1; index < 6; index++) {
      await user.click(within(dialog).getByRole('button', { name: '次のしおり' }));
      seen.push(note());
    }
    expect(new Set(seen).size).toBe(6);
    expect(dialog).toHaveTextContent('6 / 6 枚');
    await user.click(within(dialog).getByRole('button', { name: 'もう一巡する' }));
    expect(note()).not.toBe(seen.at(-1));
    expect(dialog).toHaveTextContent('1 / 6 枚');
    await user.click(within(dialog).getByRole('button', { name: '閉じる' }));
    expect(await gateway.list()).toEqual(before);
    expect(screen.getByRole('button', { name: 'しおり散歩' })).toHaveFocus();
  });

  it('色・検索の絞り込みを尊重し、選んだ一枚の時刻から再生する', async () => {
    const { user, container } = await libraryApp();
    await user.click(screen.getByRole('button', { name: 'ローズのしおり' }));
    await user.type(screen.getByRole('textbox', { name: 'しおり・動画を検索' }), '視点');
    await user.click(screen.getByRole('button', { name: 'しおり散歩' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('視点を少し下げて、いつもの景色を撮る。');
    expect(dialog).toHaveTextContent('1 / 1 枚');
    expect(within(dialog).queryByRole('button', { name: '次のしおり' })).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'この瞬間から再生' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    const video = container.querySelector('video')!;
    Object.defineProperties(video, {
      duration: { configurable: true, value: 90 },
      readyState: { configurable: true, value: 4 },
      seeking: { configurable: true, value: false },
    });
    fireEvent.loadedMetadata(video);
    fireEvent.loadedData(video);
    expect(video.currentTime).toBe(42);
    expect(video.paused).toBe(false);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('日常を切り取る');
  });

  it('場所が不明な動画を除き、絞り込み後に候補がなければ開始できない', async () => {
    const { user } = await libraryApp(true);
    await user.click(screen.getByRole('button', { name: 'しおり散歩' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('1 / 3 枚');
    expect(dialog).toHaveTextContent('日常を切り取る、映像のつくり方');
    expect(dialog).not.toHaveTextContent('余白から考える');
    await user.click(within(dialog).getByRole('button', { name: '閉じる' }));
    await user.click(screen.getByRole('button', { name: 'ブルーのしおり' }));
    expect(screen.getByRole('button', { name: 'しおり散歩' })).toBeDisabled();
  });
});
