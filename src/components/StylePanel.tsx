import { useTranslation } from 'react-i18next';
import { DEFAULT_STYLE } from '../lib/render';
import type {
  SubtitleAlign,
  SubtitlePosition,
  SubtitleStyle,
} from '../types';

const POSITION_META: Array<{ value: SubtitlePosition; labelKey: string }> = [
  { value: 'top', labelKey: 'style.positions.top' },
  { value: 'middle', labelKey: 'style.positions.middle' },
  { value: 'bottom', labelKey: 'style.positions.bottom' },
];

const ALIGN_META: Array<{ value: SubtitleAlign; labelKey: string }> = [
  { value: 'left', labelKey: 'style.alignments.left' },
  { value: 'center', labelKey: 'style.alignments.center' },
  { value: 'right', labelKey: 'style.alignments.right' },
];

interface SubtitleStylePreset {
  id: string;
  labelKey: string;
  descriptionKey: string;
  style: SubtitleStyle;
}

const STYLE_PRESETS: SubtitleStylePreset[] = [
  {
    id: 'classic',
    labelKey: 'style.presets.classic.label',
    descriptionKey: 'style.presets.classic.description',
    style: { ...DEFAULT_STYLE },
  },
  {
    id: 'cinema',
    labelKey: 'style.presets.cinema.label',
    descriptionKey: 'style.presets.cinema.description',
    style: {
      ...DEFAULT_STYLE,
      backgroundColor: '#000000',
      textColor: '#ffffff',
      fontSize: 30,
      backgroundOpacity: 0.7,
    },
  },
  {
    id: 'light',
    labelKey: 'style.presets.light.label',
    descriptionKey: 'style.presets.light.description',
    style: {
      ...DEFAULT_STYLE,
      backgroundColor: '#ffffff',
      textColor: '#111111',
      backgroundOpacity: 1,
    },
  },
  {
    id: 'highlight',
    labelKey: 'style.presets.highlight.label',
    descriptionKey: 'style.presets.highlight.description',
    style: {
      ...DEFAULT_STYLE,
      backgroundColor: '#000000',
      textColor: '#ffd400',
      fontSize: 32,
      backgroundOpacity: 1,
    },
  },
];

interface StylePanelProps {
  defaultStyle: SubtitleStyle;
  onChange: (patch: Partial<SubtitleStyle>) => void;
}

export function StylePanel({
  defaultStyle,
  onChange,
}: StylePanelProps) {
  const { t } = useTranslation();
  const style = { ...DEFAULT_STYLE, ...defaultStyle };
  const activePresetId = STYLE_PRESETS.find((preset) =>
    Object.entries(preset.style).every(
      ([key, value]) => style[key as keyof SubtitleStyle] === value,
    ),
  )?.id;

  return (
    <div className="edit-block">
      <div className="block-heading">
        <div>
          <h3>{t('style.title')}</h3>
          <p>{t('style.description')}</p>
        </div>
      </div>

      <div className="style-presets">
        <span className="field-label">{t('style.presetLabel')}</span>
        <div className="preset-grid">
          {STYLE_PRESETS.map((preset) => (
            <button
              type="button"
              key={preset.id}
              className={`preset-button${activePresetId === preset.id ? ' active' : ''}`}
              aria-pressed={activePresetId === preset.id}
              onClick={() => onChange(preset.style)}
            >
              <span className="preset-preview" aria-hidden="true">
                <span
                  className="preset-preview-bg"
                  style={{
                    backgroundColor: preset.style.backgroundColor,
                    opacity: preset.style.backgroundOpacity,
                  }}
                />
                <span
                  className="preset-preview-text"
                  style={{ color: preset.style.textColor }}
                >
                  {t('style.subtitlePreview')}
                </span>
              </span>
              <span className="preset-copy">
                <strong>{t(preset.labelKey)}</strong>
                <span>{t(preset.descriptionKey)}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      <label className="field-row">
        <span>{t('style.backgroundColor')}</span>
        <span className="color-field">
          <input
            type="color"
            value={style.backgroundColor}
            onChange={(event) => onChange({ backgroundColor: event.target.value })}
          />
          <span className="mono-chip">{style.backgroundColor}</span>
        </span>
      </label>
      <label className="field-row">
        <span>{t('style.textColor')}</span>
        <span className="color-field">
          <input
            type="color"
            value={style.textColor}
            onChange={(event) => onChange({ textColor: event.target.value })}
          />
          <span className="mono-chip">{style.textColor}</span>
        </span>
      </label>
      <label className="field-row">
        <span>{t('style.fontSize')}</span>
        <input
          className="range-input"
          type="range"
          min="18"
          max="96"
          step="1"
          value={style.fontSize}
          onChange={(event) => onChange({ fontSize: Number(event.target.value) })}
        />
        <span className="mono-chip">{style.fontSize}px</span>
      </label>
      <div className="field-row">
        <span>{t('style.opacity')}</span>
        <input
          className="range-input"
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={style.backgroundOpacity}
          onChange={(event) => onChange({ backgroundOpacity: Number(event.target.value) })}
        />
        <span className="mono-chip">{Math.round(style.backgroundOpacity * 100)}%</span>
      </div>

      <SegmentedControl
        label={t('style.position')}
        value={style.position}
        options={POSITION_META.map((item) => ({ value: item.value, label: t(item.labelKey) }))}
        onChange={(value) => onChange({ position: value as SubtitlePosition })}
      />
      <SegmentedControl
        label={t('style.align')}
        value={style.align}
        options={ALIGN_META.map((item) => ({ value: item.value, label: t(item.labelKey) }))}
        onChange={(value) => onChange({ align: value as SubtitleAlign })}
      />
    </div>
  );
}

interface SegmentedControlProps<T extends string> {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}

function SegmentedControl<T extends string>({ label, value, options, onChange }: SegmentedControlProps<T>) {
  return (
    <div className="field-block">
      <span className="field-label">{label}</span>
      <div className="segmented">
        {options.map((option) => (
          <button
            type="button"
            key={option.value}
            className={value === option.value ? 'active' : ''}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
