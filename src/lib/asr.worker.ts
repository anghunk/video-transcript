/// <reference lib="webworker" />
import { env, pipeline } from '@huggingface/transformers';
import ortFactoryUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url';
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';
import {
  ASR_BLOCK_SECONDS,
  ASR_TARGET_SAMPLE_RATE,
  type AsrChunk,
  type AsrDevice,
  type AsrWorkerRequest,
  type AsrWorkerResponse,
} from './asr-protocol';

const context = self as unknown as DedicatedWorkerGlobalScope;

/* 浏览器环境只从远端加载模型，跳过本地模型目录探测，并把远端固定为 Hugging Face 官方源。 */
env.allowLocalModels = false;
env.remoteHost = 'https://huggingface.co/';

type Transcriber = (
  audio: Float32Array,
  options: Record<string, unknown>,
) => Promise<{ text?: string; chunks?: AsrChunk[] }>;

interface RuntimeProgressEvent {
  status?: string;
  file?: string;
  loaded?: number;
  total?: number;
}

let loadedModel: { key: string; transcriber: Promise<Transcriber> } | null = null;

function post(message: AsrWorkerResponse, transfer?: Transferable[]): void {
  context.postMessage(message, transfer ?? []);
}

function toMegabytes(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1);
}

/** 按设备选择量化精度：WebGPU 用 fp32 编码器配 q4 解码器，CPU 用 q8。 */
function dtypeFor(device: AsrDevice): unknown {
  return device === 'webgpu'
    ? { encoder_model: 'fp32', decoder_model_merged: 'q4' }
    : 'q8';
}

/**
 * 让 ONNX 运行时使用随应用发布的本地 wasm，而不是默认的 jsdelivr CDN。
 *
 * 这样既省掉一次约 27 MB 的额外下载，也不依赖任何 CDN 的可用性；
 * 模型权重依旧从 Hugging Face 官方源下载。在创建推理会话前调用即可生效。
 *
 * 这里刻意引用 `onnxruntime-web` 自身的文件路径，让运行时版本始终与
 * `@huggingface/transformers` 依赖的版本保持一致。
 */
function useBundledWasmRuntime(): void {
  const wasmBackend = env.backends.onnx.wasm;
  if (wasmBackend) wasmBackend.wasmPaths = { wasm: ortWasmUrl, mjs: ortFactoryUrl };
}

/** 加载（或复用）识别模型，并汇报下载与初始化进度。 */
async function loadTranscriber(repoId: string, device: AsrDevice): Promise<Transcriber> {
  const key = `${repoId}@${device}`;
  if (loadedModel?.key === key) return loadedModel.transcriber;

  useBundledWasmRuntime();

  const files = new Map<string, { loaded: number; total: number }>();
  const progress_callback = (event: RuntimeProgressEvent) => {
    if (event.status === 'ready') {
      post({ type: 'progress', phase: 'prepare', ratio: null, detail: '正在初始化推理会话' });
      return;
    }
    if (event.file && typeof event.loaded === 'number' && typeof event.total === 'number' && event.total > 0) {
      files.set(event.file, { loaded: event.loaded, total: event.total });
    }
    let loaded = 0;
    let total = 0;
    for (const file of files.values()) {
      loaded += file.loaded;
      total += file.total;
    }
    if (total === 0) return;
    post({
      type: 'progress',
      phase: 'download',
      ratio: Math.min(1, loaded / total),
      detail: `正在下载模型 ${toMegabytes(loaded)} / ${toMegabytes(total)} MB`,
    });
  };

  const create = pipeline as unknown as (
    task: string,
    model: string,
    options: Record<string, unknown>,
  ) => Promise<unknown>;

  const transcriber = create('automatic-speech-recognition', repoId, {
    device,
    dtype: dtypeFor(device),
    progress_callback,
  }) as Promise<Transcriber>;

  loadedModel = { key, transcriber };
  return transcriber;
}

/** 在目标切点附近寻找能量最低的位置，避免把一句话从中间切开。 */
function findQuietBoundary(audio: Float32Array, start: number, end: number): number {
  if (end >= audio.length) return audio.length;
  const radius = Math.round(ASR_TARGET_SAMPLE_RATE * 0.6);
  const frame = Math.round(ASR_TARGET_SAMPLE_RATE * 0.02);
  const from = Math.max(start + frame, end - radius);
  const to = Math.min(audio.length - frame, end + radius);
  let best = end;
  let bestEnergy = Number.POSITIVE_INFINITY;

  for (let candidate = from; candidate <= to; candidate += frame) {
    let energy = 0;
    const limit = Math.min(candidate + frame, audio.length);
    for (let index = candidate; index < limit; index += 1) {
      energy += audio[index] * audio[index];
    }
    if (energy < bestEnergy) {
      bestEnergy = energy;
      best = candidate;
    }
  }
  return best;
}

/** 分段识别整段音频，并把每段的相对时间戳还原为全局时间。 */
async function transcribe(request: AsrWorkerRequest): Promise<AsrChunk[]> {
  const transcriber = await loadTranscriber(request.repoId, request.device);
  const audio = request.audio;
  const blockSamples = ASR_BLOCK_SECONDS * ASR_TARGET_SAMPLE_RATE;
  const estimatedBlocks = Math.max(1, Math.ceil(audio.length / blockSamples));
  const chunks: AsrChunk[] = [];
  let cursor = 0;
  let blockIndex = 0;

  while (cursor < audio.length) {
    const target = Math.min(audio.length, cursor + blockSamples);
    const end = target >= audio.length
      ? audio.length
      : Math.max(cursor + ASR_TARGET_SAMPLE_RATE, findQuietBoundary(audio, cursor, target));

    const options: Record<string, unknown> = {
      return_timestamps: true,
      chunk_length_s: 30,
      stride_length_s: 5,
      task: 'transcribe',
    };
    if (request.language !== 'auto') options.language = request.language;

    const output = await transcriber(audio.subarray(cursor, end), options);
    const offset = cursor / ASR_TARGET_SAMPLE_RATE;
    for (const chunk of output.chunks ?? []) {
      const rawStart = chunk.timestamp?.[0];
      const rawEnd = chunk.timestamp?.[1];
      const start = Number.isFinite(rawStart) ? rawStart : 0;
      const stop = Number.isFinite(rawEnd) ? rawEnd : start;
      chunks.push({ timestamp: [start + offset, stop + offset], text: chunk.text ?? '' });
    }

    cursor = end;
    blockIndex += 1;
    post({
      type: 'progress',
      phase: 'transcribe',
      ratio: Math.min(1, blockIndex / estimatedBlocks),
      detail: `正在识别第 ${blockIndex}/${estimatedBlocks} 段`,
    });
  }

  return chunks;
}

async function handle(request: AsrWorkerRequest): Promise<void> {
  try {
    const chunks = await transcribe(request);
    post({ type: 'result', chunks });
  } catch (error) {
    post({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

context.addEventListener('message', (event: MessageEvent<AsrWorkerRequest>) => {
  void handle(event.data);
});
