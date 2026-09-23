import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import type {
  SourceMediaRuntime,
  CopiedAudioInfo,
  MediaSample,
} from './media';
import { extractAllSamples } from './mp4';
import type { ExportEvents, ExportQuality, SubtitleSegment, SubtitleStyle } from '../types';
import {
  resolveExportDimensions,
  resolveBitrate,
  type SourceVideoProfile,
} from './resolution';
import { renderFrame, DEFAULT_STYLE } from './render';

type MuxerType = Muxer<ArrayBufferTarget>;

interface ExportOptions {
  media: SourceMediaRuntime;
  segments: SubtitleSegment[];
  defaultStyle: SubtitleStyle;
  quality: ExportQuality;
  includeAudio?: boolean;
  onProgress?: ExportEvents['onProgress'];
  onError?: ExportEvents['onError'];
}

const SECOND = 1_000_000;

/** 判断当前浏览器是否具备完整导出能力。 */
export function isExportSupported(): boolean {
  return Boolean(
    typeof window !== 'undefined' &&
      'VideoDecoder' in window &&
      'VideoEncoder' in window &&
      'OffscreenCanvas' in window,
  );
}

/**
 * 将支持范围内节点的值显式复制到新 Uint8Array。
 * mp4box 会在样本发出后释放底层数据，因此这里不能只保存视图。
 */
function copyBytes(data: Uint8Array): Uint8Array {
  return new Uint8Array(data);
}

function createCanvas(
  width: number,
  height: number,
): {
  canvas: OffscreenCanvas | HTMLCanvasElement;
  context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
} {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d', { alpha: false });
    if (context) return { canvas, context };
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法创建画布绘制上下文');
  return { canvas, context };
}

function normalizeAvcCodec(source: string): string {
  if (!source) return 'avc1.42E01E';
  return source;
}

/**
 * 合并编码器连续输出的元数据。
 * 浏览器可能把 decoderConfig 单独放在零长度块中，因此后续样本需要继承此前累积的配置。
 */
function mergeVideoEncoderMetadata(
  current: EncodedVideoChunkMetadata | undefined,
  incoming: EncodedVideoChunkMetadata | undefined,
): EncodedVideoChunkMetadata | undefined {
  if (!incoming?.decoderConfig) return current;
  if (!current?.decoderConfig) return incoming;

  return {
    ...current,
    ...incoming,
    decoderConfig: {
      ...current.decoderConfig,
      ...incoming.decoderConfig,
      description:
        incoming.decoderConfig.description ?? current.decoderConfig.description,
      colorSpace:
        incoming.decoderConfig.colorSpace ?? current.decoderConfig.colorSpace,
    },
  };
}

/** 复制源解码描述，避免后续释放文件缓冲后影响封装阶段。 */
function copyDecoderDescription(
  description: AllowSharedBufferSource | undefined,
): Uint8Array | undefined {
  if (!description) return undefined;
  if (ArrayBuffer.isView(description)) {
    return new Uint8Array(
      description.buffer,
      description.byteOffset,
      description.byteLength,
    ).slice();
  }
  return new Uint8Array(description as ArrayBuffer).slice();
}

/**
 * 为未返回完整 decoderConfig 的编码器准备 H.264 兜底配置。
 * mp4-muxer 在封装 H.264 轨道时要求描述字段，否则 finalize 会触发空值异常。
 */
function createFallbackVideoMetadata(
  sourceConfig: VideoDecoderConfig | null,
  encoderConfig: VideoEncoderConfig,
): EncodedVideoChunkMetadata | undefined {
  if (
    !sourceConfig ||
    !(sourceConfig.codec.startsWith('avc1') || sourceConfig.codec.startsWith('avc3'))
  ) {
    return undefined;
  }

  const description = copyDecoderDescription(sourceConfig.description);
  return {
    decoderConfig: {
      codec: encoderConfig.codec,
      codedWidth: encoderConfig.width,
      codedHeight: encoderConfig.height,
      ...(description ? { description } : {}),
      ...(sourceConfig.colorSpace
        ? { colorSpace: { ...sourceConfig.colorSpace } }
        : {}),
    },
  };
}

/**
 * 顺序解码视频样本、叠加字幕、编码为 H.264，再把音频一并转封装。
 * 这是浏览器内导出 MP4 的主流程。
 */
export async function exportSubtitleVideo(options: ExportOptions): Promise<Blob> {
  const {
    media,
    segments,
    defaultStyle,
    quality,
    includeAudio = true,
    onProgress,
    onError,
  } = options;

  if (!media.videoTrack || !media.videoConfig) {
    throw new Error('当前视频轨道无法解码，换用 H.264 编码的 MP4 后重试。');
  }
  if (!isExportSupported()) {
    throw new Error('当前浏览器不支持 WebCodecs，请使用最新版 Chrome 或 Edge。');
  }

  const sourceWidth = media.info.width;
  const sourceHeight = media.info.height;
  const output = resolveExportDimensions(
    sourceWidth,
    sourceHeight,
    quality,
  );
  const frameRate = Math.max(1, Math.round(media.info.frameRate || 30));

  const { canvas, context } = createCanvas(output.width, output.height);
  const sortedSegments = [...segments].sort((a, b) => a.start - b.start);
  const muxer: MuxerType = new Muxer({
    target: new ArrayBufferTarget(),
    video: {
      codec: 'avc',
      width: output.width,
      height: output.height,
      frameRate,
    },
    audio: includeAudio && media.audioInfo?.codecFamily === 'aac'
      ? {
          codec: 'aac',
          numberOfChannels: media.audioInfo.numberOfChannels,
          sampleRate: media.audioInfo.sampleRate,
        }
      : undefined,
    fastStart: 'in-memory',
    firstTimestampBehavior: 'cross-track-offset',
  });

  const frameQueue: VideoFrame[] = [];
  let decodeFailure: DOMException | null = null;
  let encodeFailure: DOMException | null = null;
  let frameIndex = 0;
  let onPipelineIdle: (() => void) | null = null;
  const metadata = createEncoderMetadata(media, output.width, output.height, quality);
  let pendingVideoMetadata = createFallbackVideoMetadata(
    media.videoConfig,
    metadata,
  );

  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      pendingVideoMetadata = mergeVideoEncoderMetadata(
        pendingVideoMetadata,
        meta,
      );
      if (chunk.byteLength > 0) {
        muxer.addVideoChunk(chunk, pendingVideoMetadata);
        pendingVideoMetadata = undefined;
      }
      drainFrameQueue();
    },
    error: (error) => {
      encodeFailure = error;
      const complete = onPipelineIdle;
      onPipelineIdle = null;
      complete?.();
    },
  });

  const decoder = new VideoDecoder({
    output: (frame) => {
      frameQueue.push(frame);
      drainFrameQueue();
    },
    error: (error) => {
      decodeFailure = error;
      const complete = onPipelineIdle;
      onPipelineIdle = null;
      complete?.();
    },
  });

  function drainOneFrame(): void {
    const frame = frameQueue.shift();
    if (!frame) return;
    frameIndex += 1;
    renderFrame(context, frame as unknown as CanvasImageSource, {
      width: output.width,
      height: output.height,
      time: (frame.timestamp ?? 0) / SECOND,
      segments: sortedSegments,
      defaultStyle,
    });
    const nextFrame = new VideoFrame(canvas as CanvasImageSource, {
      timestamp: frame.timestamp ?? 0,
      duration: frame.duration ?? undefined,
    });
    encoder.encode(nextFrame, { keyFrame: frameIndex === 1 });
    frame.close();
    nextFrame.close();
  }

  function drainFrameQueue(): void {
    while (frameQueue.length > 0 && (encoder.encodeQueueSize ?? 0) < 8) {
      drainOneFrame();
    }
    resolveIfPipelineIdle();
  }

  function resolveIfPipelineIdle(): void {
    if (
      frameQueue.length === 0 &&
      (encoder.encodeQueueSize ?? 0) === 0 &&
      onPipelineIdle
    ) {
      const complete = onPipelineIdle;
      onPipelineIdle = null;
      complete();
    }
  }

  async function flushVideoPipeline(): Promise<void> {
    await decoder.flush();
    drainFrameQueue();

    while (
      decodeFailure === null &&
      encodeFailure === null &&
      (frameQueue.length > 0 || (encoder.encodeQueueSize ?? 0) > 0)
    ) {
      const nextBatch = new Promise<void>((resolve) => {
        onPipelineIdle = resolve;
      });
      drainFrameQueue();
      await nextBatch;
    }

    if (decodeFailure) throw decodeFailure;
    if (encodeFailure) throw encodeFailure;

    await encoder.flush();
    if (encodeFailure) throw encodeFailure;

    try {
      decoder.close();
    } catch {
      // 解码器已经完成工作，关闭阶段无需处理竞态。
    }
    try {
      encoder.close();
    } catch {
      // flush 已关闭编码器时无需重复处理。
    }
  }

  function createEncoderMetadata(
    runtime: SourceMediaRuntime,
    width: number,
    height: number,
    exportQuality: ExportQuality,
  ): VideoEncoderConfig {
    return {
      codec: runtime.info.videoCodec
        ? normalizeAvcCodec(runtime.info.videoCodec)
        : 'avc1.42E01E',
      width,
      height,
      bitrate: resolveBitrate(
        width,
        height,
        runtime.info.frameRate || frameRate,
        exportQuality,
        {
          width: runtime.info.width,
          height: runtime.info.height,
          bitrate: runtime.info.videoBitrate,
          codec: runtime.info.videoCodec,
        } satisfies SourceVideoProfile,
      ),
      framerate: runtime.info.frameRate || frameRate,
      avc: {
        format: 'avc',
      },
    };
  }

  await VideoDecoder.isConfigSupported(media.videoConfig);
  decoder.configure(media.videoConfig);
  encoder.configure(metadata);

  await collectVideoSamples(media, decoder, (progress) => {
    onProgress?.(progress * 0.75, progress < 1 ? '解码视频帧' : '视频帧解码完成');
  });

  await flushVideoPipeline();

  if (includeAudio && media.audioInfo?.codecFamily === 'aac') {
    await muxAudioSamples(media, media.audioInfo, muxer, (progress) => {
      onProgress?.(0.75 + progress * 0.2, '封装音轨');
    });
  }

  onProgress?.(0.96, '写入 MP4 文件');
  muxer.finalize();
  const target = muxer.target;
  const result = new Blob([target.buffer as ArrayBuffer], {
    type: 'video/mp4',
  });
  onProgress?.(1, '导出完成');
  return result;
}

/**
 * 把 mp4box 样本转发给 VideoDecoder。样本已在进入队列前复制，
 * 因此 mp4box 后续释放原有 buffer 不会影响解码。
 */
async function collectVideoSamples(
  media: SourceMediaRuntime,
  decoder: VideoDecoder,
  onSample: (progress: number) => void,
): Promise<void> {
  const trackId = media.videoTrack!.id;
  const total = media.videoTrack?.nb_samples ?? 0;
  let handled = 0;

  await extractRawSamples(media, trackId, (samples) => {
    for (const sample of samples) {
      const data = copyBytes(sample.data);
      const type = sample.isSync ? 'key' : 'delta';
      const chunk = new EncodedVideoChunk({
        type,
        timestamp: (sample.cts / sample.timescale) * SECOND,
        duration: (sample.duration / sample.timescale) * SECOND,
        data,
      });
      decoder.decode(chunk);
      handled += 1;
    }
    onSample(total > 0 ? handled / total : 0);
  });
}

/** mp4box 的样本内存是易失的，因此只暴露复制后的样本。 */
function extractRawSamples(
  media: SourceMediaRuntime,
  trackId: number,
  onSamples: (samples: MediaSample[]) => void,
): Promise<void> {
  return extractAllSamples(media.info.buffer, trackId, (samples) => {
    const copied: MediaSample[] = samples
      .filter((sample) => sample.data)
      .map((sample) => ({
        number: sample.number,
        trackId: sample.track_id,
        dts: sample.dts,
        cts: sample.cts,
        duration: sample.duration,
        timescale: sample.timescale,
        isSync: Boolean(sample.is_sync),
        data: copyBytes(sample.data!),
      }));
    if (copied.length > 0) onSamples(copied);
  });
}

/** 将源 AAC 样本按时间封装进新 MP4，不做重编码。 */
async function muxAudioSamples(
  media: SourceMediaRuntime,
  audioInfo: CopiedAudioInfo,
  muxer: MuxerType,
  onSample: (progress: number) => void,
): Promise<void> {
  if (!audioInfo.description) {
    onSample(1);
    return;
  }
  let handled = 0;
  await extractRawSamples(media, audioInfo.trackId, (samples) => {
    for (const sample of samples) {
      muxer.addAudioChunkRaw(
        sample.data,
        sample.isSync ? 'key' : 'delta',
        (sample.dts / sample.timescale) * SECOND,
        (sample.duration / sample.timescale) * SECOND,
        {
          decoderConfig: {
            codec: 'aac',
            description: audioInfo.description ?? undefined,
            numberOfChannels: audioInfo.numberOfChannels,
            sampleRate: audioInfo.sampleRate,
          },
        },
      );
      handled += 1;
    }
    onSample(audioInfo.sampleCount > 0 ? handled / audioInfo.sampleCount : 0);
  });
}

/**
 * 后续如需支持 Opus 转封装，可在此改为 AudioEncoder 重编码；
 * 当前 MVP 保守保留 AAC 直通，未支持的音轨会跳过并在结果中保持无声。
 */
export { DEFAULT_STYLE };
