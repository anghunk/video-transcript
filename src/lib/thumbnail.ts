const THUMBNAIL_MAX_WIDTH = 480;
const THUMBNAIL_SEEK_SECONDS = 1;
const THUMBNAIL_QUALITY = 0.72;
const MEDIA_EVENT_TIMEOUT_MS = 8000;

/** 等待媒体元素触发指定事件，超时或媒体报错时结束等待。 */
function waitForMediaEvent(
  video: HTMLVideoElement,
  eventName: 'loadedmetadata' | 'loadeddata' | 'seeked',
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error(`等待视频事件超时：${eventName}`));
    }, MEDIA_EVENT_TIMEOUT_MS);

    function cleanup() {
      window.clearTimeout(timer);
      video.removeEventListener(eventName, handleEvent);
      video.removeEventListener('error', handleError);
    }

    function handleEvent() {
      cleanup();
      resolve();
    }

    function handleError() {
      cleanup();
      reject(video.error ?? new Error('无法读取视频画面'));
    }

    video.addEventListener(eventName, handleEvent, { once: true });
    video.addEventListener('error', handleError, { once: true });
  });
}

/**
 * 截取视频第 1 秒画面并生成项目缩略图。
 *
 * 视频短于 1 秒时退回到最后一个可解码的近似时间点；浏览器无法解码时返回 null，
 * 由界面继续使用默认图标，不影响项目本身。
 */
export async function createVideoThumbnail(source: Blob): Promise<string | null> {
  if (typeof document === 'undefined' || source.size === 0) return null;

  const objectUrl = URL.createObjectURL(source);
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  video.src = objectUrl;

  try {
    if (video.readyState < HTMLMediaElement.HAVE_METADATA) {
      await waitForMediaEvent(video, 'loadedmetadata');
    }

    const duration = Number.isFinite(video.duration) ? Math.max(0, video.duration) : 0;
    const seekTime = duration > 0
      ? Math.min(THUMBNAIL_SEEK_SECONDS, Math.max(0, duration - 0.05))
      : 0;
    if (Math.abs(video.currentTime - seekTime) > 0.001) {
      video.currentTime = seekTime;
      await waitForMediaEvent(video, 'seeked');
    }
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      await waitForMediaEvent(video, 'loadeddata');
    }

    const sourceWidth = video.videoWidth;
    const sourceHeight = video.videoHeight;
    if (sourceWidth <= 0 || sourceHeight <= 0) return null;

    const width = Math.min(THUMBNAIL_MAX_WIDTH, sourceWidth);
    const height = Math.max(1, Math.round((sourceHeight / sourceWidth) * width));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return null;

    context.drawImage(video, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', THUMBNAIL_QUALITY);
  } catch {
    return null;
  } finally {
    video.pause();
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(objectUrl);
  }
}
