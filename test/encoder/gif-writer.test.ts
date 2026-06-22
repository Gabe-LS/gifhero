import { describe, it, expect } from "vitest";
import { createCanvas, loadImage } from "canvas";
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { writeGif, lzwEncode } from "../../src/encoder/index.js";
import type { GifFrame, GifWriterOptions } from "../../src/encoder/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, "..", "fixtures", "generated");
const OUTPUT_DIR = join(__dirname, "..", "fixtures", "generated", "output");

mkdirSync(OUTPUT_DIR, { recursive: true });

// ── Helpers ──────────────────────────────────────────────────────

async function loadRgba(
  path: string,
): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
  const img = await loadImage(path);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { data: imageData.data, width: canvas.width, height: canvas.height };
}

function trivialQuantize(rgba: Uint8ClampedArray): {
  indexedPixels: Uint8Array;
  palette: Uint8Array;
} {
  const colorMap = new Map<number, number>();
  const paletteRgb: number[] = [];
  const pixelCount = rgba.length / 4;
  const indexed = new Uint8Array(pixelCount);

  for (let i = 0; i < pixelCount; i++) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    const key = (r << 16) | (g << 8) | b;

    if (!colorMap.has(key)) {
      const idx = colorMap.size;
      colorMap.set(key, idx);
      paletteRgb.push(r, g, b);
    }
    indexed[i] = colorMap.get(key)!;
  }

  return { indexedPixels: indexed, palette: new Uint8Array(paletteRgb) };
}

// ── Minimal GIF structure parser (for verification) ──────────────

interface ParsedGif {
  version: string;
  width: number;
  height: number;
  hasGlobalColorTable: boolean;
  globalColorTableSize: number;
  backgroundIndex: number;
  hasNetscapeExt: boolean;
  loopCount: number;
  frames: Array<{
    left: number;
    top: number;
    width: number;
    height: number;
    delay: number;
    disposal: number;
    hasLocalColorTable: boolean;
    localColorTableSize: number;
    hasTransparency: boolean;
    transparentIndex: number;
  }>;
  hasTrailer: boolean;
}

function parseGif(data: Uint8Array): ParsedGif {
  let pos = 0;

  const version =
    String.fromCharCode(...Array.from(data.slice(0, 6)));
  pos = 6;

  const width = data[pos] | (data[pos + 1] << 8);
  const height = data[pos + 2] | (data[pos + 3] << 8);
  const packed = data[pos + 4];
  const hasGCT = (packed >> 7) & 1;
  const gctBits = (packed & 0x07) + 1;
  const gctSize = hasGCT ? 1 << gctBits : 0;
  const backgroundIndex = data[pos + 5];
  pos += 7;

  if (hasGCT) pos += gctSize * 3;

  const frames: ParsedGif["frames"] = [];
  let hasNetscapeExt = false;
  let loopCount = 0;
  let hasTrailer = false;

  let pendingDelay = 0;
  let pendingDisposal = 0;
  let pendingTransparency = false;
  let pendingTransparentIndex = 0;

  while (pos < data.length) {
    const block = data[pos++];

    if (block === 0x3b) {
      hasTrailer = true;
      break;
    }

    if (block === 0x21) {
      const label = data[pos++];

      if (label === 0xf9) {
        pos++; // block size (4)
        const gcePacked = data[pos];
        pendingDisposal = (gcePacked >> 2) & 0x07;
        pendingTransparency = (gcePacked & 0x01) === 1;
        pendingDelay = data[pos + 1] | (data[pos + 2] << 8);
        pendingTransparentIndex = data[pos + 3];
        pos += 4;
        pos++; // terminator
      } else if (label === 0xff) {
        const appBlockSize = data[pos++];
        const appId = String.fromCharCode(
          ...Array.from(data.slice(pos, pos + appBlockSize)),
        );
        pos += appBlockSize;

        if (appId === "NETSCAPE2.0") {
          hasNetscapeExt = true;
          pos++; // sub-block size (3)
          pos++; // sub-block ID (1)
          loopCount = data[pos] | (data[pos + 1] << 8);
          pos += 2;
          pos++; // terminator
        } else {
          while (data[pos] !== 0) {
            pos += data[pos] + 1;
          }
          pos++;
        }
      } else {
        while (data[pos] !== 0) {
          pos += data[pos] + 1;
        }
        pos++;
      }
    } else if (block === 0x2c) {
      const fLeft = data[pos] | (data[pos + 1] << 8);
      const fTop = data[pos + 2] | (data[pos + 3] << 8);
      const fWidth = data[pos + 4] | (data[pos + 5] << 8);
      const fHeight = data[pos + 6] | (data[pos + 7] << 8);
      const fPacked = data[pos + 8];
      const hasLCT = (fPacked >> 7) & 1;
      const lctBits = (fPacked & 0x07) + 1;
      const lctSize = hasLCT ? 1 << lctBits : 0;
      pos += 9;

      if (hasLCT) pos += lctSize * 3;

      pos++; // min code size
      while (data[pos] !== 0) {
        pos += data[pos] + 1;
      }
      pos++; // terminator

      frames.push({
        left: fLeft,
        top: fTop,
        width: fWidth,
        height: fHeight,
        delay: pendingDelay,
        disposal: pendingDisposal,
        hasLocalColorTable: hasLCT === 1,
        localColorTableSize: lctSize,
        hasTransparency: pendingTransparency,
        transparentIndex: pendingTransparentIndex,
      });

      pendingDelay = 0;
      pendingDisposal = 0;
      pendingTransparency = false;
      pendingTransparentIndex = 0;
    }
  }

  return {
    version,
    width,
    height,
    hasGlobalColorTable: hasGCT === 1,
    globalColorTableSize: gctSize,
    backgroundIndex,
    hasNetscapeExt,
    loopCount,
    frames,
    hasTrailer,
  };
}

// ── Tests ────────────────────────────────────────────────────────

describe("lzwEncode", () => {
  it("compresses a constant-value stream", () => {
    const pixels = new Uint8Array(100).fill(0);
    const compressed = lzwEncode(pixels, 2);
    expect(compressed).toBeInstanceOf(Uint8Array);
    expect(compressed.length).toBeGreaterThan(0);
    expect(compressed.length).toBeLessThan(pixels.length);
  });

  it("compresses an alternating-value stream", () => {
    const pixels = new Uint8Array(200);
    for (let i = 0; i < pixels.length; i++) pixels[i] = i % 4;
    const compressed = lzwEncode(pixels, 2);
    expect(compressed.length).toBeGreaterThan(0);
  });

  it("handles single-pixel input", () => {
    const compressed = lzwEncode(new Uint8Array([0]), 2);
    expect(compressed.length).toBeGreaterThan(0);
  });

  it("handles empty input", () => {
    const compressed = lzwEncode(new Uint8Array(0), 2);
    expect(compressed.length).toBeGreaterThan(0);
  });

  it("handles minCodeSize=8 (256-color palette)", () => {
    const pixels = new Uint8Array(1000);
    for (let i = 0; i < pixels.length; i++) pixels[i] = i % 256;
    const compressed = lzwEncode(pixels, 8);
    expect(compressed.length).toBeGreaterThan(0);
  });
});

describe("writeGif", () => {
  describe("solid-red single-frame GIF", () => {
    let gif: Uint8Array;
    let parsed: ParsedGif;

    it("encodes from fixture without throwing", async () => {
      const { data, width, height } = await loadRgba(
        join(FIXTURES, "solid-red", "0001.png"),
      );
      const { indexedPixels, palette } = trivialQuantize(data);

      const frame: GifFrame = {
        indexedPixels,
        palette,
        width,
        height,
        delay: 0,
      };

      gif = writeGif([frame], { width, height, loop: -1 });
      expect(gif).toBeInstanceOf(Uint8Array);
      expect(gif.length).toBeGreaterThan(0);

      const outPath = join(OUTPUT_DIR, "solid-red.gif");
      writeFileSync(outPath, gif);

      parsed = parseGif(gif);
    });

    it("has GIF89a header", () => {
      expect(parsed.version).toBe("GIF89a");
    });

    it("has correct dimensions", () => {
      expect(parsed.width).toBe(100);
      expect(parsed.height).toBe(100);
    });

    it("has exactly 1 frame", () => {
      expect(parsed.frames.length).toBe(1);
    });

    it("frame covers the full canvas", () => {
      const f = parsed.frames[0];
      expect(f.left).toBe(0);
      expect(f.top).toBe(0);
      expect(f.width).toBe(100);
      expect(f.height).toBe(100);
    });

    it("has no Netscape extension (no loop)", () => {
      expect(parsed.hasNetscapeExt).toBe(false);
    });

    it("ends with trailer byte", () => {
      expect(parsed.hasTrailer).toBe(true);
      expect(gif[gif.length - 1]).toBe(0x3b);
    });

    it("is smaller than raw RGBA data", () => {
      expect(gif.length).toBeLessThan(100 * 100 * 4);
    });
  });

  describe("two-frame red→blue animation", () => {
    let gif: Uint8Array;
    let parsed: ParsedGif;

    it("encodes from fixtures without throwing", async () => {
      const frame1Rgba = await loadRgba(
        join(FIXTURES, "two-frame", "0001.png"),
      );
      const frame2Rgba = await loadRgba(
        join(FIXTURES, "two-frame", "0002.png"),
      );

      const q1 = trivialQuantize(frame1Rgba.data);
      const q2 = trivialQuantize(frame2Rgba.data);

      const frames: GifFrame[] = [
        {
          indexedPixels: q1.indexedPixels,
          palette: q1.palette,
          width: frame1Rgba.width,
          height: frame1Rgba.height,
          delay: 50,
        },
        {
          indexedPixels: q2.indexedPixels,
          palette: q2.palette,
          width: frame2Rgba.width,
          height: frame2Rgba.height,
          delay: 50,
        },
      ];

      gif = writeGif(frames, {
        width: frame1Rgba.width,
        height: frame1Rgba.height,
        loop: 0,
      });

      const outPath = join(OUTPUT_DIR, "two-frame.gif");
      writeFileSync(outPath, gif);

      parsed = parseGif(gif);
    });

    it("has GIF89a header", () => {
      expect(parsed.version).toBe("GIF89a");
    });

    it("has correct dimensions", () => {
      expect(parsed.width).toBe(100);
      expect(parsed.height).toBe(100);
    });

    it("has exactly 2 frames", () => {
      expect(parsed.frames.length).toBe(2);
    });

    it("frames have correct delay (500ms = 50 centiseconds)", () => {
      expect(parsed.frames[0].delay).toBe(50);
      expect(parsed.frames[1].delay).toBe(50);
    });

    it("has Netscape looping extension with infinite loop", () => {
      expect(parsed.hasNetscapeExt).toBe(true);
      expect(parsed.loopCount).toBe(0);
    });

    it("each frame has a local color table", () => {
      expect(parsed.frames[0].hasLocalColorTable).toBe(true);
      expect(parsed.frames[1].hasLocalColorTable).toBe(true);
    });

    it("ends with trailer byte", () => {
      expect(parsed.hasTrailer).toBe(true);
    });
  });

  describe("global palette", () => {
    it("encodes frames using a shared global palette", () => {
      const width = 10;
      const height = 10;
      const globalPalette = new Uint8Array([
        255, 0, 0, // red
        0, 0, 255, // blue
        0, 0, 0,   // black (padding)
        0, 0, 0,   // black (padding)
      ]);

      const redPixels = new Uint8Array(width * height).fill(0);
      const bluePixels = new Uint8Array(width * height).fill(1);

      const frames: GifFrame[] = [
        { indexedPixels: redPixels, palette: undefined as unknown as Uint8Array, width, height, delay: 50 },
        { indexedPixels: bluePixels, palette: undefined as unknown as Uint8Array, width, height, delay: 50 },
      ];

      const gif = writeGif(frames, { width, height, globalPalette, loop: 0 });
      const parsed = parseGif(gif);

      expect(parsed.hasGlobalColorTable).toBe(true);
      expect(parsed.globalColorTableSize).toBe(4);
      expect(parsed.frames[0].hasLocalColorTable).toBe(false);
      expect(parsed.frames[1].hasLocalColorTable).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("throws when a frame has no palette and no global palette", () => {
      expect(() =>
        writeGif(
          [
            {
              indexedPixels: new Uint8Array([0]),
              palette: undefined as unknown as Uint8Array,
              width: 1,
              height: 1,
            },
          ],
          { width: 1, height: 1 },
        ),
      ).toThrow(/palette/i);
    });

    it("encodes a 1x1 single-pixel GIF", () => {
      const gif = writeGif(
        [
          {
            indexedPixels: new Uint8Array([0]),
            palette: new Uint8Array([255, 0, 0]),
            width: 1,
            height: 1,
          },
        ],
        { width: 1, height: 1, loop: -1 },
      );

      const parsed = parseGif(gif);
      expect(parsed.version).toBe("GIF89a");
      expect(parsed.width).toBe(1);
      expect(parsed.height).toBe(1);
      expect(parsed.frames.length).toBe(1);
      expect(parsed.hasTrailer).toBe(true);
    });

    it("encodes a frame with transparency", () => {
      const gif = writeGif(
        [
          {
            indexedPixels: new Uint8Array([0, 1, 0, 1]),
            palette: new Uint8Array([255, 0, 0, 0, 0, 0]),
            width: 2,
            height: 2,
            transparentIndex: 1,
          },
        ],
        { width: 2, height: 2, loop: -1 },
      );

      const parsed = parseGif(gif);
      expect(parsed.frames[0].hasTransparency).toBe(true);
      expect(parsed.frames[0].transparentIndex).toBe(1);
    });
  });
});
