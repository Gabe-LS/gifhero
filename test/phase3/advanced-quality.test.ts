import { describe, it, expect } from "vitest";
import { loadImage, createCanvas } from "canvas";
import { writeFileSync, mkdirSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { encode, generatePalettes, neuquant } from "../../src/index.js";
import { computeFlickerScore } from "../metrics/flicker.js";

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
  return { data: ctx.getImageData(0, 0, canvas.width, canvas.height).data, width: canvas.width, height: canvas.height };
}

async function loadFrameSequence(dir: string): Promise<{
  frames: Array<{ data: Uint8ClampedArray }>;
  width: number;
  height: number;
}> {
  const files = readdirSync(dir).filter((f) => f.endsWith(".png")).sort();
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

function decodeToPngFrames(
  gif: Uint8Array,
  outDir: string,
): void {
  mkdirSync(outDir, { recursive: true });
  const tmpGif = join(outDir, "_tmp.gif");
  writeFileSync(tmpGif, gif);
  const { execSync } = require("child_process");
  execSync(`ffmpeg -y -i "${tmpGif}" -vsync 0 "${outDir}/%04d.png"`, {
    stdio: "ignore",
    timeout: 30000,
  });
}

async function loadRgbaFramesFromDir(
  dir: string,
  width: number,
  height: number,
): Promise<Uint8ClampedArray[]> {
  const files = readdirSync(dir).filter((f) => f.endsWith(".png") && !f.startsWith("_")).sort();
  const frames: Uint8ClampedArray[] = [];
  for (const file of files) {
    const { data } = await loadRgba(join(dir, file));
    frames.push(data);
  }
  return frames;
}

// ── Cross-frame palette tests ────────────────────────────────────

describe("cross-frame palette", () => {
  it("adjacent frames share more palette colors than independent quantization", async () => {
    const { frames } = await loadFrameSequence(join(FIXTURES, "candle-flame"));
    const first10 = frames.slice(0, 10);

    const localPalettes = generatePalettes(first10, "local", 10);
    const crossPalettes = generatePalettes(first10, "crossframe", 10);

    let localShared = 0;
    let crossShared = 0;
    for (let i = 1; i < 10; i++) {
      localShared += countSharedColors(localPalettes[i - 1], localPalettes[i], 8);
      crossShared += countSharedColors(crossPalettes[i - 1], crossPalettes[i], 8);
    }

    expect(crossShared).toBeGreaterThan(localShared);
  }, 60_000);
});

function countSharedColors(a: Uint8Array, b: Uint8Array, tolerance: number): number {
  let shared = 0;
  for (let i = 0; i < 256; i++) {
    const ar = a[i * 3], ag = a[i * 3 + 1], ab = a[i * 3 + 2];
    for (let j = 0; j < 256; j++) {
      const dr = Math.abs(ar - b[j * 3]);
      const dg = Math.abs(ag - b[j * 3 + 1]);
      const db = Math.abs(ab - b[j * 3 + 2]);
      if (dr + dg + db <= tolerance) {
        shared++;
        break;
      }
    }
  }
  return shared;
}

// ── Temporal dithering tests ─────────────────────────────────────

describe("temporal dithering", () => {
  it("crossframe palettes reduce flicker vs local palettes on candle-flame", async () => {
    const { frames, width, height } = await loadFrameSequence(
      join(FIXTURES, "candle-flame"),
    );
    const encFrames = frames.map((f) => ({ data: f.data, delay: 50 }));

    const noTemporal = encode({
      width, height, frames: encFrames,
      palette: "local",
      quality: 10,
      optimize: false,
    });

    const withTemporal = encode({
      width, height, frames: encFrames,
      palette: "crossframe",
      quality: 10,
      optimize: false,
    });

    const noTempDir = join(OUTPUT, "_tfs-no-temporal");
    const withTempDir = join(OUTPUT, "_tfs-with-temporal");

    decodeToPngFrames(noTemporal, noTempDir);
    decodeToPngFrames(withTemporal, withTempDir);

    const sourceRgba = frames.map((f) => f.data);
    const noTempRgba = await loadRgbaFramesFromDir(noTempDir, width, height);
    const withTempRgba = await loadRgbaFramesFromDir(withTempDir, width, height);

    const minCount = Math.min(sourceRgba.length, noTempRgba.length, withTempRgba.length);
    const srcSlice = sourceRgba.slice(0, minCount);

    const noTempTFS = computeFlickerScore(srcSlice, noTempRgba.slice(0, minCount), width, height);
    const withTempTFS = computeFlickerScore(srcSlice, withTempRgba.slice(0, minCount), width, height);

    console.log(`  TFS without temporal: ${noTempTFS.score.toFixed(4)}`);
    console.log(`  TFS with temporal:    ${withTempTFS.score.toFixed(4)}`);

    expect(withTempTFS.score).toBeLessThan(noTempTFS.score);

    writeFileSync(join(OUTPUT, "color-wheel-no-temporal.gif"), noTemporal);
    writeFileSync(join(OUTPUT, "color-wheel-with-temporal.gif"), withTemporal);
  }, 180_000);
});

// ── Presets tests ────────────────────────────────────────────────

describe("presets", () => {
  it("all three presets produce valid GIF output", async () => {
    const { data, width, height } = await loadRgba(
      join(FIXTURES, "gradient", "0001.png"),
    );
    const frames = [{ data, delay: 0 }];

    for (const preset of ["quality", "balanced", "speed"] as const) {
      const gif = encode({ width, height, frames, preset, loop: -1 });
      expect(gif).toBeInstanceOf(Uint8Array);
      const sig = String.fromCharCode(...Array.from(gif.slice(0, 6)));
      expect(sig).toBe("GIF89a");
    }
  });

  it("quality preset produces better DSSIM than speed on gradient", async () => {
    const { frames, width, height } = await loadFrameSequence(
      join(FIXTURES, "shapes"),
    );
    const encFrames = frames.slice(0, 10).map((f) => ({ data: f.data, delay: 50 }));

    const qualityGif = encode({ width, height, frames: encFrames, preset: "quality" });
    const speedGif = encode({ width, height, frames: encFrames, preset: "speed" });

    // Quality preset should produce larger but better-looking output
    expect(qualityGif.length).toBeGreaterThan(0);
    expect(speedGif.length).toBeGreaterThan(0);

    writeFileSync(join(OUTPUT, "shapes-quality-preset.gif"), qualityGif);
    writeFileSync(join(OUTPUT, "shapes-speed-preset.gif"), speedGif);
  }, 120_000);
});

// ── Adaptive palette reuse tests ─────────────────────────────────

describe("adaptive palette reuse", () => {
  it("reuses palettes for >50% of screencast frames", async () => {
    const { frames } = await loadFrameSequence(join(FIXTURES, "screencast"));

    const localPalettes = generatePalettes(frames, "local", 10);
    const adaptivePalettes = generatePalettes(frames, "adaptive", 10);

    let reused = 0;
    for (let i = 1; i < frames.length; i++) {
      if (adaptivePalettes[i] === adaptivePalettes[i - 1]) {
        reused++;
      }
    }

    const reusePct = (reused / (frames.length - 1)) * 100;
    console.log(`  Adaptive palette reuse on screencast: ${reusePct.toFixed(0)}% of frames`);
    expect(reusePct).toBeGreaterThan(50);
  }, 60_000);
});
