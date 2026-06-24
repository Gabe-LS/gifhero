import type { EncodeFrame } from "../../index.js";
import type { FrameSource, DeferredFrames, VideoSourceOptions } from "../types.js";

/**
 * Extract frames from an HTMLVideoElement by seeking.
 *
 * Stores frames as ImageBitmap objects (native/GPU memory) instead
 * of raw RGBA arrays. Pixel data is materialized on demand when
 * the encoder needs it, keeping JS heap usage minimal during
 * extraction.
 */
export class VideoSource implements FrameSource {
  private _targetWidth?: number;

  constructor(
    private video: HTMLVideoElement,
    private options: VideoSourceOptions = {},
  ) {}

  set targetWidth(w: number | undefined) { this._targetWidth = w; }

  async extract(
    onProgress?: (extracted: number, total: number) => void,
    signal?: AbortSignal,
  ): Promise<DeferredFrames> {
    const video = this.video;

    if (video.readyState < 1) {
      await new Promise<void>((resolve, reject) => {
        video.addEventListener("loadedmetadata", () => resolve(), { once: true });
        video.addEventListener("error", () => reject(new Error("Video failed to load")), { once: true });
      });
    }

    const fps = this.options.fps ?? 10;
    const start = this.options.startTime ?? 0;
    const end = this.options.endTime ?? video.duration;

    if (!isFinite(end) || end <= start) {
      throw new Error(`Invalid video time range: ${start}–${end}. Is the video loaded?`);
    }

    const srcW = video.videoWidth;
    const srcH = video.videoHeight;
    let width = srcW;
    let height = srcH;

    if (this._targetWidth && this._targetWidth < srcW) {
      const ideal = this._targetWidth * 3;
      if (srcW > ideal * 1.15) {
        width = Math.min(ideal, 1920);
        height = Math.floor(srcH * (width / srcW));
      }
    } else if (srcW > 2560) {
      width = 1920;
      height = Math.floor(srcH * (width / srcW));
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

    const interval = 1 / fps;
    const times: number[] = [];
    for (let t = start; t < end; t += interval) times.push(t);

    const delay = Math.round(1000 / fps);
    const bitmaps: ImageBitmap[] = [];
    const delays: number[] = [];

    for (let i = 0; i < times.length; i++) {
      signal?.throwIfAborted();

      video.currentTime = times[i];
      await new Promise<void>((resolve) => {
        video.addEventListener("seeked", () => resolve(), { once: true });
      });

      ctx.drawImage(video, 0, 0, width, height);
      const bitmap = await createImageBitmap(canvas);
      bitmaps.push(bitmap);
      delays.push(delay);
      onProgress?.(i + 1, times.length);
    }

    return {
      bitmaps, delays, width, height,
      materialize() {
        const c = document.createElement("canvas");
        c.width = width;
        c.height = height;
        const cx = c.getContext("2d", { willReadFrequently: true })!;
        const frames: EncodeFrame[] = [];
        for (let i = 0; i < bitmaps.length; i++) {
          cx.drawImage(bitmaps[i], 0, 0);
          frames.push({ data: cx.getImageData(0, 0, width, height).data, delay: delays[i] });
          bitmaps[i].close();
        }
        bitmaps.length = 0;
        return { frames, width, height };
      },
    };
  }
}
