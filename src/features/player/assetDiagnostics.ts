import { redactMediaMessage } from './mediaDiagnostics';

export const ASSET_DIAGNOSTICS_TIMEOUT_MS = 5_000;

const PROBES = [
  { name: 'head', range: undefined },
  { name: 'firstBytes', range: 'bytes=0-1' },
  { name: 'lastBytes', range: 'bytes=-2' },
] as const;
const HEADERS = [
  'content-type',
  'content-length',
  'content-range',
  'accept-ranges',
] as const;

function isLocalAsset(sourceUrl: string): boolean {
  try {
    const url = new URL(sourceUrl);
    return (
      ((url.protocol === 'asset:' && url.hostname === 'localhost') ||
        (url.protocol === 'http:' && url.hostname === 'asset.localhost')) &&
      !url.port &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

function safeHeader(value: string | null, privateSources: readonly string[]): string {
  if (value === null) return 'not exposed or absent';
  return redactMediaMessage(value, privateSources)
    .replace(/[\r\n\t]/gu, ' ')
    .slice(0, 256);
}

function errorKind(error: unknown): string {
  // Error messages (and arbitrary error names) can contain the private source URL.
  if (error instanceof Error) {
    if (
      ['TypeError', 'AbortError', 'SecurityError', 'NotSupportedError'].includes(error.name)
    )
      return error.name;
  }
  return 'unknown';
}

async function probe(
  sourceUrl: string,
  privateSources: readonly string[],
  request: (typeof PROBES)[number],
  signal: AbortSignal,
): Promise<string> {
  const startedAt = performance.now();
  const prefix = `assetProbe.${request.name}`;
  const describe = (lines: string[]) =>
    [
      `${prefix}.request: HEAD; Range: ${request.range ?? 'none'}`,
      `${prefix}.elapsedMs: ${Math.round(performance.now() - startedAt)}`,
      ...lines.map((line) => `${prefix}.${line}`),
    ].join('\n');
  const stopped = () =>
    describe([
      'status: unavailable',
      `error: ${signal.reason === 'timeout' ? 'timeout (5000ms)' : 'cancelled'}`,
    ]);
  if (signal.aborted) return stopped();

  let onAbort = () => {};
  const aborted = new Promise<string>((resolve) => {
    onAbort = () => resolve(stopped());
    signal.addEventListener('abort', onAbort, { once: true });
  });

  // Tauri 2.11.5 handles Range before HEAD: these two ranges read at most two
  // body bytes each. HEAD without Range only sniffs the first 8 KiB for MIME.
  // Never substitute GET: a missing/stripped Range would read the entire file.
  const response = (async () => {
    try {
      const result = await fetch(sourceUrl, {
        method: 'HEAD',
        headers: request.range ? { Range: request.range } : {},
        mode: 'cors',
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        signal,
      });
      return describe([
        `status: ${result.status}`,
        `responseType: ${result.type}`,
        ...HEADERS.map(
          (header) =>
            `${header}: ${safeHeader(result.headers.get(header), privateSources)}`,
        ),
      ]);
    } catch (error) {
      if (signal.aborted) return stopped();
      return describe([
        'status: unavailable',
        `error: ${errorKind(error)} (ヘッダーを取得できませんでした)`,
      ]);
    }
  })();

  try {
    // Settle even if a WebView fails to reject fetch after an abort.
    return await Promise.race([response, aborted]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

/** Error-only, bounded probes. No request bodies, filenames, or URLs in the report. */
export async function collectAssetDiagnostics(
  sourceUrl: string,
  sourcePath: string,
  signal: AbortSignal,
): Promise<string> {
  if (signal.aborted) return 'assetProbe: cancelled';
  if (!isLocalAsset(sourceUrl))
    return 'assetProbe: skipped (ローカルのasset URLではありません)';

  const controller = new AbortController();
  const onAbort = () => controller.abort('cancelled');
  signal.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort('timeout'), ASSET_DIAGNOSTICS_TIMEOUT_MS);

  try {
    const reports = await Promise.all(
      PROBES.map((request) =>
        probe(sourceUrl, [sourcePath, sourceUrl], request, controller.signal),
      ),
    );
    return [
      'assetProbe.note: 再生エラー後の独立したHEAD確認です。再生要求そのもののログではありません。',
      'assetProbe.headerNote: not exposed or absent = 未返却、またはCORSにより非公開。',
      ...reports,
    ].join('\n');
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
}
