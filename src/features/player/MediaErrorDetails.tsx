import { useEffect, useRef, useState } from 'react';
import { Copy } from 'lucide-react';
import { Button } from '../../components/Button';
import { collectAssetDiagnostics } from './assetDiagnostics';
import { invoke } from '@tauri-apps/api/core';

export function MediaErrorDetails({
  diagnostics,
  sourceUrl,
  sourcePath,
  isNative,
  onNotice,
}: {
  diagnostics: string;
  sourceUrl: string;
  sourcePath: string;
  isNative: boolean;
  onNotice(message: string): void;
}) {
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [transport, setTransport] = useState<{
    snapshot: string;
    sourceUrl: string;
    sourcePath: string;
    report: string;
  } | null>(null);
  const collecting =
    isNative &&
    (transport?.snapshot !== diagnostics ||
      transport.sourceUrl !== sourceUrl ||
      transport.sourcePath !== sourcePath);
  const report = isNative
    ? collecting
      ? 'assetProbe: collecting (最大5秒)'
      : transport!.report
    : 'assetProbe: skipped (ブラウザプレビューでは実行しません)';
  const details = `${diagnostics}\n\n${report}`;

  useEffect(() => {
    if (!isNative) return;
    const controller = new AbortController();
    const finish = (report: string) => {
      if (!controller.signal.aborted)
        setTransport({ snapshot: diagnostics, sourceUrl, sourcePath, report });
    };
    void (async () => {
      let probe: string;
      try {
        probe = await collectAssetDiagnostics(sourceUrl, sourcePath, controller.signal);
      } catch (error) {
        probe = `assetProbe.error: ${String(error)}`;
      }
      if (controller.signal.aborted) return;
      try {
        const native = await invoke<string>('playback_diagnostics', { frontend: diagnostics });
        finish(`${probe}\n\n${native}`);
      } catch (error) {
        finish(`${probe}\n\nnativeLog.error: ${String(error)}`);
      }
    })();
    return () => controller.abort();
  }, [diagnostics, sourceUrl, sourcePath, isNative]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(details);
      onNotice('エラーの詳細をコピーしました。');
    } catch {
      textRef.current?.focus();
      textRef.current?.select();
      onNotice('コピーできませんでした。選択された詳細を⌘Cでコピーしてください。');
    }
  }

  return (
    <div className="media-error-details">
      <div className="media-error-details-heading">
        <h3>エラーの詳細</h3>
        <Button onClick={() => void copy()} disabled={collecting}>
          <Copy size={14} />
          詳細をコピー
        </Button>
      </div>
      <textarea
        ref={textRef}
        aria-label="再生エラーの詳細"
        value={details}
        aria-busy={collecting}
        readOnly
        spellCheck={false}
        rows={8}
      />
      <small role="status">
        {collecting && '配信情報を確認中です…（最大5秒）。'}
        診断版：ファイル名・保存パスを含む未加工ログです。共有前に必要な箇所を伏せてください。
      </small>
    </div>
  );
}
