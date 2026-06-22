/**
 * Frame differencing (delta encoding).
 *
 * Compares consecutive frames' **source RGBA** pixels (not
 * post-quantization colors) to detect unchanged regions. This
 * avoids false positives from NeuQuant palette variance across
 * frames. Unchanged pixels are marked transparent and the result
 * is cropped to the minimal bounding box.
 *
 * @module
 */

/** Result of computing a frame delta. */
export interface FrameDiffResult {
  /** Indexed pixels for the cropped region (transparent + changed). */
  indexedPixels: Uint8Array;
  /** Palette index used for transparent (unchanged) pixels, or -1 if none available. */
  transparentIndex: number;
  /** Left offset of the cropped region on the logical screen. */
  left: number;
  /** Top offset of the cropped region on the logical screen. */
  top: number;
  /** Width of the cropped region. */
  width: number;
  /** Height of the cropped region. */
  height: number;
}

/**
 * Compute the delta between a frame and the previous canvas state.
 *
 * Compares source RGBA data (not quantized colors) to accurately
 * detect static pixels even when per-frame palettes differ.
 *
 * @param currentIndexed - Full-canvas indexed pixels for this frame
 * @param currentPalette - This frame's flat RGB palette (unused for comparison but
 *   needed to determine which palette slots are free)
 * @param currentRgba - Source RGBA of this frame (for pixel comparison)
 * @param prevRgba - Source RGBA (or equivalent) of what the viewer currently sees
 * @param canvasWidth - Logical screen width
 * @param canvasHeight - Logical screen height
 * @param tolerance - Max L1 RGB distance to consider "unchanged" (0 = lossless)
 * @returns Cropped delta frame with transparency info
 */
export function computeFrameDiff(
  currentIndexed: Uint8Array,
  currentRgba: Uint8ClampedArray | Uint8Array,
  prevRgba: Uint8ClampedArray | Uint8Array,
  canvasWidth: number,
  canvasHeight: number,
  tolerance: number,
): FrameDiffResult {
  const pixelCount = canvasWidth * canvasHeight;

  // ── Mark changed pixels and find bounding box ──
  let minX = canvasWidth;
  let maxX = -1;
  let minY = canvasHeight;
  let maxY = -1;
  const changed = new Uint8Array(pixelCount);

  for (let y = 0; y < canvasHeight; y++) {
    for (let x = 0; x < canvasWidth; x++) {
      const i = y * canvasWidth + x;
      const ri = i << 2;

      const dist =
        Math.abs(currentRgba[ri] - prevRgba[ri]) +
        Math.abs(currentRgba[ri + 1] - prevRgba[ri + 1]) +
        Math.abs(currentRgba[ri + 2] - prevRgba[ri + 2]);

      if (dist > tolerance) {
        changed[i] = 1;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  // Dilate the changed mask by 2 pixels. Dithered pixels near object
  // edges differ slightly between frames — without dilation they get
  // marked "unchanged" and show through as ghost artifacts.
  const DILATE = 2;
  const dilated = new Uint8Array(pixelCount);
  for (let y = 0; y < canvasHeight; y++) {
    for (let x = 0; x < canvasWidth; x++) {
      if (changed[y * canvasWidth + x]) {
        const y0 = Math.max(0, y - DILATE);
        const y1 = Math.min(canvasHeight - 1, y + DILATE);
        const x0 = Math.max(0, x - DILATE);
        const x1 = Math.min(canvasWidth - 1, x + DILATE);
        for (let dy = y0; dy <= y1; dy++) {
          for (let dx = x0; dx <= x1; dx++) {
            dilated[dy * canvasWidth + dx] = 1;
          }
        }
      }
    }
  }
  // Update changed mask and recompute bounding box
  minX = canvasWidth; maxX = -1; minY = canvasHeight; maxY = -1;
  for (let y = 0; y < canvasHeight; y++) {
    for (let x = 0; x < canvasWidth; x++) {
      const i = y * canvasWidth + x;
      if (dilated[i]) {
        changed[i] = 1;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  // No pixels changed — emit a minimal 1×1 transparent frame
  if (maxX < 0) {
    return {
      indexedPixels: new Uint8Array([0]),
      transparentIndex: 0,
      left: 0,
      top: 0,
      width: 1,
      height: 1,
    };
  }

  const cropW = maxX - minX + 1;
  const cropH = maxY - minY + 1;

  // ── Find a palette index not used by any changed pixel in the bbox ──
  const usedByChanged = new Uint8Array(256);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const i = y * canvasWidth + x;
      if (changed[i]) {
        usedByChanged[currentIndexed[i]] = 1;
      }
    }
  }

  let transparentIndex = -1;
  for (let i = 255; i >= 0; i--) {
    if (!usedByChanged[i]) {
      transparentIndex = i;
      break;
    }
  }

  // All 256 indices in use (extremely rare for a delta) — skip diff
  if (transparentIndex < 0) {
    return {
      indexedPixels: currentIndexed.slice(),
      transparentIndex: -1,
      left: 0,
      top: 0,
      width: canvasWidth,
      height: canvasHeight,
    };
  }

  // ── Build cropped pixel array ──
  const cropped = new Uint8Array(cropW * cropH);
  for (let cy = 0; cy < cropH; cy++) {
    for (let cx = 0; cx < cropW; cx++) {
      const srcI = (minY + cy) * canvasWidth + (minX + cx);
      cropped[cy * cropW + cx] = changed[srcI]
        ? currentIndexed[srcI]
        : transparentIndex;
    }
  }

  return {
    indexedPixels: cropped,
    transparentIndex,
    left: minX,
    top: minY,
    width: cropW,
    height: cropH,
  };
}

/**
 * Count how many source RGBA pixels differ between two frames.
 */
export function countChangedPixelsRgba(
  aRgba: Uint8ClampedArray | Uint8Array,
  bRgba: Uint8ClampedArray | Uint8Array,
  pixelCount: number,
  tolerance: number,
): number {
  let count = 0;
  for (let i = 0; i < pixelCount; i++) {
    const ri = i << 2;
    const dist =
      Math.abs(aRgba[ri] - bRgba[ri]) +
      Math.abs(aRgba[ri + 1] - bRgba[ri + 1]) +
      Math.abs(aRgba[ri + 2] - bRgba[ri + 2]);
    if (dist > tolerance) count++;
  }
  return count;
}
