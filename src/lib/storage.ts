import type { ExportQuality, SubtitleSegment, SubtitleStyle } from '../types';

const WORKSPACE_KEY = 'subtitle-studio-workspace';
const DB_NAME = 'subtitle-studio';
const DB_VERSION = 1;
const EDIT_STORE = 'edits';
const VIDEO_STORE = 'video';

/** 单条视频缓存，与编辑状态分开存储，避免大 Blob 长期拖慢读取。 */
interface StoredVideo {
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

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(EDIT_STORE)) {
        db.createObjectStore(EDIT_STORE);
      }
      if (!db.objectStoreNames.contains(VIDEO_STORE)) {
        db.createObjectStore(VIDEO_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('无法打开本地缓存数据库'));
  });
}

function putRecord(storeName: string, value: unknown): Promise<void> {
  return openDatabase().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readwrite');
        transaction.objectStore(storeName).put(value, 'current');
        transaction.oncomplete = () => {
          db.close();
          resolve();
        };
        transaction.onerror = () => reject(transaction.error ?? new Error('缓存写入失败'));
        transaction.onabort = () => reject(transaction.error ?? new Error('缓存写入被中止'));
      }),
  );
}

function getRecord<T>(storeName: string): Promise<T | null> {
  return openDatabase().then(
    (db) =>
      new Promise<T | null>((resolve, reject) => {
        const request = db.transaction(storeName, 'readonly').objectStore(storeName).get('current');
        request.onsuccess = () => {
          db.close();
          resolve((request.result as T | undefined) ?? null);
        };
        request.onerror = () => reject(request.error ?? new Error('缓存读取失败'));
      }),
  );
}

function deleteRecord(storeName: string): Promise<void> {
  return openDatabase().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readwrite');
        transaction.objectStore(storeName).delete('current');
        transaction.oncomplete = () => {
          db.close();
          resolve();
        };
        transaction.onerror = () => reject(transaction.error ?? new Error('缓存清理失败'));
      }),
  );
}

/** 判断是否有可恢复的缓存，不会把视频 Blob 加载到内存。 */
export async function hasWorkspaceCache(): Promise<boolean> {
  try {
    const [edit, video] = await Promise.all([
      getRecord<CachedWorkspace>(EDIT_STORE),
      getRecord<StoredVideo>(VIDEO_STORE),
    ]);
    return Boolean(edit) && Boolean(video?.blob);
  } catch {
    return false;
  }
}

/** 读取编辑状态，输入不完整时返回 null。 */
export async function loadCachedEdits(): Promise<CachedWorkspace | null> {
  const record = await getRecord<CachedWorkspace>(EDIT_STORE);
  if (
    !record ||
    typeof record.defaultStyle !== 'object' ||
    !Array.isArray(record.segments)
  ) {
    return null;
  }
  return record;
}

/** 读取上次缓存的视频 Blob。 */
export async function loadCachedVideo(): Promise<StoredVideo | null> {
  return getRecord<StoredVideo>(VIDEO_STORE);
}

/** 保存编辑状态到浏览器缓存，失败时静默降级。 */
export async function saveWorkspaceCache(data: CachedWorkspace): Promise<void> {
  try {
    await putRecord(EDIT_STORE, data);
  } catch {
    // 隐私模式或配额不足时静默降级，缓存不是核心功能。
  }
}

/** 保存原始视频 Blob，供下次会话恢复播放与导出。 */
export async function saveCachedVideo(blob: Blob, fileName: string): Promise<void> {
  try {
    await putRecord(VIDEO_STORE, { blob, fileName } satisfies StoredVideo);
  } catch {
    // 视频体超出 IndexedDB 配额时，仅保留编辑状态。
  }
}

/** 清除本地工作台缓存。 */
export async function clearWorkspaceCache(): Promise<void> {
  try {
    await Promise.all([deleteRecord(EDIT_STORE), deleteRecord(VIDEO_STORE)]);
  } catch {
    // 忽略隐私模式下的清理失败。
  }
}

/** 同步向后兼容别名：某些外部代码最早只写了 localStorage。 */
export async function removeLegacyLocalStorageCache(): Promise<void> {
  try {
    window.localStorage.removeItem(WORKSPACE_KEY);
  } catch {
    // 忽略清理失败。
  }
}
