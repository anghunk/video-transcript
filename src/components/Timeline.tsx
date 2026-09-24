import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Minus, Plus } from 'lucide-react';
import type { DragState, SubtitleSegment } from '../types';
import { formatTimestamp } from '../lib/format';

const DEFAULT_PIXELS_PER_SECOND = 36;
const MIN_ZOOM_PERCENT = 25;
const MAX_ZOOM_PERCENT = 400;
const TARGET_TICK_SPACING_PX = 96;
const MAX_TICK_COUNT = 360;
const ZOOM_LEVELS = [25, 50, 75, 100, 150, 200, 300, 400];
const TICK_INTERVALS = [
  0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600,
];

interface TimelineProps {
  duration: number;
  currentTime: number;
  playing: boolean;
  segments: SubtitleSegment[];
  selectedId: string | null;
  onTrackPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onTrackPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onSelectSegment: (id: string) => void;
  onBarPointerDown: (
    event: ReactPointerEvent<HTMLElement>,
    segment: SubtitleSegment,
    edge: DragState['edge'],
  ) => void;
  onBarPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onBarPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
}

/** 按当前缩放比例选择不重叠且数量可控的时间刻度。 */
function getTickInterval(duration: number, pixelsPerSecond: number): number {
  const desiredInterval = Math.max(
    TARGET_TICK_SPACING_PX / pixelsPerSecond,
    duration / MAX_TICK_COUNT,
  );
  return (
    TICK_INTERVALS.find((interval) => interval >= desiredInterval) ??
    Math.ceil(desiredInterval / 3600) * 3600
  );
}

/** 在滑块位置与缩放比例之间做对数映射，让默认比例位于滑杆中央。 */
function getZoomFromSliderValue(value: number): number {
  const ratio = MAX_ZOOM_PERCENT / MIN_ZOOM_PERCENT;
  return MIN_ZOOM_PERCENT * ratio ** (value / 100);
}

function getSliderValueFromZoom(zoomPercent: number): number {
  const ratio = MAX_ZOOM_PERCENT / MIN_ZOOM_PERCENT;
  return (Math.log(zoomPercent / MIN_ZOOM_PERCENT) / Math.log(ratio)) * 100;
}

export function Timeline({
  duration,
  currentTime,
  playing,
  segments,
  selectedId,
  onTrackPointerDown,
  onTrackPointerMove,
  onSelectSegment,
  onBarPointerDown,
  onBarPointerMove,
  onBarPointerUp,
}: TimelineProps) {
  const { t } = useTranslation();
  const safeDuration = duration || 1;
  const [zoomPercent, setZoomPercent] = useState(100);
  const [viewportWidth, setViewportWidth] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const zoomAnchorRef = useRef<{ time: number; viewportX: number } | null>(null);
  const trackWidth = Math.max(
    viewportWidth,
    safeDuration * DEFAULT_PIXELS_PER_SECOND * (zoomPercent / 100),
  );
  const effectivePixelsPerSecond = trackWidth / safeDuration;
  const zoomSliderValue = getSliderValueFromZoom(zoomPercent);
  const tickInterval = getTickInterval(safeDuration, effectivePixelsPerSecond);
  const tickValues = useMemo(() => {
    const values = Array.from(
      { length: Math.floor(safeDuration / tickInterval) + 1 },
      (_, index) => index * tickInterval,
    );
    const lastValue = values[values.length - 1] ?? 0;
    if (safeDuration - lastValue > tickInterval * 0.15) {
      values.push(safeDuration);
    }
    return values;
  }, [safeDuration, tickInterval]);

  useLayoutEffect(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement) return;

    const updateWidth = () => setViewportWidth(scrollElement.clientWidth);
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(scrollElement);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const anchor = zoomAnchorRef.current;
    const scrollElement = scrollRef.current;
    if (!anchor || !scrollElement) return;

    scrollElement.scrollLeft = Math.max(
      0,
      anchor.time * effectivePixelsPerSecond - anchor.viewportX,
    );
    zoomAnchorRef.current = null;
  }, [effectivePixelsPerSecond]);

  useEffect(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement || scrollElement.scrollWidth <= scrollElement.clientWidth) {
      return;
    }

    if (currentTime <= 0) {
      scrollElement.scrollLeft = 0;
      return;
    }
    if (!playing) return;

    const playheadX = (currentTime / safeDuration) * trackWidth;
    const maxScrollLeft = scrollElement.scrollWidth - scrollElement.clientWidth;
    const targetScrollLeft = Math.max(
      0,
      Math.min(maxScrollLeft, playheadX - scrollElement.clientWidth / 2),
    );
    scrollElement.scrollLeft = targetScrollLeft;
  }, [currentTime, playing, safeDuration, trackWidth]);

  function changeZoom(nextZoomPercent: number) {
    const nextZoom = Math.max(
      MIN_ZOOM_PERCENT,
      Math.min(MAX_ZOOM_PERCENT, nextZoomPercent),
    );
    if (nextZoom === zoomPercent) return;

    const scrollElement = scrollRef.current;
    if (scrollElement) {
      const anchorTime = Math.max(0, Math.min(safeDuration, currentTime));
      const playheadViewportX =
        anchorTime * effectivePixelsPerSecond - scrollElement.scrollLeft;
      const viewportX =
        playheadViewportX >= 0 && playheadViewportX <= scrollElement.clientWidth
          ? playheadViewportX
          : scrollElement.clientWidth / 2;
      zoomAnchorRef.current = { time: anchorTime, viewportX };
    }

    setZoomPercent(nextZoom);
  }

  function stepZoom(direction: -1 | 1) {
    const nextZoom =
      direction > 0
        ? ZOOM_LEVELS.find((level) => level > zoomPercent)
        : [...ZOOM_LEVELS].reverse().find((level) => level < zoomPercent);
    if (nextZoom !== undefined) changeZoom(nextZoom);
  }

  return (
    <div className="timeline">
      <div className="timeline-toolbar">
        <div className="section-heading timeline-heading">
          <div>
            <p>
              <span>{t('timeline.segmentCount', { count: segments.length })}</span>
              <span className="timeline-heading-hint">{t('timeline.dragHint')}</span>
            </p>
          </div>
        </div>
        <div className="timeline-zoom-control" role="group" aria-label={t('timeline.zoom')}>
          <button
            type="button"
            className="timeline-zoom-button"
            onClick={() => stepZoom(-1)}
            disabled={zoomPercent <= MIN_ZOOM_PERCENT}
            aria-label={t('timeline.zoomOut')}
            title={t('timeline.zoomOut')}
          >
            <Minus size={15} />
          </button>
          <div className="timeline-zoom-slider-shell">
            <input
              className="timeline-zoom-slider"
              type="range"
              min="0"
              max="100"
              step="0.1"
              value={zoomSliderValue}
              onChange={(event) => changeZoom(getZoomFromSliderValue(Number(event.target.value)))}
              aria-label={t('timeline.zoomLevel')}
              aria-valuetext={`${Math.round(zoomPercent)}%`}
              style={{
                '--timeline-zoom-progress': `${zoomSliderValue}%`,
              } as CSSProperties}
            />
          </div>
          <button
            type="button"
            className="timeline-zoom-button"
            onClick={() => stepZoom(1)}
            disabled={zoomPercent >= MAX_ZOOM_PERCENT}
            aria-label={t('timeline.zoomIn')}
            title={t('timeline.zoomIn')}
          >
            <Plus size={15} />
          </button>
          <output className="timeline-zoom-value">{Math.round(zoomPercent)}%</output>
        </div>
      </div>
      <div ref={scrollRef} className="timeline-scroll">
        <div
          className="timeline-track"
          style={{ width: `${Math.round(trackWidth)}px` }}
          onPointerDown={onTrackPointerDown}
          onPointerMove={onTrackPointerMove}
        >
          <div className="timeline-rule">
            {tickValues.map((value, index) => {
              return (
                <span
                  key={value}
                  className={
                    index === 0
                      ? 'timeline-tick first'
                      : index === tickValues.length - 1
                        ? 'timeline-tick last'
                        : 'timeline-tick'
                  }
                  style={{ left: `${(value / safeDuration) * 100}%` }}
                >
                  {formatTimestamp(value, tickInterval < 1)}
                </span>
              );
            })}
          </div>
          <div className="timeline-grid" aria-hidden="true">
            {tickValues.map((value) => (
              <span key={value} style={{ left: `${(value / safeDuration) * 100}%` }} />
            ))}
          </div>
          <div className="segment-layer">
            {segments.map((segment) => (
              <button
                type="button"
                key={segment.id}
                className={`segment-bar${selectedId === segment.id ? ' selected' : ''}`}
                style={{
                  left: `${(segment.start / safeDuration) * 100}%`,
                  width: `${((segment.end - segment.start) / safeDuration) * 100}%`,
                }}
                data-segment-id={segment.id}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectSegment(segment.id);
                }}
                onPointerDown={(event) => onBarPointerDown(event, segment, 'body')}
                onPointerMove={onBarPointerMove}
                onPointerUp={onBarPointerUp}
                title={segment.text}
              >
                <span className="segment-label">{segment.text || t('timeline.blank')}</span>
                <span
                  className="segment-handle start-handle"
                  onPointerDown={(event) => onBarPointerDown(event, segment, 'start')}
                  onPointerMove={onBarPointerMove}
                  onPointerUp={onBarPointerUp}
                  onClick={(event) => event.stopPropagation()}
                />
                <span
                  className="segment-handle end-handle"
                  onPointerDown={(event) => onBarPointerDown(event, segment, 'end')}
                  onPointerMove={onBarPointerMove}
                  onPointerUp={onBarPointerUp}
                  onClick={(event) => event.stopPropagation()}
                />
              </button>
            ))}
          </div>
          <div className="playhead" style={{ left: `${(currentTime / safeDuration) * 100}%` }}>
            <span className="playhead-dot" />
          </div>
        </div>
      </div>
    </div>
  );
}
