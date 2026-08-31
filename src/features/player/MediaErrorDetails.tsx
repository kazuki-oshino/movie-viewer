import { useEffect, useRef, useState } from 'react';
import { Copy } from 'lucide-react';
import { Button } from '../../components/Button';
import { collectAssetDiagnostics } from './assetDiagnostics';

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
    void collectAssetDiagnostics(sourceUrl, sourcePath, controller.signal).then(
      finish,
      () => finish('assetProbe: unavailable (追加診断を完了できませんでした)'),
    );
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
        ファイル名・保存パスは伏せています。この詳細だけを共有してください。
      </small>
    </div>
  );
}
