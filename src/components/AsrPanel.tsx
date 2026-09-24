import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleStop, LoaderCircle, Sparkles } from 'lucide-react';
import type { SubtitleSegment } from '../types';
import type { SourceMediaRuntime } from '../lib/media';
import {
  ASR_LANGUAGES,
  ASR_MODELS,
  DEFAULT_ASR_MODEL_ID,
  hasCachedModel,
  isWebGpuAvailable,
  requestPersistentStorage,
  runAsr,
  type AsrDevice,
  type AsrLanguage,
  type AsrModelId,
  type AsrProgress,
} from '../lib/asr';

interface AsrPanelProps {
  media: SourceMediaRuntime;
  /** 当前已有字幕段数量，用于决定应用方式与提示文案。 */
  existingCount: number;
  /** 导出等占用资源的过程中禁止启动识别。 */
  disabled: boolean;
  onApply: (segments: SubtitleSegment[], mode: 'replace' | 'append') => void;
}

interface AsrOutcome {
  segments: SubtitleSegment[];
  elapsedMs: number;
}

export function AsrPanel({ media, existingCount, disabled, onApply }: AsrPanelProps) {
  const { t } = useTranslation();
  const webGpuAvailable = isWebGpuAvailable();
  const [modelId, setModelId] = useState<AsrModelId>(DEFAULT_ASR_MODEL_ID);
  const [device, setDevice] = useState<AsrDevice>(webGpuAvailable ? 'webgpu' : 'wasm');
  const [language, setLanguage] = useState<AsrLanguage>('chinese');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<AsrProgress | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [cached, setCached] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [outcome, setOutcome] = useState<AsrOutcome | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const model = ASR_MODELS.find((item) => item.id === modelId) ?? ASR_MODELS[1];
  const modelSize = model.sizeMB[device];

  function formatSeconds(milliseconds: number): string {
    const seconds = Math.round(milliseconds / 1000);
    if (seconds < 60) return t('asr.seconds', { count: seconds });
    return t('asr.minutesSeconds', {
      minutes: Math.floor(seconds / 60),
      seconds: seconds % 60,
    });
  }

  useEffect(() => {
    let cancelled = false;
    setCached(false);
    void hasCachedModel(model.repoId).then((value) => {
      if (!cancelled) setCached(value);
    });
    return () => {
      cancelled = true;
    };
  }, [model.repoId]);

  useEffect(() => {
    return () => controllerRef.current?.abort();
  }, []);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      setElapsedMs((current) => current + 1000);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  function handleCancel() {
    controllerRef.current?.abort();
  }

  async function handleStart() {
    if (running || disabled) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setRunning(true);
    setElapsedMs(0);
    setError('');
    setNotice('');
    setOutcome(null);
    setProgress({
      phase: 'decode',
      ratio: null,
      message: { key: 'asr.progress.extracting' },
    });
    // 借用户点击这次交互申请持久化存储，避免下载好的模型被浏览器自动清理。
    void requestPersistentStorage();

    try {
      const result = await runAsr({
        media,
        modelId,
        device,
        language,
        signal: controller.signal,
        onProgress: setProgress,
        onNotice: setNotice,
      });
      if (result.segments.length === 0) {
        setNotice(t('asr.noSpeech'));
      } else {
        setOutcome(result);
        setCached(true);
      }
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') {
        setNotice(t('asr.cancelled'));
      } else {
        setError(caught instanceof Error ? caught.message : t('asr.failed'));
      }
    } finally {
      controllerRef.current = null;
      setRunning(false);
      setProgress(null);
    }
  }

  const progressRatio = progress?.ratio ?? null;
  const progressPercent = Math.round((progressRatio ?? 0) * 100);
  const recognizedChars = outcome
    ? outcome.segments.reduce((sum, segment) => sum + segment.text.length, 0)
    : 0;

  return (
    <div className="edit-block asr-block">
      <div className="block-heading">
        <div>
          <h3>{t('asr.title')}</h3>
          <p>{t('asr.description')}</p>
        </div>
        <Sparkles size={18} />
      </div>

      <label className="field-row select-row">
        <span>{t('asr.model')}</span>
        <select
          value={modelId}
          disabled={running}
          onChange={(event) => setModelId(event.target.value as AsrModelId)}
        >
          {ASR_MODELS.map((item) => (
            <option key={item.id} value={item.id}>
              {t(item.labelKey)} · {t(item.detailKey)}
            </option>
          ))}
        </select>
      </label>

      <label className="field-row select-row">
        <span>{t('asr.language')}</span>
        <select
          value={language}
          disabled={running}
          onChange={(event) => setLanguage(event.target.value as AsrLanguage)}
        >
          {ASR_LANGUAGES.map((item) => (
            <option key={item.value} value={item.value}>{t(item.labelKey)}</option>
          ))}
        </select>
      </label>

      <label className="field-row select-row">
        <span>{t('asr.device')}</span>
        <select
          value={device}
          disabled={running}
          onChange={(event) => setDevice(event.target.value as AsrDevice)}
        >
          <option value="webgpu" disabled={!webGpuAvailable}>
            WebGPU{webGpuAvailable ? '' : t('asr.unavailable')}
          </option>
          <option value="wasm">CPU</option>
        </select>
      </label>

      <p className="asr-model-note">
        {cached
          ? t('asr.modelCached')
          : t('asr.modelDownload', { size: modelSize })}
      </p>

      {running ? (
        <div className="export-progress">
          <div className="progress-track">
            <span
              className={progressRatio === null ? 'indeterminate' : ''}
              style={{ width: `${progressRatio === null ? 35 : progressPercent}%` }}
            />
          </div>
          <div className="progress-copy">
            <span>
              {progress
                ? t(progress.message.key, progress.message.values)
                : t('asr.recognizing')}
            </span>
            <span className="mono-chip">{formatSeconds(elapsedMs)}</span>
          </div>
          <button type="button" className="secondary-button compact asr-cancel" onClick={handleCancel}>
            <CircleStop size={15} /> {t('asr.cancel')}
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="primary-button export-button"
          onClick={() => void handleStart()}
          disabled={disabled || !media.info.hasAudio}
        >
          <Sparkles size={17} /> {t('asr.start')}
        </button>
      )}

      {!media.info.hasAudio && (
        <div className="notice-line" role="status">{t('asr.noAudio')}</div>
      )}
      {notice && <div className="notice-line" role="status">{notice}</div>}
      {error && <div className="error-line" role="alert">{error}</div>}

      {outcome && (
        <div className="asr-result">
          <div className="asr-result-heading">
            <strong>{t('asr.complete')}</strong>
            <span className="mono-chip">
              {t('asr.resultSummary', {
                segments: outcome.segments.length,
                chars: recognizedChars,
                duration: formatSeconds(outcome.elapsedMs),
              })}
            </span>
          </div>
          <ul className="asr-result-preview">
            {outcome.segments.slice(0, 3).map((segment) => (
              <li key={segment.id}>{segment.text}</li>
            ))}
          </ul>
          <div className="asr-result-actions">
            <button
              type="button"
              className="primary-button compact"
              onClick={() => onApply(outcome.segments, 'replace')}
            >
              {existingCount > 0 ? t('asr.replace') : t('asr.generate')}
            </button>
            {existingCount > 0 && (
              <button
                type="button"
                className="secondary-button compact"
                onClick={() => onApply(outcome.segments, 'append')}
              >
                {t('asr.append')}
              </button>
            )}
          </div>
        </div>
      )}

      {running && (
        <p className="asr-running-note">
          <LoaderCircle className="spin" size={13} /> {t('asr.runningNote')}
        </p>
      )}
    </div>
  );
}
