import type { SourceMediaRuntime } from './media';
import { createSegmentId } from './subtitles';
import type { SubtitleSegment } from '../types';
import {
  ASR_TARGET_SAMPLE_RATE,
  type AsrChunk,
  type AsrDevice,
  type AsrLanguage,
  type AsrWorkerRequest,
  type AsrWorkerResponse,
} from './asr-protocol';

export type { AsrDevice, AsrLanguage } from './asr-protocol';

export type AsrModelId = 'tiny' | 'base' | 'small';

export interface AsrModelOption {
  id: AsrModelId;
  label: string;
  detail: string;
  repoId: string;
  /** 首次使用需要下载的大致体积（MB），含分词器等配置文件。 */
  sizeMB: Record<AsrDevice, number>;
}

export const ASR_MODELS: AsrModelOption[] = [
  {
    id: 'tiny',
    label: '快速',
    detail: '速度最快，中文准确率一般',
    repoId: 'onnx-community/whisper-tiny',
    sizeMB: { wasm: 45, webgpu: 120 },
  },
  {
    id: 'base',
    label: '均衡',
    detail: '速度与准确率折中',
    repoId: 'onnx-community/whisper-base',
    sizeMB: { wasm: 80, webgpu: 205 },
  },
  {
    id: 'small',
    label: '精准',
    detail: '中文准确率更好，速度明显更慢',
    repoId: 'onnx-community/whisper-small',
    sizeMB: { wasm: 245, webgpu: 565 },
  },
];

export const DEFAULT_ASR_MODEL_ID: AsrModelId = 'base';

export const ASR_LANGUAGES: Array<{ value: AsrLanguage; label: string }> = [
  { value: 'auto', label: '自动检测' },
  { value: 'chinese', label: '中文' },
  { value: 'english', label: '英语' },
  { value: 'japanese', label: '日语' },
  { value: 'korean', label: '韩语' },
];

const EMPTY_SAMPLES = new Float32Array(0);

/** 浏览器是否支持 WebGPU 推理。 */
export function isWebGpuAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

/** 当前环境是否可以用 WebCodecs 流式解码该视频的音轨。 */
export function canStreamDecode(media: SourceMediaRuntime | null): boolean {
  if (!media || typeof AudioDecoder === 'undefined') return false;
  const info = media.audioInfo;
  if (!info || !media.info.audioTrackId) return false;
  if (info.codecFamily === 'aac') return Boolean(info.description);
  return info.codecFamily === 'opus';
}

/** 查询指定模型是否已经存在浏览器缓存中。 */
export async function hasCachedModel(repoId: string): Promise<boolean> {
  if (typeof caches === 'undefined') return false;
  try {
    const cache = await caches.open('transformers-cache');
    const requests = await cache.keys();
    return requests.some((request) => request.url.includes(`/${repoId}/`));
  } catch {
    return false;
  }
}

/**
 * 请求浏览器把站点数据标记为持久化，降低模型缓存被自动清理的概率。
 *
 * 浏览器可能在不弹窗的情况下直接拒绝（例如站点尚未安装、访问量较低），
 * 因此这里只作为尽力而为的优化，调用方不需要处理失败。
 *
 * @returns 缓存是否已经处于持久化状态
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
  try {
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

/** 线性插值重采样器：把任意采样率的单声道音频持续转换为 16 kHz。 */
class StreamingResampler {
  private readonly ratio: number;
  private tail = EMPTY_SAMPLES;
  private position = 0;

  constructor(inputRate: number, outputRate: number) {
    this.ratio = inputRate > 0 && outputRate > 0 ? inputRate / outputRate : 1;
  }

  push(input: Float32Array): Float32Array {
    if (input.length === 0) return EMPTY_SAMPLES;
    if (this.ratio === 1) return input;

    const joined = new Float32Array(this.tail.length + input.length);
    joined.set(this.tail, 0);
    joined.set(input, this.tail.length);

    const available = joined.length;
    const count = Math.max(0, Math.floor((available - 1 - this.position) / this.ratio));
    if (count <= 0) {
      this.tail = joined;
      return EMPTY_SAMPLES;
    }

    const output = new Float32Array(count);
    for (let index = 0; index < count; index += 1) {
      const source = this.position + index * this.ratio;
      const base = Math.floor(source);
      const fraction = source - base;
      output[index] = joined[base] * (1 - fraction) + joined[base + 1] * fraction;
    }

    const consumed = this.position + count * this.ratio;
    const keepFrom = Math.floor(consumed);
    this.tail = joined.slice(keepFrom);
    this.position = consumed - keepFrom;
    return output;
  }
}

/** 按需增长的 Float32 写入器，避免先分段收集再整体拷贝带来的双份内存。 */
class PcmWriter {
  private buffer: Float32Array;
  private length = 0;

  constructor(initialCapacity: number) {
    this.buffer = new Float32Array(Math.max(ASR_TARGET_SAMPLE_RATE, Math.ceil(initialCapacity)));
  }

  write(chunk: Float32Array): void {
    if (chunk.length === 0) return;
    this.ensure(this.length + chunk.length);
    this.buffer.set(chunk, this.length);
    this.length += chunk.length;
  }

  toSamples(): Float32Array {
    return this.buffer.subarray(0, this.length);
  }

  private ensure(size: number): void {
    if (size <= this.buffer.length) return;
    let capacity = this.buffer.length;
    while (capacity < size) capacity = Math.ceil(capacity * 1.5);
    const next = new Float32Array(capacity);
    next.set(this.buffer.subarray(0, this.length));
    this.buffer = next;
  }
}

type SingleChannel = Float32Array<ArrayBuffer>;

interface DecodeOptions {
  signal?: AbortSignal;
  onProgress?: (ratio: number | null, detail: string) => void;
  onNotice?: (message: string) => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 用 WebCodecs 逐帧解码音轨，边解码边降混、重采样，内存占用与视频时长线性但系数很小。 */
async function decodeWithWebCodecs(
  media: SourceMediaRuntime,
  options: DecodeOptions,
): Promise<Float32Array> {
  const audioInfo = media.audioInfo;
  const trackId = media.info.audioTrackId;
  if (!audioInfo || !trackId) throw new Error('未找到可解码的音轨');

  // 媒体运行时体积较大，只在真正解码时按需加载，避免进入首屏包。
  const { extractTrackSamples } = await import('./media');
  const writer = new PcmWriter(media.info.duration * ASR_TARGET_SAMPLE_RATE);
  let resampler: StreamingResampler | null = null;
  let plane: SingleChannel = new Float32Array(0);
  let mono: SingleChannel = new Float32Array(0);
  let decodedFrames = 0;
  let lastTimestamp = -1;
  let decoderError: Error | null = null;

  const decoder = new AudioDecoder({
    output: (data) => {
      try {
        const frames = data.numberOfFrames;
        const channels = data.numberOfChannels;
        if (!frames || !channels) return;
        resampler ??= new StreamingResampler(data.sampleRate, ASR_TARGET_SAMPLE_RATE);
        if (plane.length !== frames) plane = new Float32Array(frames);
        if (mono.length !== frames) mono = new Float32Array(frames);
        mono.fill(0);
        for (let channel = 0; channel < channels; channel += 1) {
          data.copyTo(plane, { planeIndex: channel, format: 'f32-planar' });
          for (let index = 0; index < frames; index += 1) mono[index] += plane[index];
        }
        const scale = 1 / channels;
        for (let index = 0; index < frames; index += 1) mono[index] *= scale;
        writer.write(resampler.push(mono));
        decodedFrames += frames;
      } catch (error) {
        decoderError ??= error instanceof Error ? error : new Error(String(error));
      } finally {
        data.close();
      }
    },
    error: (error) => {
      decoderError ??= error instanceof Error ? error : new Error(String(error));
    },
  });

  decoder.configure({
    codec: media.info.audioCodec,
    sampleRate: audioInfo.sampleRate || 48_000,
    numberOfChannels: audioInfo.numberOfChannels || 2,
    ...(audioInfo.description ? { description: audioInfo.description } : {}),
  });

  const totalSamples = Math.max(1, audioInfo.sampleCount);
  let queuedSamples = 0;

  try {
    await extractTrackSamples(media, trackId, (samples) => {
      for (const sample of samples) {
        const timestamp = sample.timescale
          ? Math.round((sample.cts / sample.timescale) * 1_000_000)
          : 0;
        const monotonic = Math.max(timestamp, lastTimestamp + 1);
        lastTimestamp = monotonic;
        decoder.decode(
          new EncodedAudioChunk({
            type: 'key',
            timestamp: monotonic,
            duration: sample.timescale
              ? Math.round((sample.duration / sample.timescale) * 1_000_000)
              : undefined,
            data: sample.data,
          }),
        );
      }
      queuedSamples += samples.length;
      options.onProgress?.(Math.min(0.95, queuedSamples / totalSamples), '正在提取音轨');
    });
    await decoder.flush();
  } finally {
    if (decoder.state !== 'closed') decoder.close();
  }

  if (decoderError) throw decoderError;
  if (decodedFrames === 0) throw new Error('音轨解码结果为空');
  options.onProgress?.(1, '音轨提取完成');
  return writer.toSamples();
}

/** 兜底方案：整段解码后交给 OfflineAudioContext 降混重采样。内存占用明显更高。 */
async function decodeWithWebAudio(
  media: SourceMediaRuntime,
  options: DecodeOptions,
): Promise<Float32Array> {
  const AudioContextCtor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) throw new Error('当前浏览器不支持音频解码');

  if (media.info.duration > 1800) {
    options.onNotice?.('当前浏览器不支持流式解码，长视频将占用大量内存，建议在最新版 Chrome 或 Edge 中使用。');
  }

  options.onProgress?.(null, '正在解码音频');
  const context = new AudioContextCtor();
  let decoded: AudioBuffer;
  try {
    decoded = await context.decodeAudioData(media.info.buffer.slice(0));
  } finally {
    void context.close();
  }

  const length = Math.max(1, Math.ceil(decoded.duration * ASR_TARGET_SAMPLE_RATE));
  const offline = new OfflineAudioContext(1, length, ASR_TARGET_SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  options.onProgress?.(1, '音轨提取完成');
  return rendered.getChannelData(0).slice();
}

/** 把视频音轨解码为 16 kHz 单声道采样，供识别模型使用。 */
export async function extractMonoAudio(
  media: SourceMediaRuntime,
  options: DecodeOptions = {},
): Promise<Float32Array> {
  if (!media.info.hasAudio) throw new Error('该视频没有音轨，无法识别字幕');
  options.signal?.throwIfAborted();

  if (canStreamDecode(media)) {
    try {
      return await decodeWithWebCodecs(media, options);
    } catch (error) {
      options.onNotice?.(`流式解码不可用，已改用整段解码：${errorMessage(error)}`);
    }
  }
  return decodeWithWebAudio(media, options);
}

const STRONG_BREAKS = '。！？!?；;';
const SOFT_BREAKS = '，,、：:';

/** 按标点优先的顺序把长句切成适合显示的字幕行。 */
function splitText(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return text ? [text] : [];
  const pieces: string[] = [];
  let current = '';

  const flush = () => {
    if (!current) return;
    let rest = current;
    current = '';
    while (rest.length > maxChars) {
      pieces.push(rest.slice(0, maxChars));
      rest = rest.slice(maxChars);
    }
    if (rest) pieces.push(rest);
  };

  for (const char of text) {
    current += char;
    const hard = current.length >= maxChars;
    const strong = STRONG_BREAKS.includes(char);
    const soft = SOFT_BREAKS.includes(char) && current.length >= maxChars * 0.6;
    if (hard || strong || soft) flush();
  }
  flush();
  return pieces;
}

interface SegmentBuildOptions {
  duration: number;
  /** 单条字幕最长显示时间（秒）。 */
  maxDuration?: number;
  /** 单条字幕最长字数。 */
  maxChars?: number;
}

/** 把模型输出的时间片段整理成可直接编辑的字幕段。 */
export function buildSegmentsFromChunks(
  chunks: AsrChunk[],
  options: SegmentBuildOptions,
): SubtitleSegment[] {
  const maxDuration = options.maxDuration ?? 8;
  const maxChars = options.maxChars ?? 30;
  const limit = Math.max(0, options.duration);

  const merged: Array<{ start: number; end: number; text: string }> = [];
  for (const chunk of chunks) {
    const text = chunk.text.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const rawStart = Number.isFinite(chunk.timestamp?.[0]) ? chunk.timestamp[0] : null;
    const rawEnd = Number.isFinite(chunk.timestamp?.[1]) ? chunk.timestamp[1] : null;
    const previousEnd = merged.length ? merged[merged.length - 1].end : 0;
    const start = Math.max(0, Math.min(rawStart ?? previousEnd, limit));
    const end = Math.max(start + 0.2, Math.min(rawEnd ?? start + 2, limit || rawEnd || start + 2));
    const previous = merged[merged.length - 1];

    // 过短或过碎的片段与上一段合并，避免出现大量一闪而过的字幕。
    if (
      previous &&
      start - previous.end < 1.2 &&
      (previous.end - previous.start < 1 || previous.text.length < 4) &&
      previous.text.length + text.length <= maxChars * 2
    ) {
      previous.text = `${previous.text}${text}`;
      previous.end = end;
      continue;
    }
    merged.push({ start, end, text });
  }

  const segments: SubtitleSegment[] = [];
  for (const item of merged) {
    const pieces = splitText(item.text, maxChars);
    if (pieces.length === 0) continue;
    if (pieces.length === 1) {
      segments.push({
        id: createSegmentId(),
        start: item.start,
        end: Math.min(item.start + maxDuration, item.end),
        text: pieces[0],
      });
      continue;
    }
    // 按字数比例分配时间，让每行的起止时间贴近朗读进度。
    const totalChars = pieces.reduce((sum, piece) => sum + piece.length, 0);
    const span = Math.max(0.2, item.end - item.start);
    let cursor = item.start;
    pieces.forEach((piece, index) => {
      const share = totalChars ? piece.length / totalChars : 1 / pieces.length;
      const pieceEnd =
        index === pieces.length - 1
          ? item.end
          : Math.min(item.end, cursor + Math.max(0.6, span * share));
      segments.push({
        id: createSegmentId(),
        start: cursor,
        end: Math.max(cursor + 0.2, pieceEnd),
        text: piece,
      });
      cursor = pieceEnd;
    });
  }

  return segments
    .map((segment) => ({
      ...segment,
      start: Math.max(0, Math.min(segment.start, Math.max(0, limit - 0.2))),
      end: Math.min(limit || segment.end, Math.max(segment.end, segment.start + 0.2)),
    }))
    .sort((a, b) => a.start - b.start);
}

export interface AsrProgress {
  phase: 'decode' | 'download' | 'prepare' | 'transcribe';
  ratio: number | null;
  detail: string;
}

export interface AsrRunOptions {
  media: SourceMediaRuntime;
  modelId: AsrModelId;
  device: AsrDevice;
  language: AsrLanguage;
  signal?: AbortSignal;
  onProgress?: (progress: AsrProgress) => void;
  onNotice?: (message: string) => void;
}

export interface AsrRunResult {
  segments: SubtitleSegment[];
  elapsedMs: number;
}

/** 在工作线程中加载本地模型并完成整段识别。 */
export async function runAsr(options: AsrRunOptions): Promise<AsrRunResult> {
  const { media, modelId, device, language, signal, onProgress, onNotice } = options;
  const model = ASR_MODELS.find((item) => item.id === modelId) ?? ASR_MODELS[1];
  const startedAt = performance.now();

  const audio = await extractMonoAudio(media, {
    signal,
    onProgress: (ratio, detail) => onProgress?.({ phase: 'decode', ratio, detail }),
    onNotice,
  });
  signal?.throwIfAborted();

  const worker = new Worker(new URL('./asr.worker.ts', import.meta.url), { type: 'module' });
  let chunks: AsrChunk[] = [];

  try {
    chunks = await new Promise<AsrChunk[]>((resolve, reject) => {
      const abort = () => reject(new DOMException('已取消识别', 'AbortError'));
      signal?.addEventListener('abort', abort, { once: true });
      const resolveOnce = (value: AsrChunk[]) => {
        signal?.removeEventListener('abort', abort);
        resolve(value);
      };
      const rejectOnce = (error: Error) => {
        signal?.removeEventListener('abort', abort);
        reject(error);
      };

      worker.onmessage = (event: MessageEvent<AsrWorkerResponse>) => {
        const message = event.data;
        if (message.type === 'progress') {
          onProgress?.({ phase: message.phase, ratio: message.ratio, detail: message.detail });
          return;
        }
        if (message.type === 'result') {
          resolveOnce(message.chunks);
          return;
        }
        rejectOnce(new Error(message.message));
      };
      worker.onerror = (event) => {
        rejectOnce(new Error(event.message || '识别工作线程异常退出'));
      };
      worker.onmessageerror = () => rejectOnce(new Error('识别结果解析失败'));

      const request: AsrWorkerRequest = {
        audio,
        repoId: model.repoId,
        device,
        language,
      };
      worker.postMessage(request, [audio.buffer as ArrayBuffer]);
    });
  } finally {
    worker.terminate();
  }

  return {
    segments: buildSegmentsFromChunks(chunks, { duration: media.info.duration }),
    elapsedMs: performance.now() - startedAt,
  };
}
