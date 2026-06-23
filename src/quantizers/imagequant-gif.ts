/**
 * Background-aware imagequant via custom WASM build.
 *
 * Exposes `liq_image_set_background` and `liq_image_set_importance_map`
 * from libimagequant — the same API gifski uses for integrated
 * quantizer–transparency encoding.
 *
 * @module
 */

import { createRequire } from "module";

// ── Lazy WASM module loading ────────────────────────────────────

let mod: any = null;

function getMod(): any {
  if (mod) return mod;
  const require = createRequire(import.meta.url);
  mod = require("../wasm/imagequant-gif/imagequant_gif_wasm.js");
  return mod;
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
