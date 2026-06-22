/**
 * Disposal method optimization.
 *
 * For each frame, compares dispose-none (leave in place) vs
 * dispose-to-background (clear area). Picks whichever produces
 * fewer changed pixels for the *next* frame's delta — fewer
 * changed pixels means more transparency, better LZW compression.
 *
 * Uses source RGBA data for accurate comparison (not affected
 * by per-frame palette variance).
 *
 * @module
 */

import { countChangedPixelsRgba } from "./frame-diff.js";

/**
 * Choose the optimal disposal method for each frame.
 *
 * @param frames - Source RGBA data per frame
 * @param canvasWidth - Logical screen width
 * @param canvasHeight - Logical screen height
 * @param tolerance - L1 RGB distance threshold for "unchanged"
 * @returns Array of disposal methods (0 = none, 2 = restore-to-background)
 */
export function optimizeDisposals(
  frames: ReadonlyArray<{ readonly data: Uint8ClampedArray }>,
  canvasWidth: number,
  canvasHeight: number,
  tolerance: number,
): number[] {
  const len = frames.length;
  const disposals = new Array<number>(len).fill(0);
  if (len < 2) return disposals;

  const pixelCount = canvasWidth * canvasHeight;
  const bgRgba = new Uint8Array(pixelCount * 4);

  for (let i = 0; i < len - 1; i++) {
    const noneChanged = countChangedPixelsRgba(
      frames[i].data,
      frames[i + 1].data,
      pixelCount,
      tolerance,
    );

    const bgChanged = countChangedPixelsRgba(
      bgRgba,
      frames[i + 1].data,
      pixelCount,
      tolerance,
    );

    disposals[i] = noneChanged <= bgChanged ? 0 : 2;
  }

  return disposals;
}
