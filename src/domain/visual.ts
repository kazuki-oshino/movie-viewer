export interface ColorAdjustments {
  brightness: number;
  contrast: number;
  saturation: number;
}

export const ORIGINAL_COLORS: Readonly<ColorAdjustments> = {
  brightness: 1,
  contrast: 1,
  saturation: 1,
};

export function colorsOrOriginal(colors?: ColorAdjustments | null): ColorAdjustments {
  return { ...(colors ?? ORIGINAL_COLORS) };
}

export function hasColorAdjustments(colors?: ColorAdjustments | null) {
  return (
    !!colors &&
    (colors.brightness !== 1 || colors.contrast !== 1 || colors.saturation !== 1)
  );
}

export function colorFilter(colors?: ColorAdjustments | null) {
  if (!hasColorAdjustments(colors)) return 'none';
  return `brightness(${colors!.brightness}) contrast(${colors!.contrast}) saturate(${colors!.saturation})`;
}

export function validateColors(colors?: ColorAdjustments | null) {
  if (!colors) return;
  if (
    !Number.isFinite(colors.brightness) ||
    colors.brightness < 0.5 ||
    colors.brightness > 2 ||
    !Number.isFinite(colors.contrast) ||
    colors.contrast < 0.5 ||
    colors.contrast > 2 ||
    !Number.isFinite(colors.saturation) ||
    colors.saturation < 0 ||
    colors.saturation > 2
  )
    throw new Error('色調の値が範囲外です。');
}
