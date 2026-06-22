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
  /** RGB tolerance for "unchanged" pixels. 0 = lossless, 2–5 = visually lossless. Default 0. */
  frameDiffTolerance?: number;
  /** Enable disposal method optimization. Default true. */
  disposalOptimize?: boolean;
  /** Erode transparent mask by N pixels (keeps dithered borders intact). Default 0. */
  frameDiffErode?: number;
  /** Distance mode for pixel comparison. 'max' = per-channel max, 'sum' = channel sum. Default 'max'. */
  frameDiffDistanceMode?: "max" | "sum";
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
  optimize: { frameDiff: boolean; frameDiffTolerance: number; disposalOptimize: boolean; frameDiffErode?: number; frameDiffDistanceMode?: "max" | "sum" };
}

const PRESETS: Record<string, ResolvedOptions> = {
  quality: {
    quantizer: "imagequant",
    quality: 1,
    imagequantQuality: 90,
    imagequantSpeed: 4,
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
    imagequantSpeed: 6,
    palette: "crossframe",
    dither: "floyd-steinberg",
    ditherSerpentine: true,
    temporalDither: false,
    temporalWeight: 0,
    lossyLzw: 0,
    loop: 0,
    optimize: { frameDiff: true, frameDiffTolerance: 2, disposalOptimize: true },
  },
  speed: {
    quantizer: "neuquant",
    quality: 10,
    imagequantQuality: 60,
    imagequantSpeed: 10,
    palette: "crossframe",
    dither: false,
    ditherSerpentine: true,
    temporalDither: false,
    temporalWeight: 0,
    lossyLzw: 0,
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

      let pixels: Uint8Array;
      let palette: Uint8Array;

      if (result) {
        pixels = result.indexed;
        palette = result.palette;
      } else {
        palette = neuquant(frames[i].data, opts.quality);
        pixels = floydSteinberg(frames[i].data, width, height, palette, opts.ditherSerpentine);
      }

      indexed[i] = {
        indexedPixels: pixels,
        palette,
        delay: Math.round((frames[i].delay ?? 100) / 10),
      };
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
      lzwEncoder: buildLzwEncoder(opts.lossyLzw, gifFrames),
    });
  }

  const pixelCount = width * height;
  const gifFrames: GifFrame[] = new Array(frames.length);

  if (opts.quantizer === "imagequant") {
    // Imagequant path: punch transparent holes into dithered output.
    // imagequant dithers the full frame for optimal quality. We then
    // overwrite unchanged pixels with a transparent index and crop.
    for (let i = 0; i < indexed.length; i++) {
      const f = indexed[i];

      if (i === 0) {
        gifFrames[0] = {
          indexedPixels: f.indexedPixels, palette: f.palette, width, height,
          delay: f.delay, disposal: 0,
        };
      } else {
        const result = punchTransparentHoles(
          f.indexedPixels, f.palette,
          frames[i].data, frames[i - 1].data,
          width, height, opts.optimize.frameDiffTolerance,
          opts.optimize.frameDiffErode ?? 0,
          opts.optimize.frameDiffDistanceMode ?? "max",
        );
        gifFrames[i] = {
          indexedPixels: result.indexedPixels, palette: f.palette,
          width: result.width, height: result.height,
          left: result.left, top: result.top,
          transparentIndex: result.transparentIndex,
          delay: f.delay, disposal: 0,
        };
      }
    }
  } else {
    // NeuQuant path: RGBA-based frame diff (existing approach)
    const disposals = opts.optimize.disposalOptimize
      ? optimizeDisposals(frames, width, height, opts.optimize.frameDiffTolerance)
      : new Array<number>(frames.length).fill(0);

    let prevRgba: Uint8ClampedArray | Uint8Array = new Uint8Array(pixelCount * 4);

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
  }

  return writeGif(gifFrames, {
    width, height, loop: opts.loop,
    lzwEncoder: buildLzwEncoder(opts.lossyLzw, gifFrames),
  });
}

function punchTransparentHoles(
  currentIndexed: Uint8Array,
  palette: Uint8Array,
  currentRgba: Uint8ClampedArray,
  prevRgba: Uint8ClampedArray,
  w: number,
  h: number,
  tolerance: number,
  erode: number = 0,
  distanceMode: "max" | "sum" = "max",
): { indexedPixels: Uint8Array; transparentIndex: number; left: number; top: number; width: number; height: number } {
  const pixelCount = w * h;
  const changed = new Uint8Array(pixelCount);

  for (let i = 0; i < pixelCount; i++) {
    const si = i << 2;
    const dr = currentRgba[si] - prevRgba[si];
    const dg = currentRgba[si + 1] - prevRgba[si + 1];
    const db = currentRgba[si + 2] - prevRgba[si + 2];
    const adr = dr < 0 ? -dr : dr;
    const adg = dg < 0 ? -dg : dg;
    const adb = db < 0 ? -db : db;
    const dist = distanceMode === "sum" ? adr + adg + adb : Math.max(adr, adg, adb);
    if (dist > tolerance) changed[i] = 1;
  }

  // Erode transparent mask: any transparent pixel adjacent to a changed
  // pixel (8-connected) becomes changed. Keeps a dithered border intact.
  for (let e = 0; e < erode; e++) {
    const expand = new Uint8Array(pixelCount);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!changed[y * w + x]) continue;
        const y0 = y > 0 ? y - 1 : 0;
        const y1 = y < h - 1 ? y + 1 : h - 1;
        const x0 = x > 0 ? x - 1 : 0;
        const x1 = x < w - 1 ? x + 1 : w - 1;
        for (let dy = y0; dy <= y1; dy++)
          for (let dx = x0; dx <= x1; dx++)
            expand[dy * w + dx] = 1;
      }
    }
    for (let i = 0; i < pixelCount; i++) if (expand[i]) changed[i] = 1;
  }

  // Bounding box + usedByChanged
  const usedByChanged = new Uint8Array(256);
  let minX = w, maxX = -1, minY = h, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (changed[i]) {
        usedByChanged[currentIndexed[i]] = 1;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < 0) {
    return { indexedPixels: new Uint8Array([0]), transparentIndex: 0, left: 0, top: 0, width: 1, height: 1 };
  }

  const numColors = palette.length / 3;
  let palBits = 1;
  while ((1 << palBits) < numColors) palBits++;
  const maxIdx = (1 << palBits) - 1;

  let tIdx = -1;
  for (let i = maxIdx; i >= 0; i--) {
    if (!usedByChanged[i]) { tIdx = i; break; }
  }
  if (tIdx < 0) {
    return { indexedPixels: currentIndexed.slice(), transparentIndex: -1, left: 0, top: 0, width: w, height: h };
  }

  const cw = maxX - minX + 1;
  const ch = maxY - minY + 1;
  const out = new Uint8Array(cw * ch);
  for (let cy = 0; cy < ch; cy++) {
    for (let cx = 0; cx < cw; cx++) {
      const srcI = (minY + cy) * w + (minX + cx);
      out[cy * cw + cx] = changed[srcI] ? currentIndexed[srcI] : tIdx;
    }
  }

  return { indexedPixels: out, transparentIndex: tIdx, left: minX, top: minY, width: cw, height: ch };
}

function buildLzwEncoder(
  lossyLzw: number,
  gifFrames: GifFrame[],
): ((pixels: Uint8Array, minCodeSize: number) => Uint8Array) | undefined {
  if (lossyLzw <= 0) return undefined;
  let frameIdx = 0;
  return (pixels: Uint8Array, minCodeSize: number) => {
    const f = gifFrames[Math.min(frameIdx, gifFrames.length - 1)];
    frameIdx++;
    return lzwEncodeLossy(pixels, f.palette, minCodeSize, lossyLzw, f.transparentIndex ?? -1);
  };
}
