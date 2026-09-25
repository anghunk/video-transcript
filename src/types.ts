export type SubtitlePosition = 'top' | 'middle' | 'bottom';
export type SubtitleAlign = 'left' | 'center' | 'right';

export interface SubtitleStyle {
  backgroundColor: string;
  textColor: string;
  fontSize: number;
  position: SubtitlePosition;
  align: SubtitleAlign;
  paddingX: number;
  paddingY: number;
  backgroundOpacity: number;
}

export interface SubtitleSegment {
  id: string;
  start: number;
  end: number;
  text: string;
}

export interface VideoMeta {
  name: string;
  size: number;
  width: number;
  height: number;
  duration: number;
  codec: string;
  frameRate: number;
  audioSampleRate?: number;
  audioChannels?: number;
  audioCodec?: string;
}

export type ExportQuality = 'native' | 'high' | 'standard';

export interface ExportEvents {
  onProgress?: (progress: number, phase: string) => void;
  onError?: (error: Error) => void;
}

export type ThemeMode = 'dark' | 'light';

export interface DragState {
  segmentId: string;
  edge: 'start' | 'end' | 'body';
  pointerStartX: number;
  originalStart: number;
  originalEnd: number;
  snapTime: number | null;
}
