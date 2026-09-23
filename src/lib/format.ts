/** 将秒数格式化为 `mm:ss`，适合时间轴锚点与毫秒级以下的刻度显示。 */
export function formatTimestamp(seconds: number, withMilliseconds = true): string {
  const value = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const minutes = Math.floor(value / 60);
  const secs = Math.floor(value % 60);
  const millis = Math.floor((value % 1) * 1000);
  const base = `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  return withMilliseconds ? `${base}.${String(millis).padStart(3, '0')}` : base;
}

/** 将秒数格式化为 `h:mm:ss`，适用于较长视频。 */
export function formatClock(seconds: number): string {
  const value = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const secs = Math.floor(value % 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/** 将字节数格式化为可读大小。 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
}

/** 解析 `HH:MM:SS.mmm`、`MM:SS.mmm` 或纯秒数字符串。 */
export function parseTimestamp(input: string): number | null {
  const text = input.trim();
  if (text === '') return null;
  if (/^\d+(\.\d+)?$/.test(text)) return Number(text);

  const parts = text.split(':').map((part) => Number(part));
  if (parts.some((part) => !Number.isFinite(part))) return null;

  let seconds = 0;
  if (parts.length === 2) {
    seconds = parts[0] * 60 + parts[1];
  } else if (parts.length === 3) {
    seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else {
    return null;
  }
  return Math.max(0, seconds);
}
