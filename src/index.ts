/**
 * gifhero — the highest-quality GIF encoder for the browser.
 *
 * @module gifhero
 */

import { neuquant } from "./quantizers/index.js";
import { floydSteinberg, mapNearest } from "./dither/index.js";
import { writeGif } from "./encoder/index.js";
import type { GifFrame } from "./encoder/index.js";
import {
  computeFrameDiff,
  optimizeDisposals,
} from "./optimize/index.js";

export const VERSION = "0.0.1";

// ── Re-exports ───────────────────────────────────────────────────

export { writeGif, lzwEncode } from "./encoder/index.js";
export type { GifFrame, GifWriterOptions } from "./encoder/index.js";
export { neuquant } from "./quantizers/index.js";
export { floydSteinberg, mapNearest } from "./dither/index.js";
export {
  computeFrameDiff,
  optimizeDisposals,
} from "./optimize/index.js";
export type { FrameDiffResult } from "./optimize/index.js";

// ── High-level encode API ────────────────────────────────────────

/** A single animation frame with RGBA pixel data. */
export interface EncodeFrame {
  /** RGBA pixel data (4 bytes per pixel, row-major). */
  data: Uint8ClampedArray;
  /** Frame display duration in milliseconds. Default 100. */
  delay?: number;
}

/** Frame optimization settings. */
export interface OptimizeOptions {
  /** Enable frame differencing (delta encoding). Default true. */
  frameDiff?: boolean;
  /** L1 RGB tolerance for "unchanged" pixels. 0 = lossless, 2–5 = visually lossless. Default 0. */
  frameDiffTolerance?: number;
  /** Enable disposal method optimization. Default true. */
  disposalOptimize?: boolean;
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
  /** Frame optimization settings. Omit or set false to disable all optimization. */
  optimize?: OptimizeOptions | false;
}

/**
 * Encode RGBA frames into a GIF.
 *
 * Pipeline: NeuQuant quantize → Floyd-Steinberg dither → optimize → GIF89a write.
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

  // ── 1. Quantize + dither every frame ──

  const indexed: Array<{
    indexedPixels: Uint8Array;
    palette: Uint8Array;
    delay: number;
  }> = new Array(frames.length);

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    const palette = neuquant(frame.data, quality);
    const pixels =
      dither === "floyd-steinberg"
        ? floydSteinberg(frame.data, width, height, palette, ditherSerpentine)
        : mapNearest(frame.data, palette);

    indexed[i] = {
      indexedPixels: pixels,
      palette,
      delay: Math.round((frame.delay ?? 100) / 10),
    };
  }

  // ── 2. Optimize (frame diff + disposal) ──

  const opt =
    options.optimize === false
      ? { frameDiff: false, frameDiffTolerance: 0, disposalOptimize: false }
      : {
          frameDiff: true,
          frameDiffTolerance: 0,
          disposalOptimize: true,
          ...options.optimize,
        };

  const useOptimize = opt.frameDiff && frames.length > 1;

  if (!useOptimize) {
    const gifFrames: GifFrame[] = indexed.map((f) => ({
      indexedPixels: f.indexedPixels,
      palette: f.palette,
      width,
      height,
      delay: f.delay,
    }));
    return writeGif(gifFrames, { width, height, loop });
  }

  // Choose disposal methods (using source RGBA for accurate comparison)
  const disposals = opt.disposalOptimize
    ? optimizeDisposals(frames, width, height, opt.frameDiffTolerance)
    : new Array<number>(frames.length).fill(0);

  // Build delta frames. Track what the viewer "should see" as source RGBA
  // so consecutive identical source pixels are correctly detected, even
  // when per-frame NeuQuant palettes differ.
  const pixelCount = width * height;
  let prevRgba: Uint8ClampedArray | Uint8Array = new Uint8Array(pixelCount * 4);
  const gifFrames: GifFrame[] = new Array(frames.length);

  for (let i = 0; i < indexed.length; i++) {
    const f = indexed[i];

    if (i === 0) {
      gifFrames[0] = {
        indexedPixels: f.indexedPixels,
        palette: f.palette,
        width,
        height,
        delay: f.delay,
        disposal: disposals[0],
      };
    } else {
      const diff = computeFrameDiff(
        f.indexedPixels,
        frames[i].data,
        prevRgba,
        width,
        height,
        opt.frameDiffTolerance,
      );

      gifFrames[i] = {
        indexedPixels: diff.indexedPixels,
        palette: f.palette,
        width: diff.width,
        height: diff.height,
        left: diff.left,
        top: diff.top,
        transparentIndex:
          diff.transparentIndex >= 0 ? diff.transparentIndex : undefined,
        delay: f.delay,
        disposal: disposals[i],
      };
    }

    // Update canvas reference for next frame's comparison
    if (disposals[i] === 2) {
      prevRgba = new Uint8Array(pixelCount * 4); // cleared to black
    } else {
      prevRgba = frames[i].data; // source RGBA
    }
  }

  return writeGif(gifFrames, { width, height, loop });
}
