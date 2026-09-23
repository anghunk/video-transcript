import { useState, type DragEvent as ReactDragEvent } from 'react';
import {
  BadgeCheck,
  CloudOff,
  FileVideo,
  Github,
  LoaderCircle,
  MonitorUp,
  Moon,
  RotateCcw,
  ShieldCheck,
  Sun,
  Trash2,
  Upload,
} from 'lucide-react';
import logoUrl from '../../logo.png';
import type { CacheOffer, ThemeMode } from '../types';

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
  onDrop: (event: ReactDragEvent<HTMLDivElement>) => void;
}

export function UploadScreen({
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
      <a
        className="theme-toggle upload-github-link"
        href="https://github.com/anghunk/video-transcript"
        target="_blank"
        rel="noreferrer"
        title="查看 GitHub 仓库"
        aria-label="查看 GitHub 仓库"
      >
        <Github size={17} />
      </a>
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
