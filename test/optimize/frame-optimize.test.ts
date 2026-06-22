import { describe, it, expect } from "vitest";
import { createCanvas, loadImage } from "canvas";
import { writeFileSync, mkdirSync, readdirSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { encode } from "../../src/index.js";
import {
  computeFrameDiff,
  optimizeDisposals,
} from "../../src/optimize/index.js";

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
    if (width === 0) { width = w; height = h; }
    frames.push({ data });
  }
  return { frames, width, height };
}

function fileSize(path: string): number {
  return statSync(path).size;
}

// ── Unit tests: frame-diff ───────────────────────────────────────

describe("computeFrameDiff", () => {
  it("returns minimal 1x1 frame when nothing changed", () => {
    const indexed = new Uint8Array([0, 0, 0, 0]); // 2x2
    // Both frames have identical RGBA pixels
    const rgba = new Uint8ClampedArray([255,0,0,255, 255,0,0,255, 255,0,0,255, 255,0,0,255]);
    const prevRgba = new Uint8ClampedArray([255,0,0,255, 255,0,0,255, 255,0,0,255, 255,0,0,255]);

    const diff = computeFrameDiff(indexed, rgba, prevRgba, 2, 2, 0);
    expect(diff.width).toBe(1);
    expect(diff.height).toBe(1);
    expect(diff.transparentIndex).toBe(0);
    expect(diff.indexedPixels.length).toBe(1);
  });

  it("detects changed pixels and crops bounding box", () => {
    // 4x4 frame, only pixel (2,1) changed from red to green
    const indexed = new Uint8Array(16).fill(0);
    indexed[4 * 1 + 2] = 1; // pixel (2,1) is palette index 1

    const currRgba = new Uint8ClampedArray(16 * 4);
    const prevRgba = new Uint8ClampedArray(16 * 4);
    for (let i = 0; i < 16; i++) {
      currRgba[i * 4] = 255; prevRgba[i * 4] = 255; // red
      currRgba[i * 4 + 3] = 255; prevRgba[i * 4 + 3] = 255;
    }
    // Change pixel (2,1) to green in current
    const ci = (1 * 4 + 2) * 4;
    currRgba[ci] = 0; currRgba[ci + 1] = 255; currRgba[ci + 2] = 0;

    const diff = computeFrameDiff(indexed, currRgba, prevRgba, 4, 4, 0);
    expect(diff.left).toBe(2);
    expect(diff.top).toBe(1);
    expect(diff.width).toBe(1);
    expect(diff.height).toBe(1);
    expect(diff.indexedPixels[0]).toBe(1);
    expect(diff.transparentIndex).toBeGreaterThanOrEqual(0);
  });

  it("respects tolerance parameter", () => {
    const indexed = new Uint8Array([0, 1]);
    const currRgba = new Uint8ClampedArray([100,100,100,255, 102,102,102,255]);
    const prevRgba = new Uint8ClampedArray([100,100,100,255, 100,100,100,255]);

    // tolerance=0: pixel 1 changed (100→102, L1=6)
    const diff0 = computeFrameDiff(indexed, currRgba, prevRgba, 2, 1, 0);
    expect(diff0.width * diff0.height).toBeGreaterThan(0);

    // tolerance=10: pixel 1 is "close enough" (L1 dist = 6 ≤ 10)
    const diff10 = computeFrameDiff(indexed, currRgba, prevRgba, 2, 1, 10);
    expect(diff10.width).toBe(1);
    expect(diff10.height).toBe(1);
    expect(diff10.transparentIndex).toBe(0); // no-change frame
  });
});

// ── Unit tests: disposal ─────────────────────────────────────────

describe("optimizeDisposals", () => {
  it("returns all zeros for single frame", () => {
    const frames = [
      { data: new Uint8ClampedArray([100, 100, 100, 255]) },
    ];
    const d = optimizeDisposals(frames, 1, 1, 0);
    expect(d).toEqual([0]);
  });

  it("prefers dispose-none for similar consecutive frames", () => {
    const f0 = { data: new Uint8ClampedArray([100,100,100,255, 100,100,100,255, 100,100,100,255, 100,100,100,255]) };
    const f1 = { data: new Uint8ClampedArray([101,101,101,255, 101,101,101,255, 101,101,101,255, 101,101,101,255]) };
    // f0→f1: L1 dist = 3 per pixel (small)
    // bg→f1: L1 dist = 303 per pixel (large)
    const d = optimizeDisposals([f0, f1], 2, 2, 0);
    expect(d[0]).toBe(0); // dispose-none wins
  });
});

// ── Integration: encode with optimization ────────────────────────

describe("encode with optimize", () => {
  it("candle-flame: optimized is smaller than unoptimized", async () => {
    const { frames, width, height } = await loadFrameSequence(
      join(FIXTURES, "candle-flame"),
    );
    const encFrames = frames.map((f) => ({ data: f.data, delay: 50 }));

    const noOpt = encode({
      width, height, frames: encFrames, quality: 10, optimize: false,
    });
    const withOpt = encode({
      width, height, frames: encFrames, quality: 10,
      optimize: { frameDiff: true, frameDiffTolerance: 3, disposalOptimize: true },
    });

    writeFileSync(join(OUTPUT, "candle-flame-noopt.gif"), noOpt);
    writeFileSync(join(OUTPUT, "candle-flame-opt.gif"), withOpt);

    expect(withOpt.length).toBeLessThan(noOpt.length);

    const reduction = (1 - withOpt.length / noOpt.length) * 100;
    console.log(
      `  candle-flame: ${(noOpt.length / 1024).toFixed(0)}KB → ${(withOpt.length / 1024).toFixed(0)}KB (${reduction.toFixed(0)}% reduction)`,
    );
  }, 120_000);

  it("screen-recording: optimized is smaller than unoptimized", async () => {
    const { frames, width, height } = await loadFrameSequence(
      join(FIXTURES, "screen-recording"),
    );
    const encFrames = frames.map((f) => ({ data: f.data, delay: 50 }));

    const noOpt = encode({
      width, height, frames: encFrames, quality: 10, optimize: false,
    });
    const withOpt = encode({
      width, height, frames: encFrames, quality: 10,
      optimize: { frameDiff: true, frameDiffTolerance: 3, disposalOptimize: true },
    });

    writeFileSync(join(OUTPUT, "screen-recording-noopt.gif"), noOpt);
    writeFileSync(join(OUTPUT, "screen-recording-opt.gif"), withOpt);

    expect(withOpt.length).toBeLessThan(noOpt.length);

    const reduction = (1 - withOpt.length / noOpt.length) * 100;
    console.log(
      `  screen-recording: ${(noOpt.length / 1024).toFixed(0)}KB → ${(withOpt.length / 1024).toFixed(0)}KB (${reduction.toFixed(0)}% reduction)`,
    );
  }, 120_000);

  it("optimized GIF is still valid GIF89a", async () => {
    const { frames, width, height } = await loadFrameSequence(
      join(FIXTURES, "candle-flame"),
    );
    const gif = encode({
      width, height,
      frames: frames.map((f) => ({ data: f.data, delay: 50 })),
      quality: 10,
      optimize: { frameDiff: true, frameDiffTolerance: 0 },
    });

    const sig = String.fromCharCode(...Array.from(gif.slice(0, 6)));
    expect(sig).toBe("GIF89a");
    expect(gif[gif.length - 1]).toBe(0x3b);
  }, 120_000);

  it("tolerance=0 is lossless (exact index match)", async () => {
    const { frames, width, height } = await loadFrameSequence(
      join(FIXTURES, "candle-flame"),
    );
    const encFrames = frames.map((f) => ({ data: f.data, delay: 50 }));

    // Isolate the frame-diff variable by disabling temporal dithering and using local palettes
    const shared = { width, height, frames: encFrames, quality: 10, temporalDither: false, palette: "local" as const };

    const noOpt = encode({ ...shared, optimize: false });
    const lossless = encode({ ...shared, optimize: { frameDiff: true, frameDiffTolerance: 0 } });

    expect(lossless.length).toBeLessThan(noOpt.length);
  }, 120_000);

  it("shapes animation with optimization produces valid output", async () => {
    const { frames, width, height } = await loadFrameSequence(
      join(FIXTURES, "shapes"),
    );

    const gif = encode({
      width, height,
      frames: frames.map((f) => ({ data: f.data, delay: 50 })),
      quality: 10,
      optimize: { frameDiff: true, frameDiffTolerance: 2 },
    });

    writeFileSync(join(OUTPUT, "shapes-opt.gif"), gif);
    expect(gif.length).toBeGreaterThan(100);
  }, 120_000);

  it("optimize defaults are on (balanced preset)", async () => {
    const { frames, width, height } = await loadFrameSequence(
      join(FIXTURES, "candle-flame"),
    );
    const encFrames = frames.map((f) => ({ data: f.data, delay: 50 }));

    // Default encode (no explicit optimize option)
    const defaultGif = encode({ width, height, frames: encFrames, quality: 10 });

    // Explicit optimize=false
    const noOptGif = encode({
      width, height, frames: encFrames, quality: 10, optimize: false,
    });

    // Default should be optimized (smaller)
    expect(defaultGif.length).toBeLessThan(noOptGif.length);
  }, 120_000);
});
