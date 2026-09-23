import { useState, type DragEvent as ReactDragEvent } from 'react';
import {
  FileVideo,
  Github,
  LoaderCircle,
  Moon,
  RotateCcw,
  ShieldCheck,
  Sun,
  Trash2,
  Upload,
} from 'lucide-react';
import logoUrl from '../../public/logo.png';
import workspacePreviewUrl from '../../docs/workspace.png';
import type { CacheOffer, ThemeMode } from '../types';
import { ParticleField } from './ParticleField';

interface UploadScreenProps {
  loading: boolean;
  error: string;
  cacheOffer: CacheOffer | null;
  restoring: boolean;
  theme: ThemeMode;
  onToggleTheme: () => void;
  onSelect: () => void;
  onRestore: () => void;
  onDiscard: () => void;
  onDrop: (event: ReactDragEvent<HTMLDivElement>) => void;
}

/**
 * 首页落地页。
 *
 * 首屏保持极简，只承担品牌和主要操作；完整的拖拽上传与产品预览放在第二屏，
 * 避免功能介绍打断用户进入工作台的路径。
 */
export function UploadScreen({
  loading,
  error,
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
  const busy = loading || restoring;

  return (
    <div className="upload-screen">
      <ParticleField theme={theme} />

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
                <Trash2 size={15} /> 丢弃
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

      <header className="landing-nav">
        <a className="landing-brand" href="/" aria-label="返回字幕工作室首页">
          <span className="landing-logo">
            <img src={logoUrl} alt="" />
          </span>
          <span className="landing-brand-copy">
            <strong>字幕工作室</strong>
            <small>VIDEO TRANSCRIPT</small>
          </span>
        </a>

        <div className="landing-nav-actions">
          <a
            className="landing-github"
            href="https://github.com/anghunk/video-transcript"
            target="_blank"
            rel="noreferrer"
            aria-label="打开 GitHub 项目"
          >
            <Github size={17} />
            <span>GitHub</span>
          </a>
          <button
            type="button"
            className="theme-toggle landing-theme-toggle"
            onClick={onToggleTheme}
            title={theme === 'dark' ? '切换日间模式' : '切换黑夜模式'}
            aria-label={theme === 'dark' ? '切换日间模式' : '切换黑夜模式'}
          >
            {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
          </button>
        </div>
      </header>

      <main>
        <section className="landing-hero">
          <div className="landing-hero-inner">
            <span className="landing-hero-kicker">
              <span className="landing-hero-dot" />
              本地视频字幕工具
            </span>
            <h1>视频加字幕，<span>简单一点。</span></h1>
            <p>导入视频，编辑字幕，导出成片。视频始终留在当前设备。</p>

            <div className="landing-hero-actions">
              <button
                type="button"
                className="primary-button landing-hero-button"
                disabled={busy}
                onClick={onSelect}
              >
                {busy ? <LoaderCircle className="spin" size={18} /> : <Upload size={18} />}
                <span>{loading ? '正在解析视频' : restoring ? '正在恢复项目' : '选择视频'}</span>
              </button>
              <span className="landing-hero-note">MP4 · 无需上传 · 无需安装</span>
            </div>

            {error && <div className="error-line upload-error landing-error" role="alert">{error}</div>}
          </div>
          <span className="landing-scroll-line" aria-hidden="true" />
        </section>

        <section className="landing-upload-section" id="upload">
          <div className="landing-section-heading">
            <h2>从一个视频开始</h2>
            <p>拖入文件后，所有编辑都在浏览器里完成。</p>
          </div>

          <div
            className={`upload-zone${dragActive ? ' dragover' : ''}`}
            role="button"
            tabIndex={busy ? -1 : 0}
            aria-disabled={busy}
            aria-label="选择或拖入本地 MP4 视频"
            onClick={() => {
              if (!busy) onSelect();
            }}
            onKeyDown={(event) => {
              if (busy || (event.key !== 'Enter' && event.key !== ' ')) return;
              event.preventDefault();
              onSelect();
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
            <span className="upload-icon">
              <FileVideo size={29} strokeWidth={1.5} />
            </span>
            <span className="upload-zone-copy">
              <strong>{loading ? '正在读取视频' : '把 MP4 拖到这里'}</strong>
              <span>{loading ? '正在解析轨道与画面信息，请稍候' : '或点击选择本地文件'}</span>
            </span>
            <span className="upload-zone-action">
              <Upload size={14} />
              选择文件
            </span>
            <span className="upload-zone-corner">LOCAL ONLY</span>
          </div>

          <div className="upload-trust">
            <span><ShieldCheck size={14} /> 本地处理</span>
            <span>原分辨率导出</span>
            <span>无水印</span>
          </div>

          <div className="landing-preview" aria-label="字幕工作室界面预览">
            <div className="product-frame">
              <div className="product-frame-bar">
                <span className="product-frame-dots" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                <span className="product-frame-title">字幕工作室 · 工作台</span>
                <span className="product-frame-state">LOCAL</span>
              </div>
              <img
                src={workspacePreviewUrl}
                alt="字幕工作室工作台，包含视频预览、字幕时间轴和右侧编辑面板"
              />
            </div>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <span>字幕工作室</span>
        <span>视频不会离开你的设备</span>
      </footer>
    </div>
  );
}
