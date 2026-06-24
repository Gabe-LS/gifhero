import { encode } from "../index.js";
import type { EncodeOptions } from "../index.js";
import type { FrameSource, GifProgress, GifRecorder } from "./types.js";
import { EncoderWorker } from "./worker/worker-pool.js";

export class GifHeroBuilder {
  private _source: FrameSource;
  private _fps = 10;
  private _targetWidth?: number;
  private _preset: "quality" | "balanced" = "balanced";
  private _lossyLzw?: number;
  private _maxColors?: number;
  private _loop = 0;
  private _duration?: number;
  private _onProgress?: (p: GifProgress) => void;
  private _useWorker = true;
  private _abortController = new AbortController();

  constructor(source: FrameSource) {
    this._source = source;
  }

  /** Frames per second for extraction. Default 10. */
  fps(value: number): this {
    this._fps = Math.max(1, Math.min(60, value));
    return this;
  }

  /** Target output width (Lanczos3 downscale). Height auto-calculated. */
  width(value: number): this {
    this._targetWidth = value;
    return this;
  }

  /** Encoding preset. */
  preset(value: "quality" | "balanced"): this {
    this._preset = value;
    return this;
  }

  /** Lossy LZW compression level. 0 = off, 4 = default. */
  lossyLzw(level: number): this {
    this._lossyLzw = level;
    return this;
  }

  /** Maximum palette colors per frame (2–256). */
  maxColors(n: number): this {
    this._maxColors = n;
    return this;
  }

  /** GIF loop count. 0 = infinite (default), -1 = no loop. */
  loop(count: number): this {
    this._loop = count;
    return this;
  }

  /** Maximum recording duration in seconds (for MediaStream sources). */
  duration(seconds: number): this {
    this._duration = seconds;
    return this;
  }

  /** Progress callback. Receives phase ("extracting" | "encoding") and progress (0–1). */
  onProgress(cb: (p: GifProgress) => void): this {
    this._onProgress = cb;
    return this;
  }

  /** Force main-thread encoding (no Web Worker). */
  mainThread(): this {
    this._useWorker = false;
    return this;
  }

  /** Encode and return the GIF as a Uint8Array. */
  async toGif(): Promise<Uint8Array> {
    const signal = this._abortController.signal;

    console.log("[gifhero] Extracting frames...");
    const t0 = performance.now();

    const { frames, width, height } = await this._source.extract(
      (extracted, total) => {
        this._onProgress?.({
          phase: "extracting",
          progress: total > 0 ? extracted / total : 0,
          framesExtracted: extracted,
          totalFrames: total,
        });
        if (extracted % 10 === 0 || extracted === total) {
          console.log(`[gifhero] Extracted ${extracted}/${total} frames`);
        }
      },
      signal,
    );

    signal.throwIfAborted();

    const extractMs = performance.now() - t0;
    const totalPixels = frames.length * width * height;
    console.log(`[gifhero] Extraction done: ${frames.length} frames, ${width}×${height}, ${(extractMs / 1000).toFixed(1)}s`);
    console.log(`[gifhero] Total pixel data: ${(totalPixels * 4 / 1024 / 1024).toFixed(1)} MB`);

    this._onProgress?.({ phase: "encoding", progress: 0 });

    const options: EncodeOptions = {
      width,
      height,
      frames,
      preset: this._preset,
      loop: this._loop,
      ...(this._targetWidth ? { targetWidth: this._targetWidth } : {}),
      ...(this._lossyLzw !== undefined ? { lossyLzw: this._lossyLzw } : {}),
      ...(this._maxColors !== undefined ? { maxColors: this._maxColors } : {}),
    };

    let gif: Uint8Array;
    const t1 = performance.now();

    if (this._useWorker) {
      console.log("[gifhero] Starting Web Worker encoding...");
      try {
        const worker = new EncoderWorker();
        try {
          gif = await worker.encode(frames, width, height, options);
        } finally {
          worker.terminate();
        }
        console.log(`[gifhero] Worker encoding done: ${(gif.byteLength / 1024).toFixed(0)} KB, ${((performance.now() - t1) / 1000).toFixed(1)}s`);
      } catch (err) {
        console.warn("[gifhero] Worker failed, falling back to main thread:", (err as Error).message);
        const t2 = performance.now();
        gif = await encode(options);
        console.log(`[gifhero] Main thread encoding done: ${(gif.byteLength / 1024).toFixed(0)} KB, ${((performance.now() - t2) / 1000).toFixed(1)}s`);
      }
    } else {
      console.log("[gifhero] Starting main thread encoding...");
      gif = await encode(options);
      console.log(`[gifhero] Main thread encoding done: ${(gif.byteLength / 1024).toFixed(0)} KB, ${((performance.now() - t1) / 1000).toFixed(1)}s`);
    }

    const totalMs = performance.now() - t0;
    console.log(`[gifhero] Total: ${(totalMs / 1000).toFixed(1)}s (extract ${(extractMs / 1000).toFixed(1)}s + encode ${((totalMs - extractMs) / 1000).toFixed(1)}s)`);

    this._onProgress?.({ phase: "encoding", progress: 1 });
    return gif;
  }

  /** Encode and return the GIF as a Blob. */
  async toBlob(): Promise<Blob> {
    const gif = await this.toGif();
    return new Blob([gif as unknown as BlobPart], { type: "image/gif" });
  }

  /** Encode and return an object URL for immediate display. */
  async toUrl(): Promise<string> {
    const blob = await this.toBlob();
    return URL.createObjectURL(blob);
  }

  /** Start recording from a MediaStream source. Returns a recorder with stop(). */
  record(): GifRecorder {
    const signal = this._abortController.signal;
    let resolveStop: ((gif: Uint8Array) => void) | null = null;

    const source = this._source as any;
    if (typeof source.startRecording !== "function") {
      throw new Error("record() is only available for MediaStream sources. Use toGif() instead.");
    }

    const stopPromise = source.startRecording(
      this._fps,
      this._duration,
      (extracted: number, total: number) => {
        this._onProgress?.({
          phase: "extracting",
          progress: total > 0 ? extracted / total : 0,
          framesExtracted: extracted,
          totalFrames: total,
        });
      },
      signal,
    );

    return {
      stop: async () => {
        this._abortController.abort();
        const { frames, width, height } = await stopPromise;

        this._onProgress?.({ phase: "encoding", progress: 0 });

        const gif = await encode({
          width, height, frames,
          preset: this._preset,
          loop: this._loop,
          ...(this._targetWidth ? { targetWidth: this._targetWidth } : {}),
          ...(this._lossyLzw !== undefined ? { lossyLzw: this._lossyLzw } : {}),
          ...(this._maxColors !== undefined ? { maxColors: this._maxColors } : {}),
        });

        this._onProgress?.({ phase: "encoding", progress: 1 });
        return gif;
      },
    };
  }

  /** Cancel extraction or encoding in progress. */
  cancel(): void {
    this._abortController.abort();
  }
}
