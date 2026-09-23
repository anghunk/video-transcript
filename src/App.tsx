import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  List,
  BadgeCheck,
  Clapperboard,
  Copy,
  CloudOff,
  Download,
  FileVideo,
  LoaderCircle,
  LogOut,
  MonitorUp,
  Moon,
  Palette,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sun,
  Timer,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import logoUrl from '../logo.png';
import type {
  ExportQuality,
  SubtitleAlign,
  SubtitlePosition,
  SubtitleSegment,
  SubtitleStyle,
} from './types';
import { DEFAULT_STYLE, renderSubtitleOverlay } from './lib/render';
import { createSegmentId, clampSegment, sortSegments } from './lib/subtitles';
import { formatBytes, formatClock, formatTimestamp, parseTimestamp } from './lib/format';
import { loadSourceMedia, type SourceMediaRuntime } from './lib/media';
import { exportSubtitleVideo } from './lib/export';
import {
  clearWorkspaceCache,
  hasWorkspaceCache,
  loadCachedEdits,
  loadCachedVideo,
  saveCachedVideo,
  saveWorkspaceCache,
  type CachedWorkspace,
} from './lib/storage';

const QUALITY_META: Array<{ value: ExportQuality; label: string; hint: string }> = [
  { value: 'native', label: '接近原画', hint: '保持原始分辨率' },
  { value: 'high', label: '高画质', hint: '限制在 4K' },
  { value: 'standard', label: '标准', hint: '限制在 1080p' },
];

const POSITION_META: Array<{ value: SubtitlePosition; label: string }> = [
  { value: 'top', label: '顶部' },
  { value: 'middle', label: '中间' },
  { value: 'bottom', label: '底部' },
];

const ALIGN_META: Array<{ value: SubtitleAlign; label: string }> = [
  { value: 'left', label: '左对齐' },
  { value: 'center', label: '居中' },
  { value: 'right', label: '右对齐' },
];

interface SubtitleStylePreset {
  id: string;
  label: string;
  description: string;
  style: SubtitleStyle;
}

const STYLE_PRESETS: SubtitleStylePreset[] = [
  {
    id: 'classic',
    label: '经典',
    description: '黑底白字',
    style: { ...DEFAULT_STYLE },
  },
  {
    id: 'cinema',
    label: '电影',
    description: '半透明黑底',
    style: {
      ...DEFAULT_STYLE,
      backgroundColor: '#000000',
      textColor: '#ffffff',
      fontSize: 30,
      backgroundOpacity: 0.7,
    },
  },
  {
    id: 'light',
    label: '简洁',
    description: '白底黑字',
    style: {
      ...DEFAULT_STYLE,
      backgroundColor: '#ffffff',
      textColor: '#111111',
      backgroundOpacity: 1,
    },
  },
  {
    id: 'highlight',
    label: '强调',
    description: '黑底黄字',
    style: {
      ...DEFAULT_STYLE,
      backgroundColor: '#000000',
      textColor: '#ffd400',
      fontSize: 32,
      backgroundOpacity: 1,
    },
  },
];

interface DragState {
  segmentId: string;
  edge: 'start' | 'end' | 'body';
  pointerStartX: number;
  originalStart: number;
  originalEnd: number;
}

type WorkspaceTab = 'subtitles' | 'style' | 'export';
type ThemeMode = 'dark' | 'light';

const THEME_STORAGE_KEY = 'subtitle-studio-theme';

function getInitialTheme(): ThemeMode {
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

type ConfirmAction =
  | { kind: 'cache' }
  | {
      kind: 'exit';
      message: string;
      confirmText: string;
      cancelText: string;
      confirmVariant: 'default' | 'danger';
      onConfirm: () => void;
      onCancel: () => void;
    };

interface CacheOffer {
  fileName: string;
  savedAt: string;
}

function App() {
  const [media, setMedia] = useState<SourceMediaRuntime | null>(null);
  const [mediaUrl, setMediaUrl] = useState('');
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [segments, setSegments] = useState<SubtitleSegment[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [defaultStyle, setDefaultStyle] = useState<SubtitleStyle>(DEFAULT_STYLE);
  const [defaultDuration, setDefaultDuration] = useState(2);
  const [quality, setQuality] = useState<ExportQuality>('native');
  const [includeAudio, setIncludeAudio] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [waiting, setWaiting] = useState(true);
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>('subtitles');
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [cacheOffer, setCacheOffer] = useState<CacheOffer | null>(null);
  const [restoring, setRestoring] = useState(false);

  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportPhase, setExportPhase] = useState('');

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const workspacePanelRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const timelineDragPropsRef = useRef<{
    onMove: (event: PointerEvent) => void;
    onUp: () => void;
  } | null>(null);
  const workspaceStateRef = useRef<CachedWorkspace>({
    projectName: '',
    videoSize: 0,
    videoWidth: 0,
    videoHeight: 0,
    videoDuration: 0,
    videoCodec: '',
    hasAudio: false,
    audioCodec: undefined,
    defaultDuration: 2,
    quality: 'native',
    includeAudio: true,
    defaultStyle: DEFAULT_STYLE,
    segments: [],
    savedAt: Date.now(),
  });

  const sortedSegments = useMemo(() => sortSegments(segments), [segments]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // 隐私模式下仅保留当前会话主题。
    }
  }, [theme]);

  useEffect(() => {
    return () => {
      if (mediaUrl) URL.revokeObjectURL(mediaUrl);
    };
  }, [mediaUrl]);

  useEffect(() => {
    let animationFrame = 0;
    function paintOverlay() {
      const video = videoRef.current;
      const canvas = overlayRef.current;
      if (video && canvas && media) {
        const width = media.info.width || video.videoWidth || 960;
        const height = media.info.height || video.videoHeight || 540;
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }
        const context = canvas.getContext('2d');
        if (context) {
          renderSubtitleOverlay(context, {
            width,
            height,
            time: video.currentTime,
            segments: sortedSegments,
            defaultStyle,
          });
        }
      }
      animationFrame = requestAnimationFrame(paintOverlay);
    }
    if (mediaUrl) animationFrame = requestAnimationFrame(paintOverlay);
    return () => cancelAnimationFrame(animationFrame);
  }, [media, mediaUrl, defaultStyle, sortedSegments]);

  const selectedSegment = useMemo(
    () => segments.find((segment) => segment.id === selectedId) ?? null,
    [segments, selectedId],
  );

  useEffect(() => {
    workspaceStateRef.current = {
      projectName: media?.info.name ?? '',
      videoSize: media?.info.size ?? 0,
      videoWidth: media?.info.width ?? 0,
      videoHeight: media?.info.height ?? 0,
      videoDuration: duration,
      videoCodec: media?.info.videoCodec ?? '',
      hasAudio: media?.info.hasAudio ?? false,
      audioCodec: media?.info.audioCodec ?? undefined,
      defaultDuration,
      quality,
      includeAudio,
      defaultStyle,
      segments,
      savedAt: Date.now(),
    };
  }, [media, duration, defaultDuration, quality, includeAudio, defaultStyle, segments]);

  async function persistWorkspace(): Promise<void> {
    if (!media) return;
    await saveWorkspaceCache({ ...workspaceStateRef.current, savedAt: Date.now() });
  }

  useEffect(() => {
    if (!media) return;
    const timer = window.setTimeout(() => {
      void persistWorkspace();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [media, segments, defaultStyle, defaultDuration, quality, includeAudio]);

  useEffect(() => {
    if (!media) return;
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      void persistWorkspace();
      event.preventDefault();
      event.returnValue = '';
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [media]);

  useLayoutEffect(() => {
    if (workspacePanelRef.current) {
      workspacePanelRef.current.scrollTop = 0;
    }
  }, [workspaceTab]);

  useEffect(() => {
    let cancelled = false;
    async function checkCache() {
      try {
        const available = await hasWorkspaceCache();
        if (cancelled) return;
        if (!available) {
          setWaiting(false);
          return;
        }
        const [edits, video] = await Promise.all([loadCachedEdits(), loadCachedVideo()]);
        if (cancelled) return;
        if (!edits || !video) {
          setWaiting(false);
          return;
        }
        setCacheOffer({
          fileName: video.fileName,
          savedAt: new Date(edits.savedAt).toLocaleString(),
        });
        setWaiting(false);
      } catch {
        if (!cancelled) setWaiting(false);
      }
    }
    void checkCache();
    return () => {
      cancelled = true;
    };
  }, []);

  async function restoreCachedWorkspace() {
    setRestoring(true);
    try {
      const [edits, video] = await Promise.all([loadCachedEdits(), loadCachedVideo()]);
      if (!edits || !video) {
        setConfirmAction(null);
        setCacheOffer(null);
        setWaiting(false);
        setError('未找到可恢复的缓存，请重新选择视频。');
        return;
      }
      const file = new File([video.blob], video.fileName, { type: 'video/mp4' });
      await openFile(file);
      setSegments(edits.segments);
      setSelectedId(null);
      setDefaultStyle(edits.defaultStyle);
      setDefaultDuration(edits.defaultDuration);
      setQuality(edits.quality);
      setIncludeAudio(edits.includeAudio);
      setConfirmAction(null);
      setCacheOffer(null);
      setWaiting(false);
    } catch (caughtError) {
      setConfirmAction(null);
      setError(caughtError instanceof Error ? caughtError.message : '恢复缓存失败');
      setWaiting(false);
    } finally {
      setRestoring(false);
    }
  }

  function requestUpload() {
    if (cacheOffer) {
      setConfirmAction({ kind: 'cache' });
      return;
    }
    fileInputRef.current?.click();
  }

  function discardCachedWorkspace() {
    setConfirmAction(null);
    setCacheOffer(null);
    void clearWorkspaceCache();
    setWaiting(false);
    fileInputRef.current?.click();
  }

  function forgetCachedWorkspace() {
    setConfirmAction(null);
    setCacheOffer(null);
    void clearWorkspaceCache();
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    await openFile(file);
  }

  async function openFile(file: File) {
    if (!file.type.startsWith('video/') && !file.name.toLowerCase().endsWith('.mp4')) {
      setError('请选择 MP4 视频文件');
      return;
    }
    setError('');
    setLoading(true);
    setExporting(false);
    setExportProgress(0);
    try {
      const runtime = await loadSourceMedia(file);
      if (!runtime.videoTrack || !runtime.videoConfig) {
        throw new Error('未识别到可解码的视频轨道，请换用 H.264 编码的 MP4。');
      }
      if (mediaUrl) URL.revokeObjectURL(mediaUrl);
      const nextUrl = URL.createObjectURL(new Blob([runtime.info.buffer], { type: 'video/mp4' }));
      setMedia(runtime);
      setMediaUrl(nextUrl);
      setCurrentTime(0);
      setDuration(runtime.info.duration);
      setSegments([]);
      setSelectedId(null);
      void saveCachedVideo(file, file.name);
      window.setTimeout(persistWorkspace, 500);
      const video = videoRef.current;
      if (video) {
        video.load();
        video.currentTime = 0;
      }
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : '视频解析失败');
    } finally {
      setLoading(false);
    }
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (file) void openFile(file);
  }

  function handlePlayPause() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play();
    else video.pause();
  }

  function handleSeek(time: number) {
    const clamped = Math.max(0, Math.min(time, duration || 0));
    setCurrentTime(clamped);
    const video = videoRef.current;
    if (video) video.currentTime = clamped;
  }

  function handleAddSegment() {
    if (!media) return;
    const lastSegmentEnd = sortedSegments.reduce(
      (max, segment) => Math.max(max, segment.end),
      0,
    );
    const preferredStart = lastSegmentEnd > 0
      ? lastSegmentEnd
      : Math.min(currentTime, Math.max(0, duration - 0.08));
    const start = Math.min(preferredStart, Math.max(0, duration - 0.08));
    const { start: safeStart, end: safeEnd } = clampSegment(
      start,
      start + Math.max(0.1, defaultDuration),
      duration,
    );
    const nextSegment: SubtitleSegment = {
      id: createSegmentId(),
      start: safeStart,
      end: safeEnd,
      text: '新字幕',
    };
    setSegments((current) => sortSegments([...current, nextSegment]));
    setSelectedId(nextSegment.id);
    handleSeek(safeEnd);
  }

  function handleCopySegment() {
    if (!selectedSegment || !media) return;
    const nextStart = selectedSegment.end;
    const { start, end } = clampSegment(
      nextStart,
      nextStart + Math.max(0.1, selectedSegment.end - selectedSegment.start),
      duration,
    );
    const copy: SubtitleSegment = {
      ...selectedSegment,
      id: createSegmentId(),
      start,
      end,
      style: selectedSegment.style ? { ...selectedSegment.style } : undefined,
    };
    setSegments((current) => sortSegments([...current, copy]));
    setSelectedId(copy.id);
  }

  function handleDeleteSegment() {
    if (!selectedId) return;
    setSegments((current) => current.filter((segment) => segment.id !== selectedId));
    setSelectedId(null);
  }

  function updateSelectedSegment(patch: Partial<SubtitleSegment>) {
    if (!selectedId) return;
    setSegments((current) =>
      current.map((segment) =>
        segment.id === selectedId
          ? {
              ...segment,
              ...patch,
            }
          : segment,
      ),
    );
  }

  function updateSelectedStyle(patch: Partial<SubtitleStyle>) {
    if (!selectedId) return;
    setSegments((current) =>
      current.map((segment) =>
        segment.id === selectedId
          ? {
              ...segment,
              style: {
                ...(segment.style ?? {}),
                ...patch,
              },
            }
          : segment,
      ),
    );
  }

  function updateDefaultStyle(patch: Partial<SubtitleStyle>) {
    setDefaultStyle((current) => ({ ...current, ...patch }));
  }

  function handleTimelinePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    const trackElement = event.currentTarget;
    const rect = trackElement.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / Math.max(1, rect.width);
    handleSeek(ratio * duration);
    const updatePlayhead = (pointerEvent: PointerEvent) => {
      const box = trackElement.getBoundingClientRect();
      const nextRatio = Math.max(0, Math.min(1, (pointerEvent.clientX - box.left) / Math.max(1, box.width)));
      const video = videoRef.current;
      if (video) {
        video.currentTime = nextRatio * duration;
        setCurrentTime(nextRatio * duration);
      }
    };
    const finish = () => {
      if (timelineDragPropsRef.current?.onMove === updatePlayhead) {
        timelineDragPropsRef.current = null;
      }
      window.removeEventListener('pointermove', updatePlayhead);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
    };
    timelineDragPropsRef.current = { onMove: updatePlayhead, onUp: finish };
    window.addEventListener('pointermove', updatePlayhead);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  }

  function handleTimelinePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!timelineDragPropsRef.current) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)));
    const targetTime = ratio * duration;
    setCurrentTime(targetTime);
    const video = videoRef.current;
    if (video) video.currentTime = targetTime;
  }

  function handleBarPointerDown(
    event: ReactPointerEvent<HTMLElement>,
    segment: SubtitleSegment,
    edge: DragState['edge'],
  ) {
    event.stopPropagation();
    dragRef.current = {
      segmentId: segment.id,
      edge,
      pointerStartX: event.clientX,
      originalStart: segment.start,
      originalEnd: segment.end,
    };
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
  }

  function handleBarPointerMove(event: ReactPointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag || !media) return;
    const track = event.currentTarget.closest('.timeline-track');
    if (!(track instanceof HTMLElement)) return;
    const rect = track.getBoundingClientRect();
    const deltaSeconds = ((event.clientX - drag.pointerStartX) / Math.max(1, rect.width)) * duration;
    const { originalStart, originalEnd, edge } = drag;

    if (edge === 'start') {
      const start = originalStart + deltaSeconds;
      updateSegmentById(drag.segmentId, {
        start: Math.max(0, Math.min(start, originalEnd - 0.08)),
      });
    } else if (edge === 'end') {
      const end = originalEnd + deltaSeconds;
      updateSegmentById(drag.segmentId, {
        end: Math.min(duration, Math.max(end, originalStart + 0.08)),
      });
    } else {
      const width = originalEnd - originalStart;
      const start = Math.max(0, Math.min(duration - width, originalStart + deltaSeconds));
      updateSegmentById(drag.segmentId, {
        start,
        end: start + width,
      });
    }
  }

  function handleBarPointerUp(event: ReactPointerEvent<HTMLElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
  }

  function updateSegmentById(id: string, patch: Partial<SubtitleSegment>) {
    setSegments((current) =>
      sortSegments(current.map((segment) => (segment.id === id ? { ...segment, ...patch } : segment))),
    );
  }

  async function handleExport() {
    if (!media || !media.videoTrack || !media.videoConfig) return;
    setExporting(true);
    setExportProgress(0);
    setExportPhase('正在准备编码');
    setError('');
    try {
      const blob = await exportSubtitleVideo({
        media,
        segments: sortedSegments,
        defaultStyle,
        quality,
        includeAudio,
        onProgress: (progress, phase) => {
          setExportProgress(progress);
          setExportPhase(phase);
        },
      });
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const sourceName = media.info.name.replace(/\.[^.]+$/, '') || 'subtitle-video';
      link.href = downloadUrl;
      link.download = `${sourceName}-带字幕.mp4`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(downloadUrl), 5000);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : '导出失败');
    } finally {
      setExporting(false);
    }
  }

  function resetWorkspace(clearCache = true) {
    if (clearCache) void clearWorkspaceCache();
    setMedia(null);
    setMediaUrl('');
    setCurrentTime(0);
    setDuration(0);
    setPlaying(false);
    setSegments([]);
    setSelectedId(null);
    setError('');
    setExporting(false);
    setExportProgress(0);
  }

  function promptExit() {
    setConfirmAction({
      kind: 'exit',
      message: '退出编辑器前，字幕进度已自动保存到本地缓存。',
      confirmText: '保存并退出',
      cancelText: '继续编辑',
      confirmVariant: 'default',
      onConfirm: () => {
        persistWorkspace()
          .then(() => {
            setConfirmAction(null);
            leaveApp();
          })
          .catch(() => {
            setConfirmAction(null);
            leaveApp();
          });
      },
      onCancel: () => setConfirmAction(null),
    });
  }

  function leaveApp() {
    // 浏览器不允许脚本静默地真正“退出”单页应用，保存当前进度并回到上传页。
    resetWorkspace(false);
  }

  function toggleTheme() {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'));
  }

  const videoAspectRatio =
    media && media.info.width > 0 && media.info.height > 0
      ? media.info.width / media.info.height
      : 16 / 9;

  return (
    <main className="app-shell">
      {!media ? (
        <UploadScreen
          loading={loading}
          error={error}
          waiting={waiting}
          cacheOffer={cacheOffer}
          restoring={restoring}
          theme={theme}
          onToggleTheme={toggleTheme}
          onSelect={requestUpload}
          onRestore={() => void restoreCachedWorkspace()}
          onDiscard={forgetCachedWorkspace}
          onDrop={handleDrop}
        />
      ) : (
        <div className="workspace">
          <div className="workspace-main">
            <section className="preview-column">
            <div className="preview-shell">
              <div
                className="video-stage"
                style={{
                  aspectRatio: String(videoAspectRatio),
                  maxWidth: `${videoAspectRatio * 66}vh`,
                }}
              >
                <video
                  ref={videoRef}
                  className="preview-video"
                  src={mediaUrl}
                  playsInline
                  onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
                  onPlay={() => setPlaying(true)}
                  onPause={() => setPlaying(false)}
                  onLoadedMetadata={(event) => {
                    setDuration(event.currentTarget.duration || media.info.duration);
                  }}
                />
                <canvas ref={overlayRef} className="subtitle-overlay" aria-hidden="true" />
                {!playing && (
                  <button
                    type="button"
                    className="stage-play-button"
                    onClick={handlePlayPause}
                    aria-label="播放"
                    title="播放"
                  >
                    <Play size={26} fill="currentColor" />
                  </button>
                )}
              </div>

              <div className="player-bar">
                <button type="button" className="control-button" onClick={handlePlayPause} title={playing ? '暂停' : '播放'}>
                  {playing ? <Pause size={17} /> : <Play size={17} />}
                </button>
                <button type="button" className="control-button" onClick={() => handleSeek(currentTime - 0.1)} title="后退 0.1 秒">
                  <RotateCcw size={16} />
                </button>
                <span className="timecode">{formatClock(currentTime)} / {formatClock(duration)}</span>
                <button type="button" className="control-button text-button" onClick={handleAddSegment} title="在末尾递增添加字幕">
                  <Plus size={16} /> 添加字幕
                </button>
              </div>

              <div className="preview-meta">
                <div className="video-facts">
                  <span className="file-fact" title={media.info.name}>{media.info.name}</span>
                  <span>{media.info.width}×{media.info.height}</span>
                  <span>{formatBytes(media.info.size)}</span>
                  <span>{media.info.videoCodec}</span>
                  {media.info.hasAudio && <span>{media.info.audioCodec}</span>}
                </div>

                <div className="preview-actions" aria-label="工作台操作">
                  <button type="button" className="reset-button icon" onClick={() => resetWorkspace()} title="更换视频" aria-label="更换视频" disabled={exporting}>
                    <RefreshCw size={16} />
                  </button>
                  <button type="button" className="secondary-button icon" onClick={promptExit} title="退出编辑器" aria-label="退出编辑器" disabled={exporting}>
                    <LogOut size={16} />
                  </button>
                </div>

                <div className="section-heading timeline-heading">
                  <div>
                    <p>{segments.length} 个字幕段 · 拖拽时间轴可改变播放位置</p>
                  </div>
                </div>
              </div>
            </div>
            </section>

            <section className="timeline-column">
            <Timeline
              duration={duration}
              currentTime={currentTime}
              segments={sortedSegments}
              selectedId={selectedId}
              onSelectSegment={(id) => {
                setSelectedId(id);
                const segment = segments.find((item) => item.id === id);
                if (segment) handleSeek(segment.start);
              }}
              onBarPointerDown={handleBarPointerDown}
              onBarPointerMove={handleBarPointerMove}
              onBarPointerUp={handleBarPointerUp}
              onTrackPointerDown={handleTimelinePointerDown}
              onTrackPointerMove={handleTimelinePointerMove}
            />
            </section>
          </div>

          <aside className="sidebar-column">
            <div className="workspace-toolbar">
              <div className="workspace-tabs" role="tablist" aria-label="右侧面板">
                <button
                  type="button"
                  role="tab"
                  aria-selected={workspaceTab === 'subtitles'}
                  className={workspaceTab === 'subtitles' ? 'active' : ''}
                  onClick={() => setWorkspaceTab('subtitles')}
                >
                  <List size={15} /> 字幕段
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={workspaceTab === 'style'}
                  className={workspaceTab === 'style' ? 'active' : ''}
                  onClick={() => setWorkspaceTab('style')}
                >
                  <Palette size={15} /> 字幕样式
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={workspaceTab === 'export'}
                  className={workspaceTab === 'export' ? 'active' : ''}
                  onClick={() => setWorkspaceTab('export')}
                >
                  <Download size={15} /> 导出
                </button>
              </div>
              <button
                type="button"
                className="theme-toggle workspace-theme-toggle"
                onClick={toggleTheme}
                title={theme === 'dark' ? '切换日间模式' : '切换黑夜模式'}
                aria-label={theme === 'dark' ? '切换日间模式' : '切换黑夜模式'}
              >
                {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
              </button>
            </div>

            <div ref={workspacePanelRef} className="workspace-tab-panel" role="tabpanel">
              {workspaceTab === 'subtitles' && (
                <SegmentList
                  segments={sortedSegments}
                  selectedId={selectedId}
                  currentTime={currentTime}
                  onAdd={handleAddSegment}
                  onSelect={(id) => {
                    setSelectedId(id);
                    const segment = segments.find((item) => item.id === id);
                    if (segment) handleSeek(segment.start);
                  }}
                  onChangeText={(id, text) => updateSegmentById(id, { text })}
                  onChangeStart={(id, value) => {
                    const segment = segments.find((item) => item.id === id);
                    if (!segment) return;
                    updateSegmentById(id, { start: Math.max(0, Math.min(value, segment.end - 0.08)) });
                  }}
                  onChangeEnd={(id, value) => {
                    const segment = segments.find((item) => item.id === id);
                    if (!segment) return;
                    updateSegmentById(id, { end: Math.min(duration, Math.max(value, segment.start + 0.08)) });
                  }}
                  onCopy={(id) => {
                    const segment = segments.find((item) => item.id === id);
                    if (!segment) return;
                    setSelectedId(id);
                    setTimeout(() => handleCopySegment(), 0);
                  }}
                  onDelete={(id) => {
                    setSelectedId(id);
                    setTimeout(() => handleDeleteSegment(), 0);
                  }}
                  defaultDuration={defaultDuration}
                  onChangeDefaultDuration={setDefaultDuration}
                />
              )}
              {workspaceTab === 'style' && (
                <StylePanel
                  defaultStyle={defaultStyle}
                  selectedSegment={selectedSegment}
                  onChangeDefault={updateDefaultStyle}
                  onChangeSelected={updateSelectedStyle}
                  onDelete={handleDeleteSegment}
                  onCopy={handleCopySegment}
                  segmentsCount={segments.length}
                />
              )}
              {workspaceTab === 'export' && (
                <ExportPanel
                  quality={quality}
                  includeAudio={includeAudio}
                  exporting={exporting}
                  progress={exportProgress}
                  phase={exportPhase}
                  segmentsCount={segments.length}
                  error={error}
                  onQualityChange={setQuality}
                  onIncludeAudioChange={setIncludeAudio}
                  onExport={() => void handleExport()}
                />
              )}
            </div>
          </aside>
        </div>
      )}

      <input
        ref={fileInputRef}
        className="visually-hidden"
        type="file"
        accept="video/mp4,video/quicktime,video/*"
        onChange={handleFileChange}
      />

      {confirmAction && confirmAction.kind === 'cache' && (
        <ConfirmDialog
          title="继续上次编辑？"
          description={
            cacheOffer
              ? `检测到「${cacheOffer.fileName}」的工作台缓存（${cacheOffer.savedAt}）。请选择重新上传，或使用上一次数据继续编辑。`
              : '检测到未完成的工作台缓存。请选择重新上传，或使用上一次数据继续编辑。'
          }
          confirmLabel="使用上一次数据"
          cancelLabel="重新上传"
          busy={restoring}
          busyLabel="正在恢复"
          onConfirm={() => void restoreCachedWorkspace()}
          onCancel={discardCachedWorkspace}
          onClose={() => setConfirmAction(null)}
        />
      )}
      {confirmAction && confirmAction.kind === 'exit' && (
        <ConfirmDialog
          title="退出编辑器"
          description={confirmAction.message}
          confirmLabel={confirmAction.confirmText}
          cancelLabel={confirmAction.cancelText}
          confirmVariant={confirmAction.confirmVariant}
          onConfirm={confirmAction.onConfirm}
          onCancel={confirmAction.onCancel}
        />
      )}
    </main>
  );
}

interface UploadScreenProps {
  loading: boolean;
  error: string;
  waiting: boolean;
  cacheOffer: CacheOffer | null;
  restoring: boolean;
  theme: ThemeMode;
  onToggleTheme: () => void;
  onSelect: () => void;
  onRestore: () => void;
  onDiscard: () => void;
  onDrop: (event: React.DragEvent<HTMLDivElement>) => void;
}

function UploadScreen({
  loading,
  error,
  waiting,
  cacheOffer,
  restoring,
  theme,
  onToggleTheme,
  onSelect,
  onRestore,
  onDiscard,
  onDrop,
}: UploadScreenProps) {
  const [dragActive, setDragActive] = useState(false);
  const busy = loading || waiting;

  return (
    <div className="upload-screen">
      <button
        type="button"
        className="theme-toggle upload-theme-toggle"
        onClick={onToggleTheme}
        title={theme === 'dark' ? '切换日间模式' : '切换黑夜模式'}
        aria-label={theme === 'dark' ? '切换日间模式' : '切换黑夜模式'}
      >
        {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
      </button>

      {cacheOffer && (
        <div className="cache-banner" role="status" aria-live="polite">
          <div className="cache-banner-inner">
            <div className="cache-banner-status">
              <span className="cache-banner-icon"><FileVideo size={17} /></span>
              <div className="cache-banner-copy">
                <strong>已找到上次的工作台缓存</strong>
                <span>{cacheOffer.fileName} · {cacheOffer.savedAt}</span>
              </div>
            </div>
            <div className="cache-banner-actions">
              <button
                type="button"
                className="secondary-button cache-banner-button"
                onClick={onDiscard}
                disabled={restoring}
              >
                <Trash2 size={15} /> 放弃
              </button>
              <button
                type="button"
                className="primary-button cache-banner-button"
                onClick={onRestore}
                disabled={restoring}
              >
                {restoring ? <LoaderCircle className="spin" size={15} /> : <RotateCcw size={15} />}
                {restoring ? '正在恢复' : '继续编辑'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="upload-page">
        <section className="upload-story">
          <div className="upload-brand">
            <span className="upload-logo">
              <img src={logoUrl} alt="" />
            </span>
            <span>字幕工作室</span>
          </div>

          <div className="upload-heading">
            <span className="upload-eyebrow">本地视频字幕工作台</span>
            <h1>把视频放进时间轴，让字幕准时出现。</h1>
            <p>拖入一个 MP4 即可开始分段、调整样式和导出，全程只在当前浏览器处理。</p>
          </div>

          <div className="upload-preview" aria-hidden="true">
            <div className="upload-preview-frame">
              <span className="preview-playhead-dot" />
              <span className="preview-subtitle">字幕会实时出现在这里</span>
            </div>
            <div className="upload-preview-timeline">
              <span className="preview-playhead" />
              <span className="preview-clip preview-clip-a" />
              <span className="preview-clip preview-clip-b" />
              <span className="preview-clip preview-clip-c" />
            </div>
          </div>
        </section>

        <section className="upload-panel" aria-label="视频上传">
          <div className="upload-panel-heading">
            <div>
              <strong>新建字幕项目</strong>
              <span>上传后直接进入工作台</span>
            </div>
            <span className="format-chip">MP4</span>
          </div>

          <div
            className={`upload-zone${dragActive ? ' dragover' : ''}`}
            aria-disabled={busy}
            onClick={() => {
              if (!busy) onSelect();
            }}
            onDragEnter={(event) => {
              event.preventDefault();
              if (!busy) setDragActive(true);
            }}
            onDragOver={(event) => {
              if (!busy) event.preventDefault();
            }}
            onDragLeave={(event) => {
              if (event.currentTarget === event.target) setDragActive(false);
            }}
            onDrop={(event) => {
              setDragActive(false);
              if (!busy) onDrop(event);
            }}
          >
            <div className="upload-icon"><FileVideo size={30} strokeWidth={1.5} /></div>
            <div className="upload-zone-copy">
              <strong>{loading ? '正在解析视频' : waiting ? '正在检查本地缓存' : '把本地视频拉到工作台'}</strong>
              <span>
                {loading
                  ? '正在读取本地视频，稍候即可开始编辑'
                  : waiting
                    ? '如果上次中断，稍后会询问是否恢复'
                    : '或点击选择文件，仅支持本地 MP4'}
              </span>
            </div>
            <button
              type="button"
              className="primary-button upload-select"
              disabled={busy}
              onClick={(event) => {
                event.stopPropagation();
                if (!busy) onSelect();
              }}
            >
              {busy ? <LoaderCircle className="spin" size={17} /> : <Upload size={16} />}
              {loading ? '解析中' : waiting ? '检查中' : '选择本地视频'}
            </button>
          </div>

          <div className="upload-trust">
            <span><ShieldCheck size={14} /> 本地处理</span>
            <span><MonitorUp size={14} /> 原分辨率</span>
            <span><BadgeCheck size={14} /> 无水印</span>
          </div>

          <div className="upload-privacy">
            <CloudOff size={15} />
            <span>视频不会上传到服务器，关闭页面后可在缓存中恢复上次项目。</span>
          </div>

          {error && <div className="error-line upload-error" role="alert">{error}</div>}
        </section>
      </div>
    </div>
  );
}

interface ConfirmDialogProps {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  confirmVariant?: 'default' | 'danger';
  busy?: boolean;
  busyLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  onClose?: () => void;
}

function ConfirmDialog({
  title,
  description,
  confirmLabel,
  cancelLabel,
  confirmVariant = 'default',
  busy = false,
  busyLabel = '处理中',
  onConfirm,
  onCancel,
  onClose,
}: ConfirmDialogProps) {
  const handleClose = onClose ?? onCancel;

  return (
    <div className="confirm-backdrop" role="presentation" onMouseDown={handleClose}>
      <div
        className="confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button type="button" className="confirm-close" onClick={handleClose} aria-label="关闭" title="关闭">
          <X size={16} />
        </button>
        <div className="confirm-icon"><Timer size={22} /></div>
        <h2>{title}</h2>
        <p>{description}</p>
        <div className="confirm-actions">
          <button type="button" className="secondary-button" onClick={onCancel} disabled={busy}>{cancelLabel}</button>
          <button
            type="button"
            className={`primary-button${confirmVariant === 'danger' ? ' danger' : ''}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy && <LoaderCircle className="spin" size={16} />}
            {busy ? busyLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

interface TimelineProps {
  duration: number;
  currentTime: number;
  segments: SubtitleSegment[];
  selectedId: string | null;
  onTrackPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onTrackPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onSelectSegment: (id: string) => void;
  onBarPointerDown: (
    event: ReactPointerEvent<HTMLElement>,
    segment: SubtitleSegment,
    edge: DragState['edge'],
  ) => void;
  onBarPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onBarPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
}

function Timeline({
  duration,
  currentTime,
  segments,
  selectedId,
  onTrackPointerDown,
  onTrackPointerMove,
  onSelectSegment,
  onBarPointerDown,
  onBarPointerMove,
  onBarPointerUp,
}: TimelineProps) {
  const safeDuration = duration || 1;
  return (
    <div className="timeline">
      <div className="timeline-scroll">
        <div
          className="timeline-track"
          onPointerDown={onTrackPointerDown}
          onPointerMove={onTrackPointerMove}
        >
          <div className="timeline-rule">
            {Array.from({ length: 9 }, (_, index) => {
              const value = (safeDuration / 8) * index;
              return (
                <span key={index} style={{ left: `${(value / safeDuration) * 100}%` }}>
                  {formatTimestamp(value, false)}
                </span>
              );
            })}
          </div>
          <div className="segment-layer">
            {segments.map((segment) => (
              <button
                type="button"
                key={segment.id}
                className={`segment-bar${selectedId === segment.id ? ' selected' : ''}`}
                style={{
                  left: `${(segment.start / safeDuration) * 100}%`,
                  width: `${((segment.end - segment.start) / safeDuration) * 100}%`,
                }}
                data-segment-id={segment.id}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectSegment(segment.id);
                }}
                onPointerDown={(event) => onBarPointerDown(event, segment, 'body')}
                onPointerMove={onBarPointerMove}
                onPointerUp={onBarPointerUp}
                title={segment.text}
              >
                <span className="segment-label">{segment.text || '空白'}</span>
                <span
                  className="segment-handle start-handle"
                  onPointerDown={(event) => onBarPointerDown(event, segment, 'start')}
                  onPointerMove={onBarPointerMove}
                  onPointerUp={onBarPointerUp}
                  onClick={(event) => event.stopPropagation()}
                />
                <span
                  className="segment-handle end-handle"
                  onPointerDown={(event) => onBarPointerDown(event, segment, 'end')}
                  onPointerMove={onBarPointerMove}
                  onPointerUp={onBarPointerUp}
                  onClick={(event) => event.stopPropagation()}
                />
              </button>
            ))}
          </div>
          <div className="playhead" style={{ left: `${(currentTime / safeDuration) * 100}%` }}>
            <span className="playhead-dot" />
          </div>
        </div>
      </div>
    </div>
  );
}

interface SegmentListProps {
  segments: SubtitleSegment[];
  selectedId: string | null;
  currentTime: number;
  defaultDuration: number;
  onAdd: () => void;
  onSelect: (id: string) => void;
  onChangeText: (id: string, text: string) => void;
  onChangeStart: (id: string, start: number) => void;
  onChangeEnd: (id: string, end: number) => void;
  onCopy: (id: string) => void;
  onDelete: (id: string) => void;
  onChangeDefaultDuration: (value: number) => void;
}

function SegmentList({
  segments,
  selectedId,
  currentTime,
  defaultDuration,
  onAdd,
  onSelect,
  onChangeText,
  onChangeStart,
  onChangeEnd,
  onCopy,
  onDelete,
  onChangeDefaultDuration,
}: SegmentListProps) {
  const addZoneRef = useRef<HTMLButtonElement | null>(null);
  const previousCountRef = useRef(segments.length);

  useLayoutEffect(() => {
    if (segments.length > previousCountRef.current) {
      addZoneRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    previousCountRef.current = segments.length;
  }, [segments.length]);

  const parseListTime = (raw: string, fallback: number): number => {
    const parsed = parseTimestamp(raw);
    return parsed ?? fallback;
  };
  return (
    <div className="segment-list">
      <div className="segment-settings">
        <span>默认时长</span>
        <label className="inline-setting">
          <input
            type="number"
            min="1"
            step="1"
            aria-label="字幕默认时长"
            value={defaultDuration}
            onChange={(event) => onChangeDefaultDuration(Math.max(1, Math.round(Number(event.target.value) || 1)))}
          />
          <span>秒</span>
        </label>
      </div>
      {segments.length > 0 && (
        <div className="segment-rows">
          {segments.map((segment) => (
            <div
              key={segment.id}
              className={`segment-row${selectedId === segment.id ? ' selected' : ''}${
                currentTime >= segment.start && currentTime < segment.end ? ' active' : ''
              }`}
              onClick={() => onSelect(segment.id)}
            >
              <div className="segment-row-top">
                <input
                  className="time-input start-input"
                  type="text"
                  inputMode="numeric"
                  aria-label="字幕开始时间"
                  value={formatTimestamp(segment.start, false)}
                  onChange={(event) => onChangeStart(segment.id, parseListTime(event.target.value, segment.start))}
                  onClick={(event) => event.stopPropagation()}
                />
                <span className="time-unit">秒</span>
                <span className="time-separator">→</span>
                <input
                  className="time-input end-input"
                  type="text"
                  inputMode="numeric"
                  aria-label="字幕结束时间"
                  value={formatTimestamp(segment.end, false)}
                  onChange={(event) => onChangeEnd(segment.id, parseListTime(event.target.value, segment.end))}
                  onClick={(event) => event.stopPropagation()}
                />
                <span className="time-unit">秒</span>
              </div>
              <textarea
                className="text-input"
                rows={2}
                aria-label="字幕文字"
                value={segment.text}
                placeholder="输入字幕"
                onChange={(event) => onChangeText(segment.id, event.target.value)}
                onClick={(event) => event.stopPropagation()}
              />
              <div className="row-actions">
                <button type="button" className="mini-button" onClick={(event) => { event.stopPropagation(); onCopy(segment.id); }} title="复制">
                  <Copy size={15} />
                </button>
                <button type="button" className="mini-button danger" onClick={(event) => { event.stopPropagation(); onDelete(segment.id); }} title="删除">
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <button
        ref={addZoneRef}
        type="button"
        className="segment-add-zone"
        onClick={onAdd}
        title="添加字幕段"
      >
        <span className="segment-add-icon"><Plus size={17} /></span>
        <span>{segments.length === 0 ? '添加第一条字幕段' : '添加字幕段'}</span>
      </button>
    </div>
  );
}

interface StylePanelProps {
  defaultStyle: SubtitleStyle;
  selectedSegment: SubtitleSegment | null;
  onChangeDefault: (patch: Partial<SubtitleStyle>) => void;
  onChangeSelected: (patch: Partial<SubtitleStyle>) => void;
  onCopy: () => void;
  onDelete: () => void;
  segmentsCount: number;
}

function StylePanel({
  defaultStyle,
  selectedSegment,
  onChangeDefault,
  onChangeSelected,
  onCopy,
  onDelete,
  segmentsCount,
}: StylePanelProps) {
  const editingSegment = Boolean(selectedSegment);
  const style = selectedSegment?.style
    ? { ...DEFAULT_STYLE, ...defaultStyle, ...selectedSegment.style }
    : { ...DEFAULT_STYLE, ...defaultStyle };
  const onChange = editingSegment ? onChangeSelected : onChangeDefault;
  const activePresetId = STYLE_PRESETS.find((preset) =>
    Object.entries(preset.style).every(
      ([key, value]) => style[key as keyof SubtitleStyle] === value,
    ),
  )?.id;

  return (
    <div className="edit-block">
      <div className="block-heading">
        <div>
          <h3>字幕样式</h3>
          <p>{editingSegment ? '仅修改当前段落' : '全局默认样式'}</p>
        </div>
        {editingSegment && (
          <span className="override-chip">段落覆盖</span>
        )}
      </div>

      <div className="style-presets">
        <span className="field-label">预设样式</span>
        <div className="preset-grid">
          {STYLE_PRESETS.map((preset) => (
            <button
              type="button"
              key={preset.id}
              className={`preset-button${activePresetId === preset.id ? ' active' : ''}`}
              aria-pressed={activePresetId === preset.id}
              onClick={() => onChange(preset.style)}
            >
              <span className="preset-preview" aria-hidden="true">
                <span
                  className="preset-preview-bg"
                  style={{
                    backgroundColor: preset.style.backgroundColor,
                    opacity: preset.style.backgroundOpacity,
                  }}
                />
                <span
                  className="preset-preview-text"
                  style={{ color: preset.style.textColor }}
                >
                  字幕
                </span>
              </span>
              <span className="preset-copy">
                <strong>{preset.label}</strong>
                <span>{preset.description}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      <label className="field-row">
        <span>背景色</span>
        <span className="color-field">
          <input
            type="color"
            value={style.backgroundColor}
            onChange={(event) => onChange({ backgroundColor: event.target.value })}
          />
          <span className="mono-chip">{style.backgroundColor}</span>
        </span>
      </label>
      <label className="field-row">
        <span>文字色</span>
        <span className="color-field">
          <input
            type="color"
            value={style.textColor}
            onChange={(event) => onChange({ textColor: event.target.value })}
          />
          <span className="mono-chip">{style.textColor}</span>
        </span>
      </label>
      <label className="field-row">
        <span>字号</span>
        <input
          className="range-input"
          type="range"
          min="18"
          max="96"
          step="1"
          value={style.fontSize}
          onChange={(event) => onChange({ fontSize: Number(event.target.value) })}
        />
        <span className="mono-chip">{style.fontSize}px</span>
      </label>
      <div className="field-row">
        <span>不透明度</span>
        <input
          className="range-input"
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={style.backgroundOpacity}
          onChange={(event) => onChange({ backgroundOpacity: Number(event.target.value) })}
        />
        <span className="mono-chip">{Math.round(style.backgroundOpacity * 100)}%</span>
      </div>

      <SegmentedControl
        label="位置"
        value={style.position}
        options={POSITION_META}
        onChange={(value) => onChange({ position: value as SubtitlePosition })}
      />
      <SegmentedControl
        label="对齐"
        value={style.align}
        options={ALIGN_META}
        onChange={(value) => onChange({ align: value as SubtitleAlign })}
      />

      {editingSegment && (
        <div className="block-actions">
          <button type="button" className="secondary-button" onClick={onCopy}>
            <Copy size={16} /> 复制段落
          </button>
          <button type="button" className="secondary-button danger-text" onClick={onDelete}>
            <Trash2 size={16} /> 删除段落
          </button>
        </div>
      )}
      {segmentsCount > 0 && !editingSegment && (
        <p className="hint-text">选择右侧面板或时间轴中的段落，即可为它单独设置样式。</p>
      )}
    </div>
  );
}

interface SegmentedControlProps<T extends string> {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}

function SegmentedControl<T extends string>({ label, value, options, onChange }: SegmentedControlProps<T>) {
  return (
    <div className="field-block">
      <span className="field-label">{label}</span>
      <div className="segmented">
        {options.map((option) => (
          <button
            type="button"
            key={option.value}
            className={value === option.value ? 'active' : ''}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

interface ExportPanelProps {
  quality: ExportQuality;
  includeAudio: boolean;
  exporting: boolean;
  progress: number;
  phase: string;
  segmentsCount: number;
  error: string;
  onQualityChange: (value: ExportQuality) => void;
  onIncludeAudioChange: (value: boolean) => void;
  onExport: () => void;
}

function ExportPanel({
  quality,
  includeAudio,
  exporting,
  progress,
  phase,
  segmentsCount,
  error,
  onQualityChange,
  onIncludeAudioChange,
  onExport,
}: ExportPanelProps) {
  const qualityHint = QUALITY_META.find((item) => item.value === quality)?.hint ?? '';
  return (
    <div className="edit-block export-block">
      <div className="block-heading">
        <div>
          <h3>导出</h3>
          <p>{qualityHint}</p>
        </div>
        <Clapperboard size={18} />
      </div>

      <label className="field-row select-row">
        <span>画质</span>
        <select value={quality} onChange={(event) => onQualityChange(event.target.value as ExportQuality)}>
          {QUALITY_META.map((item) => (
            <option key={item.value} value={item.value}>{item.label}</option>
          ))}
        </select>
      </label>

      <label className="check-row">
        <input
          type="checkbox"
          checked={includeAudio}
          onChange={(event) => onIncludeAudioChange(event.target.checked)}
        />
        <span>保留原音轨（AAC 将直接封装）</span>
      </label>

      {exporting ? (
        <div className="export-progress">
          <div className="progress-track"><span style={{ width: `${Math.round(progress * 100)}%` }} /></div>
          <div className="progress-copy">
            <span>{phase}</span>
            <span className="mono-chip">{Math.round(progress * 100)}%</span>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="primary-button export-button"
          onClick={onExport}
          disabled={segmentsCount === 0}
        >
          <Download size={17} />
          导出 MP4
        </button>
      )}

      {error && <div className="error-line" role="alert">{error}</div>}
    </div>
  );
}

export default App;
