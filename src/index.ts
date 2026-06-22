/**
 * gifhero — the highest-quality GIF encoder for the browser.
 *
 * @module gifhero
 */

import { neuquant } from "./quantizers/index.js";
import { floydSteinberg, mapNearest } from "./dither/index.js";
import { ditherFrameTemporal } from "./dither/temporal.js";
import type { TemporalDitherState } from "./dither/temporal.js";
import { writeGif } from "./encoder/index.js";
import type { GifFrame } from "./encoder/index.js";
import {
  computeFrameDiff,
  optimizeDisposals,
  generatePalettes,
} from "./optimize/index.js";
import type { PaletteStrategy } from "./optimize/index.js";

export const VERSION = "0.0.1";

// ── Re-exports ───────────────────────────────────────────────────

export { writeGif, lzwEncode } from "./encoder/index.js";
export type { GifFrame, GifWriterOptions } from "./encoder/index.js";
export { neuquant } from "./quantizers/index.js";
export { floydSteinberg, mapNearest } from "./dither/index.js";
export { ditherFrameTemporal } from "./dither/temporal.js";
export type { TemporalDitherState } from "./dither/temporal.js";
export {
  computeFrameDiff,
  optimizeDisposals,
  generatePalettes,
} from "./optimize/index.js";
export type { FrameDiffResult, PaletteStrategy } from "./optimize/index.js";

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
  /** Preset that sets defaults for all options. Individual options override preset values. */
  preset?: "quality" | "balanced" | "speed";
  /** NeuQuant sampling quality 1–30 (1 = best, 30 = fastest). */
  quality?: number;
  /** Palette strategy for multi-frame animations. */
  palette?: PaletteStrategy;
  /** Dithering method, or false to disable. */
  dither?: "floyd-steinberg" | false;
  /** Serpentine scanning for error diffusion. */
  ditherSerpentine?: boolean;
  /** Enable temporal dithering (cross-frame error diffusion). */
  temporalDither?: boolean;
  /** Temporal error weight 0.0–1.0 for temporal dithering. */
  temporalWeight?: number;
  /** Loop count: 0 = forever, N > 0 = N times, < 0 = no loop. Default 0. */
  loop?: number;
  /** Frame optimization settings. Omit or set false to disable all optimization. */
  optimize?: OptimizeOptions | false;
}

// ── Presets ───────────────────────────────────────────────────────

interface ResolvedOptions {
  quality: number;
  palette: PaletteStrategy;
  dither: "floyd-steinberg" | false;
  ditherSerpentine: boolean;
  temporalDither: boolean;
  temporalWeight: number;
  loop: number;
  optimize: { frameDiff: boolean; frameDiffTolerance: number; disposalOptimize: boolean };
}

const PRESETS: Record<string, ResolvedOptions> = {
  quality: {
    quality: 1,
    palette: "crossframe",
    dither: "floyd-steinberg",
    ditherSerpentine: true,
    temporalDither: true,
    temporalWeight: 0.3,
    loop: 0,
    optimize: { frameDiff: true, frameDiffTolerance: 0, disposalOptimize: true },
  },
  balanced: {
    quality: 10,
    palette: "adaptive",
    dither: "floyd-steinberg",
    ditherSerpentine: true,
    temporalDither: true,
    temporalWeight: 0.2,
    loop: 0,
    optimize: { frameDiff: true, frameDiffTolerance: 2, disposalOptimize: true },
  },
  speed: {
    quality: 20,
    palette: "global",
    dither: "floyd-steinberg",
    ditherSerpentine: true,
    temporalDither: false,
    temporalWeight: 0,
    loop: 0,
    optimize: { frameDiff: true, frameDiffTolerance: 5, disposalOptimize: false },
  },
};

function resolveOptions(options: EncodeOptions): ResolvedOptions {
  const base = PRESETS[options.preset ?? "balanced"];

  const userOpt =
    options.optimize === false
      ? { frameDiff: false, frameDiffTolerance: 0, disposalOptimize: false }
      : options.optimize
        ? { ...base.optimize, ...options.optimize }
        : base.optimize;

  return {
    quality: options.quality ?? base.quality,
    palette: options.palette ?? base.palette,
    dither: options.dither !== undefined ? options.dither : base.dither,
    ditherSerpentine: options.ditherSerpentine ?? base.ditherSerpentine,
    temporalDither: options.temporalDither ?? base.temporalDither,
    temporalWeight: options.temporalWeight ?? base.temporalWeight,
    loop: options.loop ?? base.loop,
    optimize: userOpt,
  };
}

// ── Encode ────────────────────────────────────────────────────────

/**
 * Encode RGBA frames into a GIF.
 *
 * Pipeline: palette strategy → dither (temporal or spatial) → frame optimize → GIF89a write.
 *
 * @param options - Frames, dimensions, and encoding settings
 * @returns Complete GIF file as a byte array
 */
export function encode(options: EncodeOptions): Uint8Array {
  const { width, height, frames } = options;

  if (frames.length === 0) {
    throw new Error("At least one frame is required");
  }

  const opts = resolveOptions(options);

  // ── Phase 1: Generate palettes ──

  const palettes = generatePalettes(frames, opts.palette, opts.quality);

  // ── Phase 2: Dither frames ──

  const indexed: Array<{
    indexedPixels: Uint8Array;
    palette: Uint8Array;
    delay: number;
  }> = new Array(frames.length);

  if (opts.temporalDither && opts.dither === "floyd-steinberg" && frames.length > 1) {
    let temporalState: TemporalDitherState | null = null;

    for (let i = 0; i < frames.length; i++) {
      const prevRgba = i > 0 ? frames[i - 1].data : null;

      const { indexed: pixels, nextState } = ditherFrameTemporal(
        frames[i].data,
        width,
        height,
        palettes[i],
        temporalState,
        prevRgba,
        {
          spatialWeight: 1.0 - opts.temporalWeight,
          temporalWeight: opts.temporalWeight,
          serpentine: opts.ditherSerpentine,
        },
      );

      indexed[i] = {
        indexedPixels: pixels,
        palette: palettes[i],
        delay: Math.round((frames[i].delay ?? 100) / 10),
      };

      temporalState = nextState;
    }
  } else {
    for (let i = 0; i < frames.length; i++) {
      const pixels =
        opts.dither === "floyd-steinberg"
          ? floydSteinberg(frames[i].data, width, height, palettes[i], opts.ditherSerpentine)
          : mapNearest(frames[i].data, palettes[i]);

      indexed[i] = {
        indexedPixels: pixels,
        palette: palettes[i],
        delay: Math.round((frames[i].delay ?? 100) / 10),
      };
    }
  }

  // ── Phase 3: Optimize (frame diff + disposal) ──

  const useOptimize = opts.optimize.frameDiff && frames.length > 1;

  if (!useOptimize) {
    const gifFrames: GifFrame[] = indexed.map((f) => ({
      indexedPixels: f.indexedPixels,
      palette: f.palette,
      width,
      height,
      delay: f.delay,
    }));
    return writeGif(gifFrames, { width, height, loop: opts.loop });
  }

  const disposals = opts.optimize.disposalOptimize
    ? optimizeDisposals(frames, width, height, opts.optimize.frameDiffTolerance)
    : new Array<number>(frames.length).fill(0);

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
        opts.optimize.frameDiffTolerance,
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

    if (disposals[i] === 2) {
      prevRgba = new Uint8Array(pixelCount * 4);
    } else {
      prevRgba = frames[i].data;
    }
  }

  return writeGif(gifFrames, { width, height, loop: opts.loop });
}
