import { Keyboard, LockKeyhole } from 'lucide-react';
import { Modal } from './Modal';

export function HelpDialog({ onClose }: { onClose(): void }) {
  return (
    <Modal title="Shioriの使い方" onClose={onClose} className="help-dialog">
      <p className="help-intro">
        動画を開いて、残したい瞬間にしおりを。
        <br />
        棚に並んだメモを押すと、その時間から再生できます。
      </p>
      <h3>
        <Keyboard size={17} />
        キーボードショートカット
      </h3>
      <dl className="shortcut-list">
        {[
          ['動画を追加', '⌘ O'],
          ['しおり・動画を検索', '⌘ K'],
          ['しおり棚へ戻る', '⌘ L'],
          ['再生 / 一時停止', 'Space'],
          ['10秒戻る / 進む', '← / →'],
          ['30秒戻る / 進む', 'Shift ← / →'],
          ['1分戻る / 進む', 'Option ← / →'],
          ['しおりを追加', 'B'],
          ['再生位置の保存 / 再試行', '⌘ S'],
          ['フルスクリーン', 'F'],
          ['集中モード / 元の表示に戻す', 'T'],
          ['集中モードを終了', 'Esc'],
          ['この画面を開く', '?'],
        ].map(([label, key]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>
              <kbd>{key}</kbd>
            </dd>
          </div>
        ))}
      </dl>
      <div className="help-note">
        <LockKeyhole size={17} />
        <div>
          <strong>動画は、元の場所に。</strong>
          <p>
            メモ・再生位置・サムネイルだけを、このMacに保存します。動画が移動したら「動画の情報」から新しい場所を指定できます。元動画と内容が一致する場合に、しおりを引き継ぎます。
          </p>
        </div>
      </div>
      <p className="help-formats">
        MP4 / MOV /
        M4Vに対応。再生できる映像・音声のコーデックはmacOSに依存します。MKV・AVI、DRM付き動画の再生や変換は行いません。
      </p>
    </Modal>
  );
}
