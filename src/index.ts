/**
 * gifhero — the highest-quality GIF encoder for the browser.
 *
 * @module gifhero
 */

import { neuquant } from "./quantizers/index.js";
import { floydSteinberg, mapNearest } from "./dither/index.js";
import { writeGif } from "./encoder/index.js";
import type { GifFrame } from "./encoder/index.js";

export const VERSION = "0.0.1";

// ── Re-exports ───────────────────────────────────────────────────

export { writeGif, lzwEncode } from "./encoder/index.js";
export type { GifFrame, GifWriterOptions } from "./encoder/index.js";
export { neuquant } from "./quantizers/index.js";
export { floydSteinberg, mapNearest } from "./dither/index.js";

// ── High-level encode API ────────────────────────────────────────

/** A single animation frame with RGBA pixel data. */
export interface EncodeFrame {
  /** RGBA pixel data (4 bytes per pixel, row-major). */
  data: Uint8ClampedArray;
  /** Frame display duration in milliseconds. Default 100. */
  delay?: number;
}

/** Options for the high-level encode function. */
export interface EncodeOptions {
  /** Canvas width in pixels. */
  width: number;
  /** Canvas height in pixels. */
  height: number;
  /** One or more frames to encode. */
  frames: EncodeFrame[];
  /** NeuQuant sampling quality 1–30 (1 = best, 30 = fastest). Default 10. */
  quality?: number;
  /** Dithering method, or false to disable. Default 'floyd-steinberg'. */
  dither?: "floyd-steinberg" | false;
  /** Serpentine scanning for error diffusion. Default true. */
  ditherSerpentine?: boolean;
  /** Loop count: 0 = forever, N > 0 = N times, < 0 = no loop. Default 0. */
  loop?: number;
}

/**
 * Encode RGBA frames into a GIF.
 *
 * Pipeline: NeuQuant quantize → Floyd-Steinberg dither → GIF89a write.
 * Each frame gets a per-frame local palette for maximum quality.
 *
 * @param options - Frames, dimensions, and encoding settings
 * @returns Complete GIF file as a byte array
 */
export function encode(options: EncodeOptions): Uint8Array {
  const {
    width,
    height,
    frames,
    quality = 10,
    dither = "floyd-steinberg",
    ditherSerpentine = true,
    loop = 0,
  } = options;

  if (frames.length === 0) {
    throw new Error("At least one frame is required");
  }

  const gifFrames: GifFrame[] = new Array(frames.length);

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    const palette = neuquant(frame.data, quality);

    const indexedPixels =
      dither === "floyd-steinberg"
        ? floydSteinberg(frame.data, width, height, palette, ditherSerpentine)
        : mapNearest(frame.data, palette);

    gifFrames[i] = {
      indexedPixels,
      palette,
      width,
      height,
      delay: Math.round((frame.delay ?? 100) / 10),
    };
  }

  return writeGif(gifFrames, { width, height, loop });
}
