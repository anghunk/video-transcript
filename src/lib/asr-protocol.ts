/* 本地语音识别在渲染线程与工作线程之间共享的类型与常量。
 * 该文件不引入任何运行时依赖，便于被工作线程单独打包。 */

export type AsrDevice = 'webgpu' | 'wasm';

export type AsrLanguage = 'auto' | 'chinese' | 'english' | 'japanese' | 'korean';

/** 模型统一接收 16 kHz 单声道音频。 */
export const ASR_TARGET_SAMPLE_RATE = 16000;

/** 单次送入模型的最长音频（秒）。分段既能给出进度，也能限制长视频的内存占用。 */
export const ASR_BLOCK_SECONDS = 480;

/** 识别结果中的一段文本及其在原始音频中的时间范围（秒）。 */
export interface AsrChunk {
  timestamp: [number, number];
  text: string;
}

export interface AsrWorkerRequest {
  audio: Float32Array;
  repoId: string;
  device: AsrDevice;
  language: AsrLanguage;
}

export interface AsrWorkerProgress {
  type: 'progress';
  phase: 'download' | 'prepare' | 'transcribe';
  /** 0-1 的进度，无法预估时为 null。 */
  ratio: number | null;
  detail: string;
}

export type AsrWorkerResponse =
  | AsrWorkerProgress
  | { type: 'result'; chunks: AsrChunk[] }
  | { type: 'error'; message: string };
