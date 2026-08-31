import { afterEach, describe, expect, it, vi } from 'vitest';
import { ASSET_DIAGNOSTICS_TIMEOUT_MS, collectAssetDiagnostics } from './assetDiagnostics';

const sourcePath = '/Users/private-person/秘密の 動画/プライベート #100%.mp4';
const sourceUrl = `asset://localhost/${encodeURIComponent(sourcePath)}`;

function response(status: number, headers: Record<string, string> = {}) {
  const result = new Response(null, { status, headers });
  Object.defineProperty(result, 'type', { value: 'cors' });
  return result;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('asset配信のエラー時診断', () => {
  it('HEADだけでサイズ・MIME・先頭と末尾のRange応答を取得し、本文を読まない', async () => {
    const replies = [
      response(200, {
        'content-type': 'video/mp4',
        'content-length': '2047364458',
      }),
      response(206, {
        'content-type': 'video/mp4',
        'content-length': '2',
        'content-range': 'bytes 0-1/2047364458',
      }),
      response(206, {
        'content-type': 'video/mp4',
        'content-length': '2',
        'content-range': 'bytes 2047364456-2047364457/2047364458',
      }),
    ];
    const bodyReaders = replies.flatMap((result) => [
      vi.spyOn(result, 'arrayBuffer'),
      vi.spyOn(result, 'text'),
      vi.spyOn(result, 'blob'),
    ]);
    const fetcher = vi.fn<typeof fetch>();
    for (const result of replies) fetcher.mockResolvedValueOnce(result);
    vi.stubGlobal('fetch', fetcher);
    const report = await collectAssetDiagnostics(
      sourceUrl,
      sourcePath,
      new AbortController().signal,
    );

    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls.map(([, options]) => options?.headers)).toEqual([
      {},
      { Range: 'bytes=0-1' },
      { Range: 'bytes=-2' },
    ]);
    for (const [url, options] of fetcher.mock.calls) {
      expect(url).toBe(sourceUrl);
      expect(options).toMatchObject({
        method: 'HEAD',
        credentials: 'omit',
        mode: 'cors',
        cache: 'no-store',
        redirect: 'error',
      });
      expect(options?.body).toBeUndefined();
      expect(options?.signal?.aborted).toBe(false);
    }
    for (const reader of bodyReaders) expect(reader).not.toHaveBeenCalled();
    expect(report).toContain('再生要求そのもののログではありません');
    expect(report).toContain('assetProbe.head.status: 200');
    expect(report).toContain('assetProbe.head.content-type: video/mp4');
    expect(report).toContain('assetProbe.head.content-length: 2047364458');
    expect(report).toContain('assetProbe.firstBytes.status: 206');
    expect(report).toContain('assetProbe.firstBytes.content-range: bytes 0-1/2047364458');
    expect(report).toContain(
      'assetProbe.lastBytes.content-range: bytes 2047364456-2047364457/2047364458',
    );
    // Tauri only exposes Content-Range; an inaccessible Accept-Ranges is not "none".
    expect(report).toContain('assetProbe.firstBytes.accept-ranges: not exposed or absent');
    expect(report).toContain('未返却、またはCORSにより非公開');
    expect(report).not.toMatch(/private-person|秘密|プライベート|asset:\/\/|%2f/iu);
  });

  it.each([403, 404, 416, 500])(
    'HTTP %sも応答として記録し、原因を断定しない',
    async (status) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(status)));
      const report = await collectAssetDiagnostics(
        sourceUrl,
        sourcePath,
        new AbortController().signal,
      );
      expect(report).toContain(`assetProbe.head.status: ${status}`);
      expect(report).toContain(`assetProbe.lastBytes.status: ${status}`);
      expect(report).not.toContain('status: unavailable');
    },
  );

  it('ヘッダーが返らない失敗はHTTPエラーと区別し、例外文や任意の例外名を共有しない', async () => {
    const error = new Error(`Failed to fetch ${sourceUrl}`);
    error.name = sourcePath;
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockRejectedValueOnce(new TypeError(`Cannot fetch ${sourcePath}`))
        .mockRejectedValueOnce(error)
        .mockRejectedValueOnce('private error text'),
    );
    const report = await collectAssetDiagnostics(
      sourceUrl,
      sourcePath,
      new AbortController().signal,
    );
    expect(report).toContain('assetProbe.head.status: unavailable');
    expect(report).toContain('assetProbe.head.error: TypeError');
    expect(report).toContain('assetProbe.firstBytes.error: unknown');
    expect(report).toContain('assetProbe.lastBytes.error: unknown');
    expect(report).not.toMatch(/private|秘密|プライベート|asset:\/\/|%2f/iu);
  });

  it('選択したヘッダーだけを表示し、URLやファイル名を伏せる', async () => {
    const result = response(200, {
      'content-type': `text/plain; name="${encodeURIComponent(sourcePath)}"`,
      'content-disposition': `attachment; filename="${encodeURIComponent(sourcePath.split('/').at(-1)!)}"`,
      'x-private-path': encodeURIComponent(sourcePath),
    });
    Object.defineProperties(result, {
      url: { value: sourceUrl },
      statusText: { value: sourcePath },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(result));
    const report = await collectAssetDiagnostics(
      sourceUrl,
      sourcePath,
      new AbortController().signal,
    );
    expect(report).toContain('content-type: text/plain; name="[非公開のファイル情報]"');
    expect(report).not.toMatch(/disposition|private|秘密|プライベート|asset:\/\/|%2f/iu);
  });

  it('Rangeを無視した200応答もHEADなので全文取得には切り替えない', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(response(200, { 'content-length': '2047364458' }));
    vi.stubGlobal('fetch', fetcher);
    const report = await collectAssetDiagnostics(
      sourceUrl,
      sourcePath,
      new AbortController().signal,
    );
    expect(report).toContain('assetProbe.firstBytes.status: 200');
    expect(report).toContain('assetProbe.lastBytes.status: 200');
    expect(fetcher.mock.calls).toHaveLength(3);
    expect(fetcher.mock.calls.every(([, options]) => options.method === 'HEAD')).toBe(true);
  });

  it('fetchがAbortを無視しても全体を5秒で完了し、全リクエストに中断を伝える', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {}));
    vi.stubGlobal('fetch', fetcher);
    const pending = collectAssetDiagnostics(
      sourceUrl,
      sourcePath,
      new AbortController().signal,
    );
    await vi.advanceTimersByTimeAsync(ASSET_DIAGNOSTICS_TIMEOUT_MS);
    const report = await pending;
    expect(report.match(/error: timeout \(5000ms\)/gu)).toHaveLength(3);
    expect(fetcher.mock.calls.every(([, options]) => options?.signal?.aborted)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('遷移時に中断でき、後からfetchが失敗しても未処理の例外を出さない', async () => {
    vi.useFakeTimers();
    const fail: ((error: Error) => void)[] = [];
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      () =>
        new Promise((_, reject) => {
          fail.push(reject);
        }),
    );
    vi.stubGlobal('fetch', fetcher);
    const controller = new AbortController();
    const pending = collectAssetDiagnostics(sourceUrl, sourcePath, controller.signal);
    controller.abort();
    const report = await pending;
    expect(report.match(/error: cancelled/gu)).toHaveLength(3);
    for (const reject of fail) reject(new Error(sourcePath));
    await Promise.resolve();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('開始前に中断されていたら通信しない', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const controller = new AbortController();
    controller.abort();
    expect(await collectAssetDiagnostics(sourceUrl, sourcePath, controller.signal)).toBe(
      'assetProbe: cancelled',
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    'https://external.example/private.mp4',
    'file:///Users/private-person/private.mp4',
    'http://127.0.0.1:1421/demo/demo-0.mp4',
    'http://asset.localhost:8080/private.mp4',
    'asset://external.example/private.mp4',
    'asset://user:pass@localhost/private.mp4',
    'asset://localhost/private.mp4?token=private',
    'asset://localhost/private.mp4#private',
    'not a URL',
  ])('ローカルのasset以外へ確認リクエストを送らない: %s', async (url) => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const report = await collectAssetDiagnostics(
      url,
      sourcePath,
      new AbortController().signal,
    );
    expect(report).toContain('assetProbe: skipped');
    expect(report).not.toContain(url);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
