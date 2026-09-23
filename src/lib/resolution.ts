export interface ExportDimensions {
  width: number;
  height: number;
}

export type ExportQuality = 'native' | 'high' | 'standard';

export interface SourceVideoProfile {
  width: number;
  height: number;
  bitrate: number;
  codec: string;
}

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

const QUALITY_FACTORS: Record<ExportQuality, number> = {
  native: 1.15,
  high: 1,
  standard: 0.85,
};

const FALLBACK_BITS_PER_PIXEL: Record<ExportQuality, number> = {
  native: 0.13,
  high: 0.1,
  standard: 0.07,
};

const MIN_BITRATE = 1_000_000;
const MAX_BITRATE = 80_000_000;

/** H.264 编码器通常需要更高码率，才能接近更新一代源编码的画质。 */
function sourceCodecFactor(codec: string): number {
  const normalized = codec.toLowerCase();
  if (normalized.startsWith('avc1') || normalized.startsWith('avc3')) return 1;
  if (normalized.startsWith('hvc1') || normalized.startsWith('hev1')) return 1.3;
  if (normalized.startsWith('vp09')) return 1.2;
  if (normalized.startsWith('av01')) return 1.3;
  return 1.15;
}

function clampBitrate(bitrate: number): number {
  return Math.max(MIN_BITRATE, Math.min(Math.round(bitrate), MAX_BITRATE));
}

/**
 * 推导 VideoEncoder 的目标码率。
 * 优先按源视频平均码率换算，并按输出像素比例、编码代际和画质档位调整；
 * 源文件没有码率信息时，再按分辨率、帧率和每像素位数估算。
 */
export function resolveBitrate(
  width: number,
  height: number,
  frameRate: number,
  quality: ExportQuality,
  source?: SourceVideoProfile,
): number {
  const pixels = width * height;
  const fps = frameRate > 0 ? frameRate : 30;
  if (
    source &&
    source.bitrate > 0 &&
    source.width > 0 &&
    source.height > 0
  ) {
    const pixelScale = pixels / (source.width * source.height);
    const target =
      source.bitrate *
      pixelScale *
      QUALITY_FACTORS[quality] *
      sourceCodecFactor(source.codec);
    return clampBitrate(target);
  }

  const fallback = pixels * fps * FALLBACK_BITS_PER_PIXEL[quality];
  return clampBitrate(fallback);
}
