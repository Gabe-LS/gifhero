/**
 * Sub-frame encoding: crop → quantize → punch holes → equalize.
 *
 * Instead of quantizing full frames then diffing, this approach
 * crops the source to the changed region first, quantizes only
 * that region, then punches transparent holes for unchanged
 * pixels. This avoids disrupting imagequant's dithering coherence.
 *
 * Hole punching compares the source frame against the decoded
 * canvas (what the GIF decoder is actually displaying), not the
 * previous source frame. This prevents ghost trails from stale
 * dithering artifacts in earlier frames.
 *
 * @module
 */

/** Result of building an optimized sub-frame. */
export interface SubframeResult {
  indexedPixels: Uint8Array;
  transparentIndex: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Crop an RGBA buffer to a rectangular region.
 *
 * @param src - Full-frame RGBA data
 * @param srcW - Full-frame width
 * @param left - Left edge of crop
 * @param top - Top edge of crop
 * @param cw - Crop width
 * @param ch - Crop height
 * @returns Cropped RGBA data
 */
export function cropRgba(
  src: Uint8ClampedArray,
  srcW: number,
  left: number,
  top: number,
  cw: number,
  ch: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(cw * ch * 4);
  for (let y = 0; y < ch; y++) {
    const srcOff = ((top + y) * srcW + left) * 4;
    out.set(src.subarray(srcOff, srcOff + cw * 4), y * cw * 4);
  }
  return out;
}

/**
 * Find the bounding box of pixels that need re-encoding.
 *
 * A pixel is "changed" if EITHER the source differs from the
 * previous source by more than cropTolerance, OR the source
 * differs from the decoded canvas by more than holeTolerance.
 * The first condition catches scene changes; the second catches
 * stale canvas pixels (dithering artifacts from earlier frames).
 *
 * @param curr - Current source frame RGBA
 * @param prev - Previous source frame RGBA
 * @param canvas - Decoded canvas RGBA (what the decoder shows)
 * @param w - Frame width
 * @param h - Frame height
 * @param cropTolerance - Source-vs-source noise threshold
 * @param holeTolerance - Source-vs-canvas staleness threshold
 * @returns Bounding box, or null if no pixels changed
 */
export function findChangedBbox(
  curr: Uint8ClampedArray,
  prev: Uint8ClampedArray,
  canvas: Uint8ClampedArray,
  w: number,
  h: number,
  cropTolerance: number,
  holeTolerance: number,
): { minX: number; maxX: number; minY: number; maxY: number } | null {
  let minX = w, maxX = -1, minY = h, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = (y * w + x) * 4;
      const srcDiff = Math.max(
        Math.abs(curr[si] - prev[si]),
        Math.abs(curr[si + 1] - prev[si + 1]),
        Math.abs(curr[si + 2] - prev[si + 2]),
      );
      const canvasDiff = Math.max(
        Math.abs(curr[si] - canvas[si]),
        Math.abs(curr[si + 1] - canvas[si + 1]),
        Math.abs(curr[si + 2] - canvas[si + 2]),
      );
      if (srcDiff > cropTolerance || canvasDiff > holeTolerance) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return maxX < 0 ? null : { minX, maxX, minY, maxY };
}

/**
 * Build an optimized sub-frame from quantized crop data.
 *
 * Compares the source frame against the decoded canvas (what the
 * GIF decoder is actually displaying) rather than the previous
 * source frame. This ensures stale dithering artifacts from
 * earlier frames are always detected and re-encoded.
 *
 * @param indexedPixels - Quantized indices for the crop region
 * @param palette - Flat RGB palette for this frame
 * @param currRgba - Current source frame's full RGBA data
 * @param canvasRgba - Decoded canvas RGBA (what the decoder shows)
 * @param cropLeft - Crop region left in full-frame coords
 * @param cropTop - Crop region top in full-frame coords
 * @param cw - Crop width
 * @param ch - Crop height
 * @param fullW - Full-frame width
 * @param holeTolerance - Max per-channel diff to consider "unchanged" (0 = exact match)
 * @param enableTranseq - Enable transparency run equalization
 * @returns Optimized sub-frame with position and transparency info
 */
export function buildSubframe(
  indexedPixels: Uint8Array,
  palette: Uint8Array,
  currRgba: Uint8ClampedArray,
  canvasRgba: Uint8ClampedArray,
  cropLeft: number,
  cropTop: number,
  cw: number,
  ch: number,
  fullW: number,
  holeTolerance: number,
  enableTranseq: boolean,
): SubframeResult {
  const pixelCount = cw * ch;

  // ── Mark changed pixels (source vs decoded canvas) ──
  const changed = new Uint8Array(pixelCount);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const si = ((cropTop + y) * fullW + (cropLeft + x)) * 4;
      const d = Math.max(
        Math.abs(currRgba[si] - canvasRgba[si]),
        Math.abs(currRgba[si + 1] - canvasRgba[si + 1]),
        Math.abs(currRgba[si + 2] - canvasRgba[si + 2]),
      );
      if (d > holeTolerance) changed[y * cw + x] = 1;
    }
  }

  // ── Morphological noise gate (5×5, density < 6 → remove) ──
  const neighborCount = new Uint8Array(pixelCount);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      if (!changed[y * cw + x]) continue;
      let count = 0;
      for (let dy = Math.max(0, y - 2); dy <= Math.min(ch - 1, y + 2); dy++) {
        for (let dx = Math.max(0, x - 2); dx <= Math.min(cw - 1, x + 2); dx++) {
          if (dy === y && dx === x) continue;
          if (changed[dy * cw + dx]) count++;
        }
      }
      neighborCount[y * cw + x] = count;
    }
  }
  for (let i = 0; i < pixelCount; i++) {
    if (changed[i] && neighborCount[i] < 6) changed[i] = 0;
  }

  // ── Find transparent index ──
  const usedByChanged = new Uint8Array(256);
  for (let i = 0; i < pixelCount; i++) {
    if (changed[i]) usedByChanged[indexedPixels[i]] = 1;
  }

  const numColors = (palette.length / 3) | 0;
  let palBits = 1;
  while ((1 << palBits) < numColors) palBits++;
  const maxIdx = (1 << palBits) - 1;

  let tIdx = -1;
  for (let i = maxIdx; i >= 0; i--) {
    if (!usedByChanged[i]) { tIdx = i; break; }
  }

  if (tIdx < 0) {
    return {
      indexedPixels: indexedPixels.slice(),
      transparentIndex: -1,
      left: cropLeft,
      top: cropTop,
      width: cw,
      height: ch,
    };
  }

  // ── Punch holes ──
  const punched = new Uint8Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    punched[i] = changed[i] ? indexedPixels[i] : tIdx;
  }

  // ── Stale transparency check ──
  // For each transparent pixel, verify that the canvas color is close to
  // what the current palette would render. If the nearest palette color
  // for the source pixel diverges from the canvas by > 3, the canvas is
  // showing stale data — flip the pixel to opaque.
  const numPalEntries = numColors;
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const i = y * cw + x;
      if (punched[i] !== tIdx) continue;
      const si = ((cropTop + y) * fullW + (cropLeft + x)) * 4;
      const sr = currRgba[si], sg = currRgba[si + 1], sb = currRgba[si + 2];
      const cr = canvasRgba[si], cg = canvasRgba[si + 1], cb = canvasRgba[si + 2];

      // Find nearest palette color to the source pixel
      let bestIdx = 0, bestDist = 0x7fffffff;
      for (let p = 0; p < numPalEntries; p++) {
        const po = p * 3;
        const d = Math.abs(sr - palette[po]) + Math.abs(sg - palette[po + 1]) + Math.abs(sb - palette[po + 2]);
        if (d < bestDist) { bestDist = d; bestIdx = p; }
      }

      // Compare what the palette would render vs what the canvas shows
      const po = bestIdx * 3;
      const palCanvasDiff = Math.max(
        Math.abs(palette[po] - cr),
        Math.abs(palette[po + 1] - cg),
        Math.abs(palette[po + 2] - cb),
      );
      if (palCanvasDiff > 3) {
        punched[i] = bestIdx;
        usedByChanged[bestIdx] = 1;
      }
    }
  }

  // ── Transparency run equalization (also vs canvas) ──
  if (enableTranseq) {
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        const i = y * cw + x;
        if (punched[i] === tIdx) continue;
        let tNeighbors = 0;
        for (let dy = Math.max(0, y - 1); dy <= Math.min(ch - 1, y + 1); dy++) {
          for (let dx = Math.max(0, x - 1); dx <= Math.min(cw - 1, x + 1); dx++) {
            if (dy === y && dx === x) continue;
            if (punched[dy * cw + dx] === tIdx) tNeighbors++;
          }
        }
        if (tNeighbors < 6) continue;
        const si = ((cropTop + y) * fullW + (cropLeft + x)) * 4;
        const d = Math.max(
          Math.abs(currRgba[si] - canvasRgba[si]),
          Math.abs(currRgba[si + 1] - canvasRgba[si + 1]),
          Math.abs(currRgba[si + 2] - canvasRgba[si + 2]),
        );
        if (d <= 3) punched[i] = tIdx;
      }
    }
  }

  // ── Final tight crop ──
  let minX = cw, maxX = -1, minY = ch, maxY = -1;
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      if (punched[y * cw + x] !== tIdx) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

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

  const outW = maxX - minX + 1;
  const outH = maxY - minY + 1;
  const out = new Uint8Array(outW * outH);
  for (let cy = 0; cy < outH; cy++) {
    for (let cx = 0; cx < outW; cx++) {
      out[cy * outW + cx] = punched[(minY + cy) * cw + (minX + cx)];
    }
  }

  return {
    indexedPixels: out,
    transparentIndex: tIdx,
    left: cropLeft + minX,
    top: cropTop + minY,
    width: outW,
    height: outH,
  };
}

/**
 * Composite a sub-frame onto the decoded canvas.
 *
 * Opaque pixels overwrite the canvas with their palette color.
 * Transparent pixels leave the canvas unchanged.
 *
 * @param canvas - Full-frame RGBA canvas (mutated in place)
 * @param sub - The sub-frame result
 * @param palette - Flat RGB palette for the sub-frame
 * @param fullW - Full-frame width
 */
export function compositeOntoCanvas(
  canvas: Uint8ClampedArray,
  sub: SubframeResult,
  palette: Uint8Array,
  fullW: number,
): void {
  const { indexedPixels, transparentIndex, left, top, width, height } = sub;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = indexedPixels[y * width + x];
      if (idx === transparentIndex) continue;
      const ci = ((top + y) * fullW + (left + x)) * 4;
      const pi = idx * 3;
      canvas[ci] = palette[pi];
      canvas[ci + 1] = palette[pi + 1];
      canvas[ci + 2] = palette[pi + 2];
      canvas[ci + 3] = 255;
    }
  }
}

/**
 * Decode a full-frame indexed image onto the canvas.
 *
 * @param canvas - Full-frame RGBA canvas (mutated in place)
 * @param indexed - Indexed pixel data
 * @param palette - Flat RGB palette
 * @param w - Frame width
 * @param h - Frame height
 */
export function decodeFrameToCanvas(
  canvas: Uint8ClampedArray,
  indexed: Uint8Array,
  palette: Uint8Array,
  w: number,
  h: number,
): void {
  for (let i = 0; i < w * h; i++) {
    const pi = indexed[i] * 3;
    const ci = i * 4;
    canvas[ci] = palette[pi];
    canvas[ci + 1] = palette[pi + 1];
    canvas[ci + 2] = palette[pi + 2];
    canvas[ci + 3] = 255;
  }
}

/**
 * Remove unused palette entries and remap indices.
 *
 * @param palette - Flat RGB palette
 * @param indexed - Pixel indices
 * @param transparentIndex - Transparent index to preserve (or undefined)
 * @returns Trimmed palette, remapped indices, updated transparent index
 */
export function trimPalette(
  palette: Uint8Array,
  indexed: Uint8Array,
  transparentIndex?: number,
): { palette: Uint8Array; indexed: Uint8Array; transparentIndex?: number } {
  const used = new Uint8Array(256);
  for (let i = 0; i < indexed.length; i++) used[indexed[i]] = 1;
  if (transparentIndex != null && transparentIndex >= 0) used[transparentIndex] = 1;

  let count = 0;
  for (let i = 0; i < 256; i++) if (used[i]) count++;

  const origColors = (palette.length / 3) | 0;
  if (count >= origColors) return { palette, indexed, transparentIndex };

  const oldToNew = new Uint8Array(256);
  const newPal = new Uint8Array(count * 3);
  let slot = 0;
  for (let i = 0; i < 256; i++) {
    if (!used[i]) continue;
    oldToNew[i] = slot;
    const oi = i * 3;
    if (oi + 2 < palette.length) {
      newPal[slot * 3] = palette[oi];
      newPal[slot * 3 + 1] = palette[oi + 1];
      newPal[slot * 3 + 2] = palette[oi + 2];
    }
    slot++;
  }

  const remapped = new Uint8Array(indexed.length);
  for (let i = 0; i < indexed.length; i++) remapped[i] = oldToNew[indexed[i]];

  return {
    palette: newPal,
    indexed: remapped,
    transparentIndex: (transparentIndex != null && transparentIndex >= 0)
      ? oldToNew[transparentIndex]
      : transparentIndex,
  };
}

/**
 * Count distinct palette indices used in indexed pixel data.
 */
export function countUsedColors(indexed: Uint8Array): number {
  const used = new Uint8Array(256);
  for (let i = 0; i < indexed.length; i++) used[indexed[i]] = 1;
  let count = 0;
  for (let i = 0; i < 256; i++) if (used[i]) count++;
  return count;
}
