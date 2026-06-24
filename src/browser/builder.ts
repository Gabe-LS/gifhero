import { encode } from "../index.js";
import type { EncodeOptions } from "../index.js";
import type { FrameSource, GifProgress, GifRecorder } from "./types.js";
import { FileSource } from "./sources/file.js";
import { EncoderWorker } from "./worker/worker-pool.js";

function log(...args: any[]) { console.log(`[gifhero ${new Date().toISOString().slice(11, 23)}]`, ...args); }
function warn(...args: any[]) { console.warn(`[gifhero ${new Date().toISOString().slice(11, 23)}]`, ...args); }

export class GifHeroBuilder {
  private _source: FrameSource | FileSource;
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

  constructor(source: FrameSource | FileSource) {
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

    // FileSource: full pipeline runs in the video worker
    if (this._source instanceof FileSource) {
      return this._encodeViaVideoWorker(signal);
    }

    // Pass settings to source
    if (this._targetWidth && "targetWidth" in this._source) {
      (this._source as any).targetWidth = this._targetWidth;
    }
    if ("delay" in this._source) {
      (this._source as any).delay = Math.round(1000 / this._fps);
    }

    log("Extracting frames...");
    const t0 = performance.now();

    const extracted = await this._source.extract(
      (done, total) => {
        this._onProgress?.({
          phase: "extracting",
          progress: total > 0 ? done / total : 0,
          framesExtracted: done,
          totalFrames: total,
        });
        if (done % 10 === 0 || done === total) {
          log(`Extracted ${done}/${total} frames`);
        }
      },
      signal,
    );

    signal.throwIfAborted();

    // Materialize deferred frames (ImageBitmap → RGBA) if needed
    let frames, width, height;
    if ("materialize" in extracted) {
      log(`Materializing ${extracted.bitmaps.length} ImageBitmaps to RGBA...`);
      const mt0 = performance.now();
      ({ frames, width, height } = extracted.materialize());
      log(`Materialized in ${((performance.now() - mt0) / 1000).toFixed(1)}s`);
    } else {
      ({ frames, width, height } = extracted);
    }

    const extractMs = performance.now() - t0;
    const totalPixels = frames.length * width * height;
    log(`Extraction done: ${frames.length} frames, ${width}×${height}, ${(extractMs / 1000).toFixed(1)}s`);
    log(`Total pixel data: ${(totalPixels * 4 / 1024 / 1024).toFixed(1)} MB`);

    this._onProgress?.({ phase: "encoding", progress: 0 });

    // If source extracted at 2× target, Lanczos3 handles the final
    // downscale for quality. If source extracted at target size already
    // (e.g. fromFrames), targetWidth won't trigger downscale.
    const options: EncodeOptions = {
      width,
      height,
      frames,
      preset: this._preset,
      loop: this._loop,
      ...(this._targetWidth && this._targetWidth < width ? { targetWidth: this._targetWidth } : {}),
      ...(this._lossyLzw !== undefined ? { lossyLzw: this._lossyLzw } : {}),
      ...(this._maxColors !== undefined ? { maxColors: this._maxColors } : {}),
    };

    let gif: Uint8Array;
    const t1 = performance.now();

    if (this._useWorker) {
      log("Starting Web Worker encoding...");
      try {
        const worker = new EncoderWorker();
        try {
          gif = await worker.encode(frames, width, height, options);
        } finally {
          worker.terminate();
        }
        log(`Worker encoding done: ${(gif.byteLength / 1024).toFixed(0)} KB, ${((performance.now() - t1) / 1000).toFixed(1)}s`);
      } catch (err) {
        warn("Worker failed, falling back to main thread:", (err as Error).message);
        const t2 = performance.now();
        gif = await encode(options);
        log(`Main thread encoding done: ${(gif.byteLength / 1024).toFixed(0)} KB, ${((performance.now() - t2) / 1000).toFixed(1)}s`);
      }
    } else {
      log("Starting main thread encoding...");
      gif = await encode(options);
      log(`Main thread encoding done: ${(gif.byteLength / 1024).toFixed(0)} KB, ${((performance.now() - t1) / 1000).toFixed(1)}s`);
    }

    const totalMs = performance.now() - t0;
    log(`Total: ${(totalMs / 1000).toFixed(1)}s (extract ${(extractMs / 1000).toFixed(1)}s + encode ${((totalMs - extractMs) / 1000).toFixed(1)}s)`);

    this._onProgress?.({ phase: "encoding", progress: 1 });
    return gif;
  }

  /** Full pipeline via video worker (demux + decode + probe + encode). */
  private async _encodeViaVideoWorker(signal: AbortSignal): Promise<Uint8Array> {
    const source = this._source as FileSource;
    log("Reading file...");
    const videoBuffer = await source.getBuffer();
    log(`File read: ${(videoBuffer.byteLength / 1024 / 1024).toFixed(1)} MB`);

    signal.throwIfAborted();

    const url = new URL("./video-worker.js", import.meta.url);
    log("Creating video worker from:", url.href);
    const worker = new Worker(url, { type: "module" });

    return new Promise<Uint8Array>((resolve, reject) => {
      worker.addEventListener("error", (e) => {
        console.error(`[gifhero ${new Date().toISOString().slice(11, 23)}] Video worker error:`, e.message);
        reject(new Error(e.message));
      });

      worker.addEventListener("message", (e: MessageEvent) => {
        if (e.data.type === "progress") {
          this._onProgress?.({
            phase: e.data.phase,
            progress: e.data.progress,
          });
        } else if (e.data.type === "result") {
          log(`Received GIF from video worker: ${(e.data.gif.byteLength / 1024).toFixed(0)} KB`);
          worker.terminate();
          resolve(new Uint8Array(e.data.gif));
        } else if (e.data.type === "error") {
          worker.terminate();
          reject(new Error(e.data.message));
        }
      });

      worker.postMessage(
        {
          type: "encode-video",
          id: 0,
          videoBuffer,
          fps: this._fps,
          targetWidth: this._targetWidth,
          maxDuration: this._duration,
          preset: this._preset,
          lossyLzw: this._lossyLzw,
          maxColors: this._maxColors,
          loop: this._loop,
        },
        [videoBuffer],
      );
      log("Video sent to worker");
    });
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
          ...(this._targetWidth && this._targetWidth < width ? { targetWidth: this._targetWidth } : {}),
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
