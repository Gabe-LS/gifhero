/**
 * Temporal error-diffusion dithering for animated GIF sequences.
 *
 * Extends Floyd-Steinberg by carrying quantization error between frames,
 * preventing the same pixel from flickering between palette entries
 * across consecutive frames. Static pixels are locked to their previous
 * color to eliminate flicker in unchanged regions.
 *
 * @module
 */

import { buildColorCache } from "./floyd-steinberg.js";

/**
 * Persisted state between consecutive frames for temporal error diffusion.
 */
export interface TemporalDitherState {
  /** Per-pixel RGB error carried to the next frame (width × height × 3). */
  errorBuffer: Float32Array;
  /** Previous frame's indexed palette indices (width × height). */
  prevIndexed: Uint8Array;
  /** Previous frame's flat RGB palette. */
  prevPalette: Uint8Array;
}

/**
 * Dither a single animation frame using temporal error diffusion.
 *
 * Combines Floyd-Steinberg spatial error distribution with temporal error
 * carried from the previous frame. Pixels that haven't changed between
 * frames are locked to the nearest match for their previous displayed
 * color, eliminating flicker in static regions.
 *
 * @param rgba - Source RGBA pixels (4 bytes per pixel)
 * @param width - Image width in pixels
 * @param height - Image height in pixels
 * @param palette - Current frame's flat RGB palette (768 bytes for 256 colors)
 * @param prevState - State from the previous frame, or null for the first frame
 * @param prevRgba - Previous frame's RGBA pixels for unchanged-pixel detection, or null
 * @param options - Dithering parameters
 * @returns Indexed pixel data and state to pass to the next frame
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
  const { spatialWeight, temporalWeight, serpentine } = options;
  const numPixels = width * height;
  const numColors = (palette.length / 3) | 0;
  const cache = buildColorCache(palette, numColors);
  const indexed = new Uint8Array(numPixels);
  const nextErrorBuffer = new Float32Array(numPixels * 3);

  const prevError = prevState ? prevState.errorBuffer : null;
  const prevIndexedBuf = prevState ? prevState.prevIndexed : null;
  const prevPalette = prevState ? prevState.prevPalette : null;
  const canDetectUnchanged = prevRgba !== null && prevState !== null;

  // Two-row spatial error buffers with padding of 2 pixels on each side.
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
      const ti = pixelIdx * 3;

      // Check if pixel is unchanged from previous frame
      if (canDetectUnchanged) {
        const dr = rgba[pi] - prevRgba![pi];
        const dg = rgba[pi + 1] - prevRgba![pi + 1];
        const db = rgba[pi + 2] - prevRgba![pi + 2];
        const l1 = (dr < 0 ? -dr : dr) + (dg < 0 ? -dg : dg) + (db < 0 ? -db : db);

        if (l1 <= 5) {
          // Lock to previous displayed color in the current palette
          const prevIdx = prevIndexedBuf![pixelIdx];
          const p3 = prevIdx * 3;
          const pr = prevPalette![p3];
          const pg = prevPalette![p3 + 1];
          const pb = prevPalette![p3 + 2];
          const best = cache[((pr >> 3) << 10) | ((pg >> 3) << 5) | (pb >> 3)];
          indexed[pixelIdx] = best;

          // Zero temporal error for static pixels
          // nextErrorBuffer[ti], [ti+1], [ti+2] already 0

          // Skip spatial error distribution
          continue;
        }
      }

      // Source RGB
      let sr = rgba[pi];
      let sg = rgba[pi + 1];
      let sb = rgba[pi + 2];

      // Add temporal error from previous frame
      if (prevError !== null) {
        sr += prevError[ti] * temporalWeight;
        sg += prevError[ti + 1] * temporalWeight;
        sb += prevError[ti + 2] * temporalWeight;
      }

      // Add spatial error from current row
      const ar = sr + errCurr[ei];
      const ag = sg + errCurr[ei + 1];
      const ab = sb + errCurr[ei + 2];

      // Clamp for palette lookup
      const cr = ar < 0 ? 0 : ar > 255 ? 255 : (ar + 0.5) | 0;
      const cg = ag < 0 ? 0 : ag > 255 ? 255 : (ag + 0.5) | 0;
      const cb = ab < 0 ? 0 : ab > 255 ? 255 : (ab + 0.5) | 0;

      // Nearest palette color via 5-bit cache
      const best = cache[((cr >> 3) << 10) | ((cg >> 3) << 5) | (cb >> 3)];
      indexed[pixelIdx] = best;

      // Quantization error (from the float-adjusted value, not the clamped int)
      const b3 = best * 3;
      const er = ar - palette[b3];
      const eg = ag - palette[b3 + 1];
      const eb = ab - palette[b3 + 2];

      // Store temporal error for next frame
      nextErrorBuffer[ti] = er * temporalWeight;
      nextErrorBuffer[ti + 1] = eg * temporalWeight;
      nextErrorBuffer[ti + 2] = eb * temporalWeight;

      // Distribute spatial error using Floyd-Steinberg kernel
      const sw = spatialWeight;
      const fwd = ei + dx * 3;
      const bwd = ei - dx * 3;

      // Forward pixel in same row: 7/16
      const s716 = sw * 0.4375;
      errCurr[fwd] += er * s716;
      errCurr[fwd + 1] += eg * s716;
      errCurr[fwd + 2] += eb * s716;

      // Below-behind: 3/16
      const s316 = sw * 0.1875;
      errNext[bwd] += er * s316;
      errNext[bwd + 1] += eg * s316;
      errNext[bwd + 2] += eb * s316;

      // Directly below: 5/16
      const s516 = sw * 0.3125;
      errNext[ei] += er * s516;
      errNext[ei + 1] += eg * s516;
      errNext[ei + 2] += eb * s516;

      // Below-forward: 1/16
      const s116 = sw * 0.0625;
      errNext[fwd] += er * s116;
      errNext[fwd + 1] += eg * s116;
      errNext[fwd + 2] += eb * s116;
    }

    // Swap: next row becomes current
    const tmp = errCurr;
    errCurr = errNext;
    errNext = tmp;
  }

  return {
    indexed,
    nextState: {
      errorBuffer: nextErrorBuffer,
      prevIndexed: indexed,
      prevPalette: new Uint8Array(palette),
    },
  };
}
