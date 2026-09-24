import { useCallback, useEffect, useRef, useState } from 'react';
import { Maximize2, Pause, Play, X } from 'lucide-react';
import type { SubtitleSegment, SubtitleStyle } from '../types';
import { formatClock } from '../lib/format';
import { hasActiveSubtitle, renderSubtitleOverlay } from '../lib/render';

interface FullscreenPreviewProps {
  src: string;
  initialTime: number;
  duration: number;
  width: number;
  height: number;
  aspectRatio: number;
  segments: SubtitleSegment[];
  defaultStyle: SubtitleStyle;
  onTimeChange: (time: number) => void;
  onClose: (time: number) => void;
}

/** 提供带字幕叠加的全屏视频预览，并与编辑器同步播放进度。 */
export function FullscreenPreview({
  src,
  initialTime,
  duration,
  width,
  height,
  aspectRatio,
  segments,
  defaultStyle,
  onTimeChange,
  onClose,
}: FullscreenPreviewProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const currentTimeRef = useRef(initialTime);
  const [currentTime, setCurrentTime] = useState(initialTime);
  const [previewDuration, setPreviewDuration] = useState(duration);
  const [playing, setPlaying] = useState(false);

  const closePreview = useCallback(() => {
    const video = videoRef.current;
    const finalTime = video?.currentTime ?? currentTimeRef.current;
    video?.pause();
    onTimeChange(finalTime);
    onClose(finalTime);
  }, [onClose, onTimeChange]);

  useEffect(() => {
    dialogRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closePreview();
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [closePreview]);

  useEffect(() => {
    let animationFrame = 0;
    let lastPaintedTime = Number.NaN;
    let lastHadSubtitle = false;

    function paintOverlay() {
      const video = videoRef.current;
      const canvas = overlayRef.current;
      if (video && canvas) {
        const time = video.currentTime;
        const hasSubtitle = hasActiveSubtitle(segments, time);
        if (time !== lastPaintedTime || hasSubtitle !== lastHadSubtitle) {
          const canvasWidth = width || video.videoWidth || 960;
          const canvasHeight = height || video.videoHeight || 540;
          if (canvas.width !== canvasWidth || canvas.height !== canvasHeight) {
            canvas.width = canvasWidth;
            canvas.height = canvasHeight;
          }
          const context = canvas.getContext('2d');
          if (context) {
            renderSubtitleOverlay(context, {
              width: canvasWidth,
              height: canvasHeight,
              time,
              segments,
              defaultStyle,
            });
          }
          lastPaintedTime = time;
          lastHadSubtitle = hasSubtitle;
        }
      }
      animationFrame = window.requestAnimationFrame(paintOverlay);
    }

    animationFrame = window.requestAnimationFrame(paintOverlay);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [defaultStyle, height, segments, width]);

  function togglePlayback() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play();
    else video.pause();
  }

  function seekTo(time: number) {
    const video = videoRef.current;
    const nextTime = Math.max(0, Math.min(time, previewDuration || duration || 0));
    currentTimeRef.current = nextTime;
    setCurrentTime(nextTime);
    onTimeChange(nextTime);
    if (video) video.currentTime = nextTime;
  }

  return (
    <div
      className="fullscreen-preview-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closePreview();
      }}
    >
      <div
        ref={dialogRef}
        className="fullscreen-preview-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="全屏视频预览"
        tabIndex={-1}
      >
        <header className="fullscreen-preview-header">
          <div className="fullscreen-preview-title">
            <Maximize2 size={17} />
            <strong>视频预览</strong>
          </div>
          <button
            type="button"
            className="fullscreen-preview-close"
            onClick={closePreview}
            aria-label="关闭预览"
            title="关闭预览"
          >
            <X size={19} />
          </button>
        </header>

        <div className="fullscreen-preview-body">
          <div
            className="fullscreen-preview-stage"
            style={{
              aspectRatio: String(aspectRatio),
              maxWidth: `${aspectRatio * 68}vh`,
            }}
          >
            <video
              ref={videoRef}
              className="fullscreen-preview-video"
              src={src}
              playsInline
              onClick={togglePlayback}
              onLoadedMetadata={(event) => {
                const video = event.currentTarget;
                const nextDuration = Number.isFinite(video.duration) ? video.duration : duration;
                setPreviewDuration(nextDuration);
                video.currentTime = Math.max(0, Math.min(initialTime, nextDuration));
                currentTimeRef.current = video.currentTime;
                setCurrentTime(video.currentTime);
              }}
              onTimeUpdate={(event) => {
                const nextTime = event.currentTarget.currentTime;
                currentTimeRef.current = nextTime;
                setCurrentTime(nextTime);
                onTimeChange(nextTime);
              }}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
            />
            <canvas ref={overlayRef} className="fullscreen-preview-overlay" aria-hidden="true" />
            {!playing && (
              <button
                type="button"
                className="fullscreen-preview-play"
                onClick={togglePlayback}
                aria-label="播放"
                title="播放"
              >
                <Play size={30} fill="currentColor" />
              </button>
            )}
          </div>
        </div>

        <footer className="fullscreen-preview-controls">
          <button
            type="button"
            className="control-button"
            onClick={togglePlayback}
            title={playing ? '暂停' : '播放'}
            aria-label={playing ? '暂停' : '播放'}
          >
            {playing ? <Pause size={17} /> : <Play size={17} />}
          </button>
          <span className="timecode">{formatClock(currentTime)}</span>
          <input
            className="fullscreen-preview-progress"
            type="range"
            min="0"
            max={Math.max(previewDuration || duration, 0)}
            step="0.01"
            value={Math.min(currentTime, previewDuration || duration || 0)}
            onChange={(event) => seekTo(Number(event.currentTarget.value))}
            aria-label="播放进度"
          />
          <span className="timecode">{formatClock(previewDuration || duration)}</span>
        </footer>
      </div>
    </div>
  );
}
