import { useRef, useState, type DragEvent as ReactDragEvent } from 'react';
import { useTranslation } from 'react-i18next';
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
import logoUrl from '../../public/logo.webp';
import workspacePreviewUrl from '../../docs/workspace.png';
import type { CacheOffer, ThemeMode } from '../types';
import { LanguageToggle } from './LanguageToggle';
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
  const { t } = useTranslation();
  const [dragActive, setDragActive] = useState(false);
  const screenRef = useRef<HTMLDivElement>(null);
  const busy = loading || restoring;
  const themeToggleLabel = theme === 'dark'
    ? t('common.theme.switchToLight')
    : t('common.theme.switchToDark');

  return (
    <div
      ref={screenRef}
      className="upload-screen"
      onPointerMove={(event) => {
        if (event.pointerType !== 'mouse') return;
        const screen = screenRef.current;
        if (!screen) return;
        screen.style.setProperty('--grid-focus-x', `${event.clientX}px`);
        screen.style.setProperty('--grid-focus-y', `${event.clientY}px`);
        screen.style.setProperty('--grid-focus-opacity', '1');
      }}
      onPointerLeave={() => {
        screenRef.current?.style.setProperty('--grid-focus-opacity', '0');
      }}
    >
      <div className="grid-cursor-focus" aria-hidden="true" />
      <ParticleField theme={theme} />

      {cacheOffer && (
        <div className="cache-banner" role="status" aria-live="polite">
          <div className="cache-banner-inner">
            <div className="cache-banner-status">
              <span className="cache-banner-icon"><FileVideo size={17} /></span>
              <div className="cache-banner-copy">
                <strong>{t('landing.cacheFound')}</strong>
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
                <Trash2 size={15} /> {t('landing.discard')}
              </button>
              <button
                type="button"
                className="primary-button cache-banner-button"
                onClick={onRestore}
                disabled={restoring}
              >
                {restoring ? <LoaderCircle className="spin" size={15} /> : <RotateCcw size={15} />}
                {restoring ? t('landing.restoring') : t('landing.continueEditing')}
              </button>
            </div>
          </div>
        </div>
      )}

      <header className="landing-nav">
        <a className="landing-brand" href="/" aria-label={t('landing.homeLabel')}>
          <span className="landing-logo">
            <img src={logoUrl} alt="" />
          </span>
          <span className="landing-brand-copy">
            <strong>{t('common.brandName')}</strong>
            <small>VIDEO TRANSCRIPT</small>
          </span>
        </a>

        <div className="landing-nav-actions">
          <a
            className="landing-github"
            href="https://github.com/anghunk/video-transcript"
            target="_blank"
            rel="noreferrer"
            aria-label={t('landing.githubLabel')}
          >
            <Github size={17} />
            <span>GitHub</span>
          </a>
          <LanguageToggle />
          <button
            type="button"
            className="theme-toggle landing-theme-toggle"
            onClick={onToggleTheme}
            title={themeToggleLabel}
            aria-label={themeToggleLabel}
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
              {t('landing.kicker')}
            </span>
            <h1>{t('landing.titlePrefix')}<span>{t('landing.titleAccent')}</span></h1>
            <p>{t('landing.description')}</p>

            <div className="landing-hero-actions">
              <button
                type="button"
                className="primary-button landing-hero-button"
                disabled={busy}
                onClick={onSelect}
              >
                {busy ? <LoaderCircle className="spin" size={18} /> : <Upload size={18} />}
                <span>
                  {loading
                    ? t('landing.parsingVideo')
                    : restoring
                      ? t('landing.restoringProject')
                      : t('landing.chooseVideo')}
                </span>
              </button>
              <span className="landing-hero-note">{t('landing.featureNote')}</span>
            </div>

            {error && <div className="error-line upload-error landing-error" role="alert">{error}</div>}
          </div>
          <span className="landing-scroll-line" aria-hidden="true" />
        </section>

        <section className="landing-upload-section" id="upload">
          <div className="landing-section-heading">
            <h2>{t('landing.startTitle')}</h2>
            <p>{t('landing.startDescription')}</p>
          </div>

          <div
            className={`upload-zone${dragActive ? ' dragover' : ''}`}
            role="button"
            tabIndex={busy ? -1 : 0}
            aria-disabled={busy}
            aria-label={t('landing.uploadAria')}
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
              <strong>{loading ? t('landing.readingVideo') : t('landing.dropHere')}</strong>
              <span>{loading ? t('landing.parsingDetails') : t('landing.clickChoose')}</span>
            </span>
            <span className="upload-zone-action">
              <Upload size={14} />
              {t('landing.chooseFile')}
            </span>
            <span className="upload-zone-corner">LOCAL ONLY</span>
          </div>

          <div className="upload-trust">
            <span><ShieldCheck size={14} /> {t('landing.trustLocal')}</span>
            <span>{t('landing.trustResolution')}</span>
            <span>{t('landing.trustWatermark')}</span>
          </div>

          <div className="landing-preview" aria-label={t('landing.previewAria')}>
            <div className="product-frame">
              <div className="product-frame-bar">
                <span className="product-frame-dots" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                <span className="product-frame-title">{t('landing.frameTitle')}</span>
                <span className="product-frame-state">LOCAL</span>
              </div>
              <img
                src={workspacePreviewUrl}
                alt={t('landing.previewAlt')}
              />
            </div>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <span>{t('common.brandName')}</span>
        <span>{t('landing.footerPrivacy')}</span>
      </footer>
    </div>
  );
}
