export interface Mp4Info {
  duration: number;
  timescale: number;
  tracks: Mp4Track[];
  videoTracks: Mp4Track[];
  audioTracks: Mp4Track[];
}

export interface Mp4Track {
  id: number;
  type: string;
  codec: string;
  duration: number;
  timescale: number;
  nb_samples: number;
  video?: { width: number; height: number };
  audio?: { sample_rate: number; channel_count: number; sample_size: number };
}

export interface AvcParameterSet {
  length?: number;
  data: Uint8Array;
}

export interface AvcC {
  configurationVersion: number;
  AVCProfileIndication: number;
  profile_compatibility: number;
  AVCLevelIndication: number;
  lengthSizeMinusOne: number;
  SPS: AvcParameterSet[];
  PPS: AvcParameterSet[];
}

export interface Mp4Sample {
  number: number;
  track_id: number;
  timescale: number;
  dts: number;
  cts: number;
  duration: number;
  is_sync: boolean;
  description: Mp4SampleDescription;
  data?: Uint8Array;
}

export interface Mp4SampleDescription {
  type?: string;
  data?: Uint8Array | number[];
  avcC?: AvcC;
}

export interface ParsedMp4 {
  info: Mp4Info;
  videoTrackId: number | null;
  audioTrackId: number | null;
  /** H.264 avcC 解码配置，供 VideoDecoder 使用。 */
  videoDescription: Uint8Array | null;
}
