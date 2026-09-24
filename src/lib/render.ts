import type { SubtitleSegment, SubtitleStyle } from '../types';

const DEFAULT_STYLE: SubtitleStyle = {
  backgroundColor: '#000000',
  textColor: '#ffffff',
  fontSize: 28,
  position: 'bottom',
  align: 'center',
  paddingX: 16,
  paddingY: 12,
  backgroundOpacity: 1,
};

export { DEFAULT_STYLE };

interface RenderOptions {
  width: number;
  height: number;
  time: number;
  segments: SubtitleSegment[];
  defaultStyle: SubtitleStyle;
}

function cssColorToRgba(color: string, alpha: number): string {
  if (/^#[\da-f]{6}$/i.test(color)) {
    const value = Number.parseInt(color.slice(1), 16);
    const r = (value >> 16) & 255;
    const g = (value >> 8) & 255;
    const b = value & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  if (/^#[\da-f]{3}$/i.test(color)) {
    const r = Number.parseInt(color[1] + color[1], 16);
    const g = Number.parseInt(color[2] + color[2], 16);
    const b = Number.parseInt(color[3] + color[3], 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return alpha >= 1 ? color : `rgba(0, 0, 0, ${alpha})`;
}

function resolveStyle(defaultStyle: SubtitleStyle): SubtitleStyle {
  return { ...DEFAULT_STYLE, ...defaultStyle };
}

function drawSubtitleText(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  segment: SubtitleSegment,
  style: SubtitleStyle,
  options: RenderOptions,
): void {
  const { width, height } = options;
  const lines = segment.text.split('\n');
  if (lines.length === 0) return;

  const maxWidth = Math.max(80, width * 0.86);
  context.save();
  context.font = `400 ${style.fontSize}px / 1.28 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif`;
  context.textBaseline = 'alphabetic';

  const lineHeight = style.fontSize * 1.28;
  const widestLine = Math.max(...lines.map((line) => context.measureText(line).width));
  const contentWidth = Math.min(maxWidth, widestLine + style.paddingX * 2);
  const totalHeight = lines.length * lineHeight + style.paddingY * 2 - (lineHeight - style.fontSize) * 0.35;

  const outerMargin = 24;

  let y = 0;
  if (style.position === 'top') y = outerMargin;
  else if (style.position === 'middle') y = Math.max(0, (height - totalHeight) / 2);
  else y = Math.max(0, height - totalHeight - outerMargin);

  let x = 0;
  if (style.align === 'left') x = outerMargin;
  else if (style.align === 'center') x = (width - contentWidth) / 2;
  else x = width - contentWidth - outerMargin;

  // 背景宽度保证内容始终被包含，并只在必要时填充。
  const drawWidth = Math.min(maxWidth, Math.max(contentWidth, 8));
  context.fillStyle = cssColorToRgba(style.backgroundColor, style.backgroundOpacity);
  context.fillRect(x, y - style.paddingY, drawWidth, totalHeight);

  context.fillStyle = style.textColor;
  lines.forEach((line, index) => {
    const lineWidth = context.measureText(line).width;
    let textX = x + style.paddingX;
    if (style.align === 'center') textX = x + (drawWidth - lineWidth) / 2;
    else if (style.align === 'right') textX = x + drawWidth - lineWidth - style.paddingX;
    context.fillText(line, textX, y + index * lineHeight + style.fontSize);
  });

  context.restore();
}

/** 将视频画面与当前时间轴字幕绘制到画布，供播放预览和导出共用。 */
export function renderFrame(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  frame: CanvasImageSource | VideoFrame,
  options: RenderOptions,
): void {
  const { width, height, time, segments, defaultStyle } = options;
  const style = resolveStyle(defaultStyle);
  context.save();
  context.clearRect(0, 0, width, height);
  context.drawImage(frame, 0, 0, width, height);

  for (const segment of segments) {
    if (time >= segment.start && time < segment.end) {
      drawSubtitleText(context, segment, style, options);
    }
  }
  context.restore();
}

/** 只绘制当前时间点的字幕，供原生视频播放时叠加使用。 */
export function renderSubtitleOverlay(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  options: RenderOptions,
): void {
  const { width, height, time, segments, defaultStyle } = options;
  const style = resolveStyle(defaultStyle);
  context.clearRect(0, 0, width, height);
  for (const segment of segments) {
    if (time >= segment.start && time < segment.end) {
      drawSubtitleText(context, segment, style, options);
    }
  }
}

/** 判断当前时间点是否有字幕需要绘制，用于跳过无意义的画布重绘。 */
export function hasActiveSubtitle(segments: SubtitleSegment[], time: number): boolean {
  return segments.some((segment) => time >= segment.start && time < segment.end);
}

/** 当前时间点需要显示的字幕文本，用于列表高亮等非画布界面。 */
export function activeSubtitleText(
  segments: SubtitleSegment[],
  time: number,
): string {
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const segment = segments[i];
    if (time >= segment.start && time < segment.end) return segment.text;
  }
  return '';
}
