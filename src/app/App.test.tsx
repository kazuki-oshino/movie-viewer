import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { PreviewGateway } from '../platform/previewGateway';
import * as tauriCore from '@tauri-apps/api/core';
import * as assetDiagnostics from '../features/player/assetDiagnostics';

vi.mock('@tauri-apps/api/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tauri-apps/api/core')>()),
  invoke: vi.fn(),
}));

async function demoApp() {
  const gateway = new PreviewGateway();
  await gateway.importVideo('demo-0');
  await gateway.importVideo('demo-1');
  const user = userEvent.setup();
  const result = render(<App gateway={gateway} />);
  await screen.findByRole('heading', { name: /しおり棚\s*6/ });
  return { gateway, user, ...result };
}

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
  fireEvent.canPlay(video);
}

describe('ライブラリの画面', () => {
  it('初回起動は空の棚で、許可なくデモや実ファイルを追加しない', async () => {
    const gateway = new PreviewGateway();
    const imported = vi.spyOn(gateway, 'importVideo');
    render(<App gateway={gateway} />);
    expect(await screen.findByRole('button', { name: 'デモ動画で試す' })).toBeVisible();
    expect(screen.getByRole('heading', { name: /しおり棚\s*0/ })).toBeVisible();
    expect(imported).not.toHaveBeenCalled();
  });

  it('検索・色・動画の絞り込みが実際のカードを更新する', async () => {
    const { user, gateway } = await demoApp();
    await user.type(screen.getByRole('textbox', { name: 'しおり・動画を検索' }), '行間');
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByText('文字の大きさだけでなく、行間にもリズムを。')).toBeVisible();
    await user.click(screen.getByRole('button', { name: '検索をクリア' }));
    await user.click(screen.getByRole('button', { name: 'ローズのしおり' }));
    expect(screen.getAllByRole('article')).toHaveLength(1);
    await user.selectOptions(
      screen.getByRole('combobox', { name: '動画で絞り込み' }),
      (await gateway.list()).videos[0].id,
    );
    expect(screen.queryAllByRole('article')).toHaveLength(0);
    expect(screen.getByText('しおりが見つかりませんでした')).toBeVisible();
    await user.click(screen.getByRole('button', { name: '絞り込みをリセット' }));
    expect(screen.getAllByRole('article')).toHaveLength(6);
  });

  it('リスト表示とグリッド表示を切り替えられる', async () => {
    const { user, container } = await demoApp();
    await user.click(screen.getByRole('button', { name: 'リスト表示' }));
    expect(container.querySelector('.bookmark-grid')).toHaveClass('is-list');
    expect(screen.getByRole('button', { name: 'リスト表示' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(screen.getByRole('button', { name: 'グリッド表示' }));
    expect(container.querySelector('.bookmark-grid')).not.toHaveClass('is-list');
  });

  it('メモの編集と色変更を保存し、失敗時は入力を残す', async () => {
    const { user, gateway } = await demoApp();
    const edit = vi
      .spyOn(gateway, 'editBookmark')
      .mockRejectedValueOnce(new Error('保存先の容量が不足しています'));
    await user.click(
      screen.getByRole('button', { name: 'メモを編集: 余白は、情報の優先順位をつくる。' }),
    );
    const note = screen.getByRole('textbox', { name: 'あとで見返したいこと' });
    await user.clear(note);
    await user.type(note, '編集した大切なメモ');
    await user.click(screen.getByRole('button', { name: 'ブルー' }));
    await user.click(screen.getByRole('button', { name: /変更を保存/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '保存先の容量が不足しています',
    );
    expect(note).toHaveValue('編集した大切なメモ');
    await user.click(screen.getByRole('button', { name: /変更を保存/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByText('編集した大切なメモ')).toBeVisible();
    expect(edit).toHaveBeenCalledTimes(2);
    const video = (await gateway.list()).videos[0];
    expect(video.bookmarks.find((mark) => mark.note === '編集した大切なメモ')?.color).toBe(
      'blue',
    );
  });

  it('しおり削除は確認が必要で、キャンセルは記録を変えない', async () => {
    const { user, gateway } = await demoApp();
    const remove = vi.spyOn(gateway, 'removeBookmark');
    await user.click(
      screen.getByRole('button', {
        name: 'しおりを削除: 余白は、情報の優先順位をつくる。',
      }),
    );
    expect(screen.getByRole('dialog')).toHaveTextContent(
      '元の動画ファイルは削除されません。',
    );
    expect(remove).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'キャンセル' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'キャンセル' }));
    expect(screen.getAllByRole('article')).toHaveLength(6);
    await user.click(
      screen.getByRole('button', {
        name: 'しおりを削除: 余白は、情報の優先順位をつくる。',
      }),
    );
    await user.click(screen.getByRole('button', { name: '削除する' }));
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(5));
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('読み込めない記録の警告を表示して、正常な棚を残す', async () => {
    const gateway = new PreviewGateway();
    const video = await gateway.importVideo('demo-0');
    vi.spyOn(gateway, 'list').mockResolvedValue({
      videos: [video],
      warnings: ['broken.json: 読み込み失敗'],
    });
    render(<App gateway={gateway} />);
    expect(await screen.findByText(/読み込めない保存データが1件/)).toBeVisible();
    expect(screen.getAllByRole('article')).toHaveLength(3);
  });

  it('初期化に失敗しても終了要求を受け付ける', async () => {
    const gateway = new PreviewGateway();
    let quit: (() => void) | undefined;
    vi.spyOn(gateway, 'onQuitRequested').mockImplementation(async (callback) => {
      quit = callback;
      return () => {};
    });
    vi.spyOn(gateway, 'initialize').mockRejectedValue(new Error('保存先を開けません'));
    const finish = vi.spyOn(gateway, 'finishQuit');
    render(<App gateway={gateway} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('保存先を開けません');
    await act(async () => {
      quit?.();
    });
    await waitFor(() => expect(finish).toHaveBeenCalledTimes(1));
  });

  it('動画の削除では登録としおりを確認する', async () => {
    const { user, gateway } = await demoApp();
    const remove = vi.spyOn(gateway, 'removeVideo');
    await user.click(screen.getByRole('button', { name: /すべての動画\s*2/ }));
    await user.click(
      await screen.findByRole('button', {
        name: '動画の情報: 余白から考える、伝わるデザイン',
      }),
    );
    await user.click(screen.getByRole('button', { name: '登録を削除' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('3か所のしおり');
    expect(remove).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '削除する' }));
    await waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
    expect((await gateway.list()).videos).toHaveLength(1);
  });

  it('動画が見つからなくても既存のしおりを保持して再指定を案内する', async () => {
    const { user, gateway } = await demoApp();
    vi.spyOn(gateway, 'openVideo').mockRejectedValue(new Error('動画が見つかりません'));
    await user.click(
      screen.getByRole('button', {
        name: '0:14から再生: 余白は、情報の優先順位をつくる。',
      }),
    );
    expect(await screen.findByRole('dialog')).toHaveTextContent(
      '保存したしおりとメモは、そのまま残っています。',
    );
    expect((await gateway.list()).videos[0].bookmarks).toHaveLength(3);
  });
});

describe('動画プレイヤー', () => {
  beforeEach(() => {
    vi.mocked(tauriCore.invoke).mockReset().mockResolvedValue('nativeLog: fixture');
  });
  it('ネイティブの再生失敗時だけ配信診断を一度実行し、完了後にまとめてコピーできる', async () => {
    let finish!: (report: string) => void;
    const inspect = vi
      .spyOn(assetDiagnostics, 'collectAssetDiagnostics')
      .mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
    const { user, container, gateway } = await demoApp();
    Object.defineProperty(gateway, 'isNative', { value: true });
    vi.spyOn(gateway, 'videoUrl').mockReturnValue('asset://localhost/private-video.mp4');
    await user.click(
      screen.getByRole('button', { name: '余白から考える、伝わるデザイン' }),
    );
    expect(inspect).not.toHaveBeenCalled();
    const video = container.querySelector('video')!;
    Object.defineProperty(video, 'error', {
      configurable: true,
      value: { code: 4, message: `Failed: ${video.src}` },
    });
    fireEvent.error(video);
    expect(inspect).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '詳細をコピー' })).toBeDisabled();
    expect(screen.getByText(/配信情報を確認中/)).toBeVisible();
    const details = screen.getByRole('textbox', {
      name: '再生エラーの詳細',
    }) as HTMLTextAreaElement;
    expect(details).toHaveAttribute('aria-busy', 'true');
    expect(details.value).toContain('Shiori playback diagnostics v4');
    expect(details.value).toContain('4 (MEDIA_ERR_SRC_NOT_SUPPORTED)');

    Object.defineProperty(video, 'error', { value: { code: 2, message: 'later error' } });
    fireEvent.error(video);
    expect(inspect).toHaveBeenCalledTimes(1);
    await act(async () =>
      finish('assetProbe.head.status: 200\nassetProbe.head.content-type: video/mp4'),
    );
    expect(details).toHaveAttribute('aria-busy', 'false');
    expect(details.value).toContain('assetProbe.head.status: 200');
    expect(details.value).toContain('4 (MEDIA_ERR_SRC_NOT_SUPPORTED)');
    expect(details.value).not.toContain('later error');
    expect(details.value).toContain('private-video');
    expect(details.value).toContain('nativeLog: fixture');
    expect(tauriCore.invoke).toHaveBeenCalledWith('playback_diagnostics', {
      frontend: expect.stringContaining('Shiori playback diagnostics v4'),
    });
    expect(screen.getByText(/ファイル名・保存パスを含む未加工ログ/)).toBeVisible();
    const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    await user.click(screen.getByRole('button', { name: '詳細をコピー' }));
    expect(copy).toHaveBeenCalledWith(details.value);
  });

  it('動画の切り替えで追加診断を中断し、遅れて届いた結果を次の動画に混ぜない', async () => {
    let finishFirst!: (report: string) => void;
    const inspect = vi
      .spyOn(assetDiagnostics, 'collectAssetDiagnostics')
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishFirst = resolve;
          }),
      )
      .mockResolvedValueOnce('assetProbe.head.status: 403');
    const { user, container, gateway } = await demoApp();
    Object.defineProperty(gateway, 'isNative', { value: true });
    await user.click(
      screen.getByRole('button', { name: '余白から考える、伝わるデザイン' }),
    );
    fireEvent.error(container.querySelector('video')!);
    const firstSignal = inspect.mock.calls[0][2];
    expect(firstSignal.aborted).toBe(false);
    await user.click(
      screen.getByRole('button', { name: '日常を切り取る、映像のつくり方' }),
    );
    expect(firstSignal.aborted).toBe(true);
    expect(
      screen.queryByRole('textbox', { name: '再生エラーの詳細' }),
    ).not.toBeInTheDocument();
    fireEvent.error(container.querySelector('video')!);
    const details = screen.getByRole('textbox', {
      name: '再生エラーの詳細',
    }) as HTMLTextAreaElement;
    await waitFor(() => expect(details.value).toContain('assetProbe.head.status: 403'));
    await act(async () => finishFirst('assetProbe.head.status: 200'));
    expect(details.value).not.toContain('assetProbe.head.status: 200');
    expect(details.value).toContain('assetProbe.head.status: 403');
  });

  it('追加診断やネイティブログが失敗しても元のエラーと未加工の例外を保持する', async () => {
    vi.mocked(tauriCore.invoke).mockRejectedValueOnce(new Error('native fixture failure'));
    vi.spyOn(assetDiagnostics, 'collectAssetDiagnostics').mockRejectedValue(
      new Error('/Users/private-person/private.mp4'),
    );
    const { user, container, gateway } = await demoApp();
    Object.defineProperty(gateway, 'isNative', { value: true });
    await user.click(
      screen.getByRole('button', { name: '余白から考える、伝わるデザイン' }),
    );
    const video = container.querySelector('video')!;
    Object.defineProperty(video, 'error', { value: { code: 4, message: '' } });
    fireEvent.error(video);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '詳細をコピー' })).toBeEnabled(),
    );
    const details = screen.getByRole('textbox', {
      name: '再生エラーの詳細',
    }) as HTMLTextAreaElement;
    expect(details.value).toContain('4 (MEDIA_ERR_SRC_NOT_SUPPORTED)');
    expect(details.value).toContain(
      'assetProbe.error: Error: /Users/private-person/private.mp4',
    );
    expect(details.value).toContain('nativeLog.error: Error: native fixture failure');
  });

  it('再生失敗の元メッセージと状態を固定し、未加工の詳細をコピーできる', async () => {
    const inspect = vi.spyOn(assetDiagnostics, 'collectAssetDiagnostics');
    const { user, container, gateway } = await demoApp();
    const save = vi.spyOn(gateway, 'saveProgress');
    await user.click(
      screen.getByRole('button', { name: '余白から考える、伝わるデザイン' }),
    );
    const video = container.querySelector('video')!;
    Object.defineProperties(video, {
      error: {
        configurable: true,
        value: { code: 4, message: `Format error: "${video.src}"; code=-11828` },
      },
      networkState: { value: 3 },
      readyState: { value: 0 },
    });
    fireEvent.loadStart(video);
    fireEvent.stalled(video);
    fireEvent.error(video);
    expect(
      screen.getByRole('heading', { name: 'この動画を開けませんでした' }),
    ).toBeVisible();
    const details = screen.getByRole('textbox', {
      name: '再生エラーの詳細',
    }) as HTMLTextAreaElement;
    const captured = details.value;
    expect(captured).toContain('4 (MEDIA_ERR_SRC_NOT_SUPPORTED)');
    expect(captured).toContain(`error.message: ${JSON.stringify(video.error!.message)}`);
    expect(captured).toContain('3 (NETWORK_NO_SOURCE)');
    expect(captured).toMatch(/loadstart\n.*stalled\n.*error/u);
    expect(captured).toContain('demo-0');
    expect(details).toHaveAttribute('readonly');
    expect(screen.getByRole('button', { name: '再生' })).toBeDisabled();
    expect(save).not.toHaveBeenCalled();
    expect(inspect).not.toHaveBeenCalled();
    expect(captured).toContain('assetProbe: skipped');

    // The captured error remains available even if WebKit clears its live state.
    Object.defineProperty(video, 'error', { value: null });
    fireEvent.suspend(video);
    expect(details).toHaveValue(captured);
    const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    await user.click(screen.getByRole('button', { name: '詳細をコピー' }));
    expect(copy).toHaveBeenCalledWith(captured);
    expect(await screen.findByText('エラーの詳細をコピーしました。')).toBeVisible();
  });

  it('コピーが拒否されても詳細を全選択し、手動コピーを案内する', async () => {
    const { user, container } = await demoApp();
    await user.click(
      screen.getByRole('button', { name: '余白から考える、伝わるデザイン' }),
    );
    const video = container.querySelector('video')!;
    Object.defineProperty(video, 'error', { value: { code: 4, message: '' } });
    fireEvent.error(video);
    const details = screen.getByRole('textbox', {
      name: '再生エラーの詳細',
    }) as HTMLTextAreaElement;
    expect(details.value).toContain('error.message: ""');
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(
      new DOMException('Denied', 'NotAllowedError'),
    );
    await user.click(screen.getByRole('button', { name: '詳細をコピー' }));
    expect(await screen.findByText(/選択された詳細を⌘Cでコピーしてください/)).toBeVisible();
    expect(details).toHaveFocus();
    expect(details.selectionStart).toBe(0);
    expect(details.selectionEnd).toBe(details.value.length);
  });

  it('動画の長さを取得できない場合もMediaErrorなしの状態を表示する', async () => {
    const { user, container } = await demoApp();
    await user.click(
      screen.getByRole('button', { name: '余白から考える、伝わるデザイン' }),
    );
    fireEvent.loadedMetadata(container.querySelector('video')!);
    expect(screen.getByText(/動画の長さを読み取れません/)).toBeVisible();
    const details = screen.getByRole('textbox', {
      name: '再生エラーの詳細',
    }) as HTMLTextAreaElement;
    expect(details.value).toContain('none (MediaErrorなし)');
    expect(details.value).toContain('duration: NaN');
    expect(details.value).toContain('invalid-duration');
  });

  it('イベント履歴を16件までに制限し、別の動画へ移動したらエラーを引き継がない', async () => {
    const { user, container } = await demoApp();
    await user.click(
      screen.getByRole('button', { name: '余白から考える、伝わるデザイン' }),
    );
    const video = container.querySelector('video')!;
    fireEvent.loadStart(video);
    for (let index = 0; index < 20; index++) fireEvent.waiting(video);
    fireEvent.error(video);
    const details = screen.getByRole('textbox', {
      name: '再生エラーの詳細',
    }) as HTMLTextAreaElement;
    expect(details.value).not.toContain('loadstart');
    expect(details.value.match(/^  \d+ms /gmu)).toHaveLength(16);
    await user.click(
      screen.getByRole('button', { name: '日常を切り取る、映像のつくり方' }),
    );
    expect(
      screen.queryByRole('textbox', { name: '再生エラーの詳細' }),
    ).not.toBeInTheDocument();
    const nextVideo = container.querySelector('video')!;
    ready(nextVideo);
    expect(screen.getByRole('button', { name: '再生' })).toBeEnabled();
    expect(screen.queryByText('この動画を開けませんでした')).not.toBeInTheDocument();
  });

  it('動画の準備ができてからしおりの時刻に移動して再生する', async () => {
    const { user, container } = await demoApp();
    await user.click(
      screen.getByRole('button', {
        name: '0:14から再生: 余白は、情報の優先順位をつくる。',
      }),
    );
    const video = container.querySelector('video')!;
    ready(video);
    await waitFor(() => expect(video.currentTime).toBe(14));
    expect(video.paused).toBe(false);
    expect(screen.getByRole('button', { name: '一時停止' })).toBeEnabled();
  });

  it('初期シーク中にplayを要求してもseekedまで要求を保持する', async () => {
    const { user, container } = await demoApp();
    await user.click(
      screen.getByRole('button', {
        name: '0:42から再生: 文字の大きさだけでなく、行間にもリズムを。',
      }),
    );
    const video = container.querySelector('video')!;
    Object.defineProperties(video, {
      duration: { configurable: true, value: 90 },
      readyState: { configurable: true, value: 1 },
      seeking: { configurable: true, value: true },
    });
    fireEvent.loadedMetadata(video);
    fireEvent.loadedData(video);
    expect(video.paused).toBe(true);
    Object.defineProperties(video, {
      readyState: { configurable: true, value: 4 },
      seeking: { configurable: true, value: false },
    });
    fireEvent.seeked(video);
    expect(video.paused).toBe(false);
    expect(video.currentTime).toBe(42);
  });

  it('最初の映像が読み込まれる前に保存位置へシークしたり0秒を保存したりしない', async () => {
    const { user, gateway, container } = await demoApp();
    const save = vi.spyOn(gateway, 'saveProgress');
    await user.click(
      screen.getByRole('button', {
        name: '0:42から再生: 文字の大きさだけでなく、行間にもリズムを。',
      }),
    );
    const video = container.querySelector('video')!;
    Object.defineProperties(video, {
      duration: { configurable: true, value: 90 },
      readyState: { configurable: true, value: 1 },
      seeking: { configurable: true, value: false },
    });
    fireEvent.loadedMetadata(video);
    fireEvent.timeUpdate(video);
    expect(video.currentTime).toBe(0);
    expect(save).not.toHaveBeenCalled();
    Object.defineProperty(video, 'readyState', { configurable: true, value: 4 });
    fireEvent.loadedData(video);
    expect(video.currentTime).toBe(42);
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls.every(([, , progress]) => progress.position === 42)).toBe(true);
  });

  it('全てのスキップをクランプし、速度の下限と上限を適用する', async () => {
    const { user, container } = await demoApp();
    await user.click(
      screen.getByRole('button', { name: '余白から考える、伝わるデザイン' }),
    );
    const video = container.querySelector('video')!;
    ready(video);
    for (const [name, seconds] of [
      ['60秒戻る', 0],
      ['30秒進む', 30],
      ['10秒進む', 40],
      ['10秒戻る', 30],
      ['30秒戻る', 0],
      ['60秒進む', 60],
      ['60秒進む', 90],
    ] as const) {
      await user.click(screen.getByRole('button', { name }));
      expect(video.currentTime).toBe(seconds);
    }
    await user.selectOptions(screen.getByRole('combobox', { name: '再生速度' }), '0.1');
    expect(video.playbackRate).toBe(0.1);
    await user.selectOptions(screen.getByRole('combobox', { name: '再生速度' }), '2');
    expect(video.playbackRate).toBe(2);
  });

  it('キャプチャした時刻・画像・メモを同じしおりとして保存する', async () => {
    const { user, gateway, container } = await demoApp();
    const add = vi.spyOn(gateway, 'addBookmark');
    await user.click(
      screen.getByRole('button', { name: '余白から考える、伝わるデザイン' }),
    );
    const video = container.querySelector('video')!;
    ready(video);
    video.currentTime = 32.5;
    await user.click(screen.getByRole('button', { name: /しおりを追加\s*B/ }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('0:32');
    expect(screen.getByRole('button', { name: /しおりを保存/ })).toBeDisabled();
    await user.type(
      screen.getByRole('textbox', { name: 'あとで見返したいこと' }),
      '画面を確認して記録する',
    );
    await user.click(screen.getByRole('button', { name: /しおりを保存/ }));
    await waitFor(() => expect(add).toHaveBeenCalledTimes(1));
    expect(add.mock.calls[0][1]).toMatchObject({
      seconds: 32.5,
      thumbnailDataUrl: 'data:image/jpeg;base64,dGVzdA==',
      note: '画面を確認して記録する',
    });
    expect(video.paused).toBe(true);
    expect((await gateway.list()).videos[0].bookmarks).toHaveLength(4);
  });

  it('集中モードの切り替えで再生を中断せず、しおりを追加して元の表示に戻れる', async () => {
    const { user, gateway, container } = await demoApp();
    const open = vi.spyOn(gateway, 'openVideo');
    await user.click(
      screen.getByRole('button', { name: '余白から考える、伝わるデザイン' }),
    );
    const video = container.querySelector('video')!;
    ready(video);
    video.currentTime = 32.5;
    await user.click(screen.getByRole('button', { name: '再生' }));
    await user.click(screen.getByRole('button', { name: /集中モード/ }));
    expect(screen.getByRole('button', { name: /元の表示に戻す/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'この動画のしおり' })).toBeNull();
    expect(container.querySelector('video')).toBe(video);
    expect(video.currentTime).toBe(32.5);
    expect(video.paused).toBe(false);
    expect(open).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'しおりを追加 (B)' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('0:32');
    await user.type(screen.getByRole('textbox', { name: 'あとで見返したいこと' }), 'test');
    expect(screen.getByRole('button', { name: /元の表示に戻す/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(screen.getByRole('button', { name: /しおりを保存/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await user.keyboard('{Escape}');
    expect(screen.getByRole('navigation')).toBeVisible();
    expect(screen.getByRole('complementary', { name: 'この動画のしおり' })).toBeVisible();
    expect(container.querySelector('video')).toBe(video);
    expect((await gateway.list()).videos[0].bookmarks).toHaveLength(4);
    await user.keyboard('t');
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'しおり棚に戻る' }));
    expect(await screen.findByRole('navigation')).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'しおり・動画を検索' })).toBeEnabled();
  });

  it('コンパクトな操作バーでも音量・ミュート・フルスクリーンを操作できる', async () => {
    const { user, gateway, container } = await demoApp();
    const fullscreen = vi.spyOn(gateway, 'toggleFullscreen');
    await user.click(
      screen.getByRole('button', { name: '余白から考える、伝わるデザイン' }),
    );
    const video = container.querySelector('video')!;
    ready(video);
    const toolbar = within(container.querySelector<HTMLElement>('.player-toolbar')!);
    fireEvent.change(toolbar.getByRole('slider', { name: '音量' }), {
      target: { value: '0.35' },
    });
    expect(video.volume).toBe(0.35);
    await user.click(toolbar.getByRole('button', { name: 'ミュート' }));
    expect(video.muted).toBe(true);
    await user.click(toolbar.getByRole('button', { name: 'ミュートを解除' }));
    expect(video.muted).toBe(false);
    await user.click(toolbar.getByRole('button', { name: 'フルスクリーン (F)' }));
    expect(fullscreen).toHaveBeenCalledTimes(1);
    expect(toolbar.getByRole('combobox', { name: '再生速度' })).toBeEnabled();
  });

  it('保存状態は時刻の横に表示し、保存失敗の詳細と再試行を残す', async () => {
    const { user, gateway, container } = await demoApp();
    const save = vi
      .spyOn(gateway, 'saveProgress')
      .mockRejectedValue(new Error('ディスクへの保存に失敗'));
    await user.click(
      screen.getByRole('button', { name: '余白から考える、伝わるデザイン' }),
    );
    ready(container.querySelector('video')!);
    const timeline = within(container.querySelector<HTMLElement>('.timeline-times')!);
    await waitFor(() =>
      expect(timeline.getByRole('status')).toHaveTextContent('再生位置を保存できません'),
    );
    expect(screen.getByRole('alert')).toHaveTextContent('ディスクへの保存に失敗');
    save.mockRestore();
    await user.click(screen.getByRole('button', { name: '再試行' }));
    await waitFor(() =>
      expect(timeline.getByRole('status')).toHaveTextContent('再生位置を保存済み'),
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('メモ入力中のSpace・矢印・Bをプレイヤー操作として扱わない', async () => {
    const { user, container } = await demoApp();
    await user.click(
      screen.getByRole('button', { name: '余白から考える、伝わるデザイン' }),
    );
    const video = container.querySelector('video')!;
    ready(video);
    await user.click(screen.getByRole('button', { name: /しおりを追加\s*B/ }));
    const note = await screen.findByRole('textbox', { name: 'あとで見返したいこと' });
    const before = video.currentTime;
    await user.type(note, 'b text{ArrowLeft}');
    expect(video.currentTime).toBe(before);
    expect(video.paused).toBe(true);
  });

  it('保存失敗中は棚への移動を止め、再試行後に復帰する', async () => {
    const { user, gateway, container } = await demoApp();
    const save = vi
      .spyOn(gateway, 'saveProgress')
      .mockRejectedValue(new Error('ディスクへの保存に失敗'));
    await user.click(
      screen.getByRole('button', { name: '余白から考える、伝わるデザイン' }),
    );
    ready(container.querySelector('video')!);
    await waitFor(() => expect(screen.getByText('再生位置を保存できません')).toBeVisible());
    await user.click(screen.getByRole('button', { name: 'しおり棚に戻る' }));
    expect(screen.getByRole('region', { name: '動画プレイヤー' })).toBeVisible();
    save.mockRestore();
    await user.click(screen.getByRole('button', { name: 'しおり棚に戻る' }));
    await screen.findByRole('heading', { name: /しおり棚\s*6/ });
  });

  it('動画切り替え前の保存失敗を再指定エラーと混同せず、保留中の再生も止める', async () => {
    const { user, gateway, container } = await demoApp();
    const open = vi.spyOn(gateway, 'openVideo');
    vi.spyOn(gateway, 'saveProgress').mockRejectedValue(
      new Error('ディスクへの保存に失敗'),
    );
    await user.click(
      screen.getByRole('button', {
        name: '0:42から再生: 文字の大きさだけでなく、行間にもリズムを。',
      }),
    );
    const video = container.querySelector('video')!;
    Object.defineProperties(video, {
      duration: { configurable: true, value: 90 },
      readyState: { configurable: true, value: 1 },
      seeking: { configurable: true, value: true },
    });
    fireEvent.loadedMetadata(video);
    fireEvent.loadedData(video);
    await waitFor(() => expect(screen.getByText('再生位置を保存できません')).toBeVisible());
    const next = (await gateway.list()).videos[1];
    await user.click(screen.getByRole('button', { name: next.title }));
    expect(open).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: '動画プレイヤー' })).toBeVisible();
    Object.defineProperties(video, {
      readyState: { configurable: true, value: 4 },
      seeking: { configurable: true, value: false },
    });
    fireEvent.seeked(video);
    fireEvent.canPlay(video);
    expect(video.paused).toBe(true);
  });

  it('終了要求は再生位置の保存が完了するまで待機する', async () => {
    const gateway = new PreviewGateway();
    await gateway.importVideo('demo-0');
    let quit: (() => void) | undefined;
    vi.spyOn(gateway, 'onQuitRequested').mockImplementation(async (callback) => {
      quit = callback;
      return () => {};
    });
    const finish = vi.spyOn(gateway, 'finishQuit');
    const user = userEvent.setup();
    const { container } = render(<App gateway={gateway} />);
    await user.click(
      await screen.findByRole('button', { name: '余白から考える、伝わるデザイン' }),
    );
    ready(container.querySelector('video')!);
    await waitFor(() => expect(screen.getByText('再生位置を保存済み')).toBeVisible());
    let resolve!: () => void;
    const pending = new Promise<void>((done) => {
      resolve = done;
    });
    vi.spyOn(gateway, 'saveProgress').mockReturnValue(pending);
    act(() => {
      quit?.();
    });
    expect(finish).not.toHaveBeenCalled();
    await act(async () => {
      resolve();
      await pending;
    });
    await waitFor(() => expect(finish).toHaveBeenCalledTimes(1));
  });

  it('編集ダイアログが開いている間はネイティブ終了を許可しない', async () => {
    const gateway = new PreviewGateway();
    await gateway.importVideo('demo-0');
    let quit: (() => void) | undefined;
    vi.spyOn(gateway, 'onQuitRequested').mockImplementation(async (callback) => {
      quit = callback;
      return () => {};
    });
    const finish = vi.spyOn(gateway, 'finishQuit');
    const user = userEvent.setup();
    render(<App gateway={gateway} />);
    await user.click(
      await screen.findByRole('button', {
        name: 'メモを編集: 余白は、情報の優先順位をつくる。',
      }),
    );
    await user.type(
      within(screen.getByRole('dialog')).getByRole('textbox'),
      '未保存の追記',
    );
    act(() => {
      quit?.();
    });
    expect(finish).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeVisible();
  });
});
