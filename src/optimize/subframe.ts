/**
 * Sub-frame encoding with probe-driven transparency.
 *
 * Uses a pre-computed static mask to make definitive transparency
 * decisions. Static pixels are unconditionally transparent. Non-static
 * pixels use source-vs-prev and source-vs-canvas checks.
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
 * Skips static-mask pixels entirely. A non-static pixel needs
 * re-encoding if the source changed from the previous frame OR
 * the canvas is stale (source differs from decoded canvas).
 */
export function findChangedBbox(
  curr: Uint8ClampedArray,
  prev: Uint8ClampedArray,
  canvas: Uint8ClampedArray,
  staticMask: Uint8Array,
  w: number,
  h: number,
  staleThreshold: number,
): { minX: number; maxX: number; minY: number; maxY: number } | null {
  let minX = w, maxX = -1, minY = h, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const pi = y * w + x;
      if (staticMask[pi]) continue;

      const si = pi * 4;
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
      if (srcDiff > 2 || canvasDiff > staleThreshold) {
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
 * Build an optimized sub-frame using probe-driven transparency.
 *
 * Three-tier pixel classification:
 *   1. Static mask → unconditionally transparent
 *   2. Source changed this frame (srcDiff > 2) → opaque
 *   3. Source didn't change, canvas close enough → transparent;
 *      canvas stale → opaque
 */
export function buildSubframe(
  indexedPixels: Uint8Array,
  palette: Uint8Array,
  currRgba: Uint8ClampedArray,
  prevRgba: Uint8ClampedArray,
  canvasRgba: Uint8ClampedArray,
  staticMask: Uint8Array,
  cropLeft: number,
  cropTop: number,
  cw: number,
  ch: number,
  fullW: number,
  staleThreshold: number,
): SubframeResult {
  const pixelCount = cw * ch;
  const numColors = (palette.length / 3) | 0;

  const changed = new Uint8Array(pixelCount);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const pi = y * cw + x;
      const fi = (cropTop + y) * fullW + (cropLeft + x);
      const si = fi * 4;

      if (staticMask[fi]) continue;

      const srcDiff = Math.max(
        Math.abs(currRgba[si] - prevRgba[si]),
        Math.abs(currRgba[si + 1] - prevRgba[si + 1]),
        Math.abs(currRgba[si + 2] - prevRgba[si + 2]),
      );
      if (srcDiff > 2) {
        changed[pi] = 1;
        continue;
      }

      const canvasDiff = Math.max(
        Math.abs(currRgba[si] - canvasRgba[si]),
        Math.abs(currRgba[si + 1] - canvasRgba[si + 1]),
        Math.abs(currRgba[si + 2] - canvasRgba[si + 2]),
      );
      if (canvasDiff > staleThreshold) {
        changed[pi] = 1;
      }
    }
  }

  // ── Find transparent index ──
  const usedByChanged = new Uint8Array(256);
  for (let i = 0; i < pixelCount; i++) {
    if (changed[i]) usedByChanged[indexedPixels[i]] = 1;
  }

  let palBits = 1;
  while ((1 << palBits) < numColors) palBits++;
  const maxIdx = (1 << palBits) - 1;

  let tIdx = -1;
  for (let i = maxIdx; i >= 0; i--) {
    if (!usedByChanged[i]) { tIdx = i; break; }
  }

  // Evict the least-used entry if no free slot exists
  let pixels = indexedPixels;
  if (tIdx < 0) {
    const changedCount = new Uint32Array(256);
    for (let i = 0; i < pixelCount; i++) {
      if (changed[i]) changedCount[indexedPixels[i]]++;
    }
    let minCount = 0x7fffffff;
    let evictIdx = 0;
    for (let i = 0; i < numColors; i++) {
      if (changedCount[i] > 0 && changedCount[i] < minCount) {
        minCount = changedCount[i];
        evictIdx = i;
      }
    }
    tIdx = evictIdx;
    usedByChanged[evictIdx] = 0;
    pixels = indexedPixels.slice();
    const evR = palette[evictIdx * 3], evG = palette[evictIdx * 3 + 1], evB = palette[evictIdx * 3 + 2];
    let bestAlt = 0, bestDist = 0x7fffffff;
    for (let p = 0; p < numColors; p++) {
      if (p === evictIdx) continue;
      const po = p * 3;
      const d = Math.abs(evR - palette[po]) + Math.abs(evG - palette[po + 1]) + Math.abs(evB - palette[po + 2]);
      if (d < bestDist) { bestDist = d; bestAlt = p; }
    }
    for (let i = 0; i < pixelCount; i++) {
      if (changed[i] && pixels[i] === evictIdx) {
        pixels[i] = bestAlt;
      }
    }
    usedByChanged[bestAlt] = 1;
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

  // ── Set transparent pixels ──
  const punched = new Uint8Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    punched[i] = changed[i] ? pixels[i] : tIdx;
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
