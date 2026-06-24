/**
 * Validate that worker-thread parallelism produces identical output
 * and measure the speedup.
 */

import { readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createCanvas, Image } from "canvas";
import { encode } from "../../src/index.js";
import { encodeParallel } from "./parallel.js";
import type { EncodeJob } from "./parallel.js";
import type { EncodeOptions } from "../../src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, "..", "fixtures", "generated");

function loadPngFrames(dir: string) {
  const files = readdirSync(dir).filter((f: string) => f.endsWith(".png")).sort();
  let width = 0, height = 0;
  const frames: Array<{ data: Uint8ClampedArray; delay: number }> = [];
  for (const file of files) {
    const img = new Image();
    img.src = readFileSync(join(dir, file));
    if (width === 0) { width = img.width; height = img.height; }
    const canvas = createCanvas(img.width, img.height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    frames.push({ data: ctx.getImageData(0, 0, img.width, img.height).data, delay: 50 });
  }
  return { width, height, frames };
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

async function main() {
  const fixture = "skin-tones";
  const dir = join(FIXTURES_DIR, fixture);
  const { width, height, frames } = loadPngFrames(dir);
  console.log(`Fixture: ${fixture} (${width}×${height}, ${frames.length} frames)\n`);

  const cropToleranceValues = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 15, 18, 20, 25, 30];
  const jobCount = cropToleranceValues.length;

  // Build encode options for each job
  function makeOptions(ct: number): Omit<EncodeOptions, "width" | "height" | "frames"> {
    return {
      preset: "quality",
      optimize: { subframe: true, cropTolerance: ct, holeTolerance: 0, transparencyEqualization: true },
    };
  }

  // ── Sequential run ──

  console.log(`Running ${jobCount} encodes sequentially...`);
  const seqStart = performance.now();
  const seqResults: Array<{ ct: number; size: number; gif: Uint8Array }> = [];

  for (const ct of cropToleranceValues) {
    const gif = await encode({ width, height, frames, ...makeOptions(ct) });
    seqResults.push({ ct, size: gif.length, gif });
  }
  const seqTime = (performance.now() - seqStart) / 1000;
  console.log(`Sequential: ${seqTime.toFixed(1)}s\n`);

  // ── Parallel run ──

  console.log(`Running ${jobCount} encodes in parallel (worker threads)...`);
  const jobs: EncodeJob[] = cropToleranceValues.map((ct) => ({
    frames: frames.map((f) => ({ data: f.data, delay: f.delay })),
    width,
    height,
    options: makeOptions(ct),
  }));

  const parStart = performance.now();
  const parGifs = await encodeParallel(jobs, 16, (done, total) => {
    process.stdout.write(`\r  ${done}/${total}`);
  });
  const parTime = (performance.now() - parStart) / 1000;
  console.log(`\nParallel:   ${parTime.toFixed(1)}s\n`);

  const speedup = seqTime / parTime;

  // ── Compare ──

  console.log(`Sequential total: ${seqTime.toFixed(1)}s`);
  console.log(`Parallel total:   ${parTime.toFixed(1)}s`);
  console.log(`Speedup:          ${speedup.toFixed(1)}×\n`);

  console.log("cropTolerance | Seq Size  | Par Size  | Match?");
  console.log("--------------|-----------|-----------|------");

  let allMatch = true;
  for (let i = 0; i < cropToleranceValues.length; i++) {
    const ct = cropToleranceValues[i];
    const seqSize = seqResults[i].size;
    const parSize = parGifs[i].length;
    const sizeMatch = seqSize === parSize;
    let byteMatch = sizeMatch;
    if (sizeMatch) {
      const seqBuf = seqResults[i].gif;
      const parBuf = parGifs[i];
      for (let b = 0; b < seqBuf.length; b++) {
        if (seqBuf[b] !== parBuf[b]) { byteMatch = false; break; }
      }
    }
    if (!byteMatch) allMatch = false;
    console.log(
      `${String(ct).padStart(13)} | ${formatSize(seqSize).padStart(9)} | ${formatSize(parSize).padStart(9)} | ${byteMatch ? "✅" : "❌"}`
    );
  }

  console.log("");
  if (allMatch) {
    console.log("✅ All outputs are byte-identical.");
  } else {
    console.log("⚠ Some outputs differ.");
  }

  if (speedup >= 4) {
    console.log(`✅ Speedup ${speedup.toFixed(1)}× exceeds 4× threshold.`);
  } else {
    console.log(`⚠ Speedup is only ${speedup.toFixed(1)}× (< 4×).`);
    if (speedup < 2) {
      console.log("   Worker thread overhead may dominate for this fixture size.");
      console.log("   Try a larger fixture (big-buck-bunny) for better parallelism.");
    }
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
