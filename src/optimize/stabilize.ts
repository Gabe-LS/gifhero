/**
 * Post-dither static pixel stabilization.
 *
 * After imagequant (or any quantizer) independently dithers each frame,
 * static regions get different dither patterns, causing visible shimmer.
 * This module overwrites static pixels with the previous frame's palette
 * index, mapped through the current palette, eliminating flicker without
 * interfering with the quantizer's dithering of changed regions.
 *
 * @module
 */

/**
 * Stabilize static pixels by copying palette indices from the previous frame.
 *
 * For each pixel where the source RGBA hasn't meaningfully changed between
 * frames, the previous frame's displayed color is looked up in the current
 * palette via exact search and that index is used instead of the
 * freshly-dithered value. Exact search avoids the 5-bit color cache's
 * quantization error which can map similar colors to wrong palette entries.
 *
 * @param currentIndexed - Dithered indexed pixels for current frame
 * @param previousIndexed - Indexed pixels from previous frame (post-stabilization)
 * @param previousPalette - Previous frame's flat RGB palette
 * @param currentPalette - Current frame's flat RGB palette
 * @param currentSource - RGBA source pixels for current frame
 * @param previousSource - RGBA source pixels for previous frame
 * @param pixelCount - Total pixels (width × height)
 * @param tolerance - Max per-channel diff to consider "unchanged" (default 2)
 * @returns New indexed pixel array with static pixels stabilized
 */
export function stabilizeStaticPixels(
  currentIndexed: Uint8Array,
  previousIndexed: Uint8Array,
  previousPalette: Uint8Array,
  currentPalette: Uint8Array,
  currentSource: Uint8ClampedArray,
  previousSource: Uint8ClampedArray,
  pixelCount: number,
  tolerance: number = 2,
): Uint8Array {
  const numColors = (currentPalette.length / 3) | 0;
  const output = new Uint8Array(currentIndexed);

  for (let i = 0; i < pixelCount; i++) {
    const si = i << 2;

    const dr = currentSource[si] - previousSource[si];
    const dg = currentSource[si + 1] - previousSource[si + 1];
    const db = currentSource[si + 2] - previousSource[si + 2];

    if (
      (dr < 0 ? -dr : dr) <= tolerance &&
      (dg < 0 ? -dg : dg) <= tolerance &&
      (db < 0 ? -db : db) <= tolerance
    ) {
      const prevIdx = previousIndexed[i];
      const p3 = prevIdx * 3;
      const pr = previousPalette[p3];
      const pg = previousPalette[p3 + 1];
      const pb = previousPalette[p3 + 2];

      let bestIdx = 0;
      let bestDist = 0x7fffffff;
      for (let j = 0; j < numColors; j++) {
        const j3 = j * 3;
        const cdr = pr - currentPalette[j3];
        const cdg = pg - currentPalette[j3 + 1];
        const cdb = pb - currentPalette[j3 + 2];
        const d = cdr * cdr + cdg * cdg + cdb * cdb;
        if (d < bestDist) {
          bestDist = d;
          bestIdx = j;
        }
      }

      // Only stabilize if the remapped color is very close to what
      // the quantizer chose — prevents color drift from palette differences
      const curIdx = currentIndexed[i];
      const c3 = curIdx * 3;
      const b3 = bestIdx * 3;
      const cdMax = Math.max(
        Math.abs(currentPalette[b3] - currentPalette[c3]),
        Math.abs(currentPalette[b3 + 1] - currentPalette[c3 + 1]),
        Math.abs(currentPalette[b3 + 2] - currentPalette[c3 + 2]),
      );
      if (cdMax <= 3) {
        output[i] = bestIdx;
      }
    }
  }

  return output;
}
