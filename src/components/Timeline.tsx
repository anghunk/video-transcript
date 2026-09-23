import type { PointerEvent as ReactPointerEvent } from 'react';
import type { DragState, SubtitleSegment } from '../types';
import { formatTimestamp } from '../lib/format';

interface TimelineProps {
  duration: number;
  currentTime: number;
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

export function Timeline({
  duration,
  currentTime,
  segments,
  selectedId,
  onTrackPointerDown,
  onTrackPointerMove,
  onSelectSegment,
  onBarPointerDown,
  onBarPointerMove,
  onBarPointerUp,
}: TimelineProps) {
  const safeDuration = duration || 1;
  return (
    <div className="timeline">
      <div className="timeline-scroll">
        <div
          className="timeline-track"
          onPointerDown={onTrackPointerDown}
          onPointerMove={onTrackPointerMove}
        >
          <div className="timeline-rule">
            {Array.from({ length: 9 }, (_, index) => {
              const value = (safeDuration / 8) * index;
              return (
                <span key={index} style={{ left: `${(value / safeDuration) * 100}%` }}>
                  {formatTimestamp(value, false)}
                </span>
              );
            })}
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
                <span className="segment-label">{segment.text || '空白'}</span>
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
