/**
 * Temporal dithering for animated GIF sequences.
 *
 * Reduces flicker by locking unchanged pixels to the previous
 * frame's palette choice. Unlike error-carry-forward approaches,
 * this preserves the full Floyd-Steinberg spatial error diffusion
 * (no banding or feedback loops) while eliminating dither shimmer
 * in static regions.
 *
 * @module
 */

import { buildColorCache } from "./floyd-steinberg.js";

/**
 * State passed between consecutive frames.
 */
export interface TemporalDitherState {
  /** Previous frame's indexed palette indices (width × height). */
  prevIndexed: Uint8Array;
  /** Previous frame's flat RGB palette. */
  prevPalette: Uint8Array;
}

/**
 * Dither a frame with temporal consistency.
 *
 * For pixels whose source RGBA hasn't changed since the previous
 * frame (L1 ≤ threshold), the previous frame's displayed color is
 * looked up in the current palette and that index is used. The
 * quantization error is still distributed spatially via Floyd-
 * Steinberg so surrounding pixels dither correctly.
 *
 * @param rgba - Source RGBA pixels (4 bytes per pixel)
 * @param width - Image width
 * @param height - Image height
 * @param palette - Current frame's flat RGB palette (768 bytes)
 * @param prevState - State from the previous frame (null for first frame)
 * @param prevRgba - Previous frame's source RGBA (for change detection)
 * @param options - Dithering options (spatialWeight unused, kept for API compat)
 * @returns Indexed pixels and state for next frame
 */
export function ditherFrameTemporal(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  palette: Uint8Array,
  prevState: TemporalDitherState | null,
  prevRgba: Uint8ClampedArray | null,
  options: {
    spatialWeight: number;
    temporalWeight: number;
    serpentine: boolean;
  },
): { indexed: Uint8Array; nextState: TemporalDitherState } {
  const { serpentine, temporalWeight } = options;
  const numPixels = width * height;
  const numColors = (palette.length / 3) | 0;
  const cache = buildColorCache(palette, numColors);
  const indexed = new Uint8Array(numPixels);

  const canLock =
    prevState !== null && prevRgba !== null && temporalWeight > 0;
  const prevIndexed = prevState?.prevIndexed ?? null;
  const prevPalette = prevState?.prevPalette ?? null;
  const lockThreshold = 5;

  const stride = (width + 4) * 3;
  const PAD = 2 * 3;
  let errCurr = new Float32Array(stride);
  let errNext = new Float32Array(stride);

  for (let y = 0; y < height; y++) {
    errNext.fill(0);

    const forward = !serpentine || (y & 1) === 0;
    const x0 = forward ? 0 : width - 1;
    const x1 = forward ? width : -1;
    const dx = forward ? 1 : -1;

    for (let x = x0; x !== x1; x += dx) {
      const pixelIdx = y * width + x;
      const pi = pixelIdx << 2;
      const ei = PAD + x * 3;

      const sr = rgba[pi];
      const sg = rgba[pi + 1];
      const sb = rgba[pi + 2];

      let best: number;

      if (canLock) {
        const dr = sr - prevRgba![pi];
        const dg = sg - prevRgba![pi + 1];
        const db = sb - prevRgba![pi + 2];
        const l1 =
          (dr < 0 ? -dr : dr) + (dg < 0 ? -dg : dg) + (db < 0 ? -db : db);

        if (l1 <= lockThreshold) {
          const pIdx = prevIndexed![pixelIdx];
          const p3 = pIdx * 3;
          const pr = prevPalette![p3];
          const pg = prevPalette![p3 + 1];
          const pb = prevPalette![p3 + 2];
          best = cache[((pr >> 3) << 10) | ((pg >> 3) << 5) | (pb >> 3)];
        } else {
          const ar = sr + errCurr[ei];
          const ag = sg + errCurr[ei + 1];
          const ab = sb + errCurr[ei + 2];
          const cr = ar < 0 ? 0 : ar > 255 ? 255 : (ar + 0.5) | 0;
          const cg = ag < 0 ? 0 : ag > 255 ? 255 : (ag + 0.5) | 0;
          const cb = ab < 0 ? 0 : ab > 255 ? 255 : (ab + 0.5) | 0;
          best = cache[((cr >> 3) << 10) | ((cg >> 3) << 5) | (cb >> 3)];
        }
      } else {
        const ar = sr + errCurr[ei];
        const ag = sg + errCurr[ei + 1];
        const ab = sb + errCurr[ei + 2];
        const cr = ar < 0 ? 0 : ar > 255 ? 255 : (ar + 0.5) | 0;
        const cg = ag < 0 ? 0 : ag > 255 ? 255 : (ag + 0.5) | 0;
        const cb = ab < 0 ? 0 : ab > 255 ? 255 : (ab + 0.5) | 0;
        best = cache[((cr >> 3) << 10) | ((cg >> 3) << 5) | (cb >> 3)];
      }

      indexed[pixelIdx] = best;

      // Error = source + spatial_carry - quantized (standard Floyd-Steinberg)
      const b3 = best * 3;
      const er = sr + errCurr[ei] - palette[b3];
      const eg = sg + errCurr[ei + 1] - palette[b3 + 1];
      const eb = sb + errCurr[ei + 2] - palette[b3 + 2];

      const fwd = ei + dx * 3;
      const bwd = ei - dx * 3;

      errCurr[fwd] += er * 0.4375;
      errCurr[fwd + 1] += eg * 0.4375;
      errCurr[fwd + 2] += eb * 0.4375;

      errNext[bwd] += er * 0.1875;
      errNext[bwd + 1] += eg * 0.1875;
      errNext[bwd + 2] += eb * 0.1875;

      errNext[ei] += er * 0.3125;
      errNext[ei + 1] += eg * 0.3125;
      errNext[ei + 2] += eb * 0.3125;

      errNext[fwd] += er * 0.0625;
      errNext[fwd + 1] += eg * 0.0625;
      errNext[fwd + 2] += eb * 0.0625;
    }

    const tmp = errCurr;
    errCurr = errNext;
    errNext = tmp;
  }

  return {
    indexed,
    nextState: {
      prevIndexed: indexed,
      prevPalette: new Uint8Array(palette),
    },
  };
}
