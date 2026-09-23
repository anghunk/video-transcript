export interface ExportDimensions {
  width: number;
  height: number;
}

export type ExportQuality = 'native' | 'high' | 'standard';

interface ResolvedDimensions {
  width: number;
  height: number;
  enforceEven: boolean;
}

/** 根据画质选项计算导出尺寸，同时对齐到偶数像素。 */
export function resolveExportDimensions(
  sourceWidth: number,
  sourceHeight: number,
  quality: ExportQuality,
): ResolvedDimensions {
  const longestSide = Math.max(sourceWidth, sourceHeight);
  const limitingHeight = Number.isFinite(longestSide) ? longestSide : 0;

  if (quality === 'native') {
    return {
      width: Math.max(2, sourceWidth - (sourceWidth % 2)),
      height: Math.max(2, sourceHeight - (sourceHeight % 2)),
      enforceEven: true,
    };
  }

  let scale = 1;
  if (quality === 'high') {
    scale = limitingHeight > 2160 ? 2160 / limitingHeight : 1;
  } else if (quality === 'standard') {
    scale = limitingHeight > 1080 ? 1080 / limitingHeight : 1;
  }

  const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);
  const width = even(sourceWidth * scale);
  const height = even(sourceHeight * scale);
  return { width, height, enforceEven: true };
}

/** 根据目标码率推导 VideoEncoder 的基础 bitrate。 */
export function resolveBitrate(
  width: number,
  height: number,
  frameRate: number,
  quality: ExportQuality,
): number {
  const pixels = width * height;
  const fps = frameRate > 0 ? frameRate : 30;
  const factor = quality === 'native' ? 0.13 : quality === 'high' ? 0.1 : 0.07;
  const base = Math.round((pixels * fps * factor) / 1000);
  return Math.max(1_000_000, Math.min(base, 80_000_000));
}
