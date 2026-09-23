import * as MP4Box from 'mp4box';
import type {
  ParsedMp4,
  Mp4Info,
  Mp4Sample,
  Mp4SampleDescription,
} from './mp4box-types';

/* mp4box 2.x 的 `createFile(keepMdatData)` 控制是否保留 mdat 媒体数据。 */
type Mp4FileInstance = ReturnType<typeof MP4Box.createFile>;

interface RuntimeTrack {
  id: number;
  type?: string;
  codec?: string;
  nb_samples?: number;
}

/** 复制 ArrayBuffer 并打上 `fileStart`，以便 mp4box 根据文件偏移定位。 */
function asFileBuffer(buffer: ArrayBuffer, fileStart = 0): MP4Box.MP4BoxBuffer {
  return MP4Box.MP4BoxBuffer.fromArrayBuffer(buffer, fileStart);
}

/** 把 mp4box 轨道格式收敛成项目的 `Mp4Track`。 */
function toMp4Info(info: MP4Box.Movie): Mp4Info {
  const base = info as unknown as Mp4Info;
  return {
    duration: info.duration,
    timescale: info.timescale,
    tracks: base.tracks ?? [],
    videoTracks: base.videoTracks ?? [],
    audioTracks: base.audioTracks ?? [],
  };
}

/**
 * 解析完整 MP4 文件，返回时长、编码、轨道和 avcC 解码配置。
 * 保留 mdat 数据，使后续仍可从样本中读取原始媒体字节。
 */
export async function parseMp4(buffer: ArrayBuffer): Promise<ParsedMp4> {
  const file = MP4Box.createFile(true);

  const info = await new Promise<Mp4Info>((resolve, reject) => {
    file.onReady = (ready) => resolve(toMp4Info(ready));
    file.onError = (module, message) =>
      reject(new Error(`MP4 解析失败：${module ?? ''} ${message ?? ''}`.trim()));

    file.appendBuffer(asFileBuffer(buffer));
    file.flush();
  });

  const videoTrack = info.videoTracks[0];
  const audioTrack = info.audioTracks[0];

  return {
    info,
    videoTrackId: videoTrack?.id ?? null,
    audioTrackId: audioTrack?.id ?? null,
    videoDescription: videoTrack?.id
      ? getVideoDescription(file, videoTrack.id)
      : null,
  };
}

/** 从 avcC 配置 box 构建 VideoDecoder 需要的 codec description。 */
function getVideoDescription(
  file: Mp4FileInstance,
  trackId: number,
): Uint8Array | null {
  const track = file.getTrackById(trackId) as unknown as
    | { mdia?: { minf?: unknown } }
    | undefined;
  const minf = track?.mdia?.minf as
    | {
        stbl?: {
          stsd?: {
            entries?: Array<{ avcC?: { write?: (stream: unknown) => number } }>;
          };
        };
      }
    | undefined;
  const entry = minf?.stbl?.stsd?.entries?.[0];
  if (!entry?.avcC) return null;

  const description = entry as unknown as Mp4SampleDescription;
  const avcC = description.avcC;
  if (!avcC) return null;

  const sps = avcC.SPS.map((item) => item.data);
  const pps = avcC.PPS.map((item) => item.data);
  const spsBytesLength = sps.reduce(
    (length, item) => length + 2 + item.byteLength,
    0,
  );
  const ppsBytesLength = pps.reduce(
    (length, item) => length + 2 + item.byteLength,
    0,
  );
  const size = 5 + 1 + spsBytesLength + 1 + ppsBytesLength;
  const result = new Uint8Array(size);
  const view = new DataView(result.buffer);
  let offset = 0;

  view.setUint8(offset++, avcC.configurationVersion);
  view.setUint8(offset++, avcC.AVCProfileIndication);
  view.setUint8(offset++, avcC.profile_compatibility);
  view.setUint8(offset++, avcC.AVCLevelIndication);
  view.setUint8(offset++, 0xfc | (avcC.lengthSizeMinusOne & 0x03));
  view.setUint8(offset++, 0xe0 | (sps.length & 0x1f));
  for (const item of sps) {
    view.setUint16(offset, item.byteLength);
    offset += 2;
    result.set(item, offset);
    offset += item.byteLength;
  }
  view.setUint8(offset++, pps.length & 0xff);
  for (const item of pps) {
    view.setUint16(offset, item.byteLength);
    offset += 2;
    result.set(item, offset);
    offset += item.byteLength;
  }

  return result;
}

/**
 * 以单个 ArrayBuffer 提取一条轨道的所有样本。
 * 样本会在 onSamples 返回时被 mp4box 释放，回调必须同步复制所需字节。
 */
export async function extractAllSamples(
  buffer: ArrayBuffer,
  trackId: number,
  onSamples?: (samples: Mp4Sample[], releasedSampleNumber: number) => void,
): Promise<void> {
  const file = MP4Box.createFile(true);
  let consumedSampleCount = 0;

  await new Promise<void>((resolve, reject) => {
    file.onError = (module, message) =>
      reject(new Error(`样本提取失败：${module ?? ''} ${message ?? ''}`.trim()));

    file.onReady = () => {
      const totalSamples = getTrackSampleCount(file, trackId);

      file.onSamples = (_id, _user, samples) => {
        const typed = samples as unknown as Mp4Sample[];
        onSamples?.(typed, consumedSampleCount);
        consumedSampleCount += typed.length;

        file.releaseUsedSamples(trackId, consumedSampleCount);

        if (consumedSampleCount >= totalSamples) resolve();
      };

      file.setExtractionOptions(trackId, null, { nbSamples: 100 });
      file.start();

      if (consumedSampleCount >= totalSamples) resolve();
    };

    file.appendBuffer(asFileBuffer(buffer));
    file.flush();

    if (consumedSampleCount >= getTrackSampleCount(file, trackId)) resolve();
  });
}

function getTrackSampleCount(file: Mp4FileInstance, trackId: number): number {
  return (
    (file.getInfo().tracks.find((track) => track.id === trackId) as
      | RuntimeTrack
      | undefined)?.nb_samples ?? 0
  );
}
