import type { EncodeFrame } from "../../index.js";
import type { FrameSource, ExtractedFrames, CanvasSourceOptions } from "../types.js";

/**
 * Capture frames from a Canvas or OffscreenCanvas.
 *
 * Single frame (default): snapshots the current canvas state.
 * Multi-frame: captures `frameCount` frames at the configured FPS
 * using requestAnimationFrame timing.
 */
export class CanvasSource implements FrameSource {
  constructor(
    private canvas: HTMLCanvasElement | OffscreenCanvas,
    private options: CanvasSourceOptions = {},
  ) {}

  async extract(
    onProgress?: (extracted: number, total: number) => void,
    signal?: AbortSignal,
  ): Promise<ExtractedFrames> {
    const canvas = this.canvas;
    const width = canvas.width;
    const height = canvas.height;
    const frameCount = this.options.frameCount ?? 1;
    const fps = this.options.fps ?? 10;
    const interval = 1000 / fps;
    const delay = Math.round(interval);

    const ctx = (canvas instanceof OffscreenCanvas
      ? canvas.getContext("2d")
      : canvas.getContext("2d")) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

    if (!ctx) throw new Error("Could not get 2D context from canvas");

    const frames: EncodeFrame[] = [];

    if (frameCount === 1) {
      signal?.throwIfAborted();
      const imageData = ctx.getImageData(0, 0, width, height);
      frames.push({ data: imageData.data, delay });
      onProgress?.(1, 1);
    } else {
      for (let i = 0; i < frameCount; i++) {
        signal?.throwIfAborted();

        if (i > 0) {
          await new Promise<void>((resolve) => {
            const start = performance.now();
            const tick = () => {
              if (performance.now() - start >= interval) resolve();
              else requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
          });
        }

        const imageData = ctx.getImageData(0, 0, width, height);
        frames.push({ data: imageData.data, delay });
        onProgress?.(i + 1, frameCount);
      }
    }

    return { frames, width, height };
  }
}
