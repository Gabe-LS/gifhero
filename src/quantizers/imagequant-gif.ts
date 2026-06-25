/**
 * Background-aware imagequant via custom WASM build.
 *
 * Exposes `liq_image_set_background`, `liq_image_set_importance_map`,
 * `Histogram::add_image`, and `QuantizationResult::from_palette` from
 * libimagequant — the full API gifski uses for integrated
 * quantizer–transparency encoding with shared palettes.
 *
 * @module
 */

import * as wasmModule from "../wasm/imagequant-gif/imagequant-gif-wasm.js";

// ── WASM module accessor ──────────────────────────────────────

function getMod(): typeof wasmModule {
  return wasmModule;
}

// ── Public API ──────────────────────────────────────────────────

export interface GifQuantResult {
  palette: Uint8Array;
  indexed: Uint8Array;
  paletteCount: number;
  transparentIndex: number;
}

/**
 * Quantize a frame with background awareness (for frames 1+).
 */
export function quantizeWithBackground(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  background: Uint8ClampedArray,
  importanceMap: Uint8Array | null,
  quality: number,
  speed: number,
  maxColors: number,
): GifQuantResult {
  const m = getMod();
  const result = m.quantize_with_background(
    new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength),
    width, height,
    0, quality, speed, maxColors,
    new Uint8Array(background.buffer, background.byteOffset, background.byteLength),
    importanceMap ?? new Uint8Array(0),
  );
  const out: GifQuantResult = {
    palette: new Uint8Array(result.palette),
    indexed: new Uint8Array(result.indices),
    paletteCount: result.palette_count,
    transparentIndex: result.transparent_index,
  };
  result.free();
  return out;
}

/**
 * Quantize frame 0 (no background).
 */
export function quantizeSimple(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  quality: number,
  speed: number,
  maxColors: number,
): GifQuantResult {
  const m = getMod();
  const result = m.quantize_simple(
    new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength),
    width, height,
    0, quality, speed, maxColors,
  );
  const out: GifQuantResult = {
    palette: new Uint8Array(result.palette),
    indexed: new Uint8Array(result.indices),
    paletteCount: result.palette_count,
    transparentIndex: result.transparent_index,
  };
  result.free();
  return out;
}

/**
 * Quantize without dithering.
 */
export function quantizeNoDither(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  background: Uint8ClampedArray | null,
  importanceMap: Uint8Array | null,
  quality: number,
  speed: number,
  maxColors: number,
): GifQuantResult {
  const m = getMod();
  const bgArr = background
    ? new Uint8Array(background.buffer, background.byteOffset, background.byteLength)
    : new Uint8Array(0);
  const result = m.quantize_no_dither(
    new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength),
    width, height,
    0, quality, speed, maxColors,
    bgArr,
    importanceMap ?? new Uint8Array(0),
  );
  const out: GifQuantResult = {
    palette: new Uint8Array(result.palette),
    indexed: new Uint8Array(result.indices),
    paletteCount: result.palette_count,
    transparentIndex: result.transparent_index,
  };
  result.free();
  return out;
}

/**
 * Build a shared palette from multiple sampled frames.
 * Pools all frames into one histogram for optimal multi-frame palette.
 *
 * @param frames - Array of RGBA frame data to sample
 * @param width - Frame width
 * @param height - Frame height
 * @param quality - Target quality 0-100
 * @param speed - Speed 1-10
 * @param maxColors - Max palette entries 2-256
 * @returns Flat RGBA palette (4 bytes per color)
 */
export function buildSharedPalette(
  frames: Uint8ClampedArray[],
  width: number,
  height: number,
  quality: number,
  speed: number,
  maxColors: number,
): Uint8Array {
  const m = getMod();
  const frameSize = width * height * 4;
  const pooled = new Uint8Array(frameSize * frames.length);
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    pooled.set(new Uint8Array(f.buffer, f.byteOffset, f.byteLength), i * frameSize);
  }
  return new Uint8Array(m.build_shared_palette(
    pooled, width, height, frames.length,
    0, quality, speed, maxColors,
  ));
}

/**
 * Remap a frame using a pre-built shared palette with background
 * awareness. Same dithering + transparency as quantize_with_background,
 * but uses the provided palette instead of generating a new one.
 *
 * @param rgba - Current frame RGBA (alpha=0 for transparent pixels)
 * @param width - Frame width
 * @param height - Frame height
 * @param palette - Shared RGBA palette from buildSharedPalette
 * @param background - Decoded canvas RGBA (what the decoder shows)
 * @param dither - Dithering level 0.0-1.0 (default 1.0)
 */
export function remapWithPalette(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  palette: Uint8Array,
  background: Uint8ClampedArray,
  dither: number = 1.0,
): GifQuantResult {
  const m = getMod();
  const result = m.remap_with_palette(
    new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength),
    width, height,
    palette,
    new Uint8Array(background.buffer, background.byteOffset, background.byteLength),
    dither,
  );
  const out: GifQuantResult = {
    palette: new Uint8Array(result.palette),
    indexed: new Uint8Array(result.indices),
    paletteCount: result.palette_count,
    transparentIndex: result.transparent_index,
  };
  result.free();
  return out;
}

/**
 * Lanczos3 downscale via WASM — same algorithm as resize.ts but ~7x faster.
 *
 * @param src - Source RGBA pixel data
 * @param srcW - Source width
 * @param srcH - Source height
 * @param dstW - Destination width
 * @param dstH - Destination height
 * @returns Downscaled RGBA pixel data
 */
export function downsampleWasm(
  src: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Uint8ClampedArray {
  const m = getMod();
  const result = m.downsample_lanczos3(
    new Uint8Array(src.buffer, src.byteOffset, src.byteLength),
    srcW, srcH, dstW, dstH,
  );
  return new Uint8ClampedArray(result.buffer, result.byteOffset, result.byteLength);
}
