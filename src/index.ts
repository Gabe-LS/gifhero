/**
 * gifhero — the highest-quality GIF encoder for the browser.
 *
 * @module gifhero
 */

import { neuquant } from "./quantizers/index.js";
// Lazy import — imagequant.ts uses Node.js APIs (fs, zlib) that
// aren't available in browsers. Only loaded when the fallback
// npm imagequant package is actually needed.
// Computed path prevents bundlers from resolving this statically.
// imagequant.ts uses Node.js APIs (fs, zlib) — must not be bundled
// into browser builds.
async function getQuantizeImagequant(): Promise<(rgba: Uint8ClampedArray, w: number, h: number, opts: any) => Promise<any>> {
  const modPath = "./quantizers/imagequant.js";
  const m = await import(/* @vite-ignore */ modPath);
  return m.quantizeImagequant;
}
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
  cropRgba,
  findChangedBbox,
  buildSubframe,
  compositeOntoCanvas,
  decodeFrameToCanvas,
  trimPalette,
  countUsedColors,
} from "./optimize/index.js";
import type { PaletteStrategy } from "./optimize/index.js";
import { probeFrames, IncrementalProbe } from "./probe.js";
import type { ProbeResult } from "./probe.js";
// Pure-JS Lanczos3 re-exported for external consumers; internal
// pipeline uses the WASM version (downsampleWasm) from imagequant-gif.
import {
  quantizeWithBackground as gifQuantBg,
  quantizeSimple as gifQuantSimple,
  buildSharedPalette as gifBuildPalette,
  remapWithPalette as gifRemapPalette,
  downsampleWasm,
} from "./quantizers/imagequant-gif.js";
import type { GifQuantResult } from "./quantizers/imagequant-gif.js";

export const VERSION = "0.0.1";

export { probeFrames, IncrementalProbe } from "./probe.js";
export type { ProbeResult } from "./probe.js";
export { downsample, resizeFrames } from "./resize.js";

// ── Re-exports ───────────────────────────────────────────────────

export { writeGif, lzwEncode, lzwEncodeLossy } from "./encoder/index.js";
export type { GifFrame, GifWriterOptions } from "./encoder/index.js";
export { neuquant } from "./quantizers/index.js";
export type { ImagequantOptions } from "./quantizers/index.js";
export { floydSteinberg, mapNearest } from "./dither/index.js";
export { ditherFrameTemporal } from "./dither/temporal.js";
export type { TemporalDitherState } from "./dither/temporal.js";
export {
  computeFrameDiff,
  optimizeDisposals,
  generatePalettes,
  cropRgba,
  findChangedBbox,
  buildSubframe,
  compositeOntoCanvas,
  decodeFrameToCanvas,
  trimPalette,
  countUsedColors,
} from "./optimize/index.js";
export type { FrameDiffResult, PaletteStrategy, SubframeResult } from "./optimize/index.js";

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
  /** Enable sub-frame encoding (crop → quantize → punch holes). Default true. */
  subframe?: boolean;
  /** Bounding-box noise filter: max per-channel diff to include in crop. Default 5. */
  cropTolerance?: number;
  /** Hole-punch tolerance: max per-channel diff to mark transparent. 0 = exact match. Default 0. */
  holeTolerance?: number;
  /** Flip isolated opaque pixels to transparent when surrounded by transparency. Default true. */
  transparencyEqualization?: boolean;
  /** Stale transparency threshold: max per-channel diff for canvas-acceptable pixels. Default 3. */
  staleThreshold?: number;
  /** Probe tolerance: max per-channel range for a pixel to be considered static. Default 3. */
  probeTolerance?: number;
  /** Transparency equalization: minimum transparent neighbors to flip opaque pixel to transparent. Default 6. */
  transeqNeighborThreshold?: number;
  /** Enable disposal method optimization (neuquant legacy path). Default true. */
  disposalOptimize?: boolean;
  /** Drop near-duplicate frames whose SSIM exceeds this threshold (0–1). Default 0 (disabled). */
  dropThreshold?: number;
  // Legacy options (used when subframe=false)
  /** @deprecated Use subframe instead. Enable frame differencing. */
  frameDiff?: boolean;
  /** @deprecated Use cropTolerance instead. RGB tolerance for "unchanged" pixels. */
  frameDiffTolerance?: number;
  /** @deprecated Erode transparent mask by N pixels. */
  frameDiffErode?: number;
  /** @deprecated Distance mode for pixel comparison. */
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
  preset?: "quality" | "balanced";
  /** Quantizer algorithm. 'imagequant' requires the optional `imagequant` npm package. */
  quantizer?: "imagequant" | "neuquant";
  /** NeuQuant sampling quality 1–30 (1 = best, 30 = fastest). Only used when quantizer='neuquant'. */
  quality?: number;
  /** Imagequant quality 0–100 (higher = better). Only used when quantizer='imagequant'. */
  imagequantQuality?: number;
  /** Imagequant speed 1–10 (1 = slowest/best, 10 = fastest). Only used when quantizer='imagequant'. */
  imagequantSpeed?: number;
  /** Maximum palette colors 2–256. Default 256. */
  maxColors?: number;
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
  /** Target width for downscaling (Lanczos3). Height auto-calculated from aspect ratio. Omit to encode at source size. */
  targetWidth?: number;
  /** Target height for downscaling. Omit to auto-calculate from targetWidth + aspect ratio. */
  targetHeight?: number;
  /** Frame optimization settings. Omit or set false to disable all optimization. */
  optimize?: OptimizeOptions | false;
  /** Pass a mutable object to collect per-stage timing (ms). Populated by encode(). */
  timing?: Record<string, number>;
}

// ── Presets ───────────────────────────────────────────────────────

interface ResolvedOptimize {
  subframe: boolean;
  cropTolerance: number;
  holeTolerance: number;
  transparencyEqualization: boolean;
  staleThreshold: number;
  probeTolerance: number;
  transeqNeighborThreshold: number;
  disposalOptimize: boolean;
  dropThreshold: number;
  // Legacy fields
  frameDiff: boolean;
  frameDiffTolerance: number;
  frameDiffErode: number;
  frameDiffDistanceMode: "max" | "sum";
}

interface ResolvedOptions {
  quantizer: "imagequant" | "neuquant";
  quantizerQuality: number;
  quantizerSpeed: number;
  maxColors: number;
  palette: PaletteStrategy;
  dither: "floyd-steinberg" | false;
  ditherSerpentine: boolean;
  temporalDither: boolean;
  temporalWeight: number;
  lossyLzw: number;
  loop: number;
  optimize: ResolvedOptimize;
}

const PRESETS: Record<string, ResolvedOptions> = {
  quality: {
    quantizer: "imagequant",
    quantizerQuality: 98,
    quantizerSpeed: 1,
    maxColors: 256,
    palette: "crossframe",
    dither: "floyd-steinberg",
    ditherSerpentine: true,
    temporalDither: false,
    temporalWeight: 0,
    lossyLzw: 4,
    loop: 0,
    optimize: {
      subframe: true,
      cropTolerance: 5,
      holeTolerance: 0,
      transparencyEqualization: true,
      staleThreshold: 3,
      probeTolerance: 3,
      transeqNeighborThreshold: 6,
      disposalOptimize: true,
      dropThreshold: 0,
      frameDiff: true,
      frameDiffTolerance: 0,
      frameDiffErode: 0,
      frameDiffDistanceMode: "max",
    },
  },
  balanced: {
    quantizer: "imagequant",
    quantizerQuality: 95,
    quantizerSpeed: 4,
    maxColors: 256,
    palette: "crossframe",
    dither: "floyd-steinberg",
    ditherSerpentine: true,
    temporalDither: false,
    temporalWeight: 0,
    lossyLzw: 4,
    loop: 0,
    optimize: {
      subframe: true,
      cropTolerance: 5,
      holeTolerance: 0,
      transparencyEqualization: true,
      staleThreshold: 8,
      probeTolerance: 3,
      transeqNeighborThreshold: 6,
      disposalOptimize: true,
      dropThreshold: 0,
      frameDiff: true,
      frameDiffTolerance: 0,
      frameDiffErode: 0,
      frameDiffDistanceMode: "max",
    },
  },
};

function resolveOptions(options: EncodeOptions): ResolvedOptions {
  const base = PRESETS[options.preset ?? "balanced"];

  let userOpt: ResolvedOptimize;
  if (options.optimize === false) {
    userOpt = {
      subframe: false, cropTolerance: 0, holeTolerance: 0,
      transparencyEqualization: false, staleThreshold: 3, probeTolerance: 3, transeqNeighborThreshold: 6,
      disposalOptimize: false, dropThreshold: 0,
      frameDiff: false, frameDiffTolerance: 0, frameDiffErode: 0, frameDiffDistanceMode: "max",
    };
  } else if (options.optimize) {
    const o = options.optimize;
    userOpt = {
      subframe: o.subframe ?? false,
      cropTolerance: o.cropTolerance ?? base.optimize.cropTolerance,
      holeTolerance: o.holeTolerance ?? base.optimize.holeTolerance,
      transparencyEqualization: o.transparencyEqualization ?? base.optimize.transparencyEqualization,
      staleThreshold: o.staleThreshold ?? base.optimize.staleThreshold,
      probeTolerance: o.probeTolerance ?? base.optimize.probeTolerance,
      transeqNeighborThreshold: o.transeqNeighborThreshold ?? base.optimize.transeqNeighborThreshold,
      disposalOptimize: o.disposalOptimize ?? base.optimize.disposalOptimize,
      dropThreshold: o.dropThreshold ?? base.optimize.dropThreshold,
      frameDiff: o.frameDiff ?? base.optimize.frameDiff,
      frameDiffTolerance: o.frameDiffTolerance ?? base.optimize.frameDiffTolerance,
      frameDiffErode: o.frameDiffErode ?? base.optimize.frameDiffErode,
      frameDiffDistanceMode: o.frameDiffDistanceMode ?? base.optimize.frameDiffDistanceMode,
    };
  } else {
    userOpt = base.optimize;
  }

  const quantizer = options.quantizer ?? base.quantizer;
  return {
    quantizer,
    quantizerQuality: quantizer === "neuquant"
      ? (options.quality ?? base.quantizerQuality)
      : (options.imagequantQuality ?? base.quantizerQuality),
    quantizerSpeed: options.imagequantSpeed ?? base.quantizerSpeed,
    maxColors: options.maxColors ?? base.maxColors,
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
 * @param options - Frames, dimensions, and encoding settings
 * @returns Complete GIF file as a byte array
 */
export async function encode(options: EncodeOptions): Promise<Uint8Array> {
  let { width, height } = options;
  let { frames } = options;
  const t = options.timing;
  let t0: number;

  if (frames.length === 0) {
    throw new Error("At least one frame is required");
  }

  // ── Downscale if requested (WASM Lanczos3) ──
  t0 = performance.now();
  const srcWidth = width;
  if (options.targetWidth && options.targetWidth < width) {
    const dstW = options.targetWidth;
    const dstH = options.targetHeight ?? Math.floor(height * (dstW / width));
    frames = frames.map((f) => ({
      data: downsampleWasm(f.data, width, height, dstW, dstH),
      delay: f.delay ?? (frames[0]?.delay ?? 100),
    }));
    width = dstW;
    height = dstH;
  }
  if (t) t.downscale = Math.round(performance.now() - t0);
  const downscaleRatio = srcWidth / width;

  const opts = resolveOptions(options);

  // ── Temporal denoise (balanced preset only) ──
  t0 = performance.now();
  const presetName = options.preset ?? "balanced";
  if (presetName === "balanced" && frames.length >= 3) {
    const numPixels = width * height;
    let subPerceptual = 0, changed = 0, totalChecked = 0;
    const step = Math.max(1, Math.floor(frames.length / 6));
    for (let f = step; f < frames.length; f += step) {
      const a = frames[f].data, b = frames[f - 1].data;
      for (let i = 0; i < numPixels; i++) {
        const si = i * 4;
        const maxDev = Math.max(
          Math.abs(a[si] - b[si]),
          Math.abs(a[si+1] - b[si+1]),
          Math.abs(a[si+2] - b[si+2]),
        );
        if (maxDev >= 1 && maxDev <= 2) subPerceptual++;
        if (maxDev > 5) changed++;
        totalChecked++;
      }
    }
    const hasNoise = totalChecked > 0 && subPerceptual / totalChecked > 0.05;
    const hasMotion = totalChecked > 0 && changed / totalChecked > 0.02;
    if (hasNoise && hasMotion) {
      denoiseFrames(frames, width, height, 3);
    }
  }
  if (t) t.denoise = Math.round(performance.now() - t0);

  // ── Phase 0: Drop near-duplicate frames ──

  const dropThreshold = opts.optimize.dropThreshold;
  if (dropThreshold > 0 && frames.length > 1) {
    const kept: EncodeFrame[] = [frames[0]];
    const pixelCount = width * height;
    for (let i = 1; i < frames.length; i++) {
      const prev = kept[kept.length - 1].data;
      const curr = frames[i].data;
      let sumSq = 0;
      let sumTotal = 0;
      for (let p = 0; p < pixelCount; p++) {
        const si = p << 2;
        for (let c = 0; c < 3; c++) {
          const d = curr[si + c] - prev[si + c];
          sumSq += d * d;
          sumTotal++;
        }
      }
      const mse = sumSq / sumTotal;
      const psnr = mse > 0 ? 10 * Math.log10(255 * 255 / mse) : 100;
      const ssimApprox = psnr > 48 ? 1.0 : psnr > 40 ? 0.999 : psnr > 35 ? 0.995 : psnr > 30 ? 0.99 : 0.98;
      if (ssimApprox > dropThreshold) {
        kept[kept.length - 1] = {
          ...kept[kept.length - 1],
          delay: (kept[kept.length - 1].delay ?? 100) + (frames[i].delay ?? 100),
        };
      } else {
        kept.push(frames[i]);
      }
    }
    frames = kept;
  }

  // ── Sub-frame pipeline ──

  if (opts.optimize.subframe && frames.length > 1) {
    const { gifFrames, probe } = await encodeSubframePipeline(frames, width, height, opts, downscaleRatio, presetName, t, options);

    const lzwComplexity = probe.motionLevel * probe.colorComplexity;
    const adaptiveLzw = options.lossyLzw !== undefined
      ? opts.lossyLzw
      : Math.min(5, Math.max(opts.lossyLzw, Math.round(opts.lossyLzw + lzwComplexity / 3000)));

    t0 = performance.now();
    const result = writeGif(gifFrames, {
      width, height, loop: opts.loop,
      lzwEncoder: buildLzwEncoder(adaptiveLzw, gifFrames),
    });
    if (t) t.write = Math.round(performance.now() - t0);
    return result;
  }

  // ── Legacy pipeline: quantize all → frame diff ──

  return encodeLegacyPipeline(frames, width, height, opts);
}

// ── Sub-frame pipeline ──────────────────────────────────────────

function rgbaToRgbPalette(rgba: Uint8Array, count: number): Uint8Array {
  const rgb = new Uint8Array(count * 3);
  for (let i = 0; i < count; i++) {
    rgb[i * 3] = rgba[i * 4];
    rgb[i * 3 + 1] = rgba[i * 4 + 1];
    rgb[i * 3 + 2] = rgba[i * 4 + 2];
  }
  return rgb;
}

async function encodeSubframePipeline(
  frames: EncodeFrame[],
  width: number,
  height: number,
  opts: ResolvedOptions,
  downscaleRatio: number = 1,
  presetName: string = "balanced",
  t?: Record<string, number>,
  rawOptions?: EncodeOptions,
): Promise<{ gifFrames: GifFrame[]; probe: ProbeResult }> {
  const numPixels = width * height;
  const gifFrames: GifFrame[] = new Array(frames.length);
  const canvasRgba = new Uint8ClampedArray(numPixels * 4);
  let t0: number;

  // ── Pass 1: Probe ──
  t0 = performance.now();
  const probe = probeFrames(
    frames.map((f) => f.data), width, height,
    opts.optimize.probeTolerance,
  );
  if (t) t.probe = Math.round(performance.now() - t0);

  // ── Try background-aware quantizer ──
  let useGifQuant = false;
  if (opts.quantizer === "imagequant") {
    try {
      gifQuantSimple(
        new Uint8ClampedArray(4), 1, 1, 80, 4, 4,
      );
      useGifQuant = true;
    } catch {
      // WASM not available
    }
  }

  // ── Palette strategy + adaptive maxColors ──
  t0 = performance.now();
  const isQuality = presetName === "quality";
  let sharedPalette: Uint8Array | null = null;

  let adaptiveMaxColors = opts.maxColors;
  // Content-adaptive maxColors based on gradient density × color complexity.
  // Low-complexity content (< 1000 colors) already uses few palette entries
  // regardless of maxColors. Above that, the product of gradient density and
  // complexity predicts how many palette entries serve smooth transitions:
  // high values (color-wheel) need 256; most content works at 160-192.
  if (adaptiveMaxColors >= 256 && !isQuality) {
    const gdxc = probe.gradientDensity * probe.colorComplexity;
    if (probe.colorComplexity >= 1000) {
      if (gdxc > 14000) adaptiveMaxColors = 256;
      else if (gdxc > 9000) adaptiveMaxColors = 192;
      else adaptiveMaxColors = 160;
    }
  }
  if (isQuality && probe.colorComplexity >= 30000) {
    adaptiveMaxColors = Math.min(adaptiveMaxColors, 224);
  }
  if (useGifQuant && opts.palette !== "local" && (
    downscaleRatio > 1.0 ||
    opts.palette === "global"
  )) {
    const step = Math.max(1, Math.floor(frames.length / 10));
    const sampled: Uint8ClampedArray[] = [];
    for (let f = 0; f < frames.length; f += step) sampled.push(frames[f].data);
    sharedPalette = gifBuildPalette(
      sampled, width, height,
      opts.quantizerQuality, opts.quantizerSpeed, Math.max(2, adaptiveMaxColors - 1),
    );
  }

  // ── Importance map (reused across frames) ──
  const importanceMap = new Uint8Array(numPixels);
  for (let j = 0; j < numPixels; j++) {
    importanceMap[j] = probe.staticMask[j] ? 0 : 255;
  }

  // ── Fallback path setup ──
  const useGlobalPalette = !useGifQuant && (
    opts.palette === "global" ||
    (probe.colorComplexity < 1000 && opts.palette !== "local")
  );

  let globalPalette: Uint8Array | null = null;
  if (useGlobalPalette && opts.quantizer === "imagequant") {
    try {
      const step = Math.max(1, Math.floor(frames.length / 10));
      const parts: Uint8ClampedArray[] = [];
      for (let i = 0; i < frames.length; i += step) parts.push(frames[i].data);
      const poolSize = parts.reduce((s, p) => s + p.length, 0);
      const pooled = new Uint8ClampedArray(poolSize);
      let off = 0;
      for (const p of parts) { pooled.set(p, off); off += p.length; }
      const poolResult = await (await getQuantizeImagequant())(
        pooled, width, (poolSize / 4) / width,
        { quality: opts.quantizerQuality, speed: opts.quantizerSpeed, maxColors: opts.maxColors },
      );
      if (poolResult) {
        globalPalette = trimPalette(poolResult.palette, poolResult.indexed).palette;
      }
    } catch {}
  } else if (useGlobalPalette && opts.quantizer === "neuquant") {
    globalPalette = neuquant(frames[0].data, opts.quantizerQuality);
  }

  let neuquantPalettes: Uint8Array[] | null = null;
  if (opts.quantizer === "neuquant" && !globalPalette && !useGifQuant) {
    neuquantPalettes = generatePalettes(frames, opts.palette, opts.quantizerQuality);
  }

  // Content-adaptive stale threshold. The product of motion level
  // and color complexity predicts per-frame palette divergence:
  // high divergence needs a looser threshold to find transparency.
  // Scale down proportionally to downscale ratio: at lower resolutions,
  // Lanczos3 smoothing makes inter-frame diffs smaller, so a fixed
  const complexity = probe.motionLevel * probe.colorComplexity;
  // High motion makes stale pixels visible as trailing — reduce
  // threshold so fewer pixels are marked transparent.
  const motionAdjust = probe.motionLevel > 0.2
    ? -Math.round(Math.min(3, (probe.motionLevel - 0.2) * 5))
    : 0;
  let autoThreshold: number;
  if (isQuality) {
    const motionFloor = probe.motionLevel > 0.01 ? 5 : 4;
    autoThreshold = Math.min(10, Math.max(2,
      Math.round(4 + 6 * Math.min(1, complexity / 5000)) + motionAdjust,
    ));
  } else {
    autoThreshold = Math.min(8, Math.max(2,
      Math.round(4 + 4 * Math.min(1, complexity / 8000)) + motionAdjust,
    ));
  }
  const userStale = rawOptions?.optimize && typeof rawOptions.optimize === "object"
    && "staleThreshold" in rawOptions.optimize;
  const staleThreshold = userStale ? opts.optimize.staleThreshold : autoThreshold;
  if (t) t._staleThreshold = staleThreshold;

  if (t) t.palette = Math.round(performance.now() - t0);

  const sceneChangeSet = new Set(probe.sceneChanges);

  // Palette fitness: reuse a per-frame palette across subsequent frames
  // when the palette still represents the content well. Measures p95
  // nearest-color distance (catches gradient gaps that mean misses).
  const MAX_FRAMES_PER_PALETTE = 10;
  const PALETTE_FITNESS_THRESHOLD = 8;

  function paletteP95Distance(rgba: Uint8ClampedArray, pal: Uint8Array): number {
    const palCount = pal.length / 4;
    const sampleStep = Math.max(1, Math.floor(numPixels / 2000));
    const dists: number[] = [];
    for (let j = 0; j < numPixels; j += sampleStep) {
      const si = j * 4;
      const sr = rgba[si], sg = rgba[si + 1], sb = rgba[si + 2];
      let bestDist = 765;
      for (let p = 0; p < palCount; p++) {
        const pi = p * 4;
        const d = Math.abs(sr - pal[pi]) + Math.abs(sg - pal[pi + 1]) + Math.abs(sb - pal[pi + 2]);
        if (d < bestDist) bestDist = d;
      }
      dists.push(bestDist);
    }
    dists.sort((a, b) => a - b);
    return dists[Math.floor(dists.length * 0.95)] ?? 0;
  }

  let activePaletteRgba: Uint8Array | null = null;
  let framesSincePalette = 0;

  let tTransparency = 0, tQuantize = 0, tSubframe = 0;
  t0 = performance.now();
  for (let i = 0; i < frames.length; i++) {
    const delay = Math.round((frames[i].delay ?? 100) / 10);

    const isKeyframe = i === 0 || sceneChangeSet.has(i);

    // Decide: full quantize or remap with existing palette
    let useRemap = false;
    if (!isKeyframe && useGifQuant && activePaletteRgba && framesSincePalette < MAX_FRAMES_PER_PALETTE) {
      const p95 = paletteP95Distance(frames[i].data, activePaletteRgba);
      if (p95 <= PALETTE_FITNESS_THRESHOLD) useRemap = true;
    }

    // ── Keyframe: full-frame quantize, reset canvas ──
    if (isKeyframe) {
      let indexed: Uint8Array, palette: Uint8Array;

      if (useGifQuant) {
        const r = gifQuantSimple(
          frames[i].data, width, height,
          opts.quantizerQuality, opts.quantizerSpeed, adaptiveMaxColors,
        );
        palette = rgbaToRgbPalette(r.palette, r.paletteCount);
        indexed = r.indexed;
        activePaletteRgba = gifBuildPalette(
          [frames[i].data], width, height,
          opts.quantizerQuality, opts.quantizerSpeed, Math.max(2, adaptiveMaxColors - 1),
        );
        framesSincePalette = 0;
      } else if (globalPalette) {
        palette = globalPalette;
        indexed = opts.dither === "floyd-steinberg"
          ? floydSteinberg(frames[i].data, width, height, palette, opts.ditherSerpentine)
          : mapNearest(frames[i].data, palette);
      } else {
        ({ indexed, palette } = await quantizeFrame(
          frames[i].data, width, height, opts, neuquantPalettes?.[i],
        ));
      }

      const trimmed = trimPalette(palette, indexed);
      indexed = trimmed.indexed;
      palette = trimmed.palette;

      gifFrames[i] = {
        indexedPixels: indexed, palette, width, height,
        delay, disposal: 0,
      };
      decodeFrameToCanvas(canvasRgba, indexed, palette, width, height);
      continue;
    }

    // ── Frames 1+: background-aware path ──

    const curr = frames[i].data;

    if (useGifQuant) {
      let ts = performance.now();
      const inputRgba = new Uint8ClampedArray(curr);
      for (let j = 0; j < numPixels; j++) {
        if (probe.staticMask[j]) {
          inputRgba[j * 4 + 3] = 0;
        }
      }

      // Zero alpha on pixels where source ≈ canvas within the
      // adaptive threshold. The quantizer handles edge blending
      // via set_background; this marks genuinely unchanged pixels.
      const fm = probe.perFrameMotion[i] ?? probe.motionLevel;
      const frameThreshold = (!isQuality && fm < 0.02)
        ? Math.min(10, staleThreshold + 1)
        : staleThreshold;

      // Texture map: local variance in 3×3 neighborhood. Smooth areas
      // get a lower effective threshold (protecting gradients from
      // ghosting), detailed areas keep the full threshold.
      const texMap = new Uint8Array(numPixels);
      for (let ty = 0; ty < height; ty++) {
        for (let tx = 0; tx < width; tx++) {
          let tmin = 765, tmax = 0;
          for (let dy = -1; dy <= 1; dy++) {
            const ny = ty + dy;
            if (ny < 0 || ny >= height) continue;
            for (let dx = -1; dx <= 1; dx++) {
              const nx = tx + dx;
              if (nx < 0 || nx >= width) continue;
              const ti = (ny * width + nx) * 4;
              const lum = inputRgba[ti] + inputRgba[ti + 1] + inputRgba[ti + 2];
              if (lum < tmin) tmin = lum;
              if (lum > tmax) tmax = lum;
            }
          }
          texMap[ty * width + tx] = Math.min(255, tmax - tmin);
        }
      }

      // Next frame source for direction-aware forward-look
      const nextSrc = i < frames.length - 1 ? frames[i + 1].data : null;

      for (let j = 0; j < numPixels; j++) {
        if (inputRgba[j * 4 + 3] === 0) continue;
        const si = j * 4;
        const d = Math.max(
          Math.abs(inputRgba[si] - canvasRgba[si]),
          Math.abs(inputRgba[si + 1] - canvasRgba[si + 1]),
          Math.abs(inputRgba[si + 2] - canvasRgba[si + 2]),
        );

        // Texture-scaled threshold: smooth areas (variance < 40) get
        // 60–100% of the base threshold; detailed areas get full threshold
        const tex = texMap[j];
        const texFactor = 0.6 + 0.4 * Math.min(1, tex / 40);
        const effectiveThreshold = frameThreshold * texFactor;

        if (d <= effectiveThreshold) {
          // Direction-aware forward-look: if this pixel is about to
          // drift in the same direction next frame AND the area is
          // smooth, keep it now to prevent ghost accumulation
          let keepForward = false;
          if (nextSrc && tex < 40 && d > 1) {
            const fwdDiff = Math.max(
              Math.abs(nextSrc[si] - canvasRgba[si]),
              Math.abs(nextSrc[si + 1] - canvasRgba[si + 1]),
              Math.abs(nextSrc[si + 2] - canvasRgba[si + 2]),
            );
            if (fwdDiff > 4) {
              const dr = (inputRgba[si] - canvasRgba[si]) * (nextSrc[si] - canvasRgba[si]);
              const dg = (inputRgba[si + 1] - canvasRgba[si + 1]) * (nextSrc[si + 1] - canvasRgba[si + 1]);
              const db = (inputRgba[si + 2] - canvasRgba[si + 2]) * (nextSrc[si + 2] - canvasRgba[si + 2]);
              if (dr + dg + db > 0) keepForward = true;
            }
          }
          if (!keepForward) {
            inputRgba[si + 3] = 0;
          }
        }
      }

      tTransparency += performance.now() - ts;
      ts = performance.now();
      let r: GifQuantResult;
      if (sharedPalette) {
        r = gifRemapPalette(inputRgba, width, height, sharedPalette, canvasRgba);
      } else if (useRemap && activePaletteRgba) {
        r = gifRemapPalette(inputRgba, width, height, activePaletteRgba, canvasRgba);
        framesSincePalette++;
      } else {
        r = gifQuantBg(
            inputRgba, width, height,
            canvasRgba, importanceMap,
            opts.quantizerQuality, opts.quantizerSpeed, adaptiveMaxColors,
          );
        activePaletteRgba = gifBuildPalette(
          [frames[i].data], width, height,
          opts.quantizerQuality, opts.quantizerSpeed, Math.max(2, adaptiveMaxColors - 1),
        );
        framesSincePalette = 0;
      }

      tQuantize += performance.now() - ts;
      ts = performance.now();
      const tIdx = r.transparentIndex;
      const rgbPal = rgbaToRgbPalette(r.palette, r.paletteCount);

      // Initial bounding box
      let minX = width, maxX = -1, minY = height, maxY = -1;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (r.indexed[y * width + x] !== tIdx) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }

      // Edge-only sparse suppression: suppress isolated near-stale opaque
      // pixels in the outermost 20% of the bbox to shrink it. Interior
      // pixels are never modified. Track suppressed positions to correct
      // canvas drift afterward.
      const suppressed: number[] = [];
      if (maxX >= 0) {
        const bw = maxX - minX + 1, bh = maxY - minY + 1;
        const marginX = Math.max(4, Math.round(bw * 0.4));
        const marginY = Math.max(4, Math.round(bh * 0.4));
        const sparseThreshold = staleThreshold + 2;
        const sparseRadius = 6;

        for (let y = minY; y <= maxY; y++) {
          for (let x = minX; x <= maxX; x++) {
            const inEdge = (x - minX < marginX) || (maxX - x < marginX) ||
                           (y - minY < marginY) || (maxY - y < marginY);
            if (!inEdge) continue;
            const idx = y * width + x;
            if (r.indexed[idx] === tIdx) continue;
            const si = idx * 4;
            const d = Math.max(
              Math.abs(curr[si] - canvasRgba[si]),
              Math.abs(curr[si+1] - canvasRgba[si+1]),
              Math.abs(curr[si+2] - canvasRgba[si+2]),
            );
            if (d > sparseThreshold) continue;
            let hasNeighbor = false;
            const rowStart = y * width;
            const xLo = Math.max(minX, x - sparseRadius);
            const xHi = Math.min(maxX, x + sparseRadius);
            for (let nx = xLo; nx <= xHi; nx++) {
              if (nx === x) continue;
              if (r.indexed[rowStart + nx] !== tIdx) {
                const nsi = (rowStart + nx) * 4;
                const nd = Math.max(
                  Math.abs(curr[nsi] - canvasRgba[nsi]),
                  Math.abs(curr[nsi+1] - canvasRgba[nsi+1]),
                  Math.abs(curr[nsi+2] - canvasRgba[nsi+2]),
                );
                if (nd > sparseThreshold) { hasNeighbor = true; break; }
              }
            }
            if (!hasNeighbor) { r.indexed[idx] = tIdx; suppressed.push(idx); }
          }
        }
        // Recompute bbox after suppression
        minX = width; maxX = -1; minY = height; maxY = -1;
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            if (r.indexed[y * width + x] !== tIdx) {
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
          }
        }
      }

      if (maxX < 0) {
        gifFrames[i] = {
          indexedPixels: new Uint8Array([0]),
          palette: gifFrames[i - 1].palette,
          width: 1, height: 1, left: 0, top: 0,
          delay, disposal: 0, transparentIndex: 0,
        };
      } else {
        const cw = maxX - minX + 1;
        const ch = maxY - minY + 1;
        const cropped = new Uint8Array(cw * ch);
        for (let y = 0; y < ch; y++) {
          const srcOff = (minY + y) * width + minX;
          cropped.set(r.indexed.subarray(srcOff, srcOff + cw), y * cw);
        }

        let framePal: Uint8Array | Uint8Array<ArrayBufferLike> = rgbPal;
        let framePx: Uint8Array | Uint8Array<ArrayBufferLike> = cropped;
        let frameTIdx = tIdx;
        if (tIdx >= 0) {
          const trimmed = trimPalette(rgbPal, cropped, tIdx);
          framePal = trimmed.palette;
          framePx = trimmed.indexed;
          frameTIdx = trimmed.transparentIndex ?? -1;
        }

        gifFrames[i] = {
          indexedPixels: framePx,
          palette: framePal,
          width: cw, height: ch,
          left: minX, top: minY,
          transparentIndex: frameTIdx >= 0 ? frameTIdx : undefined,
          delay, disposal: 0,
        };
      }

      // Update canvas
      for (let j = 0; j < numPixels; j++) {
        if (r.indexed[j] !== tIdx) {
          const pi = r.indexed[j] * 4;
          const ci = j * 4;
          canvasRgba[ci] = r.palette[pi];
          canvasRgba[ci + 1] = r.palette[pi + 1];
          canvasRgba[ci + 2] = r.palette[pi + 2];
          canvasRgba[ci + 3] = 255;
        }
      }
      tSubframe += performance.now() - ts;

      continue;
    }

    // ── Frames 1+: fallback path (old pipeline) ──

    const prev = frames[i - 1].data;

    const bbox = findChangedBbox(
      curr, prev, canvasRgba, probe.staticMask,
      width, height, staleThreshold,
    );
    if (!bbox) {
      gifFrames[i] = {
        indexedPixels: new Uint8Array([0]),
        palette: gifFrames[i - 1].palette,
        width: 1, height: 1, left: 0, top: 0,
        delay, disposal: 0, transparentIndex: 0,
      };
      continue;
    }

    const cw = bbox.maxX - bbox.minX + 1;
    const ch = bbox.maxY - bbox.minY + 1;

    let indexed: Uint8Array, palette: Uint8Array;

    if (globalPalette) {
      palette = globalPalette;
      const fullIndexed = opts.dither === "floyd-steinberg"
        ? floydSteinberg(curr, width, height, palette, opts.ditherSerpentine)
        : mapNearest(curr, palette);
      indexed = new Uint8Array(cw * ch);
      for (let y = 0; y < ch; y++) {
        const srcOff = (bbox.minY + y) * width + bbox.minX;
        indexed.set(fullIndexed.subarray(srcOff, srcOff + cw), y * cw);
      }
    } else {
      const cropped = cropRgba(curr, width, bbox.minX, bbox.minY, cw, ch);
      if (opts.quantizer === "imagequant") {
        const iqResult = await (await getQuantizeImagequant())(cropped, cw, ch, {
          quality: opts.quantizerQuality,
          speed: opts.quantizerSpeed,
          maxColors: opts.maxColors,
        });
        if (iqResult) {
          palette = iqResult.palette;
          indexed = opts.dither === false
            ? mapNearest(cropped, palette)
            : iqResult.indexed;
        } else {
          palette = neuquant(cropped, 1);
          indexed = opts.dither === "floyd-steinberg"
            ? floydSteinberg(cropped, cw, ch, palette, opts.ditherSerpentine)
            : mapNearest(cropped, palette);
        }
      } else {
        palette = neuquantPalettes?.[i] ?? neuquant(cropped, opts.quantizerQuality);
        indexed = opts.dither === "floyd-steinberg"
          ? floydSteinberg(cropped, cw, ch, palette, opts.ditherSerpentine)
          : mapNearest(cropped, palette);
      }
    }

    const sub = buildSubframe(
      indexed, palette, curr, canvasRgba, probe.staticMask,
      bbox.minX, bbox.minY, cw, ch, width,
      staleThreshold,
    );

    let framePal = palette;
    let framePx = sub.indexedPixels;
    let frameTIdx = sub.transparentIndex;
    if (sub.transparentIndex >= 0) {
      const trimmed = trimPalette(palette, sub.indexedPixels, sub.transparentIndex);
      framePal = trimmed.palette;
      framePx = trimmed.indexed;
      frameTIdx = trimmed.transparentIndex ?? -1;
    }

    gifFrames[i] = {
      indexedPixels: framePx,
      palette: framePal,
      width: sub.width,
      height: sub.height,
      left: sub.left,
      top: sub.top,
      transparentIndex: frameTIdx >= 0 ? frameTIdx : undefined,
      delay,
      disposal: 0,
    };

    compositeOntoCanvas(canvasRgba, sub, palette, width);
  }
  if (t) {
    t.transparency = Math.round(tTransparency);
    t.quantize = Math.round(tQuantize);
    t.subframe = Math.round(tSubframe);
  }

  return { gifFrames, probe };
}

async function quantizeFrame(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  opts: ResolvedOptions,
  neuquantPalette?: Uint8Array,
): Promise<{ indexed: Uint8Array; palette: Uint8Array }> {
  if (opts.quantizer === "imagequant") {
    try {
      const result = await (await getQuantizeImagequant())(rgba, w, h, {
        quality: opts.quantizerQuality,
        speed: opts.quantizerSpeed,
        maxColors: opts.maxColors,
      });
      if (result) {
        const indexed = opts.dither === false
          ? mapNearest(rgba, result.palette)
          : result.indexed;
        return { indexed, palette: result.palette };
      }
    } catch {
      // imagequant can fail on very small crops — fall through to NeuQuant
    }
    const pal = neuquant(rgba, 1);
    const idx = opts.dither === "floyd-steinberg"
      ? floydSteinberg(rgba, w, h, pal, opts.ditherSerpentine)
      : mapNearest(rgba, pal);
    return { indexed: idx, palette: pal };
  }

  // NeuQuant path
  const pal = neuquantPalette ?? neuquant(rgba, opts.quantizerQuality);
  const idx = opts.dither === "floyd-steinberg"
    ? floydSteinberg(rgba, w, h, pal, opts.ditherSerpentine)
    : mapNearest(rgba, pal);
  return { indexed: idx, palette: pal };
}

// ── Legacy pipeline ─────────────────────────────────────────────

async function encodeLegacyPipeline(
  frames: EncodeFrame[],
  width: number,
  height: number,
  opts: ResolvedOptions,
): Promise<Uint8Array> {
  // ── Phase 1: Generate palettes + dither ──

  const indexed: Array<{
    indexedPixels: Uint8Array;
    palette: Uint8Array;
    delay: number;
  }> = new Array(frames.length);

  if (opts.quantizer === "imagequant") {
    for (let i = 0; i < frames.length; i++) {
      const result = await (await getQuantizeImagequant())(
        frames[i].data, width, height,
        { quality: opts.quantizerQuality, speed: opts.quantizerSpeed, maxColors: opts.maxColors },
      );

      let pixels: Uint8Array;
      let palette: Uint8Array;

      if (result) {
        pixels = result.indexed;
        palette = result.palette;
      } else {
        palette = neuquant(frames[i].data, 1);
        pixels = floydSteinberg(frames[i].data, width, height, palette, opts.ditherSerpentine);
      }

      indexed[i] = {
        indexedPixels: pixels,
        palette,
        delay: Math.round((frames[i].delay ?? 100) / 10),
      };
    }
  } else {
    const palettes = generatePalettes(frames, opts.palette, opts.quantizerQuality);

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
          opts.optimize.frameDiffErode,
          opts.optimize.frameDiffDistanceMode,
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

// ── Shared helpers ──────────────────────────────────────────────

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

function denoiseFrames(
  frames: EncodeFrame[],
  width: number,
  height: number,
  threshold: number = 5,
): void {
  const numPixels = width * height;
  let prev2: Uint8ClampedArray = frames[0].data;
  let prev1: Uint8ClampedArray = frames[1].data;

  for (let f = 2; f < frames.length; f++) {
    const curr = frames[f].data;
    const out = new Uint8ClampedArray(curr);

    for (let i = 0; i < numPixels; i++) {
      const si = i * 4;
      let maxDev = 0;
      for (let c = 0; c < 3; c++) {
        const a = curr[si + c], b = prev1[si + c], d = prev2[si + c];
        const dev = Math.max(Math.abs(a - b), Math.abs(a - d), Math.abs(b - d));
        if (dev > maxDev) maxDev = dev;
      }

      if (maxDev > 0 && maxDev <= threshold) {
        for (let c = 0; c < 3; c++) {
          const a = curr[si + c], b = prev1[si + c], d = prev2[si + c];
          out[si + c] = a > b
            ? (b > d ? b : (a > d ? d : a))
            : (a > d ? a : (b > d ? d : b));
        }
      }
    }

    frames[f] = { data: out, delay: frames[f].delay };
    prev2 = prev1;
    prev1 = out;
  }
}

// ── Parallel encoding ─────────────────────────────────────────

/**
 * Encode with parallel Lanczos3 downscaling and quantization.
 *
 * Uses worker_threads (Node.js) to parallelize the two heaviest
 * stages: Lanczos3 (68% of time) and imagequant remap (17%).
 * The sub-frame optimization remains sequential (4% of time).
 *
 * @param options - Same as encode()
 * @param concurrency - Number of workers (default: CPU count - 1)
 */
export async function encodeParallel(
  options: EncodeOptions,
  concurrency?: number,
): Promise<Uint8Array> {
  const { Worker: NodeWorker } = await import("worker_threads");
  const { cpus } = await import("os");
  const { join, dirname } = await import("path");
  const { fileURLToPath } = await import("url");

  const numWorkers = concurrency ?? Math.max(1, cpus().length - 1);
  const workerPath = join(dirname(fileURLToPath(import.meta.url)), "workers", "frame-worker.js");

  let { width, height, frames } = options;
  if (frames.length === 0) throw new Error("At least one frame is required");

  const opts = resolveOptions(options);
  const presetName = options.preset ?? "balanced";

  // ── Phase 1: Parallel Lanczos3 downscale ──
  const srcWidth = width;
  if (options.targetWidth && options.targetWidth < width) {
    const dstW = options.targetWidth;
    const dstH = options.targetHeight ?? Math.floor(height * (dstW / width));

    const workers: InstanceType<typeof NodeWorker>[] = [];
    for (let i = 0; i < numWorkers; i++) {
      workers.push(new NodeWorker(workerPath));
    }

    const resized = new Array<Uint8ClampedArray>(frames.length);
    let nextFrame = 0;
    let completed = 0;

    await new Promise<void>((resolve) => {
      function dispatch(worker: InstanceType<typeof NodeWorker>) {
        if (nextFrame >= frames.length) return;
        const idx = nextFrame++;
        const buf = frames[idx].data.buffer.slice(
          frames[idx].data.byteOffset,
          frames[idx].data.byteOffset + frames[idx].data.byteLength,
        );
        worker.once("message", (msg: any) => {
          resized[idx] = new Uint8ClampedArray(msg.buffer);
          completed++;
          if (completed === frames.length) resolve();
          else dispatch(worker);
        });
        worker.postMessage({
          type: "downsample", id: idx,
          frameBuffer: buf, srcW: width, srcH: height, dstW, dstH,
        }, [buf]);
      }
      for (const w of workers) dispatch(w);
    });

    width = dstW;
    height = dstH;
    frames = resized.map((data, i) => ({ data, delay: frames[i].delay ?? 100 }));

    for (const w of workers) await w.terminate();
  }

  const downscaleRatio = srcWidth / width;

  // ── Phase 2: Denoise + Probe + Palette (sequential) ──
  if (presetName === "balanced" && frames.length >= 3) {
    const numPixels = width * height;
    let subPerceptual = 0, changed = 0, totalChecked = 0;
    const step = Math.max(1, Math.floor(frames.length / 6));
    for (let f = step; f < frames.length; f += step) {
      const a = frames[f].data, b = frames[f - 1].data;
      for (let i = 0; i < numPixels; i++) {
        const si = i * 4;
        const maxDev = Math.max(
          Math.abs(a[si] - b[si]), Math.abs(a[si+1] - b[si+1]), Math.abs(a[si+2] - b[si+2]),
        );
        if (maxDev >= 1 && maxDev <= 2) subPerceptual++;
        if (maxDev > 5) changed++;
        totalChecked++;
      }
    }
    if (totalChecked > 0 && subPerceptual / totalChecked > 0.05 && changed / totalChecked > 0.02) {
      denoiseFrames(frames, width, height, 3);
    }
  }

  // ── Phase 2b+: Sequential encode (probe + quantize + sub-frame) ──
  // Quantization requires the true canvas for background-aware
  // dithering and correct transparency. This dependency makes it
  // inherently sequential. The parallel Lanczos3 in Phase 1
  // captures 68% of the available speedup.
  const { gifFrames, probe } = await encodeSubframePipeline(
    frames, width, height, opts, downscaleRatio, presetName,
  );

  const lzwComplexity = probe.motionLevel * probe.colorComplexity;
  const adaptiveLzw = options.lossyLzw !== undefined
    ? opts.lossyLzw
    : Math.min(5, Math.max(opts.lossyLzw, Math.round(opts.lossyLzw + lzwComplexity / 3000)));

  return writeGif(gifFrames, {
    width, height, loop: opts.loop,
    lzwEncoder: buildLzwEncoder(adaptiveLzw, gifFrames),
  });
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
