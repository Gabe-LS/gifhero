/**
 * Lossy LZW compression for GIF.
 *
 * A variant of GIF LZW that produces smaller files by allowing
 * approximate dictionary matches. During dictionary lookup, a
 * candidate sequence is accepted if all pixels are within a
 * configurable Chebyshev (L-infinity) color distance in the palette.
 * When multiple candidates match, the one with the smallest distance
 * wins. With lossiness = 0 the behavior is identical to the standard
 * exact-match encoder.
 *
 * @module
 */

const MAX_CODE = 4095;

/**
 * Build a 256x256 Chebyshev distance table between all palette entries.
 *
 * @param palette - Flat RGB palette (3 bytes per entry)
 * @returns 256x256 Uint8Array where `table[i * 256 + j]` is the
 *          L-infinity distance between palette colors i and j.
 */
function buildDistTable(palette: Uint8Array): Uint8Array {
  const n = (palette.length / 3) | 0;
  const dist = new Uint8Array(256 * 256);
  for (let i = 0; i < n; i++) {
    const ri = palette[i * 3];
    const gi = palette[i * 3 + 1];
    const bi = palette[i * 3 + 2];
    for (let j = i + 1; j < n; j++) {
      const d = Math.max(
        Math.abs(ri - palette[j * 3]),
        Math.abs(gi - palette[j * 3 + 1]),
        Math.abs(bi - palette[j * 3 + 2]),
      );
      dist[i * 256 + j] = d;
      dist[j * 256 + i] = d;
    }
  }
  return dist;
}

/**
 * Compress indexed pixel data using lossy GIF LZW.
 *
 * Variable-width codes from (minCodeSize + 1) up to 12 bits,
 * packed LSB-first. Uses the "early change" convention for
 * code-width bumps. When `lossiness` is 0, behavior is identical
 * to the standard exact-match LZW encoder.
 *
 * @param pixels - Palette indices (each value must be < 2^minCodeSize)
 * @param palette - Flat RGB palette (3 bytes per entry, up to 768 bytes)
 * @param minCodeSize - Minimum code size in bits (2-8, derived from palette depth)
 * @param lossiness - Color distance threshold for approximate matches.
 *                     0 = exact (lossless), 20-200 = lossy range.
 * @returns Raw compressed byte stream (caller handles sub-blocking)
 */
export function lzwEncodeLossy(
  pixels: Uint8Array,
  palette: Uint8Array,
  minCodeSize: number,
  lossiness: number,
  transparentIndex: number = -1,
): Uint8Array {
  const isLossy = lossiness > 0;
  const numColors = (palette.length / 3) | 0;
  const distTable = isLossy ? buildDistTable(palette) : null;

  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;

  const output: number[] = [];
  let curByte = 0;
  let curBits = 0;

  function emit(code: number, size: number): void {
    curByte |= code << curBits;
    curBits += size;
    while (curBits >= 8) {
      output.push(curByte & 0xff);
      curByte >>>= 8;
      curBits -= 8;
    }
  }

  let dict = new Map<number, number>();
  let nextCode = 0;
  let codeSize = 0;

  function reset(): void {
    dict.clear();
    nextCode = eoiCode + 1;
    codeSize = minCodeSize + 1;
  }

  reset();
  emit(clearCode, codeSize);

  if (pixels.length === 0) {
    emit(eoiCode, codeSize);
    if (curBits > 0) output.push(curByte & 0xff);
    return new Uint8Array(output);
  }

  let prefix = pixels[0];
  let deferring = false;
  let deferStart = 0;
  let deferPixels = 0;
  const DEFER_WINDOW = 256;

  function checkDefer(): void {
    if (!deferring) return;
    deferPixels++;
    if (deferPixels >= DEFER_WINDOW) {
      const bytesEmitted = output.length - deferStart;
      const bitsPerPixel = (bytesEmitted * 8) / deferPixels;
      if (bitsPerPixel > 11) {
        emit(clearCode, codeSize);
        reset();
        deferring = false;
      } else {
        deferStart = output.length;
        deferPixels = 0;
      }
    }
  }

  for (let i = 1; i < pixels.length; i++) {
    const suffix = pixels[i];
    const exactKey = (prefix << 8) | suffix;

    if (dict.has(exactKey)) {
      prefix = dict.get(exactKey)!;
    } else if (isLossy && suffix !== transparentIndex) {
      let bestKey = -1;
      let bestDist = lossiness + 1;
      const base = suffix * 256;
      for (let alt = 0; alt < numColors; alt++) {
        if (alt === suffix || alt === transparentIndex) continue;
        const d = distTable![base + alt];
        if (d <= lossiness && d < bestDist) {
          const altKey = (prefix << 8) | alt;
          if (dict.has(altKey)) {
            bestKey = altKey;
            bestDist = d;
          }
        }
      }

      if (bestKey >= 0) {
        prefix = dict.get(bestKey)!;
      } else {
        emit(prefix, codeSize);

        if (nextCode <= MAX_CODE) {
          if (nextCode >= 1 << codeSize && codeSize < 12) {
            codeSize++;
          }
          dict.set(exactKey, nextCode);
          nextCode++;
        } else if (!deferring) {
          deferring = true;
          deferStart = output.length;
          deferPixels = 0;
        }
        checkDefer();

        prefix = suffix;
      }
    } else {
      emit(prefix, codeSize);

      if (nextCode <= MAX_CODE) {
        if (nextCode >= 1 << codeSize && codeSize < 12) {
          codeSize++;
        }
        dict.set(exactKey, nextCode);
        nextCode++;
      } else if (!deferring) {
        deferring = true;
        deferStart = output.length;
        deferPixels = 0;
      }
      checkDefer();

      prefix = suffix;
    }
  }

  emit(prefix, codeSize);
  emit(eoiCode, codeSize);
  if (curBits > 0) output.push(curByte & 0xff);

  return new Uint8Array(output);
}
