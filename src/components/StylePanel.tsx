import { DEFAULT_STYLE } from '../lib/render';
import type {
  SubtitleAlign,
  SubtitlePosition,
  SubtitleStyle,
} from '../types';

const POSITION_META: Array<{ value: SubtitlePosition; label: string }> = [
  { value: 'top', label: '顶部' },
  { value: 'middle', label: '中间' },
  { value: 'bottom', label: '底部' },
];

const ALIGN_META: Array<{ value: SubtitleAlign; label: string }> = [
  { value: 'left', label: '左对齐' },
  { value: 'center', label: '居中' },
  { value: 'right', label: '右对齐' },
];

interface SubtitleStylePreset {
  id: string;
  label: string;
  description: string;
  style: SubtitleStyle;
}

const STYLE_PRESETS: SubtitleStylePreset[] = [
  {
    id: 'classic',
    label: '经典',
    description: '黑底白字',
    style: { ...DEFAULT_STYLE },
  },
  {
    id: 'cinema',
    label: '电影',
    description: '半透明黑底',
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
    label: '简洁',
    description: '白底黑字',
    style: {
      ...DEFAULT_STYLE,
      backgroundColor: '#ffffff',
      textColor: '#111111',
      backgroundOpacity: 1,
    },
  },
  {
    id: 'highlight',
    label: '强调',
    description: '黑底黄字',
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
          <h3>字幕样式</h3>
          <p>应用于全部字幕</p>
        </div>
      </div>

      <div className="style-presets">
        <span className="field-label">预设样式</span>
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
                  字幕
                </span>
              </span>
              <span className="preset-copy">
                <strong>{preset.label}</strong>
                <span>{preset.description}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      <label className="field-row">
        <span>背景色</span>
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
        <span>文字色</span>
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
        <span>字号</span>
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
        <span>不透明度</span>
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
        label="位置"
        value={style.position}
        options={POSITION_META}
        onChange={(value) => onChange({ position: value as SubtitlePosition })}
      />
      <SegmentedControl
        label="对齐"
        value={style.align}
        options={ALIGN_META}
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
