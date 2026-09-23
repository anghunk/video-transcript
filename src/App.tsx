import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  List,
  Download,
  LoaderCircle,
  LogOut,
  Moon,
  Palette,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Sun,
} from 'lucide-react';
import type {
  CacheOffer,
  DragState,
  ExportQuality,
  SubtitleSegment,
  SubtitleStyle,
  ThemeMode,
} from './types';
import { ConfirmDialog } from './components/ConfirmDialog';
import { ExportPanel } from './components/ExportPanel';
import { SegmentList } from './components/SegmentList';
import { StylePanel } from './components/StylePanel';
import { Timeline } from './components/Timeline';
import { UploadScreen } from './components/UploadScreen';
import { DEFAULT_STYLE, hasActiveSubtitle, renderSubtitleOverlay } from './lib/render';
import { createSegmentId, clampSegment, sortSegments } from './lib/subtitles';
import { formatBytes, formatClock } from './lib/format';
import type { SourceMediaRuntime } from './lib/media';
import {
  clearWorkspaceCache,
  hasWorkspaceCache,
  loadCachedEdits,
  loadCachedVideo,
  saveCachedVideo,
  saveWorkspaceCache,
  type CachedWorkspace,
} from './lib/storage';

type WorkspaceTab = 'subtitles' | 'style' | 'export';
type AppRoute = '/' | '/app';

const THEME_STORAGE_KEY = 'video-transcript-theme';
const TIMELINE_SNAP_THRESHOLD_PX = 8;

/** 读取当前页面对应的应用路由。 */
function getCurrentRoute(): AppRoute {
  const pathname = window.location.pathname.replace(/\/+$/, '') || '/';
  return pathname === '/app' ? '/app' : '/';
}

function getInitialTheme(): ThemeMode {
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

/** 判断键盘事件是否发生在可编辑控件中。 */
function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.matches('input, textarea, select'))
  );
}

type ConfirmAction = {
  kind: 'exit';
  message: string;
  confirmText: string;
  cancelText: string;
  confirmVariant: 'default' | 'danger';
  onConfirm: () => void;
  onCancel: () => void;
};

function App() {
  const [route, setRoute] = useState<AppRoute>(getCurrentRoute);
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
  const timelineSelectionTimeRef = useRef<number | null>(null);
  const timelineDragPropsRef = useRef<{
    onMove: (event: PointerEvent) => void;
    onUp: () => void;
  } | null>(null);
  const restoreLockRef = useRef(false);
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
    // 记录上一次真正绘制的时间点与字幕状态，暂停或空档期直接跳过整块画布重绘。
    let lastPaintedTime = Number.NaN;
    let lastHadSubtitle = false;
    function paintOverlay() {
      const video = videoRef.current;
      const canvas = overlayRef.current;
      if (video && canvas && media) {
        const time = video.currentTime;
        const hasSubtitle = hasActiveSubtitle(sortedSegments, time);
        if (time !== lastPaintedTime || hasSubtitle !== lastHadSubtitle) {
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
              time,
              segments: sortedSegments,
              defaultStyle,
            });
          }
          lastPaintedTime = time;
          lastHadSubtitle = hasSubtitle;
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
    function syncRoute() {
      if (getCurrentRoute() === '/' && window.location.pathname !== '/') {
        window.history.replaceState(null, '', '/');
      }
      setRoute(getCurrentRoute());
    }

    syncRoute();
    window.addEventListener('popstate', syncRoute);
    return () => window.removeEventListener('popstate', syncRoute);
  }, []);

  useEffect(() => {
    if (route !== '/') return;

    let cancelled = false;
    void (async () => {
      try {
        const [edits, video] = await Promise.all([loadCachedEdits(), loadCachedVideo()]);
        if (cancelled) return;
        if (!edits || !video) {
          setCacheOffer(null);
          return;
        }
        setCacheOffer({
          fileName: video.fileName,
          savedAt: new Date(edits.savedAt).toLocaleString(),
        });
      } catch {
        if (!cancelled) setCacheOffer(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [media, route]);

  useEffect(() => {
    if (route !== '/app' || media || restoreLockRef.current) return;

    restoreLockRef.current = true;
    setRestoring(true);
    setError('');
    void (async () => {
      try {
        if (!(await hasWorkspaceCache())) {
          navigate('/', { replace: true });
          return;
        }
        const restored = await restoreCachedWorkspace();
        if (!restored) navigate('/', { replace: true });
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : '恢复缓存失败');
        navigate('/', { replace: true });
      } finally {
        restoreLockRef.current = false;
        setRestoring(false);
      }
    })();
  }, [media, route]);

  /** 使用 History API 切换应用路由。 */
  function navigate(path: AppRoute, options: { replace?: boolean } = {}) {
    if (window.location.pathname !== path) {
      if (options.replace) window.history.replaceState(null, '', path);
      else window.history.pushState(null, '', path);
    }
    setRoute(path);
  }

  async function restoreCachedWorkspace(): Promise<boolean> {
    try {
      const [edits, video] = await Promise.all([loadCachedEdits(), loadCachedVideo()]);
      if (!edits || !video) return false;
      const file = new File([video.blob], video.fileName, { type: 'video/mp4' });
      const opened = await openFile(file, { cacheVideo: false });
      if (!opened) return false;
      setSegments(edits.segments);
      setSelectedId(null);
      setDefaultStyle(edits.defaultStyle);
      setDefaultDuration(edits.defaultDuration);
      setQuality(edits.quality);
      setIncludeAudio(edits.includeAudio);
      return true;
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : '恢复缓存失败');
      return false;
    }
  }

  function restoreFromCache() {
    setRestoring(true);
    setError('');
    void restoreCachedWorkspace()
      .then((restored) => {
        if (!restored) return;
        setCacheOffer(null);
        navigate('/app');
      })
      .finally(() => setRestoring(false));
  }

  function discardCachedWorkspace() {
    setCacheOffer(null);
    setError('');
    void clearWorkspaceCache();
  }

  function requestUpload() {
    fileInputRef.current?.click();
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (await openFile(file)) {
      setCacheOffer(null);
      navigate('/app');
    }
    event.target.value = '';
  }

  async function openFile(
    file: File,
    options: { cacheVideo?: boolean } = {},
  ): Promise<boolean> {
    if (!file.type.startsWith('video/') && !file.name.toLowerCase().endsWith('.mp4')) {
      setError('请选择 MP4 视频文件');
      return false;
    }
    setError('');
    setLoading(true);
    setExporting(false);
    setExportProgress(0);
    try {
      const { loadSourceMedia } = await import('./lib/media');
      const runtime = await loadSourceMedia(file);
      if (!runtime.videoTrack || !runtime.videoConfig) {
        throw new Error('未识别到可解码的视频轨道，请换用 H.264 编码的 MP4。');
      }
      if (mediaUrl) URL.revokeObjectURL(mediaUrl);
      const nextUrl = URL.createObjectURL(new Blob([runtime.info.buffer], { type: 'video/mp4' }));
      setMedia(runtime);
      setMediaUrl(nextUrl);
      setCurrentTime(0);
      timelineSelectionTimeRef.current = null;
      setDuration(runtime.info.duration);
      setSegments([]);
      setSelectedId(null);
      if (options.cacheVideo !== false) void saveCachedVideo(file, file.name);
      const video = videoRef.current;
      if (video) {
        video.load();
        video.currentTime = 0;
      }
      return true;
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : '视频解析失败');
      return false;
    } finally {
      setLoading(false);
    }
  }

  function handleDrop(event: ReactDragEvent<HTMLDivElement>) {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (file) {
      void openFile(file).then((opened) => {
        if (opened) {
          setCacheOffer(null);
          navigate('/app');
        }
      });
    }
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

  function addSegmentAt(preferredStart: number) {
    if (!media) return;
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
    timelineSelectionTimeRef.current = safeEnd;
  }

  function handleAddSegment() {
    if (!media) return;
    const lastSegmentEnd = sortedSegments.reduce(
      (max, segment) => Math.max(max, segment.end),
      0,
    );
    const preferredStart = timelineSelectionTimeRef.current !== null
      ? timelineSelectionTimeRef.current
      : selectedSegment?.end ?? (lastSegmentEnd > 0 ? lastSegmentEnd : currentTime);
    addSegmentAt(preferredStart);
  }

  function handleDeleteSegment() {
    if (!selectedId) return;
    setSegments((current) => current.filter((segment) => segment.id !== selectedId));
    setSelectedId(null);
  }

  useEffect(() => {
    function handleGlobalKeyDown(event: KeyboardEvent) {
      if (!media || confirmAction || exporting || event.isComposing) return;

      const hasCommandModifier = event.metaKey || event.ctrlKey;
      if (
        hasCommandModifier &&
        !event.altKey &&
        !event.shiftKey &&
        event.key === 'Enter'
      ) {
        if (event.repeat) return;
        event.preventDefault();
        handleAddSegment();
        return;
      }

      if (
        selectedId &&
        !isEditableTarget(event.target) &&
        (event.key === 'Delete' || event.key === 'Backspace')
      ) {
        event.preventDefault();
        handleDeleteSegment();
      }
    }

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [
    confirmAction,
    currentTime,
    defaultDuration,
    duration,
    exporting,
    media,
    selectedId,
    selectedSegment,
    sortedSegments,
  ]);

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
    const targetTime = ratio * duration;
    timelineSelectionTimeRef.current = targetTime;
    handleSeek(targetTime);
    const updatePlayhead = (pointerEvent: PointerEvent) => {
      const box = trackElement.getBoundingClientRect();
      const nextRatio = Math.max(0, Math.min(1, (pointerEvent.clientX - box.left) / Math.max(1, box.width)));
      const video = videoRef.current;
      const nextTime = nextRatio * duration;
      timelineSelectionTimeRef.current = nextTime;
      if (video) {
        video.currentTime = nextTime;
        setCurrentTime(nextTime);
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
    timelineSelectionTimeRef.current = targetTime;
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
      snapTime: timelineSelectionTimeRef.current,
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
    const snapThresholdSeconds = (TIMELINE_SNAP_THRESHOLD_PX / Math.max(1, rect.width)) * duration;
    const { originalStart, originalEnd, edge } = drag;
    const snap = (value: number): number => {
      if (drag.snapTime === null || Math.abs(value - drag.snapTime) > snapThresholdSeconds) {
        return value;
      }
      return drag.snapTime;
    };

    if (edge === 'start') {
      const start = snap(originalStart + deltaSeconds);
      updateSegmentById(drag.segmentId, {
        start: Math.max(0, Math.min(start, originalEnd - 0.08)),
      });
    } else if (edge === 'end') {
      const end = snap(originalEnd + deltaSeconds);
      updateSegmentById(drag.segmentId, {
        end: Math.min(duration, Math.max(end, originalStart + 0.08)),
      });
    } else {
      const width = originalEnd - originalStart;
      let start = Math.max(0, Math.min(duration - width, originalStart + deltaSeconds));
      if (drag.snapTime !== null) {
        const startDelta = drag.snapTime - start;
        const endDelta = drag.snapTime - (start + width);
        const nearestDelta =
          Math.abs(startDelta) <= Math.abs(endDelta) ? startDelta : endDelta;
        if (Math.abs(nearestDelta) <= snapThresholdSeconds) {
          start = Math.max(0, Math.min(duration - width, start + nearestDelta));
        }
      }
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
      const { exportSubtitleVideo } = await import('./lib/export');
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
    if (clearCache) {
      setCacheOffer(null);
      void clearWorkspaceCache();
    }
    navigate('/');
    setMedia(null);
    setMediaUrl('');
    setCurrentTime(0);
    timelineSelectionTimeRef.current = null;
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
      {route === '/' ? (
        <UploadScreen
          cacheOffer={cacheOffer}
          loading={loading}
          error={error}
          restoring={restoring}
          theme={theme}
          onToggleTheme={toggleTheme}
          onSelect={requestUpload}
          onRestore={restoreFromCache}
          onDiscard={discardCachedWorkspace}
          onDrop={handleDrop}
        />
      ) : media ? (
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
                  onClick={handlePlayPause}
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
                <button type="button" className="control-button text-button" onClick={handleAddSegment} title="添加字幕（⌘/Ctrl + Enter）">
                  <span>添加字幕</span>
                  <kbd className="shortcut-hint">⌘/Ctrl + Enter</kbd>
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
                timelineSelectionTimeRef.current = null;
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
                    timelineSelectionTimeRef.current = null;
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
      ) : (
        <div className="app-loading" role="status" aria-live="polite">
          <LoaderCircle className="spin" size={24} />
          <strong>{restoring ? '正在恢复上次项目' : '正在打开工作台'}</strong>
          <span>正在从本地缓存读取视频和字幕进度，请稍候。</span>
        </div>
      )}

      <input
        ref={fileInputRef}
        className="visually-hidden"
        type="file"
        accept="video/mp4,video/quicktime,video/*"
        onChange={handleFileChange}
      />

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

export default App;
