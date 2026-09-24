import { useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2 } from 'lucide-react';
import type { SubtitleSegment } from '../types';
import { formatTimestamp, parseTimestamp } from '../lib/format';

interface SegmentListProps {
  segments: SubtitleSegment[];
  selectedId: string | null;
  currentTime: number;
  defaultDuration: number;
  onAdd: () => void;
  onSelect: (id: string) => void;
  onChangeText: (id: string, text: string) => void;
  onChangeStart: (id: string, start: number) => void;
  onChangeEnd: (id: string, end: number) => void;
  onDelete: (id: string) => void;
  onChangeDefaultDuration: (value: number) => void;
}

function parseListTime(raw: string, fallback: number): number {
  return parseTimestamp(raw) ?? fallback;
}

export function SegmentList({
  segments,
  selectedId,
  currentTime,
  defaultDuration,
  onAdd,
  onSelect,
  onChangeText,
  onChangeStart,
  onChangeEnd,
  onDelete,
  onChangeDefaultDuration,
}: SegmentListProps) {
  const { t } = useTranslation();
  const addZoneRef = useRef<HTMLButtonElement | null>(null);
  const previousCountRef = useRef(segments.length);

  useLayoutEffect(() => {
    if (segments.length > previousCountRef.current) {
      addZoneRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    previousCountRef.current = segments.length;
  }, [segments.length]);

  return (
    <div className="segment-list">
      <div className="segment-settings">
        <span>{t('segments.defaultDuration')}</span>
        <div className="segment-settings-actions">
          {selectedId && (
            <span className="selection-shortcut">
              <kbd className="shortcut-hint">Delete</kbd>
              <span>{t('segments.delete')}</span>
            </span>
          )}
          <label className="inline-setting">
            <input
              type="number"
              min="1"
              step="1"
              aria-label={t('segments.defaultDurationAria')}
              value={defaultDuration}
              onChange={(event) => onChangeDefaultDuration(Math.max(1, Math.round(Number(event.target.value) || 1)))}
            />
            <span>{t('segments.seconds')}</span>
          </label>
        </div>
      </div>
      {segments.length > 0 && (
        <div className="segment-rows">
          {segments.map((segment) => (
            <div
              key={segment.id}
              className={`segment-row${selectedId === segment.id ? ' selected' : ''}${
                currentTime >= segment.start && currentTime < segment.end ? ' active' : ''
              }`}
              onClick={() => onSelect(segment.id)}
              onFocus={() => {
                if (selectedId !== segment.id) onSelect(segment.id);
              }}
            >
              <div className="segment-row-top">
                <input
                  className="time-input start-input"
                  type="text"
                  inputMode="numeric"
                  aria-label={t('segments.startAria')}
                  value={formatTimestamp(segment.start, false)}
                  onChange={(event) => onChangeStart(segment.id, parseListTime(event.target.value, segment.start))}
                  onClick={(event) => event.stopPropagation()}
                />
                {/* <span className="time-unit">秒</span> */}
                <span className="time-separator">→</span>
                <input
                  className="time-input end-input"
                  type="text"
                  inputMode="numeric"
                  aria-label={t('segments.endAria')}
                  value={formatTimestamp(segment.end, false)}
                  onChange={(event) => onChangeEnd(segment.id, parseListTime(event.target.value, segment.end))}
                  onClick={(event) => event.stopPropagation()}
                />
                {/* <span className="time-unit">秒</span> */}
              </div>
              <textarea
                className="text-input"
                rows={2}
                aria-label={t('segments.textAria')}
                value={segment.text}
                placeholder={t('segments.placeholder')}
                onChange={(event) => onChangeText(segment.id, event.target.value)}
                onClick={(event) => event.stopPropagation()}
              />
              <div className="row-actions">
                <button
                  type="button"
                  className="mini-button danger"
                  onClick={(event) => {
                    event.stopPropagation();
                    onDelete(segment.id);
                  }}
                  title={t('segments.deleteTitle')}
                  aria-label={t('segments.delete')}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <button
        ref={addZoneRef}
        type="button"
        className="segment-add-zone"
        onClick={onAdd}
        title={t('segments.addTitle')}
      >
        <span className="segment-add-icon"><Plus size={17} /></span>
        <span>{segments.length === 0 ? t('segments.addFirst') : t('segments.add')}</span>
        <kbd className="shortcut-hint segment-add-shortcut">⌘/Ctrl + Enter</kbd>
      </button>
    </div>
  );
}
