import type { EncodeFrame } from "../../index.js";
import type { FrameSource, ExtractedFrames } from "../types.js";

/**
 * Pass-through source for raw pixel data.
 *
 * Accepts ImageData objects or raw Uint8ClampedArray RGBA buffers.
 */
export class FramesSource implements FrameSource {
  constructor(
    private rawFrames: Array<ImageData | Uint8ClampedArray>,
    private width: number,
    private height: number,
    private delay: number = 100,
  ) {}

  async extract(
    onProgress?: (extracted: number, total: number) => void,
    signal?: AbortSignal,
  ): Promise<ExtractedFrames> {
    const frames: EncodeFrame[] = [];
    const total = this.rawFrames.length;

    for (let i = 0; i < total; i++) {
      signal?.throwIfAborted();
      const raw = this.rawFrames[i];
      const data = raw instanceof Uint8ClampedArray ? raw : raw.data;
      frames.push({ data, delay: this.delay });
      onProgress?.(i + 1, total);
    }

    return { frames, width: this.width, height: this.height };
  }
}
