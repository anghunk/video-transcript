import i18n from '../i18n';
import type { ExportQuality, SubtitleSegment, SubtitleStyle } from '../types';

const DB_NAME = 'video-transcript';
const DB_VERSION = 2;
const PROJECT_STORE = 'projects';
const PROJECT_VIDEO_STORE = 'project-videos';
const LEGACY_EDIT_STORE = 'edits';
const LEGACY_VIDEO_STORE = 'video';

interface LegacyStoredVideo {
  blob: Blob;
  fileName: string;
}

export interface CachedWorkspace {
  projectName: string;
  videoSize: number;
  videoWidth: number;
  videoHeight: number;
  videoDuration: number;
  videoCodec: string;
  hasAudio: boolean;
  audioCodec?: string;
  defaultDuration: number;
  quality: ExportQuality;
  includeAudio: boolean;
  defaultStyle: SubtitleStyle;
  segments: SubtitleSegment[];
  savedAt: number;
}

export interface StoredProject extends CachedWorkspace {
  id: string;
  name: string;
  thumbnail?: string;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number;
}

export interface ProjectSummary {
  id: string;
  name: string;
  videoFileName: string;
  videoSize: number;
  videoDuration: number;
  videoWidth: number;
  videoHeight: number;
  segmentCount: number;
  thumbnail?: string;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number;
  hasVideo: boolean;
}

export interface StoredProjectVideo {
  id: string;
  blob: Blob;
  fileName: string;
  savedAt: number;
}

export interface StorageEstimate {
  usage: number;
  persisted: boolean;
}

/** 生成项目 ID，旧浏览器不支持 randomUUID 时使用时间戳与随机片段兜底。 */
export function createProjectId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** 把视频文件名转成默认项目名。 */
export function createProjectName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').trim() || fileName || 'Untitled';
}

/** 规范化旧缓存或外部数据，避免缺字段导致工作台崩溃。 */
function normalizeWorkspace(record: CachedWorkspace): CachedWorkspace {
  return {
    ...record,
    segments: Array.isArray(record.segments)
      ? record.segments.map((segment) => ({
          id: segment.id,
          start: Number(segment.start) || 0,
          end: Number(segment.end) || 0,
          text: String(segment.text ?? ''),
        }))
      : [],
    savedAt: Number(record.savedAt) || Date.now(),
  };
}

/** 规范化项目记录。 */
function normalizeProject(record: StoredProject): StoredProject | null {
  if (
    !record ||
    typeof record.id !== 'string' ||
    !record.defaultStyle ||
    !Array.isArray(record.segments)
  ) {
    return null;
  }
  const workspace = normalizeWorkspace(record);
  return {
    ...record,
    ...workspace,
    name: typeof record.name === 'string' && record.name.trim()
      ? record.name
      : createProjectName(record.projectName),
    thumbnail: typeof record.thumbnail === 'string' && record.thumbnail.startsWith('data:image/')
      ? record.thumbnail
      : undefined,
    createdAt: Number(record.createdAt) || workspace.savedAt,
    updatedAt: Number(record.updatedAt) || workspace.savedAt,
    lastOpenedAt: Number(record.lastOpenedAt) || workspace.savedAt,
  };
}

/**
 * 把 v1 的单例缓存迁移成首个项目。
 *
 * 迁移与旧记录清理在同一个 versionchange 事务中完成，避免留下重复的视频 Blob。
 */
function migrateLegacyWorkspace(
  db: IDBDatabase,
  transaction: IDBTransaction,
  projectStore: IDBObjectStore,
  videoStore: IDBObjectStore,
): void {
  if (
    !db.objectStoreNames.contains(LEGACY_EDIT_STORE) ||
    !db.objectStoreNames.contains(LEGACY_VIDEO_STORE)
  ) {
    return;
  }

  const editStore = transaction.objectStore(LEGACY_EDIT_STORE);
  const legacyVideoStore = transaction.objectStore(LEGACY_VIDEO_STORE);
  const editRequest = editStore.get('current');
  const videoRequest = legacyVideoStore.get('current');
  let editReady = false;
  let videoReady = false;

  const migrateWhenReady = () => {
    if (!editReady || !videoReady) return;
    const edits = editRequest.result as CachedWorkspace | undefined;
    const video = videoRequest.result as LegacyStoredVideo | undefined;
    if (!edits || !video?.blob) return;

    const id = createProjectId();
    const now = Date.now();
    const savedAt = Number(edits.savedAt) || now;
    const workspace = normalizeWorkspace(edits);
    projectStore.put({
      ...workspace,
      id,
      name: createProjectName(video.fileName),
      createdAt: savedAt,
      updatedAt: savedAt,
      lastOpenedAt: savedAt,
    } satisfies StoredProject);
    videoStore.put({
      id,
      blob: video.blob,
      fileName: video.fileName,
      savedAt,
    } satisfies StoredProjectVideo);
    editStore.delete('current');
    legacyVideoStore.delete('current');
  };

  editRequest.onsuccess = () => {
    editReady = true;
    migrateWhenReady();
  };
  videoRequest.onsuccess = () => {
    videoReady = true;
    migrateWhenReady();
  };
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      const transaction = request.transaction!;
      let projectStore: IDBObjectStore;
      if (!db.objectStoreNames.contains(PROJECT_STORE)) {
        projectStore = db.createObjectStore(PROJECT_STORE, { keyPath: 'id' });
        projectStore.createIndex('updatedAt', 'updatedAt');
        projectStore.createIndex('lastOpenedAt', 'lastOpenedAt');
      } else {
        projectStore = transaction.objectStore(PROJECT_STORE);
      }

      let videoStore: IDBObjectStore;
      if (!db.objectStoreNames.contains(PROJECT_VIDEO_STORE)) {
        videoStore = db.createObjectStore(PROJECT_VIDEO_STORE, { keyPath: 'id' });
      } else {
        videoStore = transaction.objectStore(PROJECT_VIDEO_STORE);
      }

      migrateLegacyWorkspace(db, transaction, projectStore, videoStore);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(
      request.error ?? new Error(i18n.t('errors.cacheDatabaseOpenFailed')),
    );
  });
}

/** 在指定对象仓库中执行一次读写事务。 */
function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDatabase().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(storeName, mode);
        const request = operation(transaction.objectStore(storeName));
        let result: T | undefined;
        request.onsuccess = () => {
          result = request.result;
        };
        transaction.oncomplete = () => {
          db.close();
          resolve(result as T);
        };
        transaction.onerror = () => {
          db.close();
          reject(transaction.error ?? new Error(i18n.t('errors.cacheWriteFailed')));
        };
        transaction.onabort = () => {
          db.close();
          reject(transaction.error ?? new Error(i18n.t('errors.cacheWriteAborted')));
        };
      }),
  );
}

/** 读取全部项目及视频缓存状态。 */
export async function listProjects(): Promise<ProjectSummary[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([PROJECT_STORE, PROJECT_VIDEO_STORE], 'readonly');
    const projectRequest = transaction.objectStore(PROJECT_STORE).getAll();
    const videoKeyRequest = transaction.objectStore(PROJECT_VIDEO_STORE).getAllKeys();
    let projects: StoredProject[] = [];
    let videoKeys: IDBValidKey[] = [];
    let projectsReady = false;
    let videoKeysReady = false;

    const finish = () => {
      if (!projectsReady || !videoKeysReady) return;
      const cachedVideos = new Set(videoKeys.map(String));
      const summaries = projects
        .map(normalizeProject)
        .filter((project): project is StoredProject => Boolean(project))
        .map((project) => ({
          id: project.id,
          name: project.name,
          videoFileName: project.projectName,
          videoSize: project.videoSize,
          videoDuration: project.videoDuration,
          videoWidth: project.videoWidth,
          videoHeight: project.videoHeight,
          segmentCount: project.segments.length,
          thumbnail: project.thumbnail,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
          lastOpenedAt: project.lastOpenedAt,
          hasVideo: cachedVideos.has(project.id),
        }))
        .sort((a, b) => b.updatedAt - a.updatedAt);
      resolve(summaries);
    };

    projectRequest.onsuccess = () => {
      projects = projectRequest.result as StoredProject[];
      projectsReady = true;
      finish();
    };
    videoKeyRequest.onsuccess = () => {
      videoKeys = videoKeyRequest.result;
      videoKeysReady = true;
      finish();
    };
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => {
      db.close();
      reject(transaction.error ?? new Error(i18n.t('errors.cacheReadFailed')));
    };
  });
}

/** 读取指定项目的编辑状态。 */
export async function loadProject(projectId: string): Promise<StoredProject | null> {
  const record = await withStore<StoredProject | undefined>(
    PROJECT_STORE,
    'readonly',
    (store) => store.get(projectId),
  );
  return record ? normalizeProject(record) : null;
}

/** 读取指定项目缓存的原始视频。 */
export async function loadProjectVideo(projectId: string): Promise<StoredProjectVideo | null> {
  const record = await withStore<StoredProjectVideo | undefined>(
    PROJECT_VIDEO_STORE,
    'readonly',
    (store) => store.get(projectId),
  );
  return record?.blob ? record : null;
}

/** 保存完整项目记录。 */
export async function saveProject(project: StoredProject): Promise<void> {
  await withStore(PROJECT_STORE, 'readwrite', (store) => store.put(project));
}

/** 保存项目视频，配额不足时返回 false 并保留项目编辑数据。 */
export async function saveProjectVideo(
  projectId: string,
  blob: Blob,
  fileName: string,
): Promise<boolean> {
  try {
    const record: StoredProjectVideo = {
      id: projectId,
      blob,
      fileName,
      savedAt: Date.now(),
    };
    await withStore(PROJECT_VIDEO_STORE, 'readwrite', (store) => store.put(record));
    return true;
  } catch {
    return false;
  }
}

/** 更新项目名称和修改时间。 */
export async function renameProject(projectId: string, name: string): Promise<void> {
  const project = await loadProject(projectId);
  if (!project) return;
  const nextName = name.trim();
  if (!nextName || nextName === project.name) return;
  await saveProject({
    ...project,
    name: nextName,
    updatedAt: Date.now(),
  });
}

/** 更新项目最近打开时间。 */
export async function touchProject(projectId: string): Promise<StoredProject | null> {
  const project = await loadProject(projectId);
  if (!project) return null;
  const touched = {
    ...project,
    lastOpenedAt: Date.now(),
  };
  await saveProject(touched);
  return touched;
}

/** 删除项目及其视频缓存。 */
export async function deleteProject(projectId: string): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(
      [PROJECT_STORE, PROJECT_VIDEO_STORE],
      'readwrite',
    );
    transaction.objectStore(PROJECT_STORE).delete(projectId);
    transaction.objectStore(PROJECT_VIDEO_STORE).delete(projectId);
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error ?? new Error(i18n.t('errors.cacheClearFailed')));
    };
    transaction.onabort = () => {
      db.close();
      reject(transaction.error ?? new Error(i18n.t('errors.cacheWriteAborted')));
    };
  });
}

/** 汇总当前应用保存在 IndexedDB 中的项目元数据与视频数据大小。 */
async function getProjectStorageUsage(): Promise<number> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([PROJECT_STORE, PROJECT_VIDEO_STORE], 'readonly');
    const projectRequest = transaction.objectStore(PROJECT_STORE).getAll();
    const videoRequest = transaction.objectStore(PROJECT_VIDEO_STORE).getAll();
    let projects: StoredProject[] = [];
    let videos: StoredProjectVideo[] = [];
    let projectsReady = false;
    let videosReady = false;

    const finish = () => {
      if (!projectsReady || !videosReady) return;
      const encoder = new TextEncoder();
      const projectBytes = projects.reduce(
        (total, project) => total + encoder.encode(JSON.stringify(project)).byteLength,
        0,
      );
      const videoBytes = videos.reduce((total, video) => total + (video.blob?.size ?? 0), 0);
      resolve(projectBytes + videoBytes);
    };

    projectRequest.onsuccess = () => {
      projects = projectRequest.result as StoredProject[];
      projectsReady = true;
      finish();
    };
    videoRequest.onsuccess = () => {
      videos = videoRequest.result as StoredProjectVideo[];
      videosReady = true;
      finish();
    };
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => {
      db.close();
      reject(transaction.error ?? new Error(i18n.t('errors.cacheReadFailed')));
    };
  });
}

/** 读取项目数据占用与持久化状态，不包含模型下载或浏览器其他缓存。 */
export async function getStorageEstimate(): Promise<StorageEstimate> {
  try {
    const [usage, persisted] = await Promise.all([
      getProjectStorageUsage(),
      navigator.storage.persisted?.() ?? Promise.resolve(false),
    ]);
    return {
      usage,
      persisted,
    };
  } catch {
    return { usage: 0, persisted: false };
  }
}

/** 申请持久化存储，失败时静默降级。 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
  try {
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
