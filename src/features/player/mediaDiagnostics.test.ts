import { describe, expect, it } from 'vitest';
import { mediaDiagnostics, redactMediaMessage } from './mediaDiagnostics';

describe('再生エラーの診断情報', () => {
  it.each([
    [1, 'MEDIA_ERR_ABORTED'],
    [2, 'MEDIA_ERR_NETWORK'],
    [3, 'MEDIA_ERR_DECODE'],
    [4, 'MEDIA_ERR_SRC_NOT_SUPPORTED'],
    [99, 'UNKNOWN'],
  ])('コード%sを名前付きで表示し、エラー発生時の状態を保存する', (code, name) => {
    const video = document.createElement('video');
    video.src = 'asset://localhost/%2FUsers%2Fprivate-person%2Fsecret.mp4';
    Object.defineProperties(video, {
      error: { value: { code, message: 'Format error' } },
      networkState: { value: 3 },
      readyState: { value: 0 },
    });
    const diagnostics = mediaDiagnostics(
      video,
      { path: '/Users/private-person/secret.mp4', byteLen: 2_047_364_458 },
      false,
      ['0ms loadstart', '1000ms error'],
    );
    expect(diagnostics).toContain(`error.code: ${code} (${name})`);
    expect(diagnostics).toContain('error.message: "Format error"');
    expect(diagnostics).toContain(
      'Shiori playback diagnostics v4 (raw; rangeLimit=8388608)',
    );
    expect(diagnostics).toContain('networkState: 3 (NETWORK_NO_SOURCE)');
    expect(diagnostics).toContain('readyState: 0 (HAVE_NOTHING)');
    expect(diagnostics).toContain('duration: NaN');
    expect(diagnostics).toContain('sourceScheme: asset:');
    expect(diagnostics).toContain('registeredBytes: 2047364458');
    expect(diagnostics).toContain('initialPositionApplied: false');
    expect(diagnostics).toContain('1000ms error');
    expect(diagnostics).toContain('sourcePath: /Users/private-person/secret.mp4');
    expect(diagnostics).toContain(`src: ${video.src}`);
  });

  it.each([null, { code: 4, message: '' }, { code: 4, message: '  ' }])(
    'MediaErrorや詳細文が提供されない場合も診断情報を作れる: %j',
    (error) => {
      const video = document.createElement('video');
      Object.defineProperty(video, 'error', { value: error });
      const diagnostics = mediaDiagnostics(video, { path: '', byteLen: 0 }, false, []);
      expect(diagnostics).toContain(
        `error.message: ${JSON.stringify(error?.message ?? null)}`,
      );
      expect(diagnostics).toContain(
        error ? '4 (MEDIA_ERR_SRC_NOT_SUPPORTED)' : 'MediaErrorなし',
      );
      expect(diagnostics).toContain('sourceScheme: unknown');
    },
  );

  it('読み込み後の状態と秒数を保持し、不正な数値を0秒に置き換えない', () => {
    const video = document.createElement('video');
    Object.defineProperties(video, {
      duration: { value: Infinity },
      currentTime: { value: 14.123456 },
      readyState: { value: 2 },
      videoWidth: { value: 1280 },
      videoHeight: { value: 720 },
    });
    const diagnostics = mediaDiagnostics(video, { path: '', byteLen: 12 }, true, []);
    expect(diagnostics).toContain('currentTime: 14.123');
    expect(diagnostics).toContain('duration: Infinity');
    expect(diagnostics).toContain('readyState: 2 (HAVE_CURRENT_DATA)');
    expect(diagnostics).toContain('videoSize: 1280x720');
    expect(diagnostics).toContain('initialPositionApplied: true');
  });
});

describe('エラー内のファイル情報の非公開化', () => {
  const path = '/Users/private-person/秘密の 動画/プライベート #100%.mp4';

  it.each([
    path,
    encodeURI(path),
    encodeURIComponent(path),
    encodeURIComponent(path).toLowerCase(),
    path.normalize('NFD'),
    encodeURIComponent(path.normalize('NFD')),
    path.split('/').at(-1)!,
    `asset://localhost/${encodeURIComponent(path)}`,
    `file://${encodeURI(path)}`,
  ])('パス・名前・URLエンコード・Unicodeの表記差を伏せる: %s', (privateText) => {
    const result = redactMediaMessage(`Format error: "${privateText}"; code=-11828`, [
      path,
    ]);
    expect(result).toContain('Format error:');
    expect(result).toContain('code=-11828');
    expect(result).toContain('[非公開のファイル情報]');
    expect(result).not.toMatch(/private-person|秘密|プライベート|\.mp4|%2f|%25/iu);
  });

  it('未知のURLやネイティブ側の別パスも伏せる', () => {
    const result = redactMediaMessage(
      'URL="https://example.test/secret.mp4"; underlying="/Users/someone/private video.mp4"; code=-1',
      [],
    );
    expect(result).toBe(
      'URL="[非公開のファイル情報]"; underlying="[非公開のファイル情報]"; code=-1',
    );
  });

  it('ファイル情報がないエラー文や空の除外対象を変更しない', () => {
    expect(
      redactMediaMessage('The operation could not be completed. (-11828)', ['', '']),
    ).toBe('The operation could not be completed. (-11828)');
  });
});
