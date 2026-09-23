import type { SubtitleSegment } from '../types';

let counter = 0;

/** 生成稳定且唯一的一段字幕 ID。 */
export function createSegmentId(): string {
  counter += 1;
  const random = Math.random().toString(36).slice(2, 8);
  return `${Date.now().toString(36)}-${counter.toString(36)}-${random}`;
}

/** 在时间轴上找到与给定时间重叠的末段字幕。 */
export function findActiveSegment(
  segments: SubtitleSegment[],
  time: number,
): SubtitleSegment | null {
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const segment = segments[i];
    if (time >= segment.start && time < segment.end) return segment;
  }
  return null;
}

/** 把一段字幕夹在合法范围内，返回修正后的起止时间。 */
export function clampSegment(
  start: number,
  end: number,
  duration: number,
  minDuration = 0.08,
): { start: number; end: number } {
  const safeStart = Math.max(0, Math.min(start, Math.max(0, duration - minDuration)));
  const safeEnd = Math.min(duration, Math.max(end, safeStart + minDuration));
  return { start: safeStart, end: safeEnd };
}

/** 保证字幕列表按时序排列。 */
export function sortSegments(segments: SubtitleSegment[]): SubtitleSegment[] {
  return [...segments].sort((a, b) => a.start - b.start);
}
