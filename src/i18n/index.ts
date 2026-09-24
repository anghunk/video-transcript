import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';
import { resources } from './resources';

export const LANGUAGE_STORAGE_KEY = 'video-transcript-language';

/** 将语言代码归一化到当前支持的语言，其他语言统一使用中文。 */
function normalizeLanguage(language: string): 'zh-CN' | 'en-US' {
  const normalized = language.toLowerCase();
  if (normalized.startsWith('en')) return 'en-US';
  return 'zh-CN';
}

/**
 * 读取 URL 中的 lang 参数并立即从地址栏移除。
 *
 * `en` 等英文代码映射到英文，`zh` 等中文代码映射到中文；空值不覆盖自动检测结果。
 */
function readAndClearUrlLanguage(): 'zh-CN' | 'en-US' | null {
  if (typeof window === 'undefined') return null;

  const url = new URL(window.location.href);
  const language = url.searchParams.get('lang')?.trim();
  if (language === undefined) return null;

  url.searchParams.delete('lang');
  window.history.replaceState(
    window.history.state,
    '',
    `${url.pathname}${url.search}${url.hash}`,
  );
  return language ? normalizeLanguage(language) : null;
}

function syncDocumentLanguage(language: string): void {
  if (typeof document === 'undefined') return;
  const resolved = normalizeLanguage(language);
  document.documentElement.lang = resolved;
  document.title = i18n.t('meta.title');
  document
    .querySelector<HTMLMetaElement>('meta[name="description"]')
    ?.setAttribute('content', i18n.t('meta.description'));
}

const urlLanguage = readAndClearUrlLanguage();

if (urlLanguage) {
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, urlLanguage);
  } catch {
    // 隐私模式下仍由本次初始化的 lng 参数生效。
  }
}

i18n.on('languageChanged', syncDocumentLanguage);

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    supportedLngs: ['zh-CN', 'en-US'],
    fallbackLng: 'zh-CN',
    load: 'currentOnly',
    initAsync: false,
    lng: urlLanguage ?? undefined,
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: LANGUAGE_STORAGE_KEY,
      convertDetectedLanguage: normalizeLanguage,
    },
  });

syncDocumentLanguage(i18n.resolvedLanguage ?? i18n.language);

export default i18n;
