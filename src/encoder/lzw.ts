/**
 * GIF-flavored LZW compression.
 *
 * Variable-width codes from (minCodeSize + 1) up to 12 bits,
 * packed LSB-first into a byte stream. Uses the "early change"
 * convention for code-width bumps to stay in sync with standard
 * GIF decoders.
 *
 * @module
 */

const MAX_CODE = 4095;

/**
 * Compress indexed pixel data using GIF LZW.
 *
 * @param pixels - Palette indices (each value must be < 2^minCodeSize)
 * @param minCodeSize - Minimum code size in bits (2–8, derived from palette depth)
 * @returns Raw compressed byte stream (caller handles sub-blocking)
 */
export function lzwEncode(
  pixels: Uint8Array,
  minCodeSize: number,
): Uint8Array {
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

  for (let i = 1; i < pixels.length; i++) {
    const suffix = pixels[i];
    const key = (prefix << 8) | suffix;

    if (dict.has(key)) {
      prefix = dict.get(key)!;
    } else {
      emit(prefix, codeSize);

      if (nextCode <= MAX_CODE) {
        if (nextCode >= 1 << codeSize && codeSize < 12) {
          codeSize++;
        }
        dict.set(key, nextCode);
        nextCode++;
      } else {
        emit(clearCode, codeSize);
        reset();
      }

      prefix = suffix;
    }
  }

  emit(prefix, codeSize);
  emit(eoiCode, codeSize);
  if (curBits > 0) output.push(curByte & 0xff);

  return new Uint8Array(output);
}
