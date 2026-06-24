import type { EncodeFrame } from "../../index.js";
import type { FrameSource, DeferredFrames, ExtractedFrames, StreamSourceOptions } from "../types.js";

/**
 * Capture frames from a MediaStream (webcam, screen recording).
 *
 * Stores captured frames as ImageBitmap objects to minimize JS heap
 * usage during recording. Materialized to RGBA on demand at encode time.
 */
export class StreamSource implements FrameSource {
  private _duration?: number;
  private _targetWidth?: number;

  constructor(
    private stream: MediaStream,
    private options: StreamSourceOptions = {},
  ) {}

  set duration(seconds: number | undefined) { this._duration = seconds; }
  set targetWidth(w: number | undefined) { this._targetWidth = w; }

  async extract(
    onProgress?: (extracted: number, total: number) => void,
    signal?: AbortSignal,
  ): Promise<DeferredFrames> {
    if (!this._duration) {
      throw new Error(
        "MediaStream source requires .duration(seconds) to set a recording limit, " +
        "or use .record() for manual stop control.",
      );
    }
    return this._capture(this._duration, onProgress, signal);
  }

  startRecording(
    fps: number,
    duration: number | undefined,
    onProgress?: (extracted: number, total: number) => void,
    signal?: AbortSignal,
  ): Promise<DeferredFrames> {
    this.options.fps = fps;
    const maxDuration = duration ?? Infinity;
    return this._capture(maxDuration, onProgress, signal);
  }

  private async _capture(
    maxDuration: number,
    onProgress?: (extracted: number, total: number) => void,
    signal?: AbortSignal,
  ): Promise<DeferredFrames> {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = this.stream;

    await new Promise<void>((resolve) => {
      video.addEventListener("loadedmetadata", () => resolve(), { once: true });
    });
    await video.play();

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

    const fps = this.options.fps ?? 10;
    const interval = 1000 / fps;
    const delay = Math.round(interval);
    const totalFrames = isFinite(maxDuration) ? Math.ceil(maxDuration * fps) : 0;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

    const bitmaps: ImageBitmap[] = [];
    const delays: number[] = [];
    const startTime = performance.now();

    return new Promise<DeferredFrames>((resolve) => {
      const stop = () => {
        video.pause();
        video.srcObject = null;
        resolve({
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
        });
      };

      const captureFrame = async () => {
        const elapsed = (performance.now() - startTime) / 1000;
        if (signal?.aborted || elapsed >= maxDuration) {
          stop();
          return;
        }

        ctx.drawImage(video, 0, 0, width, height);
        const bitmap = await createImageBitmap(canvas);
        bitmaps.push(bitmap);
        delays.push(delay);
        onProgress?.(bitmaps.length, totalFrames || bitmaps.length);

        setTimeout(captureFrame, interval);
      };

      captureFrame();

      this.stream.getTracks().forEach(track => {
        track.addEventListener("ended", stop, { once: true });
      });
    });
  }
}
