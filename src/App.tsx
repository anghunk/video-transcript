import {
  useEffect,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  AudioLines,
  Download,
  FolderOpen,
  List,
  LoaderCircle,
  Maximize2,
  Moon,
  Palette,
  Pause,
  Play,
  RotateCcw,
  Sun,
  Video,
} from 'lucide-react';
import type {
  DragState,
  ExportQuality,
  SubtitleSegment,
  SubtitleStyle,
  ThemeMode,
} from './types';
import { AsrPanel } from './components/AsrPanel';
import { ExportPanel } from './components/ExportPanel';
import { FullscreenPreview } from './components/FullscreenPreview';
import { SegmentList } from './components/SegmentList';
import { StylePanel } from './components/StylePanel';
import { Timeline } from './components/Timeline';
import { UploadScreen } from './components/UploadScreen';
import { ProjectsScreen } from './components/ProjectsScreen';
import { DEFAULT_STYLE, hasActiveSubtitle, renderSubtitleOverlay } from './lib/render';
import { createSegmentId, clampSegment, sortSegments } from './lib/subtitles';
import { formatBytes, formatClock } from './lib/format';
import type { SourceMediaRuntime } from './lib/media';
import { createVideoThumbnail } from './lib/thumbnail';
import {
  createProjectId,
  createProjectName,
  deleteProject as deleteStoredProject,
  getStorageEstimate,
  listProjects,
  loadProject,
  loadProjectVideo,
  renameProject as renameStoredProject,
  requestPersistentStorage,
  saveProject,
  saveProjectVideo,
  touchProject,
  type ProjectSummary,
  type StorageEstimate,
  type StoredProject,
} from './lib/storage';

type WorkspaceTab = 'subtitles' | 'asr' | 'style' | 'export';
type AppRoute =
  | { name: 'landing'; path: '/' }
  | { name: 'projects'; path: '/projects' }
  | { name: 'workspace'; path: string; projectId: string };

interface UploadIntent {
  type: 'create' | 'relink';
  projectId?: string;
}

const THEME_STORAGE_KEY = 'video-transcript-theme';
const TIMELINE_SNAP_THRESHOLD_PX = 8;

/** 解析当前页面对应的应用路由，未知路径统一回到落地页。 */
function getCurrentRoute(): AppRoute {
  const pathname = window.location.pathname.replace(/\/+$/, '') || '/';
  if (pathname === '/projects') {
    return { name: 'projects', path: '/projects' };
  }

  const projectMatch = pathname.match(/^\/projects\/([^/]+)$/);
  if (projectMatch) {
    try {
      const projectId = decodeURIComponent(projectMatch[1]);
      return {
        name: 'workspace',
        path: `/projects/${encodeURIComponent(projectId)}`,
        projectId,
      };
    } catch {
      return { name: 'landing', path: '/' };
    }
  }

  return { name: 'landing', path: '/' };
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

function App() {
  const { t } = useTranslation();
  const [route, setRoute] = useState<AppRoute>(getCurrentRoute);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsError, setProjectsError] = useState('');
  const [storageEstimate, setStorageEstimate] = useState<StorageEstimate | null>(null);
  const [media, setMedia] = useState<SourceMediaRuntime | null>(null);
  const [mediaUrl, setMediaUrl] = useState('');
  const [loadedProjectId, setLoadedProjectId] = useState<string | null>(null);
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
  const [restoring, setRestoring] = useState(false);
  const [fullscreenPreviewOpen, setFullscreenPreviewOpen] = useState(false);

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
  const workspaceLoadTokenRef = useRef(0);
  const uploadIntentRef = useRef<UploadIntent | null>(null);
  const workspaceStateRef = useRef<StoredProject | null>(null);

  const sortedSegments = useMemo(() => sortSegments(segments), [segments]);
  const routeProjectId = route.name === 'workspace' ? route.projectId : null;

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
    const video = videoRef.current;
    if (!video || !mediaUrl) return;
    video.load();
    video.currentTime = 0;
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

  const refreshProjects = useCallback(async (showLoading = false) => {
    if (showLoading) setProjectsLoading(true);
    try {
      const nextProjects = await listProjects();
      setProjects(nextProjects);
      setProjectsError('');
    } catch (caughtError) {
      setProjectsError(
        caughtError instanceof Error ? caughtError.message : t('errors.projectListFailed'),
      );
    } finally {
      if (showLoading) setProjectsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    const current = workspaceStateRef.current;
    if (!current || current.id !== loadedProjectId) return;
    workspaceStateRef.current = {
      ...current,
      projectName: media?.info.name ?? current.projectName,
      videoSize: media?.info.size ?? current.videoSize,
      videoWidth: media?.info.width ?? current.videoWidth,
      videoHeight: media?.info.height ?? current.videoHeight,
      videoDuration: duration,
      videoCodec: media?.info.videoCodec ?? current.videoCodec,
      hasAudio: media?.info.hasAudio ?? current.hasAudio,
      audioCodec: media?.info.audioCodec || current.audioCodec,
      defaultDuration,
      quality,
      includeAudio,
      defaultStyle,
      segments,
    };
  }, [
    defaultDuration,
    defaultStyle,
    duration,
    includeAudio,
    loadedProjectId,
    media,
    quality,
    segments,
  ]);

  async function persistWorkspace(): Promise<void> {
    const current = workspaceStateRef.current;
    if (!media || !current || current.id !== loadedProjectId || routeProjectId !== current.id) {
      return;
    }
    const now = Date.now();
    const nextProject: StoredProject = {
      ...current,
      savedAt: now,
      updatedAt: now,
    };
    workspaceStateRef.current = nextProject;
    try {
      await saveProject(nextProject);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : t('errors.projectSaveFailed'),
      );
    }
  }

  useEffect(() => {
    if (!media || !loadedProjectId || routeProjectId !== loadedProjectId) return;
    const timer = window.setTimeout(() => {
      void persistWorkspace();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [
    defaultDuration,
    defaultStyle,
    includeAudio,
    loadedProjectId,
    media,
    quality,
    routeProjectId,
    segments,
  ]);

  useEffect(() => {
    if (!media || !loadedProjectId || routeProjectId !== loadedProjectId) return;
    function handlePageHide() {
      void persistWorkspace();
    }
    window.addEventListener('pagehide', handlePageHide);
    return () => window.removeEventListener('pagehide', handlePageHide);
  }, [loadedProjectId, media, routeProjectId]);

  useLayoutEffect(() => {
    if (workspacePanelRef.current) {
      workspacePanelRef.current.scrollTop = 0;
    }
  }, [workspaceTab]);

  useEffect(() => {
    function syncRoute() {
      const nextRoute = getCurrentRoute();
      if (nextRoute.name === 'landing' && window.location.pathname !== '/') {
        window.history.replaceState(null, '', '/');
      }
      setRoute(nextRoute);
    }

    syncRoute();
    window.addEventListener('popstate', syncRoute);
    return () => window.removeEventListener('popstate', syncRoute);
  }, []);

  useEffect(() => {
    if (route.name !== 'projects') return;
    void refreshProjects(true);
    void getStorageEstimate().then(setStorageEstimate);
  }, [refreshProjects, route.name]);

  useEffect(() => {
    if (route.name !== 'workspace') return;
    if (loadedProjectId === route.projectId && media) return;

    const token = ++workspaceLoadTokenRef.current;
    let cancelled = false;
    setRestoring(true);
    setError('');
    void (async () => {
      try {
        const [project, video] = await Promise.all([
          loadProject(route.projectId),
          loadProjectVideo(route.projectId),
        ]);
        if (cancelled || token !== workspaceLoadTokenRef.current) return;
        if (!project) {
          throw new Error(t('projects.notFound'));
        }
        if (!video) {
          setProjectsError(t('projects.relinkRequired', { name: project.name }));
          navigate('/projects', { replace: true });
          return;
        }
        const file = new File([video.blob], video.fileName, { type: 'video/mp4' });
        const runtime = await parseMediaFile(file);
        if (!runtime || cancelled || token !== workspaceLoadTokenRef.current) return;
        applyProjectWorkspace(project, runtime);
        void cacheProjectThumbnail(project, file);
        void touchProject(project.id).then((touched) => {
          if (!touched || workspaceStateRef.current?.id !== touched.id) return;
          workspaceStateRef.current = {
            ...workspaceStateRef.current,
            lastOpenedAt: touched.lastOpenedAt,
          };
        });
      } catch (caughtError) {
        if (cancelled || token !== workspaceLoadTokenRef.current) return;
        setProjectsError(
          caughtError instanceof Error ? caughtError.message : t('errors.restoreCacheFailed'),
        );
        navigate('/projects', { replace: true });
      } finally {
        if (!cancelled && token === workspaceLoadTokenRef.current) {
          setRestoring(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    loadedProjectId,
    media,
    route.name,
    route.name === 'workspace' ? route.projectId : null,
  ]);

  /** 使用 History API 切换应用路由。 */
  function navigate(path: string, options: { replace?: boolean } = {}) {
    if (window.location.pathname !== path) {
      if (options.replace) window.history.replaceState(null, '', path);
      else window.history.pushState(null, '', path);
    }
    setRoute(getCurrentRoute());
  }

  function projectPath(projectId: string): string {
    return `/projects/${encodeURIComponent(projectId)}`;
  }

  /** 将项目编辑状态与已解析媒体一起装载到工作台。 */
  function applyProjectWorkspace(project: StoredProject, runtime: SourceMediaRuntime) {
    const nextUrl = URL.createObjectURL(
      new Blob([runtime.info.buffer], { type: 'video/mp4' }),
    );
    setMedia(runtime);
    setMediaUrl(nextUrl);
    setLoadedProjectId(project.id);
    setCurrentTime(0);
    timelineSelectionTimeRef.current = null;
    setDuration(runtime.info.duration);
    setPlaying(false);
    setSegments(project.segments);
    setSelectedId(null);
    setDefaultStyle(project.defaultStyle);
    setDefaultDuration(project.defaultDuration);
    setQuality(project.quality);
    setIncludeAudio(project.includeAudio);
    setExporting(false);
    setExportProgress(0);
    setWorkspaceTab('subtitles');
    workspaceStateRef.current = project;
  }

  /**
   * 为缺少缩略图的项目截取视频第 1 秒画面并回写项目记录。
   *
   * 缩略图属于非关键增强数据，生成失败或项目已被删除时直接跳过。
   */
  async function cacheProjectThumbnail(project: StoredProject, source: Blob): Promise<void> {
    if (project.thumbnail) return;
    const thumbnail = await createVideoThumbnail(source);
    if (!thumbnail) return;

    const latest = workspaceStateRef.current?.id === project.id
      ? workspaceStateRef.current
      : await loadProject(project.id);
    if (!latest) return;

    const nextProject = { ...latest, thumbnail };
    if (workspaceStateRef.current?.id === project.id) {
      workspaceStateRef.current = nextProject;
    }
    try {
      await saveProject(nextProject);
      await refreshProjects();
    } catch {
      // 缩略图写入失败不影响项目创建、打开或编辑。
    }
  }

  /** 解析文件并校验视频轨道，不直接改动工作台状态。 */
  async function parseMediaFile(file: File): Promise<SourceMediaRuntime | null> {
    if (!file.type.startsWith('video/') && !file.name.toLowerCase().endsWith('.mp4')) {
      setError(t('errors.selectMp4'));
      return null;
    }
    setError('');
    setLoading(true);
    try {
      const { loadSourceMedia } = await import('./lib/media');
      const runtime = await loadSourceMedia(file);
      if (!runtime.videoTrack || !runtime.videoConfig) {
        throw new Error(t('errors.noDecodableVideoTrack'));
      }
      return runtime;
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : t('errors.videoParseFailed'));
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function createProjectFromFile(file: File): Promise<boolean> {
    const runtime = await parseMediaFile(file);
    if (!runtime) return false;

    const now = Date.now();
    const project: StoredProject = {
      id: createProjectId(),
      name: createProjectName(file.name),
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: now,
      projectName: file.name,
      videoSize: file.size,
      videoWidth: runtime.info.width,
      videoHeight: runtime.info.height,
      videoDuration: runtime.info.duration,
      videoCodec: runtime.info.videoCodec,
      hasAudio: runtime.info.hasAudio,
      audioCodec: runtime.info.audioCodec || undefined,
      defaultDuration: 2,
      quality: 'native',
      includeAudio: true,
      defaultStyle: DEFAULT_STYLE,
      segments: [],
      savedAt: now,
    };

    applyProjectWorkspace(project, runtime);
    void requestPersistentStorage();
    try {
      await saveProject(project);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : t('errors.projectSaveFailed'),
      );
    }
    const videoCached = await saveProjectVideo(project.id, file, file.name);
    if (!videoCached) setError(t('projects.videoCacheFailed'));
    void cacheProjectThumbnail(project, file);
    void refreshProjects();
    navigate(projectPath(project.id));
    return true;
  }

  async function relinkProjectFile(projectId: string, file: File): Promise<boolean> {
    try {
      const project = await loadProject(projectId);
      if (!project) throw new Error(t('projects.notFound'));
      const runtime = await parseMediaFile(file);
      if (!runtime) return false;

      const now = Date.now();
      const updatedProject: StoredProject = {
        ...project,
        projectName: file.name,
        videoSize: file.size,
        videoWidth: runtime.info.width,
        videoHeight: runtime.info.height,
        videoDuration: runtime.info.duration,
        videoCodec: runtime.info.videoCodec,
        hasAudio: runtime.info.hasAudio,
        audioCodec: runtime.info.audioCodec || undefined,
        updatedAt: now,
        savedAt: now,
      };
      applyProjectWorkspace(updatedProject, runtime);
      try {
        await saveProject(updatedProject);
      } catch (caughtError) {
        setError(
          caughtError instanceof Error ? caughtError.message : t('errors.projectSaveFailed'),
        );
      }
      const videoCached = await saveProjectVideo(projectId, file, file.name);
      if (!videoCached) setError(t('projects.videoCacheFailed'));
      void cacheProjectThumbnail(updatedProject, file);
      void refreshProjects();
      navigate(projectPath(projectId));
      return true;
    } catch (caughtError) {
      setProjectsError(
        caughtError instanceof Error ? caughtError.message : t('errors.restoreCacheFailed'),
      );
      return false;
    }
  }

  function requestUpload(intent: UploadIntent) {
    uploadIntentRef.current = intent;
    if (fileInputRef.current) fileInputRef.current.value = '';
    fileInputRef.current?.click();
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const intent = uploadIntentRef.current ?? { type: 'create' } satisfies UploadIntent;
    if (intent.type === 'relink' && intent.projectId) {
      await relinkProjectFile(intent.projectId, file);
    } else {
      await createProjectFromFile(file);
    }
    event.target.value = '';
  }

  function handleDrop(event: ReactDragEvent<HTMLDivElement>) {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (file) {
      void createProjectFromFile(file);
    }
  }

  function handlePlayPause() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play();
    else video.pause();
  }

  function handleResetPlayback() {
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.currentTime = 0;
    }
    setPlaying(false);
    setCurrentTime(0);
  }

  const handleFullscreenPreviewTimeChange = useCallback((time: number) => {
    setCurrentTime(time);
  }, []);

  const handleCloseFullscreenPreview = useCallback((time: number) => {
    setFullscreenPreviewOpen(false);
    setCurrentTime(time);
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    video.currentTime = time;
    setPlaying(false);
  }, []);

  function openFullscreenPreview() {
    videoRef.current?.pause();
    setFullscreenPreviewOpen(true);
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
      text: t('segments.newText'),
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

  /**
   * 应用语音识别结果：替换现有字幕或追加到末尾。
   *
   * @param recognized 识别生成的字幕段
   * @param mode replace 会覆盖现有字幕，append 会保留现有字幕并排在其后
   */
  function handleApplyAsr(recognized: SubtitleSegment[], mode: 'replace' | 'append') {
    setSegments((current) => (mode === 'replace' ? recognized : sortSegments([...current, ...recognized])));
    setSelectedId(null);
    timelineSelectionTimeRef.current = null;
    setWorkspaceTab('subtitles');
  }

  useEffect(() => {
    function handleGlobalKeyDown(event: KeyboardEvent) {
      if (!media || exporting || fullscreenPreviewOpen || event.isComposing) return;

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
    currentTime,
    defaultDuration,
    duration,
    exporting,
    fullscreenPreviewOpen,
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
    // 触屏上的横向手势交给时间轴滚动容器，轻点仍然用于定位播放头。
    if (event.pointerType === 'touch') return;
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
    setExportPhase('export.phases.preparing');
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
      link.download = `${sourceName}${t('export.filenameSuffix')}.mp4`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(downloadUrl), 5000);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : t('errors.exportFailed'));
    } finally {
      setExporting(false);
    }
  }

  function resetWorkspaceState() {
    setMedia(null);
    setMediaUrl('');
    setLoadedProjectId(null);
    setCurrentTime(0);
    timelineSelectionTimeRef.current = null;
    setDuration(0);
    setPlaying(false);
    setSegments([]);
    setSelectedId(null);
    setError('');
    setExporting(false);
    setExportProgress(0);
    workspaceStateRef.current = null;
  }

  async function returnToProjects() {
    await persistWorkspace();
    resetWorkspaceState();
    navigate('/projects');
  }

  function openProjects() {
    navigate('/projects');
  }

  function openProject(projectId: string) {
    setProjectsError('');
    navigate(projectPath(projectId));
  }

  async function handleRenameProject(projectId: string, name: string) {
    try {
      await renameStoredProject(projectId, name);
      await refreshProjects();
    } catch (caughtError) {
      setProjectsError(
        caughtError instanceof Error ? caughtError.message : t('errors.projectSaveFailed'),
      );
    }
  }

  async function handleDeleteProject(projectId: string) {
    try {
      await deleteStoredProject(projectId);
      await refreshProjects();
      setStorageEstimate(await getStorageEstimate());
    } catch (caughtError) {
      setProjectsError(
        caughtError instanceof Error ? caughtError.message : t('errors.cacheClearFailed'),
      );
    }
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
      {route.name === 'landing' ? (
        <UploadScreen
          loading={loading}
          error={error}
          restoring={restoring}
          theme={theme}
          onToggleTheme={toggleTheme}
          onSelect={() => requestUpload({ type: 'create' })}
          onOpenProjects={openProjects}
          onDrop={handleDrop}
        />
      ) : route.name === 'projects' ? (
        <ProjectsScreen
          projects={projects}
          loading={projectsLoading}
          error={projectsError}
          storageEstimate={storageEstimate}
          theme={theme}
          onToggleTheme={toggleTheme}
          onBackHome={() => navigate('/')}
          onCreate={() => requestUpload({ type: 'create' })}
          onOpen={openProject}
          onRelink={(projectId) => requestUpload({ type: 'relink', projectId })}
          onRename={handleRenameProject}
          onDelete={handleDeleteProject}
          onDropFile={(file) => void createProjectFromFile(file)}
        />
      ) : media && loadedProjectId === route.projectId ? (
        <div className="workspace">
          <div className="workspace-main">
            <header className="workspace-main-header">
              <div className="workspace-main-heading">
                <div className="video-facts">
                  <span className="file-fact" title={media.info.name}>{media.info.name}</span>
                  <span>{media.info.width}×{media.info.height}</span>
                  <span>{formatBytes(media.info.size)}</span>
                  <span>{media.info.videoCodec}</span>
                  {media.info.hasAudio && <span>{media.info.audioCodec}</span>}
                </div>
              </div>
              <button
                type="button"
                className="secondary-button workspace-home-button"
                onClick={() => void returnToProjects()}
                title={t('workspace.projects')}
                aria-label={t('workspace.projects')}
                disabled={exporting}
              >
                <FolderOpen size={15} />
                <span>{t('workspace.projects')}</span>
              </button>
            </header>

            {error && <div className="error-line workspace-error" role="alert">{error}</div>}

            <section className="preview-column">
            <div className="preview-shell">
              <div
                className="video-stage"
                style={{
                  aspectRatio: String(videoAspectRatio),
                  // 视频预览按视口高度留出空间，避免挤占下方时间轴。
                  maxWidth: `${videoAspectRatio * 58}vh`,
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
                    aria-label={t('workspace.play')}
                    title={t('workspace.play')}
                  >
                    <Play size={26} fill="currentColor" />
                  </button>
                )}
              </div>

              <div className="player-bar">
                <button
                  type="button"
                  className="control-button"
                  onClick={handlePlayPause}
                  title={playing ? t('workspace.pause') : t('workspace.play')}
                  aria-label={playing ? t('workspace.pause') : t('workspace.play')}
                >
                  {playing ? <Pause size={17} /> : <Play size={17} />}
                </button>
                <button
                  type="button"
                  className="control-button"
                  onClick={handleResetPlayback}
                  title={t('workspace.resetPlayback')}
                  aria-label={t('workspace.resetPlayback')}
                >
                  <RotateCcw size={16} />
                </button>
                <button
                  type="button"
                  className="control-button text-button preview-button"
                  onClick={openFullscreenPreview}
                  title={t('workspace.fullscreen')}
                  aria-label={t('workspace.fullscreen')}
                >
                  <Maximize2 size={16} />
                  <span>{t('workspace.preview')}</span>
                </button>
                <span className="timecode">{formatClock(currentTime)} / {formatClock(duration)}</span>
                <button
                  type="button"
                  className="control-button text-button add-subtitle-button"
                  onClick={handleAddSegment}
                  title={`${t('workspace.addSubtitle')} (⌘/Ctrl + Enter)`}
                >
                  <span>{t('workspace.addSubtitle')}</span>
                  <kbd className="shortcut-hint">⌘/Ctrl + Enter</kbd>
                </button>
              </div>
            </div>
            </section>

            <section className="timeline-column">
            <Timeline
              duration={duration}
              currentTime={currentTime}
              playing={playing}
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
              <div className="workspace-tabs" role="tablist" aria-label={t('workspace.rightPanel')}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={workspaceTab === 'subtitles'}
                  className={workspaceTab === 'subtitles' ? 'active' : ''}
                  onClick={() => setWorkspaceTab('subtitles')}
                >
                  <List size={15} /> {t('workspace.tabs.subtitles')}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={workspaceTab === 'asr'}
                  className={workspaceTab === 'asr' ? 'active' : ''}
                  onClick={() => setWorkspaceTab('asr')}
                >
                  <AudioLines size={15} /> {t('workspace.tabs.asr')}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={workspaceTab === 'style'}
                  className={workspaceTab === 'style' ? 'active' : ''}
                  onClick={() => setWorkspaceTab('style')}
                >
                  <Palette size={15} /> {t('workspace.tabs.style')}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={workspaceTab === 'export'}
                  className={workspaceTab === 'export' ? 'active' : ''}
                  onClick={() => setWorkspaceTab('export')}
                >
                  <Download size={15} /> {t('workspace.tabs.export')}
                </button>
              </div>
              <button
                type="button"
                className="theme-toggle workspace-theme-toggle"
                onClick={toggleTheme}
                title={theme === 'dark' ? t('common.theme.switchToLight') : t('common.theme.switchToDark')}
                aria-label={theme === 'dark' ? t('common.theme.switchToLight') : t('common.theme.switchToDark')}
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
              {workspaceTab === 'asr' && media && (
                <AsrPanel
                  media={media}
                  existingCount={segments.length}
                  disabled={exporting}
                  onApply={handleApplyAsr}
                />
              )}
              {workspaceTab === 'style' && (
                <StylePanel
                  defaultStyle={defaultStyle}
                  onChange={updateDefaultStyle}
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
                  error=""
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
          <strong>{restoring ? t('workspace.loadingRestore') : t('workspace.loadingOpen')}</strong>
          <span>{t('workspace.loadingDescription')}</span>
        </div>
      )}

      {fullscreenPreviewOpen && media && (
        <FullscreenPreview
          src={mediaUrl}
          initialTime={currentTime}
          duration={duration}
          width={media.info.width}
          height={media.info.height}
          aspectRatio={videoAspectRatio}
          segments={sortedSegments}
          defaultStyle={defaultStyle}
          onTimeChange={handleFullscreenPreviewTimeChange}
          onClose={handleCloseFullscreenPreview}
        />
      )}

      <input
        ref={fileInputRef}
        className="visually-hidden"
        type="file"
        accept="video/mp4,video/quicktime,video/*"
        onChange={handleFileChange}
      />

    </main>
  );
}

export default App;
