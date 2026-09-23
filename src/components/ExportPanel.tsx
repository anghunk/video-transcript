import { Clapperboard, Download } from 'lucide-react';
import type { ExportQuality } from '../types';

const QUALITY_META: Array<{ value: ExportQuality; label: string; hint: string }> = [
  { value: 'native', label: '接近原画', hint: '保持原始分辨率' },
  { value: 'high', label: '高画质', hint: '限制在 4K' },
  { value: 'standard', label: '标准', hint: '限制在 1080p' },
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
  const qualityHint = QUALITY_META.find((item) => item.value === quality)?.hint ?? '';
  return (
    <div className="edit-block export-block">
      <div className="block-heading">
        <div>
          <h3>导出</h3>
          <p>{qualityHint}</p>
        </div>
        <Clapperboard size={18} />
      </div>

      <label className="field-row select-row">
        <span>画质</span>
        <select value={quality} onChange={(event) => onQualityChange(event.target.value as ExportQuality)}>
          {QUALITY_META.map((item) => (
            <option key={item.value} value={item.value}>{item.label}</option>
          ))}
        </select>
      </label>

      <label className="check-row">
        <input
          type="checkbox"
          checked={includeAudio}
          onChange={(event) => onIncludeAudioChange(event.target.checked)}
        />
        <span>保留原音轨（AAC 将直接封装）</span>
      </label>

      {exporting ? (
        <div className="export-progress">
          <div className="progress-track"><span style={{ width: `${Math.round(progress * 100)}%` }} /></div>
          <div className="progress-copy">
            <span>{phase}</span>
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
          导出 MP4
        </button>
      )}

      {error && <div className="error-line" role="alert">{error}</div>}
    </div>
  );
}
