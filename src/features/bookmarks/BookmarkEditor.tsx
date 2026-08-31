import { useState } from 'react';
import { Bookmark as BookmarkIcon, Check, CircleAlert } from 'lucide-react';
import { COLORS, errorMessage, formatTime, type BookmarkColor } from '../../domain/library';
import { Button } from '../../components/Button';
import { Modal } from '../../components/Modal';
import { Thumbnail } from '../../components/Thumbnail';

export interface BookmarkDraft {
  kind: 'new' | 'edit';
  id: string;
  videoId: string;
  videoTitle: string;
  seconds: number;
  thumbnail: string;
  note: string;
  color: BookmarkColor;
}

export function BookmarkEditor({
  draft,
  onSave,
  onClose,
  onDelete,
}: {
  draft: BookmarkDraft;
  onSave(note: string, color: BookmarkColor): Promise<void>;
  onClose(): void;
  onDelete?(): void;
}) {
  const [note, setNote] = useState(draft.note);
  const [color, setColor] = useState(draft.color);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const valid = note.trim().length > 0 && [...note].length <= 4000;
  const submit = async () => {
    if (!valid || saving) return;
    setSaving(true);
    setError('');
    try {
      await onSave(note.trim(), color);
    } catch (cause) {
      setError(errorMessage(cause));
      setSaving(false);
    }
  };
  return (
    <Modal
      title={draft.kind === 'new' ? 'この瞬間に、しおりを。' : 'しおりのメモを編集'}
      onClose={onClose}
      busy={saving}
      className="bookmark-editor"
    >
      <div className="editor-preview">
        <Thumbnail src={draft.thumbnail} />
        <div>
          <span className={`bookmark-time color-${color}`}>
            <BookmarkIcon size={13} />
            {formatTime(draft.seconds)}
          </span>
          <p>{draft.videoTitle}</p>
          <small>この時刻とサムネイルを保存します</small>
        </div>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label className="field-label" htmlFor="bookmark-note">
          あとで見返したいこと
        </label>
        <textarea
          id="bookmark-note"
          data-autofocus
          value={note}
          placeholder="ここで気づいたこと、覚えておきたいこと…"
          rows={5}
          maxLength={8000}
          disabled={saving}
          onChange={(event) => setNote(event.target.value)}
          onKeyDown={(event) => {
            if (
              (event.metaKey || event.ctrlKey) &&
              event.key === 'Enter' &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <div className="editor-meta">
          <div className="color-picker" aria-label="しおりの色">
            {COLORS.map((item) => (
              <button
                type="button"
                key={item.value}
                aria-label={item.label}
                aria-pressed={color === item.value}
                title={item.label}
                className={`color-choice dot-${item.value}`}
                onClick={() => setColor(item.value)}
                disabled={saving}
              >
                {color === item.value && <Check size={15} />}
              </button>
            ))}
          </div>
          <span className={[...note].length > 4000 ? 'over-limit' : ''}>
            {[...note].length.toLocaleString()} / 4,000
          </span>
        </div>
        {error && (
          <p className="form-error" role="alert">
            <CircleAlert size={16} />
            {error}
          </p>
        )}
        <div className="modal-actions">
          {onDelete && (
            <Button
              variant="ghost"
              className="delete-text"
              disabled={saving}
              onClick={onDelete}
            >
              しおりを削除
            </Button>
          )}
          <span className="flex-spacer" />
          <Button onClick={onClose} disabled={saving}>
            キャンセル
          </Button>
          <Button type="submit" variant="primary" disabled={!valid || saving}>
            {saving ? '保存中…' : draft.kind === 'new' ? 'しおりを保存' : '変更を保存'}
            <kbd>⌘ ↵</kbd>
          </Button>
        </div>
      </form>
    </Modal>
  );
}
