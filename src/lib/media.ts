import * as MP4Box from 'mp4box';
import { MP4BoxBuffer } from 'mp4box';

/* 导出管线实例化时，需要把 mp4box 的运行时结构收敛为本项目可控的类型。 */

export interface SourceMediaInfo {
  name: string;
  size: number;
  buffer: ArrayBuffer;
  hasVideo: boolean;
  hasAudio: boolean;
  videoTrackId: number | null;
  audioTrackId: number | null;
  duration: number;
  width: number;
  height: number;
  frameRate: number;
  videoCodec: string;
  audioCodec: string;
  audioSampleRate: number;
  audioChannels: number;
}

export interface SourceMediaRuntime {
  info: SourceMediaInfo;
  parsed: MP4Box.Movie;
  file: ReturnType<typeof MP4Box.createFile>;
  videoTrack: MP4Box.Track | null;
  audioTrack: MP4Box.Track | null;
  videoConfig: VideoDecoderConfig | null;
  audioInfo: CopiedAudioInfo | null;
}

export interface MediaSample {
  number: number;
  trackId: number;
  dts: number;
  cts: number;
  duration: number;
  timescale: number;
  isSync: boolean;
  data: Uint8Array;
}

export interface CopiedAudioInfo {
  trackId: number;
  codecFamily: 'aac' | 'opus' | 'other';
  sampleRate: number;
  numberOfChannels: number;
  sampleCount: number;
  description: Uint8Array | null;
}

interface RawMp4TrackDescription {
  type?: string;
  id?: number;
  codec?: string;
  timescale?: number;
  nb_samples?: number;
}

interface RawVisualSampleEntry {
  width?: number;
  height?: number;
  avcC?: {
    configurationVersion: number;
    AVCProfileIndication: number;
    profile_compatibility: number;
    AVCLevelIndication: number;
    lengthSizeMinusOne: number;
    SPS: Array<{ data: Uint8Array; length?: number }>;
    PPS: Array<{ data: Uint8Array; length?: number }>;
  };
  hvcC?: {
    configurationVersion: number;
    general_profile_space: number;
    general_tier_flag: number;
    general_profile_idc: number;
    general_profile_compatibility_flags: number;
    general_constraint_indicator_flags: number;
    general_level_idc: number;
    min_spatial_segmentation_idc: number;
    parallelismType: number;
    chromaFormat: number;
    bitDepthLumaMinus8: number;
    bitDepthChromaMinus8: number;
    avgFrameRate: number;
    constantFrameRate: number;
    numTemporalLayers: number;
    temporalIdNested: number;
    lengthSizeMinusOne: number;
    arrays: Array<{
      nal_unit_type: number;
      nalus: Array<{ data: Uint8Array; length?: number }>;
    }>;
  };
  vpcC?: {
    profile: number;
    level: number;
    bitDepth: number;
    chromaSubsampling: number;
    videoFullRangeFlag: number;
    colourPrimaries: number;
    transferCharacteristics: number;
    matrixCoefficients: number;
    codecIntializationDataSize: number;
    codecIntializationData: Uint8Array;
  };
  av1C?: {
    seq_profile: number;
    seq_level_idx_0: number;
    seq_tier_0: number;
    high_bitdepth: number;
    twelve_bit: number;
    monochrome: number;
    chroma_subsampling_x: number;
    chroma_subsampling_y: number;
    chroma_sample_position: number;
    configOBUs: Uint8Array;
  };
}

interface RawAudioSampleEntry {
  channel_count?: number;
  getSampleRate?: () => number;
  getChannelCount?: () => number;
  type?: string;
  esds?: {
    esd?: {
      getOTI?: () => number;
      getAudioConfig?: () => number;
      findDescriptor?: (tag: number) => { data?: Uint8Array } | undefined;
    };
  };
  wave?: {
    esds?: {
      esd?: {
        getOTI?: () => number;
        getAudioConfig?: () => number;
        findDescriptor?: (tag: number) => { data?: Uint8Array } | undefined;
      };
    };
  };
  dOps?: {
    OpusSpecificBox?: unknown;
    data?: Uint8Array;
  };
  boxes?: Array<{ type?: string; data?: Uint8Array }>;
}

interface RawAudioSpecificData {
  data?: Uint8Array;
}

function asFileBuffer(buffer: ArrayBuffer, fileStart = 0): MP4BoxBuffer {
  return MP4BoxBuffer.fromArrayBuffer(buffer, fileStart);
}

function findSampleEntry(
  file: ReturnType<typeof MP4Box.createFile>,
  trackId: number,
): RawVisualSampleEntry | RawAudioSampleEntry | null {
  const track = file.getTrackById(trackId) as unknown as
    | {
        mdia?: {
          minf?: {
            stbl?: {
              stsd?: {
                entries?: Array<unknown>;
              };
            };
          };
        };
      }
    | undefined;
  const entry = track?.mdia?.minf?.stbl?.stsd?.entries?.[0];
  return (entry as RawVisualSampleEntry | RawAudioSampleEntry) ?? null;
}

/** 从 H.264 avcC/H.265 hvcC 等 Sample Entry 构造 WebCodecs 的 decoder description。 */
function createVideoDecoderConfig(
  entry: RawVisualSampleEntry,
  codec: string,
  width: number,
  height: number,
): VideoDecoderConfig | null {
  if (!entry || !codec) return null;

  let description: Uint8Array | null = null;
  if (entry.avcC) {
    description = buildAvcDecoderConfigRecord(entry.avcC);
  } else if (entry.hvcC) {
    description = buildHevcDecoderConfigRecord(entry.hvcC);
  } else if (entry.vpcC) {
    description = buildVpcDecoderConfigRecord(entry.vpcC);
  } else if (entry.av1C) {
    description = entry.av1C.configOBUs;
  }

  if (codec.startsWith('avc1') || codec.startsWith('avc3')) {
    const profile = codec.includes('.') ? codec.split('.')[1] ?? '' : '';
    return {
      codec: `avc1.${profile}`,
      codedWidth: width,
      codedHeight: height,
      description: description ?? undefined,
    };
  }
  if (codec.startsWith('hvc1') || codec.startsWith('hev1')) {
    const profile = codec.includes('.') ? codec.slice(codec.indexOf('.') + 1) : '';
    return {
      codec: `hvc1.${profile}`,
      codedWidth: width,
      codedHeight: height,
      description: description ?? undefined,
    };
  }

  return {
    codec,
    codedWidth: width,
    codedHeight: height,
    description: description ?? undefined,
  };
}

function buildAvcDecoderConfigRecord(
  avcC: RawVisualSampleEntry['avcC'],
): Uint8Array {
  const config = avcC!;
  const spsParts = config.SPS.map((item) => item.data);
  const ppsParts = config.PPS.map((item) => item.data);
  const spsBytesLength = spsParts.reduce(
    (length, item) => length + 2 + item.byteLength,
    0,
  );
  const ppsBytesLength = ppsParts.reduce(
    (length, item) => length + 2 + item.byteLength,
    0,
  );
  const result = new Uint8Array(
    5 + 1 + spsBytesLength + 1 + ppsBytesLength,
  );
  const view = new DataView(result.buffer);
  let offset = 0;
  view.setUint8(offset++, config.configurationVersion);
  view.setUint8(offset++, config.AVCProfileIndication);
  view.setUint8(offset++, config.profile_compatibility);
  view.setUint8(offset++, config.AVCLevelIndication);
  view.setUint8(offset++, 0xfc | (config.lengthSizeMinusOne & 0x03));
  view.setUint8(offset++, 0xe0 | (spsParts.length & 0x1f));
  for (const sps of spsParts) {
    view.setUint16(offset, sps.byteLength);
    offset += 2;
    result.set(sps, offset);
    offset += sps.byteLength;
  }
  view.setUint8(offset++, ppsParts.length & 0xff);
  for (const pps of ppsParts) {
    view.setUint16(offset, pps.byteLength);
    offset += 2;
    result.set(pps, offset);
    offset += pps.byteLength;
  }
  return result;
}

function buildHevcDecoderConfigRecord(
  hvcC: RawVisualSampleEntry['hvcC'],
): Uint8Array {
  const config = hvcC!;
  const arrays =
    config.arrays?.map((arr) => ({
      ...arr,
      nalus: arr.nalus.map((nalu) => nalu.data),
    })) ?? [];
  return concatBuffers([
    new Uint8Array(2),
    ...arrays.flatMap((arr) => [
      new Uint8Array([(arr.nal_unit_type << 1) | (arr.nalus.length > 0 ? 1 : 0)]),
      new Uint8Array(new Uint16Array([arr.nalus.length]).buffer),
      ...arr.nalus.flatMap((nalu) => [
        new Uint8Array(new Uint16Array([nalu.byteLength]).buffer),
        nalu,
      ]),
    ]),
  ]);
}

function buildVpcDecoderConfigRecord(
  vpcC: RawVisualSampleEntry['vpcC'],
): Uint8Array {
  const config = vpcC!;
  return new Uint8Array([
    config.profile,
    config.level,
    (config.bitDepth << 4) |
      ((config.chromaSubsampling & 7) << 1) |
      (config.videoFullRangeFlag & 1),
    config.colourPrimaries,
    config.transferCharacteristics,
    config.matrixCoefficients,
    (config.codecIntializationDataSize >> 8) & 0xff,
    config.codecIntializationDataSize & 0xff,
    ...Array.from(config.codecIntializationData ?? []),
  ]);
}

function lengthPrefixed(data: Uint8Array, prefixBytes: number): Uint8Array {
  const result = new Uint8Array(data.byteLength + prefixBytes);
  const view = new DataView(result.buffer);
  if (prefixBytes === 2) view.setUint16(0, data.byteLength);
  if (prefixBytes === 4) view.setUint32(0, data.byteLength);
  result.set(data, prefixBytes);
  return result;
}

function concatBuffers(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function getTrackSampleCount(
  file: ReturnType<typeof MP4Box.createFile>,
  trackId: number,
): number {
  return (
    (file.getInfo().tracks.find((track) => track.id === trackId) as
      | RawMp4TrackDescription
      | undefined)?.nb_samples ?? 0
  );
}

function getTrackDescription(
  file: ReturnType<typeof MP4Box.createFile>,
  trackId: number,
): RawMp4TrackDescription | null {
  return (file.getInfo().tracks.find((track) => track.id === trackId) as
    | RawMp4TrackDescription
    | undefined) ?? null;
}

function getAudioDescriptionBytes(entry: RawAudioSampleEntry): Uint8Array | null {
  const descriptor =
    entry.esds?.esd ??
    entry.wave?.esds?.esd ??
    null;
  if (!descriptor?.findDescriptor) return null;
  const decoderConfig = (descriptor.findDescriptor as (tag: number) => RawAudioSpecificData | undefined)(4);
  const specificInfo = descriptor.findDescriptor?.(5);
  if (
    specificInfo?.data &&
    specificInfo.data.byteLength > 0 &&
    areAudioSpecificBytesPlausible(specificInfo.data)
  ) {
    return new Uint8Array(specificInfo.data);
  }
  if (specificInfo?.data) return new Uint8Array(specificInfo.data);
  if (decoderConfig?.data) return new Uint8Array(decoderConfig.data);
  return null;
}

function areAudioSpecificBytesPlausible(data: Uint8Array): boolean {
  if (data.byteLength < 2) return false;
  const objectType = (data[0] & 0xf8) >> 3;
  const frequencyIndex = (data[0] & 0x07) << 1 | (data[1] & 0x80 ? 1 : 0);
  return objectType === 2 || frequencyIndex !== 0 || data.byteLength > 2;
}

function codecFamilyFor(codec: string): CopiedAudioInfo['codecFamily'] {
  const normalized = codec.toLowerCase();
  if (normalized.startsWith('mp4a.6b') || normalized.startsWith('aac')) {
    return 'aac';
  }
  if (normalized.startsWith('opus') || normalized.startsWith('Opus')) {
    return 'opus';
  }
  return 'other';
}

function numericOr(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? (value as number) : fallback;
}

/** 读取源媒体文件并完成解析与解码配置准备。整个导出和预览只调用一次。 */
export async function loadSourceMedia(
  file: File,
): Promise<SourceMediaRuntime> {
  const buffer = await file.arrayBuffer();
  const boxFile = MP4Box.createFile(true);

  const movie = await new Promise<MP4Box.Movie>((resolve, reject) => {
    boxFile.onReady = (ready) => resolve(ready);
    boxFile.onError = (module, message) =>
      reject(new Error(`源文件解析失败：${module ?? ''} ${message ?? ''}`.trim()));
    boxFile.appendBuffer(asFileBuffer(buffer));
    boxFile.flush();
  });

  const videoTrack = (movie.videoTracks?.[0] ??
    movie.tracks.find((track) => track.type === 'video') ??
    null) as MP4Box.Track | null;
  const audioTrack = (movie.audioTracks?.[0] ??
    movie.tracks.find((track) => track.type === 'audio') ??
    null) as MP4Box.Track | null;

  const videoEntry = videoTrack?.id
    ? (findSampleEntry(boxFile, videoTrack.id) as RawVisualSampleEntry | null)
    : null;
  const audioEntry = audioTrack?.id
    ? (findSampleEntry(boxFile, audioTrack.id) as RawAudioSampleEntry | null)
    : null;

  const videoConfig = videoTrack?.id && videoEntry
    ? createVideoDecoderConfig(
        videoEntry,
        videoTrack.codec,
        videoTrack.video?.width ?? 0,
        videoTrack.video?.height ?? 0,
      )
    : null;

  const audioInfo: CopiedAudioInfo | null = audioTrack
    ? {
        trackId: audioTrack.id,
        codecFamily: codecFamilyFor(audioTrack.codec),
        sampleRate: audioTrack.audio?.sample_rate ?? 48_000,
        numberOfChannels: audioTrack.audio?.channel_count ?? 2,
        sampleCount: audioTrack.nb_samples ?? 0,
        description: audioEntry
          ? getAudioDescriptionBytes(audioEntry)
          : null,
      }
    : null;

  const info: SourceMediaInfo = {
    name: file.name,
    size: file.size,
    buffer,
    hasVideo: Boolean(videoTrack),
    hasAudio: Boolean(audioTrack),
    videoTrackId: videoTrack?.id ?? null,
    audioTrackId: audioTrack?.id ?? null,
    duration: movie.duration / (movie.timescale || 1),
    width: videoTrack?.video?.width ?? 0,
    height: videoTrack?.video?.height ?? 0,
    frameRate: videoTrack?.nb_samples && movie.duration
      ? (videoTrack.nb_samples * (videoTrack.timescale || movie.timescale)) /
        movie.duration
      : 30,
    videoCodec: videoTrack?.codec ?? '',
    audioCodec: audioTrack?.codec ?? '',
    audioSampleRate: audioTrack?.audio?.sample_rate ?? 0,
    audioChannels: audioTrack?.audio?.channel_count ?? 0,
  };

  return {
    info,
    parsed: movie,
    file: boxFile,
    videoTrack,
    audioTrack,
    videoConfig,
    audioInfo,
  };
}

/**
 * 从 mp4box 中提取并复制一条轨道样本。回调内必须立即把样本数据复制到自己的内存，
 * 因为 mp4box 可能在下一批样本进入前释放已发出样本。
 */
export async function extractTrackSamples(
  media: SourceMediaRuntime,
  trackId: number,
  onSamples: (samples: MediaSample[]) => void,
): Promise<void> {
  const file = media.file;
  file.stop();
  file.setExtractionOptions(trackId, null, { nbSamples: 100 });
  const total = getTrackSampleCount(file, trackId);
  let consumed = 0;

  await new Promise<void>((resolve, reject) => {
    file.onError = (module, message) =>
      reject(new Error(`音频样本提取失败：${module ?? ''} ${message ?? ''}`.trim()));
    file.onSamples = (_id, _user, samples) => {
      const sourceSamples = samples as unknown as Array<{
        number: number;
        track_id: number;
        dts: number;
        cts: number;
        duration: number;
        timescale: number;
        is_sync: boolean;
        data?: Uint8Array;
      }>;
      const copied: MediaSample[] = sourceSamples
        .filter((sample) => sample.data)
        .map((sample) => ({
          number: sample.number,
          trackId: sample.track_id,
          dts: sample.dts,
          cts: sample.cts,
          duration: sample.duration,
          timescale: sample.timescale,
          isSync: Boolean(sample.is_sync),
          data: new Uint8Array(sample.data!.byteLength)
            .map((_byte, index) => (sample.data as Uint8Array)[index]),
        }));
      if (copied.length) onSamples(copied);
      consumed += sourceSamples.length;
      file.releaseUsedSamples(trackId, consumed);
      if (consumed >= total) resolve();
    };

    file.start();
    file.flush();

    if (consumed >= total) resolve();
  });
}
