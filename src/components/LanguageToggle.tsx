import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Check, ChevronDown, Languages } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface LanguageToggleProps {
  className?: string;
}

type SupportedLanguage = 'zh-CN' | 'en-US';

const LANGUAGE_OPTIONS: Array<{ code: SupportedLanguage; labelKey: string; compactLabel: string }> = [
  { code: 'zh-CN', labelKey: 'common.language.chinese', compactLabel: '中' },
  { code: 'en-US', labelKey: 'common.language.english', compactLabel: 'EN' },
];

/** 将 i18next 的语言代码归一化到当前支持的语言。 */
function normalizeLanguage(language: string): SupportedLanguage {
  return language.toLowerCase().startsWith('en') ? 'en-US' : 'zh-CN';
}

/**
 * 首页语言选择器。
 *
 * 使用自定义下拉列表展示所有支持的语言，并处理点击外部关闭、焦点回收和基础键盘操作。
 */
export function LanguageToggle({ className = '' }: LanguageToggleProps) {
  const { i18n, t } = useTranslation();
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const currentLanguage = normalizeLanguage(i18n.resolvedLanguage ?? i18n.language);
  const selectedIndex = Math.max(
    0,
    LANGUAGE_OPTIONS.findIndex((option) => option.code === currentLanguage),
  );
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const selectedOption = LANGUAGE_OPTIONS[selectedIndex];
  const pickerLabel = t('common.language.select');

  useEffect(() => {
    if (!open) {
      setActiveIndex(selectedIndex);
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener('pointerdown', handlePointerDown);
    optionRefs.current[activeIndex]?.focus();
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open, selectedIndex]);

  /** 切换语言并关闭下拉菜单，随后把焦点送回触发按钮。 */
  function selectLanguage(language: SupportedLanguage) {
    if (language !== currentLanguage) {
      void i18n.changeLanguage(language);
    }
    triggerRef.current?.focus();
    setOpen(false);
  }

  /** 支持方向键、Enter、Space 和 Escape 操作自定义列表。 */
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      if (!open) return;
      event.preventDefault();
      triggerRef.current?.focus();
      setOpen(false);
      return;
    }

    if (event.key === 'Tab') {
      setOpen(false);
      return;
    }

    if (!open) {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      setActiveIndex(event.key === 'ArrowUp' ? LANGUAGE_OPTIONS.length - 1 : selectedIndex);
      setOpen(true);
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const offset = event.key === 'ArrowDown' ? 1 : -1;
      const nextIndex = (activeIndex + offset + LANGUAGE_OPTIONS.length) % LANGUAGE_OPTIONS.length;
      setActiveIndex(nextIndex);
      optionRefs.current[nextIndex]?.focus();
      return;
    }

    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const nextIndex = event.key === 'Home' ? 0 : LANGUAGE_OPTIONS.length - 1;
      setActiveIndex(nextIndex);
      optionRefs.current[nextIndex]?.focus();
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectLanguage(LANGUAGE_OPTIONS[activeIndex].code);
    }
  }

  return (
    <div
      ref={rootRef}
      className={`language-picker ${className}`.trim()}
      onKeyDown={handleKeyDown}
    >
      <button
        ref={triggerRef}
        type="button"
        className="language-toggle"
        title={`${pickerLabel}: ${t(selectedOption.labelKey)}`}
        aria-label={`${pickerLabel}: ${t(selectedOption.labelKey)}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => {
          setActiveIndex(selectedIndex);
          setOpen((current) => !current);
        }}
      >
        <Languages size={15} aria-hidden="true" />
        <span className="language-toggle-value language-toggle-value-full">
          {t(selectedOption.labelKey)}
        </span>
        <span className="language-toggle-value language-toggle-value-compact" aria-hidden="true">
          {selectedOption.compactLabel}
        </span>
        <ChevronDown className="language-toggle-chevron" size={13} aria-hidden="true" />
      </button>

      {open && (
        <div id={menuId} className="language-menu" role="listbox" aria-label={pickerLabel}>
          {LANGUAGE_OPTIONS.map((option, index) => {
            const selected = option.code === currentLanguage;
            return (
              <button
                key={option.code}
                ref={(element) => {
                  optionRefs.current[index] = element;
                }}
                type="button"
                role="option"
                aria-selected={selected}
                tabIndex={-1}
                className={`language-menu-option${index === activeIndex ? ' active' : ''}`}
                onMouseEnter={() => setActiveIndex(index)}
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  event.preventDefault();
                  selectLanguage(option.code);
                }}
                onClick={() => selectLanguage(option.code)}
              >
                <span>{t(option.labelKey)}</span>
                <span className="language-menu-check" aria-hidden="true">
                  {selected && <Check size={14} />}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
