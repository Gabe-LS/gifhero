/**
 * Floyd-Steinberg error-diffusion dithering with serpentine scanning.
 *
 * Distributes quantization error to 4 neighbors per pixel using the
 * classic 7/16, 3/16, 5/16, 1/16 kernel. Serpentine scanning
 * alternates row direction to eliminate directional banding.
 *
 * @module
 */

/**
 * Map RGBA pixels to palette indices using Floyd-Steinberg dithering.
 *
 * @param rgba - Source RGBA pixels (4 bytes per pixel)
 * @param width - Image width
 * @param height - Image height
 * @param palette - Flat RGB palette [R,G,B,…] (must be 256×3 = 768 bytes)
 * @param serpentine - Alternate scan direction per row. Default true.
 * @returns Indexed pixel data (1 byte per pixel, values 0–255)
 */
export function floydSteinberg(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  palette: Uint8Array,
  serpentine: boolean = true,
): Uint8Array {
  const numColors = (palette.length / 3) | 0;
  const indexed = new Uint8Array(width * height);
  const cache = buildColorCache(palette, numColors);

  // Two-row error buffers (current row, next row). Each pixel
  // has 3 float error channels. Padded by +2 on each side so
  // boundary checks for x±1 are unnecessary.
  const stride = (width + 4) * 3;
  const PAD = 2 * 3; // offset past the left padding
  let errCurr = new Float32Array(stride);
  let errNext = new Float32Array(stride);

  for (let y = 0; y < height; y++) {
    errNext.fill(0);

    const forward = !serpentine || (y & 1) === 0;
    const x0 = forward ? 0 : width - 1;
    const x1 = forward ? width : -1;
    const dx = forward ? 1 : -1;

    for (let x = x0; x !== x1; x += dx) {
      const pi = (y * width + x) << 2;
      const ei = PAD + x * 3;

      // Adjusted color = source + accumulated error
      const ar = rgba[pi] + errCurr[ei];
      const ag = rgba[pi + 1] + errCurr[ei + 1];
      const ab = rgba[pi + 2] + errCurr[ei + 2];

      // Clamp for palette lookup
      const cr = ar < 0 ? 0 : ar > 255 ? 255 : (ar + 0.5) | 0;
      const cg = ag < 0 ? 0 : ag > 255 ? 255 : (ag + 0.5) | 0;
      const cb = ab < 0 ? 0 : ab > 255 ? 255 : (ab + 0.5) | 0;

      // Nearest palette color via 5-bit cache
      const best = cache[((cr >> 3) << 10) | ((cg >> 3) << 5) | (cb >> 3)];
      indexed[y * width + x] = best;

      // Quantization error (from the unadjusted float, not the clamped int)
      const b3 = best * 3;
      const er = ar - palette[b3];
      const eg = ag - palette[b3 + 1];
      const eb = ab - palette[b3 + 2];

      // ── Distribute error ──
      //         *   7/16
      // 3/16  5/16  1/16
      // (flipped horizontally when scanning right-to-left)

      const fwd = ei + dx * 3; // (x+dx) in current row
      const bwd = ei - dx * 3; // (x-dx) in next row

      // Forward pixel in same row: 7/16
      errCurr[fwd] += er * 0.4375;
      errCurr[fwd + 1] += eg * 0.4375;
      errCurr[fwd + 2] += eb * 0.4375;

      // Below-behind: 3/16
      errNext[bwd] += er * 0.1875;
      errNext[bwd + 1] += eg * 0.1875;
      errNext[bwd + 2] += eb * 0.1875;

      // Directly below: 5/16
      errNext[ei] += er * 0.3125;
      errNext[ei + 1] += eg * 0.3125;
      errNext[ei + 2] += eb * 0.3125;

      // Below-forward: 1/16
      errNext[fwd] += er * 0.0625;
      errNext[fwd + 1] += eg * 0.0625;
      errNext[fwd + 2] += eb * 0.0625;
    }

    // Swap: next row becomes current
    const tmp = errCurr;
    errCurr = errNext;
    errNext = tmp;
  }

  return indexed;
}

/**
 * Map RGBA pixels to nearest palette indices without dithering.
 *
 * @param rgba - Source RGBA pixels (4 bytes per pixel)
 * @param palette - Flat RGB palette [R,G,B,…]
 * @returns Indexed pixel data
 */
export function mapNearest(
  rgba: Uint8ClampedArray,
  palette: Uint8Array,
): Uint8Array {
  const numColors = (palette.length / 3) | 0;
  const pixelCount = rgba.length >> 2;
  const cache = buildColorCache(palette, numColors);
  const indexed = new Uint8Array(pixelCount);

  for (let i = 0; i < pixelCount; i++) {
    const p = i << 2;
    indexed[i] =
      cache[
        ((rgba[p] >> 3) << 10) | ((rgba[p + 1] >> 3) << 5) | (rgba[p + 2] >> 3)
      ];
  }

  return indexed;
}

// ── Internals ────────────────────────────────────────────────────

/**
 * Build a 32×32×32 RGB→palette-index cache for O(1) nearest-color
 * lookup. Each axis is quantized to 5 bits (32 levels).
 */
export function buildColorCache(
  palette: Uint8Array,
  numColors: number,
): Uint8Array {
  const cache = new Uint8Array(32768);

  for (let ri = 0; ri < 32; ri++) {
    const r = (ri << 3) | (ri >> 2);
    for (let gi = 0; gi < 32; gi++) {
      const g = (gi << 3) | (gi >> 2);
      for (let bi = 0; bi < 32; bi++) {
        const b = (bi << 3) | (bi >> 2);

        let bestDist = 0x7fffffff;
        let bestIdx = 0;
        for (let j = 0; j < numColors; j++) {
          const j3 = j * 3;
          const dr = r - palette[j3];
          const dg = g - palette[j3 + 1];
          const db = b - palette[j3 + 2];
          const dist = dr * dr + dg * dg + db * db;
          if (dist < bestDist) {
            bestDist = dist;
            bestIdx = j;
          }
        }

        cache[(ri << 10) | (gi << 5) | bi] = bestIdx;
      }
    }
  }

  return cache;
}
