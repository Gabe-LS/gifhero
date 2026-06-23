/**
 * libimagequant WASM quantizer wrapper.
 *
 * Wraps the `imagequant` npm package (v0.1.2 by valterkraemer) to produce
 * a palette and indexed pixel output. The WASM module is loaded lazily on
 * first call and cached for subsequent invocations.
 *
 * This is a Tier 1 quantizer — highest quality palettes of any algorithm
 * available in gifhero — but requires the optional `imagequant` peer
 * dependency and a Node.js environment (uses `fs` and `zlib`).
 *
 * @module
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { createRequire } from "module";
import { inflateSync } from "zlib";

// ── WASM initialization ─────────────────────────────────────────

let wasmReady: Promise<any> | null = null;

async function initWasm(): Promise<any> {
  if (wasmReady) return wasmReady;
  wasmReady = (async () => {
    const require = createRequire(import.meta.url);
    const bgPath = require.resolve("imagequant/imagequant_bg.js");
    const wasmPath = join(dirname(bgPath), "imagequant_bg.wasm");
    const wasmBinary = readFileSync(wasmPath);
    const bg = await import("imagequant/imagequant_bg.js");
    const mod = await WebAssembly.instantiate(
      wasmBinary.buffer as ArrayBuffer,
      { "./imagequant_bg.js": bg as unknown as WebAssembly.ModuleImports },
    );
    bg.__wbg_set_wasm(mod.instance.exports);
    return bg;
  })();
  return wasmReady;
}

// ── PNG chunk parsing helpers ───────────────────────────────────

/**
 * Read a 4-byte big-endian unsigned integer from a Uint8Array.
 */
function readU32(buf: Uint8Array, offset: number): number {
  return (
    ((buf[offset] << 24) |
      (buf[offset + 1] << 16) |
      (buf[offset + 2] << 8) |
      buf[offset + 3]) >>>
    0
  );
}

/**
 * Read the 4-character ASCII chunk type starting at `offset`.
 */
function readChunkType(buf: Uint8Array, offset: number): string {
  return String.fromCharCode(
    buf[offset],
    buf[offset + 1],
    buf[offset + 2],
    buf[offset + 3],
  );
}

/**
 * Extract the PLTE (palette) chunk from a PNG as a flat RGB Uint8Array.
 *
 * @param png - Raw PNG file bytes
 * @returns Flat RGB palette data (numColors * 3 bytes)
 */
function extractPalette(png: Uint8Array): Uint8Array {
  let pos = 8; // skip PNG signature
  while (pos < png.length) {
    const len = readU32(png, pos);
    const type = readChunkType(png, pos + 4);
    if (type === "PLTE") {
      return png.slice(pos + 8, pos + 8 + len);
    }
    pos += 12 + len; // 4 (length) + 4 (type) + len (data) + 4 (CRC)
  }
  throw new Error(
    "No PLTE chunk found in imagequant PNG output — the WASM module may have produced an invalid result",
  );
}

/**
 * Find the first fully-transparent palette entry from the tRNS chunk.
 *
 * @param png - Raw PNG file bytes
 * @returns Index of the first alpha=0 entry, or -1 if none
 */
function extractTransparentIndex(png: Uint8Array): number {
  let pos = 8;
  while (pos < png.length) {
    const len = readU32(png, pos);
    const type = readChunkType(png, pos + 4);
    if (type === "tRNS") {
      const data = png.subarray(pos + 8, pos + 8 + len);
      for (let i = 0; i < data.length; i++) {
        if (data[i] === 0) return i;
      }
      return -1;
    }
    pos += 12 + len;
  }
  return -1;
}

// ── PNG scanline filters ────────────────────────────────────────

/**
 * Paeth predictor as defined in the PNG specification (RFC 2083).
 */
function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * Extract indexed pixel data from a PNG produced by imagequant.
 *
 * Parses IHDR for bit depth, concatenates IDAT chunks, decompresses
 * with zlib, then un-filters scanlines and unpacks palette indices.
 *
 * Handles PNG filter types 0 (None), 1 (Sub), 2 (Up), 3 (Average),
 * and 4 (Paeth).
 *
 * @param png - Raw PNG file bytes
 * @param width - Image width in pixels
 * @param height - Image height in pixels
 * @returns One byte per pixel, each byte being a palette index
 */
function extractIndexed(
  png: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  // Parse IHDR for bit depth
  let bitDepth = 8;
  let pos = 8;
  while (pos < png.length) {
    const len = readU32(png, pos);
    const type = readChunkType(png, pos + 4);
    if (type === "IHDR") {
      bitDepth = png[pos + 8 + 8]; // bit depth is byte 8 within IHDR data
      break;
    }
    pos += 12 + len;
  }

  // Collect all IDAT chunks
  const idatChunks: Uint8Array[] = [];
  pos = 8;
  while (pos < png.length) {
    const len = readU32(png, pos);
    const type = readChunkType(png, pos + 4);
    if (type === "IDAT") {
      idatChunks.push(png.slice(pos + 8, pos + 8 + len));
    }
    pos += 12 + len;
  }

  // Concatenate and decompress
  const totalLen = idatChunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const compressed = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of idatChunks) {
    compressed.set(chunk, offset);
    offset += chunk.length;
  }
  const raw = inflateSync(compressed);

  // Un-filter scanlines and extract palette indices
  const pixelsPerByte = 8 / bitDepth;
  const bytesPerRow = Math.ceil(width / pixelsPerByte);
  const indexed = new Uint8Array(width * height);

  // Previous row buffer for Up / Average / Paeth filters
  let prevRow = new Uint8Array(bytesPerRow);
  let rawPos = 0;

  for (let y = 0; y < height; y++) {
    const filterType = raw[rawPos++];
    const rowData = new Uint8Array(bytesPerRow);

    for (let x = 0; x < bytesPerRow; x++) {
      const rawByte = raw[rawPos++];
      const a = x > 0 ? rowData[x - 1] : 0; // left
      const b = prevRow[x]; // above
      const c = x > 0 ? prevRow[x - 1] : 0; // upper-left

      switch (filterType) {
        case 0: // None
          rowData[x] = rawByte;
          break;
        case 1: // Sub
          rowData[x] = (rawByte + a) & 0xff;
          break;
        case 2: // Up
          rowData[x] = (rawByte + b) & 0xff;
          break;
        case 3: // Average
          rowData[x] = (rawByte + ((a + b) >>> 1)) & 0xff;
          break;
        case 4: // Paeth
          rowData[x] = (rawByte + paethPredictor(a, b, c)) & 0xff;
          break;
        default:
          rowData[x] = rawByte;
      }
    }

    // Unpack indices from the decoded row bytes
    if (bitDepth === 8) {
      for (let x = 0; x < width; x++) {
        indexed[y * width + x] = rowData[x];
      }
    } else {
      const mask = (1 << bitDepth) - 1;
      for (let x = 0; x < width; x++) {
        const byteIdx = Math.floor(x / pixelsPerByte);
        const bitOffset =
          (pixelsPerByte - 1 - (x % pixelsPerByte)) * bitDepth;
        indexed[y * width + x] = (rowData[byteIdx] >> bitOffset) & mask;
      }
    }

    prevRow = rowData;
  }

  return indexed;
}

// ── Public API ──────────────────────────────────────────────────

/**
 * Options for the imagequant WASM quantizer.
 */
export interface ImagequantOptions {
  /** Target quality 0-100 (similar to JPEG quality). Default 80. */
  quality: number;
  /** Speed 1-10. Lower is slower but higher quality. Default 3. */
  speed: number;
  /** Maximum palette size 2-256. Default 256. */
  maxColors: number;
}

/**
 * Quantize RGBA pixel data using libimagequant via WASM.
 *
 * Produces the highest-quality palettes of any quantizer available in
 * gifhero, but requires the optional `imagequant` peer dependency and
 * a Node.js environment.
 *
 * Returns `null` if the WASM module fails to load (e.g. the `imagequant`
 * package is not installed or the environment does not support WASM).
 *
 * @param rgba - Source pixels as RGBA (4 bytes per pixel)
 * @param width - Image width in pixels
 * @param height - Image height in pixels
 * @param options - Quantization options (quality, speed, maxColors)
 * @returns Object with flat RGB palette and one-byte-per-pixel indexed
 *   array, or `null` if WASM initialization failed
 */
export async function quantizeImagequant(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  options?: Partial<ImagequantOptions>,
): Promise<{ palette: Uint8Array; indexed: Uint8Array; transparentIndex: number } | null> {
  let bg;
  try {
    bg = await initWasm();
  } catch {
    return null;
  }

  const { quality = 80, speed = 3, maxColors = 256 } = options ?? {};

  const iq = new bg.Imagequant();
  iq.set_quality(0, quality);
  iq.set_speed(speed);
  iq.set_max_colors(maxColors);

  const img = bg.Imagequant.new_image(
    new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength),
    width,
    height,
    0.0,
  );
  const pngData: Uint8Array = iq.process(img);
  iq.free();
  // Don't call img.free() — process() consumes the image internally

  const palette = extractPalette(pngData);
  const indexed = extractIndexed(pngData, width, height);
  const transparentIndex = extractTransparentIndex(pngData);

  return { palette, indexed, transparentIndex };
}
