import { useId } from 'react';
import { Button } from './Button';
import {
  type ColorAdjustments,
  ORIGINAL_COLORS,
  hasColorAdjustments,
} from '../domain/visual';

export function ColorControls({
  value,
  onChange,
  disabled = false,
}: {
  value: ColorAdjustments;
  onChange(value: ColorAdjustments): void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="color-adjustments">
      {(
        [
          ['brightness', '明るさ', 0.5],
          ['contrast', 'コントラスト', 0.5],
          ['saturation', '彩度', 0],
        ] as const
      ).map(([key, label, min]) => (
        <div className="adjustment-row" key={key}>
          <label htmlFor={`${id}-${key}`}>{label}</label>
          <output htmlFor={`${id}-${key}`}>{Math.round(value[key] * 100)}%</output>
          <input
            id={`${id}-${key}`}
            type="range"
            min={min}
            max={2}
            step={0.05}
            value={value[key]}
            aria-valuetext={`${Math.round(value[key] * 100)}%`}
            disabled={disabled}
            onChange={(event) => onChange({ ...value, [key]: Number(event.target.value) })}
          />
        </div>
      ))}
      <div className="adjustment-presets">
        <Button
          disabled={disabled}
          onClick={() => onChange({ brightness: 1.2, contrast: 1.05, saturation: 1 })}
        >
          少し明るく
        </Button>
        <Button
          disabled={disabled}
          onClick={() => onChange({ brightness: 1, contrast: 1, saturation: 0.75 })}
        >
          色を控えめに
        </Button>
        <Button
          disabled={disabled || !hasColorAdjustments(value)}
          onClick={() => onChange({ ...ORIGINAL_COLORS })}
        >
          色調をリセット
        </Button>
      </div>
    </div>
  );
}
