import { BookmarkPlus, Repeat2, X } from 'lucide-react';
import { Button, IconButton } from '../../components/Button';
import { formatRepeatTime } from '../../domain/library';

export interface RepeatRange {
  start: number | null;
  end: number | null;
  enabled: boolean;
}

export const EMPTY_REPEAT: RepeatRange = { start: null, end: null, enabled: false };

export function RepeatControls({
  range,
  error,
  disabled,
  onStart,
  onEnd,
  onToggle,
  onClear,
  onSave,
}: {
  range: RepeatRange;
  error: string;
  disabled: boolean;
  onStart(): void;
  onEnd(): void;
  onToggle(): void;
  onClear(): void;
  onSave(): void;
}) {
  return (
    <div
      className="repeat-controls"
      id="repeat-controls"
      role="group"
      aria-label="区間リピート"
    >
      <div className="repeat-actions">
        <Button onClick={onStart} disabled={disabled} title="現在の再生位置を始点にする">
          <strong>A</strong>
          {range.start === null ? '始点を設定' : formatRepeatTime(range.start)}
        </Button>
        <span aria-hidden="true">→</span>
        <Button
          onClick={onEnd}
          disabled={disabled || range.start === null}
          title="現在の再生位置を終点にする"
        >
          <strong>B</strong>
          {range.end === null ? '終点を設定' : formatRepeatTime(range.end)}
        </Button>
        <Button
          variant={range.enabled ? 'primary' : 'secondary'}
          onClick={onToggle}
          disabled={disabled || range.start === null || range.end === null}
          aria-pressed={range.enabled}
        >
          <Repeat2 size={15} />
          {range.enabled ? 'リピート中' : '繰り返す'}
        </Button>
        <Button
          onClick={onSave}
          disabled={disabled || range.start === null || range.end === null}
        >
          <BookmarkPlus size={15} />
          区間をしおりに保存
        </Button>
        <IconButton
          label="リピート区間をクリア"
          onClick={onClear}
          disabled={disabled || range.start === null}
        >
          <X size={15} />
        </IconButton>
      </div>
      <p role={error ? 'alert' : undefined} className={error ? 'repeat-error' : ''}>
        {error ||
          (range.enabled
            ? '区間外に移動するとリピートを解除します。'
            : 'Aを設定し、再生やシークで進んでBを設定。0.5秒以上の区間を繰り返せます。')}
      </p>
    </div>
  );
}
