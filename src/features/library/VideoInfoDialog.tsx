import { useState } from 'react';
import { CircleAlert, FolderInput, Link2, ShieldCheck, Trash2 } from 'lucide-react';
import {
  errorMessage,
  formatSize,
  formatTime,
  type VideoEntry,
} from '../../domain/library';
import { Button } from '../../components/Button';
import { Modal } from '../../components/Modal';

export function VideoInfoDialog({
  video,
  isNative,
  onSave,
  onRelink,
  onRemove,
  onClose,
}: {
  video: VideoEntry;
  isNative: boolean;
  onSave(title: string): Promise<void>;
  onRelink(): void;
  onRemove(): void;
  onClose(): void;
}) {
  const [title, setTitle] = useState(video.title);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  return (
    <Modal title="動画の情報" onClose={onClose} busy={saving}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (saving || !title.trim()) return;
          setSaving(true);
          void onSave(title).catch((cause: unknown) => {
            setError(errorMessage(cause));
            setSaving(false);
          });
        }}
      >
        <label className="field-label" htmlFor="video-title">
          ライブラリでの表示名
        </label>
        <input
          id="video-title"
          className="text-input"
          value={title}
          maxLength={400}
          disabled={saving}
          onChange={(event) => setTitle(event.target.value)}
        />
        <div className="video-facts">
          <span>
            {video.duration > 0 ? formatTime(video.duration) : '長さは再生時に取得'}
          </span>
          <span>{formatSize(video.byteLen)}</span>
          <span>{video.bookmarks.length}か所のしおり</span>
        </div>
        <div className="source-path">
          <div>
            <Link2 size={15} />
            <strong>ファイルの場所</strong>
            <span className={video.availability === 'available' ? '' : 'missing-label'}>
              {video.availability === 'available'
                ? '接続済み'
                : video.availability === 'changed'
                  ? '変更を検出'
                  : '見つかりません'}
            </span>
          </div>
          <p>{isNative ? video.path : 'ブラウザプレビューのデモ動画'}</p>
          <Button disabled={!isNative || saving} onClick={onRelink}>
            <FolderInput size={16} />
            ファイルの場所を再指定
          </Button>
        </div>
        <p className="safety-note">
          <ShieldCheck size={16} />
          表示名や保存場所の変更は、元の動画ファイルを変更しません。
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <Button
            variant="ghost"
            className="delete-text"
            onClick={onRemove}
            disabled={saving}
          >
            <Trash2 size={15} />
            登録を削除
          </Button>
          <span className="flex-spacer" />
          <Button onClick={onClose} disabled={saving}>
            閉じる
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={saving || !title.trim() || title.trim() === video.title}
          >
            {saving ? '保存中…' : '変更を保存'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function DeleteDialog({
  title,
  description,
  target,
  onConfirm,
  onClose,
}: {
  title: string;
  description: string;
  target: string;
  onConfirm(): Promise<void>;
  onClose(): void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Modal title={title} onClose={onClose} busy={busy}>
      <div className="delete-target">{target}</div>
      <p className="delete-description">{description}</p>
      <p className="safety-note">
        <ShieldCheck size={16} />
        元の動画ファイルは削除されません。
      </p>
      {error && (
        <p className="form-error" role="alert">
          <CircleAlert size={16} />
          {error}
        </p>
      )}
      <div className="modal-actions">
        <Button data-autofocus onClick={onClose} disabled={busy}>
          キャンセル
        </Button>
        <Button
          variant="danger"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void onConfirm().catch((cause: unknown) => {
              setError(errorMessage(cause));
              setBusy(false);
            });
          }}
        >
          {busy ? '削除中…' : '削除する'}
        </Button>
      </div>
    </Modal>
  );
}
