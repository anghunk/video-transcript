import { useRef, useState, type DragEvent as ReactDragEvent, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Check,
  FileVideo,
  FolderOpen,
  HardDrive,
  LoaderCircle,
  Moon,
  Pencil,
  Plus,
  Search,
  Sun,
  Trash2,
  Upload,
  VideoOff,
  X,
} from 'lucide-react';
import logoUrl from '../../public/logo.webp';
import { formatBytes, formatClock } from '../lib/format';
import type { ProjectSummary, StorageEstimate } from '../lib/storage';
import type { ThemeMode } from '../types';
import { ConfirmDialog } from './ConfirmDialog';
import { LanguageToggle } from './LanguageToggle';

interface ProjectsScreenProps {
  projects: ProjectSummary[];
  loading: boolean;
  error: string;
  storageEstimate: StorageEstimate | null;
  theme: ThemeMode;
  onToggleTheme: () => void;
  onBackHome: () => void;
  onCreate: () => void;
  onOpen: (projectId: string) => void;
  onRelink: (projectId: string) => void;
  onRename: (projectId: string, name: string) => Promise<void>;
  onDelete: (projectId: string) => Promise<void>;
  onDropFile: (file: File) => void;
}

function formatUpdatedAt(timestamp: number, locale: string): string {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return '';
  return date.toLocaleString(locale, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * 项目管理页。
 *
 * 负责创建、查找、打开、重命名和删除本地项目，不加载视频 Blob，
 * 因此项目数量增加时也不会因为读取视频内容而一次性占用大量内存。
 */
export function ProjectsScreen({
  projects,
  loading,
  error,
  storageEstimate,
  theme,
  onToggleTheme,
  onBackHome,
  onCreate,
  onOpen,
  onRelink,
  onRename,
  onDelete,
  onDropFile,
}: ProjectsScreenProps) {
  const { t, i18n } = useTranslation();
  const [query, setQuery] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ProjectSummary | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleProjects = normalizedQuery
    ? projects.filter((project) =>
        `${project.name} ${project.videoFileName}`
          .toLocaleLowerCase()
          .includes(normalizedQuery),
      )
    : projects;
  const locale = i18n.resolvedLanguage === 'en-US' ? 'en-US' : 'zh-CN';

  function beginRename(project: ProjectSummary) {
    setRenamingId(project.id);
    setRenameValue(project.name);
    window.setTimeout(() => renameInputRef.current?.select(), 0);
  }

  async function submitRename(event: FormEvent) {
    event.preventDefault();
    if (!renamingId || !renameValue.trim()) return;
    setBusyId(renamingId);
    try {
      await onRename(renamingId, renameValue.trim());
      setRenamingId(null);
    } finally {
      setBusyId(null);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setBusyId(pendingDelete.id);
    try {
      await onDelete(pendingDelete.id);
      setPendingDelete(null);
    } finally {
      setBusyId(null);
    }
  }

  function handleDrop(event: ReactDragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(false);
    const file = event.dataTransfer.files?.[0];
    if (file) onDropFile(file);
  }

  return (
    <div className="projects-screen">
      <header className="projects-header">
        <button
          type="button"
          className="projects-brand"
          onClick={onBackHome}
          aria-label={t('landing.homeLabel')}
        >
          <span className="projects-brand-logo">
            <img src={logoUrl} alt="" />
          </span>
          <span className="projects-brand-copy">
            <strong>{t('common.brandName')}</strong>
            <small>VIDEO TRANSCRIPT</small>
          </span>
        </button>

        <div className="projects-header-actions">
          <LanguageToggle />
          <button
            type="button"
            className="theme-toggle"
            onClick={onToggleTheme}
            title={theme === 'dark'
              ? t('common.theme.switchToLight')
              : t('common.theme.switchToDark')}
            aria-label={theme === 'dark'
              ? t('common.theme.switchToLight')
              : t('common.theme.switchToDark')}
          >
            {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
          </button>
        </div>
      </header>

      <main className="projects-main">
        {projects.length > 0 && (
          <section className="projects-toolbar" aria-label={t('projects.toolsLabel')}>
            <div className="projects-search">
              <Search size={16} />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('projects.searchPlaceholder')}
                aria-label={t('projects.searchPlaceholder')}
              />
            </div>
            <div className="projects-toolbar-actions">
              <div className="projects-storage" title={t('projects.storageTitle')}>
                <span className="projects-storage-icon"><HardDrive size={16} /></span>
                <div className="projects-storage-copy">
                  <span>
                    {storageEstimate
                      ? t('projects.storageUsage', {
                          used: formatBytes(storageEstimate.usage),
                        })
                      : t('projects.storageReading')}
                  </span>
                </div>
                {storageEstimate?.persisted && (
                  <span className="projects-persist-state active">
                    {t('projects.persisted')}
                  </span>
                )}
              </div>
              <button
                type="button"
                className="primary-button compact projects-create-button"
                onClick={onCreate}
              >
                <Plus size={15} />
                {t('projects.newProject')}
              </button>
            </div>
          </section>
        )}

        {error && <div className="error-line projects-error" role="alert">{error}</div>}

        {loading ? (
          <div className="projects-loading" role="status" aria-live="polite">
            <LoaderCircle className="spin" size={24} />
            <span>{t('projects.loading')}</span>
          </div>
        ) : visibleProjects.length > 0 ? (
          <section className="projects-grid" aria-label={t('projects.listLabel')}>
            {visibleProjects.map((project) => {
              const isBusy = busyId === project.id;
              const isRenaming = renamingId === project.id;
              return (
                <article
                  key={project.id}
                  className={`project-card${project.hasVideo ? '' : ' missing-video'}`}
                >
                  <button
                    type="button"
                    className="project-card-preview"
                    onClick={() => (project.hasVideo ? onOpen(project.id) : onRelink(project.id))}
                    disabled={isBusy}
                    aria-label={project.hasVideo
                      ? t('projects.openProject', { name: project.name })
                      : t('projects.relinkProject', { name: project.name })}
                  >
                    {project.hasVideo && project.thumbnail ? (
                      <img
                        className="project-card-thumbnail"
                        src={project.thumbnail}
                        alt=""
                      />
                    ) : (
                      <span className="project-card-video-icon">
                        {project.hasVideo ? <FileVideo size={28} /> : <VideoOff size={28} />}
                      </span>
                    )}
                    <span className="project-card-duration">
                      {project.videoDuration > 0 ? formatClock(project.videoDuration) : '--:--:--'}
                    </span>
                    <span className="project-card-badge">
                      {project.hasVideo ? t('projects.videoCached') : t('projects.videoMissing')}
                    </span>
                  </button>

                  <div className="project-card-body">
                    {isRenaming ? (
                      <form className="project-rename-form" onSubmit={(event) => void submitRename(event)}>
                        <input
                          ref={renameInputRef}
                          value={renameValue}
                          onChange={(event) => setRenameValue(event.target.value)}
                          maxLength={80}
                          aria-label={t('projects.renameLabel')}
                          onKeyDown={(event) => {
                            if (event.key === 'Escape') setRenamingId(null);
                          }}
                        />
                        <button
                          type="submit"
                          className="project-icon-button"
                          title={t('projects.saveName')}
                          aria-label={t('projects.saveName')}
                          disabled={isBusy || !renameValue.trim()}
                        >
                          <Check size={15} />
                        </button>
                        <button
                          type="button"
                          className="project-icon-button"
                          title={t('common.close')}
                          aria-label={t('common.close')}
                          onClick={() => setRenamingId(null)}
                        >
                          <X size={15} />
                        </button>
                      </form>
                    ) : (
                      <div className="project-card-title-row">
                        <h2 title={project.name}>{project.name}</h2>
                        <div className="project-card-actions">
                          <button
                            type="button"
                            className="project-icon-button"
                            title={t('projects.rename')}
                            aria-label={t('projects.rename')}
                            onClick={() => beginRename(project)}
                            disabled={isBusy}
                          >
                            <Pencil size={15} />
                          </button>
                          <button
                            type="button"
                            className="project-icon-button danger"
                            title={t('projects.delete')}
                            aria-label={t('projects.delete')}
                            onClick={() => setPendingDelete(project)}
                            disabled={isBusy}
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </div>
                    )}

                    <span className="project-file-name" title={project.videoFileName}>
                      {project.videoFileName}
                    </span>
                    <div className="project-card-meta">
                      <span>{t('projects.segmentCount', { count: project.segmentCount })}</span>
                      {project.videoSize > 0 && <span>{formatBytes(project.videoSize)}</span>}
                      {project.videoWidth > 0 && project.videoHeight > 0 && (
                        <span>{project.videoWidth}×{project.videoHeight}</span>
                      )}
                    </div>
                    <span className="project-updated-at">
                      {t('projects.updatedAt', {
                        time: formatUpdatedAt(project.updatedAt, locale),
                      })}
                    </span>
                  </div>
                </article>
              );
            })}
          </section>
        ) : projects.length > 0 ? (
          <div className="projects-empty-search">
            <Search size={24} />
            <strong>{t('projects.noSearchResult')}</strong>
            <span>{t('projects.noSearchResultHint')}</span>
          </div>
        ) : (
          <section className="projects-empty">
            <div className="projects-empty-icon"><FolderOpen size={29} /></div>
            <h2>{t('projects.emptyTitle')}</h2>
            <p>{t('projects.emptyDescription')}</p>
            <div
              className={`projects-drop-zone${dragActive ? ' dragover' : ''}`}
              role="button"
              tabIndex={0}
              onClick={onCreate}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onCreate();
                }
              }}
              onDragEnter={(event) => {
                event.preventDefault();
                setDragActive(true);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={(event) => {
                if (event.currentTarget === event.target) setDragActive(false);
              }}
              onDrop={handleDrop}
            >
              <Upload size={19} />
              <span>
                <strong>{t('projects.dropTitle')}</strong>
                <small>{t('projects.dropHint')}</small>
              </span>
            </div>
          </section>
        )}
      </main>

      {pendingDelete && (
        <ConfirmDialog
          title={t('projects.deleteTitle')}
          description={t('projects.deleteDescription', { name: pendingDelete.name })}
          confirmLabel={t('projects.delete')}
          cancelLabel={t('common.cancel')}
          confirmVariant="danger"
          busy={busyId === pendingDelete.id}
          onConfirm={() => void confirmDelete()}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
