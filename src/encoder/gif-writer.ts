/**
 * GIF89a binary format writer.
 *
 * Produces spec-compliant GIF89a files with support for global and
 * local color tables, graphic control extensions, Netscape 2.0
 * looping, and LZW-compressed image data.
 *
 * @module
 */

import { lzwEncode } from "./lzw.js";

/** A single frame of indexed pixel data with its palette. */
export interface GifFrame {
  /** Palette indices, one byte per pixel (row-major, top-to-bottom). */
  indexedPixels: Uint8Array;
  /** Flat RGB palette bytes [R,G,B, R,G,B, …]. Need not be power-of-2 sized — it will be padded. */
  palette: Uint8Array;
  /** Frame width in pixels. */
  width: number;
  /** Frame height in pixels. */
  height: number;
  /** Display delay in centiseconds (1/100 s). Defaults to 0. */
  delay?: number;
  /** Disposal method (0–3). Defaults to 0 (unspecified). */
  disposal?: number;
  /** Transparent color index. Omit or set < 0 for no transparency. */
  transparentIndex?: number;
  /** Left offset of this frame on the logical screen. Defaults to 0. */
  left?: number;
  /** Top offset of this frame on the logical screen. Defaults to 0. */
  top?: number;
}

/** Options for the top-level GIF container. */
export interface GifWriterOptions {
  /** Logical screen width. */
  width: number;
  /** Logical screen height. */
  height: number;
  /** Optional global color table (flat RGB). Frames without their own palette use this. */
  globalPalette?: Uint8Array;
  /** Loop count: 0 = infinite, N > 0 = loop N times, negative = omit Netscape extension. Defaults to 0. */
  loop?: number;
  /** Background color index into the global palette. Defaults to 0. */
  backgroundIndex?: number;
  /** Custom LZW encoder. When provided, used instead of the default lzwEncode for image data. */
  lzwEncoder?: (pixels: Uint8Array, minCodeSize: number) => Uint8Array;
}

/**
 * Write a complete GIF89a file.
 *
 * @param frames - One or more frames to encode
 * @param options - Container-level settings (dimensions, global palette, looping)
 * @returns The full GIF file as a byte array
 */
export function writeGif(
  frames: GifFrame[],
  options: GifWriterOptions,
): Uint8Array {
  const buf = new GifBuffer();

  writeHeader(buf);
  writeLogicalScreenDescriptor(buf, options);

  if (options.globalPalette) {
    const { padded } = padPalette(options.globalPalette);
    buf.writeBytes(padded);
  }

  const loop = options.loop ?? 0;
  if (loop >= 0) {
    writeNetscapeExtension(buf, loop);
  }

  for (const frame of frames) {
    writeGraphicControlExtension(buf, frame);
    writeImageBlock(buf, frame, options);
  }

  buf.writeByte(0x3b); // trailer
  return buf.toUint8Array();
}

// ── Internal helpers ──────────────────────────────────────────────

function writeHeader(buf: GifBuffer): void {
  buf.writeString("GIF89a");
}

function writeLogicalScreenDescriptor(
  buf: GifBuffer,
  opts: GifWriterOptions,
): void {
  buf.writeUint16LE(opts.width);
  buf.writeUint16LE(opts.height);

  const hasGCT = opts.globalPalette != null;
  const { sizeField } = hasGCT
    ? padPalette(opts.globalPalette!)
    : { sizeField: 0 };

  const colorResolution = hasGCT ? sizeField : 7;
  const packed =
    ((hasGCT ? 1 : 0) << 7) |
    (colorResolution << 4) |
    (0 << 3) | // sort flag
    (hasGCT ? sizeField : 0);

  buf.writeByte(packed);
  buf.writeByte(opts.backgroundIndex ?? 0);
  buf.writeByte(0); // pixel aspect ratio
}

function writeNetscapeExtension(buf: GifBuffer, loopCount: number): void {
  buf.writeByte(0x21); // extension introducer
  buf.writeByte(0xff); // application extension label
  buf.writeByte(11); // block size
  buf.writeString("NETSCAPE2.0");
  buf.writeByte(3); // sub-block size
  buf.writeByte(1); // sub-block ID
  buf.writeUint16LE(loopCount);
  buf.writeByte(0); // block terminator
}

function writeGraphicControlExtension(
  buf: GifBuffer,
  frame: GifFrame,
): void {
  const disposal = frame.disposal ?? 0;
  const delay = frame.delay ?? 0;
  const hasTransparency =
    frame.transparentIndex != null && frame.transparentIndex >= 0;

  buf.writeByte(0x21); // extension introducer
  buf.writeByte(0xf9); // GCE label
  buf.writeByte(4); // block size
  buf.writeByte(((disposal & 0x07) << 2) | (hasTransparency ? 1 : 0));
  buf.writeUint16LE(delay);
  buf.writeByte(hasTransparency ? frame.transparentIndex! : 0);
  buf.writeByte(0); // block terminator
}

function writeImageBlock(
  buf: GifBuffer,
  frame: GifFrame,
  opts: GifWriterOptions,
): void {
  const usesLocalPalette = frame.palette != null;
  const palette = usesLocalPalette ? frame.palette : opts.globalPalette;
  if (!palette) {
    throw new Error(
      "Frame has no palette and no global palette was provided — every frame needs a color table",
    );
  }

  // Ensure palette is large enough to contain the transparent index
  const minEntries = (frame.transparentIndex != null && frame.transparentIndex >= 0)
    ? frame.transparentIndex + 1
    : 0;
  const { padded, sizeField, minCodeSize } = padPalette(palette, minEntries);

  // Image Descriptor
  buf.writeByte(0x2c); // image separator
  buf.writeUint16LE(frame.left ?? 0);
  buf.writeUint16LE(frame.top ?? 0);
  buf.writeUint16LE(frame.width);
  buf.writeUint16LE(frame.height);

  const packed =
    ((usesLocalPalette ? 1 : 0) << 7) |
    (0 << 6) | // interlace
    (0 << 5) | // sort
    (usesLocalPalette ? sizeField : 0);
  buf.writeByte(packed);

  if (usesLocalPalette) {
    buf.writeBytes(padded);
  }

  // Image Data — LZW compressed, sub-blocked
  const encoder = opts.lzwEncoder ?? lzwEncode;
  const compressed = encoder(frame.indexedPixels, minCodeSize);
  buf.writeByte(minCodeSize); // min code size byte
  writeSubBlocks(buf, compressed);
  buf.writeByte(0); // block terminator
}

function writeSubBlocks(buf: GifBuffer, data: Uint8Array): void {
  let offset = 0;
  while (offset < data.length) {
    const blockSize = Math.min(255, data.length - offset);
    buf.writeByte(blockSize);
    for (let i = 0; i < blockSize; i++) {
      buf.writeByte(data[offset + i]);
    }
    offset += blockSize;
  }
}

// ── Palette utilities ─────────────────────────────────────────────

interface PaletteInfo {
  padded: Uint8Array;
  bits: number;
  sizeField: number;
  minCodeSize: number;
}

function padPalette(palette: Uint8Array, minEntries: number = 0): PaletteInfo {
  const numColors = Math.max(palette.length / 3, minEntries);
  let bits = 1;
  while (1 << bits < numColors) bits++;

  const paddedCount = 1 << bits;
  const paddedSize = paddedCount * 3;
  let padded: Uint8Array;
  if (palette.length === paddedSize) {
    padded = palette;
  } else {
    padded = new Uint8Array(paddedSize);
    padded.set(palette);
  }

  return {
    padded,
    bits,
    sizeField: bits - 1,
    minCodeSize: Math.max(2, bits),
  };
}

// ── Byte buffer ───────────────────────────────────────────────────

class GifBuffer {
  private chunks: number[] = [];

  writeByte(b: number): void {
    this.chunks.push(b & 0xff);
  }

  writeBytes(bytes: Uint8Array): void {
    for (let i = 0; i < bytes.length; i++) {
      this.chunks.push(bytes[i]);
    }
  }

  writeUint16LE(n: number): void {
    this.chunks.push(n & 0xff);
    this.chunks.push((n >> 8) & 0xff);
  }

  writeString(s: string): void {
    for (let i = 0; i < s.length; i++) {
      this.chunks.push(s.charCodeAt(i));
    }
  }

  toUint8Array(): Uint8Array {
    return new Uint8Array(this.chunks);
  }
}
