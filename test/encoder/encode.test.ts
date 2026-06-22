import { describe, it, expect } from "vitest";
import { createCanvas, loadImage } from "canvas";
import { writeFileSync, mkdirSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { encode, neuquant, floydSteinberg, mapNearest } from "../../src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, "..", "fixtures", "generated");
const OUTPUT = join(__dirname, "..", "fixtures", "generated", "output");

mkdirSync(OUTPUT, { recursive: true });

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

async function loadFrameSequence(dir: string): Promise<{
  frames: Array<{ data: Uint8ClampedArray }>;
  width: number;
  height: number;
}> {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".png"))
    .sort();
  let width = 0;
  let height = 0;
  const frames: Array<{ data: Uint8ClampedArray }> = [];

  for (const file of files) {
    const { data, width: w, height: h } = await loadRgba(join(dir, file));
    if (width === 0) {
      width = w;
      height = h;
    }
    frames.push({ data });
  }

  return { frames, width, height };
}

// ── NeuQuant tests ───────────────────────────────────────────────

describe("neuquant", () => {
  it("returns a 768-byte palette (256 RGB entries)", async () => {
    const { data } = await loadRgba(join(FIXTURES, "gradient", "0001.png"));
    const palette = neuquant(data, 10);
    expect(palette).toBeInstanceOf(Uint8Array);
    expect(palette.length).toBe(768);
  });

  it("palette covers dominant colors from a solid image", async () => {
    const { data } = await loadRgba(join(FIXTURES, "solid-red", "0001.png"));
    const palette = neuquant(data, 1);

    // At least one palette entry should be close to pure red
    let foundRed = false;
    for (let i = 0; i < 256; i++) {
      const r = palette[i * 3];
      const g = palette[i * 3 + 1];
      const b = palette[i * 3 + 2];
      if (r > 200 && g < 50 && b < 50) {
        foundRed = true;
        break;
      }
    }
    expect(foundRed).toBe(true);
  });

  it("palette contains varied colors for a gradient", async () => {
    const { data } = await loadRgba(join(FIXTURES, "gradient", "0001.png"));
    const palette = neuquant(data, 10);

    const uniqueColors = new Set<number>();
    for (let i = 0; i < 256; i++) {
      const key =
        (palette[i * 3] << 16) |
        (palette[i * 3 + 1] << 8) |
        palette[i * 3 + 2];
      uniqueColors.add(key);
    }
    expect(uniqueColors.size).toBeGreaterThan(100);
  });
});

// ── Floyd-Steinberg tests ────────────────────────────────────────

describe("floydSteinberg", () => {
  it("returns correctly sized indexed pixel array", async () => {
    const { data, width, height } = await loadRgba(
      join(FIXTURES, "gradient", "0001.png"),
    );
    const palette = neuquant(data, 10);
    const indexed = floydSteinberg(data, width, height, palette);

    expect(indexed).toBeInstanceOf(Uint8Array);
    expect(indexed.length).toBe(width * height);
  });

  it("all indices are within palette range", async () => {
    const { data, width, height } = await loadRgba(
      join(FIXTURES, "gradient", "0001.png"),
    );
    const palette = neuquant(data, 10);
    const indexed = floydSteinberg(data, width, height, palette);

    for (let i = 0; i < indexed.length; i++) {
      expect(indexed[i]).toBeLessThan(256);
    }
  });
});

// ── mapNearest tests ─────────────────────────────────────────────

describe("mapNearest", () => {
  it("maps solid-red pixels to a red palette entry", async () => {
    const { data } = await loadRgba(join(FIXTURES, "solid-red", "0001.png"));
    const palette = neuquant(data, 1);
    const indexed = mapNearest(data, palette);

    // All pixels should map to the same index (solid color)
    const firstIdx = indexed[0];
    for (let i = 1; i < indexed.length; i++) {
      expect(indexed[i]).toBe(firstIdx);
    }

    // That index should be close to red
    const r = palette[firstIdx * 3];
    const g = palette[firstIdx * 3 + 1];
    const b = palette[firstIdx * 3 + 2];
    expect(r).toBeGreaterThan(200);
    expect(g).toBeLessThan(50);
    expect(b).toBeLessThan(50);
  });
});

// ── encode() integration tests ───────────────────────────────────

describe("encode", () => {
  it("encodes gradient single frame", async () => {
    const { data, width, height } = await loadRgba(
      join(FIXTURES, "gradient", "0001.png"),
    );

    const gif = await encode({
      width,
      height,
      frames: [{ data, delay: 0 }],
      quality: 10,
      loop: -1,
    });

    expect(gif).toBeInstanceOf(Uint8Array);
    expect(gif.length).toBeGreaterThan(100);

    // Verify GIF89a signature
    const sig = String.fromCharCode(...Array.from(gif.slice(0, 6)));
    expect(sig).toBe("GIF89a");

    writeFileSync(join(OUTPUT, "gradient.gif"), gif);
  });

  it("encodes color-wheel 60-frame animation", async () => {
    const { frames, width, height } = await loadFrameSequence(
      join(FIXTURES, "color-wheel"),
    );

    const gif = await encode({
      width,
      height,
      frames: frames.map((f) => ({ data: f.data, delay: 50 })),
      quality: 10,
    });

    expect(gif).toBeInstanceOf(Uint8Array);

    writeFileSync(join(OUTPUT, "color-wheel.gif"), gif);

    // Should be significantly smaller than raw RGBA data
    const rawSize = frames.length * width * height * 4;
    expect(gif.length).toBeLessThan(rawSize);
  }, 120_000);

  it("encodes shapes 60-frame animation", async () => {
    const { frames, width, height } = await loadFrameSequence(
      join(FIXTURES, "shapes"),
    );

    const gif = await encode({
      width,
      height,
      frames: frames.map((f) => ({ data: f.data, delay: 50 })),
      quality: 10,
    });

    expect(gif).toBeInstanceOf(Uint8Array);

    writeFileSync(join(OUTPUT, "shapes.gif"), gif);

    const rawSize = frames.length * width * height * 4;
    expect(gif.length).toBeLessThan(rawSize);
  }, 120_000);

  it("encodes without dithering", async () => {
    const { data, width, height } = await loadRgba(
      join(FIXTURES, "gradient", "0001.png"),
    );

    const gif = await encode({
      width,
      height,
      frames: [{ data }],
      dither: false,
      loop: -1,
    });

    expect(gif).toBeInstanceOf(Uint8Array);
    writeFileSync(join(OUTPUT, "gradient-nodither.gif"), gif);
  });

  it("throws on empty frames array", async () => {
    await expect(
      encode({ width: 10, height: 10, frames: [] }),
    ).rejects.toThrow(/frame/i);
  });
});
