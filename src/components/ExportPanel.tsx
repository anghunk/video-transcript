import { Clapperboard, Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ExportQuality } from '../types';

const QUALITY_META: Array<{ value: ExportQuality; labelKey: string; hintKey: string }> = [
  { value: 'native', labelKey: 'export.qualities.native.label', hintKey: 'export.qualities.native.hint' },
  { value: 'high', labelKey: 'export.qualities.high.label', hintKey: 'export.qualities.high.hint' },
  { value: 'standard', labelKey: 'export.qualities.standard.label', hintKey: 'export.qualities.standard.hint' },
];

interface ExportPanelProps {
  quality: ExportQuality;
  includeAudio: boolean;
  exporting: boolean;
  progress: number;
  phase: string;
  segmentsCount: number;
  error: string;
  onQualityChange: (value: ExportQuality) => void;
  onIncludeAudioChange: (value: boolean) => void;
  onExport: () => void;
}

export function ExportPanel({
  quality,
  includeAudio,
  exporting,
  progress,
  phase,
  segmentsCount,
  error,
  onQualityChange,
  onIncludeAudioChange,
  onExport,
}: ExportPanelProps) {
  const { t } = useTranslation();
  const qualityHintKey = QUALITY_META.find((item) => item.value === quality)?.hintKey;
  const qualityHint = qualityHintKey ? t(qualityHintKey) : '';
  return (
    <div className="edit-block export-block">
      <div className="block-heading">
        <div>
          <h3>{t('export.title')}</h3>
          <p>{qualityHint}</p>
        </div>
        <Clapperboard size={18} />
      </div>

      <label className="field-row select-row">
        <span>{t('export.quality')}</span>
        <select value={quality} onChange={(event) => onQualityChange(event.target.value as ExportQuality)}>
          {QUALITY_META.map((item) => (
            <option key={item.value} value={item.value}>{t(item.labelKey)}</option>
          ))}
        </select>
      </label>

      <label className="check-row">
        <input
          type="checkbox"
          checked={includeAudio}
          onChange={(event) => onIncludeAudioChange(event.target.checked)}
        />
        <span>{t('export.keepAudio')}</span>
      </label>

      {exporting ? (
        <div className="export-progress">
          <div className="progress-track"><span style={{ width: `${Math.round(progress * 100)}%` }} /></div>
          <div className="progress-copy">
            <span>{phase ? t(phase) : ''}</span>
            <span className="mono-chip">{Math.round(progress * 100)}%</span>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="primary-button export-button"
          onClick={onExport}
          disabled={segmentsCount === 0}
        >
          <Download size={17} />
          {t('export.button')}
        </button>
      )}

      {error && <div className="error-line" role="alert">{error}</div>}
    </div>
  );
}
