import { useEffect, useRef } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Crosshair, X } from 'lucide-react';
import { Button, IconButton } from '../../components/Button';
import { ColorControls } from '../../components/ColorControls';
import type { ColorAdjustments } from '../../domain/visual';

export function VisualControls({
  colors,
  onColors,
  comparing,
  onCompare,
  zoom,
  onZoom,
  onMove,
  onCenter,
  onClose,
  disabled,
}: {
  colors: ColorAdjustments;
  onColors(value: ColorAdjustments): void;
  comparing: boolean;
  onCompare(): void;
  zoom: number;
  onZoom(value: number): void;
  onMove(x: number, y: number): void;
  onCenter(): void;
  onClose(): void;
  disabled: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (
        event.target instanceof Element &&
        !panel.current?.contains(event.target) &&
        !event.target.closest('[aria-controls="visual-controls"]')
      )
        onClose();
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [onClose]);
  return (
    <div
      id="visual-controls"
      className="visual-panel"
      ref={panel}
      role="region"
      aria-label="映像の調整"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="visual-panel-heading">
        <h2>映像の調整</h2>
        <IconButton label="映像の調整を閉じる" onClick={onClose}>
          <X size={17} />
        </IconButton>
      </div>
      <h3>色調</h3>
      <ColorControls value={colors} onChange={onColors} disabled={disabled} />
      <Button onClick={onCompare} disabled={disabled} aria-pressed={comparing}>
        {comparing ? '調整した色に戻す' : '元の色で比較'}
      </Button>
      <p className="visual-hint">
        色調は動画ごとに記憶します。しおりには作成時の色調を保存します。
      </p>
      <div className="zoom-heading">
        <h3>拡大表示</h3>
        <output>{Math.round(zoom * 100)}%</output>
      </div>
      <input
        aria-label="拡大率"
        aria-valuetext={`${Math.round(zoom * 100)}%`}
        type="range"
        min={1}
        max={4}
        step={0.25}
        value={zoom}
        onChange={(e) => onZoom(Number(e.target.value))}
        disabled={disabled}
      />
      <div className="zoom-presets">
        {[1, 1.5, 2, 3, 4].map((value) => (
          <Button
            key={value}
            aria-pressed={zoom === value}
            onClick={() => onZoom(value)}
            disabled={disabled}
          >
            {value}×
          </Button>
        ))}
      </div>
      <div className="pan-controls" role="group" aria-label="拡大位置の移動">
        <IconButton
          label="映像を左に動かす"
          disabled={disabled || zoom === 1}
          onClick={() => onMove(-0.3, 0)}
        >
          <ArrowLeft size={16} />
        </IconButton>
        <IconButton
          label="映像を上に動かす"
          disabled={disabled || zoom === 1}
          onClick={() => onMove(0, -0.3)}
        >
          <ArrowUp size={16} />
        </IconButton>
        <IconButton
          label="映像を中央に戻す"
          disabled={disabled || zoom === 1}
          onClick={onCenter}
        >
          <Crosshair size={16} />
        </IconButton>
        <IconButton
          label="映像を下に動かす"
          disabled={disabled || zoom === 1}
          onClick={() => onMove(0, 0.3)}
        >
          <ArrowDown size={16} />
        </IconButton>
        <IconButton
          label="映像を右に動かす"
          disabled={disabled || zoom === 1}
          onClick={() => onMove(0.3, 0)}
        >
          <ArrowRight size={16} />
        </IconButton>
      </div>
      <p className="visual-hint">
        拡大中は映像をドラッグして移動できます。1×で全体表示に戻ります。
      </p>
    </div>
  );
}
