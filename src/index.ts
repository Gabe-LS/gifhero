/**
 * gifhero — the highest-quality GIF encoder for the browser.
 *
 * @module gifhero
 */

import { neuquant } from "./quantizers/index.js";
import { quantizeImagequant } from "./quantizers/imagequant.js";
import { floydSteinberg, mapNearest } from "./dither/index.js";
import { ditherFrameTemporal } from "./dither/temporal.js";
import type { TemporalDitherState } from "./dither/temporal.js";
import { writeGif } from "./encoder/index.js";
import { lzwEncodeLossy } from "./encoder/lossy-lzw.js";
import type { GifFrame } from "./encoder/index.js";
import {
  computeFrameDiff,
  optimizeDisposals,
  generatePalettes,
} from "./optimize/index.js";
import type { PaletteStrategy } from "./optimize/index.js";

export const VERSION = "0.0.1";

// ── Re-exports ───────────────────────────────────────────────────

export { writeGif, lzwEncode, lzwEncodeLossy } from "./encoder/index.js";
export type { GifFrame, GifWriterOptions } from "./encoder/index.js";
export { neuquant, quantizeImagequant } from "./quantizers/index.js";
export type { ImagequantOptions } from "./quantizers/index.js";
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
  /** Quantizer algorithm. 'imagequant' requires the optional `imagequant` npm package. */
  quantizer?: "imagequant" | "neuquant";
  /** NeuQuant sampling quality 1–30 (1 = best, 30 = fastest). Only used when quantizer='neuquant'. */
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
  /** Lossy LZW compression level. 0 = off (default), 20–200 = lossy level. */
  lossyLzw?: number;
  /** Loop count: 0 = forever, N > 0 = N times, < 0 = no loop. Default 0. */
  loop?: number;
  /** Frame optimization settings. Omit or set false to disable all optimization. */
  optimize?: OptimizeOptions | false;
}

// ── Presets ───────────────────────────────────────────────────────

interface ResolvedOptions {
  quantizer: "imagequant" | "neuquant";
  quality: number;
  imagequantQuality: number;
  imagequantSpeed: number;
  palette: PaletteStrategy;
  dither: "floyd-steinberg" | false;
  ditherSerpentine: boolean;
  temporalDither: boolean;
  temporalWeight: number;
  lossyLzw: number;
  loop: number;
  optimize: { frameDiff: boolean; frameDiffTolerance: number; disposalOptimize: boolean };
}

const PRESETS: Record<string, ResolvedOptions> = {
  quality: {
    quantizer: "imagequant",
    quality: 1,
    imagequantQuality: 90,
    imagequantSpeed: 1,
    palette: "crossframe",
    dither: "floyd-steinberg",
    ditherSerpentine: true,
    temporalDither: false,
    temporalWeight: 0,
    lossyLzw: 0,
    loop: 0,
    optimize: { frameDiff: true, frameDiffTolerance: 0, disposalOptimize: true },
  },
  balanced: {
    quantizer: "imagequant",
    quality: 3,
    imagequantQuality: 80,
    imagequantSpeed: 3,
    palette: "crossframe",
    dither: "floyd-steinberg",
    ditherSerpentine: true,
    temporalDither: false,
    temporalWeight: 0,
    lossyLzw: 30,
    loop: 0,
    optimize: { frameDiff: true, frameDiffTolerance: 2, disposalOptimize: true },
  },
  speed: {
    quantizer: "neuquant",
    quality: 10,
    imagequantQuality: 60,
    imagequantSpeed: 10,
    palette: "crossframe",
    dither: "floyd-steinberg",
    ditherSerpentine: true,
    temporalDither: false,
    temporalWeight: 0,
    lossyLzw: 80,
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
    quantizer: options.quantizer ?? base.quantizer,
    quality: options.quality ?? base.quality,
    imagequantQuality: base.imagequantQuality,
    imagequantSpeed: base.imagequantSpeed,
    palette: options.palette ?? base.palette,
    dither: options.dither !== undefined ? options.dither : base.dither,
    ditherSerpentine: options.ditherSerpentine ?? base.ditherSerpentine,
    temporalDither: options.temporalDither ?? base.temporalDither,
    temporalWeight: options.temporalWeight ?? base.temporalWeight,
    lossyLzw: options.lossyLzw ?? base.lossyLzw,
    loop: options.loop ?? base.loop,
    optimize: userOpt,
  };
}

// ── Encode ────────────────────────────────────────────────────────

/**
 * Encode RGBA frames into a GIF.
 *
 * Pipeline: quantize (imagequant or NeuQuant) → dither → frame optimize → LZW → GIF89a.
 *
 * @param options - Frames, dimensions, and encoding settings
 * @returns Complete GIF file as a byte array
 */
export async function encode(options: EncodeOptions): Promise<Uint8Array> {
  const { width, height, frames } = options;

  if (frames.length === 0) {
    throw new Error("At least one frame is required");
  }

  const opts = resolveOptions(options);

  // ── Phase 1: Generate palettes + dither ──

  const indexed: Array<{
    indexedPixels: Uint8Array;
    palette: Uint8Array;
    delay: number;
  }> = new Array(frames.length);

  if (opts.quantizer === "imagequant") {
    for (let i = 0; i < frames.length; i++) {
      const result = await quantizeImagequant(
        frames[i].data, width, height,
        { quality: opts.imagequantQuality, speed: opts.imagequantSpeed, maxColors: 256 },
      );

      if (result) {
        indexed[i] = {
          indexedPixels: result.indexed,
          palette: result.palette,
          delay: Math.round((frames[i].delay ?? 100) / 10),
        };
      } else {
        const palette = neuquant(frames[i].data, opts.quality);
        indexed[i] = {
          indexedPixels: floydSteinberg(frames[i].data, width, height, palette, opts.ditherSerpentine),
          palette,
          delay: Math.round((frames[i].delay ?? 100) / 10),
        };
      }
    }
  } else {
    const palettes = generatePalettes(frames, opts.palette, opts.quality);

    if (opts.temporalDither && opts.dither === "floyd-steinberg" && frames.length > 1) {
      let temporalState: TemporalDitherState | null = null;
      for (let i = 0; i < frames.length; i++) {
        const prevRgba = i > 0 ? frames[i - 1].data : null;
        const { indexed: pixels, nextState } = ditherFrameTemporal(
          frames[i].data, width, height, palettes[i], temporalState, prevRgba,
          { spatialWeight: 1.0, temporalWeight: opts.temporalWeight, serpentine: opts.ditherSerpentine },
        );
        indexed[i] = { indexedPixels: pixels, palette: palettes[i], delay: Math.round((frames[i].delay ?? 100) / 10) };
        temporalState = nextState;
      }
    } else {
      for (let i = 0; i < frames.length; i++) {
        const pixels = opts.dither === "floyd-steinberg"
          ? floydSteinberg(frames[i].data, width, height, palettes[i], opts.ditherSerpentine)
          : mapNearest(frames[i].data, palettes[i]);
        indexed[i] = { indexedPixels: pixels, palette: palettes[i], delay: Math.round((frames[i].delay ?? 100) / 10) };
      }
    }
  }

  // ── Phase 2: Optimize (frame diff + disposal) ──

  const useOptimize = opts.optimize.frameDiff && frames.length > 1;

  if (!useOptimize) {
    const gifFrames: GifFrame[] = indexed.map((f) => ({
      indexedPixels: f.indexedPixels,
      palette: f.palette,
      width,
      height,
      delay: f.delay,
    }));
    return writeGif(gifFrames, {
      width, height, loop: opts.loop,
      lzwEncoder: buildLzwEncoder(opts.lossyLzw, indexed),
    });
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
        indexedPixels: f.indexedPixels, palette: f.palette, width, height,
        delay: f.delay, disposal: disposals[0],
      };
    } else {
      const diff = computeFrameDiff(
        f.indexedPixels, frames[i].data, prevRgba,
        width, height, opts.optimize.frameDiffTolerance,
      );
      gifFrames[i] = {
        indexedPixels: diff.indexedPixels, palette: f.palette,
        width: diff.width, height: diff.height, left: diff.left, top: diff.top,
        transparentIndex: diff.transparentIndex >= 0 ? diff.transparentIndex : undefined,
        delay: f.delay, disposal: disposals[i],
      };
    }

    if (disposals[i] === 2) {
      prevRgba = new Uint8Array(pixelCount * 4);
    } else {
      prevRgba = frames[i].data;
    }
  }

  return writeGif(gifFrames, {
    width, height, loop: opts.loop,
    lzwEncoder: buildLzwEncoder(opts.lossyLzw, indexed),
  });
}

function buildLzwEncoder(
  lossyLzw: number,
  indexed: Array<{ palette: Uint8Array }>,
): ((pixels: Uint8Array, minCodeSize: number) => Uint8Array) | undefined {
  if (lossyLzw <= 0) return undefined;
  let frameIdx = 0;
  return (pixels: Uint8Array, minCodeSize: number) => {
    const palette = indexed[Math.min(frameIdx, indexed.length - 1)].palette;
    frameIdx++;
    return lzwEncodeLossy(pixels, palette, minCodeSize, lossyLzw);
  };
}
